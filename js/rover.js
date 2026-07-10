/* ============================================================
   rover.js — throttle/steer ground vehicle, terrain-following.

   Position integrates from throttle + heading; pos.y is snapped to
   terrain.sampleHeight() + clearance every frame (no physics
   raycast — direct height-function query, same idiom the whole
   unit layer shares). Mesh tilts to the local slope normal for
   visual believability, and max speed falls off on steep slopes —
   real crater terrain (delta fronts, ridge faces) will actually
   produce this, which is the point of using real data.
   ============================================================ */

import * as THREE from 'three';
import { attachUnitModel } from './models.js';
import { createWheelRig, WHEELS_GLB, WHEELS_FALLBACK } from './wheels.js';

// Perseverance/Curiosity top out at ~4.2 cm/s on flat hard ground (~152
// m/h). True realism makes the 6-9km sites unplayable (Rochette would be
// a six-hour drive), so GEARS time-compress it — REAL keeps the true
// speed for purists, G1-G3 are drive gears (HUD button / G key).
// Turn rate scales with the gear but is capped for control feel.
const REAL_SPEED = 0.042;    // m/s — real rover top speed
const REAL_TURN = 0.06;      // rad/s
const GEARS = [
    { label: 'REAL', mult: 1, drain: 1 },
    { label: 'G1', mult: 50, drain: 1 },
    { label: 'G2', mult: 150, drain: 1.6 },
    { label: 'G3', mult: 400, drain: 2.5 },
];
const GEAR_KEY = 'mc-gear-rover';
const CLEARANCE = 0.6;       // meters, wheel-to-chassis (procedural mesh)
const SLOPE_K = 3.0;         // speed falloff strength
const MIN_SPEED_FACTOR = 0.15;
const BODY_RADIUS = 1.4;     // m, collision footprint against boulders

const _up = new THREE.Vector3(0, 1, 0);
const _tiltQuat = new THREE.Quaternion();
const _yawQuat = new THREE.Quaternion();

export function createRover(site, terrain, rocks) {
    const mesh = buildRoverMesh();
    mesh.position.set(site.spawn.x, 0, site.spawn.z);
    mesh.rotation.y = site.spawn.heading;

    // Spinning-wheel overlay (wheels.js): the GLB's wheels are baked into
    // one fused mesh, so visible spin/steer comes from overlay wheels laid
    // over the measured baked-wheel hubs — attachUnitModel clears the
    // group, so the rig re-adds itself after the swap (rotors.js idiom).
    const wheelRig = createWheelRig();
    wheelRig.layout(WHEELS_FALLBACK);
    mesh.add(wheelRig.group);

    // GLB is normalized base-at-y=0, so it needs (almost) no clearance;
    // the procedural box chassis keeps the original 0.6.
    let clearance = CLEARANCE;
    attachUnitModel(mesh, 'rover', () => {
        clearance = 0.12;
        wheelRig.layout(WHEELS_GLB);
        mesh.add(wheelRig.group);
    });

    let gearIdx = GEARS.findIndex((g) => g.label === localStorage.getItem(GEAR_KEY));
    if (gearIdx < 0) gearIdx = 2; // default G2 (6.3 m/s)

    let heading = site.spawn.heading;
    let speed = 0;

    function cycleGear() {
        gearIdx = (gearIdx + 1) % GEARS.length;
        try { localStorage.setItem(GEAR_KEY, GEARS[gearIdx].label); } catch { /* private mode */ }
        return GEARS[gearIdx].label;
    }

    function update(dt, input) {
        // input: { throttle: -1..1, steer: -1..1 }
        heading += input.steer * Math.min(1.2, REAL_TURN * GEARS[gearIdx].mult) * dt;

        // Ground-contact samplers: real DEM + sub-DEM micro-relief, so the
        // ride picks up regolith-scale bumps the orbital data can't hold.
        const normal = terrain.sampleGroundNormal(mesh.position.x, mesh.position.z);
        const slopeMag = 1 - normal.y; // 0 = flat, up to ~1 = vertical
        const speedFactor = Math.max(MIN_SPEED_FACTOR, 1 - slopeMag * SLOPE_K);

        speed = input.throttle * REAL_SPEED * GEARS[gearIdx].mult * speedFactor;

        const nx = mesh.position.x + Math.sin(heading) * speed * dt;
        const nz = mesh.position.z + Math.cos(heading) * speed * dt;
        // Boulders block entry; steering above still applies, so the player
        // can turn in place and drive around. Movement is never blocked
        // while already overlapping (spawn edge case) — always escapable.
        const blocked = rocks?.collides(nx, nz, BODY_RADIUS)
            && !rocks.collides(mesh.position.x, mesh.position.z, BODY_RADIUS);
        if (!blocked) {
            mesh.position.x = nx;
            mesh.position.z = nz;
        }
        mesh.position.y = terrain.sampleGroundHeight(mesh.position.x, mesh.position.z) + clearance;

        // Stay in quaternion space end-to-end: assigning mesh.rotation.y
        // here re-derived euler angles from the tilted quaternion, and that
        // decomposition is discontinuous — past ~3/4 turn the x/z terms flip
        // by π and the mesh visibly snapped (the "flicker past 270°" bug).
        _tiltQuat.setFromUnitVectors(_up, normal);
        _yawQuat.setFromAxisAngle(_up, heading);
        _tiltQuat.multiply(_yawQuat);
        mesh.quaternion.slerp(_tiltQuat, 1 - Math.exp(-12 * dt));

        // wheels roll from actual ground speed (signed — reverse spins
        // backward) and steer with the input
        wheelRig.update(dt, speed, input.steer);
    }

    return {
        mesh, update, cycleGear,
        get position() { return mesh.position; },
        get heading() { return heading; },
        get maxSpeed() { return REAL_SPEED * GEARS[gearIdx].mult; },
        get gearLabel() { return GEARS[gearIdx].label; },
        get drainScale() { return GEARS[gearIdx].drain; },
    };
}

function buildRoverMesh() {
    const group = new THREE.Group();
    group.name = 'rover';

    const chassis = new THREE.Mesh(
        new THREE.BoxGeometry(1.8, 0.5, 2.6),
        new THREE.MeshStandardMaterial({ color: 0xc9c2b3, metalness: 0.3, roughness: 0.7 })
    );
    chassis.position.y = 0.35;
    group.add(chassis);

    // (no static wheels here — the spinning wheel rig from wheels.js is
    // laid out on the same corners by createRover)

    const mast = new THREE.Mesh(
        new THREE.CylinderGeometry(0.05, 0.05, 1.2, 6),
        new THREE.MeshStandardMaterial({ color: 0x888888 })
    );
    mast.position.set(0, 1.1, 0.6);
    group.add(mast);

    const camHead = new THREE.Mesh(
        new THREE.BoxGeometry(0.3, 0.2, 0.2),
        new THREE.MeshStandardMaterial({ color: 0x333333 })
    );
    camHead.position.set(0, 1.75, 0.6);
    group.add(camHead);

    return group;
}
