/* ============================================================
   van.js — humanoid-driven mobile base (Wave 12).

   Same terrain-follow + slope-tilt approach as rover.js, retuned:
   slower but torquier (higher slope tolerance), only the humanoid
   can drive it, and when parked it deploys as a field chargepad
   (panels out + dock ring — the visual state IS the pad state).
   ============================================================ */

import * as THREE from 'three';
import { attachUnitModel } from './models.js';
import { createWheelRig } from './wheels.js';

// NASA's SEV/MMSEV — the real vehicle this silhouette copies — drives
// ~10 km/h on the flat (2.6 m/s), but at real scale that read as a crawl:
// barely 1.8x the 1.4 m/s walk, and below the rover's slowest usable gear
// (G1 = 2.1 m/s), so driving out felt slower than walking there. 5.5 m/s
// (~20 km/h) is a time-compressed cruise in the same spirit as the rover's
// GEARS — ~4x walking pace, still well under the rover's G2 (6.3 m/s), so
// "drive out and deploy" stays a commitment without being a chore.
const VAN_SPEED = 5.5;         // m/s
const TURN_RATE = 2.0;         // rad/s
const SLOPE_K = 1.5;           // torquier than the rover's 3.0
const MIN_SPEED_FACTOR = 0.20; // keeps climbing where the rover stalls
const BODY_RADIUS = 2.2;       // m, collision footprint (measured from GLB: 3.7m wide x 5.5m long)
const EDGE_MARGIN = 30;
// Both the fallback (wheel rig bottoms at y=0) and the GLB (models.js
// grounds base at y=0) put the wheel contact at origin height — the
// clearance only rides over micro-relief, same 0.12 as the rover's GLB.
const CLEARANCE = 0.12;
const DRAIN_SCALE = 1.5;       // heavier drain than the rover
const MOUNT_R = 4;             // m — humanoid must be this close to mount/dismount
const DOCK_R = 7;              // m — deployed-van charge radius (van is bulkier
                               // than a chargepad disc, so wider than DOCK_R 5)
const DEPLOY_SECS = 2.0;       // deploy/undeploy animation duration (~95% settled)
// Plan 27 — pebble ride-over. Rocks up to this radius (≈1.2m across, vs the
// van's 0.9m-diameter wheels) are driven OVER instead of stopping the van
// dead; anything bigger is still a wall. Wheel-scale obstacles should be a
// bump you feel, not an invisible barrier.
export const VAN_CLIMB_R = 0.62;
// Chassis spring for that ride. Critically damped (D = 2*sqrt(K)) so a
// strike settles in ~0.5s without oscillating like a lowrider.
const BUMP_K = 85;
const BUMP_D = 2 * Math.sqrt(BUMP_K);
// Per-wheel lift rate (m/s) above which a crossing counts as a STRIKE and
// earns dust, a thump and a speed scrub. Below it, the wheel is riding a
// gentle flank and only the spring responds.
const STRIKE_RATE = 0.55;
const STRIKE_SCRUB = 0.18;     // fraction of speed shed on a strike

// Wheel hubs measured from the loaded van.glb in group-local meters
// [x, y, z, r, halfW] (wheels.js format, ~x1.06 enclose margin baked in).
// Vertex clustering of the raw Tripo export (see docs/game-plans/17):
// three axles at raw x -0.339/+0.106/+0.329 -> the isolated one is the
// FRONT (concept: single front axle, close mid+rear pair), which the
// yaw -PI/2 maps to -z = the unit forward convention. Fat 0.9m-dia
// tires at +-1.48m outboard, contact at y=0 (models.js grounding).
const VAN_WHEELS_GLB = [
    [-1.48, 0.47, -1.86, 0.49, 0.38], // front L
    [+1.48, 0.47, -1.86, 0.49, 0.38], // front R
    [-1.48, 0.47, +0.58, 0.47, 0.38], // mid L
    [+1.48, 0.47, +0.58, 0.47, 0.38], // mid R
    [-1.48, 0.47, +1.81, 0.47, 0.38], // rear L
    [+1.48, 0.47, +1.81, 0.47, 0.38], // rear R
];

