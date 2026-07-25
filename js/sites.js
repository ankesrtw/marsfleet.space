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
            { id: 'seitah', x: 1350, z: 480, radius: 200 },   // Séítah dune margin
            { id: 'dust-devil-flats', x: 1800, z: 2300, radius: 180 }, // Dust Devil Flats
            { id: 'neretva', x: -2380, z: -2450, radius: 200 }, // Neretva Vallis
        ],
        // Wave 12.13 photo-recon targets: real landforms worth an aerial
        // frame, spread across all quadrants so the imaging run is a real
        // sortie (photos.js; the photo mission's count must match length).
        photoSpots: [
            { id: 'kodiak', name: 'Kodiak Butte', x: -889, z: 2075, note: 'Delta remnant — Gilbert foreset beds in the scarp face' },
            { id: 'belva', name: 'Belva Crater', x: -2074, z: -296, note: 'Impact window into the buried river system' },
            { id: 'three-forks', name: 'Three Forks Depot', x: -2015, z: 1600, note: 'Humanity’s first sample depot on another world' },
            { id: 'seitah-ridge', name: 'Séítah Ridge', x: 1008, z: 415, note: 'Ridge-forming igneous outcrop over the dune field' },
        ],
        // Plan 28's opening mission step sends the player to Ariana, so her
        // briefing has to describe the site they actually landed on. These
        // two lines are the site-specific half of the script; her own
        // character lines are shared across sites (hologram.js). Line two
        // names this site's three surveyZones — the briefing doubles as the
        // objective preview.
        briefing: [
            'Ariana: Welcome to Jezero Crater. I\'ve been watching this site since the landing — the delta, the dunes, the dust devils carving their paths.',
            'This is where Perseverance proved ancient Mars held water. The Séítah dune field, the Dust Devil Flats, the Neretva Vallis channel — each tells a chapter of the story.',
        ],
        missions: ['tutorial', 'survey', 'photo'],
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
            // Wave 12.15: no cone/beacon exists here. Recon must first map
            // the Neretva survey zone; the humanoid then cores this exact
            // buried patch through the timed drill interaction.
            { id: 'neretva-subsurface-core', name: 'Neretva Subsurface Core', x: -2320, z: -2370,
              note: '[SIM] Buried channel-floor core — localized by aerial survey',
              finding: '[SIM] Fine-grained channel-floor sediments preserved beneath the wind-scoured surface — a protected record of sustained river inflow.',
              buried: { surveyZone: 'neretva' } },
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
        // Phones load this 2048px downsample (same elev scale) — the 4096
        // canvas.getImageData() decode is at the iOS Safari canvas ceiling.
        heightmapUrlMobile: 'assets/gale/heightmap-mobile.png',
        textureUrl: 'assets/gale/albedo.jpg',
        // Baked from `gdalinfo -stats` on the real cropped DEM
        // (prep_site.sh gale, run 2026-07-18 — 4096px 16-bit RG, streamed
        // AOI). 806m relief: crater floor -> Mount Sharp foothills.
        elevMin: -4529.4702148438,
        elevMax: -3723.2702636719,
        // 9km x 9km crop centered at (8144500, -276000)m = (137.4026E, 4.6563S).
        // Width fixed at 9km by the HiRISE ortho corridor; spans the real
        // traverse: Bradbury Landing -> Yellowknife Bay -> Vera Rubin Ridge.
        worldSize: 9000,
        // 1m-source DEM now shipped at 4096px (2.2m/px). Under the Wave 5
        // geometry clipmap, `segments` only sets the finest near-camera step
        // s0 = worldSize/segments and adds one detail level per doubling —
        // render cost is decoupled from it (the old "640 is the knee, 768 =
        // 35ms" note was the pre-clipmap single full plane, now stale). So
        // desktop goes to 1024 (s0 = 8.8m quads, was 14.1m at 640), pulling
        // the finer heightmap into real geometry; the CPU grid (1025^2) and
        // its one-time build are the only real cost. Mobile stays 192 and
        // loads the 2048 heightmap variant (heightmapUrlMobile above).
        segments: { desktop: 1024, mobile: 192 },
        center: { lon: 137.40264, lat: -4.65629 },
        // Curiosity touchdown (UTC) — drives the live mission sol counter.
        landingUtc: '2012-08-06T05:17:00Z',
        // HiRISE ortho is real color — no tint needed.
        tint: 0xffffff,
        // Bradbury Landing (137.4417E, 4.5895S); heading faces south so W
        // drives into the map toward Yellowknife Bay and Mount Sharp
        // (spawn is only ~540m from the crop's north edge).
        spawn: { x: 2315, z: -3959, heading: Math.PI },
        // Wave 12.5 multi-zone survey: recon scouting targets spread along the
        // real traverse (Bagnold dune field, Peace Vallis fan, Vera Rubin
        // Ridge). The survey mission counts zones revealed to 65%+.
        surveyZones: [
            { id: 'bagnold', x: -700, z: 1500, radius: 220 },      // Bagnold Dunes
            { id: 'peace-vallis', x: 900, z: -4200, radius: 200 }, // Peace Vallis fan
            { id: 'vera-rubin', x: -1450, z: 3860, radius: 200 },  // Vera Rubin Ridge
        ],
        // Wave 12.13 photo-recon targets — real Gale landforms, one per
        // quadrant so the imaging run is a genuine sortie (photos.js; the
        // photo mission's count is now derived from this length).
        photoSpots: [
            { id: 'murray-buttes', name: 'Murray Buttes', x: -1250, z: 2500, note: 'Wind-carved sandstone buttes capping the ancient lakebed' },
            { id: 'vera-rubin-ridge', name: 'Vera Rubin Ridge', x: -1450, z: 3860, note: 'Hematite-bearing ridge — a groundwater oxidation front' },
            { id: 'yellowknife-bay', name: 'Yellowknife Bay', x: 2375, z: -3560, note: 'The first proven habitable ancient lake environment on Mars' },
            { id: 'mount-sharp-foothills', name: 'Mount Sharp Foothills', x: 2600, z: 3300, note: 'Layered sulfate strata rising toward Aeolis Mons' },
        ],
        // Ariana's site-specific briefing (see the Jezero note above) — same
        // two-line shape, real Gale science, naming this site's three
        // surveyZones so the briefing previews the objectives here too.
        // Keep lines within Jezero's length envelope: the objective banner
        // that renders them is a single centered row on desktop.
        briefing: [
            'Ariana: Welcome to Gale Crater. I\'ve been watching this site since the landing — the old lakebed, the dune field, and Mount Sharp rising above it all.',
            'This is where Curiosity proved ancient Mars was habitable. The Bagnold dune field, the Peace Vallis fan, Vera Rubin Ridge — each tells a chapter of the story.',
        ],
        missions: ['tutorial', 'survey', 'photo'],
        // Wave 7 base-building: once ALL missions complete, the HQ builds near
        // the FIELD LAB (outposts.js resolves the position at runtime).
        hq: { name: 'Signal Gale Station' },
        // Wave 4 hazards. Bagnold is a REAL active dune field (Curiosity's
        // dune campaign) — the perfect soft-sand anchor; the Peace Vallis
        // fan-toe carries loose alluvial sand too.
        hazards: {
            softSand: [
                { x: -700, z: 1500, r: 240, intensity: 0.7 },   // Bagnold Dunes
                { x: -1050, z: 1780, r: 170, intensity: 0.55 }, // Bagnold high arm
                { x: 900, z: -4050, r: 200, intensity: 0.6 },   // Peace Vallis fan sands
            ],
            dustStorm: { peakIntensity: 0.6 },
        },
        samples: [
            { id: 'john-klein', name: 'John Klein', x: 2386, z: -3550, note: 'Yellowknife Bay, first MSL drill site',
              finding: 'Smectite clay mudstone from a neutral-pH ancient lake — C, H, N, O, P and S all present: a habitable environment.',
              outpost: { name: 'John Klein Checkpost' } },
            { id: 'cumberland', name: 'Cumberland', x: 2363, z: -3579, note: 'Yellowknife Bay, second drill target',
              finding: 'Nitrate nitrogen detected, plus the first in-situ radiometric rock dating on another planet (~4.2 billion years).',
              outpost: { name: 'Cumberland Checkpost' } },
            { id: 'vera-rubin-1', name: 'Vera Rubin Ridge — Site 1', x: -1342, z: 3777, note: 'Hematite-bearing ridge',
              finding: 'Crystalline gray hematite — an oxidation front left by groundwater moving through the ridge after deposition.',
              outpost: { name: 'Vera Rubin Ridge Checkpost' } },
            { id: 'vera-rubin-2', name: 'Vera Rubin Ridge — Site 2', x: -1579, z: 3954, note: 'Ridge stratigraphy sample',
              finding: 'Diagenetic overprint: groundwater repeatedly cemented and re-crystallized these lakebed sediments.' },
            { id: 'windjana', name: 'Windjana', x: -162, z: -1351, note: 'Kimberley waypoint drill site (approx. location)',
              finding: 'Sanidine-rich sandstone — potassium-loaded sediment eroded from alkaline volcanic rock upstream of the crater.',
              outpost: { name: 'Windjana Checkpost' } },
            { id: 'buckskin', name: 'Buckskin', x: -1520, z: 753, note: 'Marias Pass drill site (approx. location)',
              finding: 'Tridymite in a lakebed mudstone — unexpected evidence of evolved, silica-rich volcanism on Mars.',
              outpost: { name: 'Buckskin Checkpost' } },
            { id: 'bagnold-dunes', name: 'Bagnold Dunes', x: -700, z: 1500, note: 'Active dune field (approx. location)',
              finding: 'First in-situ study of active extraterrestrial dunes — olivine-enriched sands migrating meters per year.' },
            { id: 'murray-buttes', name: 'Murray Buttes', x: -1250, z: 2500, note: 'Sandstone-capped buttes (approx. location)',
              finding: 'Wind-deposited Stimson sandstone unconformably capping lake mudstone — a desert that followed the lakes.' },
            { id: 'peace-vallis', name: 'Peace Vallis Fan', x: 900, z: -4200, note: 'Alluvial fan toe — simulated survey target',
              finding: '[SIM] Water-transported gravels at the fan toe — the channel system that fed Gale’s northern floor.' },
            { id: 'south-ridge', name: 'South Ridge Station', x: 2600, z: 3300, note: 'Survey station — simulated survey target',
              finding: '[SIM] Panoramic survey of the Mount Sharp foothills — layered sulfates visible in the upper strata.' },
            // Wave 12.15: no cone/beacon here. Recon must first map the Bagnold
            // survey zone; the humanoid then cores this buried patch through the
            // timed drill interaction.
            { id: 'bagnold-subsurface-core', name: 'Bagnold Subsurface Core', x: -750, z: 1560,
              note: '[SIM] Buried dune-base core — localized by aerial survey',
              finding: '[SIM] Cross-bedded sand sealed beneath the active Bagnold dunes — a record of an older wind regime preserved under today’s migrating ripples.',
              buried: { surveyZone: 'bagnold' } },
        ],
    },
    gusev: {
        id: 'gusev',
        name: 'Gusev Crater',
        mission: 'Spirit · MER-A',
        heightmapUrl: 'assets/gusev/heightmap.png',
        textureUrl: 'assets/gusev/albedo.jpg',
        // Baked from `gdalinfo -stats` on the real cropped DTM
        // (prep_site.sh gusev, run 2026-07-25). 114m relief: the basalt
        // plains up into the Columbia Hills massif.
        elevMin: -1950.3997802734,
        elevMax: -1836.0093994141,
        // 6km x 6km centered at (175.50523E, 14.59151S) — the MIDPOINT of
        // Spirit's mission arc rather than its landing site. Centering on
        // the landing clipped the Columbia Hills off the east edge (78m
        // relief); this framing holds both ends of the real 4.7km drive.
        worldSize: 6000,
        // Same 20m-DTM source class as Jezero, so the same density: 384
        // desktop segments = 15.6m quads, at the DEM's native limit.
        segments: { desktop: 384, mobile: 128 },
        center: { lon: 175.50523, lat: -14.59151 },
        // Spirit touchdown (UTC) — drives the live mission sol counter.
        landingUtc: '2004-01-04T04:35:00Z',
        // CTX-derived ortho is grayscale — multiply in the Mars-rust tint.
        tint: 0xc98a5e,
        // Columbia Memorial Station (175.4729E, 14.5692S — the published
        // landing coordinate, and this AOI's world frame reproduces it
        // exactly). Heading faces ESE so W drives the real traverse:
        // out of the plains and up into the hills.
        spawn: { x: -1916, z: -1323, heading: 4.1096 },
        // Plan 28's opening step sends the player to Ariana; line two names
        // this site's three surveyZones (see the Jezero note).
        briefing: [
            'Ariana: Welcome to Gusev Crater. I\'ve been watching this site since the landing — the cratered plains, the dust devils, and the hills a rover took two years to climb.',
            'This is where Spirit found carbonates and silica laid down by hot water. The Bonneville plains, Husband Hill, the southern hills — each tells a chapter of the story.',
        ],
        // Recon scouting targets along Spirit's actual traverse: the landing
        // plains, the summit it spent two years reaching, and the southern
        // hills beyond Home Plate.
        surveyZones: [
            { id: 'bonneville-plains', x: -1710, z: -1930, radius: 200 }, // landing plains
            { id: 'husband-hill', x: 1910, z: 1310, radius: 220 },        // summit massif
            { id: 'southern-hills', x: 1710, z: 2450, radius: 200 },      // southern ridge
        ],
        photoSpots: [
            { id: 'memorial-station', name: 'Columbia Memorial Station', x: -1916, z: -1323, note: 'Where Spirit landed — named for the Columbia STS-107 crew' },
            { id: 'husband-hill', name: 'Husband Hill', x: 1910, z: 1310, note: 'The summit Spirit spent two years climbing — 114m above the plains' },
            { id: 'home-plate', name: 'Home Plate', x: 1250, z: 70, note: 'Layered plateau built by a hydrovolcanic explosion' },
            { id: 'mccool-hill', name: 'McCool Hill', x: 2710, z: 2010, note: 'Southern massif of the Columbia Hills range' },
        ],
        missions: ['tutorial', 'survey', 'photo'],
        hq: { name: 'Signal Gusev Station' },
        // Gusev is THE dust-devil site — Spirit's solar panels were
        // repeatedly cleaned by passing vortices, which is why its mission
        // outlived its 90-sol design life by six years. Highest storm peak
        // of any site we ship. Soft sand sits on real drift: the El Dorado
        // ripple field and the Tyrone sulfate soils that mired the rover.
        hazards: {
            softSand: [
                { x: 2090, z: 410, r: 190, intensity: 0.7 },    // El Dorado ripples
                { x: 1230, z: -830, r: 170, intensity: 0.6 },   // Tyrone bright soils
                { x: -1110, z: 1030, r: 200, intensity: 0.5 },  // western plains drift
            ],
            dustStorm: { peakIntensity: 0.75 },
        },
        samples: [
            { id: 'adirondack', name: 'Adirondack', x: -1850, z: -1250, note: 'First rock target, Feb 2004',
              finding: 'Unaltered olivine basalt — the crater floor is lava, not the lakebed sediment the site was chosen for.',
              outpost: { name: 'Adirondack Checkpost' } },
            { id: 'bonneville', name: 'Bonneville Crater', x: -1700, z: -1500, note: '200m impact crater east of the landing',
              finding: 'The impact excavated only more basalt — the plains are a lava veneer sealing whatever lies beneath.',
              outpost: { name: 'Bonneville Checkpost' } },
            { id: 'clovis', name: 'Clovis', x: 1420, z: 900, note: 'First strongly altered rock in the hills',
              finding: 'Goethite — an iron hydroxide that forms only in the presence of water. The first hard proof of water at Gusev.',
              outpost: { name: 'Clovis Checkpost' } },
            { id: 'wishstone', name: 'Wishstone', x: 1620, z: 1100, note: 'Husband Hill volcaniclastic rock',
              finding: 'Unusually phosphorus-rich volcaniclastic rock — ash reworked by water on the flank of the hills.' },
            { id: 'husband-hill', name: 'Husband Hill', x: 1910, z: 1310, note: 'Summit reached Aug 2005',
              finding: 'Layered, tilted outcrops all the way up — the Columbia Hills are older than the lava plains that lap against them.',
              outpost: { name: 'Husband Hill Checkpost' } },
            { id: 'comanche', name: 'Comanche', x: 2180, z: 1520, note: 'Carbonate outcrop on the eastern flank',
              finding: 'Roughly a quarter magnesium-iron carbonate — precipitated from neutral-pH water, not the acid brines seen elsewhere on Mars.' },
            { id: 'home-plate', name: 'Home Plate', x: 1250, z: 70, note: 'Layered plateau, explored 2006',
              finding: 'A bomb sag in the layering — a rock lobbed by a hydrovolcanic explosion landed in soft ash: water met magma here.',
              outpost: { name: 'Home Plate Checkpost' } },
            { id: 'troy', name: 'Troy', x: 1080, z: 180, note: 'Where Spirit mired for good, 2009',
              finding: 'Nearly pure opaline silica — a hot-spring or fumarole deposit, and one of the strongest habitability signals of the mission.',
              outpost: { name: 'Troy Checkpost' } },
            { id: 'tyrone', name: 'Tyrone', x: 1230, z: -830, note: 'Bright soils churned up by a dragging wheel',
              finding: 'Ferric sulfate salts hidden under the surface — Spirit’s broken wheel ploughed up subsurface water chemistry by accident.' },
            { id: 'el-dorado', name: 'El Dorado', x: 2090, z: 410, note: 'Dark basaltic ripple field',
              finding: 'Remarkably well-sorted basaltic sand — a clean record of wind grading grains on the hills’ lee side.' },
            { id: 'mccool-hill', name: 'McCool Hill', x: 2710, z: 2010, note: 'Southern massif (approx. location)',
              finding: 'Steep basaltic slopes named for the Columbia crew — the winter haven Spirit drove for as power ran low.' },
            { id: 'southern-ridge', name: 'Southern Ridge', x: 1710, z: 2450, note: 'Survey station — simulated survey target',
              finding: '[SIM] Panoramic survey south of Home Plate — the Columbia Hills range running on beyond the rover’s reach.' },
            // No cone/beacon here: recon must map the southern-hills zone
            // first, then the humanoid cores this buried patch.
            { id: 'gusev-subsurface-core', name: 'Gusev Subsurface Core', x: 1620, z: 2330,
              note: '[SIM] Buried ridge-flank core — localized by aerial survey',
              finding: '[SIM] Sulfate-cemented ash preserved beneath the ridge flank — the wet, altered rock the plains basalt hides everywhere else.',
              buried: { surveyZone: 'southern-hills' } },
        ],
    },
    syrtis: {
        id: 'syrtis',
        name: 'NE Syrtis',
        // No lander has ever been here — it was Jezero's closest rival for
        // Mars 2020 and lost. Everything known about it came from orbit.
        mission: 'MRO survey · unflown',
        heightmapUrl: 'assets/syrtis/heightmap.png',
        textureUrl: 'assets/syrtis/albedo.jpg',
        // Baked from `gdalinfo -stats` (prep_site.sh syrtis, 2026-07-25).
        // 940m relief — by far the most vertical site we ship.
        elevMin: -4881.8115234375,
        elevMax: -3941.2958984375,
        // 6km x 6km at (21.90430W, 21.65871N), chosen by scanning the whole
        // 37x46km DTM for the 6km window with the most relief. Slopes stay
        // drivable: median 7.3deg, p90 18.3deg, only 2.7% over 25deg.
        worldSize: 6000,
        segments: { desktop: 384, mobile: 128 },
        center: { lon: -21.90430, lat: 21.65871 },
        // This site has no landing to count from, so the sol clock runs from
        // Mars Reconnaissance Orbiter's orbit insertion — the spacecraft
        // whose CTX/CRISM data is the only reason we know anything here.
        landingUtc: '2006-03-10T21:24:00Z',
        tint: 0xc98a5e,
        // Spawn low on the basin floor in the NW, facing SE so W drives the
        // full climb: carbonate basin -> scarp face -> Syrtis lava plateau.
        spawn: { x: -2400, z: -600, heading: 4.1333 },
        briefing: [
            'Ariana: Welcome to NE Syrtis. No one has ever landed here — we are the first. The basin floor below us, the scarp above it, and the old lava plateau on the skyline.',
            'Orbiters found carbonates and clays here, cooked by warm water. The carbonate basin, the scarp face, the Syrtis plateau — each tells a chapter of the story.',
        ],
        surveyZones: [
            { id: 'carbonate-basin', x: -2200, z: -2200, radius: 200 }, // basin floor
            { id: 'scarp-face', x: 990, z: 1290, radius: 220 },         // mid-scarp
            { id: 'syrtis-plateau', x: 2600, z: 2600, radius: 200 },    // capping lavas
        ],
        photoSpots: [
            { id: 'carbonate-basin', name: 'Carbonate Basin', x: -2200, z: -2200, note: 'Olivine-carbonate bedrock — the reason this site was a finalist' },
            { id: 'scarp-face', name: 'The Scarp', x: 990, z: 1290, note: 'Four billion years of stratigraphy exposed in one climb' },
            { id: 'syrtis-plateau', name: 'Syrtis Plateau', x: 2600, z: 2600, note: 'Young Syrtis Major lavas capping the whole sequence' },
            { id: 'north-bench', name: 'North Bench', x: 2800, z: -1400, note: 'Fractured bench cut by the Nili Fossae trough system' },
        ],
        missions: ['tutorial', 'survey', 'photo'],
        hq: { name: 'Signal Syrtis Station' },
        hazards: {
            softSand: [
                { x: -1990, z: -2070, r: 200, intensity: 0.6 },  // basin floor sands
                { x: -500, z: 300, r: 180, intensity: 0.5 },     // scarp-base talus
                { x: 2400, z: 1800, r: 170, intensity: 0.55 },   // plateau drift
            ],
            dustStorm: { peakIntensity: 0.65 },
        },
        samples: [
            { id: 'olivine-carbonate', name: 'Olivine-Carbonate Bedrock', x: -2200, z: -2200, note: 'The unit that made this a finalist site',
              finding: 'Magnesium carbonate intergrown with olivine — rock that reacted with water and locked away CO₂ from a thicker early atmosphere.',
              outpost: { name: 'Carbonate Checkpost' } },
            { id: 'serpentine', name: 'Serpentine Outcrop', x: -1600, z: -1400, note: 'Altered ultramafic rock',
              finding: 'Serpentinized olivine — a reaction that releases hydrogen and can feed microbial life with no sunlight at all.',
              outpost: { name: 'Serpentine Checkpost' } },
            { id: 'megabreccia', name: 'Isidis Megabreccia', x: -900, z: -2400, note: 'Basement shattered by the Isidis impact',
              finding: 'House-sized blocks of crust thrown out by the Isidis impact — the deepest, oldest rock exposed anywhere at this site.' },
            { id: 'clay-unit', name: 'Fe/Mg Clay Unit', x: -300, z: -900, note: 'Smectite-bearing layer',
              finding: 'Iron-magnesium smectite clays — a long, quiet period of water-rock reaction before the lavas sealed it over.',
              outpost: { name: 'Clay Unit Checkpost' } },
            { id: 'scarp-face', name: 'The Scarp', x: 990, z: 1290, note: 'Mid-scarp stratigraphic section',
              finding: 'Carbonates, clays, sulfates and lava stacked in order in one cliff — the whole wet-to-dry history of Mars in a single climb.',
              outpost: { name: 'Scarp Checkpost' } },
            { id: 'layered-sulfates', name: 'Layered Sulfates', x: 1700, z: 700, note: 'Upper scarp evaporites',
              finding: 'Sulfate salts over the clays — the water that remained had turned acidic and was drying out for good.' },
            { id: 'nili-trough', name: 'Nili Fossae Trough', x: 2800, z: -1400, note: 'Graben concentric to Isidis (approx. location)',
              finding: 'A fracture torn open when the Isidis impact flexed the crust — and the plumbing that let hot water reach the surface.' },
            { id: 'syrtis-cap', name: 'Syrtis Major Cap', x: 2600, z: 2600, note: 'Capping lava unit',
              finding: 'Young Syrtis Major basalt flooding over everything — the lid that sealed and preserved the ancient record beneath.',
              outpost: { name: 'Syrtis Cap Checkpost' } },
            { id: 'talus-apron', name: 'Talus Apron', x: -500, z: 300, note: 'Scarp-base debris fan',
              finding: 'Blocks shed from every layer above, collected in one fan — a free sample of the entire section without the climb.' },
            { id: 'plateau-rim', name: 'Plateau Rim', x: 1990, z: 1970, note: 'Scarp crest (approx. location)',
              finding: 'The contact where lava meets altered bedrock — a hard line between a wet Mars and the dry one that followed.' },
            { id: 'basin-sands', name: 'Basin Sands', x: -1990, z: -2070, note: 'Aeolian survey — simulated survey target',
              finding: '[SIM] Dark basaltic sand pooled on the basin floor, sorted and re-sorted by wind funnelling along the scarp.' },
            { id: 'north-bench', name: 'North Bench', x: 2400, z: -2100, note: 'Survey station — simulated survey target',
              finding: '[SIM] Fractured bench above the trough — clear line of sight down the whole fossae system.' },
            // Recon must map the scarp-face zone before this can be cored.
            { id: 'syrtis-subsurface-core', name: 'Syrtis Subsurface Core', x: 1120, z: 1420,
              note: '[SIM] Buried scarp-face core — localized by aerial survey',
              finding: '[SIM] Unweathered carbonate sealed under the talus — the pristine version of the surface rock, never touched by the dry air.',
              buried: { surveyZone: 'scarp-face' } },
        ],
    },
    insight: {
        id: 'insight',
        name: 'Elysium Planitia',
        mission: 'InSight · Discovery 12',
        heightmapUrl: 'assets/insight/heightmap.png',
        textureUrl: 'assets/insight/albedo.jpg',
        // Baked from `gdalinfo -stats` (prep_site.sh insight, 2026-07-25).
        // 67m relief — the flattest site we ship, on purpose.
        elevMin: -2654.8498535156,
        elevMax: -2587.8413085938,
        // 6km x 6km centered EXACTLY on the lander (135.6234E, 4.5024N),
        // so world (0,0) IS InSight. Elysium was chosen by NASA for being
        // the dullest, flattest ground on Mars — InSight was a stationary
        // geophysics station, so a boring surface was the requirement.
        // That makes this the one site where the terrain is not the point:
        // what happened here happened 3000km underneath it.
        worldSize: 6000,
        segments: { desktop: 384, mobile: 128 },
        center: { lon: 135.62263, lat: 4.50239 },
        // InSight touchdown (UTC) — drives the live mission sol counter.
        landingUtc: '2018-11-26T19:52:59Z',
        tint: 0xc98a5e,
        // Spawn ON the lander, facing west toward the low ridge — the only
        // relief worth driving to.
        spawn: { x: 0, z: 0, heading: Math.PI / 2 },
        briefing: [
            'Ariana: Welcome to Elysium Planitia. I have been listening here since the landing — the flattest ground on Mars, picked so a lander could sit still and listen.',
            'InSight measured this planet\'s core and crust from this exact spot. The western ridge, the eastern hollows, the northern flats — each tells a chapter of the story.',
        ],
        surveyZones: [
            { id: 'western-ridge', x: -2570, z: 990, radius: 200 },
            { id: 'eastern-hollows', x: 2390, z: 870, radius: 220 },
            { id: 'northern-flats', x: 2270, z: -1830, radius: 200 },
        ],
        photoSpots: [
            { id: 'homestead-hollow', name: 'Homestead Hollow', x: 0, z: 0, note: 'The filled-in crater InSight landed in — and never left' },
            { id: 'western-ridge', name: 'Western Ridge', x: -2570, z: 990, note: 'The highest ground for kilometres: all of 67 metres' },
            { id: 'eastern-hollows', name: 'Eastern Hollows', x: 2390, z: 870, note: 'Degraded craters softened into shallow bowls' },
            { id: 'cerberus-bearing', name: 'Cerberus Bearing', x: 2270, z: -1830, note: 'The direction most marsquakes arrived from' },
        ],
        missions: ['tutorial', 'survey', 'photo'],
        hq: { name: 'Signal Elysium Station' },
        // The soil here is the story: HP³ failed because Elysium regolith
        // cements into duricrust instead of collapsing, and dust on the
        // solar panels is what finally ended the mission.
        hazards: {
            softSand: [
                { x: 1200, z: 400, r: 190, intensity: 0.6 },     // loose fines
                { x: -1800, z: 1600, r: 180, intensity: 0.5 },   // ridge-foot drift
                { x: 2270, z: -1830, r: 170, intensity: 0.55 },  // northern dust
            ],
            dustStorm: { peakIntensity: 0.7 },
        },
        samples: [
            { id: 'homestead-hollow', name: 'Homestead Hollow', x: 0, z: 0, note: 'The hollow InSight landed in',
              finding: 'Sandy regolith almost free of rocks — an old crater filled and smoothed flat, which is exactly why it was safe to land here.',
              outpost: { name: 'Homestead Checkpost' } },
            { id: 'seis', name: 'SEIS Emplacement', x: 70, z: 90, note: 'The seismometer, placed by robotic arm',
              finding: 'Over 1,300 marsquakes recorded — the first time anyone listened to the inside of another planet.',
              outpost: { name: 'SEIS Checkpost' } },
            { id: 'hp3-mole', name: 'HP³ Mole Site', x: -90, z: 120, note: 'The heat probe that never got down',
              finding: 'The mole stalled near 40cm: this soil cements into duricrust rather than collapsing, so it never gripped the probe.',
              outpost: { name: 'Mole Site Checkpost' } },
            { id: 'duricrust', name: 'Duricrust Layer', x: 620, z: -410, note: 'Salt-cemented surface crust',
              finding: 'Regolith glued together by salts — thin films of water touched this ground long after the rivers were gone.' },
            { id: 'core-shadow', name: 'Core Shadow Zone', x: -1690, z: -430, note: 'Seismic ray-path station (approx. location)',
              finding: 'Waves reflecting off a liquid core about 1,830km in radius — Mars has a molten heart, larger than anyone expected.',
              outpost: { name: 'Core Shadow Checkpost' } },
            { id: 'crustal-boundary', name: 'Crustal Boundary', x: -2570, z: 990, note: 'Crust-thickness station (approx. location)',
              finding: 'A crust 20–37km thick in layers beneath this spot — the first direct measurement of another planet\'s crust.' },
            { id: 'cerberus-fossae', name: 'Cerberus Bearing', x: 2270, z: -1830, note: 'Marsquake source bearing (approx. location)',
              finding: 'Most quakes arrive from Cerberus Fossae, 1,600km away — Mars is not tectonically dead, just very quiet.',
              outpost: { name: 'Cerberus Checkpost' } },
            { id: 's1222a', name: 'Marsquake S1222a', x: 1500, z: -1200, note: 'Largest quake recorded, May 2022',
              finding: 'Magnitude 4.7, ringing the planet for six hours — energy enough to survey the whole crust in one event.' },
            { id: 'impact-ejecta', name: 'Impact Ejecta', x: -2100, z: -1500, note: 'Fresh meteoroid strike (approx. location)',
              finding: 'A strike both heard by SEIS and photographed from orbit — the first impact on Mars pinned down by sound and sight together.' },
            { id: 'eastern-hollows', name: 'Eastern Hollows', x: 2390, z: 870, note: 'Degraded crater field',
              finding: 'Craters worn down to shallow dishes — this plain has been quietly erasing its own history for three billion years.' },
            { id: 'dust-drift', name: 'Dust Drift', x: 1200, z: 400, note: 'Aeolian survey — simulated survey target',
              finding: '[SIM] The fine dust that settled on InSight\'s panels year after year, until there was not enough power to listen any more.' },
            { id: 'northern-station', name: 'Northern Station', x: 1900, z: -2400, note: 'Survey station — simulated survey target',
              finding: '[SIM] Open sightlines north across the plain — nothing to block a horizon this flat.' },
            // Recon must map the eastern-hollows zone before this can be cored.
            { id: 'elysium-subsurface-core', name: 'Elysium Subsurface Core', x: 2500, z: 990,
              note: '[SIM] Buried hollow-floor core — localized by aerial survey',
              finding: '[SIM] Layered fill beneath a buried crater floor — the sediment record this plain smoothed over and hid.',
              buried: { surveyZone: 'eastern-hollows' } },
        ],
    },
    meridiani: {
        id: 'meridiani',
        name: 'Meridiani Planum',
        mission: 'Opportunity · MER-B',
        heightmapUrl: 'assets/meridiani/heightmap.png',
        textureUrl: 'assets/meridiani/albedo.jpg',
        // Baked from `gdalinfo -stats` (prep_site.sh meridiani, 2026-07-25).
        // Integers because the HRSC/MOLA blend is Int16, not Float32.
        elevMin: -1958,
        elevMax: -1285,
        // The first REGIONAL site (see prep_site.sh): Meridiani has no
        // high-res DEM, only the 200m global blend, so a 6km crop would be
        // 30 elevation samples across — a featureless blob. At 30km the same
        // DEM gives 150 samples AND the crop spans Opportunity's real
        // 14-year drive: Eagle Crater in the NW out to Endeavour in the SE.
        worldSize: 30000,
        // 512 desktop = 58.6m quads, still 3.4x finer than the 200m DEM.
        // Going finer would only interpolate detail the data does not have.
        segments: { desktop: 512, mobile: 128 },
        center: { lon: -5.34800, lat: -2.11300 },
        // Opportunity touchdown (UTC) — drives the live mission sol counter.
        landingUtc: '2004-01-25T05:05:00Z',
        // CTX quad is grayscale — multiply in the Mars-rust tint.
        tint: 0xc98a5e,
        // Eagle Crater, the 22m crater Opportunity bounced into — the
        // "interplanetary hole in one". Heading SE so W drives the traverse.
        spawn: { x: -10586, z: -9887, heading: 3.9596 },
        briefing: [
            'Ariana: Welcome to Meridiani Planum. I have been watching since the landing — flat dark plains, and one rover that drove forty-five kilometres across them.',
            'This is where Opportunity proved an ancient sea once stood here. The Eagle plains, Victoria Crater, the Endeavour rim — each tells a chapter of the story.',
        ],
        // Zone radii scale with worldSize: 900 here is the same fraction of
        // the map as Jezero's 200 is of its 6km.
        surveyZones: [
            { id: 'eagle-plains', x: -10586, z: -9887, radius: 900 },
            { id: 'victoria', x: -10195, z: -3734, radius: 900 },
            { id: 'endeavour-rim', x: 5500, z: 7000, radius: 1000 },
        ],
        photoSpots: [
            { id: 'eagle-crater', name: 'Eagle Crater', x: -10586, z: -9887, note: 'A 22m crater Opportunity bounced into — an interplanetary hole in one' },
            { id: 'victoria-crater', name: 'Victoria Crater', x: -10195, z: -3734, note: '750m of scalloped cliffs, the deepest section of the first years' },
            { id: 'endeavour-rim', name: 'Endeavour Rim', x: 5500, z: 7000, note: 'Rim of a 22km crater — the drive that took eight years' },
            { id: 'endeavour-floor', name: 'Endeavour Floor', x: 10551, z: 9899, note: 'The deep interior, 670m below the plains' },
        ],
        missions: ['tutorial', 'survey', 'photo'],
        hq: { name: 'Signal Meridiani Station' },
        // Meridiani is a sand-ripple plain: Opportunity spent five weeks
        // bogged in "Purgatory Dune" in 2005. And the 2018 global dust storm
        // is what finally killed the rover — hence the highest storm peak
        // of any site we ship.
        hazards: {
            softSand: [
                { x: -9500, z: -7000, r: 800, intensity: 0.75 },  // Purgatory Dune
                { x: 0, z: -3000, r: 700, intensity: 0.5 },       // open ripple field
                { x: 11000, z: 11000, r: 900, intensity: 0.6 },   // Endeavour floor sands
            ],
            dustStorm: { peakIntensity: 0.9 },
        },
        samples: [
            { id: 'eagle-outcrop', name: 'Eagle Crater Outcrop', x: -10586, z: -9887, note: 'The first bedrock seen up close on Mars',
              finding: 'Layered sulfate bedrock in the crater wall — sediment laid down in standing water, found within days of landing.',
              outpost: { name: 'Eagle Checkpost' } },
            { id: 'blueberries', name: 'Hematite Concretions', x: -10400, z: -9700, note: 'The "blueberries"',
              finding: 'Hematite spherules weathering out of the rock — they grew inside water-soaked sediment, grain by grain.',
              outpost: { name: 'Blueberry Checkpost' } },
            { id: 'endurance', name: 'Endurance Crater', x: -9800, z: -9400, note: '130m crater, explored 2004',
              finding: 'Seven metres of layered rock in one wall — a long read of an acidic, evaporating sea that came and went.',
              outpost: { name: 'Endurance Checkpost' } },
            { id: 'heat-shield-rock', name: 'Heat Shield Rock', x: -9000, z: -8600, note: 'Beside the discarded heat shield',
              finding: 'An iron-nickel meteorite — the first meteorite ever identified on the surface of another planet.' },
            { id: 'purgatory-dune', name: 'Purgatory Dune', x: -9500, z: -7000, note: 'Where Opportunity bogged in 2005',
              finding: 'A ripple of fine basaltic sand deep enough to bury the wheels — five weeks of careful reversing to escape.' },
            { id: 'erebus', name: 'Erebus Crater', x: -10000, z: -6500, note: 'Eroded crater, 2005-06',
              finding: 'Cross-bedded sandstone — wind-blown dunes that were later soaked, cemented and turned to rock.' },
            { id: 'victoria', name: 'Victoria Crater', x: -10195, z: -3734, note: '750m crater, explored 2006-08',
              finding: 'Scalloped capes and bays exposing the thickest stack of layers yet — the sea record ran deeper than anyone expected.',
              outpost: { name: 'Victoria Checkpost' } },
            { id: 'santa-maria', name: 'Santa Maria Crater', x: -8000, z: -1500, note: 'Waypoint crater, 2010-11 (approx. location)',
              finding: 'Hydrated sulfate salts detected from orbit and confirmed on the ground — water chemistry preserved in the rim rock.' },
            { id: 'cape-york', name: 'Cape York', x: 4000, z: 4000, note: 'Endeavour rim segment, reached 2011',
              finding: 'Esperance: aluminium-rich clay formed in NEUTRAL water — drinkable, unlike the acid that made everything else here.',
              outpost: { name: 'Cape York Checkpost' } },
            { id: 'marathon-valley', name: 'Marathon Valley', x: 5500, z: 7000, note: 'Rim valley, 2015-16',
              finding: 'Clay minerals right where orbiters predicted them — and the point where the odometer passed a full marathon.',
              outpost: { name: 'Marathon Checkpost' } },
            { id: 'perseverance-valley', name: 'Perseverance Valley', x: 4500, z: 8500, note: 'Where the mission ended, June 2018',
              finding: 'A carved channel on the rim, half surveyed when a global dust storm blacked out the sky and the last signal came: my battery is low.' },
            { id: 'endeavour-floor', name: 'Endeavour Floor', x: 10551, z: 9899, note: 'Crater interior — simulated survey target',
              finding: '[SIM] The deep floor of a 22km impact basin, 670m below the plains — the lowest ground for a hundred kilometres.' },
            // Recon must map the endeavour-rim zone before this can be cored.
            { id: 'meridiani-subsurface-core', name: 'Meridiani Subsurface Core', x: 6100, z: 7600,
              note: '[SIM] Buried rim-flank core — localized by aerial survey',
              finding: '[SIM] Clay-bearing rim rock sealed beneath the sulfate blanket — the older, gentler water chemistry the acid never reached.',
              buried: { surveyZone: 'endeavour-rim' } },
        ],
    },
    olympus: {
        id: 'olympus',
        name: 'Olympus Mons',
        // No lander, ever. Mariner 9 found it through a global dust storm in
        // 1971 — the only thing visible was this summit poking out above the
        // dust, which is how it earned the name.
        mission: 'Mariner 9 survey · unflown',
        heightmapUrl: 'assets/olympus/heightmap.png',
        textureUrl: 'assets/olympus/albedo.jpg',
        // Baked from `gdalinfo -stats` (prep_site.sh olympus, 2026-07-26).
        // POSITIVE elevations — every other site we ship sits below the
        // datum; this one is the summit of the tallest volcano in the
        // solar system. 3407m of caldera wall.
        elevMin: 17629,
        elevMax: 21036,
        // 90km x 90km framing the whole nested caldera complex (~78km
        // across) with its rim just inside. The centre was found by
        // IMAGING the DEM: the textbook coordinate clipped the caldera into
        // a corner, and the DEM's global maximum is a flank high ~90km away.
        worldSize: 90000,
        // 512 = 176m quads, matched to the 200m DEM. Going finer would only
        // interpolate detail the data does not contain.
        segments: { desktop: 512, mobile: 128 },
        center: { lon: -133.1678, lat: 18.3271 },
        // Mariner 9 orbit insertion — the moment this mountain was found.
        landingUtc: '1971-11-14T00:17:39Z',
        tint: 0xc98a5e,
        // Spawn on the main caldera floor, facing the northeast vent.
        spawn: { x: -14240, z: 1580, heading: 5.3797 },
        briefing: [
            'Ariana: Welcome to Olympus Mons — twenty-one kilometres up, the summit of the largest volcano in the solar system, with barely any air left above us.',
            'Six calderas collapsed here as the magma beneath drained away. The main caldera, the northeast vent, the southwest vent — each tells a chapter of the story.',
        ],
        surveyZones: [
            { id: 'main-caldera', x: -14240, z: 1580, radius: 2500 },
            { id: 'northeast-vent', x: 21450, z: -26540, radius: 2500 },
            { id: 'southwest-vent', x: -22150, z: 22680, radius: 2500 },
        ],
        photoSpots: [
            { id: 'main-caldera', name: 'Main Caldera', x: -14240, z: 1580, note: 'The largest collapse basin — floor 3km below the rim' },
            { id: 'northeast-vent', name: 'Northeast Vent', x: 21450, z: -26540, note: 'The youngest and deepest of the nested craters' },
            { id: 'southwest-vent', name: 'Southwest Vent', x: -22150, z: 22680, note: 'An older collapse, half-buried by later flows' },
            { id: 'summit-rim', name: 'Summit Rim', x: 34980, z: 30590, note: 'The high rim — 21km above datum, above most of the atmosphere' },
        ],
        missions: ['tutorial', 'survey', 'photo'],
        hq: { name: 'Signal Olympus Station' },
        // Air pressure up here is roughly a tenth of the Martian datum, so
        // there is very little atmosphere to lift dust: the lowest storm
        // peak of any site we ship. The summit is mantled in fine fallout
        // dust instead — soft, but never blown into real storms.
        hazards: {
            softSand: [
                { x: 0, z: -15000, r: 2500, intensity: 0.6 },      // dust-mantled bench
                { x: -25000, z: -9840, r: 2200, intensity: 0.5 },  // western fallout
                { x: 15000, z: 20000, r: 2400, intensity: 0.55 },  // southern drift
            ],
            dustStorm: { peakIntensity: 0.35 },
        },
        samples: [
            { id: 'caldera-floor', name: 'Caldera Floor', x: -14240, z: 1580, note: 'Youngest lava on the mountain',
              finding: 'Flows so sparsely cratered they may be only a few million years old — by Martian standards, this volcano is barely cold.',
              outpost: { name: 'Caldera Checkpost' } },
            { id: 'collapse-rim', name: 'Nested Collapse Rim', x: -9000, z: -6000, note: 'Where two calderas overlap',
              finding: 'Six craters cut into each other — each one a magma chamber that emptied and let its own roof founder in.',
              outpost: { name: 'Collapse Rim Checkpost' } },
            { id: 'northeast-vent', name: 'Northeast Vent', x: 21450, z: -26540, note: 'Deepest of the nested craters',
              finding: 'The youngest collapse, cutting cleanly through all the others — the last time this mountain emptied itself.',
              outpost: { name: 'Northeast Vent Checkpost' } },
            { id: 'southwest-vent', name: 'Southwest Vent', x: -22150, z: 22680, note: 'Older collapse basin',
              finding: 'An early caldera, its rim softened and partly drowned by flows from the eruptions that followed it.' },
            { id: 'terraced-wall', name: 'Terraced Wall', x: -18000, z: 9000, note: 'Concentric wall benches',
              finding: 'Stair-stepped terraces around the wall — the floor dropped repeatedly, not once, each step a separate collapse.',
              outpost: { name: 'Terrace Checkpost' } },
            { id: 'wrinkle-ridges', name: 'Wrinkle Ridges', x: 9490, z: -1050, note: 'Compressional ridges on the floor',
              finding: 'Ridges squeezed up as the cooling floor sagged and shortened — the caldera settling under its own weight.' },
            { id: 'summit-rim', name: 'Summit Rim', x: 34980, z: 30590, note: 'High rim, ~21km above datum',
              finding: 'Air pressure here is about a tenth of the plains below: high enough that the sky darkens and dust can barely rise.',
              outpost: { name: 'Summit Rim Checkpost' } },
            { id: 'dust-mantle', name: 'Dust Mantle', x: 0, z: -15000, note: 'Fine fallout deposit',
              finding: 'Metres of fine dust settled out of a thin sky — too little air up here to ever blow it away again.' },
            { id: 'lava-channel', name: 'Lava Channel', x: -30000, z: 5000, note: 'Leveed flow channel (approx. location)',
              finding: 'A channel with built-up levees — lava ran in rivers here, insulated by its own crust, for hundreds of kilometres.' },
            { id: 'chamber-roof', name: 'Magma Chamber Roof', x: -5000, z: 12000, note: 'Structural centre of the complex',
              finding: 'The whole complex sits over one shallow chamber, refilling and draining for a billion years or more.' },
            { id: 'north-rim', name: 'North Rim', x: -1050, z: -37090, note: 'Survey station — simulated survey target',
              finding: '[SIM] The rim crest running away north, with the flank dropping out of sight below the horizon.' },
            { id: 'west-bench', name: 'West Bench', x: -34450, z: -9840, note: 'Survey station — simulated survey target',
              finding: '[SIM] A broad structural bench outside the caldera wall, mantled in dust and undisturbed since it formed.' },
            // Recon must map the main-caldera zone before this can be cored.
            { id: 'olympus-subsurface-core', name: 'Olympus Subsurface Core', x: -12800, z: 3400,
              note: '[SIM] Buried caldera-floor core — localized by aerial survey',
              finding: '[SIM] Layered flows stacked under the caldera floor — eruption after eruption, recorded in order beneath the youngest crust.',
              buried: { surveyZone: 'main-caldera' } },
        ],
    },
    hellas: {
        id: 'hellas',
        name: 'Hellas Planitia',
        mission: 'MGS survey · unflown',
        heightmapUrl: 'assets/hellas/heightmap.png',
        textureUrl: 'assets/hellas/albedo.jpg',
        // Baked from `gdalinfo -stats` (prep_site.sh hellas, 2026-07-26).
        // 3268m of relief, and the only site that crosses the datum:
        // -694m on the basin side up to +2574m on the rim highlands.
        elevMin: -694,
        elevMax: 2574,
        // 30km x 30km at (102.97E, 39.56S), on the EASTERN RIM of the Hellas
        // basin. RELOCATED from the old locked pin at (70E, 42.4S), which
        // has no CTX coverage at all — the Hellas exploration-zone mosaics
        // sit at 99.66-106.28E / 37.32-41.81S, so the site moved onto real
        // 5m imagery instead of shipping a Viking-resolution blur.
        // Despite the relief this is the gentlest of the regional sites:
        // slopes run median 2.5deg, p90 14.1deg, only 1.6% over 25deg — a
        // long regional climb out of the basin, not a wall.
        worldSize: 30000,
        segments: { desktop: 512, mobile: 128 },
        center: { lon: 102.97, lat: -39.56 },
        // No lander here either. Mars Global Surveyor's MOLA is what
        // actually measured how deep this basin is, so the clock runs from
        // its orbit insertion.
        landingUtc: '1997-09-12T01:17:00Z',
        tint: 0xc98a5e,
        // Spawn low on the basin side, facing ENE so W drives up the rim.
        spawn: { x: -9000, z: 4000, heading: 5.2195 },
        briefing: [
            'Ariana: Welcome to the eastern rim of Hellas Planitia — the deepest basin on Mars, and the biggest hole any impact ever punched in this planet.',
            'The air down in the basin is thick enough for liquid water, briefly. The basin floor, the rim scarp, the eastern highlands — each tells a chapter of the story.',
        ],
        surveyZones: [
            { id: 'basin-floor', x: -11000, z: 9000, radius: 900 },
            { id: 'rim-scarp', x: 0, z: 0, radius: 1000 },
            { id: 'eastern-highlands', x: 11000, z: -9000, radius: 900 },
        ],
        photoSpots: [
            { id: 'basin-floor', name: 'Basin Floor', x: -11000, z: 9000, note: 'Looking down into the deepest place on Mars' },
            { id: 'rim-scarp', name: 'Rim Scarp', x: 0, z: 0, note: 'Three kilometres of climb out of the basin' },
            { id: 'eastern-highlands', name: 'Eastern Highlands', x: 11000, z: -9000, note: 'Ancient cratered terrain above the rim' },
            { id: 'dissected-valleys', name: 'Dissected Valleys', x: -8000, z: -11000, note: 'Branching valleys cut into the rim by running water' },
        ],
        missions: ['tutorial', 'survey', 'photo'],
        hq: { name: 'Signal Hellas Station' },
        hazards: {
            softSand: [
                { x: -11000, z: 9000, r: 900, intensity: 0.7 },   // basin-floor dust
                { x: 3000, z: 6000, r: 800, intensity: 0.55 },    // scarp-foot apron
                { x: 12000, z: -6000, r: 800, intensity: 0.5 },   // highland drift
            ],
            // Hellas is famous for breeding regional dust storms — the low,
            // dense air makes it one of the planet's storm nurseries.
            dustStorm: { peakIntensity: 0.85 },
        },
        samples: [
            { id: 'basin-floor', name: 'Basin Floor Deposits', x: -11000, z: 9000, note: 'Lowest ground in the crop',
              finding: 'Layered fill on the floor of a basin seven kilometres deep — sediment, ice and dust stacked since the impact that made it.',
              outpost: { name: 'Basin Floor Checkpost' } },
            { id: 'rim-scarp', name: 'Rim Scarp', x: 0, z: 0, note: 'The main climb',
              finding: 'Three kilometres of section in one slope — crust uplifted and overturned by the impact, then cut back by erosion.',
              outpost: { name: 'Rim Scarp Checkpost' } },
            { id: 'dissected-valleys', name: 'Dissected Valleys', x: -8000, z: -11000, note: 'Branching valley networks',
              finding: 'Dendritic valleys cut into the rim — rain or meltwater ran down this slope when Mars still had weather.',
              outpost: { name: 'Valleys Checkpost' } },
            { id: 'eastern-highlands', name: 'Eastern Highlands', x: 11000, z: -9000, note: 'Ancient cratered terrain',
              finding: 'Some of the oldest surface on the planet — Noachian crust that has simply sat here for four billion years.',
              outpost: { name: 'Highlands Checkpost' } },
            { id: 'glacial-fill', name: 'Glacial Fill', x: -6000, z: 12000, note: 'Viscous flow features (approx. location)',
              finding: 'Lobed debris aprons that crept downhill like glaciers — buried ice, still there under a rind of rock.' },
            { id: 'impact-melt', name: 'Impact Melt Sheet', x: 6000, z: 10000, note: 'Basin-forming melt (approx. location)',
              finding: 'Rock melted outright by the impact and ponded as it cooled — the signature of a collision that nearly split the crust.' },
            { id: 'honeycomb', name: 'Honeycomb Terrain', x: -13000, z: 2000, note: 'Cellular basin-floor pattern (approx. location)',
              finding: 'A polygonal cell pattern unique to this basin — probably salt or ice diapirs rising slowly through the fill.' },
            { id: 'gullies', name: 'Rim Gullies', x: 4000, z: -8000, note: 'Young slope features',
              finding: 'Gullies far younger than the valleys above them — briny meltwater or dry debris flows, still argued over.' },
            { id: 'wind-streaks', name: 'Wind Streaks', x: 12000, z: -6000, note: 'Aeolian survey target',
              finding: 'Bright and dark streaks behind every crater, all pointing the same way — the prevailing wind, written across the highlands.' },
            { id: 'crater-cluster', name: 'Crater Cluster', x: 9000, z: 5000, note: 'Secondary crater field (approx. location)',
              finding: 'A tight cluster of secondaries — debris thrown from a much larger impact elsewhere, landing together.' },
            { id: 'scarp-apron', name: 'Scarp Apron', x: 3000, z: 6000, note: 'Debris fan — simulated survey target',
              finding: '[SIM] Material shed from the whole scarp and pooled at its foot — every layer above, sampled without the climb.' },
            { id: 'south-station', name: 'South Station', x: -2000, z: 13000, note: 'Survey station — simulated survey target',
              finding: '[SIM] Open sightline west across the basin, with the far rim below the horizon 1,500km away.' },
            // Recon must map the rim-scarp zone before this can be cored.
            { id: 'hellas-subsurface-core', name: 'Hellas Subsurface Core', x: 900, z: 1200,
              note: '[SIM] Buried scarp core — localized by aerial survey',
              finding: '[SIM] Ice-cemented breccia sealed inside the scarp — water still held in the rock, three kilometres above the basin floor.',
              buried: { surveyZone: 'rim-scarp' } },
        ],
    },
};

// Future landing sites — shown on the Site Hub globe (hub.js) as dim
// "COMING SOON" pins at their real coordinates, but NOT yet playable (no
// heightmap/albedo/samples). Kept OUT of SITES so getSiteFromUrl / startGame
// can never route into a site with no assets; the hub is the only consumer.
//
// A site listed in SITES must NOT also appear here — hub.js concatenates
// both lists into one pin array, so a duplicate id renders two overlapping
// pins on the globe (one playable, one greyed "COMING SOON"). Guarded by
// tests/e2e/test_site_parity.py.
//
// EMPTY as of plan 30: all three former "coming soon" pins (Hellas, Olympus
// Mons, Meridiani Planum) are now built and playable, alongside Gusev, NE
// Syrtis and Elysium Planitia. The array stays exported — hub.js spreads it
// unconditionally, and the next unbuilt body lands here.
export const LOCKED_SITES = [];

export function getSiteFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const id = params.get('site');
    return SITES[id] || null;
}
