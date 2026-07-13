/* ============================================================
   humanoid.js — walking on-foot unit (astronaut/robot).

   Same ground-contact + slope-tilt approach as rover.js, but at
   walking speed/turn-radius and with a much higher slope tolerance
   (can climb terrain the rover can't) — a real-mission-accurate
   division of labor: rover for long traverses, on-foot for tight
   terrain like steep delta-front outcrops.
   ============================================================ */

import * as THREE from 'three';
import { GRAVITY_MARS } from './physics.js';
import { attachUnitModel } from './models.js';

// ~5 km/h — a brisk suited walk (Apollo EVAs averaged ~2.2 km/h with
// loping bursts near 5). Real scale, no assist needed to stay playable.
const WALK_SPEED = 1.4;  // m/s
const TURN_RATE = 2.4;   // rad/s
const SLOPE_K = 0.8;     // much gentler falloff than the rover
const MIN_SPEED_FACTOR = 0.3;
const BODY_RADIUS = 0.35; // m, collision footprint (also main.js registry)
const EDGE_MARGIN = 30;   // m inside the DEM edge — the mission boundary

// Wave 9 Mars jump. Apex = v^2 / 2g = 3.4^2 / (2 x 3.72) ~ 1.55 m, hang time
// = 2v/g ~ 1.83 s. The identical impulse on Earth would clear only 0.59 m and
// hang 0.69 s — the 2.6x floatiness IS the low-gravity read.
const JUMP_IMPULSE = 3.4; // m/s

// Procedural walk cycle on the GLB's rig (the Tripo export is rigged
// but ships zero animation clips, so we drive the bones ourselves).
// Swing amplitudes in radians around each bone's bind pose.
const WALK_BONES = [
    { name: 'L_Thigh', amp: 0.55, phase: 0 },
    { name: 'R_Thigh', amp: 0.55, phase: Math.PI },
    { name: 'L_Calf', amp: 0.45, phase: Math.PI * 0.55 },
    { name: 'R_Calf', amp: 0.45, phase: Math.PI * 1.55 },
    { name: 'L_Upperarm', amp: 0.35, phase: Math.PI },
    { name: 'R_Upperarm', amp: 0.35, phase: 0 },
    { name: 'L_Forearm', amp: 0.2, phase: Math.PI * 1.3 },
    { name: 'R_Forearm', amp: 0.2, phase: Math.PI * 0.3 },
];

