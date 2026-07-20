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
import { M_PER_DEG, SOL_MS } from './sites.js';

export function createHud(rootEl, { site, onSwitchUnit, onCollect, onToggleSfx, sfxEnabled = true, onCycleGear, gear = 'G2', onToggleSol, solOn = true, onToggleLanding, onCommandAlt, onReset, onSkipIntro, onSkipMission, onReplayIntro, onStartMission, missions = [], onSetOverlayMode, onTravel, onToggleNv, onReplayHologram, onVanDeploy, onPhoto, onToggleConsent, consentOn = true, privacyUrl = '/privacy.html' }) {
    rootEl.innerHTML = `
        <div class="mars-hud">
            <div class="mars-hud__top">
                <button class="mars-btn mars-btn--switch" id="mc-switch">SWITCH UNIT<span class="mars-btn__hint">[TAB]</span></button>
                <div class="mars-hud__unit" id="mc-active-unit">ROVER</div>
                <button class="mars-btn mars-btn--nv" id="mc-nv">NV<span class="mars-btn__hint">[N]</span></button>
                <div class="mars-hud__drop" id="mc-drop">
                    <button class="mars-btn mars-btn--drop" id="mc-drop-btn">OVERLAYS ▾</button>
                    <div class="mars-hud__drop-panel" id="mc-drop-panel" data-open="false">
                        <div class="mars-hud__drop-title">MINIMAP BASE</div>
                        <div class="mars-hud__drop-modes" id="mc-drop-modes">
                            <button class="mars-btn" data-mode="photo">PHOTO</button>
                            <button class="mars-btn" data-mode="elevation">ELEVATION</button>
                            <button class="mars-btn" data-mode="slope">SLOPE</button>
                            <button class="mars-btn" data-mode="path">PATH</button>
                        </div>
                        <div class="mars-hud__drop-samples" id="mc-drop-samples">SAMPLES —</div>
                    </div>
                </div>
                <button class="mars-btn mars-btn--menu" id="mc-menu-btn">MENU<span class="mars-btn__hint">[M]</span></button>
                <button class="mars-btn mars-btn--sfx" id="mc-sfx">SFX ${sfxEnabled ? 'ON' : 'OFF'}</button>
            </div>
            <div class="mars-hud__nv-overlay" id="mc-nv-overlay" data-visible="false"></div>
            <div class="mars-hud__rotate" id="mc-rotate" aria-hidden="true">
                <div class="mars-hud__rotate-card">
                    <div class="mars-hud__rotate-glyph">⟳</div>
                    <b>ROTATE TO LANDSCAPE</b>
                    <p>The colony HUD needs the wide view.</p>
                </div>
            </div>
            <div class="mars-hud__minimap" id="mc-minimap">
                <div class="mars-hud__clock" id="mc-clock">
                    <b id="mc-clock-sol">SOL —</b>
                    <span id="mc-clock-time">--:--</span>
                    <i id="mc-clock-glyph">☀</i>
                </div>
            </div>
            <div class="mars-hud__compass" id="mc-compass" aria-hidden="true">
                <span class="mars-compass__cardinal">N</span>
                <span class="mars-compass__needle" id="mc-compass-needle">▲</span>
                <span class="mars-compass__wind" id="mc-compass-wind" hidden>▲</span>
                <div class="mars-compass__gps" id="mc-compass-gps"></div>
            </div>
            <div class="mars-hud__gps" id="mc-gps">
                <div class="mars-hud__gps-title">GPS RELAY</div>
                <ul id="mc-gps-list"></ul>
            </div>
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
                    <span>HULL</span><b id="mc-t-hull">—</b>
                    <span>ROLL</span><b id="mc-t-roll">—</b>
                    <span>WIND</span><b id="mc-t-wind">CALM</b>
                    <span>TGT</span><b id="mc-t-tgt"><span class="mars-tele__arrow" id="mc-t-tgt-arrow" hidden>▲</span><span id="mc-t-tgt-txt">—</span></b>
                </div>
            </div>
            <div class="mars-hud__prompt" id="mc-prompt" hidden>
                <button class="mars-btn mars-btn--collect" id="mc-collect">COLLECT<span class="mars-btn__hint">[E]</span></button>
            </div>
            <div class="mars-hud__boundary" id="mc-boundary" data-visible="false">⚠ OUT OF MISSION DIRECTIVES — RETURN TO SURVEY ZONE</div>
            <div class="mars-hud__hazard" id="mc-hazard" data-visible="false"></div>
            <div class="mars-hud__toast" id="mc-toast" data-visible="false"></div>
            <div class="mars-hud__guide" id="mc-guide" data-visible="false">
                <b id="mc-guide-done"></b>
                <span id="mc-guide-next"></span>
            </div>
            <div class="mars-hud__objective" id="mc-objective" data-visible="false">
                <span id="mc-objective-text"></span>
                <button class="mars-btn mars-objective__skip" id="mc-skip-tutorial">SKIP</button>
            </div>
            <button class="mars-btn mars-hud__skip-intro" id="mc-skip-intro" data-visible="false">SKIP INTRO</button>
            <button class="mars-btn mars-hud__gear" id="mc-gear" data-visible="true">GEAR ${gear}<span class="mars-btn__hint">[G]</span></button>
            <button class="mars-btn mars-hud__van" id="mc-van" data-visible="false">DEPLOY BASE<span class="mars-btn__hint">[V]</span></button>
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
                <button class="mars-btn mars-btn--photo" id="mc-photo" data-visible="false">PHOTO<span class="mars-btn__hint">[P]</span></button>
            </div>
            <div class="mars-hud__inventory" id="mc-inventory">
                <div class="mars-hud__inventory-title">SAMPLES <span id="mc-inv-count">0</span></div>
                <div class="mars-hud__inventory-title">LAB <span id="mc-lab-count">0/0</span></div>
                <div class="mars-hud__node is-idle" id="mc-node">NODE IDLE</div>
                <ul id="mc-inv-list"></ul>
            </div>
        </div>
        <div class="mars-menu" id="mc-tutorial-overview" data-open="false">
            <div class="mars-menu__panel">
                <h2>FIRST MISSION — TUTORIAL</h2>
                <div class="mars-menu__section">
                    <h3>MISSION STEPS</h3>
                    <ol class="mars-tutorial__steps" id="mc-tutorial-steps"></ol>
                    <p class="mars-menu__note">One step shows at a time in the banner at the bottom of the
                    screen — complete it and the next appears. Replay anytime from MENU → MISSIONS.</p>
                </div>
                <button class="mars-btn mars-btn--resume" id="mc-tutorial-start">START MISSION</button>
                <button class="mars-btn" id="mc-tutorial-skip-all">SKIP TUTORIAL</button>
            </div>
        </div>
        <div class="mars-menu" id="mc-menu" data-open="false">
            <div class="mars-menu__panel">
                <h2>MARS SIM</h2>
                <div class="mars-menu__section">
                    <h3>MISSION MAP</h3>
                    <button class="mars-btn mars-btn--map" id="mc-open-hub">◉ OPEN MISSION MAP</button>
                    <p class="mars-menu__note">Return to the orbital site map to switch
                    landing sites or start a new one. Each site keeps its own saved
                    progress — see its pin badge on the globe.</p>
                </div>
                <div class="mars-menu__section">
                    <h3>SIM</h3>
                    <button class="mars-btn" id="mc-sol">SOL CYCLE ${solOn ? 'ON' : 'LOCKED (DAY)'}</button>
                    <button class="mars-btn" id="mc-nv-menu">NIGHT VISION OFF</button>
                    <button class="mars-btn mars-btn--reset" id="mc-reset">RESET RUN</button>
                    <button class="mars-btn" id="mc-replay-intro">▶ LANDING INTRO</button>
                    <button class="mars-btn" id="mc-analytics">ANALYTICS ${consentOn ? 'ON' : 'OFF'}</button>
                    <p class="mars-menu__note">Anonymous analytics &amp; crash diagnostics — no account, no
                    location, no ads — help us improve Mars Sim. Turn them off here anytime.
                    <a id="mc-privacy-link" href="${privacyUrl}" target="_blank" rel="noopener">Privacy &amp; data ›</a></p>
                    <p class="mars-menu__note">GEAR (HUD button or G) time-compresses speed per unit:
                    rover REAL = the true 4.2 cm/s, G1 ×50, G2 ×150, G3 ×400; drones G1 = real scale
                    (10 / 6 m/s), G2 ×2, G3 ×4. SOL CYCLE runs a 40-min day/night — lock it for
                    permanent daylight (solar recharge needs the sun either way).
                    RESET RUN restarts this site's live run — unit positions, batteries, samples,
                    lab and map fog. Its SCIENCE ARCHIVE, missions and photos survive. To wipe a
                    site's whole save (RESET SITE) or the entire game (RESET GAME), use its pin on
                    the OPEN MISSION MAP globe.
                    The clock on the minimap reads that cycle as Mars local time (noon = the sun at
                    apex, so it can never disagree with the sky), counting up from the real sol this
                    site's rover is on today. LOCK appears there while the cycle is frozen.</p>
                </div>
                <div class="mars-menu__section">
                    <h3>MISSIONS</h3>
                    <div class="mars-menu__missions" id="mc-missions-list"></div>
                    <p class="mars-menu__note">Objective chains for this site. ✓ missions stay completed
                    across visits and RESET RUN — replay anytime.</p>
                </div>
                <div class="mars-menu__section">
                    <h3>BASE STRUCTURES</h3>
                    <ul class="mars-menu__lab" id="mc-outposts-list">
                        <li class="mars-menu__lab-empty">No base-building charted for this site yet.</li>
                    </ul>
                    <p class="mars-menu__note">Analyzing a flagged sample establishes a checkpost at its
                    site. Complete every mission to raise the Signal Headquarters beside the FIELD LAB.
                    Structures are earned from the archive and mission record, so they survive RESET RUN.</p>
                </div>
                <div class="mars-menu__section">
                    <h3>BASES — TRAVEL</h3>
                    <div class="mars-menu__bases" id="mc-bases-list"></div>
                    <p class="mars-menu__note">Every established base, with the distance from the unit you
                    are driving. TRAVEL relocates that unit to the base's chargepad — it arrives docked,
                    charging (and repairing, if it's the rover). Bases are named in-world on a plate above
                    the structure.</p>
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
                    <button class="mars-btn" id="mc-hologram-replay">▶ ARIANA HOLOGRAM</button>
                    <p class="mars-menu__note">Delivered caches are processed one at a time on the lab's
                    onboard edge node (Jetson-class, simulated). Analysis reveals the sample's real published
                    mission finding and files it here — the archive persists in your browser across visits
                    and sites.</p>
                </div>
                <div class="mars-menu__section">
                    <h3>SURVEY IMAGING</h3>
                    <div class="mars-menu__photos" id="mc-photo-album">
                        <p class="mars-menu__lab-empty">No survey images yet — fly the recon drone over a
                        photo target and press P.</p>
                    </div>
                    <p class="mars-menu__note">Real frames captured by the recon drone's survey camera
                    (Wave 12.13). Re-imaging a target replaces its frame. The album persists in your
                    browser like the science archive.</p>
                </div>
                <div class="mars-menu__section">
                    <h3>SCIENCE OVERLAYS</h3>
                    <div class="mars-menu__overlays" id="mc-overlay-modes">
                        <button class="mars-btn" data-mode="photo">PHOTO</button>
                        <button class="mars-btn" data-mode="elevation">ELEVATION</button>
                        <button class="mars-btn" data-mode="slope">SLOPE</button>
                        <button class="mars-btn" data-mode="path">PATH</button>
                    </div>
                    <p class="mars-menu__note">Minimap base layer, from the same DEM the physics drives on:
                    hypsometric elevation, slope steepness (colors match the ROLL gauge), or the active
                    unit's breadcrumb trail. Your choice persists.</p>
                </div>
                <div class="mars-menu__section">
                    <h3>CONTROLS</h3>
                    <ul class="mars-menu__controls">
                        <li>Rover / humanoid — WASD or left stick</li>
                        <li>Humanoid jump — SPACE (0.38 g: ~1.5 m up, ~1.8 s hang)</li>
                        <li>Drone keys — W/S pitch · A/D yaw · Q/E strafe · R/F climb</li>
                        <li>Drone altitude slider — drag to fly to a set height (top = 150m ceiling, bottom = land)</li>
                        <li>Drone touch (RC Mode 2) — left stick throttle+yaw, right stick pitch+roll</li>
                        <li>Take off / land — L or the drone panel button</li>
                        <li>Switch unit — TAB · Collect — E · Menu — M</li>
                        <li>Humanoid + outpost-flagged sample — E starts a timed core drill (~4.5 s). Moving cancels it; the rover's arm still collects instantly</li>
                        <li>Van — walk the humanoid within 4 m, E to board (only the humanoid can drive it) · E again to dismount</li>
                        <li>Van deploy — V (or the DEPLOY BASE button): panels out, the van becomes a field chargepad + tether anchor. V again packs up</li>
                        <li>Night vision — N (or the NV button): an image intensifier for driving after dark, when the terrain is otherwise nearly black. The HUD stays in its own colours</li>
                        <li>Lift drone — hover low over a cache container, E to sling it, fly to the FIELD LAB pad, E to deliver</li>
                        <li>Delivered caches auto-analyze on the lab edge node — findings land in the SCIENCE ARCHIVE</li>
                        <li>GPS RELAY — coloured ticks on the compass rim point at every other unit and the nearest base (dial is north-up); the card's arrows are steer angles (up = dead ahead)</li>
                        <li>Sol cycle — solar recharges only when landed, and only in daylight</li>
                        <li>Chargepads — park ON a base pad to fast-charge (and repair the rover). Station-powered, so it works at night: the only way back from a flat battery after dark</li>
                        <li>Dead battery in the air — the rotors quit and the drone FALLS. Land before it does.</li>
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
    // "OPEN MISSION MAP" returns to the globe hub (plan 22-C): a full nav to
    // ?hub tears down the sim's WebGL context and re-boots into the hub
    // (boot() sees ?hub). Replaces the old in-menu ?site= landing-site list.
    rootEl.querySelector('#mc-open-hub')?.addEventListener('click', () => {
        window.location.href = '?hub';
    });

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
        hull: rootEl.querySelector('#mc-t-hull'),
        roll: rootEl.querySelector('#mc-t-roll'),
        wind: rootEl.querySelector('#mc-t-wind'),
        tgt: rootEl.querySelector('#mc-t-tgt-txt'),
        tgtArrow: rootEl.querySelector('#mc-t-tgt-arrow'),
    };
    // Compass dial under the minimap: fixed N ring, needle = the active
    // unit's NOSE bearing (same convention as the HDG readout). Updated
    // at telemetry rate with no CSS transition — a tween would spin the
    // long way round on every 359->0 wrap.
    const compassNeedle = rootEl.querySelector('#mc-compass-needle');
    // Wind needle on the same dial (Wave 6): points where the wind blows
    // TOWARD, teal to read apart from the amber nose needle; hidden in
    // calm air. Same no-transition rule (359->0 wrap).
    const windNeedle = rootEl.querySelector('#mc-compass-wind');
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
    // Analytics consent toggle (plan 24) — same pattern as SFX: main.js owns
    // the state (persists it + starts/stops collection) and returns the new
    // value so the label follows it.
    const analyticsBtn = rootEl.querySelector('#mc-analytics');
    analyticsBtn.addEventListener('click', () => {
        const on = onToggleConsent ? onToggleConsent() : consentOn;
        analyticsBtn.textContent = `ANALYTICS ${on ? 'ON' : 'OFF'}`;
    });
    const gearBtn = rootEl.querySelector('#mc-gear');
    gearBtn.addEventListener('click', () => {
        const g = onCycleGear ? onCycleGear() : null;
        if (g) gearBtn.firstChild.textContent = `GEAR ${g}`;
    });
    // Wave 12: van deploy — visible only while the van is driven (it takes
    // the gear button's slot; the van has no gears). The V key routes here.
    const vanBtn = rootEl.querySelector('#mc-van');
    vanBtn.addEventListener('click', () => {
        const deploying = onVanDeploy ? onVanDeploy() : null;
        if (deploying != null) setVanButton(deploying ? 'packup' : 'deploy');
    });

    /** state: null hides the button; 'deploy' | 'packup' set the label. */
    function setVanButton(state) {
        vanBtn.dataset.visible = String(state != null);
        if (state) vanBtn.firstChild.textContent =
            state === 'packup' ? 'PACK UP BASE' : 'DEPLOY BASE';
    }

    // Wave 12.13: recon survey imaging — PHOTO button in the dronectl
    // cluster (P routes here; also the touch path). Fed per frame, so the
    // last-label guard keeps the DOM writes to actual changes.
    const photoBtn = rootEl.querySelector('#mc-photo');
    photoBtn.addEventListener('click', () => onPhoto?.());
    let lastPhotoLabel = null;
    /** label: null hides; a string shows the button with that label. */
    function setPhotoButton(label) {
        if (label === lastPhotoLabel) return;
        lastPhotoLabel = label;
        photoBtn.dataset.visible = String(label != null);
        if (label != null) photoBtn.firstChild.textContent = label;
    }

    // SURVEY IMAGING album (menu): captured-frame thumbnails, newest last.
    const photoAlbumEl = rootEl.querySelector('#mc-photo-album');
    function setPhotoAlbum(entries) {
        if (!entries?.length) return; // keep the empty-state hint
        photoAlbumEl.replaceChildren(...entries.map((e) => {
            const fig = document.createElement('figure');
            const img = document.createElement('img');
            img.src = e.dataUrl;
            img.alt = e.name;
            img.loading = 'lazy';
            const cap = document.createElement('figcaption');
            const name = document.createElement('b');
            name.textContent = e.name;
            const meta = document.createElement('span');
            meta.textContent = `${e.siteName ?? e.site}${e.sol != null ? ` · SOL ${e.sol}` : ''}`;
            cap.append(name, meta);
            fig.append(img, cap);
            return fig;
        }));
    }
    const solBtn = rootEl.querySelector('#mc-sol');
    solBtn.addEventListener('click', () => {
        const on = onToggleSol ? onToggleSol() : true;
        solBtn.textContent = `SOL CYCLE ${on ? 'ON' : 'LOCKED (DAY)'}`;
    });

    // Night vision (Wave 9.7). TWO entry points, ONE state: the top-bar NV
    // button (and the N key) for a mid-drive toggle, and a menu button —
    // main.js owns the state and calls setNightVision() back, so the two
    // labels can never drift apart.
    const nvBtn = rootEl.querySelector('#mc-nv');
    const nvMenuBtn = rootEl.querySelector('#mc-nv-menu');
    const nvOverlay = rootEl.querySelector('#mc-nv-overlay');
    nvBtn.addEventListener('click', () => onToggleNv?.());
    nvMenuBtn.addEventListener('click', () => onToggleNv?.());

    /** Reflect the mode: button states + the scanline/vignette overlay.
        The image itself is filtered on the canvas by main.js — the HUD
        must stay unfiltered and readable. */
    function setNightVision(on) {
        nvBtn.dataset.on = String(on);
        nvBtn.firstChild.textContent = on ? 'NV ON' : 'NV';
        nvMenuBtn.textContent = `NIGHT VISION ${on ? 'ON' : 'OFF'}`;
        nvMenuBtn.classList.toggle('is-active', on);
        nvOverlay.dataset.visible = String(on);
    }

    // RESET RUN: two-step arm/confirm (no native confirm() dialog — it would
    // freeze the render loop and look nothing like the HUD). The narrowest of
    // the three reset tiers (plan 22-C): reloads the live run only; the site's
    // saved progress is untouched. RESET SITE / RESET GAME live on the hub.
    const resetBtn = rootEl.querySelector('#mc-reset');
    let resetDisarmTimer = null;
    resetBtn.addEventListener('click', () => {
        if (resetBtn.dataset.armed === 'true') {
            onReset?.();
            return;
        }
        resetBtn.dataset.armed = 'true';
        resetBtn.textContent = 'CONFIRM RESET RUN?';
        clearTimeout(resetDisarmTimer);
        resetDisarmTimer = setTimeout(() => {
            resetBtn.dataset.armed = 'false';
            resetBtn.textContent = 'RESET RUN';
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

    // Environmental hazard banner (Wave 4) — same cached-toggle idiom as
    // setBoundary, its own element so both can show at once (stacked).
    const HAZARD_LABELS = {
        'soft-sand': '⚠ SOFT TERRAIN — TRACTION LOSS',
        'dust-storm': '⚠ DUST STORM — VISIBILITY / SOLAR DEGRADED',
        // Wave 6 consequences — recovery instructions live in the banner
        // (pct appended below when provided)
        'sinking': '⚠ SINKING — EASE OFF / LOWER GEAR',
        'rollover': '⚠ ROLLOVER — ROCK W/S TO RIGHT, OR BRING A UNIT CLOSE',
        'bogged': '⚠ BOGGED DOWN — ROCK W/S, DON\'T DIG · UNIT NEARBY SPEEDS TOW',
        'rover-down': '⚠ ROVER DOWN — HOLD NEAR IT TO ASSIST',
        'dig': '✦ DRILLING CORE SAMPLE',
    };
    const hazardEl = rootEl.querySelector('#mc-hazard');
    let hazardLabelShown = null;

    /** hazard = { type, pct? } | null — label per type, live % appended. */
    function setHazard(hazard) {
        let label = hazard ? (HAZARD_LABELS[hazard.type] ?? `⚠ ${hazard.type.toUpperCase()}`) : null;
        if (label && hazard.pct != null) label += ` (${hazard.pct}%)`;
        if (label === hazardLabelShown) return;
        hazardLabelShown = label;
        hazardEl.dataset.visible = String(!!label);
        if (label) hazardEl.textContent = label;
    }

    // One-shot build toast (Wave 7) — third slot in the top banner stack.
    // Unlike the boundary/hazard banners it self-hides: announcements,
    // not persistent state.
    const toastEl = rootEl.querySelector('#mc-toast');
    let toastTimer = null;
    function toast(text) {
        toastEl.textContent = text;
        toastEl.dataset.visible = 'true';
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => { toastEl.dataset.visible = 'false'; }, 6000);
    }

    // Next-step guidance (Wave 9.8). The objective banner has always shown
    // exactly one step and swapped it in silently, so completing a step gave
    // no confirmation and no preview — you had to notice the bottom line had
    // changed. This is the missing beat: a transient banner that names the
    // step you just finished and the one that follows.
    //
    // It gets its OWN slot (4th in the top stack) rather than reusing the
    // build toast: both can fire in the same breath — analyzing a sample
    // completes a mission step AND raises a checkpost — and one slot would
    // mean one of the two announcements silently eats the other.
    const guideEl = rootEl.querySelector('#mc-guide');
    const guideDoneEl = rootEl.querySelector('#mc-guide-done');
    const guideNextEl = rootEl.querySelector('#mc-guide-next');
    let guideTimer = null;
    function guide(doneText, nextText) {
        guideDoneEl.textContent = doneText;
        guideNextEl.textContent = nextText ?? '';
        guideEl.dataset.visible = 'true';
        clearTimeout(guideTimer);
        guideTimer = setTimeout(() => { guideEl.dataset.visible = 'false'; }, 6000);
    }

    // Mission objective banner — same cached-toggle idiom as setBoundary,
    // distinct placement (bottom) so it never collides with the boundary
    // warning (top).
    const objectiveEl = rootEl.querySelector('#mc-objective');
    const objectiveTextEl = rootEl.querySelector('#mc-objective-text');
    rootEl.querySelector('#mc-skip-tutorial').addEventListener('click', () => onSkipMission?.());
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

    // Mission overview card — all steps up front; START dismisses it and
    // the per-step banner takes over. SKIP ends the whole chain.
    const tutorialOverviewEl = rootEl.querySelector('#mc-tutorial-overview');
    const tutorialTitleEl = tutorialOverviewEl.querySelector('h2');
    const tutorialStepsEl = rootEl.querySelector('#mc-tutorial-steps');
    rootEl.querySelector('#mc-tutorial-start').addEventListener('click', () => setTutorialOverview(null));
    rootEl.querySelector('#mc-tutorial-skip-all').addEventListener('click', () => {
        setTutorialOverview(null);
        onSkipMission?.();
    });
    function setTutorialOverview(steps, title) {
        tutorialOverviewEl.dataset.open = String(!!steps);
        if (!steps) return;
        if (title) tutorialTitleEl.textContent = title;
        tutorialStepsEl.replaceChildren(...steps.map((text) => {
            const li = document.createElement('li');
            li.textContent = text;
            return li;
        }));
    }

    // Menu replay — watch the landing drop anytime, no mission reset
    // needed (the first-visit flag stays untouched).
    rootEl.querySelector('#mc-replay-intro').addEventListener('click', () => {
        setMenuOpen(false);
        onReplayIntro?.();
    });

    // Wave 9.5: Ariana hologram replay from the SCIENCE ARCHIVE section.
    rootEl.querySelector('#mc-hologram-replay').addEventListener('click', () => {
        setMenuOpen(false);
        onReplayHologram?.();
    });

    // MISSIONS menu section: one ▶ button per chain this site offers
    // (✓ = completed; replay allowed either way). Rebuilt via setMissions
    // whenever a mission starts or completes.
    const missionsListEl = rootEl.querySelector('#mc-missions-list');
    function setMissions(entries) {
        missionsListEl.replaceChildren(...entries.map((m) => {
            const btn = document.createElement('button');
            btn.className = 'mars-btn mars-menu__mission' + (m.done ? ' is-done' : '');
            btn.textContent = m.active ? `▸ ${m.title} — IN PROGRESS`
                : m.done ? `✓ ${m.title} — REPLAY` : `▶ ${m.title}`;
            btn.addEventListener('click', () => {
                setMenuOpen(false);
                onStartMission?.(m.id);
            });
            return btn;
        }));
        if (!entries.length) {
            const p = document.createElement('p');
            p.className = 'mars-menu__lab-empty';
            p.textContent = 'No missions charted for this site yet.';
            missionsListEl.appendChild(p);
        }
    }
    setMissions(missions);

    // SCIENCE OVERLAYS mode buttons: hud only tracks the active chip;
    // fog.js owns the mode + its persistence. main.js re-syncs the chip
    // from the persisted mode right after boot via setOverlayMode().
    // Wave 10.4: the top-bar dropdown mirrors the menu section — SAME
    // handler + active-state list, just a faster second entry point.
    const overlayBtns = [...rootEl.querySelectorAll('#mc-overlay-modes button, #mc-drop-modes button')];
    function setOverlayMode(mode) {
        for (const b of overlayBtns) b.classList.toggle('is-active', b.dataset.mode === mode);
    }
    for (const b of overlayBtns) {
        b.addEventListener('click', () => {
            setOverlayMode(b.dataset.mode);
            onSetOverlayMode?.(b.dataset.mode);
        });
    }
    setOverlayMode('photo');

    // Dropdown open/close — closes on any press outside it. The panel's
    // contents are static buttons (never rebuilt per frame), so clicks
    // land reliably (the Wave 9 rebuild-breaks-clicks lesson).
    const dropWrap = rootEl.querySelector('#mc-drop');
    const dropPanel = rootEl.querySelector('#mc-drop-panel');
    rootEl.querySelector('#mc-drop-btn').addEventListener('click', () => {
        dropPanel.dataset.open = String(dropPanel.dataset.open !== 'true');
    });
    document.addEventListener('pointerdown', (e) => {
        if (dropPanel.dataset.open === 'true' && !dropWrap.contains(e.target)) {
            dropPanel.dataset.open = 'false';
        }
    });

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
    // Collapse is a phone-only affordance (the toggle only renders inside
    // the coarse-pointer CSS) — a 'collapsed' persisted during a touch
    // session must never apply on desktop, where there is no toggle to
    // reopen it (the 2026-07-12 "telemetry card vanished" playtest bug).
    applyTeleCollapsed(isTouchDevice() && localStorage.getItem('mc-tele') === 'collapsed');
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

    const dropSamples = rootEl.querySelector('#mc-drop-samples');
    // boot state — setInventory only runs on the first inventory CHANGE
    dropSamples.textContent = `SAMPLES 0/${site.samples?.length ?? 0} · ANALYZED 0`;
    function setInventory(items, deliveredIds, analyzedIds) {
        invCount.textContent = items.length;
        // Wave 10.4 dropdown tally — same data, glanceable from the top bar
        dropSamples.textContent =
            `SAMPLES ${items.length}/${site.samples?.length ?? 0} · ANALYZED ${analyzedIds?.size ?? 0}`;
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

    // BASE STRUCTURES menu section (Wave 7): every structure the site
    // offers, built or still locked with its unlock hint. Empty entries
    // keep the "not charted" hint — Gale has no base-building by design.
    const outpostsList = rootEl.querySelector('#mc-outposts-list');
    function setOutposts(entries) {
        if (!entries?.length) return;
        outpostsList.replaceChildren(...entries.map((e) => {
            const li = document.createElement('li');
            const name = document.createElement('b');
            name.textContent = `${e.built ? '⬢' : '◇'} ${e.name}`;
            const state = document.createElement('span');
            state.textContent = e.built
                ? (e.kind === 'hq' ? 'Established — every mission complete.' : 'Established — sample analyzed.')
                : (e.kind === 'hq' ? 'Locked — complete all missions.' : 'Locked — analyze this sample at the FIELD LAB.');
            li.append(name, state);
            return li;
        }));
    }

    // Mars clock (Wave 9.6): sol number + local time-of-sol, docked as a
    // footer strip on the minimap — the one slot free on BOTH viewports
    // (the top bar can't take another chip at 390px, and every rail is
    // spoken for). Reads mars-clock.js, which reads the sun: this card can
    // never disagree with the sky. LOCK shows when the sol cycle is frozen.
    const clockSolEl = rootEl.querySelector('#mc-clock-sol');
    const clockTimeEl = rootEl.querySelector('#mc-clock-time');
    const clockGlyphEl = rootEl.querySelector('#mc-clock-glyph');
    const clockEl = rootEl.querySelector('#mc-clock');
    function setMarsClock({ sol, time, glyph, day, locked }) {
        clockSolEl.textContent = `SOL ${sol}`;
        clockTimeEl.textContent = locked ? `${time} LOCK` : time;
        clockGlyphEl.textContent = glyph;
        // night dims the strip's glyph the same way it dims the world
        clockEl.dataset.night = String(day < 0.05);
    }

    // GPS wayfinding (Wave 9.4): where every OTHER asset is, from the unit
    // you are driving. Two readouts, two conventions, each matching its
    // frame of reference:
    //  - compass ticks ride the rim at the target's ABSOLUTE bearing (the
    //    dial is N-up, so a tick at the top means "north of you")
    //  - the card's arrows point at the bearing RELATIVE to the nose (up =
    //    dead ahead), like the TGT arrow — that's the one you steer by
    // Rows are keyed by target id and REUSED, not rebuilt: replaceChildren
    // at telemetry rate churns the DOM 10x/s for text that mostly doesn't
    // change.
    const gpsDialEl = rootEl.querySelector('#mc-compass-gps');
    const gpsListEl = rootEl.querySelector('#mc-gps-list');
    const gpsRows = new Map();   // id -> { tick, li, arrow, name, dist }
    let gpsOrder = '';           // last rendered id order (re-seat only on change)

    function setGps(tracks) {
        const seen = new Set();
        for (const t of tracks) {
            seen.add(t.id);
            let row = gpsRows.get(t.id);
            if (!row) {
                const tick = document.createElement('span');
                tick.className = 'mars-compass__tick';
                tick.style.color = t.color;
                gpsDialEl.appendChild(tick);

                const li = document.createElement('li');
                const arrow = document.createElement('i');
                arrow.className = 'mars-gps__arrow';
                arrow.textContent = '▲';
                arrow.style.color = t.color;
                const name = document.createElement('b');
                const dist = document.createElement('span');
                li.append(arrow, name, dist);
                gpsListEl.appendChild(li);

                row = { tick, li, arrow, name, dist };
                gpsRows.set(t.id, row);
            }
            row.tick.style.transform =
                `translate(-50%, -50%) rotate(${Math.round(t.bearing)}deg) translateY(-17px)`;
            row.arrow.style.transform = `rotate(${Math.round(t.rel)}deg)`;
            if (row.name.textContent !== t.label) row.name.textContent = t.label;
            row.dist.textContent = t.dist >= 1000
                ? `${(t.dist / 1000).toFixed(2)} km` : `${Math.round(t.dist)} m`;
        }
        // the unit you switch TO drops out of its own target list
        for (const [id, row] of gpsRows) {
            if (seen.has(id)) continue;
            row.tick.remove();
            row.li.remove();
            gpsRows.delete(id);
        }
        // Reused rows keep their old slot, so after a unit switch the card
        // reorders itself (the row that left frees a slot, the row that
        // joined lands last). Re-seat them in track order — but only when
        // the set actually changed, not 10x a second.
        const key = tracks.map((t) => t.id).join('|');
        if (key !== gpsOrder) {
            gpsOrder = key;
            gpsListEl.append(...tracks.map((t) => gpsRows.get(t.id).li));
        }
    }

    // BASES — TRAVEL menu section (Wave 9.3): one row per established base
    // (the FIELD LAB is one, it just wasn't earned), with a live distance
    // from the active unit and a TRAVEL action. Rebuilt on menu open so the
    // distances are current — cheap, and the menu pauses nothing.
    const basesListEl = rootEl.querySelector('#mc-bases-list');
    function setBases(entries) {
        basesListEl.replaceChildren(...entries.map((b) => {
            const row = document.createElement('div');
            row.className = 'mars-menu__base';
            const label = document.createElement('div');
            const name = document.createElement('b');
            name.textContent = `${b.kind === 'hq' ? '★' : '⬢'} ${b.name}`;
            const meta = document.createElement('span');
            meta.textContent = b.dist >= 1000
                ? `${(b.dist / 1000).toFixed(2)} km away`
                : `${Math.round(b.dist)} m away`;
            label.append(name, meta);
            const btn = document.createElement('button');
            btn.className = 'mars-btn mars-menu__travel';
            btn.textContent = 'TRAVEL';
            btn.addEventListener('click', () => {
                setMenuOpen(false);
                onTravel?.(b.id);
            });
            row.append(label, btn);
            return row;
        }));
        if (!entries.length) {
            const p = document.createElement('p');
            p.className = 'mars-menu__lab-empty';
            p.textContent = 'No bases established yet.';
            basesListEl.appendChild(p);
        }
    }

    // speed m/s, heading rad (unit convention: W travels along
    // -[sin h, cos h], so bearing-from-north = -h), elev m, slope deg.
    // tgtRelDeg: steer angle to the target relative to forward travel
    // (0 = dead ahead, +90 = hard right) — rotates the TGT arrow.
    function setTelemetry({ speed, heading, elevation, slopeDeg, x, z, odo, charge, dead, docked, charging, health, repairing, target, tgtRelDeg, rolloverRisk, wind }) {
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
        compassNeedle.style.transform = `translate(-50%, -50%) rotate(${Math.round(bearing)}deg)`;
        tele.elev.textContent = `${elevation.toFixed(1)} m`;
        tele.slope.textContent = `${slopeDeg.toFixed(1)}°`;
        tele.lat.textContent = `${Math.abs(lat).toFixed(5)}° ${lat >= 0 ? 'N' : 'S'}`;
        tele.lon.textContent = `${Math.abs(lon).toFixed(5)}° ${lon >= 0 ? 'E' : 'W'}`;
        tele.odo.textContent = odo >= 1000 ? `${(odo / 1000).toFixed(2)} km` : `${Math.round(odo)} m`;

        // Charging state is spelled out: DOCK (fast, station-powered, works
        // at night) reads differently from the ambient solar trickle, which
        // is the distinction that made "why isn't it charging?" confusing.
        const pct = Math.round(charge);
        tele.batt.textContent = dead && !charging ? `${pct}% ⚠`
            : docked && charging ? `${pct}% ⚡ DOCK`
                : charging ? `${pct}% ☀`
                    : `${pct}%`;
        tele.batt.className = charging && docked ? 'is-charging'
            : charge <= 15 ? 'is-crit' : charge <= 35 ? 'is-low' : '';

        // HULL gauge (rover-only — null hides). Reads DOWN (100 = pristine),
        // so its warning colors invert the ROLL gauge's: low is bad here.
        if (health == null) {
            tele.hull.textContent = '—';
            tele.hull.className = '';
        } else {
            const h = Math.round(health);
            tele.hull.textContent = repairing ? `${h}% 🔧` : h <= 25 ? `${h}% ⚠` : `${h}%`;
            tele.hull.className = repairing ? 'is-charging'
                : health <= 25 ? 'is-crit' : health <= 55 ? 'is-low' : '';
        }

        // ROLL gauge (rover-only — null hides): same graduated color
        // language as BATT, warning readout rather than a banner.
        if (rolloverRisk == null) {
            tele.roll.textContent = '—';
            tele.roll.className = '';
        } else {
            const pct = Math.round(rolloverRisk * 100);
            tele.roll.textContent = pct >= 100 ? '100% ⚠' : `${pct}%`;
            tele.roll.className = rolloverRisk >= 0.75 ? 'is-crit' : rolloverRisk >= 0.4 ? 'is-low' : '';
        }

        // WIND readout + dial needle (Wave 6): real m/s from the wind
        // facade at the active unit's position (storm flow + any nearby
        // dust-devil vortex). CALM below 0.5 m/s — typical Jezero days.
        const windSpd = wind ? Math.hypot(wind.vx, wind.vz) : 0;
        if (windSpd < 0.5) {
            tele.wind.textContent = 'CALM';
            tele.wind.className = '';
            windNeedle.hidden = true;
        } else {
            tele.wind.textContent = `${windSpd.toFixed(1)} m/s`;
            tele.wind.className = windSpd >= 14 ? 'is-crit' : windSpd >= 7 ? 'is-low' : '';
            const windBearing = ((Math.atan2(wind.vx, -wind.vz) * 180 / Math.PI) % 360 + 360) % 360;
            windNeedle.hidden = false;
            // rotate-then-offset rides the arrow around the dial rim on the
            // wind's bearing side (nose needle keeps the center)
            windNeedle.style.transform = `translate(-50%, -50%) rotate(${Math.round(windBearing)}deg) translateY(-13px)`;
        }

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
        setNode, setArchive, setBoundary, setHazard, setObjective, setIntroActive, setTutorialOverview,
        setMissions, setOverlayMode, setTelemetry, setMenuOpen, isMenuOpen, toast, guide, setOutposts,
        setDronePanel, setDroneState, setGear, setBases, setGps, setMarsClock, setNightVision,
        setVanButton, setPhotoButton, setPhotoAlbum,
    };
}
