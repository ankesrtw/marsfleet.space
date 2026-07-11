/* ============================================================
   sound.js — asset-free WebAudio: wind bed, per-unit engine hum,
   and UI/gameplay cues (collect, unit switch, battery warnings).

   Everything is synthesized (oscillators + generated noise buffer),
   so there is nothing to download and nothing that can 404. The
   AudioContext is created on the first user gesture (autoplay
   policy); until then every call is a silent no-op. Toggle persists
   in localStorage as 'mc-sfx'.
   ============================================================ */

const LS_KEY = 'mc-sfx';

export function createSound() {
    let ctx = null;
    let master = null;
    let engine = null;      // { osc, sub, filter, gain }
    let enabled = localStorage.getItem(LS_KEY) !== 'off';

    function unlock() {
        if (ctx) return;
        try {
            ctx = new (window.AudioContext || window.webkitAudioContext)();
            master = ctx.createGain();
            master.gain.value = enabled ? 1 : 0;
            master.connect(ctx.destination);
            buildWind();
            buildEngine();
        } catch {
            ctx = null; // no audio available — stay silent forever
        }
    }
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });

    function buildWind() {
        const len = ctx.sampleRate * 2;
        const buf = ctx.createBuffer(1, len, ctx.sampleRate);
        const data = buf.getChannelData(0);
        let last = 0;
        for (let i = 0; i < len; i++) {
            // brown-ish noise: integrate white, keep bounded
            last = (last + (Math.random() * 2 - 1) * 0.03) * 0.997;
            data[i] = last * 4;
        }
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.loop = true;
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 320;
        const gain = ctx.createGain();
        gain.gain.value = 0.05;
        // slow gusting
        const lfo = ctx.createOscillator();
        lfo.frequency.value = 0.07;
        const lfoGain = ctx.createGain();
        lfoGain.gain.value = 0.025;
        lfo.connect(lfoGain).connect(gain.gain);
        src.connect(filter).connect(gain).connect(master);
        src.start();
        lfo.start();
    }

    function buildEngine() {
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = 42;
        const sub = ctx.createOscillator();
        sub.type = 'triangle';
        sub.frequency.value = 84;
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 240;
        const gain = ctx.createGain();
        gain.gain.value = 0;
        osc.connect(filter);
        sub.connect(filter);
        filter.connect(gain).connect(master);
        osc.start();
        sub.start();
        engine = { osc, sub, filter, gain };
    }

    // per-unit engine voicing: base pitch + how loud it may get
    const ENGINE_VOICE = {
        'Rover': { freq: 42, vol: 0.14 },
        'Recon Drone': { freq: 110, vol: 0.1 },
        'Lift Drone': { freq: 68, vol: 0.13 },
        'Humanoid': { freq: 60, vol: 0.05 },
    };

    /** Per frame: unitName + normalized speed 0..1 drive the hum. */
    function update(unitName, speedNorm) {
        if (!ctx || !engine) return;
        const voice = ENGINE_VOICE[unitName] ?? ENGINE_VOICE['Rover'];
        const t = ctx.currentTime;
        const target = Math.min(1, Math.abs(speedNorm)) * voice.vol;
        engine.gain.gain.setTargetAtTime(target, t, 0.12);
        engine.osc.frequency.setTargetAtTime(voice.freq * (1 + 0.5 * speedNorm), t, 0.15);
        engine.sub.frequency.setTargetAtTime(voice.freq * 2 * (1 + 0.5 * speedNorm), t, 0.15);
    }

    function blip(freqs, dur = 0.12, vol = 0.18, type = 'sine') {
        if (!ctx) return;
        let t = ctx.currentTime;
        for (const f of freqs) {
            const osc = ctx.createOscillator();
            osc.type = type;
            osc.frequency.value = f;
            const g = ctx.createGain();
            g.gain.setValueAtTime(0, t);
            g.gain.linearRampToValueAtTime(vol, t + 0.015);
            g.gain.exponentialRampToValueAtTime(0.001, t + dur);
            osc.connect(g).connect(master);
            osc.start(t);
            osc.stop(t + dur + 0.02);
            t += dur * 0.75;
        }
    }

    function toggle() {
        enabled = !enabled;
        localStorage.setItem(LS_KEY, enabled ? 'on' : 'off');
        if (master) master.gain.value = enabled ? 1 : 0;
        return enabled;
    }

    return {
        update,
        toggle,
        get enabled() { return enabled; },
        collect: () => blip([660, 990], 0.14, 0.2),
        sling: () => blip([520, 780], 0.12, 0.18),
        deliver: () => blip([660, 990, 1320], 0.13, 0.2),
        analysisDone: () => blip([880, 1175, 1568, 1175], 0.15, 0.18),
        switchUnit: () => blip([440], 0.09, 0.14, 'triangle'),
        lowBattery: () => blip([220, 220], 0.16, 0.16, 'square'),
        dead: () => blip([160, 110], 0.3, 0.18, 'square'),
    };
}
