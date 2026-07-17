/* ============================================================
   chargepad.js — Wave 9: solar charging stations at every base.

   Why this exists (playtest bug #5, "the drone is not recharging at
   base"): ambient solar recharge already worked, but it is gated on
   env.daylight(), which is EXACTLY 0 for ~37% of the sol. A landed unit
   at night therefore has load = 0 (no drain) AND solarNow = 0 (no
   recharge) — a drone that flattens its battery after dusk is stranded
   at 0% with no recovery path until sunrise (~15 real minutes).

   A chargepad is the recovery path: park on it and it charges you fast
   and, crucially, WITHOUT the daylight gate — the station has its own
   power (battery bank behind the panels). That is the whole point of
   docking rather than just landing anywhere.

   Pads exist at the FIELD LAB from boot (the origin base — otherwise
   there is nowhere to charge before the first outpost is earned) and at
   each structure as it is built (outposts.js calls addPad).
   ============================================================ */

import * as THREE from 'three';
import { attachStaticModel } from './models.js';

const PAD_R = 3.6;        // visual disc radius (procedural fallback)
export const DOCK_R = 5.0; // dock trigger radius (a bit past the disc lip)
// chargepad.glb scales to a 10m footprint (models.js) — placement and the
// repair-bay ring must clear the REAL pad radius (~5.2m), not the fallback's.
const PAD_GLB_R = 5.3;

// Wave 9.5 repair bay, resited (playtest: the old fixed 5.5m offset put the
// 6m-footprint workshop ON the 10m GLB pad, overlapping deck and dock ring
// at every single base). Ring placement like every other structure: bay
// radius 3 + pad radius 5.3 + walking gap.
const BAY_RING = 10.5;
const BAY_R = 2.8;        // collision circle over the 6m-footprint workshop
const BAY_H = 4;

