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
        // Objective chains offered here (missions.js keys). Sites without
        // the field simply have none — Wave 4 pattern, Jezero-first.
        // Wave 12.5 multi-zone survey: several recon scouting targets per site.
        // The survey mission counts zones revealed to 65%+.
        surveyZones: [
            { x: 1350, z: 480, radius: 200 },   // Séítah dune margin
            { x: 1800, z: 2300, radius: 180 },  // Dust Devil Flats
            { x: -2380, z: -2450, radius: 200 }, // Neretva Vallis
        ],
        missions: ['tutorial', 'survey'],
        // Wave 7 base-building: once ALL missions above are complete, the
        // Signal Headquarters structure builds near the FIELD LAB
        // (outposts.js resolves the actual world position at runtime —
        // it needs the lab's placed padPos, not known at config time).
        hq: { name: 'Signal Headquarters' },
        // Wave 4 hazards (hazardZones.js / weather.js) — additive, sites
        // without the field have none. softSand circles sit on real
        // aeolian ground: the Séítah dune margins (the rippled sand that
        // actually bogged flight-planning debates), the Dust Devil Flats
        // ripple field, and the Neretva Vallis channel floor sands.
        hazards: {
            softSand: [
                { x: 1350, z: 480, r: 170, intensity: 0.7 },   // Séítah east dune margin
                { x: 1800, z: 2300, r: 230, intensity: 0.5 },  // Dust Devil Flats ripples
                { x: -2380, z: -2450, r: 190, intensity: 0.6 }, // Neretva channel sands
            ],
            dustStorm: { peakIntensity: 0.7 },
        },
        // `finding` = the real published science for that sample, revealed
        // in-game only after the FIELD LAB edge node finishes analysis.
        // Coordinates: precise where derived from published lon/lat (the
        // original five), approximate for other real features ("approx.
        // location" in the note), invented for the "[SIM]" survey targets
        // that spread the objective net across all quadrants of the crop.
        samples: [
            { id: 'rochette', name: 'Rochette', x: 1660, z: 1067, note: 'First cored sample, Sep 2021',
              finding: 'Olivine-bearing basalt with water-alteration rinds — the crater floor rock interacted with liquid water.',
              outpost: { name: 'Rochette Checkpost' } },
            { id: 'seitah', name: 'Séítah', x: 1008, z: 415, note: 'Ridge-forming igneous rock',
              finding: 'Coarse-grained olivine cumulate — a slowly cooled igneous body, later altered by water (carbonates present).',
              outpost: { name: 'Séítah Checkpost' } },
            { id: 'wildcat-ridge', name: 'Wildcat Ridge', x: -771, z: -207, note: 'Organic-molecule-bearing mudstone',
              finding: 'Sulfate-bearing mudstone carrying the mission’s strongest organic-molecule signal (SHERLOC detection).',
              outpost: { name: 'Wildcat Ridge Checkpost' } },
            { id: 'skinner-ridge', name: 'Skinner Ridge', x: -652, z: -166, note: 'Delta front outcrop',
              finding: 'Delta-front sandstone with transported clasts — rock carried in from far outside the crater by the ancient river.',
              outpost: { name: 'Skinner Ridge Checkpost' } },
            { id: 'cheyava-falls', name: 'Cheyava Falls', x: -1778, z: -1185, note: 'Leopard-spot reduction-oxidation features',
              finding: 'Iron-phosphate “leopard spot” redox fronts around organic-bearing veins — a potential biosignature, under review.',
              outpost: { name: 'Cheyava Falls Checkpost' } },
            { id: 'maaz', name: 'Máaz', x: 2300, z: 800, note: 'First rock target on the crater floor (approx. location)',
              finding: 'Basaltic crater-floor rock, water-altered — the very first laser target of the Mars 2020 mission.' },
            { id: 'kodiak', name: 'Kodiak Butte', x: -889, z: 2075, note: 'Delta remnant butte (approx. location)',
              finding: 'Textbook Gilbert-delta stratigraphy — inclined foreset beds proving a standing lake once filled Jezero.' },
            { id: 'three-forks', name: 'Three Forks Depot', x: -2015, z: 1600, note: 'Mars Sample Return depot (approx. location)',
              finding: 'Ten sealed sample tubes cached on the crater floor — humanity’s first sample depot on another world.',
              outpost: { name: 'Three Forks Depot Checkpost' } },
            { id: 'belva', name: 'Belva Crater', x: -2074, z: -296, note: 'Impact window into the delta (approx. location)',
              finding: 'Tilted sandstone blocks exposed by the impact — a cross-section through the buried ancient river system.' },
            { id: 'neretva-vallis', name: 'Neretva Vallis', x: -2450, z: -2600, note: 'Inlet channel floor — simulated survey target',
              finding: '[SIM] Rounded pebble conglomerate on the channel floor — sustained river flow entered the crater here.' },
            { id: 'relay-ridge', name: 'Relay Ridge', x: 2450, z: -2350, note: 'Comms relay candidate — simulated survey target',
              finding: '[SIM] High-standing rim ridge with clear line of sight across the site — flagged for a future relay mast.' },
            { id: 'dust-devil-flats', name: 'Dust Devil Flats', x: 1800, z: 2300, note: 'Aeolian survey — simulated survey target',
              finding: '[SIM] Fresh dust-devil tracks crossing older ripples — active aeolian transport measured this season.' },
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
            { id: 'john-klein', name: 'John Klein', x: 2386, z: -3550, note: 'Yellowknife Bay, first MSL drill site',
              finding: 'Smectite clay mudstone from a neutral-pH ancient lake — C, H, N, O, P and S all present: a habitable environment.' },
            { id: 'cumberland', name: 'Cumberland', x: 2363, z: -3579, note: 'Yellowknife Bay, second drill target',
              finding: 'Nitrate nitrogen detected, plus the first in-situ radiometric rock dating on another planet (~4.2 billion years).' },
            { id: 'vera-rubin-1', name: 'Vera Rubin Ridge — Site 1', x: -1342, z: 3777, note: 'Hematite-bearing ridge',
              finding: 'Crystalline gray hematite — an oxidation front left by groundwater moving through the ridge after deposition.' },
            { id: 'vera-rubin-2', name: 'Vera Rubin Ridge — Site 2', x: -1579, z: 3954, note: 'Ridge stratigraphy sample',
              finding: 'Diagenetic overprint: groundwater repeatedly cemented and re-crystallized these lakebed sediments.' },
            { id: 'windjana', name: 'Windjana', x: -162, z: -1351, note: 'Kimberley waypoint drill site (approx. location)',
              finding: 'Sanidine-rich sandstone — potassium-loaded sediment eroded from alkaline volcanic rock upstream of the crater.' },
            { id: 'buckskin', name: 'Buckskin', x: -1520, z: 753, note: 'Marias Pass drill site (approx. location)',
              finding: 'Tridymite in a lakebed mudstone — unexpected evidence of evolved, silica-rich volcanism on Mars.' },
            { id: 'bagnold-dunes', name: 'Bagnold Dunes', x: -700, z: 1500, note: 'Active dune field (approx. location)',
              finding: 'First in-situ study of active extraterrestrial dunes — olivine-enriched sands migrating meters per year.' },
            { id: 'murray-buttes', name: 'Murray Buttes', x: -1250, z: 2500, note: 'Sandstone-capped buttes (approx. location)',
              finding: 'Wind-deposited Stimson sandstone unconformably capping lake mudstone — a desert that followed the lakes.' },
            { id: 'peace-vallis', name: 'Peace Vallis Fan', x: 900, z: -4200, note: 'Alluvial fan toe — simulated survey target',
              finding: '[SIM] Water-transported gravels at the fan toe — the channel system that fed Gale’s northern floor.' },
            { id: 'south-ridge', name: 'South Ridge Station', x: 2600, z: 3300, note: 'Survey station — simulated survey target',
              finding: '[SIM] Panoramic survey of the Mount Sharp foothills — layered sulfates visible in the upper strata.' },
        ],
    },
};

export function getSiteFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const id = params.get('site');
    return SITES[id] || null;
}
