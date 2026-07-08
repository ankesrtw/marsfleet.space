/* ============================================================
   humanoid.js — walking on-foot unit (astronaut/robot).

   Same ground-contact + slope-tilt approach as rover.js, but at
   walking speed/turn-radius and with a much higher slope tolerance
   (can climb terrain the rover can't) — a real-mission-accurate
   division of labor: rover for long traverses, on-foot for tight
   terrain like steep delta-front outcrops.
   ============================================================ */

import * as THREE from 'three';

const WALK_SPEED = 3.2;  // m/s
const TURN_RATE = 2.4;   // rad/s
const SLOPE_K = 0.8;     // much gentler falloff than the rover
const MIN_SPEED_FACTOR = 0.3;

export function createHumanoid(site, terrain) {
    const mesh = buildHumanoidMesh();
    mesh.position.set(site.spawn.x + 5, 0, site.spawn.z);
    mesh.rotation.y = site.spawn.heading;

    let heading = site.spawn.heading;
    let stride = 0;

    function update(dt, input) {
        // input: { throttle: -1..1, steer: -1..1 }
        heading += input.steer * TURN_RATE * dt;

        const normal = terrain.sampleNormal(mesh.position.x, mesh.position.z);
        const slopeMag = 1 - normal.y;
        const speedFactor = Math.max(MIN_SPEED_FACTOR, 1 - slopeMag * SLOPE_K);
        const speed = input.throttle * WALK_SPEED * speedFactor;

        mesh.position.x += Math.sin(heading) * speed * dt;
        mesh.position.z += Math.cos(heading) * speed * dt;
        mesh.position.y = terrain.sampleHeight(mesh.position.x, mesh.position.z);

        if (Math.abs(input.throttle) > 0.05) stride += dt * 6;
        mesh.rotation.y = heading;
        mesh.position.y += Math.abs(Math.sin(stride)) * 0.06; // subtle walk bob
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
