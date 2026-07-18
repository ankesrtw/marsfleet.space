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
