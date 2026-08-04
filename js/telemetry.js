/* ============================================================
   telemetry.js — anonymous, consent-gated product analytics
   (plan 24). Fires a small curated set of gameplay + device +
   performance events to our own ingest (functions/api/telemetry.js
   -> D1). No PII: identity is a random per-install UUID, never a
   hardware / advertising id. Crash *reporting* for the Android app
   is Google Play's Android Vitals; this adds a lightweight web-side
   js_error / context_lost signal on top.

   Shape mirrors cloudsync.js: a CONFIG block, a tiny transport, and
   a createTelemetry() factory. All localStorage goes through the
   saves.js Prefs boundary (mc-anon-id, mc-tele-consent) — nothing
   here touches mc-* directly.

   Consent is OPT-OUT (on by default) with a MENU toggle; track() is
   a hard no-op while consent is off, and no anon-id is minted until
   the first event actually sends.
   ============================================================ */

import { Prefs } from './saves.js';

// ==== CONFIG =================================================================
export const APP_VERSION = '1.0.0';   // single source of truth (also in manifest.json)

// Web build posts same-origin (relative). The bundled Android app has no
// server of its own, so it must hit the deployed Pages origin absolutely —
// point this at your production domain if you add a custom one.
const REMOTE_BASE = 'https://marsfleet.space';
const PATH = '/api/telemetry';

const FLUSH_MS = 15000;   // periodic drain while playing
const MAX_QUEUE = 50;     // matches the Function's per-batch cap

const isNative = () => !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
const endpoint = () => (isNative() ? REMOTE_BASE + PATH : PATH);

/** Privacy-policy link for the MENU: same-origin on web, absolute for the
    bundled app (whose local origin has no /privacy.html). */
export const privacyUrl = () => (isNative() ? REMOTE_BASE + '/privacy.html' : '/privacy.html');

/** Consent is on unless explicitly turned off (opt-out). */
function readConsent() {
    const v = Prefs.get('tele-consent');
    return v == null ? true : v === '1';
}

/** Lazily mint + persist the anonymous per-install id (only once we send). */
function anonId() {
    let id = Prefs.get('anon-id');
    if (!id) {
        id = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
        Prefs.set('anon-id', id);
    }
    return id;
}

/** Non-identifying device/context snapshot, gathered once per session_start. */
function deviceInfo() {
    const info = {
        ua: navigator.userAgent,
        lang: navigator.language,
        screen: `${screen.width}x${screen.height}`,
        dpr: window.devicePixelRatio || 1,
        orient: (screen.orientation && screen.orientation.type) || null,
        touch: window.matchMedia('(pointer: coarse)').matches,
    };
    try {
        const c = document.createElement('canvas');
        const gl = c.getContext('webgl') || c.getContext('experimental-webgl');
        const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
        if (ext) info.gpu = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL);
    } catch { /* WebGL / renderer string unavailable */ }
    return info;
}

export function createTelemetry() {
    const sessionId = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()));
    const platform = isNative() ? 'android' : 'web';
    let consent = readConsent();
    let queue = [];
    let timer = null;

    // ---- perf window (per foreground session) --------------------------
    let sessionCtx = null;      // remembered so a re-foreground restarts cleanly
    let sessionActive = false;
    let startedAt = 0, frames = 0, worstGap = 0, slowFrames = 0, lastFrame = 0, contextLost = 0;

    function resetPerf() { frames = 0; worstGap = 0; slowFrames = 0; lastFrame = performance.now(); contextLost = 0; }

    // ---- transport -----------------------------------------------------
    function scheduleFlush() {
        if (timer || !consent) return;
        timer = setTimeout(() => { timer = null; flush(); }, FLUSH_MS);
    }

    function flush() {
        if (!consent || !queue.length) return;
        const events = queue;
        queue = [];
        const payload = JSON.stringify({
            events, anon_id: anonId(), session_id: sessionId,
            app_version: APP_VERSION, platform,
        });
        // text/plain keeps it a CORS-safelisted request (no preflight) so the
        // bundled app's cross-origin beacon just works; the Function parses
        // the body as JSON regardless of the declared type.
        const url = endpoint();
        try {
            if (navigator.sendBeacon) {
                const blob = new Blob([payload], { type: 'text/plain;charset=UTF-8' });
                if (navigator.sendBeacon(url, blob)) return;
            }
        } catch { /* fall through to fetch */ }
        try {
            fetch(url, {
                method: 'POST', body: payload, keepalive: true, mode: 'cors',
                headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
            }).catch(() => { /* best-effort */ });
        } catch { /* offline / blocked — drop */ }
    }

    // ---- public API ----------------------------------------------------
    function track(name, props) {
        if (!consent) return;
        queue.push(props ? { name, props } : { name });
        if (queue.length >= MAX_QUEUE) flush(); else scheduleFlush();
    }

    /** Begin a play session: fire session_start with device + context, and
        open a fresh perf window. `ctx` is game-side (e.g. { site, quality }). */
    function startSession(ctx) {
        sessionCtx = ctx || {};
        sessionActive = true;
        startedAt = Date.now();
        resetPerf();
        track('session_start', { ...sessionCtx, device: deviceInfo() });
    }

    /** Close the current perf window and fire session_end (idempotent until a
        new startSession). Called on tab-hide / pagehide, then flushed. */
    function endSession() {
        if (!sessionActive) return;
        sessionActive = false;
        const durationMs = Date.now() - startedAt;
        const secs = Math.max(durationMs / 1000, 0.001);
        track('session_end', {
            ...sessionCtx,
            durationMs,
            avgFps: Math.round(frames / secs),
            minFps: worstGap > 0 ? Math.round(1000 / worstGap) : null,
            slowFrames,          // frames slower than ~30fps (>33ms)
            contextLost,
        });
    }

    /** Call once per rendered frame (render loop) to sample real cadence. */
    function frame() {
        if (!sessionActive) return;
        const now = performance.now();
        const gap = now - lastFrame;
        lastFrame = now;
        frames++;
        if (gap > worstGap && gap < 5000) worstGap = gap; // ignore tab-stall gaps
        if (gap > 33) slowFrames++;
    }

    /** WebGL context loss — the direct signal for OOM / heavy-mesh crashes on
        low-end devices. Reported immediately AND tallied into session_end. */
    function noteContextLost() {
        contextLost++;
        track('context_lost', { ...(sessionCtx || {}) });
        flush();
    }

    /** Toggle consent (MENU). Persists, and stops/starts collection. Returns
        the new state so the button label can follow it. */
    function setConsent(on) {
        consent = !!on;
        Prefs.set('tele-consent', consent ? '1' : '0');
        if (!consent) { queue = []; clearTimeout(timer); timer = null; }
        return consent;
    }

    // Flush + close the session at the natural terminal moments; re-open a
    // fresh session if the player returns to the foreground.
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') { endSession(); flush(); }
        else if (sessionCtx && !sessionActive) { startSession(sessionCtx); }
    });
    window.addEventListener('pagehide', () => { endSession(); flush(); });

    return {
        track, startSession, endSession, frame, noteContextLost, setConsent, flush,
        get consent() { return consent; },
        anonId: () => anonId(), sessionId, platform,
    };
}
