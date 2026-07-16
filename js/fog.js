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

// Science overlays (Wave 4): which base layer render() draws. PATH keeps
// the photo base and adds the breadcrumb trail. Persisted like the other
// small UI prefs (mc-tele / mc-dronectl).
const OVERLAY_MODES = ['photo', 'elevation', 'slope', 'path'];
const LS_OVERLAY = 'mc-overlay-mode';

// Hypsometric ramp (elevation) and a slope ramp aligned with the rover's
// ROLL gauge thresholds (green safe -> amber -> red past ~35 deg), so map
// and telemetry speak the same color language.
const ELEV_STOPS = [
    [0.00, 0x20, 0x31, 0x3f],
    [0.35, 0x5b, 0x4a, 0x33],
    [0.70, 0xa9, 0x71, 0x3f],
    [1.00, 0xe8, 0xc8, 0x8f],
];
const SLOPE_STOPS = [ // t in slopeMag (1 - normal.y) space
    [0.00, 0x2f, 0x7d, 0x4f],
    [0.05, 0x88, 0xb3, 0x4a], // ROLL_START — risk begins
    [0.11, 0xd8, 0xa1, 0x3f],
    [0.18, 0xc0, 0x39, 0x2b], // ROLL_MAX — flagged imminent
];

function rampColor(stops, t) {
    let a = stops[0], b = stops[stops.length - 1];
    for (let i = 0; i < stops.length - 1; i++) {
        if (t >= stops[i][0] && t <= stops[i + 1][0]) { a = stops[i]; b = stops[i + 1]; break; }
    }
    const f = b[0] === a[0] ? 0 : Math.min(1, Math.max(0, (t - a[0]) / (b[0] - a[0])));
    return [a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f, a[3] + (b[3] - a[3]) * f];
}

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

    // Shared FOG_RES height grid off the same terrain the physics uses —
    // computed once, reused by the hillshade AND the elevation/slope
    // science layers (they're lazy, built on first mode switch).
    let heightField = null;
    function getHeightField() {
        if (heightField) return heightField;
        const H = new Float32Array(FOG_RES * FOG_RES);
        for (let j = 0; j < FOG_RES; j++) {
            const z = ((j + 0.5) / FOG_RES - 0.5) * worldSize;
            for (let i = 0; i < FOG_RES; i++) {
                const x = ((i + 0.5) / FOG_RES - 0.5) * worldSize;
                H[j * FOG_RES + i] = terrain.sampleHeight(x, z);
            }
        }
        heightField = { H, cell: worldSize / FOG_RES };
        return heightField;
    }

    /** Central-difference gradient of the cached height grid at cell (i,j). */
    function gradAt(H, cell, i, j) {
        const iw = Math.max(0, i - 1), ie = Math.min(FOG_RES - 1, i + 1);
        const jn = Math.max(0, j - 1), js = Math.min(FOG_RES - 1, j + 1);
        return [
            (H[j * FOG_RES + ie] - H[j * FOG_RES + iw]) / ((ie - iw) * cell),
            (H[js * FOG_RES + i] - H[jn * FOG_RES + i]) / ((js - jn) * cell),
        ];
    }

    /** Raster science layer over the height grid; paint(k, i, j) -> [r,g,b]. */
    function buildFieldLayer(paint) {
        const c = document.createElement('canvas');
        c.width = FOG_RES;
        c.height = FOG_RES;
        const ctx = c.getContext('2d');
        const img = ctx.createImageData(FOG_RES, FOG_RES);
        for (let j = 0; j < FOG_RES; j++) {
            for (let i = 0; i < FOG_RES; i++) {
                const k = j * FOG_RES + i;
                const [r, g, b] = paint(k, i, j);
                const p = k * 4;
                img.data[p] = r;
                img.data[p + 1] = g;
                img.data[p + 2] = b;
                img.data[p + 3] = 255;
            }
        }
        ctx.putImageData(img, 0, 0);
        return c;
    }

    function buildElevationLayer() {
        const { H, cell } = getHeightField();
        let min = Infinity, max = -Infinity;
        for (const h of H) { if (h < min) min = h; if (h > max) max = h; }
        const range = Math.max(1e-6, max - min);
        return buildFieldLayer((k, i, j) => {
            // hypsometric tint x the same NW hillshade as the photo base,
            // so relief still reads inside the color bands
            const [gx, gz] = gradAt(H, cell, i, j);
            const n = normalize3(-gx * HILL_EXAG, 1, -gz * HILL_EXAG);
            const shade = 0.6 + 0.4 * Math.max(0, n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2]);
            return rampColor(ELEV_STOPS, (H[k] - min) / range).map((v) => v * shade);
        });
    }

    function buildSlopeLayer() {
        const { H, cell } = getHeightField();
        return buildFieldLayer((_, i, j) => {
            const [gx, gz] = gradAt(H, cell, i, j);
            const slopeMag = 1 - 1 / Math.hypot(gx, 1, gz); // = 1 - normal.y
            return rampColor(SLOPE_STOPS, slopeMag);
        });
    }

    let elevCanvas = null;
    let slopeCanvas = null;
    let currentMode = 'photo';
    try {
        const m = localStorage.getItem(LS_OVERLAY);
        if (OVERLAY_MODES.includes(m)) currentMode = m;
    } catch { /* private mode */ }

    /** Menu SCIENCE OVERLAYS buttons land here (hud.js -> main.js). */
    function setOverlayMode(mode) {
        if (!OVERLAY_MODES.includes(mode)) return;
        currentMode = mode;
        try { localStorage.setItem(LS_OVERLAY, mode); } catch { /* private mode */ }
    }

    function buildBase() {
        const c = document.createElement('canvas');
        c.width = FOG_RES;
        c.height = FOG_RES;
        const ctx = c.getContext('2d');
        ctx.drawImage(baseImg, 0, 0, FOG_RES, FOG_RES);
        const img = ctx.getImageData(0, 0, FOG_RES, FOG_RES);
        const d = img.data;

        // real DEM heights on the shared cached grid (one-off cost,
        // reused by the elevation/slope science layers)
        const { H, cell } = getHeightField();

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
                const [gx, gz] = gradAt(H, cell, i, j);
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

    function starPath(ctx, cx, cy, outerR, innerR, spikes = 5) {
        ctx.beginPath();
        for (let i = 0; i < spikes * 2; i++) {
            const r = i % 2 === 0 ? outerR : innerR;
            const a = (Math.PI * i) / spikes - Math.PI / 2;
            const x = cx + Math.cos(a) * r;
            const y = cy + Math.sin(a) * r;
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.closePath();
    }

    /** extras: { lab: {x,z} | null, targetId: string | null,
        caches: [{x,z}, ...] | null (field containers awaiting pickup),
        outposts: [{x,z,hq}, ...] | null (Wave 7 built structures),
        sand: [{x,z,r,intensity}, ...] | null (Wave 11 soft-sand zones),
        path: [{x,z}, ...] | null (drawn only in PATH mode) } */
    function render(markerPositions, unitPositions, extras) {
        displayCtx.clearRect(0, 0, MAP_RES, MAP_RES);
        // Science overlays swap ONLY the base layer (lazy-built off the
        // shared height grid); fog + furniture composite identically on top.
        const base = currentMode === 'elevation' ? (elevCanvas ??= buildElevationLayer())
            : currentMode === 'slope' ? (slopeCanvas ??= buildSlopeLayer())
            : baseCanvas;
        if (base) {
            displayCtx.drawImage(base, 0, 0, MAP_RES, MAP_RES);
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

        // Soft-sand hazard zones (Wave 11): static site knowledge drawn
        // above the fog so "BOGGED DOWN" never feels random — the dune
        // margins you're about to cross are charted. True map scale, tan
        // wash + dotted rim, dimmer than the live dust-devil rings, and
        // FIRST in the overlay stack so every icon stays legible on top.
        if (extras?.sand) {
            for (const s of extras.sand) {
                const { px, py } = worldToPx(s.x, s.z);
                const r = (s.r / worldSize) * MAP_RES;
                displayCtx.fillStyle = `rgba(214, 168, 110, ${0.12 + 0.1 * s.intensity})`;
                displayCtx.beginPath();
                displayCtx.arc(px, py, r, 0, Math.PI * 2);
                displayCtx.fill();
                displayCtx.strokeStyle = 'rgba(226, 190, 128, 0.55)';
                displayCtx.lineWidth = 1.5;
                displayCtx.setLineDash([3, 5]);
                displayCtx.beginPath();
                displayCtx.arc(px, py, r, 0, Math.PI * 2);
                displayCtx.stroke();
                displayCtx.setLineDash([]);
            }
        }

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

        // Cache pickup points — sealed containers dropped in the field,
        // waiting for the lift drone. Player-created objectives, so they
        // sit ABOVE the fog (like unit dots); orange diamonds matching
        // the containers' lid color.
        if (extras?.caches) {
            for (const c of extras.caches) {
                const { px, py } = worldToPx(c.x, c.z);
                displayCtx.save();
                displayCtx.translate(px, py);
                displayCtx.rotate(Math.PI / 4);
                displayCtx.fillStyle = '#e07b39';
                displayCtx.strokeStyle = 'rgba(0,0,0,0.7)';
                displayCtx.lineWidth = 2;
                displayCtx.fillRect(-4.5, -4.5, 9, 9);
                displayCtx.strokeRect(-4.5, -4.5, 9, 9);
                displayCtx.restore();
            }
        }

        // Built structures (Wave 7): known bases, above the fog like the
        // lab. Checkposts = hollow teal squares (smaller than the solid
        // lab square). The HQ is the site capital, so it gets its own
        // GLYPH rather than just a bigger square — at 140px the map is
        // already crowded with squares (lab, checkposts), amber circles
        // (samples) and orange diamonds (caches), and a size-only cue was
        // impossible to pick out. A haloed star stays in the teal "base"
        // family but is unmistakable at a glance.
        if (extras?.outposts) {
            for (const o of extras.outposts) {
                const { px, py } = worldToPx(o.x, o.z);
                if (o.hq) {
                    const pulse = 0.45 + 0.3 * Math.sin(performance.now() * 0.003);
                    displayCtx.fillStyle = `rgba(89, 216, 201, ${pulse * 0.5})`;
                    displayCtx.beginPath();
                    displayCtx.arc(px, py, 13, 0, Math.PI * 2);
                    displayCtx.fill();

                    starPath(displayCtx, px, py, 9, 4);
                    displayCtx.fillStyle = '#7ef0e0';
                    displayCtx.fill();
                    displayCtx.strokeStyle = 'rgba(255,255,255,0.95)';
                    displayCtx.lineWidth = 1.5;
                    displayCtx.stroke();
                } else {
                    displayCtx.strokeStyle = 'rgba(0,0,0,0.7)';
                    displayCtx.lineWidth = 2;
                    displayCtx.strokeRect(px - 4, py - 4, 8, 8);
                    displayCtx.strokeStyle = '#59d8c9';
                    displayCtx.lineWidth = 1.5;
                    displayCtx.strokeRect(px - 4, py - 4, 8, 8);
                }
            }
        }

        // Dust devils (Wave 6): live weather, so above the fog. Rotating
        // dashed ring reads as "swirl" at map scale without an icon.
        if (extras?.devils) {
            const spin = performance.now() * 0.003;
            for (const d of extras.devils) {
                const { px, py } = worldToPx(d.x, d.z);
                const r = Math.max(6, (d.r / worldSize) * MAP_RES * 2);
                displayCtx.strokeStyle = 'rgba(224, 178, 120, 0.9)';
                displayCtx.lineWidth = 2.5;
                displayCtx.setLineDash([5, 5]);
                displayCtx.lineDashOffset = -spin * r;
                displayCtx.beginPath();
                displayCtx.arc(px, py, r, 0, Math.PI * 2);
                displayCtx.stroke();
                displayCtx.setLineDash([]);
            }
        }

        // PATH mode: the active unit's breadcrumb trail (main.js records
        // it on the telemetry tick), above the fog like the unit dots.
        if (currentMode === 'path' && extras?.path?.length > 1) {
            displayCtx.strokeStyle = 'rgba(94, 224, 200, 0.85)';
            displayCtx.lineWidth = 2;
            displayCtx.beginPath();
            for (let i = 0; i < extras.path.length; i++) {
                const { px, py } = worldToPx(extras.path[i].x, extras.path[i].z);
                if (i === 0) displayCtx.moveTo(px, py);
                else displayCtx.lineTo(px, py);
            }
            displayCtx.stroke();
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

    return {
        reveal, render, setOverlayMode,
        get overlayMode() { return currentMode; },
    };
}
