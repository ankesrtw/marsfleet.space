/* ============================================================
   cloudsync.js — BYOC cloud save via the player's OWN Google Drive
   (plan 23). Pure frontend: Google Identity Services (GIS) hands the
   browser a short-lived access token that calls the Drive REST API
   directly, so the save goes browser -> the user's Drive and we never
   receive it (zero server, zero storage liability). v1 = progress only
   (photos stay on the device).

   Hub-centric sync: the sign-in UI lives on the globe hub, and OPEN
   MISSION MAP is a full page reload, so a persistent cross-page sync
   layer buys little. We sync at the natural moments the hub is alive —
   on sign-in, on each hub visit (silent re-auth if the Google session
   is live), and on tab-hide — and lean on saves.js's last-write-wins-
   per-site merge so no interleaving of devices can lose data.

   ====== YOUR ONE-TIME SETUP (I cannot provision this) ======
   Create a Google Cloud project -> OAuth consent screen (add scope
   .../auth/drive.file) -> OAuth 2.0 Client ID (type: Web) with
   Authorized JavaScript origins = your prod URL + http://localhost:8931
   (dev). Paste the Client ID into GOOGLE_CLIENT_ID below. It is PUBLIC
   by design — the token model has no client secret. Until it is set the
   feature stays inert (the hub shows no sign-in button).
   ============================================================ */

import { SITES } from './sites.js';
import { exportAll, applyMerged, mergeSaves } from './saves.js';

// ==== CONFIG — paste your OAuth 2.0 Web Client ID here ====
export const GOOGLE_CLIENT_ID = '';   // e.g. '1234567890-abc.apps.googleusercontent.com'

const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const GIS_SRC = 'https://accounts.google.com/gsi/client';
const FILE_NAME = 'MarsSim-save.json';
const LS_STATE = 'mc-cloud-state';     // { signedIn, expiry } — never the token itself
const TOKEN_SKEW_MS = 60_000;          // treat a token as expired this early

export function isConfigured() { return !!GOOGLE_CLIENT_ID; }

/** Was the player signed in last session? (State only — no token stored.) */
export function wasSignedIn() {
    try { return !!JSON.parse(localStorage.getItem(LS_STATE) || '{}').signedIn; }
    catch { return false; }
}

/**
 * @param {object}   opts
 * @param {(status:string)=>void} [opts.onStatus]  status: 'disabled' | 'signed-out'
 *        | 'syncing' | 'synced' | 'offline'
 * @param {()=>void}  [opts.onSynced]  fired after a successful merge writes local
 *        (the hub refreshes pin badges here — adopted cloud progress is now local)
 */
