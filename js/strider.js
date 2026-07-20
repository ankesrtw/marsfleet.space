/* ============================================================
   strider.js — STRIDER, the quadruped walker (plan 24).

   Spot/ANYmal-class four-legged robot: the fleet's steep-slope
   specialist. Sagittal (non-yaw) legs in a trot gait — diagonal
   pairs in antiphase — with the reference image's X-stance:
   front knees bulge forward, hind knees bulge back.

   Procedural model matched to assets/refs strider reference:
   boxy white chassis, burnt-orange accent band + shoulder blocks,
   dark underbelly and side vents, stereo-camera head on a neck
   pedestal at the FRONT (front = body −Z: forward travel under W
   is along −_fwd, same sign convention as every ground unit).
   ============================================================ */

import * as THREE from 'three';
import { createWalker } from './walker-rig.js';

// Fleet role: between rover (fast, slope-limited) and arachne
// (slowest, near slope-proof). Slope factor floor .45 vs the
// humanoid's .3 — legs keep more speed on a grade than boots.
const SPEC = {
    name: 'strider',
    spawnOffset: { x: -7, z: 6 },
    walkSpeed: 2.0,
    turnRate: 2.0,
    slopeK: 0.45,
    minSpeedFactor: 0.45,
    bodyRadius: 0.55,
    strideRate: 6.5,
    stepHalf: 0.3,
    swingLift: 0.18,
    bobAmp: 0.035,
    // Terrain-hug: firmer than the biped's counter-lean — the body
    // conforms to the grade (the legged-robot read).
    pitchGain: 0.85,
    rollGain: 0.7,
    maxTilt: 0.5,
    legDims: { L1: 0.42, L2: 0.46, hipR: 0.075, femurW: 0.09, tibiaW: 0.07 },
    build,
};

// hip mounts: shoulders just outboard of the hull, feet homed
// directly under them (sagittal legs — lateral error absorbed
// in-plane, the humanoid convention).
const MOUNT_X = 0.33;
const MOUNT_Y = 0.68;
const MOUNT_Z = 0.4;

function build(mats) {
    const body = new THREE.Group();

    // ---- chassis ------------------------------------------------
    const hull = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.34, 1.15), mats.panel);
    hull.position.y = 0.86;
    body.add(hull);

    const belly = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.15, 1.02), mats.joint);
    belly.position.y = 0.64;
    body.add(belly);

    // accent band wraps the forward third (slightly proud of the
    // hull so it reads as a painted stripe, not z-fighting)
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.565, 0.12, 0.34), mats.accent);
    band.position.set(0, 0.86, -0.2);
    body.add(band);

    const deck = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.05, 0.96), mats.panel);
    deck.position.y = 1.055;
    body.add(deck);

    // dark side vents (rear flank, like the reference grille)
    const ventGeo = new THREE.BoxGeometry(0.02, 0.16, 0.4);
    for (const sx of [-1, 1]) {
        const vent = new THREE.Mesh(ventGeo, mats.dark);
        vent.position.set(sx * 0.286, 0.8, 0.25);
        body.add(vent);
    }

    // ---- deck instruments --------------------------------------
    const canGeo = new THREE.CylinderGeometry(0.07, 0.07, 0.13, 12);
    const can1 = new THREE.Mesh(canGeo, mats.panel);
    can1.position.set(-0.13, 1.14, 0.26);
    const can2 = new THREE.Mesh(canGeo, mats.accent);
    can2.position.set(0.13, 1.14, 0.26);
    body.add(can1, can2);

    const aerial = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.4, 6), mats.dark);
    aerial.position.set(0.18, 1.26, 0.44);
    body.add(aerial);

    // ---- sensor head on neck pedestal (front = −Z) --------------
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.2, 10), mats.joint);
    neck.position.set(0, 1.15, -0.38);
    body.add(neck);

    const head = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.14, 0.16), mats.panel);
    head.position.set(0, 1.29, -0.38);
    body.add(head);

    const lensGeo = new THREE.CylinderGeometry(0.035, 0.035, 0.03, 10);
    for (const sx of [-1, 1]) {
        const lens = new THREE.Mesh(lensGeo, mats.lens);
        lens.rotation.x = Math.PI / 2;
        lens.position.set(sx * 0.08, 1.29, -0.465);
        body.add(lens);
    }

    // ---- orange shoulder blocks over the hip mounts -------------
    const shoulderGeo = new THREE.BoxGeometry(0.14, 0.2, 0.22);
    for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
            const sh = new THREE.Mesh(shoulderGeo, mats.accent);
            sh.position.set(sx * MOUNT_X, MOUNT_Y + 0.08, sz * MOUNT_Z);
            body.add(sh);
        }
    }

    // ---- legs: trot pairs (FL+BR at 0, FR+BL at π), X-stance
    // knees (front elbow −1 = bulge forward/−Z, hind +1 = back).
    const legs = [];
    for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
            const front = sz < 0;
            legs.push({
                mount: { x: sx * MOUNT_X, y: MOUNT_Y, z: sz * MOUNT_Z },
                faceYaw: 0,
                useYaw: false,
                elbow: front ? -1 : 1,
                // diagonal pairs share phase: FL(−x,−z)+BR(+x,+z) at 0
                phase: sx * sz > 0 ? 0 : Math.PI,
                homeLx: sx * MOUNT_X,
                homeLz: sz * MOUNT_Z,
            });
        }
    }

    return { body, legs };
}

export function createStrider(site, terrain, obstacles) {
    return createWalker(site, terrain, obstacles, SPEC);
}
