/* ============================================================
   drone.js — quadcopter units (recon scout + heavy lift) with
   tilt-driven flight physics and land/take-off.

   Movement is not kinematic anymore: input sets a TARGET velocity,
   actual velocity chases it with a time constant, and the airframe
   tilts proportionally to the velocity ERROR — i.e. commanded
   acceleration. That is exactly what a real quad does (one side's
   rotors spin up, the frame banks, THEN it translates), so the
   drone visibly noses/banks into a move and levels off at speed.
   The GLBs are single fused meshes, so the bank IS the rotor-
   differential visual — individual rotor spin needs a re-export
   with separate rotor nodes.

   Travel convention matches the ground units and the chase cam:
   forward input moves along -[sin h, cos h] (W had the old drone
   flying INTO the camera).

   Land/take-off: climb input (or toggleLanding()) moves altitude-
   above-ground; touching down zeroes velocity and parks the frame
   level on the terrain. A dead battery force-lands (setPower).
   ============================================================ */

import * as THREE from 'three';
import { attachUnitModel } from './models.js';

const MAX_ALT = 60;      // m AGL ceiling
const TAU = 0.8;         // s, velocity time constant (accel feel)
const TILT_MAX = 0.32;   // rad, max nose/bank angle
const TURN_RATE = 2.0;   // rad/s

// GEAR steps multiply the real base speed (G1 = real scale). Shared by
// both drones via one localStorage key so the fleet shifts together.
const GEARS = [
    { label: 'G1', mult: 1, climb: 1, drain: 1 },
    { label: 'G2', mult: 2, climb: 1.5, drain: 1.5 },
    { label: 'G3', mult: 4, climb: 2, drain: 2.5 },
];
const GEAR_KEY = 'mc-gear-drone';

export function createDrone(site, terrain, opts = {}) {
    const {
        modelName = 'drone',
        maxSpeed = 10,      // Ingenuity's fastest recorded: 10 m/s (G1)
        climbRate = 3,      // m/s vertical (G1)
        cruiseAlt = 18,     // toggleLanding() take-off target
        spawnDx = 0,
        spawnDz = 0,
    } = opts;

    let gearIdx = Math.max(0, GEARS.findIndex((g) => g.label === localStorage.getItem(GEAR_KEY)));
    if (localStorage.getItem(GEAR_KEY) == null) gearIdx = 1; // default G2
    const speedCap = () => maxSpeed * GEARS[gearIdx].mult;

    function cycleGear() {
        gearIdx = (gearIdx + 1) % GEARS.length;
        try { localStorage.setItem(GEAR_KEY, GEARS[gearIdx].label); } catch { /* private mode */ }
        return GEARS[gearIdx].label;
    }

    const mesh = buildDroneMesh();
    mesh.rotation.order = 'YXZ'; // yaw, then motion tilts
    attachUnitModel(mesh, modelName);

    let heading = site.spawn.heading;
    let landed = true;                 // starts parked on the surface
    let alt = 0;                       // m above ground
    let autoLand = false;
    let autoTakeoffTo = null;
    let powered = true;
    let bob = 0;
    const vel = new THREE.Vector2();   // world-plane velocity (x, z)
    const targetVel = new THREE.Vector2();
    let pitchTilt = 0, rollTilt = 0;

    mesh.position.set(site.spawn.x + spawnDx, 0, site.spawn.z + spawnDz);
    mesh.position.y = terrain.sampleHeight(mesh.position.x, mesh.position.z);
    mesh.rotation.y = heading;

    function toggleLanding() {
        if (!powered) return;
        if (landed) {
            landed = false;
            autoLand = false;
            autoTakeoffTo = cruiseAlt;
        } else {
            autoLand = true;
            autoTakeoffTo = null;
        }
    }

    /** Battery hook: dead drones ignore sticks and auto-land. */
    function setPower(on) {
        powered = on;
        if (!on && !landed) { autoLand = true; autoTakeoffTo = null; }
    }

    function update(dt, input) {
        // input: { forward: -1..1, strafe: -1..1, turn: -1..1, climb: -1..1 }
        let { forward = 0, strafe = 0, turn = 0, climb = 0 } = powered ? input : {};

        // autopilot overrides for take-off / landing sequences
        if (autoTakeoffTo != null) {
            climb = 1;
            if (alt >= autoTakeoffTo) autoTakeoffTo = null;
        } else if (autoLand) {
            climb = -1;
        }

        if (landed) {
            // parked: level out, no translation; climb starts a take-off
            pitchTilt += (0 - pitchTilt) * Math.min(1, 6 * dt);
            rollTilt += (0 - rollTilt) * Math.min(1, 6 * dt);
            vel.set(0, 0);
            if (climb > 0.3) landed = false;
            mesh.position.y = terrain.sampleHeight(mesh.position.x, mesh.position.z);
            mesh.rotation.set(pitchTilt, heading, rollTilt, 'YXZ');
            return;
        }

        heading += turn * TURN_RATE * dt;
        bob += dt;

        // forward axis matches ground units: -[sin h, cos h]
        const fx = -Math.sin(heading), fz = -Math.cos(heading);
        const rx = Math.cos(heading), rz = -Math.sin(heading);
        targetVel.set(
            (fx * forward + rx * strafe) * speedCap(),
            (fz * forward + rz * strafe) * speedCap()
        );

        // velocity chases target; the ERROR is the commanded acceleration
        // and drives the tilt — bank/nose first, translate as speed builds
        const k = 1 - Math.exp(-dt / TAU);
        const errX = targetVel.x - vel.x;
        const errZ = targetVel.y - vel.y;
        vel.x += errX * k;
        vel.y += errZ * k;

        const errFwd = (errX * fx + errZ * fz) / speedCap();   // -1..1
        const errRight = (errX * rx + errZ * rz) / speedCap();
        const tk = Math.min(1, 10 * dt); // fast rotor response
        // NOSE (-Z local) must DIP into forward acceleration: rotation.x
        // positive drops the TAIL (+Z), so pitch takes the negated error —
        // the +sign here had the drone cruising nose-up, which reads as
        // "flying in reverse" from the chase cam.
        pitchTilt += (THREE.MathUtils.clamp(-errFwd, -1, 1) * TILT_MAX - pitchTilt) * tk;
        rollTilt += (THREE.MathUtils.clamp(-errRight, -1, 1) * TILT_MAX - rollTilt) * tk;

        mesh.position.x += vel.x * dt;
        mesh.position.z += vel.y * dt;

        alt = THREE.MathUtils.clamp(alt + climb * climbRate * GEARS[gearIdx].climb * dt, 0, MAX_ALT);
        const groundY = terrain.sampleHeight(mesh.position.x, mesh.position.z);
        if (alt <= 0.05 && climb < 0) {
            // touchdown
            landed = true;
            autoLand = false;
            alt = 0;
            vel.set(0, 0);
            mesh.position.y = groundY;
            mesh.rotation.set(pitchTilt, heading, rollTilt, 'YXZ');
            return;
        }
        mesh.position.y = groundY + alt + Math.sin(bob * 2) * 0.15;
        mesh.rotation.set(pitchTilt, heading, rollTilt, 'YXZ');
    }

    return {
        mesh, update, toggleLanding, setPower, cycleGear,
        get position() { return mesh.position; },
        get heading() { return heading; },
        get landed() { return landed; },
        get landing() { return autoLand; },
        get alt() { return alt; },
        get maxSpeed() { return speedCap(); },
        get gearLabel() { return GEARS[gearIdx].label; },
        get drainScale() { return GEARS[gearIdx].drain; },
    };
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
