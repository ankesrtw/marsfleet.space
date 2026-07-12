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
   No field = no storms, update() is a no-op (Gale untouched).

   forceStorm() is the manual override for E2E/debug — same
   spirit as env.toggleSol().
   ============================================================ */

const MIN_INTERVAL_S = 240;  // calm stretch between storms (randomized)
const MAX_INTERVAL_S = 600;
const RAMP_S = 25;           // clear -> peak
const PEAK_S = 55;           // held at peak
const DECAY_S = 40;          // peak -> clear

export function createWeather(site) {
    const cfg = site.hazards?.dustStorm ?? null;
    const peak = cfg?.peakIntensity ?? 0.7;

    let phase = 'idle';   // idle | ramp | peak | decay
    let t = 0;            // seconds into the current phase
    let wait = cfg ? nextInterval() : Infinity;
    let intensity = 0;

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
    };
}
