/* ============================================================
   drone.js — free-flying scout unit.

   Ignores terrain collision entirely; terrain.sampleHeight() only
   sets a hover-altitude floor so it never clips into the ground.
   Drives the fog-of-war reveal (see fog.js) by exposing its current
   world position every frame — main.js feeds that into fog.reveal().
   ============================================================ */

import * as THREE from 'three';

const SPEED = 22;      // m/s
const TURN_RATE = 2.0; // rad/s
const HOVER_HEIGHT = 18;

export function createDrone(site, terrain) {
    const mesh = buildDroneMesh();
    mesh.position.set(site.spawn.x, 0, site.spawn.z);
    mesh.position.y = terrain.sampleHeight(mesh.position.x, mesh.position.z) + HOVER_HEIGHT;

    let heading = site.spawn.heading;
    let bob = 0;

    function update(dt, input) {
        // input: { forward: -1..1, strafe: -1..1, turn: -1..1 }
        heading += input.turn * TURN_RATE * dt;
        bob += dt;

        const fwd = new THREE.Vector3(Math.sin(heading), 0, Math.cos(heading));
        const right = new THREE.Vector3(Math.cos(heading), 0, -Math.sin(heading));

        mesh.position.addScaledVector(fwd, input.forward * SPEED * dt);
        mesh.position.addScaledVector(right, input.strafe * SPEED * dt);

        const groundY = terrain.sampleHeight(mesh.position.x, mesh.position.z);
        mesh.position.y = groundY + HOVER_HEIGHT + Math.sin(bob * 2) * 0.3;
        mesh.rotation.y = heading;
    }

    return { mesh, update, get position() { return mesh.position; } };
}

function buildDroneMesh() {
    const group = new THREE.Group();
    group.name = 'drone';

    const body = new THREE.Mesh(
        new THREE.SphereGeometry(0.5, 12, 8),
        new THREE.MeshStandardMaterial({ color: 0xe0e0e0, metalness: 0.4, roughness: 0.5 })
    );
    group.add(body);

    const armGeo = new THREE.BoxGeometry(1.6, 0.06, 0.06);
    const armMat = new THREE.MeshStandardMaterial({ color: 0x555555 });
    const arm1 = new THREE.Mesh(armGeo, armMat);
    const arm2 = new THREE.Mesh(armGeo, armMat);
    arm2.rotation.y = Math.PI / 2;
    group.add(arm1, arm2);

    const rotorGeo = new THREE.CylinderGeometry(0.25, 0.25, 0.03, 8);
    const rotorMat = new THREE.MeshStandardMaterial({ color: 0x222222 });
    const rotorPositions = [[0.8, 0], [-0.8, 0], [0, 0.8], [0, -0.8]];
    for (const [x, z] of rotorPositions) {
        const rotor = new THREE.Mesh(rotorGeo, rotorMat);
        rotor.position.set(x, 0.1, z);
        group.add(rotor);
    }

    return group;
}
