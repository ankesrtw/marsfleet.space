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

/** Cuts the currently playing line short — the player skipped ahead, or
    the dialog ended, before the audio reached its own 'ended' event. */
function stopVoiceLine() {
    if (currentAudio) {
        currentAudio.pause();
        currentAudio = null;
    }
}

/** Plays a line's audio and reports back when the line is "done talking"
    via onEnded — the caller (hologram dialog) waits for this instead of a
    fixed timer, so text no longer moves on mid-sentence. Returns false
    (and never calls onEnded) when voice is off or the audio fails to
    start at all, so the caller can fall back to a flat timer for those
    cases; a mid-playback error still resolves onEnded so a broken file
    can't stall the dialog forever. */
function playVoiceLine(audioId, onEnded) {
    if (currentAudio) {
        currentAudio.pause();
        currentAudio = null;
    }
    if (!voiceEnabled) return false;
    const audioUrl = `assets/audio/ariana/${audioId}.mp3`;
    const audio = new Audio(audioUrl);
    audio.addEventListener('ended', () => onEnded?.());
    audio.addEventListener('error', () => onEnded?.());
    const playPromise = audio.play();
    if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch(() => onEnded?.()); // autoplay blocked — fall back to timer
    }
    currentAudio = audio;
    return true;
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

// Audio-ID overrides for lines regenerated after the original mp3s went
// stale (the Polly output no longer matched the briefing text they were
// meant to voice — see plan 30 follow-up). `/assets/*` is served
// `immutable, max-age=1yr` (_headers), so a corrected line can't just
// overwrite the old filename: any client or edge PoP that already cached
// the old bytes would keep serving them for up to a year. New content
// ships under a new filename instead, same as every other immutable
// asset in the project. `insight` (Elysium/InSight site) additionally
// never had a matching id at all — its audio shipped as `elysium-*`
// while `site.id` is `insight`, so the old `${site.id}-${idx+1}` lookup
// 404'd silently and that site played no voice.
const AUDIO_ID_OVERRIDES = {
    'gale-1': 'gale-1-v2', 'gale-2': 'gale-2-v2',
    'gusev-1': 'gusev-1-v2', 'gusev-2': 'gusev-2-v2',
    'hellas-1': 'hellas-1-v2', 'hellas-2': 'hellas-2-v2',
    'insight-1': 'insight-1-v2', 'insight-2': 'insight-2-v2',
    'jezero-1': 'jezero-1-v2',
    'meridiani-1': 'meridiani-1-v2', 'meridiani-2': 'meridiani-2-v2',
    'olympus-1': 'olympus-1-v2', 'olympus-2': 'olympus-2-v2',
    'syrtis-1': 'syrtis-1-v2', 'syrtis-2': 'syrtis-2-v2',
};

export function createLabHologram(scene, labPos, site) {
    // Map site briefing lines to audio IDs
    const siteBriefingWithAudio = (site?.briefing ?? []).map((line, idx) => {
        const baseId = site ? `${site.id}-${idx + 1}` : null;
        const audioId = baseId ? (AUDIO_ID_OVERRIDES[baseId] ?? baseId) : null;
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

    // Minimum on-screen time for a line with no audio (or with voice
    // disabled) — the same flat pacing the timer used to apply to every
    // line. Lines WITH audio instead wait for playVoiceLine's onEnded, so
    // the text only advances once Ariana actually finishes speaking.
    const NO_AUDIO_HOLD = 3.5;

    let seen = false;
    let cooldown = 0;
    let scriptActive = false;
    let scriptIdx = 0;
    let scriptTimer = 0;
    let waitingOnAudio = false;
    let lineDone = false;
    let toastCallback = null;
    let dialogDoneCallback = null;

    function showLine(idx) {
        const line = SCRIPT_LINES[idx];
        scriptTimer = 0;
        lineDone = false;
        toastCallback(line.text);
        waitingOnAudio = line.audio
            ? playVoiceLine(line.audio, () => { lineDone = true; })
            : false;
    }

    function triggerDialog(showToast, done) {
        if (scriptActive) return;
        if (cooldown > 0) return;
        scriptActive = true;
        scriptIdx = 0;
        toastCallback = showToast;
        dialogDoneCallback = done;
        showLine(0);
        seen = true;
    }

    /** Player-driven advance — click/key skips the rest of the current
        line's audio and moves straight to the next one, same as the
        player moving away cuts a line short elsewhere in the sim. */
    function advance() {
        if (!scriptActive) return;
        stopVoiceLine();
        lineDone = true;
        waitingOnAudio = false;
    }

    function update(dt, activePos, showToast, dialogDone) {
        cooldown = Math.max(0, cooldown - dt);
        const dist = activePos ? group.position.distanceTo(activePos) : Infinity;
        if (dist < HOLOGRAM_RADIUS && !scriptActive && !seen && cooldown <= 0) {
            triggerDialog(showToast, dialogDone);
        }
        if (!scriptActive) return;
        scriptTimer += dt;
        // Waiting on the current line's audio (playVoiceLine's onEnded
        // flips lineDone) — a flat hold only applies when there's no
        // audio to wait on.
        const ready = waitingOnAudio ? lineDone : scriptTimer >= NO_AUDIO_HOLD;
        if (!ready) return;
        scriptIdx++;
        if (scriptIdx < SCRIPT_LINES.length) {
            showLine(scriptIdx);
        } else {
            scriptActive = false;
            cooldown = HOLOGRAM_COOLDOWN;
            dialogDoneCallback?.();
        }
    }

    function replay() {
        seen = false;
        cooldown = 0;
    }

    return {
        group, update, replay, advance,
        get seen() { return seen; },
        get script() { return SCRIPT_LINES; },
        get active() { return scriptActive; },
    };
}
