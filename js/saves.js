/* ============================================================
   saves.js — the localStorage boundary: per-site progress vs
   global prefs (Wave "site hub", plan 22).

   Two classes of persisted state, never blurred:

   - PER-SITE progress lives under `mc-<siteId>-<key>` — one
     independent save per landing site. This is the unit RESET
     SITE clears and plan 23 mirrors to the player's own cloud:
       results            science archive (analysis.js)
       photos             survey imaging album (photos.js)
       mission-<id>-done  mission completion (missions.js)
       intro-seen         landing-drop already watched (main.js)

   - GLOBAL prefs/keybinds stay flat `mc-<key>`, shared across all
     sites (unchanged by this wave): keybind remaps, gear loadout,
     night vision (mc-nv), sfx, daylight lock (mc-sol), overlay
     mode, touch prefs, and `mc-site` (last-played) itself.

   Every per-site set() also stamps `mc-<siteId>-updatedAt` — the
   last-write time plan 23's cloud merge resolves on (last-write-
   wins per site). Values are JSON-encoded so a whole site's save
   can be (de)serialised as one blob for that cloud sync.

   Access per-site state ONLY through Save(siteId); global prefs
   through Prefs. Nothing else should touch `mc-*` directly.
   ============================================================ */

const NS = 'mc';
const MIGRATED_FLAG = 'mc-migrated-v2';

const skey = (siteId, k) => `${NS}-${siteId}-${k}`;

/** Per-site save handle: scoped get/set/remove + whole-site clear.
    Cheap and stateless — make one per module, no need to share. */
export function Save(siteId) {
    return {
        get(k, fallback = null) {
            try {
                const raw = localStorage.getItem(skey(siteId, k));
                if (raw === null) return fallback;
                try { return JSON.parse(raw); } catch { return raw; }
            } catch { return fallback; } // private mode / storage disabled
        },
        set(k, v) {
            try {
                localStorage.setItem(skey(siteId, k), JSON.stringify(v));
                // Forward-compat (plan 23): per-site last-write timestamp.
                localStorage.setItem(skey(siteId, 'updatedAt'), String(Date.now()));
            } catch { /* private mode / quota — lives this session only */ }
        },
        remove(k) {
            try { localStorage.removeItem(skey(siteId, k)); } catch { /* private mode */ }
        },
        /** RESET SITE: wipe every mc-<siteId>-* key (incl. updatedAt). */
        clear() {
            purge((key) => key.startsWith(`${NS}-${siteId}-`));
        },
    };
}

/** Global prefs/keybinds — flat mc-<key>, shared across every site.
    Plain strings (matches the existing pref keys); no JSON, no
    per-site updatedAt. (Wired by the reset UI / cloud sync waves.) */
export const Prefs = {
    get(k, fallback = null) {
        try {
            const raw = localStorage.getItem(`${NS}-${k}`);
            return raw === null ? fallback : raw;
        } catch { return fallback; }
    },
    set(k, v) {
        try { localStorage.setItem(`${NS}-${k}`, v); } catch { /* private mode */ }
    },
    remove(k) {
        try { localStorage.removeItem(`${NS}-${k}`); } catch { /* private mode */ }
    },
};

/** RESET GAME: wipe ALL mc-* keys — every per-site save AND global
    prefs — returning the player to a first-boot state. */
export function resetGame() {
    purge((key) => key.startsWith(`${NS}-`));
}

/** One-time migration of the pre-hub GLOBAL progress keys into the
    last-played site's namespace, so existing players keep their save
    when the namespaced build ships. Idempotent via MIGRATED_FLAG;
    call once at boot BEFORE any Save read. */
export function migrateLegacySaves() {
    try {
        if (localStorage.getItem(MIGRATED_FLAG)) return;
        const siteId = localStorage.getItem(`${NS}-site`) || 'jezero';
        const save = Save(siteId);

        const moveJson = (legacyKey, newKey) => {
            const raw = localStorage.getItem(legacyKey);
            if (raw === null) return;
            let v; try { v = JSON.parse(raw); } catch { v = raw; }
            save.set(newKey, v);
            localStorage.removeItem(legacyKey);
        };
        moveJson('mc-results', 'results');
        moveJson('mc-photos', 'photos');
        if (localStorage.getItem('mc-intro-seen') !== null) {
            save.set('intro-seen', 1);
            localStorage.removeItem('mc-intro-seen');
        }

        // mission-<id>-done has dynamic ids — snapshot the matching keys
        // first (never mutate localStorage mid-scan), then move each.
        const missionKeys = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && /^mc-mission-(.+)-done$/.test(key)) missionKeys.push(key);
        }
        for (const key of missionKeys) {
            const id = key.match(/^mc-mission-(.+)-done$/)[1];
            save.set(`mission-${id}-done`, 1);
            localStorage.removeItem(key);
        }

        localStorage.setItem(MIGRATED_FLAG, '1');
    } catch { /* private mode — nothing to migrate */ }
}

/* ============================================================
   Cloud-sync layer (plan 23) — serialise/merge the same per-site
   blobs so cloudsync.js can mirror them to the player's own Drive.
   All localStorage access stays inside this module; cloudsync.js
   handles only auth + transport. v1 = progress only: photos never
   leave the device.
   ============================================================ */

