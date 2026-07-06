# Mars Colony

Real-Mars-terrain rover/drone/humanoid sim. First playable slice — see
`docs/game-plans/` in the main repo (and the approved plan this was scaffolded
from) for full scope.

## Status

Code scaffold complete: site selection, terrain loader (GPU shader displacement
+ CPU height sampling), rover/drone/humanoid controllers, fog-of-war minimap,
sample collection + inventory, touch-first HUD with on-screen joysticks.

**Pending**: real heightmap/albedo assets. `assets/jezero/` and `assets/gale/`
are empty — run `scripts/mars-terrain/prep_site.sh <jezero|gale>` (repo root)
once local disk space is available (source Mars DEMs/orthoimages are large;
see that script's header for the exact URLs and disk-safety notes). Until
those PNG/JPG files exist, the game mode (`?site=jezero` / `?site=gale`) will
fail to load terrain — the site-select screen works today.

## Dev

```bash
cd standalone/public
python3 -m http.server 8931
# open http://localhost:8931/mars-colony/
```

Deploy: `cd standalone && wrangler pages deploy public --project-name signal-playground --commit-dirty=true`

## Controls

- **Desktop**: WASD/arrows to move, Tab to switch unit, E to collect a sample.
- **Touch**: left thumb-zone joystick to move, right thumb-zone to look
  (drone only), on-screen SWITCH UNIT / COLLECT buttons.

## Dependency versioning

Uses Three.js **latest stable** (currently 0.185.1) via CDN import map —
intentionally newer than this project's other standalone games (pinned at
0.160.1), since this game shares no vendor files with them. Re-check for a
newer stable release each work session.
