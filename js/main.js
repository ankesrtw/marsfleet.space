/* ============================================================
   main.js — boot, site selection, render loop, unit-focus toggle.
   ============================================================ */

import * as THREE from 'three';
import { SITES, getSiteFromUrl } from './sites.js';
import { loadTerrain } from './terrain.js';
import { createRover } from './rover.js';
import { createDrone } from './drone.js';
import { createHumanoid } from './humanoid.js';
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
import { createAnalysis } from './analysis.js';
import { createColliders } from './colliders.js';
import { createLandingIntro } from './intro.js';
import { createMissions } from './missions.js';

// Lift-drone logistics interaction envelope (see lab.js):
const SLING_ALT = 8;      // m AGL — hover this low (or sit landed: alt 0
                          // passes the same gate) to hook a container
const SLING_RADIUS = 7;   // m horizontal to the container
const DELIVER_ALT = 16;   // m AGL over the pad — ABOVE cruiseAlt (12), so
                          // arriving at cruise height delivers, no hunt-the-
                          // altitude (the short cable sells the lowering)

// First-visit-only cinematic gate (see intro.js). Set the moment the
// sequence STARTS, not when it finishes, so a refresh mid-sequence or a
// skip doesn't re-trigger it. Deliberately NOT cleared by RESET MISSION —
// same spirit as `mc-results` surviving resets. (Mission completion flags
// live in missions.js: `mc-mission-<id>-done`, same convention.)
const LS_INTRO_KEY = 'mc-intro-seen';

