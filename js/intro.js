/* ============================================================
   intro.js — first-visit landing-drop cinematic.

   A scripted, code-driven (not video) descent of a landing frame
   from altitude down to exactly the lift drone's normal resting
   spawn position/heading. Purely a camera-and-visual overlay: it
   drives a THREE.Group (visually identical to the drone) that
   main.js renders during the sequence, then discards once the
   real lift-drone unit takes over at the same spot — no special-
   casing needed anywhere else.

   Gating (first-visit-only, skippable, persists across resets) and
   camera hookup live in main.js; this module only owns the descent
   curve and the group it drives.
   ============================================================ */

import * as THREE from 'three';
import { attachUnitModel } from './models.js';

const START_AGL = 500;   // m above spawn — well above the drone's 150m ceiling
const DURATION = 7.5;    // s, hand-tuned: reads as a landing, not a load screen
const DRIFT_START = 0.35; // fraction of the descent spent still drifting laterally

function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/** Builds the descending visual — a fallback quad-frame primitive, same
    scale as the real lift drone, swapped for the real drone.glb once it
    loads (attachUnitModel's own fallback-first idiom) — and returns a
    tiny state machine main.js drives once per frame. */
export function createLandingIntro(scene, terrain, site) {
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xd9d4c8, roughness: 0.5, metalness: 0.2 });
    const mesh = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.4, 1.4), bodyMat);
    mesh.add(body);
    attachUnitModel(mesh, 'drone');

    const targetX = site.spawn.x + 8; // matches lift drone's spawnDx (main.js)
    const targetZ = site.spawn.z + 6; // matches lift drone's spawnDz
    const heading = site.spawn.heading;
    const groundY = terrain.sampleHeight(targetX, targetZ);

    // Start well off to one side so the descent reads as an arrival, not
    // a straight drop-in-place.
    const startX = targetX + Math.sin(heading + Math.PI) * 60;
    const startZ = targetZ + Math.cos(heading + Math.PI) * 60;

    mesh.position.set(startX, groundY + START_AGL, startZ);
    mesh.rotation.y = heading;
    scene.add(mesh);

    let t = 0;
    let done = false;

    function update(dt) {
        if (done) return { pos: mesh.position, heading, done };
        t += dt;
        const frac = THREE.MathUtils.clamp(t / DURATION, 0, 1);
        const eased = easeInOutCubic(frac);

        // Lateral drift finishes early (DRIFT_START of the timeline) so the
        // back half reads as a clean vertical touchdown.
        const driftFrac = THREE.MathUtils.clamp(frac / DRIFT_START, 0, 1);
        const driftEase = easeInOutCubic(driftFrac);
        mesh.position.x = THREE.MathUtils.lerp(startX, targetX, driftEase);
        mesh.position.z = THREE.MathUtils.lerp(startZ, targetZ, driftEase);
        mesh.position.y = THREE.MathUtils.lerp(groundY + START_AGL, groundY, eased);

        // Slight nose-down pitch while descending, leveling out on touchdown.
        const pitch = (1 - eased) * 0.12;
        mesh.rotation.set(pitch, heading, 0, 'YXZ');

        if (frac >= 1) {
            mesh.position.set(targetX, groundY, targetZ);
            mesh.rotation.set(0, heading, 0);
            done = true;
        }
        return { pos: mesh.position, heading, done };
    }

    function skip() {
        done = true;
        mesh.position.set(targetX, groundY, targetZ);
        mesh.rotation.set(0, heading, 0);
    }

    /** Remove the descending visual once the real lift drone (spawned at
        the same position by createDrone) is ready to take its place. */
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
