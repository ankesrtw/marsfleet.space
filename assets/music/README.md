# ONGAK soundtrack — track sources

**Mars Sim has its own playlist.** As of plan 28 the game no longer pulls the
marsapiens / SIGNAL R2 album (`/music/data/tracks-default.json`) — that queue
belongs to the standalone music app. The in-game player reads exactly one
source: **`manifest.json` in this folder**, which is where the procedural synth
presets live and where local drop-in files are declared.

Everything shipped today is rendered live in the browser by `js/music.js`:
zero bytes downloaded, works offline inside the Android APK, and nothing that
can 404.

## manifest.json

Every entry needs `id`, `title` and `src`; `mood` is the small caption beside
the title.

`src` takes one of two forms:

| Form | Meaning |
|---|---|
| `synth:<preset>` | Rendered live by `js/music.js`. Zero bytes, works offline. Presets below. |
| `something.mp3` | A real audio file **in this folder**, streamed through the same bus. |
| `https://…/x.mp3` | Any absolute URL. Needs permissive CORS, or the bus goes silent instead of erroring. |

## Synth presets

| Preset | Track | Character |
|---|---|---|
| `vigil` | Dust Vigil | 68 BPM minor pads, no drums — the default bed |
| `drift` | Red Drift | 92 BPM synthwave, gated pad |
| `olympus` | Olympus Line | 108 BPM driving arp, octave bass |
| `lost` | Signal Lost | dark Phrygian, half-time, tension |
| `vector` | Return Vector | Dorian, hopeful |
| `perihelion` | Perihelion | 88 BPM Dorian with a swung breakbeat + lead melody |
| `ferric` | Ferric | 112 BPM harmonic minor, 16th arp, industrial |
| `aphelion` | Aphelion | 60 BPM Lydian, no drums, long lead — the only bright one |
| `regolith` | Regolith Run | 100 BPM pentatonic, tom-led tribal kit |
| `nightshift` | Night Shift | 74 BPM half-time, heavily swung, low and slow |
| `terminator` | Terminator Line | 124 BPM Phrygian dominant, the fastest here |

Preset knobs (see `PRESETS` in `js/music.js`): `rootMidi`, `bpm`, `scale`,
`prog` (scale degrees, one chord per bar), layer gains `pad`/`bass`/`arp`/
`lead`/`drums`, `arpPattern`+`arpEvery`, `leadPattern`+`leadEvery`, `cutoff`
sweep range, `padType`, `octaveBass`, `halfTime`, `swing` (0–0.5, pushes
offbeat 16ths late) and `drumStyle` (`four` default / `break` / `tribal`).

## Drop-in files

So dropping in AI-generated music is a two-step job with no code change:

1. Put the file here, e.g. `assets/music/olympus-line.mp3`.
2. Point its manifest entry at it: `"src": "olympus-line.mp3"`.

Notes:

- Keep files small — they ship inside the Android APK. Mono 128 kbps is
  roughly 1 MB/minute and is plenty for background music.
- Tracks loop seamlessly if the file itself loops cleanly; the player sets
  `loop = true` and does no crossfading.
- A missing or malformed `manifest.json` is not an error: the player falls
  back to the five built-in synth presets, so the soundtrack can never 404.
- A file named in the manifest that fails to load is silent for that track
  only — the rest of the list keeps working.
