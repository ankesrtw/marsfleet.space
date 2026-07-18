/* ============================================================
   hub.js — the Site Hub: a rotatable 3D Mars globe that is the
   first thing a new player sees (plan 22-B/C). Every landing site
   is a pin at its REAL lon/lat; picking one flies the camera down
   and hands off to the existing landing-drop (startGame).

   Its own short-lived Three.js scene/renderer, wholly separate from
   the sim's — created on show(), fully disposed before startGame so
   there is only ever ONE WebGL context alive (OOM-safe on the box
   the terrain clipmap already stresses). The globe is a single
   textured sphere (assets/hub/mars-globe.jpg — USGS Viking MDIM 2.1,
   see assets/hub/SOURCE.md), NOT a heavy mesh.

   Rotation rig: an outer TILT group (X, latitude, clamped) wraps an
   inner SPIN group (Y, longitude). Pins live on the SPIN group so
   they ride the globe. Auto-rotate feeds spin.y; drag steers both;
   wheel/pinch dollies the camera. Pointer Events unify mouse + touch;
   two pointers = pinch-zoom.

   Step 2 builds the globe (no pins). Pins/cards/reset land in the
   next steps; the factory already takes their callbacks.
   ============================================================ */

import * as THREE from 'three';

const TEXTURE_URL = 'assets/hub/mars-globe.jpg';
const R = 1;                      // globe radius (world units)
const CAM_MIN = 1.7, CAM_MAX = 4.2, CAM_START = 2.7;
const TILT_LIMIT = 1.15;          // rad — how far the poles can swing to camera
const AUTO_SPIN = 0.045;          // rad/s idle rotation (slow, cinematic)
const DAMP = 0.90;                // per-frame drag-inertia damping

// Mars sky/dust tones, shared feel with environment.js (0xc9977a haze,
// butterscotch horizon) so the hub reads as the same world.
const ATMO_COLOR = new THREE.Color(0xd98a52);
const KEY_COLOR = new THREE.Color(0xfff0e2);

