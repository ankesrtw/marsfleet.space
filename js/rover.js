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
import { createWheelRig, WHEELS_GLB, WHEELS_FALLBACK } from './wheels.js';

// Perseverance/Curiosity top out at ~4.2 cm/s on flat hard ground (~152
// m/h). True realism makes the 6-9km sites unplayable (Rochette would be
// a six-hour drive), so GEARS time-compress it — REAL keeps the true
// speed for purists, G1-G3 are drive gears (HUD button / G key).
// Turn rate scales with the gear but is capped for control feel.
const REAL_SPEED = 0.042;    // m/s — real rover top speed
const REAL_TURN = 0.06;      // rad/s
const GEARS = [
    { label: 'REAL', mult: 1, drain: 1 },
    { label: 'G1', mult: 50, drain: 1 },
    { label: 'G2', mult: 150, drain: 1.6 },
    { label: 'G3', mult: 400, drain: 2.5 },
];
const GEAR_KEY = 'mc-gear-rover';
const CLEARANCE = 0.6;       // meters, wheel-to-chassis (procedural mesh)
const SLOPE_K = 3.0;         // speed falloff strength
const MIN_SPEED_FACTOR = 0.15;
// Longitudinal inertia: actual speed chases the throttle's TARGET speed
// with a time constant, so the rover rolls up and coasts to a stop like
// a mass on wheels instead of snapping to velocity the frame a key is
// pressed/released. ACCEL_TAU governs power-up, BRAKE_TAU the (quicker)
// coast-down. Seconds — larger = more sluggish.
const ACCEL_TAU = 0.9;
const BRAKE_TAU = 0.6;
const BODY_RADIUS = 1.4;     // m, collision footprint (also main.js registry)
const EDGE_MARGIN = 30;      // m inside the DEM edge — the mission boundary
// Wave 4 hazard terms — more factors in the same multiplicative speed
// chain as the slope falloff above, never a hard block:
const SAND_DRAG = 0.6;       // full-effect soft sand cuts speed to 40%
const STORM_DRAG = 0.35;     // peak dust storm cuts speed to 65%
const SLIP_K = 1.5;          // wheel overspin in sand: x(1 + K*effect)
// Rollover risk (Wave 4 vehicle feel): a warning threshold derived from
// the SAME slopeMag the traction falloff already samples — no torque
// sim, matching the "direct height-function query" philosophy above.
// Thresholds are in slopeMag = 1 - cos(tilt) space:
const ROLL_START = 0.05;     // ~18 deg — risk starts ramping
const ROLL_MAX = 0.18;       // ~35 deg — flagged imminent (real rover limit)

// ---- Wave 6: consequences. The Wave 4 gauges stop being warnings. ----
// Suspension: a damped spring on a visual chassis offset, kicked by how
// fast the ground height changes under the wheels — the physics-only
// micro-relief (terrain.js `micro`) finally becomes visible ride feel.
const BUMP_SPRING_K = 60;    // spring rate (1/s^2)
const BUMP_DAMP = 9;         // damping (1/s)
const BUMP_COUPLE = 0.5;     // ground-step -> chassis velocity kick
const BUMP_MAX = 0.28;       // m, visual bounce clamp
const BUMP_RISK_K = 0.045;   // roughness-at-speed -> transient extra risk
// Flip: sustained max risk AT SPEED tips the rover. The 2 m/s floor is
// the point: real rovers crawl at 0.042 m/s precisely so this can never
// happen — REAL gear (and careful G1 driving) is flip-immune by design.
const ROLL_TRIGGER = 0.97;
const ROLL_SPEED_MIN = 2.0;  // m/s
const ROLL_HOLD_S = 0.6;     // s of sustained trigger before tipping
const FLIP_ANIM_S = 0.85;    // s, tip-over / righting animation
const FLIP_LIFT = 0.7;       // m, body rests on its side pack, not sunk
// Bog: dwell + churn in deep soft sand (effect >= BOG_EFFECT_MIN) fills
// a meter; full = wheels dug in, Spirit-at-Troy style. Fill scales with
// throttle AND gear (fast-spinning wheels dig; a REAL/G1 crawl through
// the same sand is nearly bog-proof — the actual flight-ops lesson).
const BOG_EFFECT_MIN = 0.55;
const BOG_FILL_S = 10;       // s to bog at effect 1, full throttle, G2
const BOG_GEAR_REF = 150;    // gear mult that fills at the nominal rate
const BOG_DRAIN_S = 25;      // meter decay per second in the clear
// Recovery (shared by rolled + bogged): alternate throttle direction in
// rhythm — each counted W/S swing adds to the meter (rocking a car out
// of snow). Any OTHER working unit within ASSIST_RANGE auto-assists.
// Sustained one-way throttle while bogged DIGS IN instead (Spirit:
// escape attempts buried the wheels deeper).
const ROCK_SWING = 0.16;     // meter per counted throttle reversal
const ROCK_WINDOW_S = 1.6;   // max gap between swings to keep the rhythm
const RECOVER_DECAY = 0.04;  // meter/s passive slip-back
const DIG_START_S = 1.2;     // one-way throttle longer than this digs
const DIG_PENALTY = 0.08;    // meter/s lost while digging (bogged only)
const ASSIST_RANGE = 9;      // m (main.js checks unit distances)
const ASSIST_RATE = 1 / 6;   // meter/s from a nearby assisting unit

