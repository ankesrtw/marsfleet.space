/* ============================================================
   drone.js — quadcopter units (recon scout + heavy lift) with
   tilt-driven flight physics and land/take-off.

   Movement is not kinematic anymore: input sets a TARGET velocity,
   actual velocity chases it with a time constant, and the airframe
   tilts proportionally to the velocity ERROR — i.e. commanded
   acceleration. That is exactly what a real quad does (one side's
   rotors spin up, the frame banks, THEN it translates), so the
   drone visibly noses/banks into a move and levels off at speed.
   The GLBs are single fused meshes (no separate rotor nodes), so
   rotor spin comes from the rotors.js overlay rig: spinning blade
   + blur-disc sets at box-derived hub positions, spooling with
   take-off/landing/load. The bank remains the rotor-differential
   visual.

   Travel convention matches the ground units and the chase cam:
   forward input moves along -[sin h, cos h] (W had the old drone
   flying INTO the camera).

   Land/take-off: climb input (or toggleLanding()) moves altitude-
   above-ground; touching down zeroes velocity and parks the frame
   level on the terrain. A dead battery FALLS (setPower -> Wave 9 gravity).
   ============================================================ */

import * as THREE from 'three';
import { GRAVITY_MARS } from './physics.js';
import { attachUnitModel } from './models.js';
import { createRotorRig, hubsFromSize } from './rotors.js';

const MAX_ALT = 150;     // m AGL ceiling (HUD altitude slider spans 0..this)
const TAU = 0.8;         // s, velocity time constant (accel feel)
const TILT_MAX = 0.32;   // rad, max nose/bank angle
const TURN_RATE = 2.0;   // rad/s
const EDGE_MARGIN = 30;  // m inside the DEM edge — the mission boundary

// GEAR steps multiply the real base speed (G1 = real scale). Shared by
// both drones via one localStorage key so the fleet shifts together.
const GEARS = [
    { label: 'G1', mult: 1, climb: 1, drain: 1 },
    { label: 'G2', mult: 2, climb: 1.5, drain: 1.5 },
    { label: 'G3', mult: 4, climb: 2, drain: 2.5 },
];
const GEAR_KEY = 'mc-gear-drone';

// Sling-load handicaps (lift drone with a cache container on the hook):
// slower, weaker climb, hungrier — carrying should feel like work.
const SLING_SPEED = 0.6;
const SLING_CLIMB = 0.7;
const SLING_DRAIN = 1.35;   // laden endurance ~25-30% lower, not halved

// Wave 6 wind: the ONE deliberately unreal constant in the wind chain.
// Mars air is ~1/100 Earth density — a real 20 m/s storm pushes like a
// 2 m/s Earth breeze, and a faithful sim would be imperceptible. The
// wind facade reports REAL m/s (MEDA-grounded, HUD shows them); this
// factor scales how much of it becomes drift, so a storm-peak gust
// drifts a hovering drone ~7 m/s — felt, counter-steerable (Ingenuity's
// real control law: tilt INTO the wind), never uncontrollable. Same
// readability-over-realism choice as the ~20% unit-scale bump.
const WIND_PUSH = 0.35;

