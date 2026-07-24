/* ============================================================
   music.js — the Ongak soundtrack engine (plan 27; plan 28 made
   Mars Sim's playlist its own).

   Asset-free procedural instrumentals, same discipline as sound.js:
   nothing to download, nothing that can 404, works offline inside
   the Android APK. Each "track" is a preset — key, tempo, chord
   progression and which layers play — rendered live by a step
   sequencer. Eleven ship today across synthwave, ambient, industrial,
   percussive and downtempo; the marsapiens/SIGNAL R2 album is NOT
   pulled in — that queue belongs to the standalone music app.

   Two things here are deliberate and easy to get wrong:

   - SCHEDULING IS ON THE AUDIO CLOCK, NOT THE FRAME LOOP. A 25ms
     timer looks 200ms ahead and queues notes at absolute WebAudio
     times. Driving a sequencer from rAF makes the music stutter on
     every frame hitch and stop dead when the tab throttles.

   - MUSIC HAS ITS OWN BUS. It shares sound.js's AudioContext (one
     autoplay unlock, one hardware voice) but connects straight to
     destination, NOT through sound.js's `master` — otherwise the
     SFX toggle would silence the soundtrack with it.

   Drop-in tracks: assets/music/manifest.json may list entries whose
   `src` is either `synth:<preset>` (rendered here) or a filename
   (streamed through the same bus via an <audio> element). A missing
   or malformed manifest silently falls back to the built-in presets,
   so real AI-generated tracks can be added later as a data edit with
   no code change — and their absence can never break playback.
   ============================================================ */

const LS_TRACK = 'mc-music-track';
const LS_VOL = 'mc-music-vol';
const LS_ON = 'mc-music-on';

const MANIFEST_URL = 'assets/music/manifest.json';
// Plan 28: the game no longer pulls the marsapiens/SIGNAL R2 album. Mars Sim
// keeps its OWN playlist — every track here is rendered in the browser, so
// the soundtrack works offline in the APK, adds no bytes to the download, and
// cannot be silenced by a CDN. Drop-in files still work via manifest.json.
const TICK_MS = 25;        // scheduler wake-up
// Notes queued ahead of the audio clock. This must exceed the WORST gap
// between timer wake-ups, not the nominal 25ms: under load (a 2-core box at
// 5fps, a mid-range phone) setInterval is starved for hundreds of ms, and a
// 0.2s horizon then queued exactly one step per wake-up — audibly sparse,
// measured 2 steps in 2s. 0.7s rides out that starvation; the cost is only
// that a track change takes up to 0.7s of already-queued audio to take hold.
const LOOKAHEAD = 0.7;
const STEPS_PER_BAR = 16;  // 16th notes, 4/4

// Scale degrees in semitones. Minor for the workhorse tracks, Phrygian
// for menace (that ♭2 is the whole character), Dorian for the hopeful
// one (the natural 6 lifts an otherwise minor progression).
//
// Plan 28 adds four more, each carrying a mood the first three cannot:
// harmonic minor's ♯7 gives a leading tone that pulls (drama without
// dissonance), Phrygian dominant is that same ♯3 over the ♭2 (the
// "desert" mode), Lydian's ♯4 is the only genuinely bright scale here,
// and the minor pentatonic simply has no semitone clashes — which is
// what lets the percussive track hammer without turning to mud.
const SCALES = {
    minor: [0, 2, 3, 5, 7, 8, 10],
    phrygian: [0, 1, 3, 5, 7, 8, 10],
    dorian: [0, 2, 3, 5, 7, 9, 10],
    harmonicMinor: [0, 2, 3, 5, 7, 8, 11],
    phrygianDom: [0, 1, 4, 5, 7, 8, 10],
    lydian: [0, 2, 4, 6, 7, 9, 11],
    pentatonic: [0, 3, 5, 7, 10],
};

/* Presets. `prog` is scale degrees (0 = tonic), one chord per bar.
   Layer flags pick the arrangement; `cutoff` sets the arp filter's
   sweep floor/ceiling so the tracks don't all share one timbre. */
