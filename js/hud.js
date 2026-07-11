/* ============================================================
   hud.js — DOM/CSS overlay: unit switch, collect prompt, inventory,
   scientific telemetry readout, and the in-game menu.

   Touch-first: the collect action and unit-switch are always
   on-screen tappable buttons (not keyboard-only), with a keyboard
   hint shown only on non-touch devices.

   Telemetry shows real mission-style data: speed, bearing, elevation
   (Mars areoid-relative, from the site DEM), local slope, and the
   unit's actual planetary lat/lon derived from its world position
   (see sites.js M_PER_DEG). The menu switches sites in-game without
   returning to the landing screen.

   Visibility toggles use explicit classes/attributes with matching
   CSS — never bare [hidden] against an author `display` rule (that
   exact conflict caused the launch black-screen bug).
   ============================================================ */

import { isTouchDevice } from './touch.js';
import { SITES, M_PER_DEG, SOL_MS } from './sites.js';

export function createHud(rootEl, { site, onSwitchUnit, onCollect, onToggleSfx, sfxEnabled = true, onCycleGear, gear = 'G2', onToggleSol, solOn = true, onToggleLanding, onCommandAlt, onReset, onSkipIntro, onSkipTutorial }) {
    rootEl.innerHTML = `
        <div class="mars-hud">
            <div class="mars-hud__top">
                <button class="mars-btn mars-btn--switch" id="mc-switch">SWITCH UNIT<span class="mars-btn__hint">[TAB]</span></button>
                <div class="mars-hud__unit" id="mc-active-unit">ROVER</div>
                <button class="mars-btn mars-btn--menu" id="mc-menu-btn">MENU<span class="mars-btn__hint">[M]</span></button>
                <button class="mars-btn mars-btn--sfx" id="mc-sfx">SFX ${sfxEnabled ? 'ON' : 'OFF'}</button>
            </div>
            <div class="mars-hud__minimap" id="mc-minimap"></div>
            <div class="mars-hud__telemetry" id="mc-telemetry">
                <button class="mars-tele__toggle" id="mc-tele-toggle" aria-label="Collapse telemetry">▾</button>
                <div class="mars-tele__site"></div>
                <div class="mars-tele__clock" id="mc-t-clock">SOL — · MET 00:00:00</div>
                <div class="mars-tele__grid">
                    <span>SPD</span><b id="mc-t-spd">0.0 m/s</b>
                    <span>HDG</span><b id="mc-t-hdg">000° N</b>
                    <span>ELEV</span><b id="mc-t-elev">—</b>
                    <span>SLOPE</span><b id="mc-t-slope">—</b>
                    <span>LAT</span><b id="mc-t-lat">—</b>
                    <span>LON</span><b id="mc-t-lon">—</b>
                    <span>ODO</span><b id="mc-t-odo">0 m</b>
                    <span>BATT</span><b id="mc-t-batt">100%</b>
                    <span>TGT</span><b id="mc-t-tgt"><span class="mars-tele__arrow" id="mc-t-tgt-arrow" hidden>▲</span><span id="mc-t-tgt-txt">—</span></b>
                </div>
            </div>
            <div class="mars-hud__prompt" id="mc-prompt" hidden>
                <button class="mars-btn mars-btn--collect" id="mc-collect">COLLECT<span class="mars-btn__hint">[E]</span></button>
            </div>
            <div class="mars-hud__boundary" id="mc-boundary" data-visible="false">⚠ OUT OF MISSION DIRECTIVES — RETURN TO SURVEY ZONE</div>
            <div class="mars-hud__objective" id="mc-objective" data-visible="false">
                <span id="mc-objective-text"></span>
                <button class="mars-btn mars-objective__skip" id="mc-skip-tutorial">SKIP</button>
            </div>
            <button class="mars-btn mars-hud__skip-intro" id="mc-skip-intro" data-visible="false">SKIP INTRO</button>
            <button class="mars-btn mars-hud__gear" id="mc-gear" data-visible="true">GEAR ${gear}<span class="mars-btn__hint">[G]</span></button>
            <div class="mars-hud__dronectl" id="mc-dronectl" data-visible="false" data-collapsed="false">
                <button class="mars-dronectl__toggle" id="mc-drone-collapse" aria-label="Toggle drone controls">▾</button>
                <div class="mars-dronectl__alt">
                    <span id="mc-alt-ceiling">150m</span>
                    <input type="range" id="mc-alt-slider" min="0" max="150" step="1" value="0" aria-label="Commanded altitude (m AGL)">
                    <span>0</span>
                </div>
                <div class="mars-dronectl__stat">
                    <b id="mc-drone-state">LANDED</b>
                    <span id="mc-drone-alt">ALT 0.0 m</span>
                </div>
                <button class="mars-btn mars-btn--land" id="mc-land">TAKE OFF<span class="mars-btn__hint">[L]</span></button>
            </div>
            <div class="mars-hud__inventory" id="mc-inventory">
                <div class="mars-hud__inventory-title">SAMPLES <span id="mc-inv-count">0</span></div>
                <div class="mars-hud__inventory-title">LAB <span id="mc-lab-count">0/0</span></div>
                <div class="mars-hud__node is-idle" id="mc-node">NODE IDLE</div>
                <ul id="mc-inv-list"></ul>
            </div>
        </div>
        <div class="mars-menu" id="mc-menu" data-open="false">
            <div class="mars-menu__panel">
                <h2>MARS COLONY</h2>
                <div class="mars-menu__section">
                    <h3>LANDING SITES</h3>
                    <div class="mars-menu__sites" id="mc-menu-sites"></div>
                </div>
                <div class="mars-menu__section">
                    <h3>SIM</h3>
                    <button class="mars-btn" id="mc-sol">SOL CYCLE ${solOn ? 'ON' : 'LOCKED (DAY)'}</button>
                    <button class="mars-btn mars-btn--reset" id="mc-reset">RESET MISSION</button>
                    <p class="mars-menu__note">GEAR (HUD button or G) time-compresses speed per unit:
                    rover REAL = the true 4.2 cm/s, G1 ×50, G2 ×150, G3 ×400; drones G1 = real scale
                    (10 / 6 m/s), G2 ×2, G3 ×4. SOL CYCLE runs a 40-min day/night — lock it for
                    permanent daylight (solar recharge needs the sun either way).
                    RESET MISSION restarts the site — unit positions, batteries, samples, lab and
                    map fog. The SCIENCE ARCHIVE below survives resets.</p>
                </div>
                <div class="mars-menu__section">
                    <h3>LAB — COLLECTED SAMPLES</h3>
                    <ul class="mars-menu__lab" id="mc-lab-list">
                        <li class="mars-menu__lab-empty">Nothing collected yet — follow the beacon.</li>
                    </ul>
                </div>
                <div class="mars-menu__section">
                    <h3>SCIENCE ARCHIVE</h3>
                    <ul class="mars-menu__lab" id="mc-archive-list">
                        <li class="mars-menu__lab-empty">No analyzed samples yet — deliver caches to the FIELD LAB.</li>
                    </ul>
                    <p class="mars-menu__note">Delivered caches are processed one at a time on the lab's
                    onboard edge node (Jetson-class, simulated). Analysis reveals the sample's real published
                    mission finding and files it here — the archive persists in your browser across visits
                    and sites.</p>
                </div>
                <div class="mars-menu__section">
                    <h3>CONTROLS</h3>
                    <ul class="mars-menu__controls">
                        <li>Rover / humanoid — WASD or left stick</li>
                        <li>Drone keys — W/S pitch · A/D yaw · Q/E strafe · R/F climb</li>
                        <li>Drone altitude slider — drag to fly to a set height (top = 150m ceiling, bottom = land)</li>
                        <li>Drone touch (RC Mode 2) — left stick throttle+yaw, right stick pitch+roll</li>
                        <li>Take off / land — L or the drone panel button</li>
                        <li>Switch unit — TAB · Collect — E · Menu — M</li>
                        <li>Lift drone — hover low over a cache container, E to sling it, fly to the FIELD LAB pad, E to deliver</li>
                        <li>Delivered caches auto-analyze on the lab edge node — findings land in the SCIENCE ARCHIVE</li>
                        <li>Sol cycle — drones recharge only when landed, nothing recharges at night</li>
                    </ul>
                </div>
                <button class="mars-btn mars-btn--resume" id="mc-resume">RESUME</button>
            </div>
        </div>
    `;

    const switchBtn = rootEl.querySelector('#mc-switch');
    const collectBtn = rootEl.querySelector('#mc-collect');
    const promptEl = rootEl.querySelector('#mc-prompt');
    const unitLabel = rootEl.querySelector('#mc-active-unit');
    const invCount = rootEl.querySelector('#mc-inv-count');
    const invList = rootEl.querySelector('#mc-inv-list');
    const minimapEl = rootEl.querySelector('#mc-minimap');
    const menuEl = rootEl.querySelector('#mc-menu');

    // Site name in the telemetry header + site cards in the menu (all via
    // textContent — config is trusted, but keep the habit).
    rootEl.querySelector('.mars-tele__site').textContent =
        `${site.name.toUpperCase()} · ${site.mission.toUpperCase()}`;
    const sitesEl = rootEl.querySelector('#mc-menu-sites');
    for (const s of Object.values(SITES)) {
        const a = document.createElement('a');
        a.className = 'mars-menu__site' + (s.id === site.id ? ' is-current' : '');
        a.href = `?site=${encodeURIComponent(s.id)}`;
        const name = document.createElement('b');
        name.textContent = s.name;
        const mission = document.createElement('span');
        mission.textContent = s.id === site.id ? `${s.mission} — CURRENT` : s.mission;
        a.append(name, mission);
        sitesEl.appendChild(a);
    }

    const tele = {
        clock: rootEl.querySelector('#mc-t-clock'),
        spd: rootEl.querySelector('#mc-t-spd'),
        hdg: rootEl.querySelector('#mc-t-hdg'),
        elev: rootEl.querySelector('#mc-t-elev'),
        slope: rootEl.querySelector('#mc-t-slope'),
        lat: rootEl.querySelector('#mc-t-lat'),
        lon: rootEl.querySelector('#mc-t-lon'),
        odo: rootEl.querySelector('#mc-t-odo'),
        batt: rootEl.querySelector('#mc-t-batt'),
        tgt: rootEl.querySelector('#mc-t-tgt-txt'),
        tgtArrow: rootEl.querySelector('#mc-t-tgt-arrow'),
    };
    const CARDINALS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    const missionStart = Date.parse(site.landingUtc);
    const metStart = Date.now();

    switchBtn.addEventListener('click', onSwitchUnit);
    collectBtn.addEventListener('click', onCollect);
    const sfxBtn = rootEl.querySelector('#mc-sfx');
    sfxBtn.addEventListener('click', () => {
        const on = onToggleSfx ? onToggleSfx() : false;
        sfxBtn.textContent = `SFX ${on ? 'ON' : 'OFF'}`;
    });
    const gearBtn = rootEl.querySelector('#mc-gear');
    gearBtn.addEventListener('click', () => {
        const g = onCycleGear ? onCycleGear() : null;
        if (g) gearBtn.firstChild.textContent = `GEAR ${g}`;
    });
    const solBtn = rootEl.querySelector('#mc-sol');
    solBtn.addEventListener('click', () => {
        const on = onToggleSol ? onToggleSol() : true;
        solBtn.textContent = `SOL CYCLE ${on ? 'ON' : 'LOCKED (DAY)'}`;
    });

    // RESET MISSION: two-step arm/confirm (no native confirm() dialog —
    // it would freeze the render loop and look nothing like the HUD).
    const resetBtn = rootEl.querySelector('#mc-reset');
    let resetDisarmTimer = null;
    resetBtn.addEventListener('click', () => {
        if (resetBtn.dataset.armed === 'true') {
            onReset?.();
            return;
        }
        resetBtn.dataset.armed = 'true';
        resetBtn.textContent = 'CONFIRM RESET?';
        clearTimeout(resetDisarmTimer);
        resetDisarmTimer = setTimeout(() => {
            resetBtn.dataset.armed = 'false';
            resetBtn.textContent = 'RESET MISSION';
        }, 4000);
    });

    // Boundary warning — cached so per-frame calls don't churn the DOM.
    const boundaryEl = rootEl.querySelector('#mc-boundary');
    let boundaryShown = false;

    /** Flash OUT OF MISSION DIRECTIVES while a unit pushes the site edge. */
    function setBoundary(visible) {
        if (visible === boundaryShown) return;
        boundaryShown = visible;
        boundaryEl.dataset.visible = String(visible);
    }

    // Tutorial objective banner — same cached-toggle idiom as setBoundary,
    // distinct placement (bottom) so it never collides with the boundary
    // warning (top).
    const objectiveEl = rootEl.querySelector('#mc-objective');
    const objectiveTextEl = rootEl.querySelector('#mc-objective-text');
    rootEl.querySelector('#mc-skip-tutorial').addEventListener('click', () => onSkipTutorial?.());
    let lastObjectiveText = null;
    function setObjective(text) {
        if (text === lastObjectiveText) return;
        lastObjectiveText = text;
        objectiveEl.dataset.visible = String(!!text);
        if (text) objectiveTextEl.textContent = text;
    }

    // SKIP INTRO — shown only while the landing-drop cinematic is playing.
    const skipIntroBtn = rootEl.querySelector('#mc-skip-intro');
    skipIntroBtn.addEventListener('click', () => onSkipIntro?.());
    function setIntroActive(active) {
        skipIntroBtn.dataset.visible = String(!!active);
    }

    /** Gear readout follows the active unit; null hides (humanoid). */
    function setGear(label) {
        gearBtn.dataset.visible = String(label != null);
        if (label != null) gearBtn.firstChild.textContent = `GEAR ${label}`;
    }

    // Drone control board: visible only while a drone is active.
    const dronectlEl = rootEl.querySelector('#mc-dronectl');
    const droneStateEl = rootEl.querySelector('#mc-drone-state');
    const droneAltEl = rootEl.querySelector('#mc-drone-alt');
    const landBtn = rootEl.querySelector('#mc-land');
    landBtn.addEventListener('click', () => onToggleLanding?.());

    // Altitude slider: dragging commands the drone's autopilot to that
    // AGL (bottom = land, top = ceiling). While the pointer is down the
    // telemetry loop must not fight the drag; when idle the knob tracks
    // the live altitude instead.
    const altSlider = rootEl.querySelector('#mc-alt-slider');
    const altCeilingEl = rootEl.querySelector('#mc-alt-ceiling');
    let altDragging = false;
    altSlider.addEventListener('pointerdown', () => { altDragging = true; });
    altSlider.addEventListener('pointerup', () => { altDragging = false; });
    altSlider.addEventListener('pointercancel', () => { altDragging = false; });
    altSlider.addEventListener('input', () => onCommandAlt?.(+altSlider.value));
    // don't leave the slider focused — arrow keys would re-command it
    altSlider.addEventListener('change', () => altSlider.blur());

    // Mobile: the board sits bottom-center — exactly where the chase cam
    // frames the drone — so it starts folded into a live-altitude chip and
    // expands on tap. CSS only applies the fold inside the coarse/narrow
    // media block, so desktop always renders the full board regardless of
    // this attribute. Persisted like the telemetry collapse.
    const droneToggle = rootEl.querySelector('#mc-drone-collapse');
    let droneCollapsed = isTouchDevice() && localStorage.getItem('mc-dronectl') !== 'open';
    dronectlEl.dataset.collapsed = String(droneCollapsed);
    droneToggle.addEventListener('click', () => {
        droneCollapsed = !droneCollapsed;
        dronectlEl.dataset.collapsed = String(droneCollapsed);
        try { localStorage.setItem('mc-dronectl', droneCollapsed ? 'closed' : 'open'); } catch { /* private mode */ }
    });

    function setDronePanel(visible) {
        dronectlEl.dataset.visible = String(visible);
    }

    function setDroneState({ landed, landing, alt, ceiling, altTarget }) {
        droneStateEl.textContent = landing ? 'LANDING…' : landed ? 'LANDED' : 'AIRBORNE';
        droneAltEl.textContent = `ALT ${alt.toFixed(1)} m`;
        landBtn.firstChild.textContent = landed ? 'TAKE OFF' : 'LAND';
        droneToggle.textContent = droneCollapsed ? `▴ ${alt.toFixed(0)} m` : '▾';
        if (ceiling && +altSlider.max !== ceiling) {
            altSlider.max = ceiling;
            altCeilingEl.textContent = `${ceiling}m`;
        }
        if (!altDragging) altSlider.value = altTarget ?? alt;
    }

    // Telemetry collapse (a mobile-facing control — the button is only
    // shown by the coarse-pointer CSS). Persisted like the SFX toggle.
    const teleEl = rootEl.querySelector('#mc-telemetry');
    const teleToggle = rootEl.querySelector('#mc-tele-toggle');
    function applyTeleCollapsed(collapsed) {
        teleEl.dataset.collapsed = String(collapsed);
        teleToggle.textContent = collapsed ? '▸' : '▾';
    }
    applyTeleCollapsed(localStorage.getItem('mc-tele') === 'collapsed');
    teleToggle.addEventListener('click', () => {
        const collapsed = teleEl.dataset.collapsed !== 'true';
        applyTeleCollapsed(collapsed);
        try { localStorage.setItem('mc-tele', collapsed ? 'collapsed' : 'open'); } catch { /* private mode */ }
    });
    rootEl.querySelector('#mc-menu-btn').addEventListener('click', () => setMenuOpen(true));
    rootEl.querySelector('#mc-resume').addEventListener('click', () => setMenuOpen(false));
    menuEl.addEventListener('click', (e) => {
        if (e.target === menuEl) setMenuOpen(false); // tap outside the panel
    });

    if (!isTouchDevice()) {
        rootEl.classList.add('mars-hud--desktop');
    }

    function setMenuOpen(open) {
        menuEl.dataset.open = String(open);
    }

    function isMenuOpen() {
        return menuEl.dataset.open === 'true';
    }

    function setActiveUnit(name) {
        unitLabel.textContent = name.toUpperCase();
    }

    /** Full action label ("COLLECT: Rochette", "SLING: … CACHE",
        "DELIVER TO LAB") or null to hide — the one E-button serves
        ground collection and the lift drone's sling/deliver. */
    function setPrompt(label) {
        if (label) {
            promptEl.hidden = false;
            collectBtn.firstChild.textContent = label;
        } else {
            promptEl.hidden = true;
        }
    }

    const labList = rootEl.querySelector('#mc-lab-list');
    const labCount = rootEl.querySelector('#mc-lab-count');

    /** HUD LAB line: containers delivered to the pad / total samples. */
    function setLab(delivered, total) {
        labCount.textContent = `${delivered}/${total}`;
    }

    function setInventory(items, deliveredIds, analyzedIds) {
        invCount.textContent = items.length;
        invList.replaceChildren(...items.map((i) => {
            const li = document.createElement('li');
            li.textContent = analyzedIds?.has(i.id) ? `${i.name} ✦`
                : deliveredIds?.has(i.id) ? `${i.name} ✓` : i.name;
            return li;
        }));
        // menu LAB panel: state + the location note, upgraded to the real
        // mission finding once the edge node has analyzed the sample
        if (items.length) {
            labList.replaceChildren(...items.map((i) => {
                const li = document.createElement('li');
                const analyzed = analyzedIds?.has(i.id);
                const name = document.createElement('b');
                name.textContent = analyzed ? `${i.name} — ANALYZED ✦`
                    : deliveredIds?.has(i.id) ? `${i.name} — DELIVERED · IN QUEUE` : i.name;
                const note = document.createElement('span');
                note.textContent = (analyzed ? i.finding : i.note) ?? '';
                li.append(name, note);
                return li;
            }));
        }
    }

    // Edge-node status line in the inventory box, fed at telemetry rate.
    const nodeEl = rootEl.querySelector('#mc-node');

    /** status = { name, progress 0..1 } while processing, null when idle. */
    function setNode(status) {
        nodeEl.classList.toggle('is-idle', !status);
        nodeEl.textContent = status
            ? `NODE ▸ ${status.name.toUpperCase()} ${Math.round(status.progress * 100)}%`
            : 'NODE IDLE';
    }

    const archiveList = rootEl.querySelector('#mc-archive-list');

    /** Persistent science archive (analysis.js records), newest first. */
    function setArchive(records) {
        if (!records?.length) return; // keep the empty-state hint
        archiveList.replaceChildren(...[...records].reverse().map((r) => {
            const li = document.createElement('li');
            const name = document.createElement('b');
            name.textContent = r.name;
            const finding = document.createElement('span');
            finding.textContent = r.finding;
            const meta = document.createElement('span');
            meta.className = 'mars-menu__lab-meta';
            meta.textContent = `${r.siteName ?? r.site} · ${new Date(r.analyzedAt).toLocaleDateString()}`;
            li.append(name, finding, meta);
            return li;
        }));
    }

    // speed m/s, heading rad (unit convention: W travels along
    // -[sin h, cos h], so bearing-from-north = -h), elev m, slope deg.
    // tgtRelDeg: steer angle to the target relative to forward travel
    // (0 = dead ahead, +90 = hard right) — rotates the TGT arrow.
    function setTelemetry({ speed, heading, elevation, slopeDeg, x, z, odo, charge, dead, target, tgtRelDeg }) {
        const bearing = ((-heading * 180 / Math.PI) % 360 + 360) % 360;
        const card = CARDINALS[Math.round(bearing / 45) % 8];
        const lat = site.center.lat - z / M_PER_DEG;
        const lon = site.center.lon + x / M_PER_DEG;

        // Live mission sol (real landing epoch, real sol length) + session MET.
        const sol = Math.floor((Date.now() - missionStart) / SOL_MS);
        const met = Math.floor((Date.now() - metStart) / 1000);
        const hh = String(Math.floor(met / 3600)).padStart(2, '0');
        const mm = String(Math.floor((met % 3600) / 60)).padStart(2, '0');
        const ss = String(met % 60).padStart(2, '0');
        tele.clock.textContent = `SOL ${sol} · MET ${hh}:${mm}:${ss}`;

        tele.spd.textContent = `${speed.toFixed(1)} m/s`;
        tele.hdg.textContent = `${String(Math.round(bearing)).padStart(3, '0')}° ${card}`;
        tele.elev.textContent = `${elevation.toFixed(1)} m`;
        tele.slope.textContent = `${slopeDeg.toFixed(1)}°`;
        tele.lat.textContent = `${Math.abs(lat).toFixed(5)}° ${lat >= 0 ? 'N' : 'S'}`;
        tele.lon.textContent = `${Math.abs(lon).toFixed(5)}° ${lon >= 0 ? 'E' : 'W'}`;
        tele.odo.textContent = odo >= 1000 ? `${(odo / 1000).toFixed(2)} km` : `${Math.round(odo)} m`;

        tele.batt.textContent = dead ? `${Math.round(charge)}% ⚠` : `${Math.round(charge)}%`;
        tele.batt.className = charge <= 15 ? 'is-crit' : charge <= 35 ? 'is-low' : '';

        tele.tgt.textContent = target
            ? `${target.dist >= 1000 ? (target.dist / 1000).toFixed(2) + ' km' : Math.round(target.dist) + ' m'} · ${target.sample.name}`
            : 'ALL COLLECTED';
        tele.tgtArrow.hidden = !target || tgtRelDeg == null;
        if (!tele.tgtArrow.hidden) {
            tele.tgtArrow.style.transform = `rotate(${Math.round(tgtRelDeg)}deg)`;
        }
    }

    return {
        minimapEl, setActiveUnit, setPrompt, setInventory, setLab,
        setNode, setArchive, setBoundary, setObjective, setIntroActive,
        setTelemetry, setMenuOpen, isMenuOpen,
        setDronePanel, setDroneState, setGear,
    };
}
