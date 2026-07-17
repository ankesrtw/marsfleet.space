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

const WALK_SPEED = 1.4;
const TURN_RATE = 2.4;
const SLOPE_K = 0.8;
const MIN_SPEED_FACTOR = 0.3;
const BODY_RADIUS = 0.35;
const EDGE_MARGIN = 30;

// Wave 12 slope tilt — a biped stays gravity-vertical, not glued to terrain.
// Pitch: lean into climbs / brace back on descents. Roll: small lateral lean.
const PITCH_GAIN = 0.5;
const ROLL_GAIN = 0.15;
const MAX_TILT = 0.35;

// Wave 12.1 foot skate: cadence scales with actual ground speed, so a slow
// climb at 30% speedFactor doesn't pump legs at 100% cadence.
const STRIDE_RATE = 6;

// Wave 9.5: EVA safety tether. Beyond TETHER_LENGTH the humanoid's max
// speed is clamped (the suit drags the line), simulating a taut tether
// without actual physics constraint.
const TETHER_LENGTH = 80; // m — generous, keeps the tether cosmetic most of the time
const TETHER_DROP_FACTOR = 0.3; // speed multiplier when fully beyond length

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

// Wave 12.3 posture chain — bones that respond to slope + walk rhythm
// rather than the pure swing cycle. axis: 0=X (pitch), 1=Y (yaw), 2=Z (roll).
const POSTURE_BONES = [
    { name: 'Pelvis', walkAmp: 0.04, axisIdx: 2 },
    { name: 'Spine01', walkAmp: 0, axisIdx: 0 },
    { name: 'Spine02', walkAmp: 0, axisIdx: 0 },
    { name: 'Head', walkAmp: 0, axisIdx: 0 },
];
const PELVIS_DROP = 0.03;
const SPINE_COUNTER = 0.4;
const HEAD_LEVEL = 0.7;