export function createDrone(site, terrain, opts = {}) {
    const {
        modelName = 'drone',
        maxSpeed = 10,      // Ingenuity's fastest recorded: 10 m/s (G1)
        climbRate = 3,      // m/s vertical (G1)
        cruiseAlt = 18,     // toggleLanding() take-off target
        spawnDx = 0,
        spawnDz = 0,
        canSling = false,   // lift drone only — see lab.js
        obstacles = null,   // colliders.js forUnit facade (alt-aware)
        bodyRadius = 0.9,   // m, horizontal collision footprint
        wind = null,        // main.js wind facade: sample(x, z) -> {vx, vz} m/s
    } = opts;

    let gearIdx = Math.max(0, GEARS.findIndex((g) => g.label === localStorage.getItem(GEAR_KEY)));
    if (localStorage.getItem(GEAR_KEY) == null) gearIdx = 1; // default G2
    let slung = false;
    const speedCap = () => maxSpeed * GEARS[gearIdx].mult * (slung ? SLING_SPEED : 1);

    function cycleGear() {
        gearIdx = (gearIdx + 1) % GEARS.length;
        try { localStorage.setItem(GEAR_KEY, GEARS[gearIdx].label); } catch { /* private mode */ }
        return GEARS[gearIdx].label;
    }

    const mesh = buildDroneMesh();
    mesh.rotation.order = 'YXZ'; // yaw, then motion tilts

    // Spinning-rotor overlay (rotors.js): laid out for the procedural
    // fallback now, re-laid from the GLB's bounds when it arrives —
    // attachUnitModel clears the group, so the rig re-adds itself.
    const rig = createRotorRig();
    rig.layout([[0.8, 0.18, 0], [-0.8, 0.18, 0], [0, 0.18, 0.8], [0, 0.18, -0.8]], 0.28);
    mesh.add(rig.group);
    attachUnitModel(mesh, modelName, (_model, size) => {
        const { hubs, radius } = hubsFromSize(size);
        rig.layout(hubs, radius);
        mesh.add(rig.group);
    });

    let heading = site.spawn.heading;
    let landed = true;                 // starts parked on the surface
    let alt = 0;                       // m above ground
    let windDrift = 0;                 // m/s felt drift, for HUD/E2E
    let autoLand = false;
    let autoTakeoffTo = null;
    let powered = true;
    let falling = false;        // un-powered in the air: Mars has it
    let fallVel = 0;            // m/s downward, integrated against GRAVITY_MARS
    let impactSpeed = 0;        // m/s at touchdown — consumed by main.js
    let bob = 0;
    let atBoundary = false;
    const bound = site.worldSize / 2 - EDGE_MARGIN;
    const vel = new THREE.Vector2();   // world-plane velocity (x, z)
    const targetVel = new THREE.Vector2();
    let pitchTilt = 0, rollTilt = 0;

    mesh.position.set(site.spawn.x + spawnDx, 0, site.spawn.z + spawnDz);
    mesh.position.y = terrain.sampleHeight(mesh.position.x, mesh.position.z);
    mesh.rotation.y = heading;

    // HUD altitude-slider autopilot target (m AGL); null = manual.
    let altTarget = null;

    function toggleLanding() {
        if (!powered) return;
        altTarget = null;
        if (landed) {
            landed = false;
            autoLand = false;
            autoTakeoffTo = cruiseAlt;
        } else {
            autoLand = true;
            autoTakeoffTo = null;
        }
    }

    /** HUD slider: fly to `t` m AGL (0..MAX_ALT). Dragging to the floor
        lands; dragging up from LANDED takes off — one control covers the
        whole vertical envelope. Manual climb input cancels it. */
    function commandAlt(t) {
        if (!powered) return;
        t = THREE.MathUtils.clamp(t, 0, MAX_ALT);
        autoTakeoffTo = null;
        if (t <= 0.5) {
            altTarget = null;
            if (!landed) autoLand = true;
            return;
        }
        autoLand = false;
        altTarget = t;
        if (landed) landed = false;
    }

    /** Wave 9: losing power mid-air is a FALL, not a landing. The old path
        set autoLand, which walked the drone down at a constant, dignified
        climb rate — rotors dead, still descending like an elevator. Now the
        rotors quit and Mars takes it. */
    function setPower(on) {
        powered = on;
        if (!on && !landed) {
            falling = true;
            autoLand = false;
            autoTakeoffTo = null;
            altTarget = null;
        }
        if (on && falling) { falling = false; fallVel = 0; }   // rotors catch it
    }

    function update(dt, input) {
        // input: { forward: -1..1, strafe: -1..1, turn: -1..1, climb: -1..1 }
        let { forward = 0, strafe = 0, turn = 0, climb = 0 } = powered ? input : {};

        // manual climb input takes the stick back from the slider target
        if (Math.abs(climb) > 0.05) altTarget = null;

        // autopilot overrides for take-off / landing / slider-alt sequences
        if (autoTakeoffTo != null) {
            climb = 1;
            if (alt >= autoTakeoffTo) autoTakeoffTo = null;
        } else if (autoLand) {
            climb = -1;
        } else if (altTarget != null) {
            // proportional approach, full rate until ~2m out then eased
            const err = altTarget - alt;
            if (Math.abs(err) < 0.15) {
                altTarget = null;
            } else {
                climb = THREE.MathUtils.clamp(err / 2, -1, 1);
            }
        }

        if (landed) {
            atBoundary = false;
            windDrift = 0; // parked frames sit out the wind (real: tie-down mass)
            // parked: level out, no translation; climb starts a take-off
            pitchTilt += (0 - pitchTilt) * Math.min(1, 6 * dt);
            rollTilt += (0 - rollTilt) * Math.min(1, 6 * dt);
            vel.set(0, 0);
            if (climb > 0.3) landed = false;
            mesh.position.y = terrain.sampleHeight(mesh.position.x, mesh.position.z);
            mesh.rotation.set(pitchTilt, heading, rollTilt, 'YXZ');
            // rotors: spool up when a take-off is pending, else spin down
            rig.update(dt, autoTakeoffTo != null || climb > 0.3 ? 0.9 : 0);
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

        // Wind drift (Wave 6): the facade reports real m/s; WIND_PUSH
        // converts to felt drift. Drift is positional, not a vel change —
        // the tilt rig only ever shows COMMANDED acceleration, so a gust
        // slides a level drone sideways until the player banks against
        // it, exactly the Ingenuity picture.
        let wx = 0, wz = 0;
        if (wind) {
            const w = wind.sample(mesh.position.x, mesh.position.z);
            wx = w.vx * WIND_PUSH;
            wz = w.vz * WIND_PUSH;
        }
        windDrift = Math.hypot(wx, wz);

        // Blocked-entry horizontal collision (same escape rule as the
        // ground units): structures/units gate by altitude band inside
        // the colliders facade, so cruise height overflies everything.
        let nx = mesh.position.x + (vel.x + wx) * dt;
        let nz = mesh.position.z + (vel.y + wz) * dt;
        // Mission boundary: clamp per axis, kill that axis' velocity so
        // the frame can still slide along the edge; flag for the HUD.
        atBoundary = Math.abs(nx) > bound || Math.abs(nz) > bound;
        if (Math.abs(nx) > bound) { nx = THREE.MathUtils.clamp(nx, -bound, bound); vel.x = 0; }
        if (Math.abs(nz) > bound) { nz = THREE.MathUtils.clamp(nz, -bound, bound); vel.y = 0; }
        const blocked = obstacles?.collides(nx, nz, bodyRadius)
            && !obstacles.collides(mesh.position.x, mesh.position.z, bodyRadius);
        if (blocked) {
            vel.set(0, 0);
        } else {
            mesh.position.x = nx;
            mesh.position.z = nz;
        }

        if (falling) {
            // Dead rotors: accelerate downward at Mars g. The drop is slow to
            // start and then RUNS AWAY — that acceleration is the whole tell
            // that this is a fall and not the old constant-rate descent.
            fallVel += GRAVITY_MARS * dt;
            alt = Math.max(0, alt - fallVel * dt);
        } else {
            alt = THREE.MathUtils.clamp(
                alt + climb * climbRate * GEARS[gearIdx].climb * (slung ? SLING_CLIMB : 1) * dt,
                0, MAX_ALT
            );
        }
        const groundY = terrain.sampleHeight(mesh.position.x, mesh.position.z);
        if (alt <= 0.05 && (climb < 0 || falling)) {
            // touchdown (or arrival)
            if (falling) {
                impactSpeed = fallVel;   // main.js reads this for the crunch
                falling = false;
                fallVel = 0;
            }
            landed = true;
            autoLand = false;
            alt = 0;
            vel.set(0, 0);
            mesh.position.y = groundY;
            mesh.rotation.set(pitchTilt, heading, rollTilt, 'YXZ');
            rig.update(dt, 0);
            return;
        }
        mesh.position.y = groundY + alt + (falling ? 0 : Math.sin(bob * 2) * 0.15);
        mesh.rotation.set(pitchTilt, heading, rollTilt, 'YXZ');

        // airborne rotor effort: hover floor + speed/climb load. A falling
        // drone has no rotor effort at all — that is why it is falling.
        rig.update(dt, falling ? 0 : Math.min(1,
            0.55 + 0.45 * (vel.length() / speedCap()) + 0.2 * Math.abs(climb)));
    }

    /** lab.js sling hook — only the lift drone is built with canSling. */
    function setSlung(on) {
        slung = !!on;
    }

    /** Consume-on-read: main.js polls this to fire the impact cue once. */
    function popImpact() {
        const v = impactSpeed;
        impactSpeed = 0;
        return v;
    }

    return {
        mesh, update, toggleLanding, setPower, cycleGear, setSlung, canSling, commandAlt,
        popImpact,
        get position() { return mesh.position; },
        get falling() { return falling; },
        get fallSpeed() { return fallVel; },
        get heading() { return heading; },
        get atBoundary() { return atBoundary; },
        get landed() { return landed; },
        get landing() { return autoLand; },
        get alt() { return alt; },
        get altTarget() { return altTarget; },
        get ceiling() { return MAX_ALT; },
        get slung() { return slung; },
        get windDrift() { return windDrift; }, // m/s felt drift (0 landed/calm)
        get maxSpeed() { return speedCap(); },
        get gearLabel() { return GEARS[gearIdx].label; },
        get drainScale() { return GEARS[gearIdx].drain * (slung ? SLING_DRAIN : 1); },
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

    // (no static rotor discs here — the spinning rotor rig from rotors.js
    // is laid out on these same arm tips by createDrone)

    return group;
}
