/* ============================================================
   fog.js — drone-driven fog-of-war minimap.

   A 2D "explored" alpha buffer over the site footprint (256x256),
   independent of the terrain heightmap. Any unit's position stamps
   a soft reveal circle into it each frame. Rendered as a minimap:
   photo x relief hybrid base (site ortho, contrast-stretched +
   site-tinted + multiplied with a DEM hillshade sampled from the
   same terrain the physics uses), fog composited on top with
   destination-out reveal-holes, then always-visible overlays: unit
   dots (active = white + heading tick), FIELD LAB square, pulsing
   TGT ring, north arrow + scale bar. Display canvas runs at 2x the
   fog buffer so the furniture stays crisp in the 140px CSS tile.
   Same canvas-2D HUD idiom as this project's other games.
   ============================================================ */

const FOG_RES = 256;   // explored-alpha buffer
const MAP_RES = 512;   // display canvas (2x for crisp text/furniture)
const REVEAL_RADIUS_PX = 14;

// Cartographic hillshade: light from the NW sky, mild vertical
// exaggeration so 100m-scale relief reads at ~30m/px sampling.
const HILL_EXAG = 2.5;
const LIGHT = normalize3(-0.5, 0.75, -0.5);

function normalize3(x, y, z) {
    const m = Math.hypot(x, y, z);
    return [x / m, y / m, z / m];
}

