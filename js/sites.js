/* ============================================================
   sites.js — real-Mars-site configuration.

   One plain object per landing site: heightmap/texture URLs,
   the elevation range baked in by scripts/mars-terrain/prep_site.sh
   (needed to de-quantize the RG-packed 16-bit heightmap back to
   real meters), world scale, per-device mesh density, spawn point,
   and real named sample sites.

   World coordinates: origin = crop center, x = east, z = south
   (matches image rows top->bottom = north->south). All sample/spawn
   offsets below are derived from the sites' real lon/lat vs the crop
   center (Mars 2000 sphere, 1 deg = 59274.6975 m) — see the AOI
   derivation comments in scripts/mars-terrain/prep_site.sh.

   No plugin/registry system — add a site by adding one object here
   plus its two asset files.
   ============================================================ */

// Mars 2000 sphere (R=3396190m): meters per degree of lat/lon at the equator
// of the equirectangular projection all site rasters use.
export const M_PER_DEG = 59274.697523;

// One Martian sol in milliseconds (24h 39m 35.244s).
export const SOL_MS = 88775244;

export const SITES = {
    jezero: {
        id: 'jezero',
        name: 'Jezero Crater',
        mission: 'Perseverance · Mars 2020',
        heightmapUrl: 'assets/jezero/heightmap.png',
        textureUrl: 'assets/jezero/albedo.jpg',
        // Baked from `gdalinfo -stats` on the real cropped DTM
        // (prep_site.sh jezero, run 2026-07-08).
        elevMin: -2596.4763183594,
        elevMax: -2396.3757324219,
        // 6km x 6km crop centered at (77.415E, 18.455N): landing site ->
        // Séítah -> western delta front -> Neretva Vallis.
        worldSize: 6000,
        // Mesh density per device class. Jezero's 20m CTX DEM has real
        // detail down to ~6m/px (heightmap is 1024px over 6km) that 256
        // segments (23m quads) was smoothing away; 384 (15.6m quads) pulls
        // more of that real roughness into the rendered + sampled mesh
        // without inventing anything past the DEM's native resolution.
        segments: { desktop: 384, mobile: 128 },
        center: { lon: 77.415, lat: 18.455 },
        // Perseverance touchdown (UTC) — drives the live mission sol counter.
        landingUtc: '2021-02-18T20:55:00Z',
        // CTX ortho is grayscale — multiply in a Mars-rust tint (see terrain.js).
        tint: 0xc98a5e,
        // Octavia E. Butler Landing (77.45088E, 18.44463N); heading faces
        // northwest so W drives toward Séítah and the delta front.
        spawn: { x: 2127, z: 615, heading: Math.PI / 4 },
        samples: [
            { id: 'rochette', name: 'Rochette', x: 1660, z: 1067, note: 'First cored sample, Sep 2021' },
            { id: 'seitah', name: 'Séítah', x: 1008, z: 415, note: 'Ridge-forming igneous rock' },
            { id: 'wildcat-ridge', name: 'Wildcat Ridge', x: -771, z: -207, note: 'Organic-molecule-bearing mudstone' },
            { id: 'skinner-ridge', name: 'Skinner Ridge', x: -652, z: -166, note: 'Delta front outcrop' },
            { id: 'cheyava-falls', name: 'Cheyava Falls', x: -1778, z: -1185, note: 'Leopard-spot reduction-oxidation features' },
        ],
    },
    gale: {
        id: 'gale',
        name: 'Gale Crater',
        mission: 'Curiosity · MSL',
        heightmapUrl: 'assets/gale/heightmap.png',
        textureUrl: 'assets/gale/albedo.jpg',
        // Baked from `gdalinfo -stats` on the real cropped DEM
        // (prep_site.sh gale, run 2026-07-10 — 2048px 16-bit RG, streamed
        // AOI). 806m relief: crater floor -> Mount Sharp foothills.
        elevMin: -4529.3466796875,
        elevMax: -3723.2702636719,
        // 9km x 9km crop centered at (8144500, -276000)m = (137.4026E, 4.6563S).
        // Width fixed at 9km by the HiRISE ortho corridor; spans the real
        // traverse: Bradbury Landing -> Yellowknife Bay -> Vera Rubin Ridge.
        worldSize: 9000,
        // 1m-source DEM (2048px heightmap = 4.4m/px): 512 segments
        // (17.6m quads) left real roughness on the table (slope stats
        // barely soften between native-res and 512-seg sampling). 640
        // (14.1m quads) pulls more of that relief into the rendered +
        // physics-sampled mesh. Measured on the weakest target GPU
        // (Intel HSW GT1): 512→25.6ms, 640→28.4ms, 768→35.3ms per
        // frame — 640 is the knee; 768 costs ~10ms for little gain.
        segments: { desktop: 640, mobile: 192 },
        center: { lon: 137.40264, lat: -4.65629 },
        // Curiosity touchdown (UTC) — drives the live mission sol counter.
        landingUtc: '2012-08-06T05:17:00Z',
        // HiRISE ortho is real color — no tint needed.
        tint: 0xffffff,
        // Bradbury Landing (137.4417E, 4.5895S); heading faces south so W
        // drives into the map toward Yellowknife Bay and Mount Sharp
        // (spawn is only ~540m from the crop's north edge).
        spawn: { x: 2315, z: -3959, heading: Math.PI },
        samples: [
            { id: 'john-klein', name: 'John Klein', x: 2386, z: -3550, note: 'Yellowknife Bay, first MSL drill site' },
            { id: 'cumberland', name: 'Cumberland', x: 2363, z: -3579, note: 'Yellowknife Bay, second drill target' },
            { id: 'vera-rubin-1', name: 'Vera Rubin Ridge — Site 1', x: -1342, z: 3777, note: 'Hematite-bearing ridge' },
            { id: 'vera-rubin-2', name: 'Vera Rubin Ridge — Site 2', x: -1579, z: 3954, note: 'Ridge stratigraphy sample' },
        ],
    },
};

export function getSiteFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const id = params.get('site');
    return SITES[id] || null;
}