const PRESETS = {
    // Ambient bed — no drums at all. The default: it has to survive
    // hours of driving without wearing a hole in the player's patience.
    vigil: {
        rootMidi: 45, bpm: 68, scale: 'minor', prog: [0, 5, 3, 4],
        pad: 0.075, bass: 0.05, arp: 0.028, drums: 0,
        arpPattern: [0, 2, 4, 2], arpEvery: 4,
        cutoff: [380, 1500], padType: 'sawtooth',
    },
    drift: {
        rootMidi: 45, bpm: 92, scale: 'minor', prog: [0, 5, 2, 6],
        pad: 0.06, bass: 0.075, arp: 0.045, drums: 0.5,
        arpPattern: [0, 2, 4, 6, 4, 2], arpEvery: 2,
        cutoff: [500, 2400], padType: 'sawtooth',
    },
    olympus: {
        rootMidi: 43, bpm: 108, scale: 'minor', prog: [0, 6, 5, 4],
        pad: 0.045, bass: 0.085, arp: 0.055, drums: 0.75,
        arpPattern: [0, 4, 2, 7, 4, 2], arpEvery: 1,
        cutoff: [600, 3000], padType: 'sawtooth', octaveBass: true,
    },
    lost: {
        rootMidi: 41, bpm: 76, scale: 'phrygian', prog: [0, 1, 0, 6],
        pad: 0.08, bass: 0.07, arp: 0.03, drums: 0.4,
        arpPattern: [0, 1, 4, 1], arpEvery: 4, halfTime: true,
        cutoff: [300, 1200], padType: 'square',
    },
    vector: {
        rootMidi: 47, bpm: 96, scale: 'dorian', prog: [0, 3, 5, 4],
        pad: 0.065, bass: 0.07, arp: 0.05, drums: 0.55,
        arpPattern: [0, 2, 4, 5, 4, 2], arpEvery: 2,
        cutoff: [550, 2600], padType: 'sawtooth',
    },

    /* ---- plan 28: six more, using the three new layer controls ----
       `lead` is a slow triangle melody an octave over the arp — it is what
       makes a track feel WRITTEN rather than generated, because the ear
       follows a tune and ignores a texture. `swing` pushes the offbeat
       16ths late (0.18 ≈ a lazy shuffle). `drumStyle` picks the kit
       pattern; without it every drummed track was the same four-on-the-
       floor and they all blurred together. */

    // Warm dorian with an actual tune over it — the "good sol" track.
    perihelion: {
        rootMidi: 46, bpm: 88, scale: 'dorian', prog: [0, 4, 5, 3],
        pad: 0.055, bass: 0.065, arp: 0.032, drums: 0.45, drumStyle: 'break',
        arpPattern: [0, 2, 4, 2], arpEvery: 4, swing: 0.16,
        lead: 0.05, leadPattern: [4, 2, 0, 2, 4, 6, 4, 2], leadEvery: 8,
        cutoff: [520, 2200], padType: 'sawtooth',
    },
    // Harmonic minor + a hammering 16th arp: the mine/industry track.
    ferric: {
        rootMidi: 41, bpm: 112, scale: 'harmonicMinor', prog: [0, 0, 5, 4],
        pad: 0.04, bass: 0.09, arp: 0.05, drums: 0.8, drumStyle: 'break',
        arpPattern: [0, 0, 4, 0, 6, 0, 4, 2], arpEvery: 1,
        cutoff: [700, 3400], padType: 'square', octaveBass: true,
    },
    // The only bright scale in the set. No drums, no arp — pad and a long
    // lead line. Sunrise over the crater rim.
    aphelion: {
        rootMidi: 48, bpm: 60, scale: 'lydian', prog: [0, 3, 4, 3],
        pad: 0.08, bass: 0.045, arp: 0, drums: 0,
        arpPattern: [0], arpEvery: 4,
        lead: 0.042, leadPattern: [0, 4, 2, 6], leadEvery: 16,
        cutoff: [400, 1600], padType: 'sawtooth',
    },
    // Pentatonic, tom-led, almost no pad — drums carry it. Convoy music.
    regolith: {
        rootMidi: 43, bpm: 100, scale: 'pentatonic', prog: [0, 0, 3, 2],
        pad: 0.03, bass: 0.085, arp: 0.038, drums: 0.7, drumStyle: 'tribal',
        arpPattern: [0, 2, 3, 2, 4, 2], arpEvery: 2,
        cutoff: [600, 2800], padType: 'square',
    },
    // Half-time, heavily swung, low and slow — the night-shift track.
    nightshift: {
        rootMidi: 40, bpm: 74, scale: 'minor', prog: [0, 5, 3, 4],
        pad: 0.075, bass: 0.08, arp: 0.026, drums: 0.5, halfTime: true,
        arpPattern: [0, 4, 2, 4], arpEvery: 4, swing: 0.22,
        lead: 0.038, leadPattern: [2, 0, 4, 0], leadEvery: 16,
        cutoff: [280, 1400], padType: 'sawtooth',
    },
    // Phrygian dominant at 124 — the fastest thing here, for the long haul.
    terminator: {
        rootMidi: 45, bpm: 124, scale: 'phrygianDom', prog: [0, 1, 0, 6],
        pad: 0.04, bass: 0.08, arp: 0.055, drums: 0.75,
        arpPattern: [0, 4, 6, 4, 2, 4], arpEvery: 1,
        cutoff: [650, 3200], padType: 'sawtooth', octaveBass: true,
    },
};

