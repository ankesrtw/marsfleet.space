/* ============================================================
   van.js — humanoid-driven mobile base (Wave 12).

   Same terrain-follow + slope-tilt approach as rover.js, retuned:
   slower but torquier (higher slope tolerance), only the humanoid
   can drive it, and when parked it deploys as a field chargepad.
   ============================================================ */

import * as THREE from 'three';
import { attachUnitModel } from './models.js';

const VAN_SPEED = 2.0;         // m/s — faster than walking, slower than rover G2
const TURN_RATE = 2.0;         // rad/s
const SLOPE_K = 1.5;           // torquier than the rover's 3.0
const MIN_SPEED_FACTOR = 0.20;  // keeps climbing where the rover stalls
const BODY_RADIUS = 2.2;       // m, collision footprint (also main.js registry)
const EDGE_MARGIN = 30;
const CLEARANCE = 0.8;         // m chassis clearance
const DRAIN_SCALE = 1.5;       // heavier drain than the rover
const MOUNT_R = 4;             // m — humanoid must be this close to mount/dismount

const DEPLOY_SECS = 2.0;       // animation duration for deploy/undeploy

const _up = new THREE.Vector3(0, 1, 0);

export function createVan(site, terrain, obstacles) {
    const mesh = buildVanMesh();
    mesh.position.set(site.spawn.x + 12, 0, site.spawn.z);
    mesh.rotation.y = site.spawn.heading;

    attachUnitModel(mesh, 'van');

    let heading = site.spawn.heading;
    let atBoundary = false;
    let deployed = false;
    let deployTimer = 0;
    let deployTarget = 0;     // 0=undeployed, 1=deployed
    let driver = null;        // null = driverless, else the humanoid unit
    let deployPadId = null;   // chargepad callback identifier (set by main.js)
    let deployAnchor = null;  // tether anchor world position while deployed
    const bound = site.worldSize / 2 - EDGE_MARGIN;

    const _yawQ = new THREE.Quaternion();
    const _tiltQ = new THREE.Quaternion();

    function update(dt, input) {
        // Deploy animation: ease deployTimer toward deployTarget
        if (deployTimer !== deployTarget) {
            deployTimer += (deployTarget - deployTimer) * Math.min(1, 5 * dt);
            if (Math.abs(deployTarget - deployTimer) < 0.001) deployTimer = deployTarget;
            deployed = deployTimer > 0.99;
        }

        // Driverless: no movement. Driver must be mounted and within range.
        const canDrive = driver && !deployed;

        if (canDrive && Math.abs(input.throttle) > 0.05) {
            heading += input.steer * TURN_RATE * dt;
        }

        const normal = terrain.sampleGroundNormal(mesh.position.x, mesh.position.z);
        const slopeMag = 1 - normal.y;
        let speedFactor = Math.max(MIN_SPEED_FACTOR, 1 - slopeMag * SLOPE_K);
        const speed = canDrive ? input.throttle * VAN_SPEED * speedFactor : 0;

        let nx = mesh.position.x + Math.sin(heading) * speed * dt;
        let nz = mesh.position.z + Math.cos(heading) * speed * dt;
        atBoundary = Math.abs(nx) > bound || Math.abs(nz) > bound;
        if (atBoundary) {
            nx = THREE.MathUtils.clamp(nx, -bound, bound);
            nz = THREE.MathUtils.clamp(nz, -bound, bound);
        }
        if (!deployed) {
            const blocked = obstacles?.collides(nx, nz, BODY_RADIUS)
                && !obstacles.collides(mesh.position.x, mesh.position.z, BODY_RADIUS);
            if (!blocked) {
                mesh.position.x = nx;
                mesh.position.z = nz;
            }
        }

        const groundY = terrain.sampleGroundHeight(mesh.position.x, mesh.position.z)
            + (obstacles?.deckHeight?.(mesh.position.x, mesh.position.z) ?? 0);
        mesh.position.y = groundY + CLEARANCE;

        _tiltQuat.setFromUnitVectors(_up, normal);
        _yawQ.setFromAxisAngle(_up, heading);
        _tiltQuat.multiply(_yawQ);
        mesh.quaternion.slerp(_tiltQuat, 1 - Math.exp(-12 * dt));
    }

    function teleport(x, z) {
        mesh.position.set(x, terrain.sampleGroundHeight(x, z)
            + (obstacles?.deckHeight?.(x, z) ?? 0) + CLEARANCE, z);
    }

    function setDriver(unit) {
        driver = unit;
    }

    function deploy() {
        if (deployed || deployTarget > 0) return false;
        deployTarget = 1;
        return true;
    }

    function undeploy() {
        if (!deployed && deployTarget <= 0) return false;
        deployTarget = 0;
        return true;
    }

    return {
        mesh, update, teleport, setDriver, deploy, undeploy,
        get position() { return mesh.position; },
        get heading() { return heading; },
        get atBoundary() { return atBoundary; },
        get deployed() { return deployed; },
        get deploying() { return deployTimer > 0 && deployTimer < 1; },
        get deployTimer() { return deployTimer; },
        get driver() { return driver; },
        get drainScale() { return DRAIN_SCALE; },
        // Mobile base position: returns null if not deployed, else the van's
        // world x/z for main.js to register/remove a chargepad.
        get padPos() {
            return deployed ? { x: mesh.position.x, z: mesh.position.z } : null;
        },
    };
}

function buildVanMesh() {
    const group = new THREE.Group();
    group.name = 'van';
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x7a8b99, roughness: 0.5, metalness: 0.4 });

    const body = new THREE.Mesh(new THREE.BoxGeometry(3.0, 1.6, 5.0), bodyMat);
    body.position.y = 1.6;
    group.add(body);

    const cab = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.0, 1.8), bodyMat);
    cab.position.set(0, 2.9, 1.4);
    group.add(cab);

    const wheelGeo = new THREE.CylinderGeometry(0.5, 0.5, 0.35, 12);
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.7 });
    const wheelPositions = [
        [-1.7, 0.5, 1.8], [1.7, 0.5, 1.8],
        [-1.7, 0.5, -1.8], [1.7, 0.5, -1.8],
        [-1.7, 0.5, 0], [1.7, 0.5, 0],
    ];
    for (const [wx, wy, wz] of wheelPositions) {
        const w = new THREE.Mesh(wheelGeo, wheelMat);
        w.rotation.z = Math.PI / 2;
        w.position.set(wx, wy, wz);
        group.add(w);
    }

    return group;
}
