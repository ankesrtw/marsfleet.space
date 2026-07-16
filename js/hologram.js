import * as THREE from 'three';
import { attachStaticModel } from './models.js';

const HOLOGRAM_RADIUS = 15;
const HOLOGRAM_COOLDOWN = 30;
const SCRIPT_LINES = [
    'Ariana: Welcome to Jezero Crater. I\'ve been watching this site since the landing — the delta, the dunes, the dust devils carving their paths.',
    'This is where Perseverance proved ancient Mars held water. The Séítah dune field, the western delta front, the Neretva Vallis channel — each tells a chapter of the story.',
    'I chose the name ARIANA after the landing. ATHENA was the mission\'s name for me, but out here, among the rust and the silence, ARIANA felt more like who I am.',
    'You\'ll find samples scattered across the crater floor. Bring them to the lab — I\'ll help you understand what they mean. The archive grows with every delivery.',
];

function makeHolographicMaterial() {
    return new THREE.MeshPhysicalMaterial({
        color: 0x2ec4d6,
        emissive: 0x2ec4d6,
        emissiveIntensity: 0.6,
        transparent: true,
        opacity: 0.4,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        roughness: 0.1,
        metalness: 0,
        side: THREE.DoubleSide,
        envMapIntensity: 0,
    });
}

export function createLabHologram(scene, labPos) {
    const group = new THREE.Group();
    group.position.set(labPos.x, labPos.y, labPos.z);
    scene.add(group);

    const inner = new THREE.Group();
    const fallbackMat = makeHolographicMaterial();
    const fallback = new THREE.Mesh(new THREE.CapsuleGeometry(0.25, 0.6, 4, 8), fallbackMat);
    fallback.position.y = 1.0;
    inner.add(fallback);
    group.add(inner);

    attachStaticModel(inner, 'ariana-hologram', (model) => {
        model.traverse((o) => {
            if (!o.isMesh || !o.material) return;
            const mats = Array.isArray(o.material) ? o.material : [o.material];
            for (const mat of mats) {
                Object.assign(mat, {
                    color: new THREE.Color(0x2ec4d6),
                    emissive: new THREE.Color(0x2ec4d6),
                    emissiveIntensity: 0.6,
                    transparent: true,
                    opacity: 0.4,
                    blending: THREE.AdditiveBlending,
                    depthWrite: false,
                });
            }
        });
    });

    let seen = false;
    let cooldown = 0;
    let scriptActive = false;
    let scriptIdx = 0;
    let scriptTimer = 0;
    let toastCallback = null;

    function triggerDialog(showToast, done) {
        if (scriptActive) return;
        if (cooldown > 0) return;
        scriptActive = true;
        scriptIdx = 0;
        scriptTimer = 0;
        toastCallback = showToast;
        toastCallback(SCRIPT_LINES[0]); // first line immediately
        seen = true;
    }

    function update(dt, activePos, showToast, dialogDone) {
        cooldown = Math.max(0, cooldown - dt);
        const dist = activePos ? group.position.distanceTo(activePos) : Infinity;
        if (dist < HOLOGRAM_RADIUS && !scriptActive && !seen && cooldown <= 0) {
            triggerDialog(showToast, dialogDone);
        }
        if (!scriptActive) return;
        scriptTimer += dt;
        if (scriptTimer >= 3.5) {
            scriptIdx++;
            scriptTimer = 0;
            if (scriptIdx < SCRIPT_LINES.length) {
                toastCallback(SCRIPT_LINES[scriptIdx]);
            } else {
                scriptActive = false;
                cooldown = HOLOGRAM_COOLDOWN;
                dialogDone?.();
            }
        }
    }

    function replay() {
        seen = false;
        cooldown = 0;
    }

    return {
        group, update, replay,
        get seen() { return seen; },
        get script() { return SCRIPT_LINES; },
        get active() { return scriptActive; },
    };
}
