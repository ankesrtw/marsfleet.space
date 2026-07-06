/* ============================================================
   sites.js — real-Mars-site configuration.

   One plain object per landing site: heightmap/texture URLs,
   the elevation range baked in by scripts/mars-terrain/prep_site.sh
   (needed to de-quantize the 8-bit heightmap back to real meters),
   world scale, spawn point, and a handful of real named sample
   sites. No plugin/registry system — add a site by adding one
   object here plus its two asset files.
   ============================================================ */

export const SITES = {
    jezero: {
        id: 'jezero',
        name: 'Jezero Crater',
        mission: 'Perseverance · Mars 2020',
        heightmapUrl: 'assets/jezero/heightmap.png',
        textureUrl: 'assets/jezero/albedo.jpg',
        // Baked from `gdalinfo -stats` on the cropped DTM — placeholder until
        // scripts/mars-terrain/prep_site.sh jezero has actually been run.
        elevMin: -2710.7,
        elevMax: -1515.5,
        worldSize: 4000, // meters, matches the 4km x 4km crop
        spawn: { x: 0, z: 0, heading: 0 },
        samples: [
            { id: 'rochette', name: 'Rochette', x: -300, z: 150, note: 'First cored sample, Sep 2021' },
            { id: 'seitah', name: 'Séítah', x: -520, z: 40, note: 'Ridge-forming igneous rock' },
            { id: 'wildcat-ridge', name: 'Wildcat Ridge', x: 180, z: -260, note: 'Organic-molecule-bearing mudstone' },
            { id: 'skinner-ridge', name: 'Skinner Ridge', x: 420, z: 300, note: 'Delta front outcrop' },
            { id: 'cheyava-falls', name: 'Cheyava Falls', x: -80, z: 480, note: 'Leopard-spot reduction-oxidation features' },
        ],
    },
    gale: {
        id: 'gale',
        name: 'Gale Crater',
        mission: 'Curiosity · MSL',
        heightmapUrl: 'assets/gale/heightmap.png',
        textureUrl: 'assets/gale/albedo.jpg',
        // Placeholder until scripts/mars-terrain/prep_site.sh gale has been run
        // against a streamed AOI crop (source DEM is 3.6GB — never fetched whole).
        elevMin: -4500,
        elevMax: -4100,
        worldSize: 4000,
        spawn: { x: 0, z: 0, heading: 0 },
        samples: [
            { id: 'john-klein', name: 'John Klein', x: -200, z: 100, note: 'Yellowknife Bay, first MSL drill site' },
            { id: 'cumberland', name: 'Cumberland', x: -160, z: 130, note: 'Yellowknife Bay, second drill target' },
            { id: 'vera-rubin-1', name: 'Vera Rubin Ridge — Site 1', x: 300, z: -220, note: 'Hematite-bearing ridge' },
            { id: 'vera-rubin-2', name: 'Vera Rubin Ridge — Site 2', x: 340, z: -180, note: 'Ridge stratigraphy sample' },
        ],
    },
};

export function getSiteFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const id = params.get('site');
    return SITES[id] || null;
}