// Wave 9 damage model (see `health` below)
const IMPACT_SPD_MIN = 1.8;  // m/s — nudging a boulder at a crawl is harmless
const IMPACT_DMG_K = 3.4;    // % hull per m/s over that floor, per collision
// Measured on Jezero (roughness = |d(micro-relief)/dt| x min(1, speed/6)):
// at G2 (6.3 m/s) it means 0.14 and peaks ~0.5; at G3 (16.8 m/s) it means
// ~0.39 and peaks 1.1-2.0. A 0.45 floor therefore leaves REAL/G1/G2 driving
// essentially free and bills the reckless G3 charge across broken ground —
// which is the lesson (real rovers creep over rubble for exactly this reason).
// Measured on Jezero: roughness means 0.14 / peaks ~0.5 at G2 (6.3 m/s) and
// spikes far higher at G3. The floor leaves REAL/G1/G2 driving essentially
// free; the CAP bounds the worst case at ~1 %/s (a sustained 20 s hammering
// costs ~20% hull) — uncapped, single-frame micro-relief spikes wrecked the
// rover in half a minute.
const ROUGH_MIN = 0.45;      // ignore gentle undulation
const ROUGH_DMG_K = 1.2;     // % hull /s per unit of roughness over the floor
const ROUGH_DMG_MAX = 1.0;   // %/s cap — the worst ground can do
const ROLL_DMG = 14;         // % hull on a tip-over
const LIMP_FLOOR = 0.45;     // speed multiplier at 0% hull — hurt, still drivable

const _up = new THREE.Vector3(0, 1, 0);
const _tiltQuat = new THREE.Quaternion();
const _yawQuat = new THREE.Quaternion();
const _fwdAxis = new THREE.Vector3(0, 0, 1); // local travel axis = tip-over hinge
const _rollQuat = new THREE.Quaternion();

