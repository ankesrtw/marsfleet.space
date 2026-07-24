# ONGAK soundtrack — drop-in tracks

`manifest.json` is the track list the in-game player reads. Every entry needs
`id`, `title` and `src`; `mood` is the small caption beside the title.

`src` takes one of two forms:

| Form | Meaning |
|---|---|
| `synth:<preset>` | Rendered live by `js/music.js`. Presets: `vigil`, `drift`, `olympus`, `lost`, `vector`. Zero bytes, works offline. |
| `something.mp3` | A real audio file **in this folder**, streamed through the same bus. |

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