export function createHub({ onEnter, onResetGame } = {}) {
    const root = document.getElementById('hub-root');
    const canvas = document.getElementById('hub-canvas');

    let renderer, scene, camera, tilt, spin, globe, globeMat, globeTex, atmo, stars;
    let raf = 0, timer = null, built = false, disposed = false;
    let camDist = CAM_START;

    // Drag / inertia state.
    const pointers = new Map();       // id -> {x,y}
    let dragging = false, lastX = 0, lastY = 0, velY = 0, velX = 0;
    let pinchDist = 0;
    let userInteracted = false;       // pauses auto-spin briefly after a drag

    function build() {
        renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.0;

        scene = new THREE.Scene();
        scene.background = new THREE.Color(0x07040a); // near-black space, warm hint

        camera = new THREE.PerspectiveCamera(
            42, window.innerWidth / window.innerHeight, 0.1, 200);
        camera.position.set(0, 0, camDist);

        // Lighting: enough ambient that no site is lost to the dark side of a
        // selection globe, plus a directional key for real spherical form.
        scene.add(new THREE.AmbientLight(0xffffff, 0.85));
        const key = new THREE.DirectionalLight(KEY_COLOR, 1.15);
        key.position.set(-0.6, 0.5, 1.0);
        scene.add(key);
        const rim = new THREE.DirectionalLight(0x6688cc, 0.25); // cool back-fill
        rim.position.set(0.8, -0.3, -1.0);
        scene.add(rim);

        // Rotation rig.
        tilt = new THREE.Group();
        spin = new THREE.Group();
        tilt.add(spin);
        scene.add(tilt);

        // The globe.
        globeTex = new THREE.TextureLoader().load(TEXTURE_URL);
        globeTex.colorSpace = THREE.SRGBColorSpace;
        globeTex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
        globeMat = new THREE.MeshStandardMaterial({
            map: globeTex, roughness: 0.95, metalness: 0.0,
        });
        globe = new THREE.Mesh(new THREE.SphereGeometry(R, 96, 64), globeMat);
        spin.add(globe);

        // Atmosphere rim — a back-side fresnel shell, additive, so the limb
        // glows dusty orange without hiding the disc.
        atmo = new THREE.Mesh(
            new THREE.SphereGeometry(R * 1.03, 96, 64),
            new THREE.ShaderMaterial({
                side: THREE.BackSide, transparent: true, depthWrite: false,
                blending: THREE.AdditiveBlending,
                uniforms: { uColor: { value: ATMO_COLOR } },
                vertexShader: /* glsl */`
                    varying vec3 vN; varying vec3 vView;
                    void main() {
                        vN = normalize(normalMatrix * normal);
                        vec4 mv = modelViewMatrix * vec4(position, 1.0);
                        vView = normalize(-mv.xyz);
                        gl_Position = projectionMatrix * mv;
                    }`,
                fragmentShader: /* glsl */`
                    uniform vec3 uColor; varying vec3 vN; varying vec3 vView;
                    void main() {
                        float f = pow(1.0 - abs(dot(vN, vView)), 3.0);
                        gl_FragColor = vec4(uColor, f * 0.9);
                    }`,
            }));
        scene.add(atmo); // on the tilt-less scene: rim shouldn't spin with pins

        stars = makeStars();
        scene.add(stars);

        timer = new THREE.Timer();
        built = true;
    }

    /** Sparse warm-white starfield on a far shell (decorative backdrop). */
    function makeStars() {
        const N = 1400, pos = new Float32Array(N * 3);
        for (let i = 0; i < N; i++) {
            // even-ish sphere sampling
            const u = Math.random() * 2 - 1, t = Math.random() * Math.PI * 2;
            const r = Math.sqrt(1 - u * u);
            pos[i * 3] = Math.cos(t) * r * 60;
            pos[i * 3 + 1] = u * 60;
            pos[i * 3 + 2] = Math.sin(t) * r * 60;
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        return new THREE.Points(g, new THREE.PointsMaterial({
            color: 0xfff2e6, size: 1.5, sizeAttenuation: false,
            transparent: true, opacity: 0.85, depthWrite: false,
        }));
    }

    // ---- Interaction -------------------------------------------------------
    function onPointerDown(e) {
        canvas.setPointerCapture?.(e.pointerId);
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pointers.size === 1) {
            dragging = true; userInteracted = true;
            lastX = e.clientX; lastY = e.clientY; velY = velX = 0;
        } else if (pointers.size === 2) {
            dragging = false;
            pinchDist = twoPointerDist();
        }
    }
    function onPointerMove(e) {
        if (!pointers.has(e.pointerId)) return;
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pointers.size === 2) {
            const d = twoPointerDist();
            if (pinchDist > 0) dolly((pinchDist - d) * 0.01);
            pinchDist = d;
            return;
        }
        if (!dragging) return;
        const dx = e.clientX - lastX, dy = e.clientY - lastY;
        lastX = e.clientX; lastY = e.clientY;
        velY = dx * 0.005; velX = dy * 0.005;
        applyDrag(velY, velX);
    }
    function onPointerUp(e) {
        pointers.delete(e.pointerId);
        canvas.releasePointerCapture?.(e.pointerId);
        if (pointers.size < 2) pinchDist = 0;
        if (pointers.size === 0) {
            dragging = false;
            // resume auto-spin after a short beat
            setTimeout(() => { userInteracted = false; }, 2500);
        }
    }
    function onWheel(e) { e.preventDefault(); dolly(e.deltaY * 0.0016); userInteracted = true; }

    function twoPointerDist() {
        const p = [...pointers.values()];
        return Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
    }
    function applyDrag(dY, dX) {
        spin.rotation.y += dY;
        tilt.rotation.x = clamp(tilt.rotation.x + dX, -TILT_LIMIT, TILT_LIMIT);
    }
    function dolly(delta) { camDist = clamp(camDist + delta, CAM_MIN, CAM_MAX); }

    function onResize() {
        if (!renderer) return;
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    }

    // ---- Loop --------------------------------------------------------------
    function frame() {
        raf = requestAnimationFrame(frame);
        timer.update(); // THREE.Timer computes the delta here (as the sim loop does)
        const dt = Math.min(timer.getDelta(), 0.05);
        if (!dragging && pointers.size === 0) {
            if (!userInteracted) spin.rotation.y += AUTO_SPIN * dt;
            else { // inertia glide before auto-spin resumes
                if (Math.abs(velY) > 1e-4 || Math.abs(velX) > 1e-4) {
                    applyDrag(velY, velX); velY *= DAMP; velX *= DAMP;
                }
            }
        }
        camera.position.z += (camDist - camera.position.z) * 0.12; // eased dolly
        camera.lookAt(0, 0, 0);
        renderer.render(scene, camera);
    }

    // ---- Public API --------------------------------------------------------
    function show() {
        if (disposed) return;
        root.hidden = false;
        if (!built) build();
        addListeners();
        timer.update(); // seed; the 0.05 clamp caps any first-frame gap anyway
        if (!raf) frame();
    }

    function addListeners() {
        canvas.addEventListener('pointerdown', onPointerDown);
        canvas.addEventListener('pointermove', onPointerMove);
        window.addEventListener('pointerup', onPointerUp);
        canvas.addEventListener('pointercancel', onPointerUp);
        canvas.addEventListener('wheel', onWheel, { passive: false });
        window.addEventListener('resize', onResize);
    }
    function removeListeners() {
        canvas.removeEventListener('pointerdown', onPointerDown);
        canvas.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
        canvas.removeEventListener('pointercancel', onPointerUp);
        canvas.removeEventListener('wheel', onWheel);
        window.removeEventListener('resize', onResize);
    }

    /** Free everything and drop the WebGL context — call before startGame so
        only one context is ever live. Idempotent. */
    function dispose() {
        if (disposed) return;
        disposed = true;
        cancelAnimationFrame(raf); raf = 0;
        removeListeners();
        if (globe) { globe.geometry.dispose(); }
        if (globeMat) globeMat.dispose();
        if (globeTex) globeTex.dispose();
        if (atmo) { atmo.geometry.dispose(); atmo.material.dispose(); }
        if (stars) { stars.geometry.dispose(); stars.material.dispose(); }
        if (renderer) { renderer.dispose(); renderer.forceContextLoss?.(); }
        root.hidden = true;
    }

    return { show, dispose, get spin() { return spin; } };
}

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
