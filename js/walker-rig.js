/* ============================================================
   walker-rig.js — shared legged-robot locomotion (plan 24).

   One rig engine for every multi-leg walker (Ongak quad,
   Makadane octopod). Generalizes the humanoid's Wave 12.2 foot-IK
   from 2 hardcoded bone legs to an N-entry leg array on a
   PROCEDURAL articulated chain (hip yaw → femur pitch → tibia
   pitch), so no GLB/bone pipeline is involved at all.

   Inherited guarantees from humanoid.js (same idioms on purpose):
   - Stance feet are WORLD-LOCKED at their plant point (anti-skate).
   - Plant lead == swing-arc endpoint (−stepHalf along _fwd) — the
     Wave 12 lesson: any other lead runs out of reach mid-stance.
   - Cadence scales with actual ground speed (no leg-pumping on a
     slow uphill crawl).
   - Planted feet re-sample their own ground height every frame.

   What is NEW here vs the humanoid:
   - 3-DOF legs: an optional coxa YAW joint before the 2-bone
     planar solve. Radially-mounted legs (octopod) sweep fore-aft
     through that yaw — exactly how hexapod robots do it — while
     sagittal legs (quad) skip it and solve in their own plane.
   - The body TILTS WITH THE TERRAIN (sampleGroundNormal), where
     the biped deliberately stays gravity-vertical. Slope-hugging
     is the legged-robot read.
   - No jump / lope / dig / tether — walkers are slow, sure-footed
     platforms; that division of labor is the fleet role.
   ============================================================ */

import * as THREE from 'three';

const EDGE_MARGIN = 30;

/** Shared walker material set. Per-unit `livery` lets each walker carry its
    own identity instead of looking identically procedural (plan 26 polish):
      livery = { panel, accent, glow }  (hex colours, all optional)
    Defaults = the plan-24 reference livery (white panels + burnt-orange).
    Lower roughness / higher metalness than the originals gives crisper spec
    highlights (reads far less flat), and the emissive `lens`/`glow` pair is
    the "alive" tech accent — glowing sensor eyes + trim strips. One instance
    per unit, shared across its meshes (draw-call sanity on the 2-core box). */
export function walkerMaterials(livery = {}) {
    const accent = livery.accent ?? 0xc96f2e;
    const glow = livery.glow ?? 0x2288ff;
    return {
        panel: new THREE.MeshStandardMaterial({ color: livery.panel ?? 0xe0ddd4, roughness: 0.42, metalness: 0.28 }),
        accent: new THREE.MeshStandardMaterial({ color: accent, roughness: 0.38, metalness: 0.38 }),
        joint: new THREE.MeshStandardMaterial({ color: 0x34373b, roughness: 0.28, metalness: 0.88 }),
        actuator: new THREE.MeshStandardMaterial({ color: 0xb98f4c, roughness: 0.3, metalness: 0.95 }),
        dark: new THREE.MeshStandardMaterial({ color: 0x16171a, roughness: 0.5, metalness: 0.45 }),
        // glowing stereo-camera lens (bright) + emissive trim strips (softer)
        lens: new THREE.MeshStandardMaterial({
            color: 0x080b10, roughness: 0.22, metalness: 0.2,
            emissive: glow, emissiveIntensity: 1.7,
        }),
        glow: new THREE.MeshStandardMaterial({
            color: 0x0a0d12, roughness: 0.4, metalness: 0.3,
            emissive: glow, emissiveIntensity: 1.15,
        }),
    };
}

/** Build one leg chain: hipMount (fixed, caller-oriented) → coxa
    (yaw joint) → femur (pitch) → tibia (pitch) → footTip anchor.
    Geometries are passed in shared (one set per unit, reused by
    every leg). Femur/tibia boxes extend along local −Y so a zero
    pose hangs straight down and the solver's angle convention
    (θ from straight-down, toward hip-local +Z) maps to plain
    rotation.x = −θ on each joint.                              */
