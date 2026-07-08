/* ============================================================
   sites.js — real-Mars-site configuration.

   One plain object per landing site: heightmap/texture URLs,
   the elevation range baked in by scripts/mars-terrain/prep_site.sh
   (needed to de-quantize the 8-bit heightmap back to real meters),
   world scale, spawn point, and real named sample sites.

   World coordinates: origin = crop center, x = east, z = south
   (matches image rows top->bottom = north->south). All sample/spawn
   offsets below are derived from the sites' real lon/lat vs the crop
   center (Mars 2000 sphere, 1 deg = 59274.6975 m) — see the AOI
   derivation comments in scripts/mars-terrain/prep_site.sh.

   No plugin/registry system — add a site by adding one object here
   plus its two asset files.
   ============================================================ */

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
        // Octavia E. Butler Landing (77.45088E, 18.44463N)
        spawn: { x: 2127, z: 615, heading: 0 },
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
        // (prep_site.sh gale, run 2026-07-08 — streamed AOI, source never
        // fetched whole). 805m relief: crater floor -> Mount Sharp foothills.
        elevMin: -4529.212890625,
        elevMax: -3723.7697753906,
        // 9km x 9km crop centered at (8144500, -276000)m = (137.4026E, 4.6563S).
        // Width fixed at 9km by the HiRISE ortho corridor; spans the real
        // traverse: Bradbury Landing -> Yellowknife Bay -> Vera Rubin Ridge.
        worldSize: 9000,
        // Bradbury Landing (137.4417E, 4.5895S)
        spawn: { x: 2315, z: -3959, heading: 0 },
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
