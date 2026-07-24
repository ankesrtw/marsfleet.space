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
// FEMUR/TIBIA are the GLB's raw bone lengths (L_Calf and L_Foot sit at
// (0, .208, 0) and (0, .259, 0) in their parents) — model units, NOT
// metres; solveLegIk scales them up by the model's world scale.
const FEMUR = 0.208;
const TIBIA = 0.259;
const FOOT_SPACING = 0.12; // m — lateral offset per foot from body center
const STEP_HALF = 0.35;  // m — half-step reach in body-local space
const SWING_LIFT = 0.25; // m — foot rises this high during swing arc
const ANKLE_H = 0.12;    // m — ankle bone height above the sole, world scale
const USE_IK = true;     // toggle flag per plan: easy fallback to swing-only
// Both leg bones extend along their own local +Y in this rig.
const BONE_AXIS = new THREE.Vector3(0, 1, 0);

// Wave 12.4 Apollo lope: above ~0.7 m/s a normal walk is unstable at
// 0.38 g — the Apollo crews spontaneously switched to a bounding lope.
const LOPE_THRESHOLD = 0.7;   // m/s — faster than this triggers the lope
const LOPE_HOP = 0.75;        // m/s — periodic upward impulse at launch
const LOPE_ARM_AMP = 0.25;    // extra arm-swing amplitude for balance

