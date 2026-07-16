/* ============================================================
   effects.js — blob shadows, drive dust, rover wheel tracks.

   All three are cheap fakes chosen deliberately over shadow maps:
   the terrain is a custom displacement ShaderMaterial (no lighting/
   shadow chunks), so real THREE shadows would need depth-material
   surgery for a scene with exactly three casters. Blob discs conform
   to the terrain normal and read correctly at chase-cam distance,
   on SwiftShader E2E boxes and phones alike.

   Dust: one THREE.Points pool; particles spawn behind the active
   ground unit while it moves, rise/expand/fade over ~1.2s.

   Tracks: a fixed vertex pool (two quads per laid segment, one per
   wheel strip) written ring-buffer style — oldest segments are
   overwritten instead of faded, so no per-vertex alpha plumbing.
   ============================================================ */

import * as THREE from 'three';

const DUST_MAX = 220;
const DUST_LIFE = 1.2;
const TRACK_SEGMENTS = 400;     // per-strip pool; ~0.8m each ≈ 320m of trail
const TRACK_STEP = 0.8;         // meters of travel per laid segment
const TRACK_HALF_GAUGE = 0.95;  // rover wheel strips sit at ±gauge
const TRACK_WIDTH = 0.34;

export function createEffects(scene, terrain) {
    // ---- blob shadows ----------------------------------------------------
    const shadowTex = makeRadialTexture();
    const shadows = [];

    function addShadow(unitMesh, radius, isFlyer = false) {
        const mesh = new THREE.Mesh(
            new THREE.CircleGeometry(radius, 20),
            new THREE.MeshBasicMaterial({
                // black disc, alpha from the radial map — the map's RGB is
                // white, so color MUST stay black or the "shadow" glows
                color: 0x000000,
                map: shadowTex,
                transparent: true,
                opacity: 0.42,
                depthWrite: false,
                polygonOffset: true,
                polygonOffsetFactor: -2,
            })
        );
        mesh.rotation.x = -Math.PI / 2;
        mesh.renderOrder = 1;
        scene.add(mesh);
        shadows.push({ mesh, unitMesh, radius, isFlyer });
    }

    const _up = new THREE.Vector3(0, 1, 0);
    const _n = new THREE.Vector3();
    const _q = new THREE.Quaternion();

    function updateShadows() {
        for (const s of shadows) {
            const p = s.unitMesh.position;
            const groundY = terrain.sampleHeight(p.x, p.z);
            _n.copy(terrain.sampleNormal(p.x, p.z));
            s.mesh.position.set(p.x, groundY + 0.08, p.z);
            s.mesh.quaternion.copy(_q.setFromUnitVectors(_up, _n));
            // CircleGeometry faces +Z; after normal-align, spin it flat.
            s.mesh.rotateX(-Math.PI / 2);
            if (s.isFlyer) {
                const h = Math.max(0, p.y - groundY);
                s.mesh.material.opacity = 0.38 * Math.max(0, 1 - h / 45);
                const grow = 1 + h * 0.03;
                s.mesh.scale.setScalar(grow);
            }
        }
    }

    // ---- dust ------------------------------------------------------------
    const dustGeo = new THREE.BufferGeometry();
    const dustPos = new Float32Array(DUST_MAX * 3);
    dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
    const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({
        map: shadowTex,
        color: 0x8f6b4d,
        size: 1.6,
        transparent: true,
        opacity: 0.45,
        depthWrite: false,
        sizeAttenuation: true,
    }));
    dust.frustumCulled = false;
    scene.add(dust);
    // per-particle state; life<=0 = free slot (parked far underground)
    const particles = Array.from({ length: DUST_MAX }, () => ({ life: 0, vx: 0, vy: 0, vz: 0 }));
    for (let i = 0; i < DUST_MAX; i++) dustPos[i * 3 + 1] = -1e6;
    let spawnAccum = 0;

    function spawnDust(x, y, z, count) {
        for (let i = 0; i < DUST_MAX && count > 0; i++) {
            const pt = particles[i];
            if (pt.life > 0) continue;
            pt.life = DUST_LIFE * (0.6 + Math.random() * 0.4);
            pt.vx = (Math.random() - 0.5) * 1.6;
            pt.vy = 0.8 + Math.random() * 1.2;
            pt.vz = (Math.random() - 0.5) * 1.6;
            dustPos[i * 3] = x + (Math.random() - 0.5) * 1.2;
            dustPos[i * 3 + 1] = y + 0.2;
            dustPos[i * 3 + 2] = z + (Math.random() - 0.5) * 1.2;
            count--;
        }
    }

    function updateDust(dt, active, speed) {
        // spawn behind the active ground unit proportionally to speed
        if (active && active.kind === 'ground' && speed > 1.5) {
            spawnAccum += dt * Math.min(speed, 14) * 1.4;
            const p = active.unit.position;
            const h = active.unit.heading;
            while (spawnAccum >= 1) {
                spawnAccum -= 1;
                // units travel along -[sin h, cos h] under forward input,
                // so "behind" is +[sin h, cos h]
                spawnDust(p.x + Math.sin(h) * 1.4, p.y, p.z + Math.cos(h) * 1.4, 1);
            }
        }
        for (let i = 0; i < DUST_MAX; i++) {
            const pt = particles[i];
            if (pt.life <= 0) continue;
            pt.life -= dt;
            if (pt.life <= 0) { dustPos[i * 3 + 1] = -1e6; continue; }
            dustPos[i * 3] += pt.vx * dt;
            dustPos[i * 3 + 1] += pt.vy * dt;
            dustPos[i * 3 + 2] += pt.vz * dt;
            pt.vy *= 1 - 1.6 * dt; // buoyancy decay
        }
        dustGeo.attributes.position.needsUpdate = true;
    }

    // ---- rover wheel tracks ------------------------------------------------
    // Two strips (left/right wheels), each a ring buffer of quads in one
    // non-indexed BufferGeometry (6 verts per segment).
    const trackGeo = new THREE.BufferGeometry();
    const trackPos = new Float32Array(TRACK_SEGMENTS * 2 * 6 * 3);
    trackPos.fill(-1e6);
    trackGeo.setAttribute('position', new THREE.BufferAttribute(trackPos, 3));
    const tracks = new THREE.Mesh(trackGeo, new THREE.MeshBasicMaterial({
        color: 0x2e1a10,
        transparent: true,
        opacity: 0.33,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        side: THREE.DoubleSide,
    }));
    tracks.frustumCulled = false;
    tracks.renderOrder = 1;
    scene.add(tracks);

    let cursor = 0;
    const lastLaid = new THREE.Vector3(Infinity, 0, Infinity);

    function layTrackQuad(cx, cz, heading, offset, slot) {
        // quad = short strip segment perpendicular to travel, hugging terrain
        const fx = Math.sin(heading), fz = Math.cos(heading);   // travel axis
        const rx = fz, rz = -fx;                                 // lateral axis
        const wx = cx + rx * offset, wz = cz + rz * offset;
        const hw = TRACK_WIDTH / 2, hl = TRACK_STEP / 2 + 0.05;
        const corners = [
            [wx - rx * hw - fx * hl, wz - rz * hw - fz * hl],
            [wx + rx * hw - fx * hl, wz + rz * hw - fz * hl],
            [wx + rx * hw + fx * hl, wz + rz * hw + fz * hl],
            [wx - rx * hw + fx * hl, wz - rz * hw + fz * hl],
        ].map(([x, z]) => [x, terrain.sampleHeight(x, z) + 0.05, z]);
        const tri = [0, 1, 2, 0, 2, 3];
        for (let v = 0; v < 6; v++) {
            const [x, y, z] = corners[tri[v]];
            const base = (slot * 6 + v) * 3;
            trackPos[base] = x; trackPos[base + 1] = y; trackPos[base + 2] = z;
        }
    }

    function updateTracks(active) {
        if (!active || active.unit.mesh?.name !== 'rover') return;
        const p = active.unit.position;
        if (lastLaid.distanceTo(p) < TRACK_STEP) return;
        lastLaid.copy(p);
        const h = active.unit.heading;
        layTrackQuad(p.x, p.z, h, -TRACK_HALF_GAUGE, cursor * 2);
        layTrackQuad(p.x, p.z, h, +TRACK_HALF_GAUGE, cursor * 2 + 1);
        cursor = (cursor + 1) % TRACK_SEGMENTS;
        trackGeo.attributes.position.needsUpdate = true;
    }

    // ---- humanoid EVA tether (Wave 9.5) ----------------------------------
    // A THREE.Line drawn between the humanoid and its tether anchor (the
    // nearest base or rover), with a 3-point catenary approximation.
    // Buffer is allocated once and mutated in place each frame.
    const TETHER_POS = new Float32Array(9); // 3 points × xyz
    const tetherGeo = new THREE.BufferGeometry();
    tetherGeo.setAttribute('position', new THREE.BufferAttribute(TETHER_POS, 3));
    const tetherMat = new THREE.LineDashedMaterial({
        color: 0x2ec4d6, dashSize: 0.7, gapSize: 0.5,
        transparent: true, opacity: 0.7, depthWrite: false,
    });
    const tetherLine = new THREE.Line(tetherGeo, tetherMat);
    tetherLine.frustumCulled = false;
    tetherLine.visible = false;
    tetherLine.renderOrder = 2;
    scene.add(tetherLine);

    function updateTether(start, end, taut = false) {
        if (!start || !end) {
            tetherLine.visible = false;
            return;
        }
        tetherLine.visible = true;
        // Simple catenary approximation: mid-point droop below both ends.
        const droop = taut ? 0.15 : 1.2;
        TETHER_POS[0] = start.x;  TETHER_POS[1] = start.y;  TETHER_POS[2] = start.z;
        TETHER_POS[3] = (start.x + end.x) / 2;
        TETHER_POS[4] = Math.min(start.y, end.y) + droop;
        TETHER_POS[5] = (start.z + end.z) / 2;
        TETHER_POS[6] = end.x;    TETHER_POS[7] = end.y;    TETHER_POS[8] = end.z;
        tetherGeo.attributes.position.needsUpdate = true;
        tetherLine.computeLineDistances();
        tetherMat.opacity = taut ? 1.0 : 0.7;
        tetherMat.color.setHex(taut ? 0xe07b39 : 0x2ec4d6);
    }

    function update(dt, active, speed, daylight = 1) {
        updateShadows();
        updateDust(dt, active, speed);
        updateTracks(active);
        // dust, tracks and shadows are unlit — track the sol cycle by hand
        // so none of them glow against the night terrain (an unlit alpha
        // overlay LIGHTENS ground that is darker than its own color)
        dust.material.opacity = 0.45 * Math.max(0.1, daylight);
        tracks.material.opacity = 0.33 * daylight;
        for (const s of shadows) {
            if (!s.isFlyer) s.mesh.material.opacity = 0.42 * (0.25 + 0.75 * daylight);
        }
    }

    return { addShadow, update, updateTether, _dust: dust, _tracks: tracks };
}

/** Soft radial falloff canvas — shared by blob shadows and dust sprites. */
function makeRadialTexture(size = 64) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.6, 'rgba(255,255,255,0.55)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    return new THREE.CanvasTexture(canvas);
}