// `obstacles` is a colliders.js facade (boulders + structures + other
// units), shaped like the old rocks collider: collides(x, z, radius).
export function createHumanoid(site, terrain, obstacles) {
    const mesh = buildHumanoidMesh();
    mesh.position.set(site.spawn.x + 5, 0, site.spawn.z);
    mesh.rotation.y = site.spawn.heading;

    // Populated once the GLB lands: [{bone, bindQuat, amp, phase}]
    let rig = null;
    let postureRig = null;
    attachUnitModel(mesh, 'humanoid', (model) => {
        rig = [];
        for (const cfg of WALK_BONES) {
            const bone = model.getObjectByName(cfg.name);
            if (bone) rig.push({ bone, bind: bone.quaternion.clone(), ...cfg });
        }
        if (!rig.length) rig = null;
        postureRig = [];
        for (const cfg of POSTURE_BONES) {
            const bone = model.getObjectByName(cfg.name);
            if (bone) postureRig.push({ bone, bind: bone.quaternion.clone(), ...cfg });
        }
        if (!postureRig.length) postureRig = null;
    });

    let heading = site.spawn.heading;
    let stride = 0;
    let airY = 0;
    let jumpVel = 0;
    let walkAmt = 0;
    let atBoundary = false;
    let tetherAnchor = null;
    let tetherTaut = false;
    let currentPitch = 0;
    const _tetherVec = new THREE.Vector3();
    const bound = site.worldSize / 2 - EDGE_MARGIN;

    const _swing = new THREE.Quaternion();
    const _axis = new THREE.Vector3(1, 0, 0);
    const _postureQ = new THREE.Quaternion();
    const _postureAxes = [
        new THREE.Vector3(1, 0, 0),  // X — pitch (spine/head forward-back)
        new THREE.Vector3(0, 1, 0),  // Y — yaw
        new THREE.Vector3(0, 0, 1),  // Z — roll (pelvis lateral sway)
    ];
    const _up = new THREE.Vector3(0, 1, 0);
    const _fwd = new THREE.Vector3();
    const _right = new THREE.Vector3();
    const _yawQ = new THREE.Quaternion();
    const _pitchQ = new THREE.Quaternion();
    const _rollQ = new THREE.Quaternion();
    const _tiltQ = new THREE.Quaternion();

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
        let speedFactor = Math.max(MIN_SPEED_FACTOR, 1 - slopeMag * SLOPE_K);
        // Wave 9.5: tether tension — beyond TETHER_LENGTH, the suit drags
        // the line and speed falls off rapidly.
        tetherTaut = false;
        if (tetherAnchor) {
            const dist = _tetherVec.copy(mesh.position).distanceTo(tetherAnchor);
            if (dist > TETHER_LENGTH) {
                const overage = (dist - TETHER_LENGTH) / TETHER_LENGTH;
                speedFactor *= Math.max(TETHER_DROP_FACTOR, 1 - overage);
                tetherTaut = true;
            }
        }
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
        // a falling model while its boots are on the ground). Deck height
        // (colliders.js) puts the boots ON chargepad decks / the lab pad.
        const groundY = terrain.sampleGroundHeight(mesh.position.x, mesh.position.z)
            + (obstacles?.deckHeight?.(mesh.position.x, mesh.position.z) ?? 0);
        if (jumpVel !== 0 || airY > 0) {
            jumpVel -= GRAVITY_MARS * dt;
            airY += jumpVel * dt;
            if (airY <= 0) { airY = 0; jumpVel = 0; }   // touchdown
        }
        mesh.position.y = groundY + airY;

        // Airborne = no walk cycle (legs stop pumping mid-flight).
        const grounded = airY <= 0;
        const moving = grounded && Math.abs(input.throttle) > 0.05;
        if (moving) stride += dt * STRIDE_RATE * Math.abs(speed) / WALK_SPEED;
        walkAmt += ((moving ? 1 : 0) - walkAmt) * Math.min(1, 8 * dt);
        _fwd.set(Math.sin(heading), 0, Math.cos(heading));
        _right.set(-Math.cos(heading), 0, Math.sin(heading));
        let pitch = THREE.MathUtils.clamp(normal.dot(_fwd) * PITCH_GAIN, -MAX_TILT, MAX_TILT);
        let roll = THREE.MathUtils.clamp(normal.dot(_right) * ROLL_GAIN, -MAX_TILT, MAX_TILT);
        currentPitch = pitch;
        if (airY > 0) {
            const decay = Math.exp(-3 * dt);
            pitch *= decay;
            roll *= decay;
        }
        _yawQ.setFromAxisAngle(_up, heading);
        _pitchQ.setFromAxisAngle(_right, -pitch);
        _rollQ.setFromAxisAngle(_fwd, -roll);
        _tiltQ.copy(_yawQ).multiply(_pitchQ).multiply(_rollQ);
        mesh.quaternion.slerp(_tiltQ, 1 - Math.exp(-12 * dt));
        mesh.position.y += Math.abs(Math.sin(stride)) * 0.06 * walkAmt;

        if (rig && walkAmt > 0.01) {
            for (const j of rig) {
                _swing.setFromAxisAngle(_axis, Math.sin(stride + j.phase) * j.amp * walkAmt);
                j.bone.quaternion.copy(j.bind).multiply(_swing);
            }
        }

        if (postureRig && walkAmt > 0.01) {
            for (const p of postureRig) {
                let angle = 0;
                if (p.name === 'Pelvis') {
                    const drop = -PELVIS_DROP * Math.abs(Math.sin(stride)) * walkAmt;
                    const sway = p.walkAmp * Math.sin(stride) * walkAmt;
                    angle = drop + sway;
                } else if (p.name === 'Spine01' || p.name === 'Spine02') {
                    const slerpPitch = currentPitch * (1 - Math.exp(-4 * dt));
                    angle = -slerpPitch * SPINE_COUNTER;
                } else if (p.name === 'Head') {
                    const slerpPitch = currentPitch * (1 - Math.exp(-6 * dt));
                    angle = -slerpPitch * HEAD_LEVEL;
                }
                _postureQ.setFromAxisAngle(_postureAxes[p.axisIdx], angle);
                p.bone.quaternion.copy(p.bind).multiply(_postureQ);
            }
        }
    }

    /** Wave 9.3 base travel: boots down on the new ground, jump arc cleared. */
    function teleport(x, z) {
        mesh.position.set(x, terrain.sampleGroundHeight(x, z)
            + (obstacles?.deckHeight?.(x, z) ?? 0), z);
        airY = 0;
        jumpVel = 0;
        tetherAnchor = null; // teleport detaches the tether
    }

    /** Wave 9.5: set the EVA tether anchor position (a THREE.Vector3 at
        the base/rover end), or null to detach. Called each frame from
        main.js so the anchor tracks the nearest base or rover. */
    function setTether(pos) {
        tetherAnchor = pos;
    }

    return {
        mesh, update, teleport, setTether,
        get position() { return mesh.position; },
        get heading() { return heading; },
        get atBoundary() { return atBoundary; },
        get airborne() { return airY > 0; },
        get airY() { return airY; },          // m above ground (jump arc)
        get jumpVel() { return jumpVel; },
        get tetherTaut() { return tetherTaut; },
        get tetherAnchor() { return tetherAnchor; },
        // Tether attachment point on the humanoid: shoulder height (~1.5m)
        get tetherPoint() {
            return new THREE.Vector3(mesh.position.x, mesh.position.y + 1.5, mesh.position.z);
        },
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