// Per-site mesh density (sites.js `segments`) by device class — Gale's 1m
// DEM earns 512 desktop quads, Jezero's 20m DEM doesn't. Fallback for
// sites without the field keeps the old shared 256/128.
function qualityFor(site) {
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    return {
        terrainSegments: (coarse ? site.segments?.mobile : site.segments?.desktop)
            ?? (coarse ? 128 : 256),
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
    scene.add(rover.mesh, recon.mesh, lift.mesh, humanoid.mesh);
    // Obstacle footprints (radius mirrors each unit's own BODY_RADIUS /
    // bodyRadius); alt() gates unit-vs-unit checks to overlapping bands.
    colliders.register('rover', { position: rover.position, radius: 1.4, alt: () => 0 });
    colliders.register('humanoid', { position: humanoid.position, radius: 0.35, alt: () => 0 });
    colliders.register('recon', { position: recon.position, radius: 0.7, alt: () => recon.alt });
    colliders.register('lift', { position: lift.position, radius: 1.2, alt: () => lift.alt });

    const samples = createSamples(site, terrain);
    scene.add(samples.group);

    // FIELD LAB base + the sling that feeds it (lab.js): collect leaves a
    // cache container in the field, the lift drone slings it to the pad.
    const lab = createLab(scene, site, terrain, rocks);
    for (const o of lab.obstacles) colliders.addStatic(o.x, o.z, o.r, o.h);
    const sling = createSling(scene, terrain);
    const deliveredIds = new Set();

    // Edge-node analysis queue + persistent science archive (analysis.js):
    // delivered caches auto-process; completion reveals the real finding.
    const analysis = createAnalysis(site, {
        onDone: () => {
            hud.setInventory(samples.inventory, deliveredIds, analysis.analyzedIds);
            hud.setArchive(analysis.archive);
            sound.analysisDone();
            missions.advance('analyze');
        },
    });

    // Blob shadows, drive dust, wheel tracks (effects.js); beacon column
    // on the current TGT sample (waypoint.js); synthesized audio (sound.js).
    const effects = createEffects(scene, terrain);
    effects.addShadow(rover.mesh, 1.7);
    effects.addShadow(recon.mesh, 0.55, true);
    effects.addShadow(lift.mesh, 1.0, true);
    effects.addShadow(humanoid.mesh, 0.5);
    const waypoint = createWaypoint(scene, terrain);
    const sound = createSound();

    // Per-site objective chains (missions.js): the guided tutorial ships
    // as mission 'tutorial' (autostart, first-visit-only via its own
    // mc-mission-tutorial-done flag), re-runnable anytime from the menu
    // MISSIONS section. Action call sites below just announce what
    // happened via missions.advance(id) — broadcast, no-op when nothing
    // is listening. Completion survives RESET MISSION (archive spirit).
    const missions = createMissions(site, {
        onComplete: () => hud.setMissions(missions.menuEntries()),
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
        { name: 'Humanoid', unit: humanoid, kind: 'ground', charge: 100, odo: 0, drainRate: 0.07 },
    ];
    const SOLAR_RATE = 0.25;     // %/s recharge while not driving (~7 min
                                 // full charge in daylight — proportional
                                 // to the slower real-endurance drain)
    const RESTART_CHARGE = 10;   // empty units stay dead until this
    const NIGHT_DRAIN_K = 0.5;   // cold-night heater tax: +50% drain at full dark
    const STORM_FOG_K = 8;       // FOG.density multiplier span at storm peak
    const ROLLOVER_BATT_PENALTY = 8; // % charge lost when the rover tips (Wave 6)
    let activeIndex = 0;
    let prevRoverCondition = 'ok';   // Wave 6 transition edge detector

    const hudRoot = document.getElementById('mc-hud');
    const hud = createHud(hudRoot, {
        site,
        onSwitchUnit: () => switchUnit(),
        onCollect: () => tryCollect(),
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
        onStartMission: (id) => startMission(id),
        missions: missions.menuEntries(),
        onSetOverlayMode: (mode) => fog.setOverlayMode(mode),
    });
    const fog = createFog(site, hud.minimapEl, terrain);
    hud.setOverlayMode(fog.overlayMode); // reflect the persisted choice

    // PATH overlay breadcrumbs: the active unit's recent track, appended
    // on the telemetry tick below, rendered by fog.js in PATH mode only.
    const pathTrail = [];

    hud.setLab(0, site.samples.length);
    hud.setArchive(analysis.archive); // persisted results from past sessions

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
        try { localStorage.setItem(LS_INTRO_KEY, '1'); } catch { /* private mode */ }
        // Escape hatch on ANY input — click/tap or any key (there was no
        // keyboard way out, which read as a hang on slow machines).
        canvas.addEventListener('pointerdown', () => intro?.skip(), { once: true });
        window.addEventListener('keydown', () => intro?.skip(), { once: true });
        camRig.setDistance(70); // wide cinematic framing for the 15m container
        const first = intro.update(0);
        camRig.update(first.pos, first.heading, 'fly', true);
    }
    try {
        if (localStorage.getItem(LS_INTRO_KEY) !== '1') startIntro();
    } catch { /* private mode — skip the intro rather than replay every load */ }
    if (!intro) camRig.update(rover.position, rover.heading, 'ground', true);

    // Debug/E2E handle (also used by the sampleHeight ground-truth check;
    // renderer/scene/camera exposed so tests on software-GL boxes can pause
    // the loop and capture canvas pixels via a same-task render+toDataURL).
    window.__mc = { site, terrain, rover, drone: recon, recon, lift, humanoid, samples, renderer, scene, camera, camRig, units, env, effects, waypoint, sound, rocks, lab, sling, analysis, fog, colliders, missions, hazardZones, weather, dustDevils, wind, get intro() { return intro; } };

    function applyUnitMode() {
        const active = units[activeIndex];
        hud.setActiveUnit(active.name);
        hud.setDronePanel(active.kind === 'fly');
        hud.setGear(active.unit.gearLabel ?? null);
        touchZones.setMode(active.kind);
    }

    function switchUnit() {
        activeIndex = (activeIndex + 1) % units.length;
        applyUnitMode();
        sound.switchUnit();
        if (units[activeIndex].unit === lift) missions.advance('switch');
    }

    function toggleLanding() {
        const active = units[activeIndex];
        if (active.kind !== 'fly' || active.dead) return;
        active.unit.toggleLanding();
        sound.switchUnit();
    }

    function tryCollect() {
        const active = units[activeIndex];
        if (active.kind === 'ground') {
            const sample = samples.nearestUncollected(active.unit.position);
            if (sample) {
                samples.collect(sample);
                hud.setInventory(samples.inventory, deliveredIds, analysis.analyzedIds);
                sound.collect();
                missions.advance('collect');
            }
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
                c.mesh.position.y = terrain.sampleHeight(c.mesh.position.x, c.mesh.position.z) + 0.28;
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

        // Per-kind input. Drones use RC Mode 2 on touch (left stick =
        // throttle/yaw, right stick = pitch/roll) and WASD+QERF on keys.
        let input, inputMag;
        if (active.kind === 'ground') {
            const mv = readMoveInput(keys, touchZones.move);
            input = { throttle: mv.y, steer: -mv.x };
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
        for (const u of units) {
            if (u.kind === 'fly') u.unit.setPower(!u.dead); // dead => force-land
            const airborne = u.kind === 'fly' && !u.unit.landed;
            const activeLoad = u === active && !active.dead && inputMag > 0.02 ? inputMag : 0;
            const load = airborne ? Math.max(0.4, activeLoad) : activeLoad;
            u.charge = load > 0
                ? Math.max(0, u.charge - u.drainRate * load * (u.unit.drainScale ?? 1) * coldDrain * dt)
                : Math.min(100, u.charge + solarNow * dt);
        }

        // battery audio cues on downward transitions of the active unit
        if (active.charge <= 15 && !active.lowWarned) { active.lowWarned = true; sound.lowBattery(); }
        else if (active.charge > 35) active.lowWarned = false;
        if (active.dead && !active.deadWarned) { active.deadWarned = true; sound.dead(); }
        else if (!active.dead) active.deadWarned = false;

        const beforeMove = active.unit.position.clone();
        active.unit.update(dt, input);
        // idle drones keep simulating: hover physics settles, auto-land
        // sequences (incl. dead-battery force-landing) complete
        for (const u of units) {
            if (u.kind === 'fly' && u !== active) {
                u.unit.update(dt, { forward: 0, strafe: 0, turn: 0, climb: 0 });
            }
        }
        const movedDist = Math.hypot(
            active.unit.position.x - beforeMove.x,
            active.unit.position.z - beforeMove.z
        );
        active.odo += movedDist;
        const speedNow = dt > 0 ? movedDist / dt : 0;

        fog.reveal(recon.position.x, recon.position.z);
        fog.reveal(lift.position.x, lift.position.z);
        if (active.kind === 'ground') fog.reveal(active.unit.position.x, active.unit.position.z);

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
        }

        // minimap: unit dots (active gets a heading tick), lab square, TGT
        // ring (a cache target rings its source sample's marker).
        fog.render(samples.markers, units.map((u, i) => ({
            x: u.unit.position.x, z: u.unit.position.z,
            heading: u.unit.heading, active: i === activeIndex,
        })), {
            lab: { x: lab.padPos.x, z: lab.padPos.z },
            targetId: targetInfo ? targetInfo.sample.id.replace('-cache', '') : null,
            caches: samples.containers
                .filter((c) => c.state === 'field')
                .map((c) => ({ x: c.mesh.position.x, z: c.mesh.position.z })),
            path: pathTrail,
            devils: dustDevils.devils.map((d) => ({ x: d.x, z: d.z, r: d.r })),
        });
        waypoint.update(dt, targetInfo);
        sling.update(dt, lift.position);
        lab.update(dt);
        analysis.update(dt);
        dustDevils.update(dt);
        effects.update(dt, active, speedNow, env.daylight());
        const engineNorm = active.kind === 'fly'
            ? (active.unit.landed ? 0 : Math.max(0.35, speedNow / active.unit.maxSpeed))
            : speedNow / (active.name === 'Humanoid' ? 1.4 : Math.max(0.042, rover.maxSpeed));
        const windHere = wind.sample(active.unit.position.x, active.unit.position.z);
        sound.update(active.name, Math.min(1, engineNorm),
            Math.hypot(windHere.vx, windHere.vz) / 20); // /WIND_PEAK — 1.0 at storm max

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
        if (active.unit === rover && rover.condition === 'rolled') {
            hud.setHazard({ type: 'rollover', pct: recPct });
        } else if (active.unit === rover && rover.condition === 'bogged') {
            hud.setHazard({ type: 'bogged', pct: recPct });
        } else if (active.unit !== rover && rover.condition !== 'ok') {
            hud.setHazard({ type: 'rover-down', pct: recPct });
        } else if (active.unit === rover && rover.bogMeter > 0.3) {
            hud.setHazard({ type: 'sinking' });
        } else {
            hud.setHazard(active.unit.inHazard
                ?? (weather.intensity > 0.15 ? { type: 'dust-storm' } : null));
        }

        // Dust storm haze: FOG.color is synced by env.update, but density
        // is copied by VALUE into both scene.fog (environment.js re-syncs
        // it) and the terrain shader's uniform — that one is synced here.
        FOG.density = FOG_BASE_DENSITY * (1 + weather.intensity * STORM_FOG_K);
        terrain.mesh.material.uniforms.uFogDensity.value = FOG.density;

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
        if (hud.isMenuOpen()) missions.advance('archive');
        const objective = missions.currentAny();
        hud.setObjective(objective
            ? `${objective.stepNum}/${objective.total} · ${objective.step.text}`
            : null);

        if (active.kind === 'ground') {
            const nearest = samples.nearestUncollected(active.unit.position);
            hud.setPrompt(nearest ? `COLLECT: ${nearest.name}` : null);
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
                target: targetInfo,
                tgtRelDeg,
                rolloverRisk: active.unit.rolloverRisk ?? null, // rover-only gauge
                wind: wind.sample(pos.x, pos.z), // real m/s at the unit (Wave 6)
            });
            hud.setNode(analysis.status());
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
        if (e.code === 'KeyM' || e.code === 'Escape') document.dispatchEvent(new CustomEvent('mc-menu'));
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
document.addEventListener('mc-menu', () => {
    const menu = document.getElementById('mc-menu');
    if (menu) menu.dataset.open = menu.dataset.open === 'true' ? 'false' : 'true';
});

boot();
