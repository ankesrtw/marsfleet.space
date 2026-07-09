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
import { createEnvironment, FOG } from './environment.js';
import { createRocks } from './rocks.js';
import { createEffects } from './effects.js';
import { createWaypoint } from './waypoint.js';
import { createSound } from './sound.js';

const QUALITY = {
    terrainSegments: window.matchMedia('(pointer: coarse)').matches ? 128 : 256,
};

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
    const canvas = document.getElementById('mc-canvas');
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: QUALITY.terrainSegments > 128 });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);

    const scene = new THREE.Scene();
    scene.background = FOG.color; // only visible beyond the sky dome

    // Far plane must cover the largest site diagonal (Gale is 9km square).
    const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 20000);

    // Sky dome + sun disc + dust haze + unit lighting (see environment.js).
    const env = createEnvironment(scene);

    const terrain = await loadTerrain(site, QUALITY);
    scene.add(terrain.mesh);
    const rocks = createRocks(site, terrain, QUALITY);
    scene.add(rocks.mesh);

    const rover = createRover(site, terrain, rocks);
    // Two quads, both spawn LANDED beside the rover: a fast recon scout
    // and a slower heavy-lift frame (Ingenuity-class vs cargo-class).
    const recon = createDrone(site, terrain, {
        modelName: 'recon', maxSpeed: 10, climbRate: 3, cruiseAlt: 18, spawnDx: -6, spawnDz: 4,
    });
    const lift = createDrone(site, terrain, {
        modelName: 'drone', maxSpeed: 6, climbRate: 2, cruiseAlt: 12, spawnDx: 8, spawnDz: 6,
    });
    const humanoid = createHumanoid(site, terrain, rocks);
    scene.add(rover.mesh, recon.mesh, lift.mesh, humanoid.mesh);

    const samples = createSamples(site, terrain);
    scene.add(samples.group);

    // Blob shadows, drive dust, wheel tracks (effects.js); beacon column
    // on the current TGT sample (waypoint.js); synthesized audio (sound.js).
    const effects = createEffects(scene, terrain);
    effects.addShadow(rover.mesh, 1.7);
    effects.addShadow(recon.mesh, 0.55, true);
    effects.addShadow(lift.mesh, 1.0, true);
    effects.addShadow(humanoid.mesh, 0.5);
    const waypoint = createWaypoint(scene, terrain);
    const sound = createSound();

    // Per-unit sim state: battery (drains with movement, solar-recharges
    // when idle; an empty battery immobilises the unit until it recovers
    // above the restart threshold) and odometer.
    // Drain rates retuned for real-scale speeds (range per charge stays
    // sane). Drones burn charge the whole time they are AIRBORNE (hover
    // isn't free) and only solar-recharge on the ground — land to charge.
    const units = [
        { name: 'Rover', unit: rover, kind: 'ground', charge: 100, odo: 0, drainRate: 0.08 },
        { name: 'Recon Drone', unit: recon, kind: 'fly', charge: 100, odo: 0, drainRate: 0.35 },
        { name: 'Lift Drone', unit: lift, kind: 'fly', charge: 100, odo: 0, drainRate: 0.5 },
        { name: 'Humanoid', unit: humanoid, kind: 'ground', charge: 100, odo: 0, drainRate: 0.12 },
    ];
    const SOLAR_RATE = 0.6;      // %/s recharge while not driving
    const RESTART_CHARGE = 10;   // empty units stay dead until this
    let activeIndex = 0;

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
    });
    const fog = createFog(site, hud.minimapEl);

    const touchZones = setupTouchControls();
    const keys = setupKeyboard();
    applyUnitMode();

    // Ground every unit once before the first camera snap — constructors
    // leave y=0 and only the first update() drops them onto the terrain
    // (~-2500m at Jezero), which would leave the camera lerping down.
    rover.update(0, { throttle: 0, steer: 0 });
    humanoid.update(0, { throttle: 0, steer: 0 });

    // Orbit chase-cam (mouse drag / touch drag to orbit, wheel / pinch to
    // zoom, double-click to recenter); snapped to spawn.
    const camRig = createCameraRig(camera, canvas, terrain);
    camRig.update(rover.position, rover.heading, 'ground', true);

    // Debug/E2E handle (also used by the sampleHeight ground-truth check;
    // renderer/scene/camera exposed so tests on software-GL boxes can pause
    // the loop and capture canvas pixels via a same-task render+toDataURL).
    window.__mc = { site, terrain, rover, drone: recon, recon, lift, humanoid, samples, renderer, scene, camera, camRig, units, env, effects, waypoint, sound, rocks };

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
    }

    function toggleLanding() {
        const active = units[activeIndex];
        if (active.kind !== 'fly' || active.dead) return;
        active.unit.toggleLanding();
        sound.switchUnit();
    }

    function tryCollect() {
        const active = units[activeIndex];
        if (active.kind !== 'ground') return;
        const sample = samples.nearestUncollected(active.unit.position);
        if (sample) {
            samples.collect(sample);
            hud.setInventory(samples.inventory);
            sound.collect();
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
        active.dead = active.dead ? active.charge < RESTART_CHARGE : active.charge <= 0;
        if (active.dead) input = active.kind === 'ground'
            ? { throttle: 0, steer: 0 }
            : { forward: 0, strafe: 0, turn: 0, climb: 0 };
        const solarNow = SOLAR_RATE * env.daylight();
        for (const u of units) {
            if (u.kind === 'fly') u.unit.setPower(!u.dead); // dead => force-land
            const airborne = u.kind === 'fly' && !u.unit.landed;
            const activeLoad = u === active && !active.dead && inputMag > 0.02 ? inputMag : 0;
            const load = airborne ? Math.max(0.4, activeLoad) : activeLoad;
            u.charge = load > 0
                ? Math.max(0, u.charge - u.drainRate * load * (u.unit.drainScale ?? 1) * dt)
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
        fog.render(samples.markers);

        const targetInfo = samples.nearestInfo(active.unit.position);
        waypoint.update(dt, targetInfo);
        effects.update(dt, active, speedNow, env.daylight());
        const engineNorm = active.kind === 'fly'
            ? (active.unit.landed ? 0 : Math.max(0.35, speedNow / active.unit.maxSpeed))
            : speedNow / (active.name === 'Humanoid' ? 1.4 : Math.max(0.042, rover.maxSpeed));
        sound.update(active.name, Math.min(1, engineNorm));

        if (active.kind === 'ground') {
            const nearest = samples.nearestUncollected(active.unit.position);
            hud.setPrompt(nearest ? nearest.name : null);
        } else {
            hud.setPrompt(null);
        }

        // Telemetry at ~10Hz: speed from position delta (uniform across all
        // unit types), slope from the shared terrain normal, real lat/lon
        // derived in hud.js from the world offset.
        teleAccum += dt;
        if (teleAccum >= 0.1) {
            const pos = active.unit.position;
            const speed = pos.distanceTo(prevPos) / teleAccum;
            const normal = terrain.sampleNormal(pos.x, pos.z);
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
            });
            if (active.kind === 'fly') {
                hud.setDroneState({
                    landed: active.unit.landed,
                    landing: active.unit.landing,
                    alt: active.unit.alt,
                });
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
