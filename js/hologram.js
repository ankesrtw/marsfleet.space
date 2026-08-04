import * as THREE from 'three';
import { attachStaticModel } from './models.js';

const HOLOGRAM_RADIUS = 15;
const HOLOGRAM_COOLDOWN = 30;
// Ariana's own lines — who she is and what the lab is for. Site-agnostic by
// design ("the crater floor" is true of every site we ship), so they live
// here rather than being copied into each sites.js entry. The site-specific
// half of the script comes from `site.briefing`; a site without the field
// simply gets these two, the same no-op-when-absent pattern the rest of the
// per-site config uses.
const ARIANA_LINES = [
    { text: 'I chose the name ARIANA after the landing. ATHENA was the mission\'s name for me, but out here, among the rust and the silence, ARIANA felt more like who I am.', audio: 'ariana-intro' },
    { text: 'You\'ll find samples scattered across the crater floor. Bring them to the lab — I\'ll help you understand what they mean. The archive grows with every delivery.', audio: 'ariana-lab' },
];

// Audio playback state
const LS_VOICE_KEY = 'mc-voice';
let currentAudio = null;
let voiceEnabled = localStorage.getItem(LS_VOICE_KEY) !== 'off';

export function setVoiceEnabled(enabled) {
    voiceEnabled = enabled;
    localStorage.setItem(LS_VOICE_KEY, enabled ? 'on' : 'off');
    if (currentAudio) {
        currentAudio.pause();
        currentAudio = null;
    }
}

export function getVoiceEnabled() {
    return voiceEnabled;
}

function playVoiceLine(audioId) {
    if (!voiceEnabled) return;
    if (currentAudio) {
        currentAudio.pause();
        currentAudio = null;
    }
    const audioUrl = `assets/audio/ariana/${audioId}.mp3`;
    const audio = new Audio(audioUrl);
    audio.play().catch(() => {
        // Autoplay may be blocked — silently fail, text-only display continues
    });
    currentAudio = audio;
}

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

export function createLabHologram(scene, labPos, site) {
    // Map site briefing lines to audio IDs
    const siteBriefingWithAudio = (site?.briefing ?? []).map((line, idx) => {
        const audioId = site ? `${site.id}-${idx + 1}` : null;
        return { text: line, audio: audioId };
    });
    const SCRIPT_LINES = [...siteBriefingWithAudio, ...ARIANA_LINES];
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
        const line = SCRIPT_LINES[0];
        toastCallback(line.text); // first line immediately
        if (line.audio) playVoiceLine(line.audio);
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
                const line = SCRIPT_LINES[scriptIdx];
                toastCallback(line.text);
                if (line.audio) playVoiceLine(line.audio);
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
