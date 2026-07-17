/* ============================================================
   comms.js — Wave 9.4: the colony's relay network.

   Two halves of one idea (playtest #11): "when I'm flying the drone I
   have no idea which way the rover or the base is."

   1. BEARINGS — the GPS half. waypoint.js already points at ONE thing
      (the nearest uncollected sample) and the telemetry TGT arrow shows
      that one steer angle. This generalizes the same maths to N targets:
      every other unit, plus the nearest base. Two conventions, on
      purpose, each matching the readout it feeds:
        - compass ticks use the ABSOLUTE bearing (the dial is N-up, so a
          tick at the top means "that way is north of you")
        - the GPS card's arrows use the bearing RELATIVE to the nose
          (dead ahead = up), same as the existing TGT arrow — that is
          the one you steer by
   2. ANTENNAS — the in-world half. A relay mast at every base is the
      flavour justification for how the units know where each other are
      at all, and it gives the bases a silhouette on the skyline. Same
      fallback-first GLB pipeline as every other structure (models.js
      `antenna`), same findSpot() ring placement as chargepad.js.

   No signal-range gate: this is a wayfinding aid, not a difficulty
   layer. Nothing here can take control away from the player.
   ============================================================ */

import * as THREE from 'three';
import { attachStaticModel } from './models.js';

const MAST_H = 9;          // m — reads over a checkpost (4.5 m), under the HQ (13 m)
const BLINK_HZ = 0.55;     // aviation-style slow blink on the mast head

// Track colors. Deliberately NOT the compass needle's amber (#e0b95e) —
// the needle is your own nose, and a GPS tick must never be mistaken for
// it. Each track keeps the color it already has elsewhere in the game
// where one exists (drones cyan/teal like the beacons, bases green like
// a live chargepad ring).
export const TRACK_COLORS = {
    Rover: '#ff9d5c',
    Humanoid: '#f2ece3',
    'Recon Drone': '#2ec4d6',
    'Lift Drone': '#59d8c9',
    base: '#5ee08a',
};

/** Compass bearing (deg from north) of (tx,tz) as seen from (x,z).
    North is -Z: unit heading h travels along -[sin h, cos h] and the HDG
    readout is -h, so bearing = atan2(dx, -dz). Same convention as the
    wind needle in hud.js. */
export function bearingTo(x, z, tx, tz) {
    return ((Math.atan2(tx - x, -(tz - z)) * 180 / Math.PI) % 360 + 360) % 360;
}

/** Steer angle to (tx,tz) relative to the nose: 0 = dead ahead, +90 =
    hard right. (Lifted from main.js's TGT arrow maths, generalized.) */
export function relativeBearing(x, z, heading, tx, tz) {
    const abs = bearingTo(x, z, tx, tz);
    const nose = ((-heading * 180 / Math.PI) % 360 + 360) % 360;
    return ((abs - nose + 540) % 360) - 180;
}

