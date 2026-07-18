/* ============================================================
   main.js — boot, site selection, render loop, unit-focus toggle.
   ============================================================ */

import * as THREE from 'three';
import { SITES, getSiteFromUrl } from './sites.js';
import { loadTerrain } from './terrain.js';
import { createRover } from './rover.js';
import { createDrone } from './drone.js';
import { createHumanoid } from './humanoid.js';
import { createVan } from './van.js';
import { createFog } from './fog.js';
import { createSamples } from './samples.js';
import { createHud } from './hud.js';
import { createJoystick, isTouchDevice } from './touch.js';
import { createCameraRig } from './camera.js';
import { createEnvironment, FOG, FOG_BASE_DENSITY } from './environment.js';
import { createHazardZones } from './hazardZones.js';
import { createWeather } from './weather.js';
import { createDustDevils } from './dustDevils.js';
import { createRocks } from './rocks.js';
import { createEffects } from './effects.js';
import { createWaypoint } from './waypoint.js';
import { createSound } from './sound.js';
import { createLab, createSling } from './lab.js';
import { Save, migrateLegacySaves } from './saves.js';
import { createAnalysis } from './analysis.js';
import { createColliders } from './colliders.js';
import { createLandingIntro } from './intro.js';
import { createMissions } from './missions.js';
import { createOutposts } from './outposts.js';
import { createChargepads } from './chargepad.js';
import { createComms } from './comms.js';
import { createMarsClock } from './mars-clock.js';
import { createLabHologram } from './hologram.js';
import { createPhotos, MIN_ALT as PHOTO_MIN_ALT } from './photos.js';

// Lift-drone logistics interaction envelope (see lab.js):
const SLING_ALT = 8;      // m AGL — hover this low (or sit landed: alt 0
                          // passes the same gate) to hook a container
const SLING_RADIUS = 7;   // m horizontal to the container
const DELIVER_ALT = 16;   // m AGL over the pad — ABOVE cruiseAlt (12), so
                          // arriving at cruise height delivers, no hunt-the-
                          // altitude (the short cable sells the lowering)

// First-visit-only cinematic gate (see intro.js), now PER SITE via
// Save(site.id) 'intro-seen' — each site plays its own landing once. Set
// the moment the sequence STARTS (not when it finishes) so a refresh
// mid-sequence or a skip doesn't re-trigger it; NOT cleared by RESET
// MISSION (reload), only by RESET SITE. Sibling per-site progress keys
// (results, photos, mission-<id>-done) work the same way — see saves.js.

// Night-vision mode (Wave 9.7) — a view preference, persisted like gear and
// the overlay mode. The gain pair is the intensifier's AGC: the CSS chain
// multiplies luminance by --nv-gain, so 10x is what turns a ~12/255 night
// into something you can drive on, and 1.6x is what keeps a daylight frame
// from clipping to white.
const LS_NV_KEY = 'mc-nv';
const NV_GAIN_DARK = 10;
const NV_GAIN_DAY = 1.6;

// Per-site mesh density (sites.js `segments`) by device class — Gale's 1m
// DEM earns 512 desktop quads, Jezero's 20m DEM doesn't. Fallback for
// sites without the field keeps the old shared 256/128.
function qualityFor(site) {
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    return {
        terrainSegments: (coarse ? site.segments?.mobile : site.segments?.desktop)
            ?? (coarse ? 128 : 256),
        // Wave 5 clipmap: quads per side of each detail level (terrain.js).
        clipQuads: coarse ? 64 : 96,
        // terrain.js uses this to pick a site's mobile heightmap variant.
        coarse,
    };
}

/** Tiny gradient sphere (horizon dust -> zenith), same tones as the real
    sky shader in environment.js, baked once through PMREMGenerator into a
    reflection cubemap for scene.environment. Not the literal sky (no sun
    disc / day-night) — just enough so metal panels pick up plausible
    warm/dark reflections instead of reading flat-dark with no envMap. */