const PHOTOS_KEY = 'photos'; // excluded from cloud sync in v1

/** Last-write timestamp for a site (0 if never written). */
export function siteUpdatedAt(siteId) {
    try {
        const raw = localStorage.getItem(skey(siteId, 'updatedAt'));
        const n = raw == null ? 0 : Number(raw);
        return Number.isFinite(n) ? n : 0;
    } catch { return 0; }
}

/** Serialise a site's whole save to a plain object (photos excluded),
    keyed by the same sub-keys Save() uses, including `updatedAt`. `{}`
    when the site has never been played. */
export function exportSite(siteId) {
    const prefix = `${NS}-${siteId}-`;
    const blob = {};
    try {
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (!key || !key.startsWith(prefix)) continue;
            const sub = key.slice(prefix.length);
            if (sub === PHOTOS_KEY) continue;
            const raw = localStorage.getItem(key);
            try { blob[sub] = JSON.parse(raw); } catch { blob[sub] = raw; }
        }
    } catch { /* private mode */ }
    return blob;
}

/** Write a site blob back verbatim — crucially WITHOUT re-stamping
    `updatedAt` (that would destroy the merge decision), so the adopted
    side's timestamp is preserved. Photos in the blob are ignored. */
export function importSite(siteId, blob) {
    if (!blob || typeof blob !== 'object') return;
    const prefix = `${NS}-${siteId}-`;
    try {
        for (const [k, v] of Object.entries(blob)) {
            if (k === PHOTOS_KEY) continue;
            localStorage.setItem(prefix + k, JSON.stringify(v));
        }
    } catch { /* private mode / quota */ }
}

/** Snapshot the full local save as the cloud file shape:
    `{ version, updatedAt, sites: { id: blob }, prefs }`. Global prefs are
    every flat `mc-<k>` that is not a per-site key nor the migration flag. */
export function exportAll(siteIds) {
    const sites = {};
    let newest = 0;
    for (const id of siteIds) {
        const blob = exportSite(id);
        if (Object.keys(blob).length) {
            sites[id] = blob;
            newest = Math.max(newest, blob.updatedAt || 0);
        }
    }
    return { version: 1, updatedAt: newest, sites, prefs: exportPrefs(siteIds) };
}

/** Apply a merged cloud file back to localStorage (per-site blobs + prefs). */
export function applyMerged(merged, siteIds) {
    if (!merged || typeof merged !== 'object') return;
    for (const id of siteIds) {
        if (merged.sites && merged.sites[id]) importSite(id, merged.sites[id]);
    }
    if (merged.prefs) {
        for (const [k, v] of Object.entries(merged.prefs)) {
            try { localStorage.setItem(`${NS}-${k}`, String(v)); } catch { /* private */ }
        }
    }
}

/** Global (non-per-site) prefs as a flat object — the tiny keybind/gear/
    view state, worth carrying so it follows the player too. */
function exportPrefs(siteIds) {
    const prefs = {};
    const isPerSite = (key) => siteIds.some((id) => key.startsWith(`${NS}-${id}-`));
    try {
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (!key || !key.startsWith(`${NS}-`)) continue;
            if (key === MIGRATED_FLAG || key === `${NS}-site`) continue;
            // Device-local telemetry state (plan 24) — the anonymous install id
            // and analytics-consent flag must never propagate to another device
            // via the player's cloud save.
            if (key === `${NS}-anon-id` || key === `${NS}-tele-consent`) continue;
            if (isPerSite(key)) continue;
            prefs[key.slice(NS.length + 1)] = localStorage.getItem(key);
        }
    } catch { /* private mode */ }
    return prefs;
}

/** PURE last-write-wins-per-site merge (no localStorage) — the part that can
    silently lose data, so it is isolated and unit-tested. Returns the merged
    cloud-shape file plus a per-site record of which side won (for logging).
    Ties keep local (avoids a needless write-back churn). */
export function mergeSaves(local, cloud) {
    local = local || { sites: {} };
    cloud = cloud || { sites: {} };
    const lSites = local.sites || {}, cSites = cloud.sites || {};
    const ids = new Set([...Object.keys(lSites), ...Object.keys(cSites)]);
    const merged = { version: 1, sites: {}, prefs: {} };
    const winners = {};
    for (const id of ids) {
        const l = lSites[id], c = cSites[id];
        if (!l) { merged.sites[id] = c; winners[id] = 'cloud'; continue; }
        if (!c) { merged.sites[id] = l; winners[id] = 'local'; continue; }
        if ((c.updatedAt || 0) > (l.updatedAt || 0)) {
            merged.sites[id] = c; winners[id] = 'cloud';
        } else {
            merged.sites[id] = l; winners[id] = 'local';
        }
    }
    const cloudPrefsNewer = (cloud.updatedAt || 0) > (local.updatedAt || 0);
    merged.prefs = (cloudPrefsNewer ? cloud.prefs : local.prefs) || {};
    merged.updatedAt = Math.max(local.updatedAt || 0, cloud.updatedAt || 0);
    return { merged, winners };
}

/** Remove every localStorage key matching pred. Snapshots the key list
    first so removal never reindexes the scan. */
function purge(pred) {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && pred(key)) keys.push(key);
    }
    for (const key of keys) {
        try { localStorage.removeItem(key); } catch { /* private mode */ }
    }
}
