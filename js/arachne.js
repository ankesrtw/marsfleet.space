/* ============================================================
   arachne.js — ARACHNE, the octopod walker (plan 24).

   Eight radially-mounted 3-DOF legs (coxa yaw + femur + tibia)
   around a flat octagonal deck — the fleet's near-slope-proof
   crawler. Gait is an alternating tetrapod (adjacent legs in
   antiphase — four feet always planted, the spider guarantee)
   with a small metachronal stagger across the pairs so the
   ripple reads organic instead of metronomic.

   Knee-UP configuration on every leg (elbow +1): femur reaches
   up-and-out past the deck rim, tibia drops to the foot — the
   arched spider silhouette from the reference image. Legs sweep
   fore-aft through their coxa yaw, which is exactly how real
   arthropods (and hexapod robots) translate a radial mount into
   directional travel.

   Model matched to assets/refs arachne reference: octagonal white
   deck with orange rim facets, dark underbelly, stereo-camera
   mast forward (−Z), whip-antenna cluster aft.
   ============================================================ */

import * as THREE from 'three';
import { createWalker } from './walker-rig.js';

const LEGS = 8;
const MOUNT_R = 0.58;   // hip ring radius on the deck edge
const MOUNT_Y = 0.58;   // hip height over root ground point
const HOME_OUT = 0.72;  // foot home: this far outboard of its hip
const RIPPLE = 0.22;    // metachronal stagger between leg pairs

const SPEC = {
    name: 'arachne',
    spawnOffset: { x: -4, z: -9 },
    walkSpeed: 1.5,
    turnRate: 1.6,
    // near slope-proof: the whole point of eight planted feet
    slopeK: 0.3,
    minSpeedFactor: 0.55,
    bodyRadius: 0.95,
    strideRate: 5.5,
    stepHalf: 0.26,
    swingLift: 0.22,
    bobAmp: 0.02,
    // hugs the grade hardest of the fleet
    pitchGain: 0.95,
    rollGain: 0.9,
    maxTilt: 0.6,
    legDims: { L1: 0.52, L2: 0.78, hipR: 0.06, femurW: 0.075, tibiaW: 0.055 },
    build,
};

function build(mats) {
    const body = new THREE.Group();

    // ---- octagonal deck (flat facet forward: theta offset π/8) --
    const deck = new THREE.Mesh(
        new THREE.CylinderGeometry(0.62, 0.66, 0.22, 8, 1, false, Math.PI / 8), mats.panel);
    deck.position.y = 0.6;
    body.add(deck);

    const belly = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.44, 0.12, 8, 1, false, Math.PI / 8), mats.joint);
    belly.position.y = 0.44;
    body.add(belly);

    const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.05, 8, 1, false, Math.PI / 8), mats.panel);
    plate.position.y = 0.735;
    body.add(plate);

    // orange rim facets on alternating octagon faces
    const facetGeo = new THREE.BoxGeometry(0.3, 0.14, 0.02);
    for (let i = 0; i < 4; i++) {
        const az = i * Math.PI / 2 + Math.PI / 4;
        const facet = new THREE.Mesh(facetGeo, mats.accent);
        facet.position.set(Math.sin(az) * 0.615, 0.6, Math.cos(az) * 0.615);
        facet.rotation.y = az;
        body.add(facet);
    }

    // ---- camera mast, forward (−Z) ------------------------------
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, 0.18, 10), mats.joint);
    mast.position.set(0, 0.85, -0.16);
    body.add(mast);

    const camHead = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.12, 0.14), mats.panel);
    camHead.position.set(0, 0.97, -0.16);
    body.add(camHead);

    const lensGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.03, 10);
    for (const sx of [-1, 1]) {
        const lens = new THREE.Mesh(lensGeo, mats.lens);
        lens.rotation.x = Math.PI / 2;
        lens.position.set(sx * 0.065, 0.97, -0.235);
        body.add(lens);
    }

    // ---- whip antenna cluster, aft ------------------------------
    const whips = [[0.18, 0.55, 0.24], [0.26, 0.72, 0.15], [0.1, 0.88, 0.32]];
    const tipGeo = new THREE.SphereGeometry(0.014, 8, 6);
    for (const [wx, wh, wz] of whips) {
        const whip = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, wh, 6), mats.dark);
        whip.position.set(wx, 0.735 + wh / 2, wz);
        body.add(whip);
        const tip = new THREE.Mesh(tipGeo, mats.actuator);
        tip.position.set(wx, 0.735 + wh, wz);
        body.add(tip);
    }

    // small instrument domes on deck
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2), mats.dark);
    dome.position.set(-0.24, 0.76, 0.12);
    body.add(dome);
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.1, 10), mats.accent);
    drum.position.set(0.24, 0.81, -0.02);
    body.add(drum);

    // ---- 8 radial legs ------------------------------------------
    // Azimuths offset π/8 so no leg points dead ahead (the mast
    // owns −Z). Alternating tetrapod: adjacent legs antiphase,
    // plus a small ripple stagger per diagonal pair so the wave
    // travels around the ring.
    const legs = [];
    for (let i = 0; i < LEGS; i++) {
        const az = (i / LEGS) * Math.PI * 2 + Math.PI / 8;
        legs.push({
            mount: { x: Math.sin(az) * MOUNT_R, y: MOUNT_Y, z: Math.cos(az) * MOUNT_R },
            faceYaw: az,
            useYaw: true,
            elbow: 1, // knee-up spider arch, all legs
            phase: (i % 2) * Math.PI + (i >> 1) * RIPPLE,
            homeLx: Math.sin(az) * (MOUNT_R + HOME_OUT),
            homeLz: Math.cos(az) * (MOUNT_R + HOME_OUT),
        });
    }

    return { body, legs };
}

export function createArachne(site, terrain, obstacles) {
    return createWalker(site, terrain, obstacles, SPEC);
}