function createMarsEnvMap(renderer) {
    const pmrem = new THREE.PMREMGenerator(renderer);
    pmrem.compileEquirectangularShader();

    const geo = new THREE.SphereGeometry(1, 24, 16);
    const mat = new THREE.ShaderMaterial({
        side: THREE.BackSide,
        fog: false,
        vertexShader: /* glsl */ `
            varying vec3 vDir;
            void main() {
                vDir = position;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: /* glsl */ `
            varying vec3 vDir;
            void main() {
                vec3 horizon = vec3(0.85, 0.62, 0.44);
                vec3 zenith  = vec3(0.23, 0.15, 0.12);
                float h = clamp(normalize(vDir).y, 0.0, 1.0);
                gl_FragColor = vec4(mix(horizon, zenith, pow(h, 0.55)), 1.0);
            }
        `,
    });
    const tmpScene = new THREE.Scene();
    tmpScene.add(new THREE.Mesh(geo, mat));

    const rt = pmrem.fromScene(tmpScene, 0.04);
    geo.dispose();
    mat.dispose();
    pmrem.dispose();
    return rt.texture;
}

async function boot() {
    // One-time: fold any pre-hub GLOBAL save into the last-played site's
    // namespace before anything reads per-site state (saves.js).
    migrateLegacySaves();

    // Site Hub (plan 22-B/C). Step 2: an explicit ?hub deep-link shows the
    // globe so it can be verified standalone; step 4 makes the hub the
    // first-ever-boot default and wires the pin fly-in handoff.
    if (new URLSearchParams(window.location.search).has('hub')) {
        const { createHub } = await import('./hub.js');
        const hub = createHub({ onEnter: enterSite });
        window.__hub = hub; // E2E handle (verify skill)
        hub.show();
        return;
    }

    // Straight into the sim — no landing screen. Priority: ?site= deep
    // link, then last-played site, then Jezero. Switching sites lives in
    // the in-game MENU (which navigates with ?site=, feeding this).
    const site = getSiteFromUrl()
        || SITES[localStorage.getItem('mc-site')]
        || SITES.jezero;
    try { localStorage.setItem('mc-site', site.id); } catch { /* private mode */ }
    document.getElementById('game-root').hidden = false;
    await startGame(site);
}

/** Enter a playable site from the hub: remember it as last-played, reveal the
    sim canvas, and boot. The hub disposes ITS WebGL context before calling
    this, so only one context is ever live (main.js's ?hub handoff / step 4
    fly-in both land here). */
function enterSite(site) {
    try { localStorage.setItem('mc-site', site.id); } catch { /* private mode */ }
    document.getElementById('game-root').hidden = false;
    startGame(site);
}

async function startGame(site) {
    const QUALITY = qualityFor(site);
    const canvas = document.getElementById('mc-canvas');
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: QUALITY.terrainSegments > 128 });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    // ACES + tightened exposure so the units' new metalness reads as
    // punchy specular highlights instead of a flat, blown-out sheen.
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;

    const scene = new THREE.Scene();
    scene.background = FOG.color; // only visible beyond the sky dome

    // Far plane must cover the largest site diagonal (Gale is 9km square).
    const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 20000);

    // Sky dome + sun disc + dust haze + unit lighting (see environment.js).
    const env = createEnvironment(scene);

    // Cheap procedural reflection environment: MeshStandardMaterial's
    // metalness (units.js brand finish) reads mostly from scene.environment,
    // not direct light — with none set, metal panels just look flat-dark.
    // A tiny Mars-toned gradient sphere fed through PMREMGenerator gives
    // free ambient occlusion-ish grounding + warm/dusty reflections that
    // match the sky, without a real HDRI asset or extra draw calls.
    scene.environment = createMarsEnvMap(renderer);

    const terrain = await loadTerrain(site, QUALITY);
    scene.add(terrain.mesh);
    const rocks = createRocks(site, terrain, QUALITY);
    scene.add(rocks.mesh);

    // One collision world for every mover: boulders + lab structures +
    // unit-vs-unit (colliders.js). Each unit moves against its own facade
    // (which excludes itself); registration happens right after creation.
    const colliders = createColliders(rocks);
    // Wave 4 hazards: graded soft-terrain zones + the dust-storm timeline
    // (both no-op on sites without a `hazards` field in sites.js).
    const hazardZones = createHazardZones(site);
    const weather = createWeather(site);
    // Wave 6 wind: one facade sums the storm's regional flow (weather.js)
    // and dust-devil vortices (dustDevils.js) — drones read this, ground
    // units don't (1/100 Earth air density: real Mars wind can't push a
    // rover). forUnit-facade idiom, not a module.
    const dustDevils = createDustDevils(site, terrain, env, scene);
    const wind = {
        sample(x, z) {
            const v = dustDevils.sampleWind(x, z);
            return { vx: v.vx + weather.windX, vz: v.vz + weather.windZ };
        },
    };
    const rover = createRover(site, terrain, colliders.forUnit('rover'), { hazards: hazardZones, weather });
    // Two quads, both spawn LANDED beside the rover: a fast recon scout
    // and a slower heavy-lift frame (Ingenuity-class vs cargo-class).
    const recon = createDrone(site, terrain, {
        modelName: 'recon', maxSpeed: 10, climbRate: 3, cruiseAlt: 18, spawnDx: -6, spawnDz: 4,
        obstacles: colliders.forUnit('recon'), bodyRadius: 0.7, wind,
    });
    const lift = createDrone(site, terrain, {
        modelName: 'drone', maxSpeed: 6, climbRate: 2, cruiseAlt: 12, spawnDx: 8, spawnDz: 6,
        canSling: true,
        obstacles: colliders.forUnit('lift'), bodyRadius: 1.2, wind,
    });
    const humanoid = createHumanoid(site, terrain, colliders.forUnit('humanoid'));
    const van = createVan(site, terrain, colliders.forUnit('van'));
    scene.add(rover.mesh, recon.mesh, lift.mesh, humanoid.mesh, van.mesh);
    // Obstacle footprints (radius mirrors each unit's own BODY_RADIUS /
    // bodyRadius); alt() gates unit-vs-unit checks to overlapping bands.
    // Wave 12: while the humanoid rides inside the van its collider is off
    // (otherwise an invisible 0.35m obstacle stands at the mount point).
    let humanoidStowed = false;
    colliders.register('rover', { position: rover.position, radius: 1.4, alt: () => 0 });
    colliders.register('humanoid', { position: humanoid.position, radius: 0.35, alt: () => 0, enabled: () => !humanoidStowed });
    colliders.register('van', { position: van.position, radius: 2.2, alt: () => 0 });
    // Wave 12.14: the van roof is a landable deck that FOLLOWS the van
    // (deck records are mutable — the chargepad re-measure idiom, moved
    // per frame). owner 'van' keeps the van off its own roof; the drones
    // settle on it, so a parked recon rides along and charges when the
    // van deploys. Radius under the real half-width so only genuinely
    // on-roof counts; height re-measured from the GLB at swap.
    const vanDeck = colliders.addDeck(van.position.x, van.position.z, 1.9, van.roofHeight, 1.3, 'van');
    colliders.register('recon', { position: recon.position, radius: 0.7, alt: () => recon.alt });
    colliders.register('lift', { position: lift.position, radius: 1.2, alt: () => lift.alt });

    const samples = createSamples(site, terrain);
    scene.add(samples.group);

    // FIELD LAB base + the sling that feeds it (lab.js): collect leaves a
    // cache container in the field, the lift drone slings it to the pad.
    const lab = createLab(scene, site, terrain, rocks);
    for (const o of lab.obstacles) colliders.addStatic(o.x, o.z, o.r, o.h);
    const sling = createSling(scene, terrain, colliders);
    const deliveredIds = new Set();

    // The lab landing pad is a drivable platform — units climb its skirt
    // instead of clipping through the 0.35m deck (colliders.js decks).
    colliders.addDeck(lab.padPos.x, lab.padPos.z, 5.5, 0.35, 1.0);

    // Wave 9 charging stations (chargepad.js): every base gets a solar pad.
    // The FIELD LAB gets one at boot — it is the origin base, and without it
    // there is nowhere to dock before the first outpost is earned.
    // colliders: pad decks register as drivable platforms, repair bays as
    // static obstacles (they were walk-through ghosts before).
    const chargepads = createChargepads(scene, terrain, rocks, colliders);

    // Wave 9.4 relay network (comms.js): a mast at every base — the in-world
    // answer to "how do the units know where each other are", and what the
    // GPS ticks/card are reading. Same boot-plus-onBuilt lifecycle as pads.
    // Wave 11: masts register as static colliders (a 9m pole blocks).
    const comms = createComms(scene, terrain, rocks, colliders);

    // Wave 11: ONE occupancy test for everything that rises near a base —
    // statics (lab dock, masts, structures) via the colliders facade, plus
    // chargepads, which stay non-blocking for MOVEMENT (units land/drive
    // onto them) but must never be built over: the HQ once rose on the
    // lab's boot pad because no facade could see it.
    // Pad clearance covers the REAL chargepad GLB (10m footprint -> r ~5.3
    // + margin), not the old 3.6m fallback disc — 4.6 let masts and the
    // repair bay overlap the deck rim at every base.
    const blockedAt = (x, z, r) =>
        colliders.forUnit('__site-build').collides(x, z, r)
        || chargepads.list.some((p) => Math.hypot(p.x - x, p.z - z) < r + 6.5);

    chargepads.addPadNear(lab.padPos.x, lab.padPos.z, 16, blockedAt);
    comms.addMastNear(lab.padPos.x, lab.padPos.z, 20, blockedAt);

    // Wave 7 base-building (outposts.js): checkposts rise at flagged
    // sample sites once analyzed; the HQ rises by the lab once every
    // mission is complete. No-ops on sites without outpost/hq fields.
    // Each structure earns a chargepad beside it as it goes up (and at
    // boot, via bootstrap -> construct -> onBuilt).
    const outposts = createOutposts(scene, site, terrain, rocks, colliders, lab.padPos,
        (rec) => {
            // checkpost pad ring 11 (was 9): the GLB pad's real ~5.3m radius
            // + the 3.4m checkpost left a 0.3m gap at 9 — visually fused.
            chargepads.addPadNear(rec.x, rec.z, rec.kind === 'hq' ? 19 : 11, blockedAt);
            comms.addMastNear(rec.x, rec.z, rec.kind === 'hq' ? 24 : 13, blockedAt);
        }, blockedAt);

    // Edge-node analysis queue + persistent science archive (analysis.js):
    // delivered caches auto-process; completion reveals the real finding.
    const analysis = createAnalysis(site, {
        onDone: (rec) => {
            hud.setInventory(samples.inventory, deliveredIds, analysis.analyzedIds);
            hud.setArchive(analysis.archive);
            sound.analysisDone();
            missions.advance('analyze');
            // Wave 7: a flagged sample's first analysis raises its checkpost.
            const post = outposts.buildFor(rec.id);
            if (post) {
                hud.toast(`⬢ ${post.name.toUpperCase()} ESTABLISHED`);
                sound.built();
                hud.setOutposts(outposts.list());
            }
        },
    });

    // Blob shadows, drive dust, wheel tracks (effects.js); beacon column
    // on the current TGT sample (waypoint.js); synthesized audio (sound.js).
    const effects = createEffects(scene, terrain);
    effects.addShadow(rover.mesh, 1.7);
    effects.addShadow(recon.mesh, 0.55, true);
    effects.addShadow(lift.mesh, 1.0, true);
    effects.addShadow(humanoid.mesh, 0.5);
    effects.addShadow(van.mesh, 2.4);
    const waypoint = createWaypoint(scene, terrain);
    const sound = createSound();

    // Wave 9.5: Ariana hologram at the FIELD LAB — an AI-character
    // projection that plays a scripted dialog on first approach. She
    // stands in FRONT of the station dock (its box half-width is ~3.75m;
    // placing her at stationPos itself embedded her inside the building),
    // grounded on the terrain at her own spot.
    const holoSpot = new THREE.Vector3(lab.stationPos.x + 3.2, 0, lab.stationPos.z + 5.6);
    holoSpot.y = terrain.sampleHeight(holoSpot.x, holoSpot.z);
    const hologram = createLabHologram(scene, holoSpot);

    // Wave 12.13: recon survey imaging — named photo targets, captured
    // frames filed in the menu album (photos.js).
    const photos = createPhotos(site);

    // Per-site objective chains (missions.js): the guided tutorial ships
    // as mission 'tutorial' (autostart, first-visit-only via its own
    // mc-mission-tutorial-done flag), re-runnable anytime from the menu
    // MISSIONS section. Action call sites below just announce what
    // happened via missions.advance(id) — broadcast, no-op when nothing
    // is listening. Completion survives RESET MISSION (archive spirit).
    const missions = createMissions(site, {
        // Wave 9.8: the objective banner swapped steps in silently — you had
        // to notice the bottom line had changed to know you'd done anything.
        // Name what just got done, and what's next.
        onStep: ({ done, doneNum, next, nextNum, total, complete, title }) => {
            if (complete) {
                hud.guide(`✓ ${title} — COMPLETE`, `${total}/${total} STEPS`);
            } else {
                hud.guide(`✓ STEP ${doneNum}/${total} — ${done.text}`,
                    `NEXT · ${nextNum}/${total} · ${next.text}`);
            }
            // No cue of its own: every step fires on an action that already
            // has one (collect, sling, deliver, analyze), and a second chime
            // on the same frame just reads as a double-tap.
        },
        onComplete: () => {
            hud.setMissions(missions.menuEntries());
            // Wave 7 capstone: the site's last mission raises the HQ.
            if (missions.allComplete()) {
                const hq = outposts.buildHq();
                if (hq) {
                    hud.toast(`⬢ ${hq.name.toUpperCase()} ESTABLISHED`);
                    sound.built();
                    hud.setOutposts(outposts.list());
                }
            }
        },
    });
    let overviewMissionId = null; // all-steps card, shown once per (re)start
    function startMission(id) {
        if (!missions.start(id)) return;
        overviewMissionId = id;
        hud.setMissions(missions.menuEntries());
    }
    for (const id of missions.autostarts) {
        missions.start(id);
        overviewMissionId = id;
    }

    // Structures earned in past sessions re-derive at boot from the
    // persistent archive + mission flags (no separate save state), which
    // is also what carries them across RESET MISSION's reload.
    outposts.bootstrap(analysis.archive, missions.allComplete());

    // Per-unit sim state: battery (drains with movement, solar-recharges
    // when idle; an empty battery immobilises the unit until it recovers
    // above the restart threshold) and odometer.
    // Drain rates target real endurance. Real cargo/heavy-lift drones
    // hover for ~20-30 min on a charge; the OLD rates burned a full pack
    // in 1-2 min (playtest report). Calibrated so the lift drone hovers
    // (airborne load floor = 0.4, G1 drainScale = 1) at
    // 0.11 * 0.4 = 0.044 %/s -> ~38 min idle hover, ~22-25 min in active
    // flight, less on a laden run — squarely in the real envelope. Drones
    // burn charge the whole time they are AIRBORNE (hover isn't free) and
    // only solar-recharge on the ground — land to charge.
    const units = [
        { name: 'Rover', unit: rover, kind: 'ground', charge: 100, odo: 0, drainRate: 0.05 },
        { name: 'Recon Drone', unit: recon, kind: 'fly', charge: 100, odo: 0, drainRate: 0.10 },
        { name: 'Lift Drone', unit: lift, kind: 'fly', charge: 100, odo: 0, drainRate: 0.11 },
        { name: 'Humanoid', unit: humanoid, kind: 'ground', charge: 100, odo: 0, drainRate: 0.07, stowed: false },
        { name: 'Van', unit: van, kind: 'ground', charge: 100, odo: 0, drainRate: 0.10 },
    ];
    const SOLAR_RATE = 0.25;     // %/s recharge while not driving (~7 min
                                 // full charge in daylight — proportional
                                 // to the slower real-endurance drain)
    // Docked on a chargepad: ~2.5 min to full, and NOT gated by daylight —
    // the station runs off its own battery bank. That gate is the whole
    // point: ambient solar dies with the sun (daylight() is exactly 0 for
    // ~37% of the sol), so before the pads a unit that flattened its
    // battery after dusk was stranded at 0% until sunrise with no way out.
    const DOCK_RATE = 0.7;       // %/s while docked
    const REPAIR_RATE = 1.4;     // %/s hull repair while docked (Wave 9.2)
    // Wave 12.11: the deployed van repairs too — but as a FIELD patch-up
    // (the humanoid crew with hand tools), not a workshop. Slower than a
    // base repair bay, so the bays stay worth the drive home.
    const FIELD_REPAIR_FACTOR = 0.4;
    // Wave 12.16 cargo bay: driven-van cache logistics.
    const VAN_CARGO_CAP = 3;     // caches the bay holds (sling carries 1)
    const VAN_CARGO_R = 6;       // m — roll this close to auto-load
    const VAN_DELIVER_R = 12;    // m from the lab pad center to unload
    const vanCargo = [];         // container objects riding in the bay
    const RESTART_CHARGE = 10;   // empty units stay dead until this
    const NIGHT_DRAIN_K = 0.5;   // cold-night heater tax: +50% drain at full dark
    const STORM_FOG_K = 8;       // FOG.density multiplier span at storm peak
    const ROLLOVER_BATT_PENALTY = 8; // % charge lost when the rover tips (Wave 6)
    let activeIndex = 0;
    let prevRoverCondition = 'ok';   // Wave 6 transition edge detector
    let jumpHeld = false;            // Space edge-detect (no pogo on hold)
    let prevMenuOpen = false;        // menu closed->open edge (BASES refresh)
    // Night vision persists like the other small view prefs (gear, overlay
    // mode, telemetry collapse) — a player who drives at night with it on
    // wants it on next session too.
    let nightVision = localStorage.getItem(LS_NV_KEY) === '1';

    const hudRoot = document.getElementById('mc-hud');
    const hud = createHud(hudRoot, {
        site,
        onSwitchUnit: () => switchUnit(),
        onCollect: () => tryCollect(),
        onPhoto: () => tryPhoto(),
        onToggleSfx: () => sound.toggle(),
        sfxEnabled: sound.enabled,
        onCycleGear: () => units[activeIndex].unit.cycleGear?.() ?? null,
        gear: rover.gearLabel,
        onToggleSol: () => env.toggleSol(),
        solOn: env.cycling,
        onToggleLanding: () => toggleLanding(),
        onCommandAlt: (v) => {
            const active = units[activeIndex];
            if (active.kind === 'fly' && !active.dead) active.unit.commandAlt(v);
        },
        // Full mission reset: all sim state (positions, batteries, samples,
        // lab, fog) lives in-memory, so a reload restores the pristine site.
        // Persistent things survive on purpose: SCIENCE ARCHIVE, gear prefs.
        onReset: () => window.location.reload(),
        onSkipIntro: () => intro?.skip(),
        onSkipMission: () => {
            const cur = missions.currentAny();
            if (cur) missions.skip(cur.missionId);
        },
        onReplayIntro: () => startIntro(),
        onReplayHologram: () => hologram.replay(),
        onStartMission: (id) => startMission(id),
        missions: missions.menuEntries(),
        onSetOverlayMode: (mode) => fog.setOverlayMode(mode),
        onTravel: (id) => travelTo(id),
        onToggleNv: () => setNightVision(!nightVision),
        // Wave 12: V / HUD button — deploy the parked van as a field
        // chargepad, or pack it back up. Only meaningful from the driver's
        // seat; returns the new deploy state (null = ignored) so the HUD
        // button label can track it.
        onVanDeploy: () => {
            const active = units[activeIndex];
            if (active.unit !== van || !van.driver || active.dead) return null;
            const deploying = van.toggleDeploy();
            hud.toast(deploying
                ? '▸ VAN DEPLOYED — FIELD CHARGE PAD ONLINE'
                : '▸ VAN PACKED UP — CHARGE PAD OFFLINE');
            sound.switchUnit();
            return deploying;
        },
    });

    // Night vision (Wave 9.7): main.js owns the state because the filter goes
    // on the CANVAS, which lives outside the HUD root — and that is the point.
    // The optic is intensified; the instruments are not.
    function setNightVision(on) {
        nightVision = on;
        canvas.classList.toggle('is-nv', on);
        hud.setNightVision(on);
        if (on) applyNvGain();
        try { localStorage.setItem(LS_NV_KEY, on ? '1' : '0'); } catch { /* private mode */ }
    }

    /** Automatic gain control, like a real intensifier tube: wide open in the
        dark (where the terrain sits near 12/255 and the mode has to earn its
        keep), stopped down in daylight so leaving NV on at noon gives a bright
        green view instead of a white blowout. The chain itself stays in CSS —
        only the scalar crosses over. */
    function applyNvGain() {
        const gain = NV_GAIN_DARK + (NV_GAIN_DAY - NV_GAIN_DARK) * env.daylight();
        canvas.style.setProperty('--nv-gain', gain.toFixed(2));
    }
    setNightVision(nightVision);
    const fog = createFog(site, hud.minimapEl, terrain);
    hud.setOverlayMode(fog.overlayMode); // reflect the persisted choice

    // Wave 9.6: Mars local time, derived from the sun environment.js already
    // moves (a display, not a second clock — see mars-clock.js).
    const marsClock = createMarsClock(site, env);
    hud.setMarsClock(marsClock.read());

    // PATH overlay breadcrumbs: the active unit's recent track, appended
    // on the telemetry tick below, rendered by fog.js in PATH mode only.
    const pathTrail = [];

    hud.setLab(0, site.samples.length);
    hud.setArchive(analysis.archive); // persisted results from past sessions
    hud.setPhotoAlbum(photos.album);  // persisted survey images (Wave 12.13)
    hud.setOutposts(outposts.list()); // built + still-locked structures
    hud.setBases(baseEntries(rover.position)); // travel list (re-ranged on menu open)

    const touchZones = setupTouchControls();
    const keys = setupKeyboard();
    applyUnitMode();

    /** targetInfo-shaped wrapper for non-sample objectives (cache, lab). */
    function pseudoTarget(id, name, x, z, from) {
        return { sample: { id, name, x, z }, dist: Math.hypot(from.x - x, from.z - z) };
    }

    // Ground every unit once before the first camera snap — constructors
    // leave y=0 and only the first update() drops them onto the terrain
    // (~-2500m at Jezero), which would leave the camera lerping down.
    rover.update(0, { throttle: 0, steer: 0 });
    humanoid.update(0, { throttle: 0, steer: 0 });
    van.update(0, { throttle: 0, steer: 0 });

    // Orbit chase-cam (mouse drag / touch drag to orbit, wheel / pinch to
    // zoom, double-click to recenter); snapped to spawn.
    const camRig = createCameraRig(camera, canvas, terrain);

    // Landing-drop cinematic (intro.js): the base-station container itself
    // cargo-drops onto its real resting spot beside the pad (the real dock
    // is hidden while it plays, so the drop IS the base arriving), camera
    // chasing it via the SAME camRig (any target + snap bool, no second
    // camera code path). Auto-plays first visit only; re-runnable anytime
    // from the menu (▶ LANDING INTRO). Repeat visits and site switches
    // keep the existing "straight into the sim" fast path untouched.
    let intro = null;
    function startIntro() {
        if (intro?.active) return;
        intro?.dispose();
        intro = createLandingIntro(scene, site, lab.stationPos);
        Save(site.id).set('intro-seen', 1);
        // Escape hatch on ANY input — click/tap or any key (there was no
        // keyboard way out, which read as a hang on slow machines).
        canvas.addEventListener('pointerdown', () => intro?.skip(), { once: true });
        window.addEventListener('keydown', () => intro?.skip(), { once: true });
        camRig.setDistance(70); // wide cinematic framing for the 15m container
        const first = intro.update(0);
        camRig.update(first.pos, first.heading, 'fly', true);
    }
    if (!Save(site.id).get('intro-seen')) startIntro();
    if (!intro) camRig.update(rover.position, rover.heading, 'ground', true);

    // Debug/E2E handle (also used by the sampleHeight ground-truth check;
    // renderer/scene/camera exposed so tests on software-GL boxes can pause
    // the loop and capture canvas pixels via a same-task render+toDataURL).
    window.__mc = { site, terrain, rover, drone: recon, recon, lift, humanoid, van, samples, renderer, scene, camera, camRig, units, env, effects, waypoint, sound, rocks, lab, sling, analysis, outposts, fog, colliders, missions, hazardZones, weather, dustDevils, wind, chargepads, comms, baseList, marsClock, setNightVision, get nightVision() { return nightVision; }, get intro() { return intro; }, hologram, photos, tryPhoto, vanCargo };

    function applyUnitMode() {
        const active = units[activeIndex];
        hud.setActiveUnit(active.name);
        hud.setDronePanel(active.kind === 'fly');
        hud.setGear(active.unit.gearLabel ?? null);
        // Wave 12: DEPLOY/PACK UP button rides the gear button's slot —
        // the van has no gears, so the two are never visible together.
        hud.setVanButton(active.unit === van
            ? (van.deployPlanned ? 'packup' : 'deploy') : null);
        touchZones.setMode(active.kind);
    }

    function switchUnit() {
        // Wave 12: switching away mid-core aborts the drill (the humanoid
        // can't keep drilling unattended — standing still is deliberate).
        if (units[activeIndex].unit === humanoid && humanoid.digging) {
            humanoid.cancelDig();
            hud.setHazard(null);
            sound.drill(0);
        }
        // Wave 12: skip stowed units and unselectable units (driverless van)
        const startedAt = activeIndex;
        do {
            activeIndex = (activeIndex + 1) % units.length;
            const u = units[activeIndex];
            const unselectable = u.stowed || (u.unit === van && !van.driver);
            if (!unselectable) break;
        } while (activeIndex !== startedAt);
        applyUnitMode();
        sound.switchUnit();
        if (units[activeIndex].unit === lift) missions.advance('switch');
        if (units[activeIndex].unit === recon) missions.advance('switch-recon');
    }

    function toggleLanding() {
        const active = units[activeIndex];
        if (active.kind !== 'fly' || active.dead) return;
        active.unit.toggleLanding();
        sound.switchUnit();
    }

    // ---- Wave 9.3: established bases + travel ----------------------------
    // The FIELD LAB is a base too — it just arrived by cargo drop instead of
    // being earned — so it heads the list and is the one destination that
    // always exists.
    function baseList() {
        return [
            { id: 'lab', name: 'Field Lab', kind: 'lab', x: lab.padPos.x, z: lab.padPos.z },
            ...outposts.builtList(),
        ];
    }

    /** Menu feed: bases + live range from the unit currently being driven. */
    function baseEntries(from) {
        return baseList().map((b) => ({
            ...b, dist: Math.hypot(b.x - from.x, b.z - from.z),
        }));
    }

    /** TRAVEL: put the active unit down on the base's chargepad rather than
        on the structure itself — arriving docked (charging, and repairing if
        it's the rover) is the whole reward for having built the place. */
    function travelTo(id) {
        const base = baseList().find((b) => b.id === id);
        if (!base) return;
        const pad = chargepads.nearestTo(base.x, base.z);
        const tx = pad ? pad.x : base.x;
        const tz = pad ? pad.z : base.z;
        const active = units[activeIndex];
        active.unit.teleport(tx, tz);
        fog.reveal(tx, tz);
        camRig.update(active.unit.position, active.unit.heading, active.kind, true); // snap, no fly-through
        hud.toast(`▸ ARRIVED — ${base.name.toUpperCase()}`);
        sound.switchUnit();
    }

    // Wave 12.13: recon survey imaging — P / HUD PHOTO button. A capture
    // is a real frame grab (photos.js); only the FIRST capture of a spot
    // per session advances the photo mission's counter.
    function tryPhoto() {
        const active = units[activeIndex];
        if (active.unit !== recon || active.dead) return;
        if (recon.landed || recon.alt < PHOTO_MIN_ALT) {
            hud.toast(`▸ AERIAL IMAGING ONLY — CLIMB ABOVE ${PHOTO_MIN_ALT}M`);
            return;
        }
        const spot = photos.inRange(recon.position);
        if (!spot) {
            hud.toast('▸ NO SURVEY TARGET IN RANGE');
            return;
        }
        const { first } = photos.capture(renderer, scene, camera, spot, marsClock.read());
        sound.shutter();
        hud.setPhotoAlbum(photos.album);
        hud.toast(`▸ IMAGE CAPTURED: ${spot.name.toUpperCase()} (${photos.capturedCount}/${photos.total})`);
        if (first) missions.advance('photo:' + spot.id);
    }

    function tryCollect() {
        const active = units[activeIndex];
        // Wave 12: van mount/dismount. The plan's contract: mounting makes
        // the VAN the active unit (the humanoid is stowed — hidden, collider
        // off, sim skipped), dismounting hands control straight back.
        if (active.unit === humanoid && !humanoid.digging) {
            const vDist = Math.hypot(van.position.x - humanoid.position.x,
                van.position.z - humanoid.position.z);
            if (vDist <= van.mountRadius && !van.driver) {
                humanoid.mesh.visible = false;
                active.stowed = true;
                humanoidStowed = true;
                van.setDriver(humanoid);
                activeIndex = units.findIndex((u) => u.unit === van);
                applyUnitMode();
                sound.switchUnit();
                hud.toast('▸ BOARDED THE VAN');
                return;
            }
        }
        if (active.unit === van && van.driver) {
            // Dismount: put the humanoid down beside the van on the first
            // clear bearing (never inside a boulder or another unit).
            const hu = units.find(u => u.unit === humanoid);
            if (hu) {
                const huCollider = colliders.forUnit('humanoid');
                let dx = van.position.x + Math.sin(van.heading + 1.0) * 5;
                let dz = van.position.z + Math.cos(van.heading + 1.0) * 5;
                for (const a of [1.0, -1.0, 2.2, -2.2, Math.PI]) {
                    const tx = van.position.x + Math.sin(van.heading + a) * 5;
                    const tz = van.position.z + Math.cos(van.heading + a) * 5;
                    if (!huCollider.collides(tx, tz, 0.35)) { dx = tx; dz = tz; break; }
                }
                hu.stowed = false;
                humanoidStowed = false;
                humanoid.mesh.visible = true;
                humanoid.teleport(dx, dz);
                van.setDriver(null);
                activeIndex = units.findIndex((u) => u.unit === humanoid);
                applyUnitMode();
                sound.switchUnit();
                hud.toast('▸ DISMOUNTED');
            }
            return;
        }
        if (active.kind === 'ground') {
            // The van has no collection arm — its verbs are drive/deploy.
            if (active.unit === van) return;
            const sample = samples.nearestUncollected(active.unit.position);
            if (!sample) return;
            // Wave 12: humanoid drills outpost-flagged samples (timed core).
            // Wave 12.15: surveyed buried cores also require that drill;
            // the rover's arm cannot extract a subsurface sample.
            if (sample.buried && active.unit !== humanoid) {
                hud.toast('▸ SUBSURFACE CORE — HUMANOID DRILL REQUIRED');
                return;
            }
            if (active.unit === humanoid && (sample.outpost || sample.buried)) {
                humanoid.startDig(sample);
                return;
            }
            samples.collect(sample);
            hud.setInventory(samples.inventory, deliveredIds, analysis.analyzedIds);
            sound.collect();
            missions.advance('collect');
            return;
        }
        // Lift drone: the same E action hooks, releases and delivers.
        const unit = active.unit;
        if (!unit.canSling || active.dead) return;
        if (sling.carrying) {
            if (lab.isOverPad(unit.position) && unit.alt <= DELIVER_ALT) {
                const c = sling.detach();
                unit.setSlung(false);
                lab.deliver(c);
                deliveredIds.add(c.id);
                analysis.enqueue(c); // edge node picks it up FIFO
                hud.setLab(lab.delivered.length, site.samples.length);
                hud.setInventory(samples.inventory, deliveredIds, analysis.analyzedIds);
                sound.deliver();
                missions.advance('deliver');
            } else {
                // field release: set the container back down where it hangs
                const c = sling.detach();
                unit.setSlung(false);
                c.state = 'field';
                c.mesh.position.y = terrain.sampleHeight(c.mesh.position.x, c.mesh.position.z)
                    + colliders.deckHeight(c.mesh.position.x, c.mesh.position.z) + 0.28;
                c.mesh.rotation.set(0, c.mesh.rotation.y, 0);
                sound.sling();
            }
            return;
        }
        // Hook while hovering low OR while parked next to the cache
        // (landed alt is 0, so one gate covers both) — the load simply
        // lifts off the ground with the drone on take-off.
        if (unit.alt <= SLING_ALT) {
            const c = samples.nearestContainer(unit.position, SLING_RADIUS);
            if (c) {
                sling.attach(c);
                unit.setSlung(true);
                sound.sling();
                missions.advance('sling');
            }
        }
    }

    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });

    const timer = new THREE.Timer(); // Clock is deprecated in three 0.185+
    const prevPos = new THREE.Vector3().copy(rover.position);
    let teleAccum = 0;
    renderer.setAnimationLoop(() => {
        timer.update();
        const dt = Math.min(timer.getDelta(), 0.1);

        // Landing-drop cinematic: while active, this is the ENTIRE frame —
        // no unit sim, no input, just the descent + camera chase. Player
        // input (click/tap) skips early via hud's SKIP INTRO affordance
        // (onSkipIntro above) or the canvas listener below.
        if (intro) {
            if (intro.active) {
                hud.setIntroActive(true);
                // Re-hidden every frame (not once) so the station GLB's own
                // async fallback-reveal in models.js can't win the race and
                // show the real dock mid-drop.
                lab.stationGroup.visible = false;
                const { pos, heading } = intro.update(dt);
                terrain.update(pos.x, pos.z); // clipmap detail under the descent
                camRig.update(pos, heading, 'fly');
                env.update(camera, dt);
                renderer.render(scene, camera);
                if (!intro.active) { intro.dispose(); lab.stationGroup.visible = true; hud.setIntroActive(false); camRig.setDistance(12); intro = null; }
                return;
            }
            // Finished/skipped on a prior frame via the HUD button/canvas
            // tap (not this loop's own update()) — clean up once so the
            // ghost mesh/banner don't linger.
            intro.dispose();
            lab.stationGroup.visible = true;
            hud.setIntroActive(false);
            camRig.setDistance(12);
            intro = null;
        }

        const active = units[activeIndex];

        // Wave 5: recenter the terrain clipmap's detail rings on the active
        // unit (level-0 snap keeps its lattice on the CPU sampler's grid).
        terrain.update(active.unit.position.x, active.unit.position.z);

        // Per-kind input. Drones use RC Mode 2 on touch (left stick =
        // throttle/yaw, right stick = pitch/roll) and WASD+QERF on keys.
        let input, inputMag;
        if (active.kind === 'ground') {
            const mv = readMoveInput(keys, touchZones.move);
            // Space jumps — humanoid only (the rover has no legs). Consumed as
            // an edge, so holding Space does not pogo.
            const jump = active.unit === humanoid && keys.has('Space') && !jumpHeld;
            jumpHeld = keys.has('Space');
            input = { throttle: mv.y, steer: -mv.x, jump };
            inputMag = Math.min(1, Math.abs(mv.x) + Math.abs(mv.y));
        } else {
            input = readDroneInput(keys, touchZones.move, touchZones.look);
            inputMag = Math.min(1, Math.abs(input.forward) + Math.abs(input.strafe)
                + Math.abs(input.climb) + Math.abs(input.turn) * 0.3);
        }

        // Battery: the active unit drains with input; AIRBORNE drones
        // drain constantly (hover isn't free) and cannot solar-recharge
        // until they land. Recharge is gated by daylight.
        // Dead-flag for EVERY unit, not just the active one — an idle
        // airborne drone that drains to 0% must force-land immediately,
        // not keep hovering until the player next switches to it.
        for (const u of units) {
            u.dead = u.dead ? u.charge < RESTART_CHARGE : u.charge <= 0;
        }
        if (active.dead) input = active.kind === 'ground'
            ? { throttle: 0, steer: 0 }
            : { forward: 0, strafe: 0, turn: 0, climb: 0 };
        // Wave 4 hazards: dust storms dim the panels (weather.js), and the
        // Martian night is COLD — heaters eat into every load (up to
        // +NIGHT_DRAIN_K x at full dark, scaled by the same daylight()
        // that already gates solar recharge).
        weather.update(dt);
        const solarNow = SOLAR_RATE * env.daylight() * (1 - 0.8 * weather.intensity);
        const coldDrain = 1 + (1 - env.daylight()) * NIGHT_DRAIN_K;
        const livePads = new Set();  // pads charging something (ring pulses green)
        for (const u of units) {
            if (u.kind === 'fly') u.unit.setPower(!u.dead); // dead => force-land
            const airborne = u.kind === 'fly' && !u.unit.landed;
            const activeLoad = u === active && !active.dead && inputMag > 0.02 ? inputMag : 0;
            const load = airborne ? Math.max(0.4, activeLoad) : activeLoad;
            // Docking needs the unit settled ON the pad — a drone hovering
            // over one is still burning its rotors, so it must be landed.
            // Wave 12: a deployed van is a pad too, and the stowed humanoid
            // charges off the van's cabin dock while riding along. basePad
            // vs vanPad stay distinct: charging is equal, repair is not.
            const basePad = airborne ? null : chargepads.padAt(u.unit.position);
            const vanPad = !basePad && !airborne && van.deployed && van.padPos
                && Math.hypot(van.position.x - u.unit.position.x,
                    van.position.z - u.unit.position.z) <= van.dockRadius
                ? van.padPos : null;
            const pad = (u.unit === humanoid && humanoidStowed)
                ? { x: van.position.x, z: van.position.z }
                : (basePad || vanPad);
            u.docked = !!pad;
            const rate = pad ? DOCK_RATE : solarNow;
            u.charge = load > 0
                ? Math.max(0, u.charge - u.drainRate * load * (u.unit.drainScale ?? 1) * coldDrain * dt)
                : Math.min(100, u.charge + rate * dt);
            u.charging = load <= 0 && rate > 0 && u.charge < 100;
            if (pad && u.charging) livePads.add(pad);

            // Repair: a base pad's workshop bay puts hull condition back at
            // full rate; the deployed van field-repairs at FIELD_REPAIR_FACTOR
            // (Wave 12.11) — a roadside patch-up, not a bay. Park to fix.
            if (pad && u.unit.repair && u.unit.health < 100) {
                u.unit.repair(REPAIR_RATE * (basePad ? 1 : FIELD_REPAIR_FACTOR) * dt);
                livePads.add(pad);
            }

            // Wave 9 gravity: a drone whose battery died mid-air FALLS. Crunch
            // on touchdown, scaled by how far it had to come.
            const impact = u.unit.popImpact?.() ?? 0;
            if (impact > 4) sound.dead();
        }
        chargepads.update(dt, livePads);

        // battery audio cues on downward transitions of the active unit
        if (active.charge <= 15 && !active.lowWarned) { active.lowWarned = true; sound.lowBattery(); }
        else if (active.charge > 35) active.lowWarned = false;
        if (active.dead && !active.deadWarned) { active.deadWarned = true; sound.dead(); }
        else if (!active.dead) active.deadWarned = false;

        const beforeMove = active.unit.position.clone();
        // Keep the previous deck centre so any landed drone that was
        // genuinely parked on the roof can ride with the van this frame.
        // (The owner exclusion in colliders.js prevents the van itself
        // from treating that same deck as ground.)
        const prevVanDeckX = vanDeck.x;
        const prevVanDeckZ = vanDeck.z;
        active.unit.update(dt, input);
        // Wave 12: the idle van also keeps simulating — it grounds itself
        // on the terrain at boot and its deploy animation finishes even if
        // the player switches away mid-fold. This must run before the idle
        // drones: a drone parked on the roof needs the deck at the van's
        // *new* position when it picks its ground height this frame.
        if (active.unit !== van) van.update(dt, { throttle: 0, steer: 0 });
        // Wave 12.14: the roof deck rides with the van. Keep it in sync
        // before drone updates so a landed drone moves with an active van
        // instead of spending a frame grounded at the old coordinates.
        vanDeck.x = van.position.x;
        vanDeck.z = van.position.z;
        vanDeck.h = van.roofHeight;
        const deckDx = vanDeck.x - prevVanDeckX;
        const deckDz = vanDeck.z - prevVanDeckZ;
        if (deckDx || deckDz) {
            for (const u of units) {
                // A flying drone cannot be a roof passenger. A landed one
                // inside the old solid deck radius is moved before its own
                // ground clamp, which then re-seats it on the moved roof.
                if (u.kind !== 'fly' || !u.unit.landed
                    || Math.hypot(u.unit.position.x - prevVanDeckX,
                        u.unit.position.z - prevVanDeckZ) > vanDeck.r) continue;
                u.unit.teleport(u.unit.position.x + deckDx, u.unit.position.z + deckDz);
            }
        }
        // idle drones keep simulating: hover physics settles, auto-land
        // sequences (incl. dead-battery force-landing) complete
        for (const u of units) {
            if (u.kind === 'fly' && u !== active) {
                u.unit.update(dt, { forward: 0, strafe: 0, turn: 0, climb: 0 });
            }
        }

        // Wave 12.16: cargo bay — the DRIVEN van auto-loads any field cache
        // it rolls up to (the humanoid crew does the loading; a driverless
        // van loads nothing) and bulk-delivers when it pulls up at the
        // FIELD LAB pad. Slow, ground-bound, but carries three — the bulk
        // alternative to the sling drone's fast single hook.
        if (van.driver && vanCargo.length < VAN_CARGO_CAP) {
            const c = samples.nearestContainer(van.position, VAN_CARGO_R);
            if (c) {
                c.state = 'cargo';
                c.mesh.visible = false;   // stowed in the bay
                vanCargo.push(c);
                sound.sling();
                hud.toast(`▸ CACHE LOADED: ${c.name.toUpperCase()} (CARGO ${vanCargo.length}/${VAN_CARGO_CAP})`);
            }
        }
        if (van.driver && vanCargo.length
            && Math.hypot(van.position.x - lab.padPos.x, van.position.z - lab.padPos.z) <= VAN_DELIVER_R) {
            while (vanCargo.length) {
                const c = vanCargo.shift();
                c.mesh.visible = true;    // lab.deliver parks it on the pad
                lab.deliver(c);
                deliveredIds.add(c.id);
                analysis.enqueue(c);      // edge node picks it up FIFO
                missions.advance('deliver');
            }
            hud.setLab(lab.delivered.length, site.samples.length);
            hud.setInventory(samples.inventory, deliveredIds, analysis.analyzedIds);
            sound.deliver();
            hud.toast('▸ CARGO DELIVERED TO THE FIELD LAB');
        }
        const movedDist = Math.hypot(
            active.unit.position.x - beforeMove.x,
            active.unit.position.z - beforeMove.z
        );
        active.odo += movedDist;
        const speedNow = dt > 0 ? movedDist / dt : 0;

        fog.reveal(recon.position.x, recon.position.z);
        dustDevils.scout(recon.position.x, recon.position.z, marsClock.read().sol);
        fog.reveal(lift.position.x, lift.position.z);
        if (active.kind === 'ground') fog.reveal(active.unit.position.x, active.unit.position.z);

        // Wave 9.5: recon scan mission progress — the fraction of the
        // survey zone that has been fog-revealed by the recon drone.
        // Gate on the survey chain being ACTIVE, not on it being the first
        // active chain (currentAny returned the tutorial while both ran,
        // silently freezing scan progress until the tutorial was done).
        const surveyOn = site.surveyZones?.length && missions.activeMissions.includes('survey');
        let zonesScanned = 0;
        if (surveyOn) {
            // Wave 12.12: forward-base step — the van deployed >600m from
            // every base pad counts as an established forward base. Per-frame
            // broadcast like the archive gate (no-op unless the step waits).
            if (van.deployed && van.padPos) {
                const nb = chargepads.nearestTo(van.padPos.x, van.padPos.z);
                const nd = nb ? Math.hypot(nb.x - van.padPos.x, nb.z - van.padPos.z) : Infinity;
                if (nd > 600) missions.advance('forward-base');
            }
            for (const sz of site.surveyZones) {
                if (fog.revealedFraction(sz.x, sz.z, sz.radius) >= 0.65) zonesScanned++;
            }
            missions.advance('scan-zone', zonesScanned);
        }
        // Wave 12.15: surveying can localize a subsurface core without
        // materializing a visible sample marker. The target arrow takes
        // the player to the mapped coordinates; only the humanoid drill
        // ever extracts the core. Deliberately OUTSIDE the surveyOn gate:
        // fog coverage is session-only but mission completion persists, so
        // a player who finished the survey last session must still be able
        // to localize the core by overflying the zone again.
        if (site.surveyZones?.length) {
            for (const s of samples.revealBuried(site.surveyZones,
                (sz) => fog.revealedFraction(sz.x, sz.z, sz.radius))) {
                hud.toast(`▸ SUBSURFACE ANOMALY LOCATED — ${s.name.toUpperCase()}`);
            }
        }
        // Wave 12.13: photo mission active — drives TGT, minimap glyphs and
        // the (n/total) tally below.
        const photoOn = site.photoSpots?.length && missions.activeMissions.includes('photo');
        // 'return-base' ends BOTH recon chains (survey + photo), so it fires
        // outside their gates — advance() is a no-op unless a chain waits.
        // "Base" includes the deployed van — it IS the base out there.
        const atVanDock = van.deployed && van.padPos
            && Math.hypot(van.position.x - recon.position.x,
                van.position.z - recon.position.z) <= van.dockRadius;
        if (recon.landed && (chargepads.padAt(recon.position) || atVanDock)) {
            missions.advance('return-base');
        }

        // TGT: ground units chase uncollected samples; the lift drone's
        // objective is logistics — nearest field cache, or the LAB when loaded.
        let targetInfo = samples.nearestInfo(active.unit.position);
        if (active.unit.canSling) {
            if (sling.carrying) {
                targetInfo = pseudoTarget('lab', 'FIELD LAB', lab.padPos.x, lab.padPos.z, active.unit.position);
            } else {
                const c = samples.nearestContainer(active.unit.position, Infinity);
                if (c) targetInfo = pseudoTarget(`${c.id}-cache`, `${c.name} CACHE`, c.mesh.position.x, c.mesh.position.z, active.unit.position);
            }
        } else if (active.unit === recon && photoOn) {
            // Wave 12.13: on the imaging sortie the recon's TGT chases the
            // nearest unimaged photo target, not samples it can't collect.
            const ps = photos.nearestPending(recon.position);
            if (ps) targetInfo = pseudoTarget(`photo-${ps.id}`, `${ps.name} [PHOTO]`, ps.x, ps.z, recon.position);
        }

        // minimap: unit dots (active gets a heading tick), lab square, TGT
        // ring (a cache target rings its source sample's marker). Stowed
        // units ride inside another — no dot of their own.
        fog.render(samples.markers, units.filter((u) => !u.stowed).map((u) => ({
            x: u.unit.position.x, z: u.unit.position.z,
            heading: u.unit.heading, active: u === active,
        })), {
            lab: { x: lab.padPos.x, z: lab.padPos.z },
            targetId: targetInfo ? targetInfo.sample.id.replace('-cache', '') : null,
            caches: samples.containers
                .filter((c) => c.state === 'field')
                .map((c) => ({ x: c.mesh.position.x, z: c.mesh.position.z })),
            outposts: outposts.builtPositions(),
            path: pathTrail,
            devils: dustDevils.getScoutedDevils(marsClock.read().sol),
            // Wave 11: static soft-sand zones — visible on the map so
            // "BOGGED DOWN" never feels random.
            sand: hazardZones.zones,
            // Wave 9.5: survey zone ring (visible while survey mission active)
            surveyZones: surveyOn ? site.surveyZones : null,
            // Wave 9.5: repair bays alongside every chargepad
            repairShops: chargepads.repairPositions,
            // Wave 12.13: photo targets (camera glyphs, dim once imaged)
            photoSpots: photoOn ? photos.spots : null,
        });
        waypoint.update(dt, targetInfo);
        sling.update(dt, lift.position);
        lab.update(dt, camera);
        outposts.update(dt, camera);   // camera: name plates scale with range
        comms.update(dt);
        analysis.update(dt);
        dustDevils.update(dt);
        // Wave 9.5: Ariana hologram dialog tick — proximity-triggered,
        // auto-advances through the script lines at ~3.5s intervals.
        hologram.update(dt, active.unit.position,
            (text) => hud.setObjective(`▸ ${text}`),
            () => hud.setObjective(null));
        // Wave 9.5: humanoid EVA tether — anchor is the nearest chargepad
        // or the rover, whichever is closer and within TETHER_LENGTH (80m).
        // If no anchor found within range, the tether is detached.
        const hu = humanoid;
        const hp = hu.position;
        if (humanoidStowed) {
            // Riding in the van: no EVA, no tether.
            hu.setTether(null);
            effects.updateTether(null, null);
        } else {
            let tetherAnchor = null;
            // Check rover first (both move, so the rover is the more dynamic anchor)
            const roverDist = rover.position.distanceTo(hp);
            if (roverDist <= 80) tetherAnchor = rover.position;
            // Then check nearest chargepad (static anchor — fallback)
            const nearestPad = chargepads.nearestTo(hp.x, hp.z);
            if (nearestPad) {
                const padDist = Math.hypot(nearestPad.x - hp.x, nearestPad.z - hp.z);
                if (!tetherAnchor || padDist < roverDist) {
                    if (padDist <= 80) tetherAnchor = new THREE.Vector3(
                        nearestPad.x,
                        terrain.sampleHeight(nearestPad.x, nearestPad.z)
                            + colliders.deckHeight(nearestPad.x, nearestPad.z),
                        nearestPad.z);
                }
            }
            // Wave 12: deployed van is a mobile tether anchor
            if (van.deployed && van.padPos) {
                const vanDist = Math.hypot(van.position.x - hp.x, van.position.z - hp.z);
                if (vanDist <= 80 && (!tetherAnchor || vanDist < roverDist
                    && (!nearestPad || vanDist < Math.hypot(nearestPad.x - hp.x, nearestPad.z - hp.z)))) {
                    tetherAnchor = van.position.clone();
                }
            }
            hu.setTether(tetherAnchor);
            if (tetherAnchor && active.unit === hu) {
                effects.updateTether(hu.tetherPoint, tetherAnchor, hu.tetherTaut);
            } else {
                effects.updateTether(null, null);
            }
        }

        effects.update(dt, active, speedNow, env.daylight());
        // Wave 12.17: survey-camera cone under the recon while it's the
        // driven unit and airborne — the imaging footprint made visible.
        effects.updateSensorCone(
            recon.position,
            terrain.sampleHeight(recon.position.x, recon.position.z)
                + colliders.deckHeight(recon.position.x, recon.position.z),
            recon.alt,
            active.unit === recon && !recon.landed
        );
        const engineNorm = active.kind === 'fly'
            ? (active.unit.landed ? 0 : Math.max(0.35, speedNow / active.unit.maxSpeed))
            : speedNow / (active.name === 'Humanoid' ? 1.4
                : Math.max(0.042, active.unit.maxSpeed ?? rover.maxSpeed));
        const windHere = wind.sample(active.unit.position.x, active.unit.position.z);
        sound.update(active.name, Math.min(1, engineNorm),
            Math.hypot(windHere.vx, windHere.vz) / 20); // /WIND_PEAK — 1.0 at storm max

        // Wave 12 digging: humanoid cores outpost-flagged samples.
        if (active.unit === humanoid && humanoid.digging) {
            const dp = humanoid.digProgress();
            const pct = Math.round(dp * 100);
            hud.setHazard({ type: 'dig', pct });
            sound.drill(dp);
            const ds = humanoid.digTarget;
            // 1 particle/frame — same budget the rover's wheel dust runs at.
            if (ds) effects.spawnDust(ds.x,
                terrain.sampleHeight(ds.x, ds.z) + 0.3, ds.z, 1);
        } else if (active.unit === humanoid) {
            sound.drill(0);
        }
        if (humanoid.digComplete) {
            const ds = humanoid.digTarget;
            if (ds) {
                samples.collect(ds);
                hud.setInventory(samples.inventory, deliveredIds, analysis.analyzedIds);
                sound.collect();
                missions.advance('collect');
            }
            humanoid.cancelDig();
            hud.setHazard(null);
            sound.drill(0);
        }

        // Edge-of-DEM warning while the active unit pushes the boundary.
        hud.setBoundary(!!active.unit.atBoundary);

        // Wave 6: proximity assist for a downed rover — any OTHER working
        // unit inside assistRange auto-helps (no key: E is drone strafe,
        // and this also just works on touch). Battery penalty lands once
        // on the ok->rolled transition.
        const roverEntry = units.find((u) => u.unit === rover);
        if (rover.condition !== 'ok') {
            const near = units.some((u) => u.unit !== rover && !u.dead
                && Math.hypot(u.unit.position.x - rover.position.x,
                    u.unit.position.z - rover.position.z) <= rover.assistRange);
            rover.setAssist(near);
        }
        if (rover.condition === 'rolled' && prevRoverCondition === 'ok') {
            roverEntry.charge = Math.max(0, roverEntry.charge - ROLLOVER_BATT_PENALTY);
            sound.rollover();
        } else if (rover.condition === 'bogged' && prevRoverCondition === 'ok') {
            sound.bogged();
        } else if (rover.condition === 'ok' && prevRoverCondition !== 'ok') {
            sound.recovered();
        }
        prevRoverCondition = rover.condition;

        // Hazard banner: a downed rover outranks everything (with live
        // recovery %); a nearby downed rover prompts other units to hold
        // position and assist; then the soft-terrain zone the active unit
        // is in (rover-only getter), else the site-wide dust storm once
        // it's thick enough to matter. One slot.
        const recPct = Math.round(rover.recoveryMeter * 100);
        if (humanoid.digging) {
            // hazard banner owned by the dig block above — don't overwrite
        } else if (active.unit === rover && rover.condition === 'rolled') {
            hud.setHazard({ type: 'rollover', pct: recPct });
        } else if (active.unit === rover && rover.condition === 'bogged') {
            hud.setHazard({ type: 'bogged', pct: recPct });
        } else if (active.unit !== rover && rover.condition !== 'ok') {
            hud.setHazard({ type: 'rover-down', pct: recPct });
        } else if (active.unit === rover && rover.bogMeter > 0.3) {
            hud.setHazard({ type: 'sinking' });
        } else if (active.unit === humanoid && humanoid.tetherTaut) {
            hud.setHazard({ type: 'tether-taut' });
        } else {
            hud.setHazard(active.unit.inHazard
                ?? (weather.intensity > 0.15 ? { type: 'dust-storm' } : null));
        }

        // Dust storm haze: FOG.color is synced by env.update, but density
        // is copied by VALUE into both scene.fog (environment.js re-syncs
        // it) and the terrain shader's uniform — that one is synced here.
        FOG.density = FOG_BASE_DENSITY * (1 + weather.intensity * STORM_FOG_K);
        terrain.uniforms.uFogDensity.value = FOG.density;

        // Mission banner + its one non-action-callback gate (opening the
        // menu to read the SCIENCE ARCHIVE has no discrete main.js call
        // site to hook, unlike the other action steps — announced once per
        // frame; advance() is a no-op unless a chain is waiting on it).
        // All-steps overview card, once per mission (re)start — deferred to
        // the first NON-intro frame so it never fights the landing drop.
        if (overviewMissionId) {
            hud.setTutorialOverview(missions.stepTexts(overviewMissionId), missions.titleOf(overviewMissionId));
            overviewMissionId = null;
        }
        // BASES list is rebuilt on the closed->open EDGE, not per frame: a
        // per-frame replaceChildren swaps the button out between mousedown
        // and mouseup and the TRAVEL click never fires.
        const menuOpen = hud.isMenuOpen();
        if (menuOpen && !prevMenuOpen) hud.setBases(baseEntries(active.unit.position));
        prevMenuOpen = menuOpen;
        if (menuOpen) missions.advance('archive');
        // Wave 9.5: the Ariana hologram dialog preempts the mission
        // objective banner while active (it uses the same display slot).
        // While it IS active, leave the slot alone — hologram.update wrote
        // the dialog line, and a per-frame setObjective(null) here erased
        // every line the instant it appeared (dialog never displayed).
        if (!hologram.active) {
            const objective = missions.currentAny();
            // Wave 12: the multi-zone scan step gets a live x/y tally —
            // "SCAN ALL SCOUT ZONES" alone reads as one zone forever.
            const tally = objective?.step.id === 'scan-zone' && surveyOn
                ? ` (${zonesScanned}/${site.surveyZones.length})`
                : objective?.step.id === 'photo-count' && photoOn
                    ? ` (${photos.capturedCount}/${photos.total})` : '';
            hud.setObjective(objective
                ? `${objective.stepNum}/${objective.total} · ${objective.step.text}${tally}`
                : null);
        }

        if (active.kind === 'ground') {
            const nearest = samples.nearestUncollected(active.unit.position);
            // Wave 12: the prompt mirrors what E will actually DO (tryCollect
            // priority order): board > dismount > drill/collect.
            if (active.unit === van) {
                hud.setPrompt(van.driver ? 'LEAVE THE VAN' : null);
            } else if (active.unit === humanoid && humanoid.digging) {
                hud.setPrompt(null); // banner owns the feedback mid-core
            } else if (active.unit === humanoid && !van.driver
                && Math.hypot(van.position.x - humanoid.position.x,
                    van.position.z - humanoid.position.z) <= van.mountRadius) {
                hud.setPrompt('BOARD THE VAN');
            } else if (nearest && active.unit === humanoid && (nearest.outpost || nearest.buried)) {
                hud.setPrompt(`DRILL CORE: ${nearest.name}`);
            } else {
                hud.setPrompt(nearest ? `COLLECT: ${nearest.name}` : null);
            }
            // Piggyback on the same "close enough to collect" condition
            // that drives the COLLECT prompt above — no new distance
            // constant for the tutorial's first step.
            if (nearest) missions.advance('drive');
        } else if (active.unit.canSling && !active.dead) {
            if (sling.carrying) {
                hud.setPrompt(lab.isOverPad(active.unit.position) && active.unit.alt <= DELIVER_ALT
                    ? 'DELIVER TO LAB'
                    : 'RELEASE LOAD');
            } else {
                const c = active.unit.alt <= SLING_ALT
                    ? samples.nearestContainer(active.unit.position, SLING_RADIUS)
                    : null;
                hud.setPrompt(c ? `SLING: ${c.name} CACHE` : null);
            }
        } else {
            hud.setPrompt(null);
        }

        // Wave 12.13: PHOTO button (dronectl cluster) rides with the recon —
        // labeled with the in-range target when a capture would succeed.
        let photoLabel = null;
        if (active.unit === recon && !active.dead) {
            const ps = !recon.landed && recon.alt >= PHOTO_MIN_ALT
                ? photos.inRange(recon.position) : null;
            photoLabel = ps ? `PHOTO ▸ ${ps.name}` : 'PHOTO';
        }
        hud.setPhotoButton(photoLabel);

        // Telemetry at ~10Hz: speed from position delta (uniform across all
        // unit types), slope from the shared terrain normal, real lat/lon
        // derived in hud.js from the world offset. Ground units report the
        // ground-contact slope (DEM + micro-relief — what the wheels/boots
        // actually feel, IMU-style); flying units the smooth DEM slope of
        // the terrain below. ELEV stays smooth-DEM in both cases so the
        // areoid-relative readout never carries invented bumps.
        teleAccum += dt;
        if (teleAccum >= 0.1) {
            const pos = active.unit.position;
            const speed = pos.distanceTo(prevPos) / teleAccum;
            const normal = active.kind === 'fly'
                ? terrain.sampleNormal(pos.x, pos.z)
                : terrain.sampleGroundNormal(pos.x, pos.z);
            const slopeDeg = Math.acos(Math.min(1, Math.max(0, normal.y))) * 180 / Math.PI;
            // steer angle to TGT relative to forward travel (-[sin h, cos h])
            let tgtRelDeg = null;
            if (targetInfo) {
                const rel = Math.atan2(targetInfo.sample.x - pos.x, targetInfo.sample.z - pos.z)
                    - (active.unit.heading + Math.PI);
                tgtRelDeg = -(((rel * 180 / Math.PI) + 540) % 360 - 180);
            }
            hud.setTelemetry({
                speed,
                heading: active.unit.heading,
                elevation: terrain.sampleHeight(pos.x, pos.z),
                slopeDeg,
                x: pos.x,
                z: pos.z,
                odo: active.odo,
                charge: active.charge,
                dead: !!active.dead,
                docked: !!active.docked,
                charging: !!active.charging,
                health: active.unit.health ?? null,   // rover-only gauge
                repairing: !!active.docked && (active.unit.health ?? 100) < 100,
                target: targetInfo,
                tgtRelDeg,
                rolloverRisk: active.unit.rolloverRisk ?? null, // rover-only gauge
                wind: wind.sample(pos.x, pos.z), // real m/s at the unit (Wave 6)
            });
            hud.setNode(analysis.status());
            hud.setMarsClock(marsClock.read());
            // AGC follows the sol: dusk opens the tube up, dawn stops it down.
            if (nightVision) applyNvGain();
            // GPS wayfinding (Wave 9.4): bearings from the unit being driven
            // to every OTHER unit, plus the nearest base. Fed at telemetry
            // rate — 10 Hz is smooth on a dial and cheap on the DOM.
            hud.setGps(comms.track(
                pos,
                active.unit.heading,
                units.filter((u) => u !== active && !u.stowed).map((u) => ({ name: u.name, position: u.unit.position })),
                baseList(),
            ));
            if (active.kind === 'fly') {
                hud.setDroneState({
                    landed: active.unit.landed,
                    landing: active.unit.landing,
                    alt: active.unit.alt,
                    ceiling: active.unit.ceiling,
                    altTarget: active.unit.altTarget,
                });
            }
            // Breadcrumb for the PATH overlay: only when the unit has
            // actually moved a map-visible step (3m ~ 0.25px on the tile).
            const lastCrumb = pathTrail[pathTrail.length - 1];
            if (!lastCrumb || Math.hypot(pos.x - lastCrumb.x, pos.z - lastCrumb.z) >= 3) {
                pathTrail.push({ x: pos.x, z: pos.z });
                if (pathTrail.length > 400) pathTrail.shift();
            }
            prevPos.copy(pos);
            teleAccum = 0;
        }

        camRig.update(active.unit.position, active.unit.heading, active.kind);
        env.update(camera, dt);
        rocks.update(active.unit.position);

        renderer.render(scene, camera);
    });
}

function setupKeyboard() {
    const keys = new Set();
    window.addEventListener('keydown', (e) => {
        keys.add(e.code);
        if (e.code === 'Tab') e.preventDefault();
    });
    window.addEventListener('keyup', (e) => keys.delete(e.code));
    document.addEventListener('keydown', (e) => {
        if (e.code === 'Tab') document.dispatchEvent(new CustomEvent('mc-switch-unit'));
        if (e.code === 'KeyE') document.dispatchEvent(new CustomEvent('mc-collect'));
        if (e.code === 'KeyL') document.dispatchEvent(new CustomEvent('mc-toggle-land'));
        if (e.code === 'KeyG') document.dispatchEvent(new CustomEvent('mc-cycle-gear'));
        if (e.code === 'KeyN') document.dispatchEvent(new CustomEvent('mc-night-vision'));
        if (e.code === 'KeyM' || e.code === 'Escape') document.dispatchEvent(new CustomEvent('mc-menu'));
        if (e.code === 'KeyV') document.dispatchEvent(new CustomEvent('mc-van-deploy'));
        if (e.code === 'KeyP') document.dispatchEvent(new CustomEvent('mc-photo'));
    });
    return keys;
}

function setupTouchControls() {
    const moveZone = document.getElementById('mc-touch-move');
    const lookZone = document.getElementById('mc-touch-look');
    if (!isTouchDevice()) {
        moveZone.hidden = true;
        lookZone.hidden = true;
        return { move: null, look: null, setMode: () => {} };
    }
    // Wave 10.1: phones play landscape. The CSS rotate prompt is the
    // dependable path; orientation.lock is a best-effort bonus (Android
    // Chrome, fullscreen contexts) that quietly rejects everywhere else —
    // retried once on first touch, where transient activation helps.
    const tryLock = () => screen.orientation?.lock?.('landscape')?.catch(() => {});
    tryLock();
    window.addEventListener('pointerdown', tryLock, { once: true });
    const move = createJoystick(moveZone);
    const look = createJoystick(lookZone);
    return {
        move, look,
        // ground: one MOVE stick (right zone freed for camera drags on the
        // canvas); fly: RC Mode 2 with both sticks labelled
        setMode(kind) {
            if (kind === 'fly') {
                move.setLabel('THR · YAW');
                look.setLabel('PITCH · ROLL');
                look.setHidden(false);
            } else {
                move.setLabel('MOVE');
                look.setHidden(true);
            }
        },
    };
}

function readMoveInput(keys, joystick) {
    if (joystick && joystick.active) return joystick.value;
    let x = 0, y = 0;
    if (keys.has('KeyW') || keys.has('ArrowUp')) y -= 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) y += 1;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) x -= 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) x += 1;
    return { x, y };
}

// Keyboard: W/S pitch fwd/back, A/D yaw, Q/E strafe, R/F climb/descend.
// Touch: RC Mode 2 — left stick throttle(y)+yaw(x), right stick
// pitch(y)+roll(x); stick-up = positive.
function readDroneInput(keys, joyLeft, joyRight) {
    if ((joyLeft && joyLeft.active) || (joyRight && joyRight.active)) {
        const l = joyLeft && joyLeft.active ? joyLeft.value : { x: 0, y: 0 };
        const r = joyRight && joyRight.active ? joyRight.value : { x: 0, y: 0 };
        return { forward: -r.y, strafe: r.x, turn: -l.x, climb: -l.y };
    }
    let forward = 0, strafe = 0, turn = 0, climb = 0;
    if (keys.has('KeyW') || keys.has('ArrowUp')) forward += 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) forward -= 1;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) turn += 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) turn -= 1;
    if (keys.has('KeyQ')) strafe -= 1;
    if (keys.has('KeyE')) strafe += 1;
    if (keys.has('KeyR')) climb += 1;
    if (keys.has('KeyF')) climb -= 1;
    return { forward, strafe, turn, climb };
}

document.addEventListener('mc-switch-unit', () => document.getElementById('mc-switch')?.click());
document.addEventListener('mc-collect', () => document.getElementById('mc-collect')?.click());
document.addEventListener('mc-toggle-land', () => document.getElementById('mc-land')?.click());
document.addEventListener('mc-cycle-gear', () => document.getElementById('mc-gear')?.click());
document.addEventListener('mc-night-vision', () => document.getElementById('mc-nv')?.click());
document.addEventListener('mc-menu', () => {
    const menu = document.getElementById('mc-menu');
    if (menu) menu.dataset.open = menu.dataset.open === 'true' ? 'false' : 'true';
});
// Same pattern as every other key: the event clicks the HUD button, whose
// handler lives inside startGame's scope. (A direct handler here can't see
// `units`/`van` — they are startGame locals.)
document.addEventListener('mc-van-deploy', () => document.getElementById('mc-van')?.click());
document.addEventListener('mc-photo', () => document.getElementById('mc-photo')?.click());

boot();
