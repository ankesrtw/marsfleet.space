/* ============================================================
   analysis.js — the FIELD LAB's simulated edge-compute analysis
   queue + the persistent science archive it writes.

   Delivered cache containers (lab.js deliver) are enqueued here and
   processed FIFO, one at a time, on the lab's onboard edge node
   (Jetson-class, simulated — a timed sequence, no real backend).
   Completion reveals the sample's REAL published mission finding
   (sites.js `finding`) and appends a record to the science archive
   in localStorage ('mc-results'), so results persist across page
   loads, sessions and sites. Re-analyzing a sample in a later
   session replaces its old record instead of duplicating it.

   Same idiom as the other sim modules: created once per site,
   update(dt) driven from the main render loop, plain object out.
   ============================================================ */

const LS_KEY = 'mc-results';
const ANALYZE_SECS = 28;

export function createAnalysis(site, { onDone } = {}) {
    // [{ id, name, site, siteName, finding, analyzedAt }] — newest last.
    let archive = [];
    try {
        const raw = JSON.parse(localStorage.getItem(LS_KEY));
        if (Array.isArray(raw)) archive = raw;
    } catch { /* corrupt or private mode — start empty */ }

    const queue = [];          // containers waiting for the node
    let current = null;        // { c, t } — container being processed
    const analyzedIds = new Set(); // this session, for HUD sample states

    function enqueue(container) {
        queue.push(container);
    }

    function update(dt) {
        if (!current && queue.length) current = { c: queue.shift(), t: 0 };
        if (!current) return;
        current.t += dt;
        if (current.t < ANALYZE_SECS) return;

        const { c } = current;
        current = null;
        const rec = {
            id: c.id,
            name: c.name,
            site: site.id,
            siteName: site.name,
            finding: c.finding ?? c.note ?? '',
            analyzedAt: Date.now(),
        };
        archive = archive.filter((r) => !(r.site === rec.site && r.id === rec.id));
        archive.push(rec);
        try { localStorage.setItem(LS_KEY, JSON.stringify(archive)); } catch { /* private mode */ }
        analyzedIds.add(rec.id);
        onDone?.(rec);
    }

    /** Live node readout for the HUD (10Hz): null when idle. */
    function status() {
        if (!current) return queue.length ? { name: queue[0].name, progress: 0 } : null;
        return { name: current.c.name, progress: Math.min(1, current.t / ANALYZE_SECS) };
    }

    return {
        enqueue, update, status, analyzedIds,
        get archive() { return archive; },
    };
}