const BUILTIN = [
    { id: 'dust-vigil', title: 'Dust Vigil', mood: 'AMBIENT', src: 'synth:vigil' },
    { id: 'red-drift', title: 'Red Drift', mood: 'SYNTHWAVE', src: 'synth:drift' },
    { id: 'olympus-line', title: 'Olympus Line', mood: 'DRIVING', src: 'synth:olympus' },
    { id: 'signal-lost', title: 'Signal Lost', mood: 'TENSION', src: 'synth:lost' },
    { id: 'return-vector', title: 'Return Vector', mood: 'HOPEFUL', src: 'synth:vector' },
    { id: 'perihelion', title: 'Perihelion', mood: 'WARM', src: 'synth:perihelion' },
    { id: 'ferric', title: 'Ferric', mood: 'INDUSTRIAL', src: 'synth:ferric' },
    { id: 'aphelion', title: 'Aphelion', mood: 'BRIGHT', src: 'synth:aphelion' },
    { id: 'regolith', title: 'Regolith Run', mood: 'PERCUSSIVE', src: 'synth:regolith' },
    { id: 'nightshift', title: 'Night Shift', mood: 'DOWNTEMPO', src: 'synth:nightshift' },
    { id: 'terminator', title: 'Terminator Line', mood: 'DRIVING', src: 'synth:terminator' },
];

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

/** Scale degree -> MIDI, wrapping octaves above the 7th degree. */
function degreeMidi(root, scaleName, degree) {
    const scale = SCALES[scaleName] ?? SCALES.minor;
    const oct = Math.floor(degree / scale.length);
    return root + scale[((degree % scale.length) + scale.length) % scale.length] + 12 * oct;
}

