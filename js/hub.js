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
import { SITES, LOCKED_SITES } from './sites.js';
import { Save } from './saves.js';

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

// Pins. Playable = bright gold, tappable; locked = dim slate, informational.
const PIN_PLAYABLE = new THREE.Color(0xffcf6a);
const PIN_LOCKED = new THREE.Color(0x8a97a8);
const PIN_LIFT = 1.012;           // dot radius above the globe surface
const DOT_SCALE = 0.06, DOT_SCALE_LOCKED = 0.045;
const DEG2RAD = Math.PI / 180;

export function createHub({ onEnter, onResetGame } = {}) {
    const root = document.getElementById('hub-root');
    const canvas = document.getElementById('hub-canvas');

    let renderer, scene, camera, tilt, spin, globe, globeMat, globeTex, atmo, stars;
    let raf = 0, timer = null, built = false, disposed = false;
    let camDist = CAM_START;

    // Pins.
    const pins = [];                  // { site, dot, label, dir, playable }
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const _wp = new THREE.Vector3();
    const _pp = new THREE.Vector3(), _camDir = new THREE.Vector3();
    let hovered = null, selected = null;
    let focusTarget = null;           // { y, x } eased spin/tilt to face a pin
    let dotTex = null;

    // Drag / inertia state.
    const pointers = new Map();       // id -> {x,y}
    let dragging = false, lastX = 0, lastY = 0, velY = 0, velX = 0;
    let downX = 0, downY = 0, moved = false;   // tap-vs-drag discrimination
    let pinchDist = 0;
    let userInteracted = false;       // pauses auto-spin briefly after a drag

    // Card DOM.
    const card = document.getElementById('hub-card');
    const cardEls = {
        name: document.getElementById('hub-card-name'),
        mission: document.getElementById('hub-card-mission'),
        coords: document.getElementById('hub-card-coords'),
        progress: document.getElementById('hub-card-progress'),
        enter: document.getElementById('hub-card-enter'),
        locked: document.getElementById('hub-card-locked'),
        close: document.getElementById('hub-card-close'),
    };

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

        buildPins();

        timer = new THREE.Timer();
        built = true;
    }

    // ---- Pins --------------------------------------------------------------
    /** lon/lat (deg, east-positive) -> point on the globe, aligned to the
        texture seam: u=0 (left edge) = -180degE maps to -X, +Z faces the
        camera at rest (= lon -90degE, the Tharsis/Valles Marineris face). */
    function lonLatToVec3(lon, lat, radius) {
        const phi = (lon + 180) * DEG2RAD;      // 0..2pi across the texture
        const theta = (90 - lat) * DEG2RAD;     // 0 at north pole (texture top)
        return new THREE.Vector3(
            -radius * Math.cos(phi) * Math.sin(theta),
            radius * Math.cos(theta),
            radius * Math.sin(phi) * Math.sin(theta),
        );
    }

    function buildPins() {
        dotTex = makeDotTexture();
        const entries = [
            ...Object.values(SITES).map((s) => ({ site: s, playable: true })),
            ...LOCKED_SITES.map((s) => ({ site: s, playable: false })),
        ];
        for (const { site, playable } of entries) {
            const dir = lonLatToVec3(site.center.lon, site.center.lat, 1);
            const dot = new THREE.Sprite(new THREE.SpriteMaterial({
                map: dotTex, color: playable ? PIN_PLAYABLE : PIN_LOCKED,
                transparent: true, depthWrite: false, depthTest: true,
                sizeAttenuation: true,
            }));
            dot.position.copy(dir).multiplyScalar(PIN_LIFT);
            const base = playable ? DOT_SCALE : DOT_SCALE_LOCKED;
            dot.scale.setScalar(base);
            dot.renderOrder = 3;

            const label = makeLabel(site, playable);
            label.position.copy(dir).multiplyScalar(PIN_LIFT + 0.02).add(new THREE.Vector3(0, 0.09, 0));
            label.renderOrder = 4;

            spin.add(dot, label);
            pins.push({ site, dot, label, dir: dir.clone(), playable, baseScale: base });
        }
    }

    /** Soft radial dot, tinted per-pin via the sprite material color. */
    function makeDotTexture() {
        const c = document.createElement('canvas');
        c.width = c.height = 64;
        const ctx = c.getContext('2d');
        const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 30);
        g.addColorStop(0, 'rgba(255,255,255,1)');
        g.addColorStop(0.35, 'rgba(255,255,255,0.95)');
        g.addColorStop(0.7, 'rgba(255,255,255,0.35)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, 64, 64);
        const t = new THREE.CanvasTexture(c);
        t.colorSpace = THREE.SRGBColorSpace;
        return t;
    }

    /** Two-line billboard label: site name + a progress badge (playable) or
        "COMING SOON" (locked). Badge read once from Save(id) at build. */
    function makeLabel(site, playable) {
        const badge = playable ? progressBadge(site) : 'COMING SOON';
        const W = 512, H = 160;
        const c = document.createElement('canvas');
        c.width = W; c.height = H;
        const ctx = c.getContext('2d');
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        // name
        ctx.font = '600 46px system-ui, sans-serif';
        ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(0,0,0,0.75)';
        ctx.strokeText(site.name, W / 2, 52);
        ctx.fillStyle = playable ? '#fff2e0' : '#b9c2cf';
        ctx.fillText(site.name, W / 2, 52);
        // badge
        ctx.font = '600 34px "SF Mono", ui-monospace, Menlo, monospace';
        ctx.lineWidth = 5;
        ctx.strokeText(badge, W / 2, H - 44);
        ctx.fillStyle = playable ? '#ffcf6a' : '#8a97a8';
        ctx.fillText(badge, W / 2, H - 44);

        const tex = new THREE.CanvasTexture(c);
        tex.colorSpace = THREE.SRGBColorSpace;
        const spr = new THREE.Sprite(new THREE.SpriteMaterial({
            map: tex, transparent: true, depthWrite: false, depthTest: true,
        }));
        spr.scale.set(0.5, 0.5 * H / W, 1);
        spr.userData.tex = tex;
        return spr;
    }

    /** Compact progress read from the per-site save: samples analysed / total
        + missions done. "NEW" when the site has never been touched. */
    function progressBadge(site) {
        const save = Save(site.id);
        const results = save.get('results', []);
        const analysed = Array.isArray(results) ? results.length : 0;
        const total = site.samples?.length ?? 0;
        const missions = site.missions ?? [];
        const done = missions.filter((m) => save.get(`mission-${m}-done`)).length;
        const touched = analysed > 0 || done > 0 || save.get('intro-seen');
        if (!touched) return 'NEW';
        return `${analysed}/${total} SAMPLES · ${done}/${missions.length} MISSIONS`;
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
        // Capture can throw (e.g. a synthetic event with no live pointer);
        // must never abort the handler — the pointer still needs registering.
        try { canvas.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pointers.size === 1) {
            dragging = true; userInteracted = true;
            lastX = downX = e.clientX; lastY = downY = e.clientY; velY = velX = 0;
            moved = false;
        } else if (pointers.size === 2) {
            dragging = false;
            pinchDist = twoPointerDist();
        }
    }
    function onPointerMove(e) {
        if (!pointers.has(e.pointerId)) {
            if (pointers.size === 0) hoverAt(e.clientX, e.clientY); // desktop hover
            return;
        }
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
        if (Math.hypot(e.clientX - downX, e.clientY - downY) > 6) {
            moved = true; focusTarget = null;   // a real drag cancels pin-focus
        }
        velY = dx * 0.005; velX = dy * 0.005;
        applyDrag(velY, velX);
    }
    function onPointerUp(e) {
        const wasSingle = pointers.size === 1;
        pointers.delete(e.pointerId);
        try { canvas.releasePointerCapture(e.pointerId); } catch { /* not captured */ }
        if (pointers.size < 2) pinchDist = 0;
        if (pointers.size === 0) {
            dragging = false;
            // A tap (negligible travel) picks the pin under it.
            if (wasSingle && !moved) pickAt(e.clientX, e.clientY);
            // resume auto-spin after a short beat (unless a card holds focus)
            setTimeout(() => { if (!selected) userInteracted = false; }, 2500);
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

    // ---- Pin picking -------------------------------------------------------
    /** Nearest FRONT-facing pin under (clientX,clientY), or null. Sprites
        ignore depth, so a back-hemisphere pin (its billboard drawn over the
        globe disc) would still raycast-hit — reject those with the analytic
        horizon test: a point on the unit globe is visible from a camera at
        distance D iff dir·cameraDir > 1/D (the tangent-cone cutoff). Robust
        right to the limb, unlike comparing against the globe intersection. */
    function pinUnder(clientX, clientY) {
        const r = canvas.getBoundingClientRect();
        ndc.set(((clientX - r.left) / r.width) * 2 - 1,
            -((clientY - r.top) / r.height) * 2 + 1);
        raycaster.setFromCamera(ndc, camera);
        let best = null, bestDist = Infinity;
        for (const p of pins) {
            const hit = raycaster.intersectObject(p.dot, false)[0];
            if (!hit || hit.distance >= bestDist) continue;
            if (!isFront(p.dot.getWorldPosition(_pp))) continue; // behind the horizon
            best = p; bestDist = hit.distance;
        }
        return best;
    }

    /** True iff a world point on/just above the globe is on the camera-facing
        cap: dir·cameraDir > R/D (the tangent-cone cutoff), computed without a
        per-call normalize. One source of truth for pick + label visibility. */
    function isFront(v) {
        _camDir.copy(camera.position).normalize();
        const horizon = 1 / Math.max(camera.position.length(), 1.0001);
        const len = v.length() || 1;
        return (v.x * _camDir.x + v.y * _camDir.y + v.z * _camDir.z) / len > horizon;
    }

    function hoverAt(clientX, clientY) {
        const p = pinUnder(clientX, clientY);
        if (p === hovered) return;
        hovered = p;
        canvas.style.cursor = p ? 'pointer' : 'grab';
    }

    function pickAt(clientX, clientY) {
        const p = pinUnder(clientX, clientY);
        if (p) openCard(p);
    }

    // ---- Card --------------------------------------------------------------
    function openCard(p) {
        selected = p;
        userInteracted = true;                 // hold the globe while choosing
        focusTarget = faceTargetFor(p.dir);     // ease the pin to front-center
        const s = p.site;
        cardEls.name.textContent = s.name;
        cardEls.mission.textContent = s.mission;
        cardEls.coords.textContent = coordText(s.center);
        if (p.playable) {
            const badge = progressBadge(s);
            cardEls.progress.textContent = badge;
            cardEls.progress.hidden = false;
            cardEls.enter.hidden = false;
            cardEls.enter.textContent = badge === 'NEW' ? 'ENTER' : 'CONTINUE';
            cardEls.locked.hidden = true;
        } else {
            cardEls.progress.hidden = true;
            cardEls.enter.hidden = true;
            cardEls.locked.hidden = false;
            cardEls.locked.textContent = 'COMING SOON — this site isn’t surveyed yet.';
        }
        card.hidden = false;
        card.dataset.locked = p.playable ? 'false' : 'true';
    }

    function closeCard() {
        card.hidden = true;
        selected = null;
        focusTarget = null;
        setTimeout(() => { if (!selected) userInteracted = false; }, 400);
    }

    /** Real-coordinate readout, e.g. "18.46°N  77.42°E". */
    function coordText(c) {
        const ns = c.lat >= 0 ? 'N' : 'S', ew = c.lon >= 0 ? 'E' : 'W';
        return `${Math.abs(c.lat).toFixed(2)}°${ns}  ${Math.abs(c.lon).toFixed(2)}°${ew}`;
    }

    /** spin.y + tilt.x that bring a pin's local direction to face the camera
        (+Z), so a selected pin rotates to front-center. */
    function faceTargetFor(dir) {
        const y = Math.atan2(-dir.x, dir.z);              // longitude to +Z
        const x = clamp(Math.asin(clamp(dir.y, -1, 1)), -TILT_LIMIT, TILT_LIMIT);
        return { y, x };
    }

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
        if (focusTarget && !dragging) {
            // Ease the selected pin to front-center and hold it there.
            spin.rotation.y += shortAngle(spin.rotation.y, focusTarget.y) * 0.12;
            tilt.rotation.x += (focusTarget.x - tilt.rotation.x) * 0.12;
        } else if (!dragging && pointers.size === 0) {
            if (!userInteracted) spin.rotation.y += AUTO_SPIN * dt;
            else { // inertia glide before auto-spin resumes
                if (Math.abs(velY) > 1e-4 || Math.abs(velX) > 1e-4) {
                    applyDrag(velY, velX); velY *= DAMP; velX *= DAMP;
                }
            }
        }
        updatePins();
        camera.position.z += (camDist - camera.position.z) * 0.12; // eased dolly
        camera.lookAt(0, 0, 0);
        renderer.render(scene, camera);
    }

    /** Per-frame pin dressing: hide labels + fade dots on the far hemisphere
        (globe occludes them), and ease hovered/selected pins larger. */
    function updatePins() {
        for (const p of pins) {
            const front = isFront(p.dot.getWorldPosition(_wp));
            p.label.visible = front;
            p.dot.material.opacity = front ? 1 : 0.28;
            const big = front && p.playable && (p === hovered || p === selected);
            const target = p.baseScale * (big ? 1.4 : 1);
            p.dot.scale.setScalar(p.dot.scale.x + (target - p.dot.scale.x) * 0.2);
        }
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
        cardEls.close.addEventListener('click', closeCard);
        cardEls.enter.addEventListener('click', enterSelected);
    }
    function removeListeners() {
        canvas.removeEventListener('pointerdown', onPointerDown);
        canvas.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
        canvas.removeEventListener('pointercancel', onPointerUp);
        canvas.removeEventListener('wheel', onWheel);
        window.removeEventListener('resize', onResize);
        cardEls.close.removeEventListener('click', closeCard);
        cardEls.enter.removeEventListener('click', enterSelected);
    }

    /** ENTER/CONTINUE: hand off to the sim. Step 4 wraps this in a camera
        fly-in; for now it tears down the hub (freeing the WebGL context) and
        boots the site — so only one context is ever live. */
    function enterSelected() {
        if (!selected || !selected.playable) return;
        const site = selected.site;
        dispose();
        onEnter?.(site);
    }

    /** Free everything and drop the WebGL context — call before startGame so
        only one context is ever live. Idempotent. */
    function dispose() {
        if (disposed) return;
        disposed = true;
        cancelAnimationFrame(raf); raf = 0;
        removeListeners();
        if (card) card.hidden = true;
        for (const p of pins) {
            p.dot.material.dispose();
            p.label.material.dispose();
            p.label.userData.tex?.dispose();
        }
        pins.length = 0;
        if (dotTex) dotTex.dispose();
        if (globe) { globe.geometry.dispose(); }
        if (globeMat) globeMat.dispose();
        if (globeTex) globeTex.dispose();
        if (atmo) { atmo.geometry.dispose(); atmo.material.dispose(); }
        if (stars) { stars.geometry.dispose(); stars.material.dispose(); }
        if (renderer) { renderer.dispose(); renderer.forceContextLoss?.(); }
        root.hidden = true;
    }

    return {
        show, dispose,
        get spin() { return spin; },
        // --- E2E/debug hooks (verify skill), mirroring main.js's __mc ---
        get pins() { return pins.map((p) => ({ id: p.site.id, playable: p.playable })); },
        get selectedId() { return selected?.site.id ?? null; },
        /** Screen-space CSS pixel of a pin's dot + whether it faces the camera. */
        _screen(id) {
            const p = pins.find((x) => x.site.id === id);
            if (!p) return null;
            p.dot.getWorldPosition(_wp);
            const front = isFront(_wp);
            const v = _wp.clone().project(camera);
            const r = canvas.getBoundingClientRect();
            return { x: r.left + (v.x * 0.5 + 0.5) * r.width, y: r.top + (-v.y * 0.5 + 0.5) * r.height, front };
        },
        _openCard(id) { const p = pins.find((x) => x.site.id === id); if (p) openCard(p); },
        _pinUnder(x, y) { return pinUnder(x, y)?.site.id ?? null; },
    };
}

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

/** Signed shortest angular difference (to - from), wrapped to [-pi, pi]. */
function shortAngle(from, to) {
    let d = (to - from) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return d;
}
