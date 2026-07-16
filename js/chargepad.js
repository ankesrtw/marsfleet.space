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

const PAD_R = 3.6;        // visual disc radius
export const DOCK_R = 5.0; // dock trigger radius (a bit past the disc lip)

// Wave 9.5: repair bay sits beside its chargepad, offset slightly
// so the workshop reads as a separate structure next to the landing disc.
const REPAIR_BAY_OFFSET = 5.5;

export function createChargepads(scene, terrain, rocks) {
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

    function addPad(x, z) {
        if (pads.some((p) => Math.hypot(p.x - x, p.z - z) < 2)) return null;
        const g = new THREE.Group();
        g.position.set(x, terrain.sampleHeight(x, z) + 0.02, z);

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
        attachStaticModel(inner, 'chargepad');

        // Repair bay beside the chargepad (Wave 9.5). A small workshop
        // that provides the in-world explanation for dock-based repair.
        // Built alongside every pad — one bay per base.
        const bayGroup = new THREE.Group();
        const bx = x + Math.cos(Math.PI / 4) * REPAIR_BAY_OFFSET;
        const bz = z + Math.sin(Math.PI / 4) * REPAIR_BAY_OFFSET;
        bayGroup.position.set(bx, terrain.sampleHeight(bx, bz), bz);
        const bayInner = new THREE.Group();
        bayInner.add(makeRepairBayFallback());
        bayGroup.add(bayInner);
        attachStaticModel(bayInner, 'repair-bay');
        group.add(bayGroup);
        repairBays.push({ x: bx, z: bz });

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
            if (rocks?.collides(x, z, PAD_R + 1)) continue;
            if (blocked?.(x, z, PAD_R + 1)) continue;
            const slope = 1 - terrain.sampleNormal(x, z).y;
            if (!best || slope < best.slope) best = { x, z, slope };
        }
        const spot = best ?? { x: cx + ring, z: cz };
        return addPad(spot.x, spot.z);
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
