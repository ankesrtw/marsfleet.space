/* ============================================================
   wheels.js — procedural spinning-wheel overlay for the rover.

   Same trick as rotors.js: the Tripo rover GLB is one fused mesh
   (single node, no animations — verified in the GLB JSON), so the
   baked wheels can't be spun and a wheel-node re-export is off the
   table on this machine (mesh-split tooling OOMs). Instead each
   baked wheel gets an OVERLAY wheel — lugged tread ring + spoked
   hub — sized ~10% larger so it encloses the static bake, and the
   overlay does the spinning.

   Hub positions/radii in WHEELS_GLB were MEASURED, not guessed:
   vertex clustering of the loaded, normalized model in group space
   (low-band verts on the ±x rails, gap-split along z — see
   docs/game-plans/06). Six wheels: front pair z≈-1.14, mid z≈0.17,
   rear z≈1.06; forward = -z per the unit convention.

   Motion model:
   - spin: ω = ground speed / wheel radius, signed (reverse spins
     backward), all wheels common speed.
   - steer: front pair yaws with input, rear pair counter-yaws at
     60% — Curiosity/Perseverance really do 4-wheel steer.
   - blur: a translucent side disc fades in past ~2 rev/s, same
     speed-faded idiom as the rotor discs, so G2/G3 wheel speeds
     read as motion instead of strobing lugs.

   layout() runs twice like the rotor rig: once for the procedural
   fallback chassis, again from the GLB onReady callback
   (attachUnitModel clears the group, so the rig re-adds itself).
   ============================================================ */

import * as THREE from 'three';

const LUGS = 12;             // tread cleats per wheel
const STEER_MAX = 0.45;      // rad, visual steer lock
const STEER_RESPONSE = 8;    // 1/s, steer smoothing
const BLUR_FULL = 30;        // rad/s at which the blur disc saturates

// Measured on the loaded GLB (group-local meters): [x, y, z, r, halfW].
// r/halfW carry the enclose margin already (~×1.05 on measured). Radii
// come from the wheels' FORE-AFT extent (rZ), not the vertical one —
// the bake merges wheel tops into arms/fenders, so rY under-measures
// and left the baked rims poking out of the first overlay attempt.
export const WHEELS_GLB = [
    [-0.904, 0.305, -1.121, 0.350, 0.190], // front L
    [+0.881, 0.317, -1.154, 0.358, 0.190], // front R
    [-0.892, 0.264, +0.179, 0.296, 0.175], // mid L
    [+0.840, 0.264, +0.176, 0.293, 0.175], // mid R
    [-0.983, 0.346, +1.048, 0.444, 0.260], // rear L
    [+0.942, 0.364, +1.083, 0.425, 0.260], // rear R
];

// The procedural fallback chassis' four corners (its old static wheels
// are gone — the rig IS the fallback's wheels now).
export const WHEELS_FALLBACK = [
    [-0.8, 0.1, +1.1, 0.35, 0.15],
    [+0.8, 0.1, +1.1, 0.35, 0.15],
    [-0.8, 0.1, -1.1, 0.35, 0.15],
    [+0.8, 0.1, -1.1, 0.35, 0.15],
];

export function createWheelRig() {
    const group = new THREE.Group();
    group.name = 'wheel-rig';

    const treadMat = new THREE.MeshStandardMaterial({ color: 0x232325, roughness: 0.92, metalness: 0.05 });
    const lugMat = new THREE.MeshStandardMaterial({ color: 0x2e2e30, roughness: 0.95, metalness: 0.05 });
    const hubMat = new THREE.MeshStandardMaterial({ color: 0x9a8f79, roughness: 0.55, metalness: 0.35 });
    const blurMat = new THREE.MeshBasicMaterial({
        color: 0x1a1a1c,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
    });

    /** wheels: [{ steerPivot, spinPivot, discs, r, steerDir }] */
    let wheels = [];
    let steer = 0;   // current smoothed steer angle

    /** (Re)build wheels at [x, y, z, r, halfW] hubs (group-local). */
    function layout(hubs) {
        for (const w of wheels) group.remove(w.steerPivot);
        wheels = hubs.map(([x, y, z, r, halfW]) => {
            // steer pivot (yaws) wraps spin pivot (rolls around local X)
            const steerPivot = new THREE.Group();
            steerPivot.position.set(x, y, z);
            const spinPivot = new THREE.Group();
            steerPivot.add(spinPivot);

            // tread: cylinder with its axis along the axle (local X)
            const tread = new THREE.Mesh(
                new THREE.CylinderGeometry(r, r, halfW * 2, 20).rotateZ(Math.PI / 2),
                treadMat
            );
            spinPivot.add(tread);

            // lugs: cleat boxes around the rim — the thing that makes
            // rotation actually visible at rover speeds
            const lugGeo = new THREE.BoxGeometry(halfW * 2.06, r * 0.13, r * 0.22);
            for (let i = 0; i < LUGS; i++) {
                const a = (i / LUGS) * Math.PI * 2;
                const lug = new THREE.Mesh(lugGeo, lugMat);
                lug.position.set(0, Math.sin(a) * r, Math.cos(a) * r);
                lug.rotation.x = -a;
                spinPivot.add(lug);
            }

            // spoked hub cap on the OUTER face (sign of x picks the side)
            const out = Math.sign(x) || 1;
            const spokeGeo = new THREE.BoxGeometry(halfW * 0.24, r * 0.16, r * 1.44);
            for (let i = 0; i < 3; i++) {
                const spoke = new THREE.Mesh(spokeGeo, hubMat);
                spoke.position.x = out * halfW * 1.02;
                spoke.rotation.x = (i / 3) * Math.PI;
                spinPivot.add(spoke);
            }
            const cap = new THREE.Mesh(
                new THREE.CylinderGeometry(r * 0.24, r * 0.24, halfW * 0.3, 10).rotateZ(Math.PI / 2),
                hubMat
            );
            cap.position.x = out * halfW * 1.0;
            spinPivot.add(cap);

            // speed-faded blur discs on both faces (rotors.js idiom)
            const discs = [-1, 1].map((side) => {
                const disc = new THREE.Mesh(new THREE.CircleGeometry(r * 0.99, 20), blurMat.clone());
                disc.rotation.y = Math.PI / 2;
                disc.position.x = side * halfW * 1.04;
                steerPivot.add(disc);   // on the steer pivot: no need to spin
                return disc;
            });

            group.add(steerPivot);
            // front (z<0) steers with input, rear against it, mid fixed
            const steerDir = z < -0.5 ? 1 : z > 0.5 ? -0.6 : 0;
            return { steerPivot, spinPivot, discs, r, steerDir };
        });
    }

    /** Per frame. speed: signed ground speed m/s; steerInput: -1..1;
        slip: wheel-spin ratio >= 1 — soft terrain makes the wheels churn
        faster than the ground speed they actually achieve (rover.js
        computes it from the hazard zone effect; 1 = full traction). */
    function update(dt, speed, steerInput, slip = 1) {
        steer += (steerInput * STEER_MAX - steer) * Math.min(1, STEER_RESPONSE * dt);
        for (const w of wheels) {
            const omega = (speed * slip) / w.r;
            w.spinPivot.rotation.x += omega * dt;
            w.steerPivot.rotation.y = steer * w.steerDir;
            const blur = THREE.MathUtils.clamp((Math.abs(omega) - 8) / (BLUR_FULL - 8), 0, 1);
            for (const d of w.discs) d.material.opacity = blur * 0.30;
        }
    }

    return { group, layout, update, get steer() { return steer; } };
}
