/* ============================================================
   photos.js — Wave 12.13: recon survey imaging.

   The recon drone's second standing job (after Wave 12.8's hazard
   scouting): named photo targets per site (sites.js `photoSpots`),
   imaged from the air with P / the HUD PHOTO button. A capture is a
   REAL frame grab — renderer.render + canvas downscale in the same
   task (the reliable-headless-screenshot idiom from the E2E notes) —
   stored as a jpeg thumbnail in the SURVEY IMAGING album (menu),
   persisted per site (saves.js Save(site.id) 'photos') like the archive.

   Mission counting is per-SESSION (sessionCaptured), NOT derived
   from the persisted album: the album survives RESET MISSION, and
   deriving "already imaged" from it would leave a replayed photo
   mission uncompletable. Re-imaging a spot replaces its album entry.
   ============================================================ */

import { Save } from './saves.js';

const PHOTO_R = 150;    // m horizontal capture radius (targets are landforms)
export const MIN_ALT = 8; // m AGL — aerial imaging, not a parked snapshot
const THUMB_W = 360;    // px thumbnail width (~20-40KB jpeg — album of a
                        // dozen stays far under the localStorage quota)

export function createPhotos(site) {
    const spots = (site.photoSpots ?? []).map((s) => ({ ...s }));
    const sessionCaptured = new Set();

    const save = Save(site.id);
    let album = save.get('photos', []);
    if (!Array.isArray(album)) album = [];

    function persist() {
        save.set('photos', album);
    }

    /** Spot within capture range of a world position, or null. */
    function inRange(pos) {
        for (const s of spots) {
            if (Math.hypot(pos.x - s.x, pos.z - s.z) <= PHOTO_R) return s;
        }
        return null;
    }

    /** Nearest spot not yet imaged this session (TGT pointer feed). */
    function nearestPending(pos) {
        let best = null, bestD = Infinity;
        for (const s of spots) {
            if (sessionCaptured.has(s.id)) continue;
            const d = Math.hypot(pos.x - s.x, pos.z - s.z);
            if (d < bestD) { bestD = d; best = s; }
        }
        return best;
    }

    /** Grab the live frame: re-render (toDataURL needs same-task pixels
        with preserveDrawingBuffer off), downscale to a jpeg thumbnail,
        file it in the album. Returns { first } — first capture of this
        spot THIS SESSION (drives the mission counter). */
    function capture(renderer, scene, camera, spot, marsTime) {
        renderer.render(scene, camera);
        const src = renderer.domElement;
        const c = document.createElement('canvas');
        c.width = THUMB_W;
        c.height = Math.max(1, Math.round(THUMB_W * src.height / src.width));
        c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
        const dataUrl = c.toDataURL('image/jpeg', 0.72);

        const first = !sessionCaptured.has(spot.id);
        sessionCaptured.add(spot.id);
        const entry = {
            id: spot.id, name: spot.name, note: spot.note ?? '',
            site: site.id, siteName: site.name,
            sol: marsTime?.sol ?? null, takenAt: Date.now(), dataUrl,
        };
        const i = album.findIndex((a) => a.site === site.id && a.id === spot.id);
        if (i >= 0) album[i] = entry; else album.push(entry);
        persist();
        return { first, entry };
    }

    return {
        inRange, nearestPending, capture,
        get spots() {
            return spots.map((s) => ({ ...s, captured: sessionCaptured.has(s.id) }));
        },
        get album() { return album; },
        get capturedCount() { return sessionCaptured.size; },
        get total() { return spots.length; },
    };
}