function buildLeg(mats, dims) {
    const { L1, L2, hipGeo, kneeGeo, femurGeo, tibiaGeo, footGeo } = dims;

    const hipMount = new THREE.Group();
    const coxa = new THREE.Group();
    hipMount.add(coxa);

    // hip actuator drum, axis across the leg plane (local X)
    const hip = new THREE.Mesh(hipGeo, mats.actuator);
    hip.rotation.z = Math.PI / 2;
    coxa.add(hip);

    const femur = new THREE.Group();
    coxa.add(femur);
    const femurMesh = new THREE.Mesh(femurGeo, mats.panel);
    femurMesh.position.y = -L1 / 2;
    femur.add(femurMesh);

    const tibia = new THREE.Group();
    tibia.position.y = -L1;
    femur.add(tibia);
    const knee = new THREE.Mesh(kneeGeo, mats.actuator);
    knee.rotation.z = Math.PI / 2;
    tibia.add(knee);
    const tibiaMesh = new THREE.Mesh(tibiaGeo, mats.joint);
    tibiaMesh.position.y = -L2 / 2;
    tibia.add(tibiaMesh);

    const foot = new THREE.Mesh(footGeo, mats.dark);
    foot.position.y = -L2;
    tibia.add(foot);
    const footTip = new THREE.Object3D();
    footTip.position.y = -L2;
    tibia.add(footTip);

    return { hipMount, coxa, femur, tibia, footTip };
}

/**
 * createWalker(site, terrain, obstacles, spec) — the full unit.
 *
 * spec = {
 *   name, spawnOffset: {x, z},
 *   walkSpeed, turnRate, slopeK, minSpeedFactor, bodyRadius,
 *   strideRate, stepHalf, swingLift, bobAmp,
 *   pitchGain, rollGain, maxTilt,          // terrain-hug tilt
 *   legDims: { L1, L2, hipR, femurW, tibiaW },
 *   build(mats) -> {
 *     body: THREE.Group,                   // chassis visuals
 *     legs: [{ mount: {x,y,z}, faceYaw, useYaw, elbow, phase,
 *              homeLx, homeLz }],          // body-local foot homes
 *   },
 * }
 *
 * Returns the ground-unit interface main.js expects (humanoid-
 * shaped minus jump/dig/tether): mesh, update, teleport, position,
 * heading, atBoundary + a feet() probe for E2E anti-skate checks.
 */