// Procedural fallback chassis corners (its old static wheel cylinders
// are gone — the rig IS the fallback's wheels, rover.js idiom).
const VAN_WHEELS_FALLBACK = [
    [-1.7, 0.5, -1.8, 0.5, 0.19],
    [+1.7, 0.5, -1.8, 0.5, 0.19],
    [-1.7, 0.5, 0, 0.5, 0.19],
    [+1.7, 0.5, 0, 0.5, 0.19],
    [-1.7, 0.5, +1.8, 0.5, 0.19],
    [+1.7, 0.5, +1.8, 0.5, 0.19],
];

const _up = new THREE.Vector3(0, 1, 0);

export function createVan(site, terrain, obstacles) {
    const { mesh, deployRig } = buildVanMesh();
    mesh.position.set(site.spawn.x + 12, 0, site.spawn.z);
    mesh.rotation.y = site.spawn.heading;

    // Spinning-wheel overlay (wheels.js — the rover's rig, relaid for six
    // 0.9m van wheels). The GLB's baked wheels stay static; the overlay
    // encloses them and does the spinning + steering.
    const wheelRig = createWheelRig();
    wheelRig.layout(VAN_WHEELS_FALLBACK);
    mesh.add(wheelRig.group);

    // The van.glb swap clears the group's children (models.js) — re-attach
    // the deploy rig + wheel rig, and re-seat the deploy rig's panels on
    // the REAL roof line (the procedural hull's 2.35m hinge floated above
    // the GLB's 2.48m-high, 3.7m-wide body).
    // Roof line for the drivable/landable roof deck (Wave 12.14) —
    // procedural body top now, re-measured from the GLB at swap.
    let roofH = 2.4;

    attachUnitModel(mesh, 'van', (_model, size) => {
        mesh.add(deployRig.group);
        wheelRig.layout(VAN_WHEELS_GLB);
        hubs = VAN_WHEELS_GLB; // suspension samples the REAL hubs after the swap
        mesh.add(wheelRig.group);
        // Hinges ride the REAL roof line; the two heights are staggered so
        // the roof-stowed wings stack instead of z-fighting mid-overlap.
        deployRig.panelL.position.set(-(size.x / 2 - 0.1), size.y + 0.14, 0);
        deployRig.panelR.position.set(size.x / 2 - 0.1, size.y + 0.04, 0);
        roofH = size.y;
    });

    let heading = site.spawn.heading;
    let atBoundary = false;
    let deployed = false;
    let deployTimer = 0;
    let deployTarget = 0;     // 0=undeployed, 1=deployed
    let driver = null;        // null = driverless, else the humanoid unit
    let scrub = 0;            // speed penalty decaying after a rock strike
    const bound = site.worldSize / 2 - EDGE_MARGIN;

    const _yawQ = new THREE.Quaternion();
    const _tiltQ = new THREE.Quaternion();
    const _bumpQ = new THREE.Quaternion();
    const _pitchAxis = new THREE.Vector3();
    const _rollAxis = new THREE.Vector3();

    // Plan 27 suspension state: one lift sample per wheel (m of rock under
    // it), plus the sprung chassis offset the six of them drive.
    const wheelLift = new Float32Array(6);
    let bumpY = 0;       // sprung vertical offset (m)
    let bumpV = 0;       // its velocity
    let bumpPitch = 0;   // rad, front-vs-rear lift
    let bumpRoll = 0;    // rad, left-vs-right lift
    /** Strike events for main.js to turn into dust / sound / shake. Consumed
        (drained) each frame — van.js owns physics, not presentation. */
    const bumps = [];

    /** Which hub layout is live: the GLB set once the model swaps in, the
        fallback corners before that. Kept in sync with wheelRig.layout(). */
    let hubs = VAN_WHEELS_FALLBACK;

    /** Sample the rock deck under each wheel and run the chassis spring.
        Returns the mean lift so the caller can seat the body on it. */
    function updateSuspension(dt, speed) {
        if (!obstacles?.rockTop) return 0;
        const sinH = Math.sin(heading);
        const cosH = Math.cos(heading);
        let mean = 0, front = 0, rear = 0, left = 0, right = 0;
        for (let i = 0; i < hubs.length; i++) {
            const [lx, , lz] = hubs[i];
            // hub local -> world (yaw only; the tilt is cosmetic here)
            const wx = mesh.position.x + lx * cosH + lz * sinH;
            const wz = mesh.position.z - lx * sinH + lz * cosH;
            const lift = obstacles.rockTop(wx, wz);
            const prev = wheelLift[i];
            // A fast RISE is a strike; falling off the back of a rock is not
            // (that is just the wheel dropping, which the spring handles).
            if (dt > 0 && (lift - prev) / dt > STRIKE_RATE && Math.abs(speed) > 1) {
                bumps.push({
                    x: wx, z: wz, lift,
                    intensity: Math.min(1, ((lift - prev) / dt) / (STRIKE_RATE * 4)),
                });
            }
            wheelLift[i] = lift;
            mean += lift;
            if (lz < 0) front += lift; else rear += lift;
            if (lx < 0) left += lift; else right += lift;
        }
        mean /= hubs.length;
        // Two hubs per end on the fallback, but the GLB has 2 front / 4 back;
        // halving both sides keeps the ratio honest enough for a visual tilt.
        const half = hubs.length / 2;
        // Wheelbase ~3.7m, track ~3.0m: lift difference over that span IS the
        // angle (small-angle, so the ratio is the radian).
        bumpPitch = THREE.MathUtils.clamp((front - rear) / half / 3.7, -0.18, 0.18);
        bumpRoll = THREE.MathUtils.clamp((right - left) / half / 3.0, -0.18, 0.18);

        // critically damped spring toward the mean lift
        bumpV += (BUMP_K * (mean - bumpY) - BUMP_D * bumpV) * dt;
        bumpY += bumpV * dt;
        return mean;
    }

    function update(dt, input) {
        // Deploy animation: ease deployTimer toward deployTarget
        // (~95% settled in DEPLOY_SECS, same exp idiom as the tilt slerp).
        if (deployTimer !== deployTarget) {
            deployTimer += (deployTarget - deployTimer) * Math.min(1, (3 / DEPLOY_SECS) * dt);
            if (Math.abs(deployTarget - deployTimer) < 0.001) deployTimer = deployTarget;
            deployed = deployTimer > 0.95;
        }
        // Panels swing 180° — stowed lying flat ON the roof (cells down,
        // protected), up and over the hinge, deployed flat outboard. The
        // 90° midpoint has both wings standing vertical. (The first cut
        // folded them 90° down the SIDES — which curtained off the whole
        // textured GLB hull behind two blue slabs.)
        deployRig.panelL.rotation.z = (1 - deployTimer) * Math.PI;
        deployRig.panelR.rotation.z = -(1 - deployTimer) * Math.PI;
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
        // Plan 27: a strike last frame scrubs speed — hitting a rock at
        // wheel scale should cost momentum, the way it does in a real truck.
        let speed = canDrive ? input.throttle * VAN_SPEED * speedFactor : 0;
        speed *= (1 - scrub);
        scrub = Math.max(0, scrub - dt * 1.6);

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

        // Plan 27: per-wheel rock sampling drives the chassis spring. Run it
        // BEFORE seating the body so the lift lands this frame, and note the
        // deckHeight below already contains the mean rock lift (via the
        // colliders facade) — bumpY is the SPRUNG deviation from it, which
        // is why the body height subtracts the raw mean and adds the sprung
        // value instead of stacking both.
        const meanLift = updateSuspension(dt, speed);
        if (bumps.length) scrub = Math.min(0.6, scrub + STRIKE_SCRUB * bumps[bumps.length - 1].intensity);

        const groundY = terrain.sampleGroundHeight(mesh.position.x, mesh.position.z)
            + (obstacles?.deckHeight?.(mesh.position.x, mesh.position.z) ?? 0);
        mesh.position.y = groundY - meanLift + bumpY + CLEARANCE;

        // Wheels spin with ground speed and steer with input (front axle
        // with, mid/rear against — the real MMSEV all-wheel-steers).
        wheelRig.update(dt, speed, canDrive ? input.steer : 0, 1);

        _tiltQ.setFromUnitVectors(_up, normal);
        _yawQ.setFromAxisAngle(_up, heading);
        _tiltQ.multiply(_yawQ);
        mesh.quaternion.slerp(_tiltQ, 1 - Math.exp(-12 * dt));
        // Bump pitch/roll ride ON TOP of the settled terrain tilt, in the
        // body's own frame — so they read as suspension travel rather than
        // fighting the slerp that keeps the van on the slope.
        if (bumpPitch || bumpRoll) {
            _pitchAxis.set(1, 0, 0);
            _rollAxis.set(0, 0, 1);
            _bumpQ.setFromAxisAngle(_pitchAxis, bumpPitch);
            mesh.quaternion.multiply(_bumpQ);
            _bumpQ.setFromAxisAngle(_rollAxis, bumpRoll);
            mesh.quaternion.multiply(_bumpQ);
        }
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

    // Van hull health for base repair bays (same pattern as rover).
    // Starts + stays pristine unless/until a future damage system is added.
    let health = 100;
    function repair(amount) {
        health = Math.min(100, health + amount);
    }

    return {
        mesh, update, teleport, setDriver, toggleDeploy, repair,
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
        get roofHeight() { return roofH; },
        get health() { return health; },
        /** Plan 27 — sprung chassis state, for HUD/E2E. */
        get bumpY() { return bumpY; },
        /** E2E probe: live per-wheel rock lift + whether the facade can
            even answer (a facade without climbR silently reports flat). */
        get suspension() {
            return {
                hasRockTop: !!obstacles?.rockTop,
                facadeClimbR: obstacles?.climbR ?? null,
                lifts: Array.from(wheelLift),
                hubs: hubs.length,
            };
        },
        get bumpPitch() { return bumpPitch; },
        get climbR() { return VAN_CLIMB_R; },
        /** Drain this frame's rock strikes: [{x, z, lift, intensity}].
            main.js turns them into dust, thump and camera shake — van.js
            stays free of effects/sound imports (the humanoid dig idiom). */
        takeBumps() {
            if (!bumps.length) return null;
            const out = bumps.slice();
            bumps.length = 0;
            return out;
        },
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
    // (no static wheels — the wheels.js overlay rig from createVan IS the
    // fallback's wheels, exactly like the rover's chassis)

    // Deploy rig: solar panel wings hinged at the roof edges (stowed flat
    // ON the roof cells-down, swinging 180° over the hinge to deploy flat
    // outboard) + a teal dock ring at the charge radius. Lives in its own
    // sub-group so it can be re-attached after a GLB swap replaces the
    // procedural hull. Hinge heights staggered — the stowed wings overlap
    // mid-roof and would z-fight at equal height.
    const rigGroup = new THREE.Group();
    rigGroup.name = 'van-deploy-rig';
    const panelMat = new THREE.MeshStandardMaterial({
        color: 0x1c3a6e, roughness: 0.35, metalness: 0.55,
        side: THREE.DoubleSide,
    });
    const panelGeo = new THREE.BoxGeometry(2.4, 0.08, 4.2);
    const panelL = new THREE.Group();
    panelL.position.set(-1.5, 2.54, 0);
    const meshL = new THREE.Mesh(panelGeo, panelMat);
    meshL.position.x = -1.2; // hinge at the roof edge, wing swings outward
    panelL.add(meshL);
    const panelR = new THREE.Group();
    panelR.position.set(1.5, 2.44, 0);
    const meshR = new THREE.Mesh(panelGeo, panelMat);
    meshR.position.x = 1.2;
    panelR.add(meshR);
    // start stowed (update() drives these every frame from deployTimer)
    panelL.rotation.z = Math.PI;
    panelR.rotation.z = -Math.PI;
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