// `obstacles` is a colliders.js facade (boulders + structures + other
// units), shaped like the old rocks collider: collides(x, z, radius).
// `hazards`/`weather` (Wave 4, both optional): hazardZones.js graded
// zone sampler + weather.js storm timeline — soft factors, not blockers.
export function createRover(site, terrain, obstacles, { hazards, weather } = {}) {
    const mesh = buildRoverMesh();
    mesh.position.set(site.spawn.x, 0, site.spawn.z);
    mesh.rotation.y = site.spawn.heading;

    // Spinning-wheel overlay (wheels.js): the GLB's wheels are baked into
    // one fused mesh, so visible spin/steer comes from overlay wheels laid
    // over the measured baked-wheel hubs — attachUnitModel clears the
    // group, so the rig re-adds itself after the swap (rotors.js idiom).
    const wheelRig = createWheelRig();
    wheelRig.layout(WHEELS_FALLBACK);
    mesh.add(wheelRig.group);

    // GLB is normalized base-at-y=0, so it needs (almost) no clearance;
    // the procedural box chassis keeps the original 0.6.
    let clearance = CLEARANCE;
    attachUnitModel(mesh, 'rover', () => {
        clearance = 0.12;
        wheelRig.layout(WHEELS_GLB);
        mesh.add(wheelRig.group);
    });

    let gearIdx = GEARS.findIndex((g) => g.label === localStorage.getItem(GEAR_KEY));
    if (gearIdx < 0) gearIdx = 2; // default G2 (6.3 m/s)

    let heading = site.spawn.heading;
    let speed = 0;
    let atBoundary = false;
    let inHazard = null;    // current soft-terrain zone (atBoundary idiom)
    let slipRatio = 1;      // wheel overspin factor fed to the wheel rig
    let rolloverRisk = 0;   // 0 safe .. 1 imminent, smoothed for the HUD
    const bound = site.worldSize / 2 - EDGE_MARGIN;

    // Wave 6 consequence state
    let condition = 'ok';   // ok | rolled | bogged
    let recoveryMeter = 0;  // 0..1, shared by both recovery flows
    let bogMeter = 0;       // 0..1 sinking progress while still mobile

    // Wave 9 damage model: hull condition, separate from the battery. Charge
    // is spent and refilled by driving/solar; HEALTH only ever goes DOWN in
    // the field — the one way back up is a repair bay at a base. Three ways
    // to lose it, mapped to what actually breaks a real rover:
    //   - boulders: a hard collision at speed (an edge event, not per-frame)
    //   - pebbles/rough ground: continuous wear from the micro-relief that
    //     already drives the suspension bounce — hammering broken terrain at
    //     speed grinds the chassis; crawling over it costs nothing
    //   - tipping over
    let health = 100;
    let wasBlocked = false;   // collision edge detector
    let lastImpact = 0;       // m/s of the last hit (main.js: sound/HUD cue)
    let flipAnim = 0;       // 0 upright .. 1 on its side (animated)
    let flipSign = 1;       // which side it went over
    let rollHoldT = 0;      // time spent at trigger risk + speed
    let lastThrottleSign = 0;
    let swingGapT = Infinity;   // s since the last counted/primed swing
    let sameSignT = 0;          // sustained one-way throttle (dig detect)
    let assisted = false;       // another unit in range (main.js feeds)
    let bounceY = 0, bounceV = 0;
    let prevGroundY = null;

    /** Rocking rhythm: count throttle reversals (with a tolerated neutral
        gap) into the recovery meter; track one-way holds for dig-in. */
    function trackRocking(throttle, dt) {
        swingGapT += dt;
        const s = throttle > 0.5 ? 1 : throttle < -0.5 ? -1 : 0;
        if (s !== 0 && s !== lastThrottleSign) {
            if (lastThrottleSign !== 0 && swingGapT <= ROCK_WINDOW_S) {
                recoveryMeter = Math.min(1, recoveryMeter + ROCK_SWING);
            }
            lastThrottleSign = s;
            swingGapT = 0;
            sameSignT = 0;
        } else if (s !== 0) {
            sameSignT += dt;
        } else {
            sameSignT = 0;
        }
    }

    /** Shared recovery tick: assist + decay + dig; true when freed.
        The full-meter check runs BEFORE decay — the meter clamps at 1.0
        on the swing that fills it, and decaying first would shave it to
        0.996 forever (threshold provably unreachable; caught by E2E). */
    function recoveryTick(dt, digging) {
        if (assisted) recoveryMeter = Math.min(1, recoveryMeter + ASSIST_RATE * dt);
        if (recoveryMeter >= 1) return true;
        recoveryMeter = Math.max(0, recoveryMeter
            - RECOVER_DECAY * dt
            - (digging ? DIG_PENALTY * dt : 0));
        return false;
    }

    function cycleGear() {
        gearIdx = (gearIdx + 1) % GEARS.length;
        try { localStorage.setItem(GEAR_KEY, GEARS[gearIdx].label); } catch { /* private mode */ }
        return GEARS[gearIdx].label;
    }

    function update(dt, input) {
        // input: { throttle: -1..1, steer: -1..1 }

        // Wave 6: a downed rover (rolled or bogged) takes no drive input —
        // the throttle becomes the RECOVERY control (rocking rhythm), and
        // any other working unit parked close by assists automatically.
        const down = condition !== 'ok';
        if (down) {
            trackRocking(input.throttle, dt);
            const digging = condition === 'bogged' && sameSignT > DIG_START_S;
            if (recoveryTick(dt, digging)) {
                if (condition === 'bogged') bogMeter = 0.3; // free of the dig, not the sand
                condition = 'ok';
                recoveryMeter = 0;
                rolloverRisk = 0;
                rollHoldT = 0;
            }
        }
        // movement stays locked until the righting animation finishes too
        const incapacitated = down || flipAnim > 0.02;

        if (!incapacitated) {
            heading += input.steer * Math.min(1.2, REAL_TURN * GEARS[gearIdx].mult) * dt;
        }

        // Ground-contact samplers: real DEM + sub-DEM micro-relief, so the
        // ride picks up regolith-scale bumps the orbital data can't hold.
        const normal = terrain.sampleGroundNormal(mesh.position.x, mesh.position.z);
        const slopeMag = 1 - normal.y; // 0 = flat, up to ~1 = vertical
        const speedFactor = Math.max(MIN_SPEED_FACTOR, 1 - slopeMag * SLOPE_K);

        // Soft terrain + storm drag: same multiplicative chain as the
        // slope falloff. Sand is positional (hazardZones sampler), storm
        // drag is global (weather intensity) — kept as separate factors
        // so inHazard only ever reports the zone the wheels are in.
        inHazard = hazards?.sample(mesh.position.x, mesh.position.z) ?? null;
        const sandFactor = inHazard ? 1 - SAND_DRAG * inHazard.effect : 1;
        const stormFactor = weather ? 1 - STORM_DRAG * weather.intensity : 1;
        slipRatio = condition === 'bogged'
            ? 2.6 + (sameSignT > DIG_START_S ? 0.8 : 0) // churning; digging churns harder
            : inHazard ? 1 + SLIP_K * inHazard.effect : 1;

        // Suspension (Wave 6): the micro-relief component of the ground
        // sampler (ground − smooth) kicks a damped spring as it changes
        // under the wheels at speed. Slope-following stays in the tilt —
        // only the regolith-scale bumps reach the chassis bounce.
        const micro = terrain.sampleGroundHeight(mesh.position.x, mesh.position.z)
            - terrain.sampleHeight(mesh.position.x, mesh.position.z);
        let microVel = 0;
        if (prevGroundY != null && dt > 0) {
            microVel = (micro - prevGroundY) / dt;
            bounceV -= microVel * BUMP_COUPLE * Math.min(1, Math.abs(speed) / 6);
        }
        prevGroundY = micro;
        bounceV += (-BUMP_SPRING_K * bounceY - BUMP_DAMP * bounceV) * dt;
        bounceY = THREE.MathUtils.clamp(bounceY + bounceV * dt, -BUMP_MAX, BUMP_MAX);

        // Rollover: ramp 0..1 across the slopeMag band, smoothed so the
        // micro-relief in the ground sampler reads as a steady gauge, not
        // a flickering alarm. Wave 6 adds a roughness-at-speed transient:
        // hammering bumps fast spikes the gauge — slope + speed + rough
        // ground together is what actually tips it.
        const bumpRisk = incapacitated ? 0
            : Math.min(0.45, Math.abs(microVel) * Math.abs(speed) * BUMP_RISK_K);

        // Pebble/washboard wear: the same roughness-at-speed term the risk
        // gauge uses. Hammering broken ground grinds the hull; below
        // ROUGH_MIN (gentle undulation, or any speed at a crawl) it is free —
        // which is exactly why real rovers pick their way slowly over rubble.
        // The wear RATE is capped, like the bumpRisk term just above it. The
        // micro-relief sampler can spike hard on a single frame, and an
        // uncapped rate turned those spikes into a hull-shredder (a G3 run
        // over rubble cost 60-90% in 20 s, i.e. wrecked in half a minute).
        // The cap makes the worst case a knowable ~1 %/s.
        const roughness = Math.abs(microVel) * Math.min(1, Math.abs(speed) / 6);
        if (!incapacitated && roughness > ROUGH_MIN) {
            const wear = Math.min(ROUGH_DMG_MAX, (roughness - ROUGH_MIN) * ROUGH_DMG_K);
            health = Math.max(0, health - wear * dt);
        }
        const rollTarget = THREE.MathUtils.clamp(
            (slopeMag - ROLL_START) / (ROLL_MAX - ROLL_START) + bumpRisk, 0, 1);
        rolloverRisk += (rollTarget - rolloverRisk) * Math.min(1, 5 * dt);

        // Flip trigger: sustained max risk at speed. The speed floor keeps
        // REAL-gear crawling flip-immune — the real reason rovers creep.
        if (!incapacitated && rolloverRisk >= ROLL_TRIGGER && Math.abs(speed) >= ROLL_SPEED_MIN) {
            rollHoldT += dt;
            if (rollHoldT >= ROLL_HOLD_S) {
                condition = 'rolled';
                health = Math.max(0, health - ROLL_DMG);   // going over hurts
                // tip toward the downhill side (normal leans away from uphill)
                const lateral = normal.x * Math.cos(heading) - normal.z * Math.sin(heading);
                flipSign = lateral >= 0 ? 1 : -1;
                speed = 0;
                recoveryMeter = 0;
                lastThrottleSign = 0;
                swingGapT = Infinity;
            }
        } else {
            rollHoldT = 0;
        }

        // Bog fill (Wave 6, only while mobile): deep sand + throttle +
        // wheel speed digs in. Gear scaling is the point — a G3 sprint
        // through Séítah bogs in seconds, a G1 crawl is nearly immune
        // (Spirit's drivers crawled for exactly this reason).
        if (condition === 'ok' && inHazard && inHazard.effect >= BOG_EFFECT_MIN) {
            const excess = (inHazard.effect - 0.5) / 0.5;
            const gearFactor = GEARS[gearIdx].mult / BOG_GEAR_REF;
            bogMeter += excess * Math.abs(input.throttle) * gearFactor * dt / BOG_FILL_S;
            if (bogMeter >= 1) {
                bogMeter = 1;
                condition = 'bogged';
                speed = 0;
                recoveryMeter = 0;
                lastThrottleSign = 0;
                swingGapT = Infinity;
            }
        } else if (condition === 'ok') {
            bogMeter = Math.max(0, bogMeter - dt / BOG_DRAIN_S);
        }

        if (!incapacitated) {
            // Target speed from the throttle; actual speed eases toward it
            // so the rover accelerates and coasts instead of snapping
            // (releasing the key no longer stops it dead). Coast-down is
            // quicker than spin-up (regolith rolling resistance), and
            // terrain/hazard drag pulls the target down live. Below G1 the
            // multiplier is tiny — REAL gear still feels 1:1.
            // A battered hull is slower — damage has to cost something the
            // player feels, not just a number going down. Still drivable at
            // 0% (LIMP_FLOOR): stranded-with-no-recourse is never fun.
            const healthFactor = LIMP_FLOOR + (1 - LIMP_FLOOR) * (health / 100);
            const targetSpeed = input.throttle * REAL_SPEED * GEARS[gearIdx].mult
                * speedFactor * sandFactor * stormFactor * healthFactor;
            const tau = Math.abs(targetSpeed) > Math.abs(speed) ? ACCEL_TAU : BRAKE_TAU;
            speed += (targetSpeed - speed) * (1 - Math.exp(-dt / tau));

            let nx = mesh.position.x + Math.sin(heading) * speed * dt;
            let nz = mesh.position.z + Math.cos(heading) * speed * dt;
            // Mission boundary: the DEM (and the renderer's world) ends here —
            // clamp and flag so the HUD can flash OUT OF MISSION DIRECTIVES.
            atBoundary = Math.abs(nx) > bound || Math.abs(nz) > bound;
            if (atBoundary) {
                nx = THREE.MathUtils.clamp(nx, -bound, bound);
                nz = THREE.MathUtils.clamp(nz, -bound, bound);
            }
            // Obstacles block entry; steering above still applies, so the player
            // can turn in place and drive around. Movement is never blocked
            // while already overlapping (spawn edge case) — always escapable.
            const blocked = obstacles?.collides(nx, nz, BODY_RADIUS)
                && !obstacles.collides(mesh.position.x, mesh.position.z, BODY_RADIUS);
            if (!blocked) {
                mesh.position.x = nx;
                mesh.position.z = nz;
            }
            // Boulder strike. Edge-triggered: pressing against a rock you are
            // already touching must not bill you every frame — only the moment
            // of impact, priced on the speed you carried into it. The hit also
            // kills most of the speed, so it lands as a CRUNCH rather than a
            // silent wall.
            if (blocked && !wasBlocked) {
                const impact = Math.abs(speed);
                if (impact > IMPACT_SPD_MIN) {
                    health = Math.max(0, health - (impact - IMPACT_SPD_MIN) * IMPACT_DMG_K);
                    lastImpact = impact;
                    speed *= 0.2;
                }
            }
            wasBlocked = blocked;
        } else {
            speed = 0;
            atBoundary = false;
            wasBlocked = false;
        }

        // Pose: tip-over animation rides on top of the slope tilt + yaw.
        // Linear tip/right at FLIP_ANIM_S; the body lifts onto its side
        // pack instead of sinking through the terrain; a bogged chassis
        // settles slightly into the sand.
        const flipTarget = condition === 'rolled' ? 1 : 0;
        flipAnim = flipTarget > flipAnim
            ? Math.min(flipTarget, flipAnim + dt / FLIP_ANIM_S)
            : Math.max(flipTarget, flipAnim - dt / FLIP_ANIM_S);
        mesh.position.y = terrain.sampleGroundHeight(mesh.position.x, mesh.position.z)
            + clearance + bounceY + flipAnim * FLIP_LIFT
            - (condition === 'bogged' ? 0.12 : 0);

        // Stay in quaternion space end-to-end: assigning mesh.rotation.y
        // here re-derived euler angles from the tilted quaternion, and that
        // decomposition is discontinuous — past ~3/4 turn the x/z terms flip
        // by π and the mesh visibly snapped (the "flicker past 270°" bug).
        _tiltQuat.setFromUnitVectors(_up, normal);
        _yawQuat.setFromAxisAngle(_up, heading);
        _tiltQuat.multiply(_yawQuat);
        if (flipAnim > 0) {
            _rollQuat.setFromAxisAngle(_fwdAxis, flipSign * flipAnim * Math.PI * 0.52);
            _tiltQuat.multiply(_rollQuat);
        }
        mesh.quaternion.slerp(_tiltQuat, 1 - Math.exp(-12 * dt));

        // wheels roll from actual ground speed (signed — reverse spins
        // backward), steer with the input, and churn faster than the
        // ground speed while bogged in soft sand (visible slip). Downed
        // states spin the wheels from the rocking throttle instead — the
        // player's effort is visible on the hardware.
        if (condition === 'rolled') {
            wheelRig.update(dt, input.throttle * 4, 0, 1);
        } else if (condition === 'bogged') {
            wheelRig.update(dt, input.throttle * 5, input.steer, slipRatio);
        } else {
            wheelRig.update(dt, speed, input.steer, slipRatio);
        }
    }

    /** main.js feeds this each frame: another working unit is close
        enough to help right/tow the rover (passive proximity assist). */
    function setAssist(on) {
        assisted = !!on;
    }

    /** Debug/E2E overrides — forceStorm() spirit. */
    function forceRoll() {
        if (condition !== 'ok') return;
        condition = 'rolled';
        speed = 0;
        recoveryMeter = 0;
        lastThrottleSign = 0;
        swingGapT = Infinity;
    }
    function forceBog() {
        if (condition !== 'ok') return;
        condition = 'bogged';
        bogMeter = 1;
        speed = 0;
        recoveryMeter = 0;
        lastThrottleSign = 0;
        swingGapT = Infinity;
    }

    /** Repair at a base (main.js, while docked on a chargepad). The only way
        hull condition ever goes back up — nothing in the field heals it. */
    function repair(amount) {
        health = Math.min(100, health + amount);
    }

    /** One-off hull hit from outside the driving model (Wave 9.9: a hard
        landing after a fall). Same pricing as a boulder strike. */
    function takeImpact(speedMs) {
        if (speedMs <= IMPACT_SPD_MIN) return 0;
        const dmg = (speedMs - IMPACT_SPD_MIN) * IMPACT_DMG_K;
        health = Math.max(0, health - dmg);
        lastImpact = speedMs;
        return dmg;
    }

    /** Consume-on-read: main.js polls this to fire a one-shot impact cue. */
    function popImpact() {
        const v = lastImpact;
        lastImpact = 0;
        return v;
    }

    return {
        mesh, update, cycleGear, setAssist, forceRoll, forceBog,
        repair, takeImpact, popImpact,
        get position() { return mesh.position; },
        get heading() { return heading; },
        get atBoundary() { return atBoundary; },
        get inHazard() { return inHazard; },
        get slipRatio() { return slipRatio; },
        get rolloverRisk() { return rolloverRisk; },
        get health() { return health; },              // 0..100 hull condition
        set health(v) { health = Math.max(0, Math.min(100, v)); },  // E2E
        get condition() { return condition; },       // ok | rolled | bogged
        get bogMeter() { return bogMeter; },         // 0..1 sinking progress
        get recoveryMeter() { return recoveryMeter; }, // 0..1 while down
        get assistRange() { return ASSIST_RANGE; },
        get speed() { return speed; }, // signed current ground speed (inertia state)
        get maxSpeed() { return REAL_SPEED * GEARS[gearIdx].mult; },
        get gearLabel() { return GEARS[gearIdx].label; },
        get drainScale() { return GEARS[gearIdx].drain; },
    };
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

    // (no static wheels here — the spinning wheel rig from wheels.js is
    // laid out on the same corners by createRover)

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
