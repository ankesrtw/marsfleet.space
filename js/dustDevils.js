/* ============================================================
   dustDevils.js — wandering convective vortices (Wave 6).

   Real MEDA statistics from Perseverance's first 250 sols shaped
   every constant here: ~4 vortices pass the rover per sol with
   >1/hour in the post-noon convective peak (game-compressed to
   minutes), diameters 5-500m (we render 10-30m columns), and
   rotational winds of 3-30 m/s — which is why the vortex wind
   this module injects tops out at 30 m/s, matching the fastest
   measured. Daylight-gated: convective vortices are a daytime
   phenomenon (surface heating), so nothing spawns at night.

   Same "single mutable timeline advanced per frame" shape as
   weather.js. Visuals are one shared THREE.Points pool (effects.js
   dust idiom) — particles orbit a rising helix per devil, so two
   devils cost one draw call. sampleWind(x, z) feeds the main.js
   wind facade that drones read; rovers ignore it (1/100 Earth air
   density — real vortices rock a rover's wind sensor, not the
   rover). Sites without `hazards.dustStorm` get none (Gale
   untouched, Wave 4 no-op convention).

   force(x, z) is the manual override for E2E/debug — forceStorm()
   spirit.
   ============================================================ */

import * as THREE from 'three';

const MAX_DEVILS = 2;          // perf cap (shared particle pool)
const SPAWN_MIN_S = 180;       // wait between spawns (randomized) ...
const SPAWN_MAX_S = 360;       // ... halved in the midday window
const MIDDAY_DAYLIGHT = 0.75;  // daylight() above this = convective peak
const MIN_DAYLIGHT = 0.35;     // below this no vortices form (night/dusk)
const LIFE_MIN_S = 60;
const LIFE_MAX_S = 120;
const RADIUS_MIN = 10;         // visual column radius, m
const RADIUS_MAX = 30;
const HEIGHT_MIN = 80;         // column height, m
const HEIGHT_MAX = 150;
const WALK_SPEED_MIN = 2;      // ground drift m/s (real: devils migrate
const WALK_SPEED_MAX = 4;      // with the ambient wind)
const HEADING_WANDER = 0.25;   // rad/s random walk
const VORTEX_SPEED = 30;       // m/s tangential at the core rim (MEDA max)
const WIND_R_MULT = 2.5;       // wind field reaches past the visible dust
const INWARD_PULL = 0.25;      // fraction of tangential speed, toward core
const FADE_S = 6;              // spawn/death dust fade
const PARTICLES_PER = 340;
const EDGE_MARGIN = 60;        // keep cores inside the mission boundary

// Wave 12.5 hazard early-warning: devils only appear on the minimap
// once the recon drone has flown within SCAN_R of them.
const SCAN_R = 200;            // m — recon must fly this close to scout a devil
const FADE_SOLS = 3;           // scouted devils stay visible for this many sols

