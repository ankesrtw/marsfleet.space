# ONGAK soundtrack — track sources

The in-game player builds its list from two sources, in this order:

1. **The SIGNAL catalog** — `/music/data/tracks-default.json`, the same queue
   the standalone music app plays, streamed from R2. This is the real
   (Suno-generated) lore soundtrack: ORIGIN, ATHENA's Lullaby, ARIANA Speaks,
   CREON Never Sleeps, and so on. R2 serves it with `Access-Control-Allow-Origin: *`,
   so these tracks route through the game's own audio bus and get the analyser
   and spatial panner like everything else. Requires network — offline, this
   source silently contributes nothing.
2. **`manifest.json` in this folder** — local drop-ins, and the home of the
   always-available synth presets.

Add tracks to the catalog by re-running `scripts/snapshot_music.sh`; add them
to the game only by editing `manifest.json` here.

## manifest.json

Every entry needs `id`, `title` and `src`; `mood` is the small caption beside
the title.

`src` takes one of two forms:

| Form | Meaning |
|---|---|
| `synth:<preset>` | Rendered live by `js/music.js`. Presets: `vigil`, `drift`, `olympus`, `lost`, `vector`. Zero bytes, works offline. |
| `something.mp3` | A real audio file **in this folder**, streamed through the same bus. |
| `https://…/x.mp3` | Any absolute URL. Needs permissive CORS, or the bus goes silent instead of erroring. |

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