export function createComms(scene, terrain, rocks, colliders) {
    const group = new THREE.Group();
    group.name = 'comms-antennas';
    scene.add(group);

    const masts = [];   // { x, z, lampMat, phase }

    const frameMat = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.45, metalness: 0.7 });
    const dishMat = new THREE.MeshStandardMaterial({ color: 0xe6e2d8, roughness: 0.6, metalness: 0.25 });

    /** Procedural relay mast — the visible art until antenna.glb lands
        (models.js swaps it in; a 404 keeps this, station.glb pattern). */
    function makeFallback() {
        const g = new THREE.Group();
        const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.22, MAST_H, 6), frameMat);
        mast.position.y = MAST_H / 2;
        g.add(mast);

        // guy struts — three legs, so it reads as engineered, not a pole
        for (let i = 0; i < 3; i++) {
            const a = (i / 3) * Math.PI * 2;
            const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 3.4, 5), frameMat);
            leg.position.set(Math.sin(a) * 0.75, 1.5, Math.cos(a) * 0.75);
            leg.rotation.set(Math.cos(a) * 0.42, 0, -Math.sin(a) * 0.42);
            g.add(leg);
        }

        // parabolic dish, tipped at the sky
        const dish = new THREE.Mesh(new THREE.SphereGeometry(1.3, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2.4), dishMat);
        dish.position.set(0, MAST_H * 0.72, 0);
        dish.rotation.set(-0.9, 0, 0);
        g.add(dish);

        const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.6, 5), frameMat);
        boom.position.set(0, MAST_H * 0.72, 0.55);
        boom.rotation.x = Math.PI / 2.4;
        g.add(boom);
        return g;
    }

    /** Site a mast on a ring around a base — flattest of 8 candidates,
        clear of boulders (chargepad.js / outposts.js placement idiom).
        `blocked` (Wave 11) adds the shared occupancy test from main.js
        so a mast can't rise on a pad or another structure. */
    function addMastNear(cx, cz, ring, blocked) {
        let best = null;
        for (let i = 0; i < 8; i++) {
            const a = (i / 8) * Math.PI * 2 + Math.PI / 8;  // offset from the pad ring
            const x = cx + Math.sin(a) * ring;
            const z = cz + Math.cos(a) * ring;
            if (rocks?.collides(x, z, 2)) continue;
            if (blocked?.(x, z, 2)) continue;
            const slope = 1 - terrain.sampleNormal(x, z).y;
            if (!best || slope < best.slope) best = { x, z, slope };
        }
        const spot = best ?? { x: cx + ring, z: cz };
        if (masts.some((m) => Math.hypot(m.x - spot.x, m.z - spot.z) < 3)) return null;

        const g = new THREE.Group();
        g.position.set(spot.x, terrain.sampleHeight(spot.x, spot.z), spot.z);

        // inner group holds fallback-then-GLB (attachStaticModel clears it
        // on swap); the lamp lives on the outer group so the swap can't
        // take it down — outposts.js's beacon idiom.
        const inner = new THREE.Group();
        inner.add(makeFallback());
        g.add(inner);
        attachStaticModel(inner, 'antenna');

        const lampMat = new THREE.MeshBasicMaterial({
            color: 0xff5a4a, transparent: true, opacity: 0.9,
            blending: THREE.AdditiveBlending, depthWrite: false,
        });
        const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 6), lampMat);
        lamp.position.y = MAST_H + 0.3;
        g.add(lamp);

        group.add(g);
        // Wave 11: the mast is a physical 9m tower — units shouldn't pass
        // through it, and registering it also keeps future structures off it.
        // Radius covers the GLB's ~3.2m guy-leg spread, not just the pole.
        colliders?.addStatic(spot.x, spot.z, 1.6, MAST_H + 0.5);
        const mast = { x: spot.x, z: spot.z, lampMat, phase: masts.length * 0.8 };
        masts.push(mast);
        return mast;
    }

    /** GPS feed for the HUD. `from` = the unit being driven (excluded from
        its own target list — you always know where you are); `others` =
        [{ name, position }]; `bases` = [{ id, name, x, z }] — only the
        NEAREST base is tracked, so the dial stays readable with 4 units
        and 5 bases up. */
    function track(from, heading, others, bases) {
        const { x, z } = from;
        const out = others.map((u) => ({
            id: u.name,
            label: u.name.toUpperCase(),
            color: TRACK_COLORS[u.name] ?? '#f2ece3',
            dist: Math.hypot(u.position.x - x, u.position.z - z),
            bearing: bearingTo(x, z, u.position.x, u.position.z),
            rel: relativeBearing(x, z, heading, u.position.x, u.position.z),
        }));

        let near = null;
        for (const b of bases ?? []) {
            const d = Math.hypot(b.x - x, b.z - z);
            if (!near || d < near.dist) near = { ...b, dist: d };
        }
        if (near) {
            out.push({
                id: `base:${near.id}`,
                label: near.name.toUpperCase(),
                color: TRACK_COLORS.base,
                dist: near.dist,
                bearing: bearingTo(x, z, near.x, near.z),
                rel: relativeBearing(x, z, heading, near.x, near.z),
            });
        }
        return out;
    }

    let t = 0;
    function update(dt) {
        t += dt;
        for (const m of masts) {
            // hard on/off blink, not a sine fade — a navigation light
            const on = ((t * BLINK_HZ + m.phase) % 1) < 0.35;
            m.lampMat.opacity = on ? 0.9 : 0.08;
        }
    }

    return {
        addMastNear, track, update,
        get count() { return masts.length; },
        get list() { return masts; },
    };
}
