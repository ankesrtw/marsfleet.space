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

const BASE_SPEED = 14;   // m/s
const TURN_RATE = 1.6;   // rad/s
const CLEARANCE = 0.6;   // meters, wheel-to-chassis (procedural mesh)
const SLOPE_K = 3.0;     // speed falloff strength
const MIN_SPEED_FACTOR = 0.15;

const _up = new THREE.Vector3(0, 1, 0);
const _tiltQuat = new THREE.Quaternion();
const _yawQuat = new THREE.Quaternion();

export function createRover(site, terrain) {
    const mesh = buildRoverMesh();
    mesh.position.set(site.spawn.x, 0, site.spawn.z);
    mesh.rotation.y = site.spawn.heading;

    // GLB is normalized base-at-y=0, so it needs (almost) no clearance;
    // the procedural box chassis keeps the original 0.6.
    let clearance = CLEARANCE;
    attachUnitModel(mesh, 'rover', () => { clearance = 0.05; });

    let heading = site.spawn.heading;
    let speed = 0;

    function update(dt, input) {
        // input: { throttle: -1..1, steer: -1..1 }
        heading += input.steer * TURN_RATE * dt;

        const normal = terrain.sampleNormal(mesh.position.x, mesh.position.z);
        const slopeMag = 1 - normal.y; // 0 = flat, up to ~1 = vertical
        const speedFactor = Math.max(MIN_SPEED_FACTOR, 1 - slopeMag * SLOPE_K);

        speed = input.throttle * BASE_SPEED * speedFactor;

        mesh.position.x += Math.sin(heading) * speed * dt;
        mesh.position.z += Math.cos(heading) * speed * dt;
        mesh.position.y = terrain.sampleHeight(mesh.position.x, mesh.position.z) + clearance;

        // Stay in quaternion space end-to-end: assigning mesh.rotation.y
        // here re-derived euler angles from the tilted quaternion, and that
        // decomposition is discontinuous — past ~3/4 turn the x/z terms flip
        // by π and the mesh visibly snapped (the "flicker past 270°" bug).
        _tiltQuat.setFromUnitVectors(_up, normal);
        _yawQuat.setFromAxisAngle(_up, heading);
        _tiltQuat.multiply(_yawQuat);
        mesh.quaternion.slerp(_tiltQuat, 1 - Math.exp(-12 * dt));
    }

    return { mesh, update, get position() { return mesh.position; }, get heading() { return heading; } };
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

    const mastPositions = [
        [-0.8, 1.1], [0.8, 1.1], [-0.8, -1.1], [0.8, -1.1],
    ];
    const wheelGeo = new THREE.CylinderGeometry(0.35, 0.35, 0.3, 12);
    wheelGeo.rotateZ(Math.PI / 2);
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.9 });
    for (const [x, z] of mastPositions) {
        const wheel = new THREE.Mesh(wheelGeo, wheelMat);
        wheel.position.set(x, 0.1, z);
        group.add(wheel);
    }

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
