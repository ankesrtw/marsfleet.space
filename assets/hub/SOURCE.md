# mars-globe.jpg — source & attribution

**File:** `mars-globe.jpg` — 2048×1024 equirectangular Mars color map, used as the
texture on the Site Hub globe (`js/hub.js`, plan 22-B).

- **Source:** USGS Astrogeology **Viking MDIM 2.1 Colorized Global Mosaic**
  (`Mars_Viking_MDIM21_ClrMosaic_global_232m`), served as WMTS tiles by
  **NASA Solar System Treks / Mars Trek** (`trek.nasa.gov`).
- **Retrieved:** 2026-07-19, level-3 tiles (16×8 = 4096×2048), stitched
  row-major and downsampled 2:1 (Lanczos) to 2048×1024, sRGB, JPEG q88.
- **Projection:** equirectangular, north up, prime meridian centered
  (left edge = −180°E / 180°W, right edge = +180°E). Longitude increases
  left→right; latitude +90°N (top) → −90°S (bottom). Pin placement in
  `hub.js` maps `center.{lon,lat}` onto the sphere against this convention.
- **License:** Public domain. USGS/NASA imagery is a work of the U.S.
  Government (17 U.S.C. §105) and carries no copyright.

Regenerate: fetch tiles from
`https://trek.nasa.gov/tiles/Mars/EQ/Mars_Viking_MDIM21_ClrMosaic_global_232m/1.0.0/default/default028mm/3/{row}/{col}.jpg`
(row 0–7, col 0–15), `montage -tile 16x8`, then
`convert -filter Lanczos -resize 2048x1024 -quality 88`.
