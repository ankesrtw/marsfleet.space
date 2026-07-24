/* ============================================================
   missions.js — per-site objective chains (generalizes the old
   tutorial.js single hardcoded chain; the tutorial now ships as
   mission 'tutorial' with the same 7 steps verbatim).

   Same philosophy as tutorial.js: this module owns NO game logic,
   only step pointers. main.js (which owns every relevant call
   site) announces what happened via advance(matchId[, value]) —
   a broadcast to every ACTIVE chain, so call sites never need to
   know which mission (if any) is listening, exactly like they
   never needed to know the old chain's position. No polling or
   condition machinery lives here.

   Step types:
   - action   { id, text }                 boolean gate — completes
                when advance(matchId) matches the current step id.
                (The whole tutorial is action steps.)
   - collect  { id, text, match, count }   running counter — every
                advance(matchId) where matchId starts with `match`
                bumps it; completes at `count`.
   - survey   { id, text, target }         scalar progress — completes
                when advance(id, value) reports value >= target
                (e.g. recon fog-coverage fraction).
   - rescue / tow: action-shaped by design — they gate on the same
     sling/deliver call sites, just dressed over a different
     narrative object. No new interaction code.

   Persistence: completion only, one flag per mission, PER SITE
   (saves.js Save(site.id) 'mission-<id>-done') — so a mission id
   shared across sites no longer collides. Survives RESET MISSION
   like the archive; in-progress state is session-only.
   ============================================================ */

import { Save } from './saves.js';

const MISSIONS = {
    tutorial: {
        id: 'tutorial',
        title: 'FIRST MISSION — REPORT TO ARIANA',
        autostart: true,
        steps: [
            // Plan 28: the sol opens at the field lab. Ariana (the lab
            // hologram) briefs you before anything else — main.js advances
            // this the moment her dialog triggers on approach.
            { type: 'action', id: 'report-ariana', text: 'REPORT TO ARIANA AT THE FIELD LAB FOR BRIEFING' },
            { type: 'action', id: 'drive', text: 'DRIVE TO THE NEAREST BEACON' },
            { type: 'action', id: 'collect', text: 'PRESS E TO COLLECT THE SAMPLE' },
            { type: 'action', id: 'switch', text: 'PRESS TAB TO SWITCH TO THE LIFT DRONE' },
            { type: 'action', id: 'sling', text: 'HOVER LOW OVER THE CACHE AND PRESS E TO SLING IT' },
            { type: 'action', id: 'deliver', text: 'FLY TO THE FIELD LAB PAD AND PRESS E TO DELIVER' },
            { type: 'action', id: 'analyze', text: 'WATCH THE EDGE NODE PROCESS YOUR SAMPLE' },
            { type: 'action', id: 'archive', text: 'OPEN THE MENU AND CHECK THE SCIENCE ARCHIVE' },
        ],
    },
    survey: {
        id: 'survey',
        title: 'SURVEY — AERIAL RECONNAISSANCE',
        steps: [
            // Wave 12.12: the far scout zone (Neretva Vallis, ~5.5km out) is
            // one-way range for the recon — the chain teaches the van loop
            // FIRST: drive out, deploy, and the fleet has a field base to
            // recharge at. advance('forward-base') fires from main.js when
            // the van deploys far from every base pad.
            { type: 'action', id: 'forward-base', text: 'ESTABLISH A FORWARD BASE — DEPLOY THE VAN AFIELD' },
            { type: 'action', id: 'switch-recon', text: 'SWITCH TO THE RECON DRONE (TAB)' },
            { type: 'survey', id: 'scan-zone', text: 'SCAN ALL SCOUT ZONES', target: 3 },
            { type: 'action', id: 'return-base', text: 'RETURN TO BASE' },
        ],
    },
    photo: {
        id: 'photo',
        title: 'PHOTO RECON — SURVEY IMAGING',
        steps: [
            // Wave 12.13: count must match the site's photoSpots length
            // (Jezero: 4). Captures broadcast as advance('photo:<spotId>')
            // from main.js on FIRST capture per spot this session, so the
            // collect counter can't be farmed off one butte.
            { type: 'action', id: 'switch-recon', text: 'SWITCH TO THE RECON DRONE (TAB)' },
            { type: 'collect', id: 'photo-count', match: 'photo:', count: 4, text: 'IMAGE ALL FOUR TARGETS FROM THE AIR (P)' },
            { type: 'action', id: 'return-base', text: 'RETURN TO BASE' },
        ],
    },
};

/** Resolve the two data-driven step counts — the survey scan target and the
    photo-recon collect count — from THIS site's arrays, so a site with a
    different number of survey zones / photo spots still gets a completable
    chain (plan 21). Clones the shared MISSIONS template so two sites never
    fight over one mutable object. */
