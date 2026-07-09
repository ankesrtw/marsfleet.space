/* ============================================================
   humanoid.js — walking on-foot unit (astronaut/robot).

   Same ground-contact + slope-tilt approach as rover.js, but at
   walking speed/turn-radius and with a much higher slope tolerance
   (can climb terrain the rover can't) — a real-mission-accurate
   division of labor: rover for long traverses, on-foot for tight
   terrain like steep delta-front outcrops.
   ============================================================ */

import * as THREE from 'three';
import { attachUnitModel } from './models.js';

// ~5 km/h — a brisk suited walk (Apollo EVAs averaged ~2.2 km/h with
// loping bursts near 5). Real scale, no assist needed to stay playable.
const WALK_SPEED = 1.4;  // m/s
const TURN_RATE = 2.4;   // rad/s
const SLOPE_K = 0.8;     // much gentler falloff than the rover
const MIN_SPEED_FACTOR = 0.3;
const BODY_RADIUS = 0.35; // m, collision footprint against boulders

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

export function createHumanoid(site, terrain, rocks) {
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
    let walkAmt = 0; // 0..1, eases the cycle in/out so stops don't snap

    const _swing = new THREE.Quaternion();
    const _axis = new THREE.Vector3(1, 0, 0); // bind-local X = leg/arm swing

    function update(dt, input) {
        // input: { throttle: -1..1, steer: -1..1 }
        heading += input.steer * TURN_RATE * dt;

        const normal = terrain.sampleNormal(mesh.position.x, mesh.position.z);
        const slopeMag = 1 - normal.y;
        const speedFactor = Math.max(MIN_SPEED_FACTOR, 1 - slopeMag * SLOPE_K);
        const speed = input.throttle * WALK_SPEED * speedFactor;

        const nx = mesh.position.x + Math.sin(heading) * speed * dt;
        const nz = mesh.position.z + Math.cos(heading) * speed * dt;
        const blocked = rocks?.collides(nx, nz, BODY_RADIUS)
            && !rocks.collides(mesh.position.x, mesh.position.z, BODY_RADIUS);
        if (!blocked) {
            mesh.position.x = nx;
            mesh.position.z = nz;
        }
        mesh.position.y = terrain.sampleHeight(mesh.position.x, mesh.position.z);

        const moving = Math.abs(input.throttle) > 0.05;
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

    return { mesh, update, get position() { return mesh.position; }, get heading() { return heading; } };
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
