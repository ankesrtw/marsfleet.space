/* ============================================================
   makadane.js — MAKADANE, the octopod walker (plan 24; renamed +
   polished plan 26).

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

   Cool livery (teal facets + cyan glow) with emissive rim + mast
   sensor, deliberately contrasting Gratbot's warm palette so the two
   walkers read as distinct machines, not identical procedural kit.
   Stereo-camera mast forward (−Z), whip-antenna cluster aft.
   ============================================================ */

import * as THREE from 'three';
import { createWalker } from './walker-rig.js';

const LEGS = 8;
const MOUNT_R = 0.58;   // hip ring radius on the deck edge
const MOUNT_Y = 0.58;   // hip height over root ground point
const HOME_OUT = 0.72;  // foot home: this far outboard of its hip
const RIPPLE = 0.22;    // metachronal stagger between leg pairs

const SPEC = {
    name: 'makadane',
    // Cool identity: teal rim facets, cyan sensor glow.
    livery: { accent: 0x2ba39b, glow: 0x33e0ff },
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

    // teal rim facets on alternating octagon faces
    const facetGeo = new THREE.BoxGeometry(0.3, 0.14, 0.02);
    for (let i = 0; i < 4; i++) {
        const az = i * Math.PI / 2 + Math.PI / 4;
        const facet = new THREE.Mesh(facetGeo, mats.accent);
        facet.position.set(Math.sin(az) * 0.615, 0.6, Math.cos(az) * 0.615);
        facet.rotation.y = az;
        body.add(facet);
    }

    // glowing cyan ring segments on the OTHER four faces — a lit rim
    // that circles the deck (the finished, powered-machine read)
    const glowGeo = new THREE.BoxGeometry(0.26, 0.03, 0.015);
    for (let i = 0; i < 4; i++) {
        const az = i * Math.PI / 2;
        const seg = new THREE.Mesh(glowGeo, mats.glow);
        seg.position.set(Math.sin(az) * 0.63, 0.66, Math.cos(az) * 0.63);
        seg.rotation.y = az;
        body.add(seg);
    }

    // ---- camera mast, forward (−Z) ------------------------------
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, 0.18, 10), mats.joint);
    mast.position.set(0, 0.85, -0.16);
    body.add(mast);

    const camHead = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.12, 0.14), mats.panel);
    camHead.position.set(0, 0.97, -0.16);
    body.add(camHead);

    // glowing sensor bar between the mast lenses
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.025, 0.012), mats.glow);
    bar.position.set(0, 0.97, -0.232);
    body.add(bar);

    const lensGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.03, 10);
    for (const sx of [-1, 1]) {
        const lens = new THREE.Mesh(lensGeo, mats.lens);
        lens.rotation.x = Math.PI / 2;
        lens.position.set(sx * 0.065, 0.97, -0.235);
        body.add(lens);
    }

    // ---- whip antenna cluster, aft ------------------------------
    const whips = [[0.18, 0.55, 0.24], [0.26, 0.72, 0.15], [0.1, 0.88, 0.32]];
    const tipGeo = new THREE.SphereGeometry(0.018, 8, 6);
    for (const [wx, wh, wz] of whips) {
        const whip = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, wh, 6), mats.dark);
        whip.position.set(wx, 0.735 + wh / 2, wz);
        body.add(whip);
        // glowing tip beacon (was a dull actuator bead)
        const tip = new THREE.Mesh(tipGeo, mats.glow);
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

// Plan 27 — rock handling.
export const MAKADANE_CLIMB_R = 1.3;  // steps over everything but true boulders
const GRAB_RANGE = 3.2;               // m from the deck centre
const CARRY_MAX_R = 1.1;              // biggest rock the clamp closes on
const CARRY_SPEED = 0.75;             // laden walk-speed penalty
// The two legs that hold the load. Leg 0 sits at azimuth π/8 (just off the
// forward mast) and 7 at −π/8, so this pair straddles the front. Removing 2
// of 8 from the alternating tetrapod still leaves ≥3 planted.
const GRIP_LEGS = [0, 7];

/**
 * The octopod plus its rock-handling rig. Wraps the shared walker so the
 * carry state lives with the unit that has it, not in walker-rig.js —
 * Gratbot has no clamp and should not carry the concept.
 */
export function createMakadane(site, terrain, obstacles, rocks = null) {
    const walker = createWalker(site, terrain, obstacles, SPEC);

    let carried = null;      // the rock record in the clamp
    let carriedMesh = null;

    /** The rock in reach, or null. Used for the HUD prompt too, so it must
        stay cheap enough to call every frame. */
    function candidate() {
        if (carried || !rocks?.rockNear) return null;
        const p = walker.position;
        return rocks.rockNear(p.x, p.z, GRAB_RANGE, CARRY_MAX_R);
    }

    /** Lift the nearest rock into the clamp. Returns the record or null. */
    function grab() {
        const rec = candidate();
        if (!rec) return null;
        rocks.removeRock(rec);
        carried = rec;
        carriedMesh = rocks.rockMesh(rec);
        // clamped under the forward rim, where the grip legs reach
        carriedMesh.position.set(0, 0.3, -0.85);
        walker.mesh.add(carriedMesh);
        walker.holdLegs(GRIP_LEGS, { x: 0, y: -0.28, z: -0.95 });
        walker.setSpeedScale(CARRY_SPEED);
        return rec;
    }

    /** Set the load down in front of the unit — a real obstacle again. */
    function drop() {
        if (!carried) return null;
        const p = walker.position;
        const h = walker.heading;
        // place it a body-length ahead (travel is along −(sin h, cos h))
        const x = p.x - Math.sin(h) * 1.6;
        const z = p.z - Math.cos(h) * 1.6;
        const placed = rocks.placeRock(carried, x, z);
        release();
        return placed;
    }

    /** Destroy the load outright (recycled at the lab) — stays gone. */
    function recycle() {
        if (!carried) return null;
        const rec = carried;
        release();
        return rec;
    }

    function release() {
        if (carriedMesh) walker.mesh.remove(carriedMesh);
        carriedMesh = null;
        carried = null;
        walker.holdLegs(null);
        walker.setSpeedScale(1);
    }

    // NOT `{ ...walker }`: spreading evaluates getters once, which would
    // freeze position/heading at their boot values and the unit would
    // silently never appear to move. Delegate each one explicitly.
    return {
        mesh: walker.mesh,
        update: walker.update,
        teleport: walker.teleport,
        feet: walker.feet,
        holdLegs: walker.holdLegs,
        setSpeedScale: walker.setSpeedScale,
        get position() { return walker.position; },
        get heading() { return walker.heading; },
        get atBoundary() { return walker.atBoundary; },
        get heldCount() { return walker.heldCount; },
        get legCount() { return walker.legCount; },
        get deckY() { return walker.deckY; },
        grab, drop, recycle, candidate,
        get carrying() { return carried; },
        get carryRange() { return GRAB_RANGE; },
    };
}