export function createFog(site, minimapEl, terrain) {
    const worldSize = site.worldSize;

    const fogCanvas = document.createElement('canvas');
    fogCanvas.width = FOG_RES;
    fogCanvas.height = FOG_RES;
    const fogCtx = fogCanvas.getContext('2d');
    fogCtx.fillStyle = '#000';
    fogCtx.fillRect(0, 0, FOG_RES, FOG_RES);

    const displayCanvas = document.createElement('canvas');
    displayCanvas.width = MAP_RES;
    displayCanvas.height = MAP_RES;
    displayCanvas.className = 'mars-minimap-canvas';
    minimapEl.appendChild(displayCanvas);
    const displayCtx = displayCanvas.getContext('2d');

    // ---- photo x relief base, built once when the ortho arrives ----
    let baseCanvas = null;
    const baseImg = new Image();
    baseImg.src = site.textureUrl;
    baseImg.onload = () => { baseCanvas = buildBase(); };

    function buildBase() {
        const c = document.createElement('canvas');
        c.width = FOG_RES;
        c.height = FOG_RES;
        const ctx = c.getContext('2d');
        ctx.drawImage(baseImg, 0, 0, FOG_RES, FOG_RES);
        const img = ctx.getImageData(0, 0, FOG_RES, FOG_RES);
        const d = img.data;

        // real DEM heights on the same grid (CPU sampler, one-off cost)
        const H = new Float32Array(FOG_RES * FOG_RES);
        const cell = worldSize / FOG_RES;
        for (let j = 0; j < FOG_RES; j++) {
            const z = ((j + 0.5) / FOG_RES - 0.5) * worldSize;
            for (let i = 0; i < FOG_RES; i++) {
                const x = ((i + 0.5) / FOG_RES - 0.5) * worldSize;
                H[j * FOG_RES + i] = terrain.sampleHeight(x, z);
            }
        }

        // 2-98 percentile luminance stretch (the raw ortho crops are
        // low-contrast at this scale, Jezero's especially)
        const hist = new Uint32Array(256);
        for (let p = 0; p < d.length; p += 4) {
            hist[(d[p] * 77 + d[p + 1] * 150 + d[p + 2] * 29) >> 8]++;
        }
        const total = FOG_RES * FOG_RES;
        let lo = 0, hi = 255, acc = 0;
        for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= total * 0.02) { lo = v; break; } }
        acc = 0;
        for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc >= total * 0.02) { hi = v; break; } }
        const range = Math.max(1, hi - lo);

        const tint = site.tint ?? 0xffffff;
        const tr = ((tint >> 16) & 255) / 255, tg = ((tint >> 8) & 255) / 255, tb = (tint & 255) / 255;

        for (let j = 0; j < FOG_RES; j++) {
            for (let i = 0; i < FOG_RES; i++) {
                const k = j * FOG_RES + i;
                // central-difference gradient, clamped at the borders
                const iw = Math.max(0, i - 1), ie = Math.min(FOG_RES - 1, i + 1);
                const jn = Math.max(0, j - 1), js = Math.min(FOG_RES - 1, j + 1);
                const gx = (H[j * FOG_RES + ie] - H[j * FOG_RES + iw]) / ((ie - iw) * cell);
                const gz = (H[js * FOG_RES + i] - H[jn * FOG_RES + i]) / ((js - jn) * cell);
                const n = normalize3(-gx * HILL_EXAG, 1, -gz * HILL_EXAG);
                const shade = 0.55 + 0.45 * Math.max(0, n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2]);

                const p = k * 4;
                const lum = (d[p] * 77 + d[p + 1] * 150 + d[p + 2] * 29) >> 8;
                // luminance-ratio stretch preserves hue on color orthos
                const s = Math.min(2.5, Math.max(0.1,
                    (Math.min(255, Math.max(0, (lum - lo) * 255 / range)) + 8) / (lum + 8)));
                d[p] = Math.min(255, d[p] * s * tr * shade);
                d[p + 1] = Math.min(255, d[p + 1] * s * tg * shade);
                d[p + 2] = Math.min(255, d[p + 2] * s * tb * shade);
            }
        }
        ctx.putImageData(img, 0, 0);
        return c;
    }

    function worldToPx(x, z) {
        const u = (x / worldSize) + 0.5;
        const v = (z / worldSize) + 0.5;
        return { px: u * MAP_RES, py: v * MAP_RES };
    }

    function reveal(worldX, worldZ) {
        const px = ((worldX / worldSize) + 0.5) * FOG_RES;
        const py = ((worldZ / worldSize) + 0.5) * FOG_RES;
        const grad = fogCtx.createRadialGradient(px, py, 0, px, py, REVEAL_RADIUS_PX);
        grad.addColorStop(0, 'rgba(0,0,0,1)');
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        fogCtx.globalCompositeOperation = 'destination-out';
        fogCtx.fillStyle = grad;
        fogCtx.beginPath();
        fogCtx.arc(px, py, REVEAL_RADIUS_PX, 0, Math.PI * 2);
        fogCtx.fill();
        fogCtx.globalCompositeOperation = 'source-over';
    }

    /** extras: { lab: {x,z} | null, targetId: string | null } */
    function render(markerPositions, unitPositions, extras) {
        displayCtx.clearRect(0, 0, MAP_RES, MAP_RES);
        if (baseCanvas) {
            displayCtx.drawImage(baseCanvas, 0, 0, MAP_RES, MAP_RES);
        } else {
            displayCtx.fillStyle = '#3a1f14';
            displayCtx.fillRect(0, 0, MAP_RES, MAP_RES);
        }
        for (const m of markerPositions) {
            const { px, py } = worldToPx(m.x, m.z);
            displayCtx.fillStyle = m.collected ? '#5ee08a' : '#e0b95e';
            displayCtx.beginPath();
            displayCtx.arc(px, py, 6, 0, Math.PI * 2);
            displayCtx.fill();
        }
        // fog on top, still un-revealed = opaque black
        displayCtx.globalAlpha = 0.88;
        displayCtx.drawImage(fogCanvas, 0, 0, MAP_RES, MAP_RES);
        displayCtx.globalAlpha = 1;

        // ---- always-visible overlays (above the fog) ----

        // FIELD LAB: teal square — the delivery target is a known base
        if (extras?.lab) {
            const { px, py } = worldToPx(extras.lab.x, extras.lab.z);
            displayCtx.fillStyle = '#59d8c9';
            displayCtx.strokeStyle = 'rgba(0,0,0,0.7)';
            displayCtx.lineWidth = 2;
            displayCtx.fillRect(px - 5, py - 5, 10, 10);
            displayCtx.strokeRect(px - 5, py - 5, 10, 10);
        }

        // pulsing ring on the current TGT marker
        if (extras?.targetId) {
            const t = markerPositions.find((m) => m.id === extras.targetId);
            if (t) {
                const { px, py } = worldToPx(t.x, t.z);
                displayCtx.strokeStyle = `rgba(255, 235, 180, ${0.55 + 0.4 * Math.sin(performance.now() * 0.004)})`;
                displayCtx.lineWidth = 2.5;
                displayCtx.beginPath();
                displayCtx.arc(px, py, 12, 0, Math.PI * 2);
                displayCtx.stroke();
            }
        }

        // unit dots — you always know where your own units are, even in
        // unexplored terrain (sample markers stay fog-gated)
        if (unitPositions) {
            for (const u of unitPositions) {
                const { px, py } = worldToPx(u.x, u.z);
                displayCtx.fillStyle = u.active ? '#ffffff' : 'rgba(255,255,255,0.45)';
                displayCtx.strokeStyle = 'rgba(0,0,0,0.7)';
                displayCtx.lineWidth = 2;
                displayCtx.beginPath();
                displayCtx.arc(px, py, u.active ? 7 : 4, 0, Math.PI * 2);
                displayCtx.fill();
                displayCtx.stroke();
                if (u.active && u.heading != null) {
                    // forward travel dir = -[sin h, cos h] (unit convention)
                    const dx = -Math.sin(u.heading), dz = -Math.cos(u.heading);
                    displayCtx.strokeStyle = '#ffffff';
                    displayCtx.lineWidth = 3;
                    displayCtx.beginPath();
                    displayCtx.moveTo(px + dx * 8, py + dz * 8);
                    displayCtx.lineTo(px + dx * 16, py + dz * 16);
                    displayCtx.stroke();
                }
            }
        }

        // map furniture: north arrow (top-left) + scale bar (bottom-right)
        displayCtx.fillStyle = 'rgba(255,255,255,0.8)';
        displayCtx.strokeStyle = 'rgba(255,255,255,0.8)';
        displayCtx.font = 'bold 15px ui-monospace, monospace';
        displayCtx.fillText('N', 12, 26);
        displayCtx.lineWidth = 2.5;
        displayCtx.beginPath();
        displayCtx.moveTo(28, 26); displayCtx.lineTo(28, 12);
        displayCtx.moveTo(24, 17); displayCtx.lineTo(28, 12); displayCtx.lineTo(32, 17);
        displayCtx.stroke();
        const kmPx = (1000 / worldSize) * MAP_RES;
        const bx = MAP_RES - kmPx - 14, by = MAP_RES - 14;
        displayCtx.lineWidth = 2.5;
        displayCtx.beginPath();
        displayCtx.moveTo(bx, by - 5); displayCtx.lineTo(bx, by);
        displayCtx.lineTo(bx + kmPx, by); displayCtx.lineTo(bx + kmPx, by - 5);
        displayCtx.stroke();
        displayCtx.fillText('1 KM', bx + kmPx / 2 - 18, by - 9);
    }

    return { reveal, render };
}
