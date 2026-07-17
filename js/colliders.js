/* ============================================================
   colliders.js — one obstacle registry for everything that blocks
   horizontal movement: boulders (rocks.js), static structures
   (FIELD LAB dome/airlock/mast) and the other units themselves.

   Same circle-test idiom as rocks.collides — no physics engine.
   Each unit gets a forUnit() facade shaped exactly like the rocks
   collider (collides(x, z, radius)), so rover/humanoid keep their
   existing "blocked entry, never trapped" logic unchanged and the
   drones share it for low-altitude flight.

   Altitude-aware: statics carry a height (m above local ground) so
   an airborne drone overflies the 3m dome but cannot fly through
   it; units collide only when their altitude bands overlap (a
   cruising drone passes over the rover, a hovering one cannot
   push through it).
   ============================================================ */

// Units closer than this vertically share an altitude band and collide.
const VERTICAL_CLEAR = 2.2;
// Below this AGL a drone also collides with boulders (rock heights
// top out around 2m — above that it is clear of the rock field).
const ROCK_CEILING = 2.0;

export function createColliders(rocks) {
    const statics = []; // { x, z, r, h } — h = m above local ground
    const decks = [];   // { x, z, r, h, ramp } — drivable raised platforms
    const units = new Map(); // name -> { position, radius, alt() }

    function addStatic(x, z, r, h = Infinity) {
        statics.push({ x, z, r, h });
    }

    /** Drivable platform (chargepad deck, lab landing pad): units RIDE ON
        it rather than clip through it. Height is full inside r and ramps
        to 0 across `ramp` metres outside — the ramp keeps the rover's
        ground-rise rate below its launch threshold, so climbing a deck
        reads as rolling up a skirt, not popping. Returns the (mutable)
        record so callers can re-measure it once a GLB swaps in. */
    function addDeck(x, z, r, h, ramp = 1.2) {
        const deck = { x, z, r, h, ramp };
        decks.push(deck);
        return deck;
    }

    /** Extra ground height from any deck under (x, z) — 0 in the open. */
    function deckHeight(x, z) {
        let h = 0;
        for (const d of decks) {
            const dist = Math.hypot(x - d.x, z - d.z);
            if (dist >= d.r + d.ramp) continue;
            const k = dist <= d.r ? 1 : 1 - (dist - d.r) / d.ramp;
            if (d.h * k > h) h = d.h * k;
        }
        return h;
    }

    /** entry = { position: live Vector3, radius: m, alt: () => m AGL }.
        Ground units register alt: () => 0. */
    function register(name, entry) {
        units.set(name, entry);
    }

    function hits(selfName, x, z, radius) {
        const self = units.get(selfName);
        const selfAlt = self ? self.alt() : 0;
        for (const s of statics) {
            if (selfAlt >= s.h) continue;
            if (Math.hypot(x - s.x, z - s.z) < s.r + radius) return true;
        }
        for (const [name, u] of units) {
            if (name === selfName) continue;
            if (Math.abs(selfAlt - u.alt()) >= VERTICAL_CLEAR) continue;
            if (Math.hypot(x - u.position.x, z - u.position.z) < u.radius + radius) return true;
        }
        return false;
    }

    /** rocks.collides-shaped facade for one unit — drop-in for the
        `rocks` param the ground units already take. deckHeight rides
        along so every mover grounds itself on drivable platforms. */
    function forUnit(name) {
        return {
            collides(x, z, r) {
                const self = units.get(name);
                const selfAlt = self ? self.alt() : 0;
                if (selfAlt < ROCK_CEILING && rocks?.collides(x, z, r)) return true;
                return hits(name, x, z, r);
            },
            deckHeight,
        };
    }

    return { addStatic, addDeck, deckHeight, register, forUnit };
}