export function createMusic(sound) {
    let ctx = null;
    let bus = null;        // music master gain -> analyser -> (panner) -> destination
    let pump = null;       // sidechain duck for pad+bass
    let analyser = null;
    let out = null;        // the node A2's PannerNode splices in front of
    let noiseBuf = null;
    let levelBins = null;  // reused per-frame analyser scratch

    let tracks = BUILTIN.slice();
    let index = 0;
    let playing = false;
    let vol = 0.5;
    const listeners = [];

    // sequencer state
    let timer = null;
    let nextTime = 0;
    let step = 0;
    let bar = 0;
    let lastKick = 0;
    let clockT0 = 0;       // audio time of beat 0 of the current playback
    let scheduled = 0;     // E2E probe: total sequencer steps queued
    let fileEl = null;     // <audio> for manifest tracks that are real files
    let fileNode = null;   // MediaElementSource (one per element, never rebuilt)
    let fileUrl = null;    // URL last requested on that element

    try {
        const savedVol = parseFloat(localStorage.getItem(LS_VOL));
        if (Number.isFinite(savedVol)) vol = Math.min(1, Math.max(0, savedVol));
        const savedTrack = localStorage.getItem(LS_TRACK);
        if (savedTrack) {
            const i = tracks.findIndex((t) => t.id === savedTrack);
            if (i >= 0) index = i;
        }
    } catch { /* private mode — defaults are fine */ }
    let wantPlaying = false;
    try { wantPlaying = localStorage.getItem(LS_ON) === '1'; } catch { /* ignore */ }

    function notify() {
        for (const cb of listeners) { try { cb(); } catch { /* a bad subscriber must not stall the rest */ } }
    }

    function save(key, value) {
        try { localStorage.setItem(key, value); } catch { /* private mode */ }
    }

    // ---- graph -------------------------------------------------------
    sound.onReady((audioCtx) => {
        ctx = audioCtx;
        bus = ctx.createGain();
        bus.gain.value = vol;
        analyser = ctx.createAnalyser();
        analyser.fftSize = 64;
        analyser.smoothingTimeConstant = 0.75;
        pump = ctx.createGain();
        pump.gain.value = 1;
        pump.connect(bus);
        bus.connect(analyser);
        // A2 splices a PannerNode here via setOutput(); until then the
        // soundtrack is plain stereo.
        out = ctx.destination;
        analyser.connect(out);

        const len = Math.floor(ctx.sampleRate * 0.5);
        noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
        const data = noiseBuf.getChannelData(0);
        for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

        if (wantPlaying) play();
        notify();
    });

    loadTracks();

    /** Assemble the playlist from the local manifest alone (plan 28 — the
        marsapiens R2 album is gone; this game has its own soundtrack). The
        built-in presets are the floor, so the playlist can never be empty
        and never depends on the network. */
    async function loadTracks() {
        const list = await loadManifest();
        if (!list.length) return;
        const activeId = tracks[index]?.id;
        tracks = list;
        const again = tracks.findIndex((t) => t.id === activeId);
        index = again >= 0 ? again : 0;
        notify();
    }

    /** Local drop-in manifest. Anything malformed is ignored wholesale. */
    async function loadManifest() {
        try {
            const res = await fetch(MANIFEST_URL, { cache: 'no-cache' });
            if (!res.ok) return BUILTIN.slice();
            const list = await res.json();
            if (!Array.isArray(list)) return BUILTIN.slice();
            const clean = list.filter((t) => t && typeof t.id === 'string'
                && typeof t.title === 'string' && typeof t.src === 'string')
                .map((t) => ({ mood: 'TRACK', ...t }));
            return clean.length ? clean : BUILTIN.slice();
        } catch { return BUILTIN.slice(); }
    }

    // ---- voices ------------------------------------------------------
    /** One enveloped oscillator. `atk` shapes everything from a plucked
        arp (1ms) to a pad swell (1.2s); the tail is always exponential
        because a linear fade to zero clicks. */
    function voice(type, freq, t, dur, peak, dest, { atk = 0.006, detune = 0 } = {}) {
        const o = ctx.createOscillator();
        o.type = type;
        o.frequency.value = freq;
        o.detune.value = detune;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(peak, t + atk);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(g).connect(dest);
        o.start(t);
        o.stop(t + dur + 0.03);
    }

    function noise(t, dur, peak, filterType, freq, q = 1) {
        const src = ctx.createBufferSource();
        src.buffer = noiseBuf;
        const f = ctx.createBiquadFilter();
        f.type = filterType;
        f.frequency.value = freq;
        f.Q.value = q;
        const g = ctx.createGain();
        g.gain.setValueAtTime(peak, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        src.connect(f).connect(g).connect(bus);
        src.start(t);
        src.stop(t + dur + 0.02);
    }

    function kick(t, level) {
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.setValueAtTime(120, t);
        o.frequency.exponentialRampToValueAtTime(42, t + 0.09);
        const g = ctx.createGain();
        g.gain.setValueAtTime(level, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
        o.connect(g).connect(bus);
        o.start(t);
        o.stop(t + 0.3);
        // Sidechain: duck the harmonic layers and let them breathe back.
        // This pump IS the synthwave signature — without it the pad and
        // bass just smear over the kick.
        pump.gain.setValueAtTime(0.4, t);
        pump.gain.linearRampToValueAtTime(1, t + 0.18);
        lastKick = t;
    }

    /** Plan 28: pitched tom for the tribal kit. Same shape as the kick but
        higher, shorter and with NO sidechain duck — toms that pump the pad
        turn a groove into a stutter. */
    function tom(t, freq, level) {
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.setValueAtTime(freq, t);
        o.frequency.exponentialRampToValueAtTime(freq * 0.55, t + 0.14);
        const g = ctx.createGain();
        g.gain.setValueAtTime(level, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
        o.connect(g).connect(bus);
        o.start(t);
        o.stop(t + 0.24);
    }

    // ---- sequencer ---------------------------------------------------
    function preset() {
        const src = tracks[index]?.src ?? '';
        return PRESETS[src.startsWith('synth:') ? src.slice(6) : ''] ?? null;
    }

    const bpmOf = () => preset()?.bpm ?? 96;

    function scheduleStep(p, s, t) {
        const chordDeg = p.prog[bar % p.prog.length];
        const secPerBeat = 60 / p.bpm;

        // pad: one triad per bar, long swell through the pump
        if (s === 0 && p.pad) {
            const dur = secPerBeat * 4.4;
            for (const add of [0, 2, 4]) {
                const m = degreeMidi(p.rootMidi + 12, p.scale, chordDeg + add);
                voice(p.padType, mtof(m), t, dur, p.pad, pump, { atk: 1.1, detune: -6 });
                voice(p.padType, mtof(m), t, dur, p.pad, pump, { atk: 1.1, detune: +7 });
            }
        }

        // bass: on the beat (half-time tracks take every other one)
        const bassStep = p.halfTime ? 8 : 4;
        if (s % bassStep === 0 && p.bass) {
            const oct = p.octaveBass && (s / bassStep) % 2 === 1 ? 12 : 0;
            const m = degreeMidi(p.rootMidi - 12, p.scale, chordDeg) + oct;
            voice('sawtooth', mtof(m), t, secPerBeat * (p.halfTime ? 1.6 : 0.85),
                p.bass, pump, { atk: 0.012 });
        }

        // arp: chord tones climbing, filter sweeping over an 8-bar cycle
        if (p.arp && s % p.arpEvery === 0) {
            const n = p.arpPattern[(s / p.arpEvery) % p.arpPattern.length];
            const m = degreeMidi(p.rootMidi + 24, p.scale, chordDeg + n);
            const f = ctx.createBiquadFilter();
            f.type = 'lowpass';
            const [lo, hi] = p.cutoff;
            const sweep = (Math.sin((bar / 8) * Math.PI * 2) + 1) / 2;
            f.frequency.value = lo + (hi - lo) * sweep;
            f.Q.value = 6;
            f.connect(pump);
            voice('square', mtof(m), t, secPerBeat * 0.42, p.arp, f, { atk: 0.004 });
        }

        // lead: a slow melody over the chord, an octave above the pad.
        // Triangle (not saw) so it sings through the arp without fighting
        // it for the same brightness.
        if (p.lead && s % p.leadEvery === 0) {
            const n = p.leadPattern[
                (bar * (STEPS_PER_BAR / p.leadEvery) + s / p.leadEvery) % p.leadPattern.length];
            const m = degreeMidi(p.rootMidi + 12, p.scale, chordDeg + n);
            voice('triangle', mtof(m), t, secPerBeat * (p.leadEvery / 4) * 0.9,
                p.lead, pump, { atk: 0.09, detune: 4 });
        }

        // drums — one of three kits. Same `p.drums` level scales all of them.
        if (p.drums) {
            const d = p.drums;
            if (p.drumStyle === 'break') {
                // syncopated: the second kick lands a 16th LATE of beat 3,
                // which is the whole reason a breakbeat pulls the ear
                if (s === 0 || s === 6 || s === 10) kick(t, 0.5 * d);
                if (s === 4 || s === 12) noise(t, 0.16, 0.17 * d, 'bandpass', 1900, 0.8);
                if (s % 2 === 1) noise(t, 0.03, 0.04 * d, 'highpass', 8000);
            } else if (p.drumStyle === 'tribal') {
                if (s === 0 || s === 8) kick(t, 0.5 * d);
                // toms answer the kick; three pitches so it reads as a
                // hand-drum figure rather than one repeated hit
                if (s === 3) tom(t, 210, 0.22 * d);
                if (s === 6) tom(t, 160, 0.2 * d);
                if (s === 11) tom(t, 260, 0.18 * d);
                if (s === 14) tom(t, 190, 0.2 * d);
                if (s % 2 === 0) noise(t, 0.025, 0.035 * d, 'highpass', 9000);
            } else {
                if (s % (p.halfTime ? 8 : 4) === 0) kick(t, 0.5 * d);
                if (s % 8 === 4) noise(t, 0.16, 0.16 * d, 'bandpass', 1900, 0.8);
                if (s % 2 === 0 && !p.halfTime) noise(t, 0.035, 0.05 * d, 'highpass', 7500);
            }
        }
    }

    /** Plan 28: re-peg the beat clock to the step about to be queued. The
        clock is what Gratbot dances to, and it is derived (not counted) so a
        dropped frame can never make the dance drift away from the music. */
    function anchorClock(p) {
        clockT0 = nextTime - (bar * STEPS_PER_BAR + step) / 4 * (60 / p.bpm);
    }

    function scheduler() {
        const p = preset();
        if (!ctx || !p || !playing) return;
        const secPerStep = 60 / p.bpm / 4;
        while (nextTime < ctx.currentTime + LOOKAHEAD) {
            // A tab that slept wakes with nextTime far in the past; catching
            // up note-by-note would dump hundreds of oscillators at once.
            // Threshold sits above LOOKAHEAD so ordinary starvation is
            // absorbed by the horizon rather than resetting the phase.
            if (nextTime < ctx.currentTime - 1.2) {
                nextTime = ctx.currentTime + 0.02;
                anchorClock(p);   // the phase jumped — so must the beat clock
            }
            // Swing: push the offbeat 16ths late. Applied to the note TIME
            // only, never to nextTime — swinging the grid itself would drag
            // the whole track flat, one step at a time.
            const swing = p.swing && step % 2 === 1 ? p.swing * secPerStep : 0;
            scheduleStep(p, step, nextTime + swing);
            scheduled++;
            nextTime += secPerStep;
            step++;
            if (step >= STEPS_PER_BAR) { step = 0; bar++; }
        }
    }

    // ---- file tracks -------------------------------------------------
    /** Manifest entries that name a real file stream through an <audio>
        element into the same bus. MediaElementSource can only be created
        once per element, so the element is reused and only `src` changes. */
    function ensureFileEl() {
        if (fileEl) return fileEl;
        fileEl = new Audio();
        fileEl.loop = true;
        fileEl.preload = 'none';
        // Required for MediaElementSource: without it the R2 stream taints
        // the graph and the bus outputs silence rather than erroring.
        fileEl.crossOrigin = 'anonymous';
        // A stream that cannot load (offline, R2 down, bad manifest path)
        // must not read as "the music is broken" — drop to the first synth
        // preset, which is always renderable.
        fileEl.addEventListener('error', fallbackToSynth);
        if (ctx) {
            try {
                fileNode = ctx.createMediaElementSource(fileEl);
                fileNode.connect(bus);
            } catch { fileNode = null; /* fall through: element plays un-bussed */ }
        }
        return fileEl;
    }

    function fallbackToSynth() {
        if (!playing) return;
        const i = tracks.findIndex((t) => t.src.startsWith('synth:'));
        if (i < 0 || i === index) return;
        index = i;
        stopAll();
        startCurrent();
        notify();
    }

    function stopFile() {
        if (fileEl) { fileEl.pause(); }
    }

    function startCurrent() {
        const t = tracks[index];
        if (!ctx || !t) return;
        if (t.src.startsWith('synth:')) {
            stopFile();
            step = 0;
            bar = 0;
            nextTime = ctx.currentTime + 0.06;
            clockT0 = nextTime;
            if (!timer) timer = setInterval(scheduler, TICK_MS);
            scheduler();
        } else {
            if (timer) { clearInterval(timer); timer = null; }
            const el = ensureFileEl();
            // Absolute (catalog / CDN) URLs pass through; bare filenames are
            // local drop-ins under assets/music/.
            const url = /^(https?:)?\/\//.test(t.src) || t.src.startsWith('/')
                ? t.src : `assets/music/${t.src}`;
            // Compare against what we ASKED for: el.src reads back resolved
            // to an absolute URL, so a relative path never matches itself
            // and the track would reload (and restart) on every play().
            if (fileUrl !== url) { fileUrl = url; el.src = url; el.load(); }
            el.play().catch(fallbackToSynth);
        }
    }

    function stopAll() {
        if (timer) { clearInterval(timer); timer = null; }
        stopFile();
    }

    // ---- public ------------------------------------------------------
    function play() {
        if (!tracks.length) return;
        playing = true;
        wantPlaying = true;
        save(LS_ON, '1');
        if (ctx) startCurrent();
        notify();
    }

    function pause() {
        playing = false;
        wantPlaying = false;
        save(LS_ON, '0');
        stopAll();
        notify();
    }

    function select(i) {
        if (!tracks.length) return;
        index = ((i % tracks.length) + tracks.length) % tracks.length;
        save(LS_TRACK, tracks[index].id);
        if (playing) { stopAll(); startCurrent(); }
        notify();
    }

    return {
        play,
        pause,
        toggle() {
            if (playing) pause(); else play();
            return playing;
        },
        next() { select(index + 1); },
        prev() { select(index - 1); },
        select,
        setVolume(v) {
            vol = Math.min(1, Math.max(0, v));
            if (bus) bus.gain.setTargetAtTime(vol, ctx.currentTime, 0.05);
            save(LS_VOL, String(vol));
            notify();
        },
        /** Subscribe to any state change (track list, selection, play state). */
        onChange(cb) { listeners.push(cb); },
        get tracks() { return tracks; },
        get index() { return index; },
        get playing() { return playing; },
        get volume() { return vol; },
        get title() { return tracks[index]?.title ?? '—'; },
        /** 0..1 loudness for the beat-reactive bot + HUD meter. Cheap enough
            to poll per frame (fftSize 64 = 32 bins). */
        level() {
            if (!analyser || !playing) return 0;
            // Preallocated: this runs every frame, and a fresh Uint8Array
            // per frame is pure garbage for the collector to chase.
            if (!levelBins) levelBins = new Uint8Array(analyser.frequencyBinCount);
            analyser.getByteFrequencyData(levelBins);
            let sum = 0;
            for (let i = 0; i < levelBins.length; i++) sum += levelBins[i];
            return Math.min(1, (sum / levelBins.length) / 140);
        },
        /** 1 right on the kick, decaying over ~180ms — the downbeat pulse. */
        beat() {
            if (!ctx || !playing) return 0;
            const age = ctx.currentTime - lastKick;
            return age < 0 || age > 0.18 ? 0 : 1 - age / 0.18;
        },
        /** Tempo of whatever is playing. File tracks have no analysable
            tempo, so they report a plausible mid-tempo — the dance still
            has to move to something. */
        get bpm() { return bpmOf(); },
        /** Plan 28: elapsed beats as a float — the clock Gratbot's dance
            runs on. DERIVED from the audio clock rather than counted per
            frame, so the choreography stays locked to the music through
            frame hitches. File tracks fall back to the element's own time,
            and a stopped player holds at 0 (the dance idles in place).   */
        beats() {
            if (!ctx || !playing) return 0;
            const spb = 60 / bpmOf();
            const t = preset() ? ctx.currentTime - clockT0
                : (fileEl?.currentTime ?? 0);
            return Math.max(0, t) / spb;
        },
        /** A2: splice a PannerNode between the analyser and destination so
            the soundtrack comes from the bot rather than from everywhere. */
        setOutput(node) {
            if (!analyser || !node) return;
            try { analyser.disconnect(); } catch { /* not connected yet */ }
            out = node;
            analyser.connect(out);
        },
        get ctx() { return ctx; },
        /** E2E probe: sequencer steps queued since boot. Rises while a synth
            track plays, frozen while paused or on a file track. */
        get scheduled() { return scheduled; },
        /** E2E probe: streaming state of the <audio> element (file tracks).
            The element is never in the DOM, so this is the only way to see it. */
        get fileState() {
            if (!fileEl) return null;
            return {
                url: fileUrl,
                time: fileEl.currentTime,
                paused: fileEl.paused,
                ready: fileEl.readyState,
                error: fileEl.error?.code ?? null,
            };
        },
    };
}
