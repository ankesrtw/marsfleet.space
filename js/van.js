/* ============================================================
   van.js — humanoid-driven mobile base (Wave 12).

   Same terrain-follow + slope-tilt approach as rover.js, retuned:
   slower but torquier (higher slope tolerance), only the humanoid
   can drive it, and when parked it deploys as a field chargepad
   (panels out + dock ring — the visual state IS the pad state).
   ============================================================ */

import * as THREE from 'three';
import { attachUnitModel } from './models.js';

// NASA's SEV/MMSEV — the real vehicle this silhouette copies — drives
// ~10 km/h on the flat: 2.6 m/s. Slower than the rover's arcade gears,
// double a walking pace, so the "drive out and deploy" loop stays a
// commitment without being a chore.
const VAN_SPEED = 2.6;         // m/s
const TURN_RATE = 2.0;         // rad/s
const SLOPE_K = 1.5;           // torquier than the rover's 3.0
const MIN_SPEED_FACTOR = 0.20; // keeps climbing where the rover stalls
const BODY_RADIUS = 2.2;       // m, collision footprint (also main.js registry)
const EDGE_MARGIN = 30;
const CLEARANCE = 0.8;         // m chassis clearance
const DRAIN_SCALE = 1.5;       // heavier drain than the rover
const MOUNT_R = 4;             // m — humanoid must be this close to mount/dismount
const DOCK_R = 7;              // m — deployed-van charge radius (van is bulkier
                               // than a chargepad disc, so wider than DOCK_R 5)
const DEPLOY_SECS = 2.0;       // deploy/undeploy animation duration (~95% settled)

const _up = new THREE.Vector3(0, 1, 0);

export function createVan(site, terrain, obstacles) {
    const { mesh, deployRig } = buildVanMesh();
    mesh.position.set(site.spawn.x + 12, 0, site.spawn.z);
    mesh.rotation.y = site.spawn.heading;

    // A future van.glb swap clears the group's children (models.js) —
    // re-attach the deploy rig so panels/ring survive the asset landing.
    attachUnitModel(mesh, 'van', () => mesh.add(deployRig.group));

    let heading = site.spawn.heading;
    let atBoundary = false;
    let deployed = false;
    let deployTimer = 0;
    let deployTarget = 0;     // 0=undeployed, 1=deployed
    let driver = null;        // null = driverless, else the humanoid unit
    const bound = site.worldSize / 2 - EDGE_MARGIN;

    const _yawQ = new THREE.Quaternion();
    const _tiltQ = new THREE.Quaternion();

    function update(dt, input) {
        // Deploy animation: ease deployTimer toward deployTarget
        // (~95% settled in DEPLOY_SECS, same exp idiom as the tilt slerp).
        if (deployTimer !== deployTarget) {
            deployTimer += (deployTarget - deployTimer) * Math.min(1, (3 / DEPLOY_SECS) * dt);
            if (Math.abs(deployTarget - deployTimer) < 0.001) deployTimer = deployTarget;
            deployed = deployTimer > 0.95;
        }
        // Panels fold out flat as the timer rises; the dock ring fades in.
        deployRig.panelL.rotation.z = (1 - deployTimer) * (Math.PI / 2);
        deployRig.panelR.rotation.z = -(1 - deployTimer) * (Math.PI / 2);
        deployRig.ring.material.opacity = 0.55 * deployTimer;
        deployRig.ring.visible = deployTimer > 0.02;

        // Driverless: no movement. Deploying = parked (drive cuts the
        // moment the panels start out; packing up restores it).
        const canDrive = driver && deployTarget === 0 && !deployed;

        if (canDrive && Math.abs(input.throttle) > 0.05) {
            heading += input.steer * TURN_RATE * dt;
        }

        const normal = terrain.sampleGroundNormal(mesh.position.x, mesh.position.z);
        const slopeMag = 1 - normal.y;
        const speedFactor = Math.max(MIN_SPEED_FACTOR, 1 - slopeMag * SLOPE_K);
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

        _tiltQ.setFromUnitVectors(_up, normal);
        _yawQ.setFromAxisAngle(_up, heading);
        _tiltQ.multiply(_yawQ);
        mesh.quaternion.slerp(_tiltQ, 1 - Math.exp(-12 * dt));
    }

    function teleport(x, z) {
        mesh.position.set(x, terrain.sampleGroundHeight(x, z)
            + (obstacles?.deckHeight?.(x, z) ?? 0) + CLEARANCE, z);
    }

    function setDriver(unit) {
        driver = unit;
    }

    /** Flip deploy state; returns true when now deploying, false when
        packing up. One entry point so V key / HUD button cannot race
        the two separate deploy()/undeploy() guards mid-animation. */
    function toggleDeploy() {
        deployTarget = deployTarget > 0 ? 0 : 1;
        return deployTarget > 0;
    }

    return {
        mesh, update, teleport, setDriver, toggleDeploy,
        get position() { return mesh.position; },
        get heading() { return heading; },
        get atBoundary() { return atBoundary; },
        get deployed() { return deployed; },
        get deployPlanned() { return deployTarget > 0; },
        get deployTimer() { return deployTimer; },
        get driver() { return driver; },
        get drainScale() { return DRAIN_SCALE; },
        get maxSpeed() { return VAN_SPEED; },
        get mountRadius() { return MOUNT_R; },
        get dockRadius() { return DOCK_R; },
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

    // Deploy rig: solar panel wings hinged at the roof edges (folded
    // vertical when stowed, flat when deployed) + a teal dock ring at
    // the charge radius. Lives in its own sub-group so it can be
    // re-attached after a GLB swap replaces the procedural hull.
    const rigGroup = new THREE.Group();
    rigGroup.name = 'van-deploy-rig';
    const panelMat = new THREE.MeshStandardMaterial({
        color: 0x1c3a6e, roughness: 0.35, metalness: 0.55,
        side: THREE.DoubleSide,
    });
    const panelGeo = new THREE.BoxGeometry(2.4, 0.08, 4.2);
    const panelL = new THREE.Group();
    panelL.position.set(-1.5, 2.35, 0);
    const meshL = new THREE.Mesh(panelGeo, panelMat);
    meshL.position.x = -1.2; // hinge at the roof edge, wing swings outward
    panelL.add(meshL);
    const panelR = new THREE.Group();
    panelR.position.set(1.5, 2.35, 0);
    const meshR = new THREE.Mesh(panelGeo, panelMat);
    meshR.position.x = 1.2;
    panelR.add(meshR);
    // start folded (update() drives these every frame from deployTimer)
    panelL.rotation.z = Math.PI / 2;
    panelR.rotation.z = -Math.PI / 2;
    rigGroup.add(panelL, panelR);

    const ringMat = new THREE.MeshBasicMaterial({
        color: 0x2ec4d6, transparent: true, opacity: 0, side: THREE.DoubleSide,
        depthWrite: false,
    });
    const ring = new THREE.Mesh(new THREE.RingGeometry(6.55, 7.15, 40), ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = -CLEARANCE + 0.08; // mesh origin floats CLEARANCE above ground
    ring.visible = false;
    rigGroup.add(ring);
    group.add(rigGroup);

    return { mesh: group, deployRig: { group: rigGroup, panelL, panelR, ring } };
}