export function createWalker(site, terrain, obstacles, spec) {
    const mesh = new THREE.Group();
    mesh.name = spec.name;
    mesh.position.set(site.spawn.x + spec.spawnOffset.x, 0,
        site.spawn.z + spec.spawnOffset.z);

    const mats = walkerMaterials(spec.livery);
    const d = spec.legDims;
    const dims = {
        L1: d.L1, L2: d.L2,
        hipGeo: new THREE.CylinderGeometry(d.hipR, d.hipR, d.hipR * 1.7, 10),
        kneeGeo: new THREE.CylinderGeometry(d.hipR * 0.72, d.hipR * 0.72, d.hipR * 1.4, 10),
        femurGeo: new THREE.BoxGeometry(d.femurW, d.L1 * 0.94, d.femurW * 0.82),
        tibiaGeo: new THREE.BoxGeometry(d.tibiaW, d.L2 * 0.95, d.tibiaW * 0.78),
        footGeo: new THREE.CylinderGeometry(d.tibiaW * 0.55, d.tibiaW * 0.34, d.tibiaW * 1.1, 8),
    };

    const { body, legs: legSpecs } = spec.build(mats);
    mesh.add(body);

    // Instantiate the chains at their mounts. Each leg keeps its
    // full spec + live plant state alongside the joint groups.
    const legs = legSpecs.map((ls) => {
        const chain = buildLeg(mats, dims);
        chain.hipMount.position.set(ls.mount.x, ls.mount.y, ls.mount.z);
        chain.hipMount.rotation.y = ls.faceYaw;
        mesh.add(chain.hipMount);
        return {
            ...ls, ...chain,
            plant: new THREE.Vector3(),     // world stance lock
            cmd: new THREE.Vector3(),       // last commanded foot world pos
            swingFrom: new THREE.Vector3(), // world foot pos at swing start
            planted: false,
            prevStance: false,
        };
    });

    let heading = site.spawn.heading;
    let stride = 0;
    let walkAmt = 0;
    let atBoundary = false;
    const bound = site.worldSize / 2 - EDGE_MARGIN;

    const _fwd = new THREE.Vector3();   // body +Z in world
    const _lat = new THREE.Vector3();   // body +X in world (plant offsets)
    const _right = new THREE.Vector3(); // humanoid's roll-axis convention
    const _up = new THREE.Vector3(0, 1, 0);
    const _yawQ = new THREE.Quaternion();
    const _pitchQ = new THREE.Quaternion();
    const _rollQ = new THREE.Quaternion();
    const _tiltQ = new THREE.Quaternion();
    const _local = new THREE.Vector3();
    const _hipInv = new THREE.Matrix4();

    function groundAt(x, z) {
        return terrain.sampleGroundHeight(x, z) + (obstacles?.deckHeight?.(x, z) ?? 0);
    }

    /** 3-DOF analytic solve: optional coxa yaw toward the target,
        then a 2-link law-of-cosines solve in the (now-aligned) leg
        plane. elbow ∈ {+1, −1} picks which of the two closed-form
        knee configurations: +1 bulges the knee toward hip-local +Z
        (spider knee-up / hind knee-back), −1 the other way.      */
    function solveChain(leg, wx, wy, wz) {
        leg.hipMount.updateWorldMatrix(true, false);
        _hipInv.copy(leg.hipMount.matrixWorld).invert();
        _local.set(wx, wy, wz).applyMatrix4(_hipInv);

        let pz, py;
        if (leg.useYaw) {
            leg.coxa.rotation.y = Math.atan2(_local.x, _local.z);
            pz = Math.hypot(_local.x, _local.z);
            py = _local.y;
        } else {
            // Sagittal leg: solve in the hip plane, lateral error is
            // absorbed visually (exactly the humanoid's convention).
            pz = _local.z;
            py = _local.y;
        }

        const down = -py;
        const { L1, L2 } = dims;
        const R = THREE.MathUtils.clamp(Math.hypot(pz, down),
            Math.abs(L1 - L2) + 1e-3, L1 + L2 - 1e-3);
        const alpha = Math.atan2(pz, down);
        const beta = Math.acos(THREE.MathUtils.clamp(
            (L1 * L1 + R * R - L2 * L2) / (2 * L1 * R), -1, 1));
        const knee = Math.acos(THREE.MathUtils.clamp(
            (L1 * L1 + L2 * L2 - R * R) / (2 * L1 * L2), -1, 1));
        const theta1 = alpha + leg.elbow * beta;
        const theta2 = -leg.elbow * (Math.PI - knee);

        // rotation.x = −θ maps "angle from straight-down toward
        // hip-local +Z" onto three.js's X-rotation handedness.
        leg.femur.rotation.x = -theta1;
        leg.tibia.rotation.x = -theta2;
    }

    /** Idle plant: foot settles at its home point under the body,
        and cmd tracks it so a walk-start captures continuity. */
    function plantIdle(leg) {
        leg.plant.set(
            mesh.position.x + _lat.x * leg.homeLx + _fwd.x * leg.homeLz,
            0,
            mesh.position.z + _lat.z * leg.homeLx + _fwd.z * leg.homeLz
        );
        leg.plant.y = groundAt(leg.plant.x, leg.plant.z);
        leg.cmd.copy(leg.plant);
        // Seed the swing origin too: a leg whose cycle BEGINS in swing
        // (stride 0) never sees a release edge, so without this its
        // swingFrom stays at world-origin and the foot flails out of reach.
        leg.swingFrom.copy(leg.plant);
    }

    /** Stance holds the world-locked plant; swing lerps the foot from
        its lift-off point (swingFrom, captured on release) to a home
        point a stepHalf ahead in the travel direction, arcing over a
        sin() lift that peaks MID-swing. The next plant is captured
        from `cmd` at touchdown, so the planted foot is exactly where
        the swing left it — skate is impossible by construction (the
        Wave 12 humanoid recomputed the plant and slammed the foot). */
    function solveLeg(leg, stance, swingProg, travelSign) {
        if (stance) {
            leg.plant.y = groundAt(leg.plant.x, leg.plant.z); // conform
            leg.cmd.copy(leg.plant);
            solveChain(leg, leg.plant.x, leg.plant.y, leg.plant.z);
        } else {
            const lead = leg.homeLz + travelSign * spec.stepHalf;
            const tx = mesh.position.x + _lat.x * leg.homeLx + _fwd.x * lead;
            const tz = mesh.position.z + _lat.z * leg.homeLx + _fwd.z * lead;
            const gy = groundAt(tx, tz);
            const k = swingProg;
            const cx = leg.swingFrom.x + (tx - leg.swingFrom.x) * k;
            const cz = leg.swingFrom.z + (tz - leg.swingFrom.z) * k;
            const baseY = leg.swingFrom.y + (gy - leg.swingFrom.y) * k;
            const y = baseY + spec.swingLift * Math.sin(swingProg * Math.PI);
            leg.cmd.set(cx, y, cz);
            solveChain(leg, cx, y, cz);
        }
    }

    function update(dt, input) {
        heading += input.steer * spec.turnRate * dt;

        const normal = terrain.sampleGroundNormal(mesh.position.x, mesh.position.z);
        const slopeMag = 1 - normal.y;
        const speedFactor = Math.max(spec.minSpeedFactor, 1 - slopeMag * spec.slopeK);
        const speed = input.throttle * spec.walkSpeed * speedFactor;

        let nx = mesh.position.x + Math.sin(heading) * speed * dt;
        let nz = mesh.position.z + Math.cos(heading) * speed * dt;
        atBoundary = Math.abs(nx) > bound || Math.abs(nz) > bound;
        if (atBoundary) {
            nx = THREE.MathUtils.clamp(nx, -bound, bound);
            nz = THREE.MathUtils.clamp(nz, -bound, bound);
        }
        // blocked entry, never trapped (same idiom as every ground unit)
        const blocked = obstacles?.collides(nx, nz, spec.bodyRadius)
            && !obstacles.collides(mesh.position.x, mesh.position.z, spec.bodyRadius);
        if (!blocked) {
            mesh.position.x = nx;
            mesh.position.z = nz;
        }
        mesh.position.y = groundAt(mesh.position.x, mesh.position.z);

        const moving = Math.abs(input.throttle) > 0.05;
        if (moving) stride += dt * spec.strideRate * Math.abs(speed) / spec.walkSpeed;
        walkAmt += ((moving ? 1 : 0) - walkAmt) * Math.min(1, 8 * dt);
        // Foot lands a stepHalf ahead in the direction of travel.
        const travelSign = speed < 0 ? -1 : 1;

        _fwd.set(Math.sin(heading), 0, Math.cos(heading));
        _lat.set(Math.cos(heading), 0, -Math.sin(heading));
        _right.set(-Math.cos(heading), 0, Math.sin(heading));

        // Terrain-hug tilt — the legged-robot signature (the biped
        // stays gravity-vertical; a walker conforms to the grade).
        const pitch = THREE.MathUtils.clamp(normal.dot(_fwd) * spec.pitchGain,
            -spec.maxTilt, spec.maxTilt);
        const roll = THREE.MathUtils.clamp(normal.dot(_right) * spec.rollGain,
            -spec.maxTilt, spec.maxTilt);
        _yawQ.setFromAxisAngle(_up, heading);
        _pitchQ.setFromAxisAngle(_right, -pitch);
        _rollQ.setFromAxisAngle(_fwd, -roll);
        _tiltQ.copy(_yawQ).multiply(_pitchQ).multiply(_rollQ);
        if (dt === 0) mesh.quaternion.copy(_tiltQ);      // boot: no swivel-in
        else mesh.quaternion.slerp(_tiltQ, 1 - Math.exp(-10 * dt));
        mesh.position.y += Math.abs(Math.sin(stride)) * spec.bobAmp * walkAmt;
        mesh.updateWorldMatrix(true, false);

        const TAU = Math.PI * 2;
        const turning = Math.abs(input.steer) > 0.05;
        for (const leg of legs) {
            // tm in [0,2π): first half (sin>0) swings, second half stances.
            const tm = ((stride + leg.phase) % TAU + TAU) % TAU;
            const stance = tm >= Math.PI;
            const swingProg = stance ? 0 : tm / Math.PI; // 0→1 over the swing
            if (moving) {
                // Release edge: remember where the foot lifts off, so the
                // swing lerp starts exactly there (no jump at lift-off).
                if (leg.prevStance && !stance) leg.swingFrom.copy(leg.cmd);
                // Touchdown edge: lock the plant at the foot's actual
                // commanded position (no jump at set-down = no skate).
                if (!leg.prevStance && stance) { leg.plant.copy(leg.cmd); leg.planted = true; }
            } else if (!leg.planted || turning) {
                plantIdle(leg);
                leg.planted = true;
            }
            leg.prevStance = stance;
            // Idle: hold the idle plant (treat as stance). Moving: honour
            // the gait's stance/swing split.
            solveLeg(leg, moving ? stance : true, swingProg, travelSign);
        }
    }

    function teleport(x, z) {
        mesh.position.set(x, groundAt(x, z), z);
        for (const leg of legs) leg.planted = false;
    }

    return {
        mesh, update, teleport,
        get position() { return mesh.position; },
        get heading() { return heading; },
        get atBoundary() { return atBoundary; },
        /** E2E probe: world-space foot tip positions (anti-skate,
            terrain-conform assertions). Fresh vectors on purpose. */
        feet() {
            return legs.map((leg) => leg.footTip.getWorldPosition(new THREE.Vector3()));
        },
    };
}
