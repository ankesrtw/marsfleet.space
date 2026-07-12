/* ============================================================
   hazardZones.js — soft-terrain zones: continuous, typed hazard
   queries, deliberately NOT part of colliders.js.

   colliders.js is a binary blocking registry (in/out circle
   tests); a soft-sand patch doesn't block — it degrades. Same
   registry-plus-query shape as colliders, but sample() returns a
   graded effect instead of a boolean, so movement code can fold
   it into its existing multiplicative speed chain (rover.js
   speedFactor idiom) and the wheel rig can overspin against it.

   Zones come from sites.js `hazards.softSand: [{x, z, r,
   intensity}]` — a site without the field simply has none (the
   whole module no-ops, Gale untouched by design).

   Effect profile: full intensity through the zone core, linear
   ramp over the outer EDGE_BAND fraction of the radius — a
   hard-centered patch with a soft rim, so driving in reads as
   "sinking in", not a wall of molasses at the boundary line.
   ============================================================ */

const EDGE_BAND = 0.25; // outer fraction of r that ramps 0 -> full

export function createHazardZones(site) {
    const zones = [];
    for (const z of site.hazards?.softSand ?? []) {
        zones.push({ ...z, type: 'soft-sand' });
    }

    /** Strongest zone effect at (x, z), or null in the clear.
        effect = intensity x rim falloff, 0..1 — the number movement
        code multiplies against. */
    function sample(x, z) {
        let best = null;
        for (const zn of zones) {
            const d = Math.hypot(x - zn.x, z - zn.z);
            if (d >= zn.r) continue;
            const rim = (zn.r - d) / (zn.r * EDGE_BAND);
            const falloff = Math.min(1, rim);
            const effect = zn.intensity * falloff;
            if (!best || effect > best.effect) {
                best = { type: zn.type, intensity: zn.intensity, falloff, effect };
            }
        }
        return best;
    }

    return { sample, get zones() { return zones; } };
}