// `obstacles` is a colliders.js facade (boulders + structures + other
// units), shaped like the old rocks collider: collides(x, z, radius).
export function createHumanoid(site, terrain, obstacles) {
    const mesh = buildHumanoidMesh();
    mesh.position.set(site.spawn.x + 5, 0, site.spawn.z);
    mesh.rotation.y = site.spawn.heading;

    // Populated once the GLB lands: [{bone, bindQuat, amp, phase}]
    let rig = null;
    attachUnitModel(mesh, 'humanoid', (model) => {
        rig = [];
        for (const cfg of WALK_BONES) {
            const bone = model.getObjectByName(cfg.name);
            if (bone) rig.push({ bone, bind: bone.quaternion.clone(), ...cfg });
        }
        if (!rig.length) rig = null; // unexpected rig — leave bind pose
    });

    let heading = site.spawn.heading;
    let stride = 0;
    let airY = 0;        // m above the ground clamp (0 = boots down)
    let jumpVel = 0;     // m/s vertical, integrated against GRAVITY_MARS
    let walkAmt = 0; // 0..1, eases the cycle in/out so stops don't snap
    let atBoundary = false;
    const bound = site.worldSize / 2 - EDGE_MARGIN;

    const _swing = new THREE.Quaternion();
    const _axis = new THREE.Vector3(1, 0, 0); // bind-local X = leg/arm swing

    function update(dt, input) {
        // input: { throttle: -1..1, steer: -1..1, jump: bool }
        heading += input.steer * TURN_RATE * dt;

        // Mars jump (Wave 9). At 0.38 g the SAME impulse arcs ~2.6x higher and
        // hangs ~2.6x longer than on Earth, and that floatiness is the point —
        // it is the most legible "you are not on Earth" cue in the whole sim.
        // JUMP_IMPULSE 3.4 m/s => apex ~1.55 m, hang ~1.8 s.
        if (input.jump && airY <= 0 && jumpVel === 0) {
            jumpVel = JUMP_IMPULSE;
        }

        // Ground-contact samplers (see terrain.js micro-relief): boots feel
        // the sub-DEM regolith bumps, drone AGL and markers stay smooth-DEM.
        const normal = terrain.sampleGroundNormal(mesh.position.x, mesh.position.z);
        const slopeMag = 1 - normal.y;
        const speedFactor = Math.max(MIN_SPEED_FACTOR, 1 - slopeMag * SLOPE_K);
        const speed = input.throttle * WALK_SPEED * speedFactor;

        let nx = mesh.position.x + Math.sin(heading) * speed * dt;
        let nz = mesh.position.z + Math.cos(heading) * speed * dt;
        // Mission boundary: clamp + flag (HUD shows OUT OF MISSION DIRECTIVES)
        atBoundary = Math.abs(nx) > bound || Math.abs(nz) > bound;
        if (atBoundary) {
            nx = THREE.MathUtils.clamp(nx, -bound, bound);
            nz = THREE.MathUtils.clamp(nz, -bound, bound);
        }
        const blocked = obstacles?.collides(nx, nz, BODY_RADIUS)
            && !obstacles.collides(mesh.position.x, mesh.position.z, BODY_RADIUS);
        if (!blocked) {
            mesh.position.x = nx;
            mesh.position.z = nz;
        }
        // Vertical: airborne frames integrate Mars gravity; grounded frames
        // stay clamped to the terrain exactly as before (a walker never needs
        // a falling model while its boots are on the ground).
        const groundY = terrain.sampleGroundHeight(mesh.position.x, mesh.position.z);
        if (jumpVel !== 0 || airY > 0) {
            jumpVel -= GRAVITY_MARS * dt;
            airY += jumpVel * dt;
            if (airY <= 0) { airY = 0; jumpVel = 0; }   // touchdown
        }
        mesh.position.y = groundY + airY;

        // Airborne = no walk cycle (legs stop pumping mid-flight).
        const grounded = airY <= 0;
        const moving = grounded && Math.abs(input.throttle) > 0.05;
        if (moving) stride += dt * 6;
        walkAmt += ((moving ? 1 : 0) - walkAmt) * Math.min(1, 8 * dt);
        mesh.rotation.y = heading;
        mesh.position.y += Math.abs(Math.sin(stride)) * 0.06 * walkAmt; // walk bob

        if (rig && walkAmt > 0.01) {
            for (const j of rig) {
                _swing.setFromAxisAngle(_axis, Math.sin(stride + j.phase) * j.amp * walkAmt);
                j.bone.quaternion.copy(j.bind).multiply(_swing);
            }
        }
    }

    return {
        mesh, update,
        get position() { return mesh.position; },
        get heading() { return heading; },
        get atBoundary() { return atBoundary; },
        get airborne() { return airY > 0; },
        get airY() { return airY; },          // m above ground (jump arc)
        get jumpVel() { return jumpVel; },
    };
}

function buildHumanoidMesh() {
    const group = new THREE.Group();
    group.name = 'humanoid';
    const mat = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.6 });

    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.6, 4, 8), mat);
    torso.position.y = 1.1;
    group.add(torso);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 8), mat);
    head.position.y = 1.65;
    group.add(head);

    const legGeo = new THREE.CapsuleGeometry(0.1, 0.7, 4, 6);
    const legL = new THREE.Mesh(legGeo, mat);
    legL.position.set(-0.15, 0.45, 0);
    const legR = new THREE.Mesh(legGeo, mat);
    legR.position.set(0.15, 0.45, 0);
    group.add(legL, legR);

    return group;
}
