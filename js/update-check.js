/* Live-update detection (plan 30). version.json is regenerated on every
   deploy (scripts/stamp-version.sh, run before `wrangler pages deploy`),
   so its ETag changes on every deploy even when its own content wouldn't
   otherwise differ. We poll it with cache: 'no-store' — bypassing the SW-
   less browser cache entirely — and compare both the ETag header and the
   buildId body against the values captured at page load. Either mismatch
   means a newer build is live; we surface a persistent banner rather than
   reloading automatically, since a running sim/unsaved rock-lift shouldn't
   vanish out from under the player (saves.js autosaves are frequent but
   not continuous). Banner is injected standalone into <body> — independent
   of hud.js, which doesn't exist yet on the hub/menu screen. */

const VERSION_URL = new URL('../version.json', import.meta.url).href;
const POLL_MS = 5 * 60 * 1000;

let baseline = null;
let bannerEl = null;

async function fetchVersion() {
    const res = await fetch(VERSION_URL, { cache: 'no-store' });
    if (!res.ok) return null;
    const etag = res.headers.get('etag');
    const contentType = res.headers.get('content-type') || '';
    let buildId = null;
    if (contentType.includes('json')) {
        try {
            buildId = (await res.json()).buildId;
        } catch { /* malformed body — fall back to etag alone */ }
    }
    if (!etag && !buildId) return null; // e.g. version.json missing -> SPA fallback HTML
    return { etag, buildId };
}

function showBanner() {
    if (bannerEl) return;
    bannerEl = document.createElement('div');
    bannerEl.className = 'mc-update-banner';
    bannerEl.innerHTML = `
        <span>A new version is available.</span>
        <button type="button" class="mars-btn mc-update-banner__reload">RELOAD</button>
    `;
    bannerEl.querySelector('.mc-update-banner__reload').addEventListener('click', () => {
        location.reload();
    });
    document.body.appendChild(bannerEl);
    requestAnimationFrame(() => { bannerEl.dataset.visible = 'true'; });
}

function changed(a, b) {
    if (!a || !b) return false;
    if (a.etag && b.etag) return a.etag !== b.etag;
    return a.buildId !== b.buildId;
}

async function poll() {
    const current = await fetchVersion();
    if (!current) return;
    if (!baseline) { baseline = current; return; }
    if (changed(baseline, current)) showBanner();
}

export function startUpdateCheck() {
    poll();
    setInterval(poll, POLL_MS);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') poll();
    });
}