export function createDustDevils(site, terrain, env, scene) {
    const enabled = !!site.hazards?.dustStorm;
    const bound = site.worldSize / 2 - EDGE_MARGIN;
    const devils = [];
    let devilIdSeq = 0;                        // auto-increment for scout tracking
    const scoutedDevils = new Map();           // id → { x, z, sol }
    let wait = nextWait();
    let t = 0;

    // ---- shared particle pool --------------------------------------------
    const POOL = MAX_DEVILS * PARTICLES_PER;
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(POOL * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
        color: 0xc9a27a,          // lofted dust, slightly lighter than haze
        size: 2.6,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
    });
    const points = new THREE.Points(geo, mat);
    points.name = 'dust-devils';
    points.frustumCulled = false; // two moving columns; not worth per-frame bounds
    points.visible = false;
    if (enabled) scene.add(points);

    // per-particle orbit state, fixed per slot (re-seeded on devil spawn)
    const slotAngle = new Float32Array(POOL);
    const slotRadius = new Float32Array(POOL);   // 0..1 of devil radius
    const slotHeight = new Float32Array(POOL);   // 0..1 of devil height
    const slotSpin = new Float32Array(POOL);     // rad/s

    function nextWait() {
        return SPAWN_MIN_S + Math.random() * (SPAWN_MAX_S - SPAWN_MIN_S);
    }

    function seedSlots(devilIdx) {
        const base = devilIdx * PARTICLES_PER;
        for (let i = 0; i < PARTICLES_PER; i++) {
            const k = base + i;
            slotAngle[k] = Math.random() * Math.PI * 2;
            // dust concentrates toward the wall of the vortex, not the core
            slotRadius[k] = 0.35 + 0.65 * Math.sqrt(Math.random());
            slotHeight[k] = Math.random();
            // angular speed falls with radius (solid-body core, trailing rim)
            slotSpin[k] = (1.6 + Math.random() * 0.8) / (0.4 + slotRadius[k]);
        }
    }

    function spawn(x, z) {
        if (devils.length >= MAX_DEVILS) return null;
        const d = {
            id: ++devilIdSeq,
            x: x ?? (Math.random() * 2 - 1) * bound,
            z: z ?? (Math.random() * 2 - 1) * bound,
            r: RADIUS_MIN + Math.random() * (RADIUS_MAX - RADIUS_MIN),
            h: HEIGHT_MIN + Math.random() * (HEIGHT_MAX - HEIGHT_MIN),
            heading: Math.random() * Math.PI * 2,
            walk: WALK_SPEED_MIN + Math.random() * (WALK_SPEED_MAX - WALK_SPEED_MIN),
            age: 0,
            life: LIFE_MIN_S + Math.random() * (LIFE_MAX_S - LIFE_MIN_S),
            slot: -1,
        };
        // claim the first free pool slot
        const used = new Set(devils.map((v) => v.slot));
        for (let s = 0; s < MAX_DEVILS; s++) {
            if (!used.has(s)) { d.slot = s; break; }
        }
        seedSlots(d.slot);
        devils.push(d);
        return d;
    }

    function update(dt) {
        if (!enabled) return;

        // spawn clock: daytime only, faster in the midday convective peak
        const day = env.daylight();
        if (day > MIN_DAYLIGHT) {
            t += day > MIDDAY_DAYLIGHT ? dt * 2 : dt;
            if (t >= wait) {
                t = 0;
                wait = nextWait();
                spawn();
            }
        }

        // advance + cull
        for (let i = devils.length - 1; i >= 0; i--) {
            const d = devils[i];
            d.age += dt;
            if (d.age >= d.life) { devils.splice(i, 1); continue; }
            d.heading += (Math.random() * 2 - 1) * HEADING_WANDER * dt;
            d.x += Math.sin(d.heading) * d.walk * dt;
            d.z += Math.cos(d.heading) * d.walk * dt;
            // reflect off the mission boundary instead of wandering out
            if (Math.abs(d.x) > bound) { d.x = THREE.MathUtils.clamp(d.x, -bound, bound); d.heading = -d.heading; }
            if (Math.abs(d.z) > bound) { d.z = THREE.MathUtils.clamp(d.z, -bound, bound); d.heading = Math.PI - d.heading; }
        }

        // write particles (only slots owned by live devils are shown;
        // dead slots collapse to a far-underground point)
        points.visible = devils.length > 0;
        if (points.visible) {
            positions.fill(0);
            for (let k = 0; k < POOL; k++) positions[k * 3 + 1] = -9999;
            for (const d of devils) {
                const groundY = terrain.sampleHeight(d.x, d.z);
                // fade the column in/out by pulling dust toward the ground
                const fade = Math.min(1, d.age / FADE_S, (d.life - d.age) / FADE_S);
                const base = d.slot * PARTICLES_PER;
                for (let i = 0; i < PARTICLES_PER; i++) {
                    const k = base + i;
                    slotAngle[k] += slotSpin[k] * dt;
                    // vortex taper: wider at the top, tight at the base
                    const hFrac = slotHeight[k];
                    const taper = 0.35 + 0.65 * hFrac;
                    const rr = d.r * slotRadius[k] * taper;
                    const p = k * 3;
                    positions[p] = d.x + Math.cos(slotAngle[k]) * rr;
                    positions[p + 1] = groundY + hFrac * d.h * fade + 0.5;
                    positions[p + 2] = d.z + Math.sin(slotAngle[k]) * rr;
                }
            }
            geo.attributes.position.needsUpdate = true;
        }
    }

    /** Vortex wind at (x, z) — tangential swirl + slight inward pull,
        m/s world plane. Zero outside every devil's wind radius. */
    function sampleWind(x, z) {
        let vx = 0, vz = 0;
        for (const d of devils) {
            const dx = x - d.x, dz = z - d.z;
            const dist = Math.hypot(dx, dz);
            const windR = d.r * WIND_R_MULT;
            if (dist >= windR || dist < 0.01) continue;
            const fade = Math.min(1, d.age / FADE_S, (d.life - d.age) / FADE_S);
            // solid-body up to the dust wall, 1/r style falloff outside it
            const s = dist < d.r ? dist / d.r : 1 - (dist - d.r) / (windR - d.r);
            const speed = VORTEX_SPEED * s * fade;
            const ux = dx / dist, uz = dz / dist;
            vx += -uz * speed - ux * speed * INWARD_PULL;
            vz += ux * speed - uz * speed * INWARD_PULL;
        }
        return { vx, vz };
    }

    /** Debug/E2E: spawn a devil right now (optionally at x, z). */
    function force(x, z) {
        if (!enabled) return null;
        return spawn(x, z);
    }

    /** Wave 12.5: recon drone scouts devils within range, marking them
        visible on the minimap for FADE_SOLS. */
    function scout(reconX, reconZ, sol) {
        for (const d of devils) {
            const dist = Math.hypot(d.x - reconX, d.z - reconZ);
            if (dist <= SCAN_R) {
                scoutedDevils.set(d.id, { x: d.x, z: d.z, r: d.r, sol });
            }
        }
    }

    /** Returns scouted devils still within the sol-based visibility window. */
    function getScoutedDevils(sol) {
        const result = [];
        for (const [id, entry] of scoutedDevils) {
            if (sol - entry.sol <= FADE_SOLS) {
                result.push({ x: entry.x, z: entry.z, r: entry.r });
            }
        }
        return result;
    }

    return {
        update, sampleWind, force, scout, getScoutedDevils,
        get devils() { return devils; },
    };
}
