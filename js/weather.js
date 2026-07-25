/* ============================================================
   weather.js — dust-storm timeline: one ramping 0..1 intensity
   scalar, owned here as a hazard concern (environment.js keeps
   owning base lighting/haze and never computes storms itself —
   main.js reads `intensity` each frame and drives FOG.density,
   solar recharge and the rover's storm drag from it).

   Same "single mutable value advanced per frame" shape as
   environment.js's SUN_DIR cycle. State machine: idle (random
   wait) -> ramp up -> peak hold -> decay -> idle. Timing
   constants live HERE (SLOPE_K/GEARS precedent — module tuning,
   not site data); sites.js only says whether a site has storms
   and how hard they peak: `hazards.dustStorm: { peakIntensity }`.
   No field = no storms, update() is a no-op. Both shipped sites
   define one (Jezero 0.7, Gale 0.6 — plan 21-B).

   forceStorm() is the manual override for E2E/debug — same
   spirit as env.toggleSol().
   ============================================================ */

const MIN_INTERVAL_S = 240;  // calm stretch between storms (randomized)
const MAX_INTERVAL_S = 600;
const RAMP_S = 25;           // clear -> peak
const PEAK_S = 55;           // held at peak
const DECAY_S = 40;          // peak -> clear

// Wave 6 storm wind: real MEDA numbers. The Jan 2022 Jezero storm
// measured winds to 20 m/s (and physically damaged the wind sensor);
// typical calm-day winds are a few m/s — below anything the drones
// feel, so wind is zero outside storms by design. Direction is a
// coherent regional flow that wanders slowly; gusts are a slow
// sinusoid pair (period ~7s/13s) rather than per-frame noise so the
// drift reads as weather, not jitter.
const WIND_PEAK = 20;        // m/s at intensity 1 (MEDA Jezero storm max)
const DIR_WANDER = 0.02;     // rad/s, storm-front direction drift
const GUST_DEPTH = 0.3;      // gust factor swings 1 +/- this

export function createWeather(site) {
    const cfg = site.hazards?.dustStorm ?? null;
    const peak = cfg?.peakIntensity ?? 0.7;

    let phase = 'idle';   // idle | ramp | peak | decay
    let t = 0;            // seconds into the current phase
    let wait = cfg ? nextInterval() : Infinity;
    let intensity = 0;
    let windDir = Math.random() * Math.PI * 2;  // world-plane bearing
    let gustT = 0;
    let windSpeed = 0;    // m/s, gusted

    function nextInterval() {
        return MIN_INTERVAL_S + Math.random() * (MAX_INTERVAL_S - MIN_INTERVAL_S);
    }

    function update(dt) {
        if (!cfg) return;
        t += dt;
        if (phase === 'idle') {
            if (t >= wait) { phase = 'ramp'; t = 0; }
        } else if (phase === 'ramp') {
            intensity = peak * Math.min(1, t / RAMP_S);
            if (t >= RAMP_S) { phase = 'peak'; t = 0; }
        } else if (phase === 'peak') {
            intensity = peak;
            if (t >= PEAK_S) { phase = 'decay'; t = 0; }
        } else if (phase === 'decay') {
            intensity = peak * Math.max(0, 1 - t / DECAY_S);
            if (t >= DECAY_S) {
                phase = 'idle';
                t = 0;
                wait = nextInterval();
                intensity = 0;
            }
        }

        // wind rides the same intensity scalar the fog/solar/drag all use
        gustT += dt;
        windDir += (Math.sin(gustT * 0.11) * 0.7 + 0.3) * DIR_WANDER * dt;
        const gust = 1 + GUST_DEPTH
            * (0.6 * Math.sin(gustT * (2 * Math.PI / 7)) + 0.4 * Math.sin(gustT * (2 * Math.PI / 13)));
        windSpeed = intensity * WIND_PEAK * gust;
    }

    /** Debug/E2E: start (or re-peak) a storm right now. */
    function forceStorm() {
        if (!cfg) return;
        phase = 'ramp';
        t = 0;
    }

    return {
        update, forceStorm,
        get intensity() { return intensity; },
        get active() { return phase !== 'idle'; },
        // storm wind, world plane (m/s) — zero in calm air by design
        get windSpeed() { return windSpeed; },
        get windDir() { return windDir; },
        get windX() { return Math.sin(windDir) * windSpeed; },
        get windZ() { return Math.cos(windDir) * windSpeed; },
    };
}
