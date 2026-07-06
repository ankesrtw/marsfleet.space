/* ============================================================
   fog.js — drone-driven fog-of-war minimap.

   A 2D "explored" alpha buffer over the site footprint (256x256),
   independent of the terrain heightmap. Any unit's position stamps
   a soft reveal circle into it each frame. Rendered as a minimap:
   the site's orthoimage as base layer, fog canvas composited on top
   with destination-out to punch reveal-holes. Same canvas-2D HUD
   idiom as this project's other games (e.g. game-v2's radar).
   ============================================================ */

const FOG_RES = 256;
const REVEAL_RADIUS_PX = 14;

export function createFog(site, minimapEl) {
    const worldSize = site.worldSize;

    const fogCanvas = document.createElement('canvas');
    fogCanvas.width = FOG_RES;
    fogCanvas.height = FOG_RES;
    const fogCtx = fogCanvas.getContext('2d');
    fogCtx.fillStyle = '#000';
    fogCtx.fillRect(0, 0, FOG_RES, FOG_RES);

    const displayCanvas = document.createElement('canvas');
    displayCanvas.width = FOG_RES;
    displayCanvas.height = FOG_RES;
    displayCanvas.className = 'mars-minimap-canvas';
    minimapEl.appendChild(displayCanvas);
    const displayCtx = displayCanvas.getContext('2d');

    const baseImg = new Image();
    baseImg.src = site.textureUrl;
    let baseReady = false;
    baseImg.onload = () => { baseReady = true; };

    function worldToPx(x, z) {
        const u = (x / worldSize) + 0.5;
        const v = (z / worldSize) + 0.5;
        return { px: u * FOG_RES, py: v * FOG_RES };
    }

    function reveal(worldX, worldZ) {
        const { px, py } = worldToPx(worldX, worldZ);
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

    function render(markerPositions) {
        displayCtx.clearRect(0, 0, FOG_RES, FOG_RES);
        if (baseReady) {
            displayCtx.drawImage(baseImg, 0, 0, FOG_RES, FOG_RES);
        } else {
            displayCtx.fillStyle = '#3a1f14';
            displayCtx.fillRect(0, 0, FOG_RES, FOG_RES);
        }
        for (const m of markerPositions) {
            const { px, py } = worldToPx(m.x, m.z);
            displayCtx.fillStyle = m.collected ? '#5ee08a' : '#e0b95e';
            displayCtx.beginPath();
            displayCtx.arc(px, py, 3, 0, Math.PI * 2);
            displayCtx.fill();
        }
        // fog on top, still un-revealed = opaque black
        displayCtx.globalAlpha = 0.88;
        displayCtx.drawImage(fogCanvas, 0, 0);
        displayCtx.globalAlpha = 1;
    }

    return { reveal, render };
}