function resolveMissions(site) {
    const zoneN = site.surveyZones?.length ?? 0;
    const spotN = site.photoSpots?.length ?? 0;
    const out = {};
    for (const [id, def] of Object.entries(MISSIONS)) {
        out[id] = {
            ...def,
            steps: def.steps.map((s) => {
                if (s.type === 'survey' && s.id === 'scan-zone')
                    return { ...s, target: zoneN || s.target };
                if (s.type === 'collect' && s.id === 'photo-count')
                    return { ...s, count: spotN || s.count,
                             text: `IMAGE ALL ${spotN || s.count} TARGETS FROM THE AIR (P)` };
                return s;
            }),
        };
    }
    return out;
}

export function createMissions(site, { onComplete, onStep } = {}) {
    // Only missions this site offers (sites.js `missions` field); a site
    // without the field simply has none. `defs` = this site's resolved copy
    // (data-driven survey/photo counts) — use it, never the raw template.
    const defs = resolveMissions(site);
    const available = (site.missions ?? []).filter((id) => defs[id]);
    const save = Save(site.id);

    const active = new Map();    // missionId -> { stepIdx, progress }
    const completed = new Set();
    for (const id of available) {
        if (save.get(`mission-${id}-done`)) completed.add(id);
    }

    function start(missionId) {
        const def = defs[missionId];
        if (!def || !available.includes(missionId)) return false;
        active.set(missionId, { stepIdx: 0, progress: 0 });
        return true;
    }

    function finish(missionId) {
        active.delete(missionId);
        completed.add(missionId);
        save.set(`mission-${missionId}-done`, 1);
        onComplete?.(missionId);
    }

    /** Step object the given active mission is currently on, or null. */
    function current(missionId) {
        const run = active.get(missionId);
        return run ? defs[missionId].steps[run.stepIdx] : null;
    }

    /** Banner feed: first active chain's position, or null when idle.
        Shaped for main.js's objective line ("3/7 · TEXT") + skip. */
    function currentAny() {
        for (const [missionId, run] of active) {
            return {
                missionId,
                title: defs[missionId].title,
                step: defs[missionId].steps[run.stepIdx],
                stepNum: run.stepIdx + 1,
                total: defs[missionId].steps.length,
            };
        }
        return null;
    }

    /** Broadcast: no-op for every active chain whose current step doesn't
        match — call sites just announce what happened (tutorial.js idiom,
        extended across chains). `value` only matters for survey steps. */
    function advance(matchId, value) {
        for (const [missionId, run] of active) {
            const step = defs[missionId].steps[run.stepIdx];
            let done = false;
            if (step.type === 'action' && step.id === matchId) {
                done = true;
            } else if (step.type === 'collect' && matchId.startsWith(step.match ?? step.id)) {
                run.progress += 1;
                done = run.progress >= step.count;
            } else if (step.type === 'survey' && step.id === matchId) {
                run.progress = value ?? 0;
                done = run.progress >= step.target;
            }
            if (!done) continue;
            run.stepIdx += 1;
            run.progress = 0;
            const steps = defs[missionId].steps;
            const last = run.stepIdx >= steps.length;
            // Wave 9.8: announce the transition, so the HUD can say what just
            // got done and what comes next. Still no game logic here — this is
            // the same broadcast, it just carries the step it crossed.
            onStep?.({
                missionId,
                title: defs[missionId].title,
                done: step,                       // the step just completed
                doneNum: run.stepIdx,             // 1-based number of that step
                next: last ? null : steps[run.stepIdx],
                nextNum: last ? null : run.stepIdx + 1,
                total: steps.length,
                complete: last,
            });
            if (last) finish(missionId);
        }
    }

    /** Skipping counts as done (old tutorial convention kept). */
    function skip(missionId) {
        if (active.has(missionId)) finish(missionId);
    }

    function isComplete(missionId) {
        return completed.has(missionId);
    }

    /** True once every mission this site offers is done (Wave 7 HQ gate).
        A site with no missions never reports true — nothing to complete. */
    function allComplete() {
        return available.length > 0 && available.every((id) => completed.has(id));
    }

    /** Menu MISSIONS section feed: every mission this site offers. */
    function menuEntries() {
        return available.map((id) => ({
            id,
            title: defs[id].title,
            done: completed.has(id),
            active: active.has(id),
        }));
    }

    return {
        start, advance, skip, current, currentAny, isComplete, allComplete, menuEntries,
        get activeMissions() { return [...active.keys()]; },
        // Autostart chains not yet completed — main.js starts these at boot
        // (the tutorial's old first-visit gate, generalized).
        get autostarts() {
            return available.filter((id) => defs[id].autostart && !completed.has(id));
        },
        // Step texts for the overview card (hud.js), per mission.
        stepTexts(missionId) {
            return defs[missionId]?.steps.map((s) => s.text) ?? [];
        },
        titleOf(missionId) {
            return defs[missionId]?.title ?? '';
        },
    };
}