export function createCloudSync({ onStatus, onSynced } = {}) {
    const siteIds = Object.keys(SITES);
    let tokenClient = null, accessToken = null, tokenExpiry = 0;
    let fileId = null;
    let status = isConfigured() ? 'signed-out' : 'disabled';

    function setStatus(s) { status = s; onStatus?.(s); }

    // ---- GIS script + token client -------------------------------------
    function loadGis() {
        return new Promise((resolve, reject) => {
            if (window.google?.accounts?.oauth2) return resolve();
            const done = () => (window.google?.accounts?.oauth2 ? resolve() : reject(new Error('GIS unavailable')));
            const existing = document.querySelector(`script[src="${GIS_SRC}"]`);
            if (existing) { existing.addEventListener('load', done); existing.addEventListener('error', reject); return; }
            const s = document.createElement('script');
            s.src = GIS_SRC; s.async = true; s.defer = true;
            s.onload = done; s.onerror = () => reject(new Error('GIS load failed'));
            document.head.appendChild(s);
        });
    }

    async function ensureTokenClient() {
        await loadGis();
        if (!tokenClient) {
            tokenClient = google.accounts.oauth2.initTokenClient({
                client_id: GOOGLE_CLIENT_ID, scope: SCOPE, callback: () => {},
            });
        }
    }

    /** Resolve with an access token. `silent:true` requests without a prompt
        (works only while the Google session is live); false forces consent. */
    function requestToken({ silent }) {
        return new Promise((resolve, reject) => {
            tokenClient.callback = (resp) => {
                if (resp && resp.error) return reject(resp);
                accessToken = resp.access_token;
                tokenExpiry = Date.now() + (resp.expires_in || 3600) * 1000 - TOKEN_SKEW_MS;
                persist(true, tokenExpiry);
                resolve(accessToken);
            };
            tokenClient.error_callback = (err) => reject(err);
            try { tokenClient.requestAccessToken({ prompt: silent ? '' : 'consent' }); }
            catch (e) { reject(e); }
        });
    }

    async function validToken() {
        if (accessToken && Date.now() < tokenExpiry) return accessToken;
        return requestToken({ silent: true });
    }

    // ---- Drive REST v3 (direct from the browser) -----------------------
    async function driveFetch(url, opts = {}, retry = true) {
        const token = await validToken();
        const resp = await fetch(url, { ...opts, headers: { Authorization: `Bearer ${token}`, ...(opts.headers || {}) } });
        if (resp.status === 401 && retry) {         // token died — one silent retry
            accessToken = null; tokenExpiry = 0;
            return driveFetch(url, opts, false);
        }
        return resp;
    }

    async function findFile() {
        const q = encodeURIComponent(`name='${FILE_NAME}' and trashed=false`);
        const r = await driveFetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,modifiedTime)&spaces=drive`);
        if (!r.ok) throw new Error(`Drive list ${r.status}`);
        const j = await r.json();
        fileId = j.files && j.files[0] ? j.files[0].id : null;
        return fileId;
    }

    async function readCloud() {
        if (!fileId) return null;
        const r = await driveFetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`);
        if (!r.ok) return null;
        try { return await r.json(); } catch { return null; }
    }

    async function createCloud(body) {
        const meta = { name: FILE_NAME, mimeType: 'application/json' };
        const boundary = 'mc' + Math.random().toString(16).slice(2);
        const multipart =
            `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n` +
            `--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(body)}\r\n--${boundary}--`;
        const r = await driveFetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
            method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body: multipart,
        });
        const j = await r.json();
        if (j.id) fileId = j.id;
    }

    async function updateCloud(body) {
        await driveFetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        });
    }

    // ---- Orchestration -------------------------------------------------
    /** Find -> read cloud -> LWW-merge with local -> write merged to BOTH. */
    async function syncNow() {
        await findFile();
        const cloud = (await readCloud()) || { version: 1, sites: {} };
        const local = exportAll(siteIds);
        const { merged } = mergeSaves(local, cloud);
        applyMerged(merged, siteIds);
        if (fileId) await updateCloud(merged); else await createCloud(merged);
        onSynced?.();
    }

    /** Interactive sign-in (button): consent -> token -> first sync. */
    async function signIn() {
        if (!isConfigured()) return;
        setStatus('syncing');
        try {
            await ensureTokenClient();
            await requestToken({ silent: false });
            await syncNow();
            setStatus('synced');
        } catch { setStatus('offline'); }
    }

    /** On hub mount: if we were signed in, re-auth silently + sync. Never
        prompts — a dead Google session just drops back to signed-out. */
    async function resume() {
        if (!isConfigured() || !wasSignedIn()) { setStatus(status); return; }
        setStatus('syncing');
        try {
            await ensureTokenClient();
            await requestToken({ silent: true });
            await syncNow();
            setStatus('synced');
        } catch { persist(false, 0); setStatus('signed-out'); }
    }

    function signOut() {
        if (accessToken && window.google?.accounts?.oauth2) {
            try { google.accounts.oauth2.revoke(accessToken, () => {}); } catch { /* ignore */ }
        }
        accessToken = null; tokenExpiry = 0; fileId = null;
        persist(false, 0);
        setStatus('signed-out');
    }

    /** Best-effort push on tab-hide (the hub wires visibilitychange). */
    function flush() {
        if (!isConfigured() || status === 'signed-out' || status === 'disabled') return;
        syncNow().catch(() => setStatus('offline'));
    }

    function persist(signedIn, expiry) {
        try { localStorage.setItem(LS_STATE, JSON.stringify({ signedIn, expiry })); }
        catch { /* private mode */ }
    }

    return {
        signIn, signOut, resume, syncNow, flush,
        isConfigured, wasSignedIn,
        get status() { return status; },
    };
}
