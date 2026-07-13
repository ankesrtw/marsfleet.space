/* ============================================================
   outposts.js — Wave 7 base-building: structures earned by play.

   Two tiers, both driven by state other modules already persist —
   there is deliberately NO new save format here:
   - Checkposts: a sample marked `outpost` in sites.js earns a small
     structure at its site once its analysis record exists in the
     science archive (analysis.js 'mc-results'). Archive survives
     RESET MISSION, so checkposts do too — bootstrap() re-derives
     them at boot instead of persisting a second copy of the truth.
   - Headquarters: sites.js `hq` builds near the FIELD LAB once every
     mission the site offers is complete (missions.js's own
     mc-mission-*-done flags — same derivation idea).

   Same idioms as lab.js: flattest-of-8-candidates placement clear
   of boulders, procedural fallback shell swapped for the real GLB
   via models.js attachStaticModel (checkpost.glb / hq.glb), additive
   beacon column for over-the-ridge findability, colliders.addStatic
   footprint. Sites without `outpost`/`hq` fields (Gale) no-op —
   Wave 4's copy-ready pattern.
   ============================================================ */

import * as THREE from 'three';
import { attachStaticModel } from './models.js';

// Collision circles sized to the models.js footprints (checkpost 6m,
// hq 22m), height ratio matching the station GLB's 15m -> 8.5m tall.
const CHECKPOST_R = 3.4;
const CHECKPOST_H = 4.5;
const HQ_R = 11.5;
const HQ_H = 13;
// Checkposts sit a short walk from their sample marker — present at the
// site without blocking the collect spot or the cache-drop area.
const CHECKPOST_RING = 14;
// HQ ring around the lab pad: far enough that the 11.5m footprint clears
// the pad skirt and the delivery approach, close enough to read as one base.
const HQ_RING = 25;
const BUILD_SECS = 3.2;

// Wave 9.3 name plates. A sprite is a fixed WORLD size, so a plate legible
// from the chase cam (12m back) is a speck from a drone at 400m — the scale
// is therefore stretched with camera distance, clamped so it neither shrinks
// away nor swallows the structure up close. LABEL_REF is the distance at
// which a plate renders at its true LABEL_H metres.
const LABEL_H = 3.0;      // m tall at LABEL_REF
const LABEL_REF = 55;     // m — reference camera distance
const LABEL_MIN = 0.85;
const LABEL_MAX = 7;

