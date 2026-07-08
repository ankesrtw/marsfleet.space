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

const QUALITY = {
    terrainSegments: window.matchMedia('(pointer: coarse)').matches ? 128 : 256,
};

async function boot() {
    const site = getSiteFromUrl();
    const selectEl = document.getElementById('site-select');
    const gameEl = document.getElementById('game-root');

    if (!site) {
        selectEl.hidden = false;
        gameEl.hidden = true;
        renderSiteSelect(selectEl);
        return;
    }

    selectEl.hidden = true;
    gameEl.hidden = false;
    await startGame(site);
}

function renderSiteSelect(el) {
    el.innerHTML = `
        <div class="site-select">
            <h1>MARS COLONY</h1>
            <p>Choose a landing site.</p>
            <div class="site-select__cards"></div>
        </div>
    `;
    const cardsEl = el.querySelector('.site-select__cards');
    for (const s of Object.values(SITES)) {
        const card = document.createElement('a');
        card.className = 'site-card';
        card.href = `?site=${encodeURIComponent(s.id)}`;
        const h2 = document.createElement('h2');
        h2.textContent = s.name;
        const p = document.createElement('p');
        p.textContent = s.mission;
        card.append(h2, p);
        cardsEl.appendChild(card);
    }
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

    const rover = createRover(site, terrain);
    const drone = createDrone(site, terrain);
    const humanoid = createHumanoid(site, terrain);
    scene.add(rover.mesh, drone.mesh, humanoid.mesh);

    const samples = createSamples(site, terrain);
    scene.add(samples.group);

    // Per-unit sim state: battery (drains with movement, solar-recharges
    // when idle; an empty battery immobilises the unit until it recovers
    // above the restart threshold) and odometer.
    const units = [
        { name: 'Rover', unit: rover, kind: 'ground', charge: 100, odo: 0, drainRate: 0.5 },
        { name: 'Drone', unit: drone, kind: 'fly', charge: 100, odo: 0, drainRate: 0.9 },
        { name: 'Humanoid', unit: humanoid, kind: 'ground', charge: 100, odo: 0, drainRate: 0.3 },
    ];
    const SOLAR_RATE = 0.6;      // %/s recharge while not driving
    const RESTART_CHARGE = 10;   // empty units stay dead until this
    let activeIndex = 0;

    const hudRoot = document.getElementById('mc-hud');
    const hud = createHud(hudRoot, {
        site,
        onSwitchUnit: () => switchUnit(),
        onCollect: () => tryCollect(),
    });
    const fog = createFog(site, hud.minimapEl);
    hud.setActiveUnit(units[activeIndex].name);

    const touchZones = setupTouchControls();
    const keys = setupKeyboard();

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
    window.__mc = { site, terrain, rover, drone, humanoid, samples, renderer, scene, camera, camRig, units };

    function switchUnit() {
        activeIndex = (activeIndex + 1) % units.length;
        hud.setActiveUnit(units[activeIndex].name);
    }

    function tryCollect() {
        const active = units[activeIndex];
        if (active.kind !== 'ground') return;
        const sample = samples.nearestUncollected(active.unit.position);
        if (sample) {
            samples.collect(sample);
            hud.setInventory(samples.inventory);
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

        let moveInput = readMoveInput(keys, touchZones.move);
        const lookInput = readLookInput(touchZones.look);

        // Battery: the active unit drains proportionally to input; every
        // idle unit solar-recharges. Empty -> inputs cut until it recovers.
        const inputMag = Math.min(1, Math.abs(moveInput.x) + Math.abs(moveInput.y) + Math.abs(lookInput.x) * 0.3);
        active.dead = active.dead ? active.charge < RESTART_CHARGE : active.charge <= 0;
        if (active.dead) moveInput = { x: 0, y: 0 };
        for (const u of units) {
            const driving = u === active && !active.dead && inputMag > 0.02;
            u.charge = driving
                ? Math.max(0, u.charge - u.drainRate * inputMag * dt)
                : Math.min(100, u.charge + SOLAR_RATE * dt);
        }

        const beforeMove = active.unit.position.clone();
        if (active.kind === 'ground') {
            active.unit.update(dt, { throttle: moveInput.y, steer: -moveInput.x });
        } else {
            active.unit.update(dt, { forward: -moveInput.y, strafe: moveInput.x, turn: lookInput.x });
        }
        active.odo += Math.hypot(
            active.unit.position.x - beforeMove.x,
            active.unit.position.z - beforeMove.z
        );

        fog.reveal(drone.position.x, drone.position.z);
        if (active.kind === 'ground') fog.reveal(active.unit.position.x, active.unit.position.z);
        fog.render(samples.markers);

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
                target: samples.nearestInfo(pos),
            });
            prevPos.copy(pos);
            teleAccum = 0;
        }

        camRig.update(active.unit.position, active.unit.heading, active.kind);
        env.update(camera);
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
        return { move: null, look: null };
    }
    return {
        move: createJoystick(moveZone),
        look: createJoystick(lookZone),
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

function readLookInput(joystick) {
    if (joystick && joystick.active) return joystick.value;
    return { x: 0, y: 0 };
}

document.addEventListener('mc-switch-unit', () => document.getElementById('mc-switch')?.click());
document.addEventListener('mc-collect', () => document.getElementById('mc-collect')?.click());
document.addEventListener('mc-menu', () => {
    const menu = document.getElementById('mc-menu');
    if (menu) menu.dataset.open = menu.dataset.open === 'true' ? 'false' : 'true';
});

boot();
