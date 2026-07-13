/* ============================================================
   mars-clock.js — Wave 9.6: a Mars time-of-sol readout (#9).

   The design question this answers: the sim's day is COMPRESSED —
   environment.js runs a 40-real-minute sol (CYCLE_S), not Mars' real
   24h 39m 35s. Simulating true sol length would desync from the sun
   you can actually see in the sky and give the game two competing
   clocks, which informs nobody.

   So this is a DISPLAY, not a second time system: it reads the one
   phase environment.js already advances and dresses it as Mars local
   time. Noon is when the sun is at apex (phase = pi/2) — by
   construction, so the dial can never disagree with the sky. The
   compressed cycle stays exactly as it was; nothing about gameplay
   timing changes here.

   Sol NUMBER is anchored to the real mission: the site's landing epoch
   gives the sol Perseverance/Curiosity is actually on today (the same
   number the telemetry card already shows), and each in-game sol you
   play through ticks it forward by one. Land on sol 1442, play 40
   minutes, it reads 1443 — the site's real history plus your own.

   Telemetry's existing clock line stays: that one is mission-real
   (true sol length + session MET). This one is where the SUN is.
   ============================================================ */

import { SOL_MS } from './sites.js';

const TAU = Math.PI * 2;

/** Sol index for a phase, counted from midnights: the sun's apex is at
    phase = pi/2, so a sol boundary (midnight) falls a half-cycle away. */
function solIndex(phase) {
    return Math.floor((phase - Math.PI / 2) / TAU + 0.5);
}

/** Fraction through the sol, 0 = midnight, 0.5 = noon. */
function solFraction(phase) {
    const t = (phase - Math.PI / 2) / TAU + 0.5;
    return ((t % 1) + 1) % 1;
}

export function createMarsClock(site, env) {
    // Real sol the mission is on today (same maths as the telemetry line),
    // used as the anchor the in-game cycle counts up from.
    const missionSol = Math.floor((Date.now() - Date.parse(site.landingUtc)) / SOL_MS);
    const bootSolIndex = solIndex(env.phase);

    /** { sol, time 'HH:MM', glyph, phase 0..1, day 0..1, locked } */
    function read() {
        const phase = env.phase;
        const f = solFraction(phase);
        const mins = Math.floor(f * 24 * 60);          // 24 "Mars hours" per sol
        const hh = String(Math.floor(mins / 60)).padStart(2, '0');
        const mm = String(mins % 60).padStart(2, '0');
        const day = env.daylight();
        return {
            sol: missionSol + (solIndex(phase) - bootSolIndex),
            time: `${hh}:${mm}`,
            // full sun / twilight band / night — matches what daylight()
            // already gates (solar recharge dies in the same band)
            glyph: day > 0.75 ? '☀' : day > 0.05 ? '◑' : '☾',
            phase: f,
            day,
            locked: !env.cycling,
        };
    }

    return { read, get missionSol() { return missionSol; } };
}