export function createChargepads(scene, terrain, rocks, colliders) {
    const pads = [];   // { x, z, group, ringMat, base }
    const repairBays = []; // { x, z } for minimap
    const group = new THREE.Group();
    group.name = 'chargepads';
    scene.add(group);

    const deckMat = new THREE.MeshStandardMaterial({ color: 0x3c3f45, roughness: 0.85, metalness: 0.2 });
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x8b8f96, roughness: 0.5, metalness: 0.6 });
    const cellMat = new THREE.MeshStandardMaterial({
        color: 0x16344e, roughness: 0.25, metalness: 0.7,
        emissive: 0x0b2036, emissiveIntensity: 0.35,
    });

    /** Procedural fallback for the repair bay — an open-fronted
        half-cylinder arch with a roof panel. Warm amber (#d6862e)
        distinguishes it from the pad's cyan and the station's teal. */
    function makeRepairBayFallback() {
        const g = new THREE.Group();
        const wallMat = new THREE.MeshStandardMaterial({ color: 0xd6862e, roughness: 0.7, metalness: 0.15 });
        const roofMat = new THREE.MeshStandardMaterial({ color: 0xc47a2a, roughness: 0.6, metalness: 0.2 });
        // Half-cylinder back wall (open front)
        const arch = new THREE.Mesh(
            new THREE.CylinderGeometry(2.4, 2.4, 3.6, 12, 1, true, 0, Math.PI),
            wallMat
        );
        arch.rotation.x = Math.PI / 2;
        arch.position.set(0, 1.8, 0);
        // Roof panel
        const roof = new THREE.Mesh(new THREE.BoxGeometry(4.8, 0.15, 2.6), roofMat);
        roof.position.set(0, 3.4, 0);
        g.add(arch, roof);
        return g;
    }

    /** Measure the REAL pad geometry once chargepad.glb swaps in: the GLB
        is a ~0.9m raised deck (r ~3.6) with solar panels standing ~1.6m at
        the rim — very different from the flat fallback disc. Raycast a
        polar grid to (a) resize the drivable deck record so units climb
        onto the platform instead of sinking 0.9m into it, and (b) register
        the raised rim panels as small static colliders so ground units
        can't drive through them. */
    function measureGlbPad(inner, x, z, gy, deck) {
        inner.updateMatrixWorld(true);
        const ray = new THREE.Raycaster();
        const down = new THREE.Vector3(0, -1, 0);
        const origin = new THREE.Vector3();
        const hitAt = (r, a) => {
            origin.set(x + Math.sin(a) * r, gy + 30, z + Math.cos(a) * r);
            ray.set(origin, down);
            const hit = ray.intersectObject(inner, true)[0];
            return hit ? hit.point.y - gy : 0;
        };
        const deckH = Math.max(hitAt(0, 0), hitAt(0.8, 0), hitAt(0.8, Math.PI));
        if (!(deckH > 0.05)) return; // flat GLB — fallback record already fits
        // deck radius: widen while most azimuths still read deck-flat
        let deckR = 1;
        for (let r = 1.4; r <= 5.4; r += 0.4) {
            let flat = 0;
            for (let i = 0; i < 8; i++) {
                const h = hitAt(r, (i / 8) * Math.PI * 2);
                if (Math.abs(h - deckH) < 0.3) flat++;
            }
            if (flat >= 6) deckR = r; else break;
        }
        deck.h = deckH;
        deck.r = deckR;
        // rim structures (solar panels): cluster raised samples past the deck
        const clusters = [];
        for (let r = deckR + 0.2; r <= 5.4; r += 0.4) {
            for (let i = 0; i < 24; i++) {
                const a = (i / 24) * Math.PI * 2;
                const h = hitAt(r, a);
                if (h < deckH + 0.35) continue;
                const px = x + Math.sin(a) * r, pz = z + Math.cos(a) * r;
                const c = clusters.find((k) => Math.hypot(k.x - px, k.z - pz) < 2.2);
                if (c) {
                    c.x = (c.x * c.n + px) / (c.n + 1);
                    c.z = (c.z * c.n + pz) / (c.n + 1);
                    c.n++;
                    c.h = Math.max(c.h, h);
                } else {
                    clusters.push({ x: px, z: pz, n: 1, h });
                }
            }
        }
        for (const c of clusters) colliders?.addStatic(c.x, c.z, 1.1, c.h + 0.3);
    }

    function addPad(x, z, blocked) {
        if (pads.some((p) => Math.hypot(p.x - x, p.z - z) < 2)) return null;
        const g = new THREE.Group();
        const gy = terrain.sampleHeight(x, z) + 0.02;
        g.position.set(x, gy, z);

        // Drivable-platform record (colliders.js): fallback disc height now,
        // re-measured from the real GLB when it lands (measureGlbPad).
        const deckRec = colliders?.addDeck(x, z, PAD_R, 0.14, 1.4);

        // Inner group holds the procedural pad until chargepad.glb swaps in
        // (models.js fallback-first idiom, Wave 11); the status ring lives on
        // the outer group so the swap can never take it down — outposts.js's
        // beacon idiom.
        const inner = new THREE.Group();

        // Landing deck
        const deck = new THREE.Mesh(new THREE.CylinderGeometry(PAD_R, PAD_R, 0.12, 24), deckMat);
        deck.position.y = 0.06;
        inner.add(deck);

        // Two solar wings on posts, tilted to the sky, clear of the deck so
        // a drone can settle on it.
        for (const side of [-1, 1]) {
            const post = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 1.9, 6), frameMat);
            post.position.set(side * (PAD_R + 0.7), 0.95, 0);
            const panel = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.08, 1.7), cellMat);
            panel.position.set(side * (PAD_R + 0.7), 1.95, 0);
            panel.rotation.z = side * -0.42;
            inner.add(post, panel);
        }
        g.add(inner);
        attachStaticModel(inner, 'chargepad', () => {
            if (deckRec) measureGlbPad(inner, x, z, gy, deckRec);
        });

        // Repair bay near the chargepad (Wave 9.5): the workshop that
        // explains dock-based repair. Sited on its own ring around the pad
        // (flattest of 8, clear of rocks + the shared occupancy test) and
        // registered as a static collider — it is a building, not a decal.
        let bBest = null;
        for (let i = 0; i < 8; i++) {
            const a = (i / 8) * Math.PI * 2 + Math.PI / 16;
            const bx = x + Math.sin(a) * BAY_RING;
            const bz = z + Math.cos(a) * BAY_RING;
            if (rocks?.collides(bx, bz, BAY_R + 0.5)) continue;
            if (blocked?.(bx, bz, BAY_R + 0.5)) continue;
            const slope = 1 - terrain.sampleNormal(bx, bz).y;
            if (!bBest || slope < bBest.slope) bBest = { x: bx, z: bz, slope };
        }
        const baySpot = bBest ?? { x: x + BAY_RING, z };
        const bayGroup = new THREE.Group();
        bayGroup.position.set(baySpot.x, terrain.sampleHeight(baySpot.x, baySpot.z), baySpot.z);
        const bayInner = new THREE.Group();
        bayInner.add(makeRepairBayFallback());
        bayGroup.add(bayInner);
        attachStaticModel(bayInner, 'repair-bay');
        group.add(bayGroup);
        colliders?.addStatic(baySpot.x, baySpot.z, BAY_R, BAY_H);
        repairBays.push({ x: baySpot.x, z: baySpot.z });

        // Status ring — dim idle, bright + pulsing while something charges.
        // Wave 11: sits OUTSIDE the deck at the DOCK_R trigger perimeter, on
        // the dark terrain — an additive glow is invisible on the bright GLB
        // deck (it washed out the moment chargepad.glb landed), and out here
        // it doubles as the "land inside this circle to dock" marker.
        const ringMat = new THREE.MeshBasicMaterial({
            color: 0x2ec4d6, transparent: true, opacity: 0.35,
            blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
        });
        const ring = new THREE.Mesh(new THREE.RingGeometry(DOCK_R - 0.1, DOCK_R + 0.55, 36), ringMat);
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 0.22;
        g.add(ring);

        group.add(g);
        const pad = { x, z, group: g, ringMat, base: 0.35 };
        pads.push(pad);
        return pad;
    }

    /** Site a pad on a ring around a base, flattest of 8 candidates and
        clear of boulders (outposts.js/lab.js placement idiom). Keeps the
        pad off the structure footprint and off the lab's delivery pad.
        `blocked` (Wave 11) adds the shared occupancy test from main.js. */
    function addPadNear(cx, cz, ring, blocked) {
        let best = null;
        for (let i = 0; i < 8; i++) {
            const a = (i / 8) * Math.PI * 2;
            const x = cx + Math.sin(a) * ring;
            const z = cz + Math.cos(a) * ring;
            // probe at the REAL (GLB) pad radius, not the fallback disc's —
            // a pad sited with 4.6m clearance overlapped mast legs at 5.2m
            if (rocks?.collides(x, z, PAD_GLB_R + 0.5)) continue;
            if (blocked?.(x, z, PAD_GLB_R + 0.5)) continue;
            const slope = 1 - terrain.sampleNormal(x, z).y;
            if (!best || slope < best.slope) best = { x, z, slope };
        }
        const spot = best ?? { x: cx + ring, z: cz };
        return addPad(spot.x, spot.z, blocked);
    }

    /** Nearest pad within DOCK_R of a world position, else null. */
    function padAt(pos) {
        let best = null, bestD = DOCK_R;
        for (const p of pads) {
            const d = Math.hypot(p.x - pos.x, p.z - pos.z);
            if (d < bestD) { best = p; bestD = d; }
        }
        return best;
    }

    /** Nearest pad at ANY range (Wave 9.3 travel: a base's own pad is the
        arrival spot, and it can sit up to its placement ring away). */
    function nearestTo(x, z) {
        let best = null, bestD = Infinity;
        for (const p of pads) {
            const d = Math.hypot(p.x - x, p.z - z);
            if (d < bestD) { best = p; bestD = d; }
        }
        return best;
    }

    let t = 0;
    /** activePads: Set of pads currently charging something (ring pulses). */
    function update(dt, activePads) {
        t += dt;
        const pulse = 0.55 + 0.45 * Math.sin(t * 4);
        for (const p of pads) {
            const live = activePads?.has(p);
            p.ringMat.opacity = live ? 0.35 + 0.55 * pulse : p.base;
            p.ringMat.color.setHex(live ? 0x5ee08a : 0x2ec4d6);  // green = charging
        }
    }

    return {
        addPad, addPadNear, padAt, nearestTo, update,
        get count() { return pads.length; },
        get list() { return pads; },
        get repairPositions() { return repairBays; },
    };
}
