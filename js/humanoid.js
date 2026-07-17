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
    { name: 'L_Hand', walkAmp: 0, axisIdx: 0 },
    { name: 'R_Hand', walkAmp: 0, axisIdx: 0 },
];
const PELVIS_DROP = 0.03;
const SPINE_COUNTER = 0.4;
const HEAD_LEVEL = 0.7;

// Wave 12.3 digging
const DIG_SECS = 4.5;

// Wave 12.2 foot IK: two-bone analytic IK per leg (law of cosines).
// Stance-phase feet are world-locked — the anti-skate guarantee.
const FEMUR = 0.208;
const TIBIA = 0.259;
const FOOT_SPACING = 0.12; // m — lateral offset per foot from body center
const STEP_HALF = 0.35;  // m — half-step reach in body-local space
const SWING_LIFT = 0.25; // m — foot rises this high during swing arc
const MAX_BEND = 2.3;    // rad — knee can't hyperextend past this
const USE_IK = true;     // toggle flag per plan: easy fallback to swing-only

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
    let digTimer = 0;       // seconds elapsed into the current dig (0 = idle)
    let digTargetSample = null;  // the sample being drilled
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

    // Foot IK state
    const _lPlant = new THREE.Vector3();
    const _rPlant = new THREE.Vector3();
    let lPlanted = false;
    let rPlanted = false;
    let prevLStance = false;
    let prevRStance = false;
    const _ikHip = new THREE.Vector3();
    const _ikFoot = new THREE.Vector3();
    const _ikH2F = new THREE.Vector3();
    const _ikParentInv = new THREE.Matrix4();
    const _ikThighQ = new THREE.Quaternion();
    const _ikCalfQ = new THREE.Quaternion();

    /** Two-bone analytic IK — law-of-cosines solve in the thigh bone's
        parent-local space, returning the thigh and calf quaternion
        rotations to apply on top of bind pose. Works in the forward/up
        plane (parent-local Z-forward, Y-up). */
    function solveIk(thighBone, calfBone, targetWorldX, targetWorldY, targetWorldZ) {
        const parent = thighBone.parent;
        parent.updateWorldMatrix(true, false);
        _ikParentInv.copy(parent.matrixWorld).invert();
        const hipLocal = thighBone.position.clone();

        _ikFoot.set(targetWorldX, targetWorldY, targetWorldZ);
        _ikFoot.applyMatrix4(_ikParentInv);

        const dz = _ikFoot.z - hipLocal.z;
        const dy = hipLocal.y - _ikFoot.y; // positive = foot below hip
        const R = Math.sqrt(dz * dz + dy * dy);
        const maxR = FEMUR + TIBIA;
        const minR = Math.abs(FEMUR - TIBIA);
        const r = THREE.MathUtils.clamp(R, minR, maxR);

        const a = FEMUR, b = TIBIA;
        const cosKnee = (a * a + b * b - r * r) / (2 * a * b);
        const knee = Math.acos(THREE.MathUtils.clamp(cosKnee, -1, 1));
        const calfAngle = Math.max(-MAX_BEND, Math.min(MAX_BEND, -(Math.PI - knee)));
        const hipAngle = Math.atan2(dz, dy)
            - Math.atan2(b * Math.sin(knee), a + b * Math.cos(knee));

        _ikThighQ.setFromAxisAngle(_axis, hipAngle);
        _ikCalfQ.setFromAxisAngle(_axis, calfAngle);
        return true;
    }

    function update(dt, input) {
        heading += input.steer * TURN_RATE * dt;

        if (digTimer > 0) {
            if (Math.abs(input.throttle) > 0.05) {
                digTimer = 0;
                digTargetSample = null;
            } else {
                digTimer += dt;
                if (digTimer >= DIG_SECS) digTimer = DIG_SECS;
            }
        }
        const digging = digTimer > 0;

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
        const speed = digging ? 0 : input.throttle * WALK_SPEED * speedFactor;

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

        const ikActive = USE_IK && rig && grounded && (moving || walkAmt > 0.01);
        const lStance = grounded && Math.sin(stride) < 0;
        const rStance = grounded && Math.sin(stride) > 0;

        if (ikActive) {
            if (!prevLStance && lStance) {
                _lPlant.set(
                    mesh.position.x + _fwd.x * (-STEP_HALF * 0.45),
                    mesh.position.y,
                    mesh.position.z + _fwd.z * (-STEP_HALF * 0.45)
                ).addScaledVector(_right, -FOOT_SPACING);
                _lPlant.y = terrain.sampleGroundHeight(_lPlant.x, _lPlant.z)
                    + (obstacles?.deckHeight?.(_lPlant.x, _lPlant.z) ?? 0);
                lPlanted = true;
            }
            if (!prevRStance && rStance) {
                _rPlant.set(
                    mesh.position.x + _fwd.x * (-STEP_HALF * 0.45),
                    mesh.position.y,
                    mesh.position.z + _fwd.z * (-STEP_HALF * 0.45)
                ).addScaledVector(_right, FOOT_SPACING);
                _rPlant.y = terrain.sampleGroundHeight(_rPlant.x, _rPlant.z)
                    + (obstacles?.deckHeight?.(_rPlant.x, _rPlant.z) ?? 0);
                rPlanted = true;
            }
            if (prevLStance && !lStance) lPlanted = false;
            if (prevRStance && !rStance) rPlanted = false;

            const lThigh = rig.find(j => j.name === 'L_Thigh');
            const lCalf = rig.find(j => j.name === 'L_Calf');
            if (lThigh && lCalf) {
                lThigh.bone.getWorldPosition(_ikHip);
                if (lPlanted) {
                    _lPlant.y = terrain.sampleGroundHeight(_lPlant.x, _lPlant.z)
                        + (obstacles?.deckHeight?.(_lPlant.x, _lPlant.z) ?? 0);
                    solveIk(lThigh.bone, lCalf.bone, _lPlant.x, _lPlant.y, _lPlant.z);
                } else {
                    const swingT = (Math.sin(stride) + 1) / 2; // 0→1 over swing
                    const lift = SWING_LIFT * Math.sin(swingT * Math.PI);
                    const sx = mesh.position.x + _fwd.x * (STEP_HALF * Math.cos(stride)) + _right.x * (-FOOT_SPACING);
                    const sz = mesh.position.z + _fwd.z * (STEP_HALF * Math.cos(stride)) + _right.z * (-FOOT_SPACING);
                    const sy = mesh.position.y + lift;
                    solveIk(lThigh.bone, lCalf.bone, sx, sy, sz);
                }
                lThigh.bone.quaternion.copy(lThigh.bind).multiply(_ikThighQ);
                lCalf.bone.quaternion.copy(lCalf.bind).multiply(_ikCalfQ);
            }

            const rThigh = rig.find(j => j.name === 'R_Thigh');
            const rCalf = rig.find(j => j.name === 'R_Calf');
            if (rThigh && rCalf) {
                rThigh.bone.getWorldPosition(_ikHip);
                if (rPlanted) {
                    _rPlant.y = terrain.sampleGroundHeight(_rPlant.x, _rPlant.z)
                        + (obstacles?.deckHeight?.(_rPlant.x, _rPlant.z) ?? 0);
                    solveIk(rThigh.bone, rCalf.bone, _rPlant.x, _rPlant.y, _rPlant.z);
                } else {
                    const swingT = (Math.sin(stride + Math.PI) + 1) / 2;
                    const lift = SWING_LIFT * Math.sin(swingT * Math.PI);
                    const sx = mesh.position.x + _fwd.x * (STEP_HALF * Math.cos(stride + Math.PI)) + _right.x * FOOT_SPACING;
                    const sz = mesh.position.z + _fwd.z * (STEP_HALF * Math.cos(stride + Math.PI)) + _right.z * FOOT_SPACING;
                    const sy = mesh.position.y + lift;
                    solveIk(rThigh.bone, rCalf.bone, sx, sy, sz);
                }
                rThigh.bone.quaternion.copy(rThigh.bind).multiply(_ikThighQ);
                rCalf.bone.quaternion.copy(rCalf.bind).multiply(_ikCalfQ);
            }
        }
        prevLStance = lStance;
        prevRStance = rStance;

        if (rig && walkAmt > 0.01) {
            for (const j of rig) {
                if (ikActive && (j.name === 'L_Thigh' || j.name === 'R_Thigh'
                    || j.name === 'L_Calf' || j.name === 'R_Calf')) continue;
                _swing.setFromAxisAngle(_axis, Math.sin(stride + j.phase) * j.amp * walkAmt);
                j.bone.quaternion.copy(j.bind).multiply(_swing);
            }
        }

        if (postureRig && (walkAmt > 0.01 || digging)) {
            for (const p of postureRig) {
                let angle = 0;
                if (p.name === 'Pelvis') {
                    if (digging) {
                        angle = -0.15 * Math.min(1, digTimer / (DIG_SECS * 0.3));
                    } else {
                        const drop = -PELVIS_DROP * Math.abs(Math.sin(stride)) * walkAmt;
                        const sway = p.walkAmp * Math.sin(stride) * walkAmt;
                        angle = drop + sway;
                    }
                } else if (p.name === 'Spine01') {
                    if (digging) {
                        angle = -0.45 * Math.min(1, digTimer / (DIG_SECS * 0.25));
                    } else {
                        const slerpPitch = currentPitch * (1 - Math.exp(-4 * dt));
                        angle = -slerpPitch * SPINE_COUNTER;
                    }
                } else if (p.name === 'Spine02') {
                    if (digging) {
                        angle = -0.15 * Math.min(1, digTimer / (DIG_SECS * 0.25));
                    } else {
                        const slerpPitch = currentPitch * (1 - Math.exp(-4 * dt));
                        angle = -slerpPitch * SPINE_COUNTER * 0.6;
                    }
                } else if (p.name === 'Head') {
                    if (digging) {
                        angle = 0.35 * Math.min(1, digTimer / (DIG_SECS * 0.25));
                    } else {
                        const slerpPitch = currentPitch * (1 - Math.exp(-6 * dt));
                        angle = -slerpPitch * HEAD_LEVEL;
                    }
                } else if (p.name === 'L_Hand' || p.name === 'R_Hand') {
                    if (digging) {
                        angle = 0.7 * Math.min(1, digTimer / (DIG_SECS * 0.25));
                    }
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
        tetherAnchor = null;
        lPlanted = false;
        rPlanted = false;
    }

    /** Wave 9.5: set the EVA tether anchor position (a THREE.Vector3 at
        the base/rover end), or null to detach. Called each frame from
        main.js so the anchor tracks the nearest base or rover. */
    function setTether(pos) {
        tetherAnchor = pos;
    }

    function startDig(sample) {
        if (digTimer > 0) return false;
        digTimer = 0.001;
        digTargetSample = sample;
        return true;
    }

    function cancelDig() {
        digTimer = 0;
        digTargetSample = null;
    }

    function digProgress() {
        if (digTimer <= 0) return 0;
        return Math.min(1, digTimer / DIG_SECS);
    }

    return {
        mesh, update, teleport, setTether, startDig, cancelDig, digProgress,
        get position() { return mesh.position; },
        get heading() { return heading; },
        get atBoundary() { return atBoundary; },
        get airborne() { return airY > 0; },
        get airY() { return airY; },
        get jumpVel() { return jumpVel; },
        get tetherTaut() { return tetherTaut; },
        get tetherAnchor() { return tetherAnchor; },
        get digging() { return digTimer > 0 && digTimer < DIG_SECS; },
        get digComplete() { return digTimer >= DIG_SECS; },
        get digTarget() { return digTargetSample; },
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
