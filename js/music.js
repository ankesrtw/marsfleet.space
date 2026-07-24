/* ============================================================
   music.js — the Ongak soundtrack engine (plan 27).

   Asset-free procedural synthwave, same discipline as sound.js:
   nothing to download, nothing that can 404, works offline inside
   the Android APK. Each "track" is a preset — key, tempo, chord
   progression and which layers play — rendered live by a step
   sequencer.

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
const SCALES = {
    minor: [0, 2, 3, 5, 7, 8, 10],
    phrygian: [0, 1, 3, 5, 7, 8, 10],
    dorian: [0, 2, 3, 5, 7, 9, 10],
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
};

const BUILTIN = [
    { id: 'dust-vigil', title: 'Dust Vigil', mood: 'AMBIENT', src: 'synth:vigil' },
    { id: 'red-drift', title: 'Red Drift', mood: 'SYNTHWAVE', src: 'synth:drift' },
    { id: 'olympus-line', title: 'Olympus Line', mood: 'DRIVING', src: 'synth:olympus' },
    { id: 'signal-lost', title: 'Signal Lost', mood: 'TENSION', src: 'synth:lost' },
    { id: 'return-vector', title: 'Return Vector', mood: 'HOPEFUL', src: 'synth:vector' },
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
    let scheduled = 0;     // E2E probe: total sequencer steps queued
    let fileEl = null;     // <audio> for manifest tracks that are real files
    let fileNode = null;   // MediaElementSource (one per element, never rebuilt)

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

    loadManifest();

    /** Optional manifest of drop-in tracks. Anything malformed is ignored
        wholesale — the built-in presets are the floor, and the soundtrack
        must never depend on a file that might not ship. */
    async function loadManifest() {
        try {
            const res = await fetch(MANIFEST_URL, { cache: 'no-cache' });
            if (!res.ok) return;
            const list = await res.json();
            if (!Array.isArray(list) || !list.length) return;
            const clean = list.filter((t) => t && typeof t.id === 'string'
                && typeof t.title === 'string' && typeof t.src === 'string');
            if (!clean.length) return;
            const activeId = tracks[index]?.id;
            tracks = clean.map((t) => ({ mood: t.mood ?? 'TRACK', ...t }));
            const again = tracks.findIndex((t) => t.id === activeId);
            index = again >= 0 ? again : 0;
            notify();
        } catch { /* offline / no manifest — built-ins stand */ }
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

    // ---- sequencer ---------------------------------------------------
    function preset() {
        const src = tracks[index]?.src ?? '';
        return PRESETS[src.startsWith('synth:') ? src.slice(6) : ''] ?? null;
    }

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

        // drums
        if (p.drums) {
            const d = p.drums;
            if (s % (p.halfTime ? 8 : 4) === 0) kick(t, 0.5 * d);
            if (s % 8 === 4) noise(t, 0.16, 0.16 * d, 'bandpass', 1900, 0.8);
            if (s % 2 === 0 && !p.halfTime) noise(t, 0.035, 0.05 * d, 'highpass', 7500);
        }
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
            if (nextTime < ctx.currentTime - 1.2) nextTime = ctx.currentTime + 0.02;
            scheduleStep(p, step, nextTime);
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
        fileEl.crossOrigin = 'anonymous';
        if (ctx) {
            try {
                fileNode = ctx.createMediaElementSource(fileEl);
                fileNode.connect(bus);
            } catch { fileNode = null; /* fall through: element plays un-bussed */ }
        }
        return fileEl;
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
            if (!timer) timer = setInterval(scheduler, TICK_MS);
            scheduler();
        } else {
            if (timer) { clearInterval(timer); timer = null; }
            const el = ensureFileEl();
            const url = `assets/music/${t.src}`;
            if (!el.src.endsWith(t.src)) el.src = url;
            el.play().catch(() => { /* blocked or missing file — stays silent */ });
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
    };
}