// `obstacles` is a colliders.js facade (boulders + structures + other
// units), shaped like the old rocks collider: collides(x, z, radius).
export function createHumanoid(site, terrain, obstacles) {
    const mesh = buildHumanoidMesh();
    mesh.position.set(site.spawn.x + 5, 0, site.spawn.z);
    mesh.rotation.y = site.spawn.heading;

    // Populated once the GLB lands: [{bone, bindQuat, amp, phase}]
    let rig = null;
    let postureRig = null;
    let legs = null; // cached IK chain refs — no per-frame rig.find()
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
        const find = (n) => rig?.find((j) => j.name === n);
        const lT = find('L_Thigh'), lC = find('L_Calf');
        const rT = find('R_Thigh'), rC = find('R_Calf');
        legs = lT && lC && rT && rC ? { lT, lC, rT, rC } : null;
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
    let smoothPitch = 0;  // low-passed body pitch the spine/head lean against
    let digTimer = 0;
    let digTargetSample = null;
    let digAmt = 0;       // 0→1 cross-fade into (and back out of) the dig crouch
    let lopeFactor = 0;   // 0→1 cross-fade into bounding lope
    let lopePhase = 0;    // accumulated phase for hop timing
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
    let ikWasActive = false; // restore bind pose once when IK switches off
    const _ikTarget = new THREE.Vector3();
    const _hipW = new THREE.Vector3();
    const _kneeW = new THREE.Vector3();
    const _toFoot = new THREE.Vector3();
    const _legU = new THREE.Vector3();   // hip→foot unit vector
    const _poleW = new THREE.Vector3();  // in-plane "forward" (knee pole)
    const _femurDir = new THREE.Vector3();
    const _tibiaDir = new THREE.Vector3();
    const _scaleV = new THREE.Vector3();
    const _parentQ = new THREE.Quaternion();
    const _thighQ = new THREE.Quaternion();
    const _aimQ = new THREE.Quaternion();
    const _aimDelta = new THREE.Quaternion();
    const _aimParentInv = new THREE.Quaternion();
    const _aimDir = new THREE.Vector3();

    /** Re-aim one bone so its bone-axis points along `dir` (world), by the
        MINIMAL rotation from where bind already points. Applying the delta
        on top of the bind world pose keeps the bind twist intact, so we
        never have to know how the exporter oriented the bone's local axes. */
    function aimBone(bone, bind, parentQ, dir) {
        _aimQ.copy(parentQ).multiply(bind);              // bind pose, in world
        _aimDir.copy(BONE_AXIS).applyQuaternion(_aimQ).normalize();
        _aimDelta.setFromUnitVectors(_aimDir, dir);
        _aimQ.premultiply(_aimDelta);                    // aimed, in world
        _aimParentInv.copy(parentQ).invert();
        bone.quaternion.copy(_aimParentInv).multiply(_aimQ);
    }

    /** Two-bone IK, solved in WORLD space and applied bind-relative.

        Both leg bones extend along their own local +Y in this rig (the
        GLB's L_Calf sits at (0, .208, 0) in thigh space, L_Foot at
        (0, .259, 0) in calf space), so the solve only needs each bone's
        direction — aimBone() handles the rest without assuming anything
        about the bind frames' orientation.

        This replaces an analytic solve that computed its angles in the
        PELVIS's local frame but applied them about each BONE's local X.
        Those frames don't coincide (L_Thigh's bind is a ~180° X-flip, and
        the bind knee is already pre-bent ~0.335 rad), so the applied
        rotation was both mis-signed and offset. Worse, its hip term
        atan2(b·sin γ, a + b·cos γ) ran to ~π as the leg straightened
        (FEMUR < TIBIA makes a + b·cos γ go negative near full extension) —
        and a STANDING leg is at full extension, so every idle frame
        snapped the thigh 180° and threw the legs up over the back. */
    function solveLegIk(thighBone, calfBone, thighBind, calfBind, target) {
        const parent = thighBone.parent;
        parent.updateWorldMatrix(true, false);
        parent.getWorldQuaternion(_parentQ);
        thighBone.updateWorldMatrix(false, false);
        _hipW.setFromMatrixPosition(thighBone.matrixWorld);

        // Bone lengths are in raw model units; the model carries a uniform
        // scale from models.js, so lift them into world meters.
        const s = _scaleV.setFromMatrixScale(thighBone.matrixWorld).x || 1;
        const femur = FEMUR * s, tibia = TIBIA * s;

        _toFoot.copy(target).sub(_hipW);
        const dist = _toFoot.length();
        if (dist < 1e-5) return;
        // Stay just inside the singularities: dead-straight and fully
        // folded both make the bend plane undefined.
        const reach = THREE.MathUtils.clamp(
            dist, Math.abs(femur - tibia) + 1e-4, (femur + tibia) * 0.999);
        _legU.copy(_toFoot).divideScalar(dist);

        // Knee pole: the in-plane component of body-forward. Bending the
        // femur toward it keeps the knee leading forward — a human knee
        // cannot hinge backward, and this fixes the bend side without any
        // cross-product handedness to get wrong.
        _poleW.copy(_fwd).addScaledVector(_legU, -_fwd.dot(_legU));
        if (_poleW.lengthSq() < 1e-8) {
            _poleW.set(0, 0, 1).addScaledVector(_legU, -_legU.z);
        }
        _poleW.normalize();

        const cosBeta = THREE.MathUtils.clamp(
            (reach * reach + femur * femur - tibia * tibia) / (2 * reach * femur), -1, 1);
        const beta = Math.acos(cosBeta); // femur ∠ from the hip→foot line
        _femurDir.copy(_legU).multiplyScalar(Math.cos(beta))
            .addScaledVector(_poleW, Math.sin(beta));
        _kneeW.copy(_hipW).addScaledVector(_femurDir, femur);
        _tibiaDir.copy(target).sub(_kneeW).normalize();

        aimBone(thighBone, thighBind, _parentQ, _femurDir);
        // The calf hangs off the thigh, whose world pose we just changed.
        _thighQ.copy(_parentQ).multiply(thighBone.quaternion);
        aimBone(calfBone, calfBind, _thighQ, _tibiaDir);
    }

    function groundAt(x, z) {
        return terrain.sampleGroundHeight(x, z) + (obstacles?.deckHeight?.(x, z) ?? 0);
    }

    /** Stance plant point: a FULL step-half ahead along travel (heel
        strike at max forward reach). The lead must match the swing arc's
        ±STEP_HALF endpoints: stance travel per half-cycle is
        speed × π/STRIDE_RATE ≈ 0.73 m ≈ the 0.7 m plant-to-release span,
        so the foot stays within leg reach for the whole stance — a short
        lead ran out of reach mid-stance and the clamp dragged the boot. */
    function plantFoot(out, lateral) {
        out.set(
            mesh.position.x + _fwd.x * (-STEP_HALF),
            0,
            mesh.position.z + _fwd.z * (-STEP_HALF)
        ).addScaledVector(_right, lateral);
        out.y = groundAt(out.x, out.z);
    }

    /** Idle plant: boot settles directly under its hip. */
    function plantIdle(out, lateral) {
        out.set(mesh.position.x, 0, mesh.position.z).addScaledVector(_right, lateral);
        out.y = groundAt(out.x, out.z);
    }

    /** One leg per frame: planted feet re-sample their own ground height
        (world-locked in x/z — the anti-skate guarantee); swing feet arc
        between plant points over terrain-following base height. */
    function solveLeg(thigh, calf, planted, plant, phase, lateral) {
        if (planted) {
            plant.y = groundAt(plant.x, plant.z);
            _ikTarget.copy(plant);
        } else {
            const swingT = (Math.sin(stride + phase) + 1) / 2; // 0→1 over swing
            const lift = SWING_LIFT * Math.sin(swingT * Math.PI);
            const sx = mesh.position.x + _fwd.x * (STEP_HALF * Math.cos(stride + phase)) + _right.x * lateral;
            const sz = mesh.position.z + _fwd.z * (STEP_HALF * Math.cos(stride + phase)) + _right.z * lateral;
            _ikTarget.set(sx, groundAt(sx, sz) + lift, sz);
        }
        // Plant points are SOLE positions but the IK drives the ankle bone,
        // which rides ANKLE_H above the sole — without this the boots sink.
        _ikTarget.y += ANKLE_H;
        solveLegIk(thigh.bone, calf.bone, thigh.bind, calf.bind, _ikTarget);
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
        // Crouch cross-fade: ramps in over ~0.3s when the drill starts and
        // — crucially — back OUT after it ends. (The old per-bone
        // min(1, digTimer/…) ramps froze the crouch on the rig forever if
        // the dig ended while standing still, because the posture loop
        // stopped running the moment walkAmt hit 0.)
        digAmt += ((digging ? 1 : 0) - digAmt) * Math.min(1, 5 * dt);

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
        const moving = (grounded || (lopeFactor > 0.3 && airY > 0))
            && Math.abs(input.throttle) > 0.05;
        if (moving) stride += dt * STRIDE_RATE * Math.abs(speed) / WALK_SPEED;
        // Wave 12.4 Apollo lope: at speed the gait cross-fades to a bounding
        // lope — both feet leave the ground together, longer float, arms out.
        const lopeTarget = moving && Math.abs(speed) > LOPE_THRESHOLD ? 1 : 0;
        lopeFactor += (lopeTarget - lopeFactor) * Math.min(1, 4 * dt);
        if (lopeFactor > 0.01) {
            lopePhase += dt * STRIDE_RATE * 0.5 * lopeFactor;
            // Periodic hop: launch when the stride is at push-off and airborne
            if (Math.sin(lopePhase * 1.8) > 0.85 && airY <= 0 && jumpVel === 0) {
                jumpVel = LOPE_HOP * lopeFactor;
            }
            // During lope, stride drifts (legs stay more extended in flight)
            stride += dt * STRIDE_RATE * (-0.4 * lopeFactor) * Math.abs(speed) / WALK_SPEED;
        }
        walkAmt += ((moving ? 1 : 0) - walkAmt) * Math.min(1, 8 * dt);
        _fwd.set(Math.sin(heading), 0, Math.cos(heading));
        _right.set(-Math.cos(heading), 0, Math.sin(heading));
        let pitch = THREE.MathUtils.clamp(normal.dot(_fwd) * PITCH_GAIN, -MAX_TILT, MAX_TILT);
        let roll = THREE.MathUtils.clamp(normal.dot(_right) * ROLL_GAIN, -MAX_TILT, MAX_TILT);
        if (airY > 0) {
            const decay = Math.exp(-3 * dt);
            pitch *= decay;
            roll *= decay;
        }
        currentPitch = pitch;
        // Low-passed copy the spine/head lean against. (The old inline
        // `pitch * (1 - exp(-4dt))` had no state to accumulate into, so it
        // ATTENUATED to ~6% instead of smoothing — the counter-lean was
        // invisibly small.)
        smoothPitch += (currentPitch - smoothPitch) * (1 - Math.exp(-4 * dt));
        _yawQ.setFromAxisAngle(_up, heading);
        _pitchQ.setFromAxisAngle(_right, -pitch);
        _rollQ.setFromAxisAngle(_fwd, -roll);
        _tiltQ.copy(_yawQ).multiply(_pitchQ).multiply(_rollQ);
        mesh.quaternion.slerp(_tiltQ, 1 - Math.exp(-12 * dt));
        mesh.position.y += Math.abs(Math.sin(stride)) * 0.06 * walkAmt;

        // ---- Rig animation, in dependency order: arm/leg swing first,
        // then the posture chain (pelvis sway moves the hip sockets), then
        // leg IK LAST so the solve sees this frame's final pelvis pose.
        const ikActive = USE_IK && !!legs && grounded;
        const lStance = grounded && Math.sin(stride) < 0;
        const rStance = grounded && Math.sin(stride) > 0;

        if (rig && walkAmt > 0.01) {
            for (const j of rig) {
                if (ikActive && (j.name === 'L_Thigh' || j.name === 'R_Thigh'
                    || j.name === 'L_Calf' || j.name === 'R_Calf')) continue;
                const baseAmp = (j.name === 'L_Upperarm' || j.name === 'R_Upperarm'
                    || j.name === 'L_Forearm' || j.name === 'R_Forearm')
                    ? j.amp * (1 + lopeFactor * LOPE_ARM_AMP / 0.35) : j.amp;
                _swing.setFromAxisAngle(_axis, Math.sin(stride + j.phase) * baseAmp * walkAmt);
                j.bone.quaternion.copy(j.bind).multiply(_swing);
            }
        }

        // Posture chain: weight shift while walking, slope counter-lean
        // (live even standing still on a grade), dig crouch cross-fade.
        if (postureRig && (walkAmt > 0.005 || digAmt > 0.005
            || Math.abs(smoothPitch) > 0.002)) {
            for (const p of postureRig) {
                let walkAngle = 0, digAngle = 0;
                if (p.name === 'Pelvis') {
                    const drop = -PELVIS_DROP * Math.abs(Math.sin(stride)) * walkAmt;
                    const sway = p.walkAmp * Math.sin(stride) * walkAmt;
                    walkAngle = drop + sway;
                    digAngle = -0.15;
                } else if (p.name === 'Spine01') {
                    walkAngle = -smoothPitch * SPINE_COUNTER;
                    digAngle = -0.45;
                } else if (p.name === 'Spine02') {
                    walkAngle = -smoothPitch * SPINE_COUNTER * 0.6;
                    digAngle = -0.15;
                } else if (p.name === 'Head') {
                    walkAngle = -smoothPitch * HEAD_LEVEL;
                    digAngle = 0.35;
                } else if (p.name === 'L_Hand' || p.name === 'R_Hand') {
                    digAngle = 0.7;
                }
                const angle = walkAngle * (1 - digAmt) + digAngle * digAmt;
                _postureQ.setFromAxisAngle(_postureAxes[p.axisIdx], angle);
                p.bone.quaternion.copy(p.bind).multiply(_postureQ);
            }
        }

        if (ikActive) {
            if (moving) {
                // Heel-strike: world-lock the foot at its plant point for
                // the whole stance phase — the mechanical anti-skate.
                if (!prevLStance && lStance) { plantFoot(_lPlant, -FOOT_SPACING); lPlanted = true; }
                if (!prevRStance && rStance) { plantFoot(_rPlant, FOOT_SPACING); rPlanted = true; }
                if (prevLStance && !lStance) lPlanted = false;
                if (prevRStance && !rStance) rPlanted = false;
            } else {
                // Idle (or pivoting in place): both boots settle flat onto
                // their own patch of ground under the hips — no foot left
                // frozen mid-swing when the walk stops.
                const turning = Math.abs(input.steer) > 0.05;
                if (!lPlanted || turning) { plantIdle(_lPlant, -FOOT_SPACING); lPlanted = true; }
                if (!rPlanted || turning) { plantIdle(_rPlant, FOOT_SPACING); rPlanted = true; }
            }
            solveLeg(legs.lT, legs.lC, lPlanted, _lPlant, 0, -FOOT_SPACING);
            solveLeg(legs.rT, legs.rC, rPlanted, _rPlant, Math.PI, FOOT_SPACING);
            ikWasActive = true;
        } else {
            // Airborne / IK off: the legs return to the swing cycle. Restore
            // bind once so a jump from standstill doesn't freeze the last
            // solved pose on the rig for the whole flight.
            if (ikWasActive && legs) {
                legs.lT.bone.quaternion.copy(legs.lT.bind);
                legs.lC.bone.quaternion.copy(legs.lC.bind);
                legs.rT.bone.quaternion.copy(legs.rT.bind);
                legs.rC.bone.quaternion.copy(legs.rC.bind);
            }
            ikWasActive = false;
            lPlanted = false;
            rPlanted = false;
        }
        prevLStance = lStance;
        prevRStance = rStance;
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
