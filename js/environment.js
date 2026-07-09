/* ============================================================
   environment.js — Mars atmosphere: sky dome, sun, dust haze,
   and the day/night cycle.

   Sky is a camera-following inverted sphere with a procedural
   gradient (butterscotch dust horizon -> darker zenith — Mars'
   sky is brightest near the horizon, the opposite of Earth) plus
   an in-shader sun disc + halo. The same sun direction drives the
   terrain's relief shading (terrain.js) and the DirectionalLight
   on units, so all lighting agrees.

   Day/night: SUN_DIR is mutated in place each frame — terrain.js
   and the sky shader hold references to this exact Vector3 (and to
   FOG.color), so the whole scene tracks the cycle with no per-frame
   uniform plumbing. One in-game sol is CYCLE_S long; daylight() is
   exported via the instance for gameplay (solar recharge stops at
   night — see main.js).

   Haze: FogExp2 on the scene handles standard materials (units,
   rocks, markers); terrain.js applies the same color/density
   manually in its ShaderMaterial. One source of truth: FOG.
   ============================================================ */

import * as THREE from 'three';

// Mutated by the cycle; starts as the original low morning sun so the
// first frame matches the pre-cycle look.
export const SUN_DIR = new THREE.Vector3(-0.55, 0.38, -0.42).normalize();
export const FOG = {
    color: new THREE.Color(0xc9977a),
    density: 0.00016,
};

// 40-min sol, day-biased (~27 min of light) — the original 20-min cycle
// hit dusk 7-10 min into a session and read as "the screen is getting
// darker" rather than as a sunset. DAYLIGHT LOCK (menu) freezes the sun
// at the boot-time morning for players who don't want night at all.
const CYCLE_S = 2400;
const ELEV_AMP = 0.62;        // sun elevation swing
const ELEV_BIAS = 0.20;       // >0 biases toward longer days
const SOL_KEY = 'mc-sol';
const FOG_DAY = new THREE.Color(0xc9977a);
const FOG_NIGHT = new THREE.Color(0x241610);
const _fogTmp = new THREE.Color();

export function createEnvironment(scene) {
    scene.fog = new THREE.FogExp2(FOG.color, FOG.density);

    const skyGeo = new THREE.SphereGeometry(15000, 24, 16);
    const skyMat = new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: {
            uSunDir: { value: SUN_DIR },
        },
        vertexShader: /* glsl */ `
            varying vec3 vDir;
            void main() {
                vDir = position;
                // Keep the dome glued to the camera (view translation removed).
                vec4 mv = modelViewMatrix * vec4(position, 1.0);
                gl_Position = projectionMatrix * mv;
            }
        `,
        fragmentShader: /* glsl */ `
            uniform vec3 uSunDir;
            varying vec3 vDir;
            void main() {
                vec3 dir = normalize(vDir);
                float h = clamp(dir.y, -0.05, 1.0);

                // Mars sky: bright dusty butterscotch at the horizon,
                // darkening toward a brown-mauve zenith.
                vec3 horizon = vec3(0.85, 0.62, 0.44);
                vec3 zenith  = vec3(0.23, 0.15, 0.12);
                vec3 sky = mix(horizon, zenith, pow(max(h, 0.0), 0.55));

                // Day/night from sun elevation; a floor keeps night navigable.
                float dayF = 0.16 + 0.84 * smoothstep(-0.14, 0.18, uSunDir.y);
                sky *= dayF;

                // Sun disc + dusty halo (bluish-white, as seen from Mars).
                float sunCos = dot(dir, uSunDir);
                float halo = pow(clamp(sunCos, 0.0, 1.0), 24.0) * 0.35 * dayF;
                float disc = smoothstep(0.9993, 0.9997, sunCos);
                vec3 sunCol = vec3(1.0, 0.97, 0.92);
                sky += halo * vec3(0.95, 0.83, 0.72) + disc * sunCol;

                gl_FragColor = vec4(sky, 1.0);
            }
        `,
    });
    const sky = new THREE.Mesh(skyGeo, skyMat);
    sky.name = 'sky';
    sky.frustumCulled = false;
    scene.add(sky);

    // Lights for standard materials (units, rocks, sample markers) —
    // direction matches the sky's sun disc.
    const sun = new THREE.DirectionalLight(0xffe8d0, 1.4);
    sun.position.copy(SUN_DIR.clone().multiplyScalar(1000));
    scene.add(sun);
    const hemi = new THREE.HemisphereLight(0xcf9d76, 0x3a2418, 0.75);
    scene.add(hemi);

    // Cycle phase chosen so the boot-time sun elevation continues the
    // original hand-placed morning vector (no visible pop at start).
    const phase0 = Math.asin((SUN_DIR.y - ELEV_BIAS) / ELEV_AMP);
    let phase = phase0;
    const az0 = Math.atan2(SUN_DIR.z, SUN_DIR.x) - phase;
    let cycling = localStorage.getItem(SOL_KEY) !== 'lock';

    function daylight() {
        return smoothstep(-0.05, 0.20, SUN_DIR.y);
    }

    /** Menu toggle: ON = live sol cycle, LOCK = permanent boot-time morning. */
    function toggleSol() {
        cycling = !cycling;
        if (!cycling) phase = phase0;
        try { localStorage.setItem(SOL_KEY, cycling ? 'on' : 'lock'); } catch { /* private mode */ }
        return cycling;
    }

    /** Per frame: advance the sol cycle, keep the dome camera-centered. */
    function update(camera, dt = 0) {
        if (cycling) phase += (dt / CYCLE_S) * Math.PI * 2;
        const elev = ELEV_BIAS + ELEV_AMP * Math.sin(phase);
        const az = az0 + phase;
        const cosE = Math.sqrt(Math.max(0, 1 - elev * elev));
        SUN_DIR.set(Math.cos(az) * cosE, elev, Math.sin(az) * cosE).normalize();

        const day = daylight();
        sun.intensity = 1.4 * day;
        hemi.intensity = 0.75 * (0.35 + 0.65 * day);

        // FOG.color is shared by reference with the terrain shader and
        // scene.background; scene.fog copied it, so sync that one by hand.
        FOG.color.copy(_fogTmp.copy(FOG_NIGHT).lerp(FOG_DAY, day));
        scene.fog.color.copy(FOG.color);

        sky.position.copy(camera.position);
        sun.position.copy(camera.position).addScaledVector(SUN_DIR, 1000);
        sun.target.position.copy(camera.position);
        sun.target.updateMatrixWorld();
    }

    return { update, daylight, toggleSol, get cycling() { return cycling; }, sunDir: SUN_DIR };
}

function smoothstep(a, b, x) {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
}

/** Small tiling value-noise canvas used by terrain.js to break up the
    orthophoto's blur at rover scale. Generated at runtime — no asset. */
export function createDetailTexture(size = 256) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(size, size);
    let seed = 1337;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    // base white noise
    const base = new Float32Array(size * size);
    for (let i = 0; i < base.length; i++) base[i] = rand();
    // one smoothing pass -> soft granular look instead of TV static
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            let sum = 0;
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    sum += base[((y + dy + size) % size) * size + ((x + dx + size) % size)];
                }
            }
            const v = Math.round((sum / 9) * 255);
            const i = (y * size + x) * 4;
            img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
            img.data[i + 3] = 255;
        }
    }
    ctx.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    return tex;
}
