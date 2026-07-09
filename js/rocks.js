/* ============================================================
   rocks.js — instanced rock field in a moving window.

   A fixed budget of instances (one draw call) is always spent
   within RADIUS of the active unit instead of being uselessly
   diluted over the whole 6-9km site (1100 rocks over 36km² is
   one rock per ~180m — invisible). Placement is a deterministic
   hash of the 25m grid cell each rock lives in, so a location
   always shows the same rocks no matter when you arrive or from
   where — drive away and back, same boulders.

   Size distribution is skewed hard toward pebbles with rare
   boulders, matching rover surface photos. Rocks settle into the
   terrain via sampleHeight.

   Collision: collides(x, z, radius) regenerates the 3x3 cells around
   the query point through the SAME deterministic cellRocks() the
   renderer uses (one source of truth — the "one height function, two
   call sites" discipline again) and blocks on anything boulder-sized.
   Ground units test their candidate position against it each frame.
   ============================================================ */

import * as THREE from 'three';

const CELL = 25;          // m grid
const RADIUS = 350;       // m window around the unit
const ROCKS_PER_CELL_MAX = 2;
const REBUILD_DIST = 60;  // m of travel before re-scatter

export function createRocks(site, terrain, quality) {
    const cellsAcross = Math.floor((RADIUS * 2) / CELL);
    const budget = cellsAcross * cellsAcross * ROCKS_PER_CELL_MAX;
    const dense = (quality.terrainSegments || 256) > 128;

    const geo = new THREE.DodecahedronGeometry(1, 0);
    const mat = new THREE.MeshStandardMaterial({
        color: 0x8a5c40,
        roughness: 0.95,
        metalness: 0.02,
        flatShading: true,
    });
    const mesh = new THREE.InstancedMesh(geo, mat, budget);
    mesh.name = 'rocks';
    mesh.frustumCulled = false; // window follows the camera anyway

    const siteSalt = site.id === 'jezero' ? 0x9e3779b9 : 0x1c69b3f5;
    // Deterministic per-cell PRNG: same cell -> same rocks, forever.
    function cellRand(cx, cz) {
        let s = (Math.imul(cx, 0x27d4eb2f) ^ Math.imul(cz, 0x165667b1) ^ siteSalt) | 0;
        return () => {
            s = (s + 0x6d2b79f5) | 0;
            let t = Math.imul(s ^ (s >>> 15), 1 | s);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    const m = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scl = new THREE.Vector3();
    const euler = new THREE.Euler();
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    const half = site.worldSize / 2 - 10;
    let lastX = Infinity, lastZ = Infinity;

    /** Deterministic rocks of one cell: [{x, z, sx, sy, sz, rx, ry, rz}].
        The single placement source for rendering AND collision. */
    function cellRocks(cx, cz) {
        const rand = cellRand(cx, cz);
        const n = dense
            ? (rand() < 0.75 ? ROCKS_PER_CELL_MAX : 1)
            : (rand() < 0.5 ? 1 : 0);
        const rocks = [];
        for (let k = 0; k < n; k++) {
            const x = (cx + rand()) * CELL;
            const z = (cz + rand()) * CELL;
            if (Math.abs(x) > half || Math.abs(z) > half) continue;
            const s = 0.1 + Math.pow(rand(), 3.4) * 2.2;
            rocks.push({
                x, z,
                sx: s * (0.7 + rand() * 0.6),
                sy: s * (0.45 + rand() * 0.4),
                sz: s * (0.7 + rand() * 0.6),
                rx: rand() * 0.5,
                ry: rand() * Math.PI * 2,
                rz: rand() * 0.5,
            });
        }
        return rocks;
    }

    function scatter(centerX, centerZ) {
        const c0x = Math.floor((centerX - RADIUS) / CELL);
        const c0z = Math.floor((centerZ - RADIUS) / CELL);
        let i = 0;
        for (let cz = c0z; cz < c0z + cellsAcross && i < budget; cz++) {
            for (let cx = c0x; cx < c0x + cellsAcross && i < budget; cx++) {
                for (const r of cellRocks(cx, cz)) {
                    if (i >= budget) break;
                    pos.set(r.x, terrain.sampleHeight(r.x, r.z) + r.sy * 0.35, r.z);
                    scl.set(r.sx, r.sy, r.sz);
                    euler.set(r.rx, r.ry, r.rz);
                    quat.setFromEuler(euler);
                    m.compose(pos, quat, scl);
                    mesh.setMatrixAt(i++, m);
                }
            }
        }
        while (i < budget) mesh.setMatrixAt(i++, zero);
        mesh.instanceMatrix.needsUpdate = true;
        lastX = centerX;
        lastZ = centerZ;
    }

    // Anything with a horizontal footprint under this radius is a pebble
    // the wheels/boots just roll over; bigger blocks stop ground units.
    const BLOCKING_ROCK_RADIUS = 0.45;

    /** True if a ground unit of `radius` at (x, z) would hit a boulder. */
    function collides(x, z, radius) {
        const ccx = Math.floor(x / CELL);
        const ccz = Math.floor(z / CELL);
        for (let cz = ccz - 1; cz <= ccz + 1; cz++) {
            for (let cx = ccx - 1; cx <= ccx + 1; cx++) {
                for (const r of cellRocks(cx, cz)) {
                    const rockR = Math.max(r.sx, r.sz);
                    if (rockR < BLOCKING_ROCK_RADIUS) continue;
                    const d = Math.hypot(x - r.x, z - r.z);
                    if (d < rockR * 0.85 + radius) return true;
                }
            }
        }
        return false;
    }

    /** Per frame with the active unit's position; re-scatters after travel. */
    function update(unitPos) {
        if (Math.hypot(unitPos.x - lastX, unitPos.z - lastZ) > REBUILD_DIST) {
            scatter(unitPos.x, unitPos.z);
        }
    }

    return { mesh, update, collides };
}
