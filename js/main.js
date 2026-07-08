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
    scene.background = new THREE.Color(0x3a1f14);

    // Far plane must cover the largest site diagonal (Gale is 9km square).
    const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 20000);

    const sun = new THREE.DirectionalLight(0xfff2e0, 1.2);
    sun.position.set(300, 500, 200);
    scene.add(sun);
    scene.add(new THREE.AmbientLight(0x554433, 0.6));

    const terrain = await loadTerrain(site, QUALITY);
    scene.add(terrain.mesh);

    const rover = createRover(site, terrain);
    const drone = createDrone(site, terrain);
    const humanoid = createHumanoid(site, terrain);
    scene.add(rover.mesh, drone.mesh, humanoid.mesh);

    const samples = createSamples(site, terrain);
    scene.add(samples.group);

    const units = [
        { name: 'Rover', unit: rover, kind: 'ground' },
        { name: 'Drone', unit: drone, kind: 'fly' },
        { name: 'Humanoid', unit: humanoid, kind: 'ground' },
    ];
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

    // Start the follow-cam at the rover's spawn instead of lerping down
    // from the origin (real elevations are negative — ~-2500m at Jezero).
    camera.position.set(
        rover.position.x + Math.sin(rover.heading) * 12,
        rover.position.y + 6,
        rover.position.z + Math.cos(rover.heading) * 12
    );
    camera.lookAt(rover.position.x, rover.position.y + 1, rover.position.z);

    // Debug/E2E handle (also used by the sampleHeight ground-truth check;
    // renderer/scene/camera exposed so tests on software-GL boxes can pause
    // the loop and capture canvas pixels via a same-task render+toDataURL).
    window.__mc = { site, terrain, rover, drone, humanoid, samples, renderer, scene, camera };

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

        const moveInput = readMoveInput(keys, touchZones.move);
        if (active.kind === 'ground') {
            active.unit.update(dt, { throttle: moveInput.y, steer: -moveInput.x });
        } else {
            const lookInput = readLookInput(touchZones.look);
            active.unit.update(dt, { forward: -moveInput.y, strafe: moveInput.x, turn: lookInput.x });
        }

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
            });
            prevPos.copy(pos);
            teleAccum = 0;
        }

        const target = active.unit.position;
        // Chase-cam sits behind the unit's travel direction (W drives along
        // -[sin h, cos h], so "behind" = +[sin h, cos h]) and turns with it.
        const h = active.unit.heading;
        const dist = active.kind === 'fly' ? 18 : 12;
        const lift = active.kind === 'fly' ? 12 : 6;
        camera.position.lerp(
            new THREE.Vector3(
                target.x + Math.sin(h) * dist,
                target.y + lift,
                target.z + Math.cos(h) * dist
            ),
            0.08
        );
        camera.lookAt(target.x, target.y + 1, target.z);

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
