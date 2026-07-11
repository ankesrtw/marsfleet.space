/* ============================================================
   intro.js — first-visit landing-drop cinematic.

   A scripted, code-driven (not video) cargo drop: the BASE STATION
   container itself descends from altitude onto exactly its real
   resting spot beside the pad (main.js hides the real dock while
   this plays, so the drop IS the base arriving — not a drone
   landing next to an already-built site). Purely a camera-and-
   visual overlay: at touchdown main.js reveals the real station
   at the same position and discards this mesh — no special-casing
   anywhere else.

   Gating (first-visit-only, skippable, menu-replayable, persists
   across resets) and camera hookup live in main.js; this module
   only owns the descent curve and the group it drives.
   ============================================================ */

import * as THREE from 'three';
import { attachStaticModel } from './models.js';

const START_AGL = 500;   // m above the dock site — high enough to read as an orbital drop
const DURATION = 7.5;    // s WALL-CLOCK (not sim dt — clamped dt at low fps
                         // stretched the drop into an apparent hang on slow
                         // machines; real time keeps it 7.5s everywhere)
const DRIFT_START = 0.35; // fraction of the descent spent still drifting laterally
const CHUTE_RELEASE = 0.85; // fraction of the descent where the canopy jettisons

function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/** Builds the descending visual — a container-scale fallback box, swapped
    for the real station.glb once it loads (attachStaticModel's own
    fallback-first idiom) — and returns a tiny state machine main.js
    drives once per frame. `target` = the real dock's resting world
    position (lab.stationPos), so touchdown lands EXACTLY where the real
    station already sits. */
export function createLandingIntro(scene, site, target) {
    const shellMat = new THREE.MeshStandardMaterial({ color: 0xd9d4c8, roughness: 0.6, metalness: 0.15 });
    const mesh = new THREE.Group();
    const cargo = new THREE.Group(); // attachStaticModel swaps THIS group's children
    const shell = new THREE.Mesh(new THREE.BoxGeometry(14, 6.5, 7), shellMat);
    shell.position.y = 3.25;
    cargo.add(shell);
    mesh.add(cargo);
    attachStaticModel(cargo, 'station');

    // Cargo parachute: canopy dome + shroud lines down to the container's
    // top corners, jettisoned (hidden) just before touchdown like a real
    // retro-assisted cargo drop.
    const chute = new THREE.Group();
    const canopy = new THREE.Mesh(
        new THREE.SphereGeometry(11, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2),
        new THREE.MeshStandardMaterial({ color: 0xe07b39, roughness: 0.9, side: THREE.DoubleSide })
    );
    canopy.position.y = 22;
    chute.add(canopy);
    const cordGeo = new THREE.BufferGeometry();
    const cordPts = [];
    for (const [cx, cz] of [[-6, -3], [-6, 3], [6, -3], [6, 3]]) {
        cordPts.push(cx * 0.9, 21, cz * 0.9, cx, 6.6, cz); // rim -> container top corner
    }
    cordGeo.setAttribute('position', new THREE.Float32BufferAttribute(cordPts, 3));
    chute.add(new THREE.LineSegments(cordGeo, new THREE.LineBasicMaterial({ color: 0x333333 })));
    mesh.add(chute);

    // Camera framing only — the station itself rests at yaw 0.
    const heading = site.spawn.heading;

    // Start well off to one side so the descent reads as an arrival, not
    // a straight drop-in-place.
    const startX = target.x + Math.sin(heading + Math.PI) * 80;
    const startZ = target.z + Math.cos(heading + Math.PI) * 80;

    mesh.position.set(startX, target.y + START_AGL, startZ);
    scene.add(mesh);

    let t0 = null; // wall-clock start, set on the first real frame
    let done = false;

    function update() {
        if (done) return { pos: mesh.position, heading, done };
        if (t0 === null) t0 = performance.now();
        const t = (performance.now() - t0) / 1000;
        const frac = THREE.MathUtils.clamp(t / DURATION, 0, 1);
        const eased = easeInOutCubic(frac);

        // Jettison the canopy just before touchdown.
        chute.visible = frac < CHUTE_RELEASE;

        // Lateral drift finishes early (DRIFT_START of the timeline) so the
        // back half reads as a clean vertical touchdown.
        const driftFrac = THREE.MathUtils.clamp(frac / DRIFT_START, 0, 1);
        const driftEase = easeInOutCubic(driftFrac);
        mesh.position.x = THREE.MathUtils.lerp(startX, target.x, driftEase);
        mesh.position.z = THREE.MathUtils.lerp(startZ, target.z, driftEase);
        mesh.position.y = THREE.MathUtils.lerp(target.y + START_AGL, target.y, eased);

        // Slight swing while descending, leveling out on touchdown.
        mesh.rotation.x = (1 - eased) * 0.06 * Math.sin(t * 1.7);
        mesh.rotation.z = (1 - eased) * 0.05 * Math.cos(t * 1.3);

        if (frac >= 1) {
            mesh.position.set(target.x, target.y, target.z);
            mesh.rotation.set(0, 0, 0);
            done = true;
        }
        return { pos: mesh.position, heading, done };
    }

    function skip() {
        done = true;
        mesh.position.set(target.x, target.y, target.z);
        mesh.rotation.set(0, 0, 0);
    }

    /** Remove the descending visual once the real station (hidden by
        main.js during the drop) is revealed at the same position. */
    function dispose() {
        scene.remove(mesh);
    }

    return {
        get active() { return !done; },
        update,
        skip,
        dispose,
    };
}
