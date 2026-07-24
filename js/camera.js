/* ============================================================
   camera.js — orbit chase-cam rig.

   Follows the active unit, sitting behind its travel heading by
   default, but the player can orbit around it (mouse drag / one-
   finger drag on the canvas), tilt, and zoom (wheel / pinch).
   Double-click or double-tap snaps the view back behind the unit.

   Uses Pointer Events on the canvas only — the joystick zones sit
   on top of the canvas and capture their own pointers, so touch
   moves and camera drags never fight over the same finger.

   The rig also clamps the camera above the real terrain
   (sampleHeight + margin) so orbiting low never clips underground.
   ============================================================ */

import * as THREE from 'three';

const MIN_DIST = 4;
const MAX_DIST = 120;
const MIN_PITCH = 0.08;   // rad above horizontal
const MAX_PITCH = 1.35;
const DRAG_YAW_SPEED = 0.006;   // rad per px
const DRAG_PITCH_SPEED = 0.004;
const WHEEL_ZOOM_K = 0.0012;
const GROUND_MARGIN = 1.6;

export function createCameraRig(camera, canvas, terrain) {
    let userYaw = 0;          // offset from the unit's heading
    let pitch = 0.5;
    let dist = 12;
    let defaultDist = 12;

    const pointers = new Map(); // pointerId -> {x, y}
    let pinchStartDist = 0;
    let pinchStartZoom = 0;
    let lastTapTime = 0;

    canvas.addEventListener('pointerdown', (e) => {
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        canvas.setPointerCapture(e.pointerId);
        if (pointers.size === 2) {
            const [a, b] = [...pointers.values()];
            pinchStartDist = Math.hypot(a.x - b.x, a.y - b.y);
            pinchStartZoom = dist;
        }
        // double-click / double-tap -> reset behind unit
        const now = performance.now();
        if (pointers.size === 1 && now - lastTapTime < 300) {
            userYaw = 0;
            pitch = 0.5;
            dist = defaultDist;
        }
        lastTapTime = now;
    });

    canvas.addEventListener('pointermove', (e) => {
        const prev = pointers.get(e.pointerId);
        if (!prev) return;
        const dx = e.clientX - prev.x;
        const dy = e.clientY - prev.y;
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

        if (pointers.size === 1) {
            userYaw -= dx * DRAG_YAW_SPEED;
            pitch = clamp(pitch + dy * DRAG_PITCH_SPEED, MIN_PITCH, MAX_PITCH);
        } else if (pointers.size === 2) {
            const [a, b] = [...pointers.values()];
            const d = Math.hypot(a.x - b.x, a.y - b.y);
            if (pinchStartDist > 0) {
                dist = clamp(pinchStartZoom * (pinchStartDist / d), MIN_DIST, MAX_DIST);
            }
        }
    });

    const release = (e) => {
        pointers.delete(e.pointerId);
        if (pointers.size < 2) pinchStartDist = 0;
    };
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', release);

    canvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        dist = clamp(dist * Math.exp(e.deltaY * WHEEL_ZOOM_K), MIN_DIST, MAX_DIST);
    }, { passive: false });

    // Plan 27: impulse shake (van rock strikes). Decays exponentially and is
    // applied AFTER the position lerp so it never feeds back into the smoothing.
    let shakeAmt = 0;
    const SHAKE_DECAY = 6.5;
    const SHAKE_SCALE = 0.35; // m of throw at full amplitude

    /** amount 0..1 — takes the strongest pending shake rather than summing,
        so a burst of wheel strikes reads as one jolt, not a pile-up. */
    function shake(amount) {
        shakeAmt = Math.min(1, Math.max(shakeAmt, amount));
    }

    /** Called once per frame. kind: 'ground' | 'fly'. */
    function update(target, heading, kind, snap = false, dt = 0.016) {
        defaultDist = kind === 'fly' ? 18 : 12;
        const yaw = heading + userYaw;
        const hd = dist * Math.cos(pitch);
        const desired = new THREE.Vector3(
            target.x + Math.sin(yaw) * hd,
            target.y + dist * Math.sin(pitch),
            target.z + Math.cos(yaw) * hd
        );
        // never let the camera dip below the real terrain
        const groundY = terrain.sampleHeight(desired.x, desired.z) + GROUND_MARGIN;
        if (desired.y < groundY) desired.y = groundY;

        if (snap) camera.position.copy(desired);
        else camera.position.lerp(desired, 0.1);

        if (shakeAmt > 0.001) {
            const a = shakeAmt * SHAKE_SCALE;
            camera.position.x += (Math.random() - 0.5) * a;
            camera.position.y += (Math.random() - 0.5) * a;
            camera.position.z += (Math.random() - 0.5) * a;
            shakeAmt *= Math.exp(-SHAKE_DECAY * dt);
        } else {
            shakeAmt = 0;
        }
        camera.lookAt(target.x, target.y + 1.5, target.z);
    }

    /** Programmatic zoom (clamped) — the landing intro pulls the camera
        back to frame the 15m station container, then restores. */
    function setDistance(d) {
        dist = clamp(d, MIN_DIST, MAX_DIST);
    }

    return {
        update,
        setDistance,
        shake,
        // for E2E assertions
        get state() { return { userYaw, pitch, dist }; },
        get shakeAmt() { return shakeAmt; },
    };
}

function clamp(v, lo, hi) {
    return Math.min(hi, Math.max(lo, v));
}
