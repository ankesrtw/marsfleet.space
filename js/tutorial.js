/* ============================================================
   tutorial.js — first-mission onboarding chain.

   A single hardcoded linear step sequence (not a generic missions
   system — deliberately scoped down): drive to a sample -> collect
   -> switch to the lift drone -> sling the cache -> deliver to the
   FIELD LAB -> watch the edge node process it -> open the SCIENCE
   ARCHIVE. Every gate is an EXISTING main.js call site or per-frame
   value (collect, switchUnit, sling.attach, lab.deliver, analysis
   onDone, hud.isMenuOpen) — this module owns no game logic, only
   the step pointer. main.js calls advance(id) from those call sites;
   nothing here polls or duplicates state.
   ============================================================ */

const STEPS = [
    { id: 'drive', text: 'DRIVE TO THE NEAREST BEACON' },
    { id: 'collect', text: 'PRESS E TO COLLECT THE SAMPLE' },
    { id: 'switch', text: 'PRESS TAB TO SWITCH TO THE LIFT DRONE' },
    { id: 'sling', text: 'HOVER LOW OVER THE CACHE AND PRESS E TO SLING IT' },
    { id: 'deliver', text: 'FLY TO THE FIELD LAB PAD AND PRESS E TO DELIVER' },
    { id: 'analyze', text: 'WATCH THE EDGE NODE PROCESS YOUR SAMPLE' },
    { id: 'archive', text: 'OPEN THE MENU AND CHECK THE SCIENCE ARCHIVE' },
];

export function createTutorial({ onComplete } = {}) {
    let stepIdx = 0;
    let active = true;

    function current() {
        return active ? STEPS[stepIdx] : null;
    }

    /** No-op unless matchId is exactly the current step — call sites don't
        need to know the chain's position, just announce what happened. */
    function advance(matchId) {
        if (!active || STEPS[stepIdx].id !== matchId) return;
        stepIdx++;
        if (stepIdx >= STEPS.length) {
            active = false;
            onComplete?.();
        }
    }

    function skip() {
        active = false;
        onComplete?.();
    }

    return {
        current,
        advance,
        skip,
        get active() { return active; },
    };
}