export function createOutposts(scene, site, terrain, rocks, colliders, labPos, onBuilt) {
    const defs = (site.samples ?? []).filter((s) => s.outpost);
    const built = new Map();  // id -> { id, name, kind, x, z, group }
    const rising = [];        // { group, t } build-in animations in flight
    const beacons = [];       // pulsing beacon materials
    const labels = [];        // { sprite, w, h } name plates (camera-scaled)

    /** Flattest of 8 candidates on a ring around an anchor, clear of
        boulders (lab.js's placement idiom). `blocked` optionally adds a
        statics-aware test (HQ must dodge the station dock + mast). */
    function findSpot(cx, cz, ring, clearR, blocked) {
        let best = null;
        for (let i = 0; i < 8; i++) {
            const a = (i / 8) * Math.PI * 2;
            const x = cx + Math.sin(a) * ring;
            const z = cz + Math.cos(a) * ring;
            if (rocks?.collides(x, z, clearR)) continue;
            if (blocked?.(x, z, clearR)) continue;
            const slope = 1 - terrain.sampleNormal(x, z).y;
            if (!best || slope < best.slope) best = { x, z, slope };
        }
        return best ?? { x: cx + ring, z: cz };
    }

    /** Procedural shell shown until the GLB loads (or forever offline) —
        lab.js's fallback-first idiom at each structure's scale. */
    function makeFallback(kind) {
        const g = new THREE.Group();
        const shellMat = new THREE.MeshStandardMaterial({ color: 0xd9d4c8, roughness: 0.6, metalness: 0.15 });
        const accentMat = new THREE.MeshStandardMaterial({ color: 0x2ec4d6, roughness: 0.45, metalness: 0.4 });
        if (kind === 'hq') {
            const core = new THREE.Mesh(new THREE.BoxGeometry(12, 7, 9), shellMat);
            core.position.y = 3.5;
            const wingL = new THREE.Mesh(new THREE.BoxGeometry(5, 4, 6), shellMat);
            wingL.position.set(-8.5, 2, 0);
            const wingR = wingL.clone();
            wingR.position.x = 8.5;
            const band = new THREE.Mesh(new THREE.BoxGeometry(12.1, 0.8, 9.1), accentMat);
            band.position.y = 5.6;
            g.add(core, wingL, wingR, band);
        } else {
            const cabin = new THREE.Mesh(new THREE.BoxGeometry(4, 2.6, 3), shellMat);
            cabin.position.y = 1.3;
            const roof = new THREE.Mesh(new THREE.BoxGeometry(4.3, 0.3, 3.3), accentMat);
            roof.position.y = 2.75;
            const mast = new THREE.Mesh(
                new THREE.CylinderGeometry(0.04, 0.06, 3, 6),
                new THREE.MeshStandardMaterial({ color: 0x777777 })
            );
            mast.position.set(1.6, 4.2, 1.1);
            g.add(cabin, roof, mast);
        }
        return g;
    }

    /** Canvas-textured billboard plate: base name over a dark chip with the
        brand-cyan rule under it, matching the HUD's card language. Sprites
        always face the camera, so no per-frame orientation work. */
    function makeLabel(text) {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const font = '600 44px ui-monospace, SFMono-Regular, Menlo, monospace';
        ctx.font = font;
        const padX = 26, padY = 16;
        canvas.width = Math.ceil(ctx.measureText(text).width) + padX * 2;
        canvas.height = 44 + padY * 2;

        // sizing the canvas resets its 2D state — restyle after the resize
        ctx.font = font;
        ctx.textBaseline = 'middle';
        ctx.fillStyle = 'rgba(20, 12, 8, 0.78)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#2ec4d6';
        ctx.fillRect(0, canvas.height - 5, canvas.width, 5);
        ctx.fillStyle = '#f2ece3';
        ctx.fillText(text, padX, canvas.height / 2 - 2);

        const tex = new THREE.CanvasTexture(canvas);
        tex.colorSpace = THREE.SRGBColorSpace;
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
            map: tex, transparent: true, depthWrite: false,
            // fog on: a plate 3km away must not float out of the haze as a
            // crisp readable chip — it fades with the structure it names
            fog: true,
        }));
        const h = LABEL_H;
        const w = h * (canvas.width / canvas.height);
        sprite.scale.set(w, h, 1);
        return { sprite, w, h };
    }

    function construct({ id, name, kind, x, z, animate }) {
        const group = new THREE.Group();
        group.name = `outpost-${id}`;
        group.position.set(x, terrain.sampleHeight(x, z), z);

        // Inner group holds fallback-then-GLB (attachStaticModel clears
        // its children on swap); the beacon lives on the outer group so
        // the swap never takes it down.
        const inner = new THREE.Group();
        inner.add(makeFallback(kind));
        group.add(inner);
        attachStaticModel(inner, kind);

        // Beacon column (waypoint/lab idiom). Checkposts glow faint brand
        // brand cyan for both — the HQ just gets a TALLER column so it's
        // findable from farther, not a different color (an amber additive
        // column washed the white structure gold — user chose cyan-both).
        // Low opacity + a base lifted clear of the roof keeps the structure
        // reading true white/bone rather than tinted by the additive glow.
        const hq = kind === 'hq';
        const beaconMat = new THREE.MeshBasicMaterial({
            color: 0x2ec4d6,
            transparent: true,
            opacity: hq ? 0.12 : 0.13,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide,
        });
        const beacon = new THREE.Mesh(
            new THREE.CylinderGeometry(hq ? 0.8 : 0.5, hq ? 0.35 : 0.2, hq ? 70 : 24, 10, 1, true),
            beaconMat
        );
        // Lift the column base above the structure roof (HQ ~13m, checkpost
        // ~4.5m tall) so the dense bottom of the glow doesn't wash the walls.
        beacon.position.y = hq ? 50 : 14;
        group.add(beacon);
        beacons.push({ mat: beaconMat, base: beaconMat.opacity, phase: beacons.length * 1.3 });

        // Name plate above the roof (Wave 9.3): the beacon says "a base is
        // over there", the plate says WHICH — the whole point once a site
        // has three of them up.
        const label = makeLabel(name.toUpperCase());
        label.sprite.position.y = hq ? 17 : 6.4;
        group.add(label.sprite);
        labels.push(label);

        scene.add(group);
        colliders.addStatic(x, z, hq ? HQ_R : CHECKPOST_R, hq ? HQ_H : CHECKPOST_H);

        if (animate) {
            group.scale.y = 0.01; // grounded at y=0, so y-growth reads as extrusion rising
            rising.push({ group, t: 0 });
        }
        const rec = { id, name, kind, x, z, group };
        built.set(id, rec);
        onBuilt?.(rec);   // Wave 9: main.js sites a chargepad beside it
        return rec;
    }

    /** Checkpost for one analyzed sample. Null when the sample has no
        outpost entry or it's already up — callers toast only on truthy. */
    function buildFor(sampleId, { animate = true } = {}) {
        const def = defs.find((s) => s.id === sampleId);
        if (!def || built.has(sampleId)) return null;
        const spot = findSpot(def.x, def.z, CHECKPOST_RING, CHECKPOST_R + 1);
        return construct({ id: sampleId, name: def.outpost.name, kind: 'checkpost', x: spot.x, z: spot.z, animate });
    }

    /** HQ capstone near the FIELD LAB — statics-aware spot pick so it
        dodges the station dock and mast (colliders facade, lab.js gap). */
    function buildHq({ animate = true } = {}) {
        if (!site.hq || built.has('hq') || !labPos) return null;
        const facade = colliders.forUnit('__outpost-build');
        const spot = findSpot(labPos.x, labPos.z, HQ_RING, HQ_R + 1.5,
            (x, z, r) => facade.collides(x, z, r));
        return construct({ id: 'hq', name: site.hq.name, kind: 'hq', x: spot.x, z: spot.z, animate });
    }

    /** Rebuild everything already earned — called once at boot with the
        persistent archive + mission flags. No animation: these existed. */
    function bootstrap(archiveRecords, missionsAllDone) {
        for (const rec of archiveRecords ?? []) {
            if (rec.site !== site.id) continue;
            buildFor(rec.id, { animate: false });
        }
        if (missionsAllDone) buildHq({ animate: false });
    }

    /** Menu BASE STRUCTURES feed: every structure this site offers. */
    function list() {
        const entries = defs.map((s) => ({
            id: s.id, name: s.outpost.name, kind: 'checkpost', built: built.has(s.id),
        }));
        if (site.hq) entries.push({ id: 'hq', name: site.hq.name, kind: 'hq', built: built.has('hq') });
        return entries;
    }

    /** Minimap layer (fog.js extras.outposts) — built structures only. */
    function builtPositions() {
        return [...built.values()].map((b) => ({ x: b.x, z: b.z, hq: b.kind === 'hq' }));
    }

    /** Wave 9.3 travel menu + comms bearings: built structures with names. */
    function builtList() {
        return [...built.values()].map((b) => ({ id: b.id, name: b.name, kind: b.kind, x: b.x, z: b.z }));
    }

    let t = 0;
    const _camPos = new THREE.Vector3();
    const _v = new THREE.Vector3();
    function update(dt, camera) {
        t += dt;
        for (const b of beacons) {
            b.mat.opacity = b.base * (0.7 + 0.3 * Math.sin(t * 1.6 + b.phase));
        }
        // Name plates hold a roughly constant on-screen size across the whole
        // range you actually read them from — the chase cam at 12m and a drone
        // 400m up the ridge.
        if (camera && labels.length) {
            camera.getWorldPosition(_camPos);
            for (const l of labels) {
                const d = _camPos.distanceTo(l.sprite.getWorldPosition(_v));
                const s = Math.min(LABEL_MAX, Math.max(LABEL_MIN, d / LABEL_REF));
                l.sprite.scale.set(l.w * s, l.h * s, 1);
            }
        }
        for (let i = rising.length - 1; i >= 0; i--) {
            const r = rising[i];
            r.t += dt;
            const k = Math.min(1, r.t / BUILD_SECS);
            r.group.scale.y = 1 - (1 - k) ** 3; // ease-out rise
            if (k >= 1) rising.splice(i, 1);
        }
    }

    return {
        buildFor, buildHq, bootstrap, list, builtPositions, builtList, update,
        get builtCount() { return built.size; },
    };
}
