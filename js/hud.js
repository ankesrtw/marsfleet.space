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

export function createHud(rootEl, { site, onSwitchUnit, onCollect, onToggleSfx, sfxEnabled = true }) {
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
            <div class="mars-hud__inventory" id="mc-inventory">
                <div class="mars-hud__inventory-title">SAMPLES <span id="mc-inv-count">0</span></div>
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
                    <h3>LAB — COLLECTED SAMPLES</h3>
                    <ul class="mars-menu__lab" id="mc-lab-list">
                        <li class="mars-menu__lab-empty">Nothing collected yet — follow the beacon.</li>
                    </ul>
                </div>
                <div class="mars-menu__section">
                    <h3>CONTROLS</h3>
                    <ul class="mars-menu__controls">
                        <li>Drive / walk / fly — WASD or left joystick</li>
                        <li>Turn (drone) — right joystick</li>
                        <li>Switch unit — TAB or SWITCH UNIT</li>
                        <li>Collect sample — E or COLLECT</li>
                        <li>Menu — M or MENU</li>
                        <li>Sol cycle — solar recharge stops at night</li>
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

    function setPrompt(sampleName) {
        if (sampleName) {
            promptEl.hidden = false;
            collectBtn.firstChild.textContent = `COLLECT: ${sampleName}`;
        } else {
            promptEl.hidden = true;
        }
    }

    const labList = rootEl.querySelector('#mc-lab-list');

    function setInventory(items) {
        invCount.textContent = items.length;
        invList.replaceChildren(...items.map((i) => {
            const li = document.createElement('li');
            li.textContent = i.name;
            return li;
        }));
        // menu LAB panel: name + the sample's real mission note
        if (items.length) {
            labList.replaceChildren(...items.map((i) => {
                const li = document.createElement('li');
                const name = document.createElement('b');
                name.textContent = i.name;
                const note = document.createElement('span');
                note.textContent = i.note ?? '';
                li.append(name, note);
                return li;
            }));
        }
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
        minimapEl, setActiveUnit, setPrompt, setInventory,
        setTelemetry, setMenuOpen, isMenuOpen,
    };
}
