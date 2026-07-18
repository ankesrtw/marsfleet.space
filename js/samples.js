/* ============================================================
   samples.js — sample markers, proximity collection, inventory,
   and the cache containers the collection leaves behind.

   4-6 hardcoded real mission sites per crater (see sites.js). Any
   ground unit (rover or humanoid; drone scouts but doesn't collect)
   within COLLECT_RADIUS of an uncollected marker triggers a HUD
   prompt. Collecting ALSO drops a sealed cache container at the
   site (MSR-style depot caching) — the lift drone slings those to
   the field lab (lab.js). inventory[] holds the FULL sample object
   so the lab-analysis phase reads it directly.
   ============================================================ */

import * as THREE from 'three';
import { attachStaticModel } from './models.js';

const COLLECT_RADIUS = 8;

// Procedural fallback container (fallback-first idiom, same as the units):
// a light box + orange lid, shown until sample-container.glb loads — and
// kept forever if it 404s / fails, so the sample loop plays offline.
const containerGeo = new THREE.BoxGeometry(0.56, 0.56, 0.56);
const containerMat = new THREE.MeshStandardMaterial({ color: 0xdadde3, metalness: 0.55, roughness: 0.35 });
const containerLidMat = new THREE.MeshStandardMaterial({ color: 0xe07b39, metalness: 0.3, roughness: 0.5 });

/** One cache-container object: an outer group the sling/lab freely rotate,
    with an inner group holding the procedural fallback that
    attachStaticModel swaps for the real GLB once it loads. Matches the
    outposts.js beacon-on-outer / model-on-inner split so a swap never
    disturbs the transform the sling drives. */
function makeContainerMesh() {
    const outer = new THREE.Group();
    const inner = new THREE.Group();
    // Base at y=0 to match attachStaticModel's grounding (model.position.y
    // -= box.min.y) — so the fallback and the swapped GLB rest identically,
    // and the sling/lab place the container by its BASE, not its center.
    const box = new THREE.Mesh(containerGeo, containerMat);
    box.position.y = 0.28;
    const lid = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.1, 0.6), containerLidMat);
    lid.position.y = 0.59;
    inner.add(box, lid);
    outer.add(inner);
    attachStaticModel(inner, 'sample-container');
    return outer;
}

export function createSamples(site, terrain) {
    const group = new THREE.Group();
    group.name = 'samples';
    const inventory = [];
    const containers = [];

    const markerGeo = new THREE.ConeGeometry(0.8, 2.2, 8);

    for (const s of site.samples) {
        // Wave 12.15: a buried core has no physical beacon at all. Recon
        // survey has to localize its named subsurface anomaly first; only
        // then can it participate in TGT/proximity collection. It remains
        // visually unmarked even after localization — the humanoid drills
        // at the surveyed coordinates, rather than walking to a cone.
        s.surveyed = !s.buried;
        s.collected = false;
        if (s.buried) continue;
        const mesh = new THREE.Mesh(
            markerGeo,
            new THREE.MeshStandardMaterial({ color: 0xe0b95e })
        );
        const y = terrain.sampleHeight(s.x, s.z);
        mesh.position.set(s.x, y + 1.1, s.z);
        mesh.userData.sampleId = s.id;
        group.add(mesh);
        s._mesh = mesh;
    }

    function available(sample) {
        return !sample.collected && (!sample.buried || sample.surveyed);
    }

    function nearestUncollected(position) {
        let nearest = null;
        let nearestDist = Infinity;
        for (const s of site.samples) {
            if (!available(s)) continue;
            const d = Math.hypot(position.x - s.x, position.z - s.z);
            if (d < nearestDist) {
                nearestDist = d;
                nearest = s;
            }
        }
        return nearestDist <= COLLECT_RADIUS ? nearest : null;
    }

    // Nearest uncollected sample at ANY distance (telemetry target readout).
    function nearestInfo(position) {
        let nearest = null;
        let nearestDist = Infinity;
        for (const s of site.samples) {
            if (!available(s)) continue;
            const d = Math.hypot(position.x - s.x, position.z - s.z);
            if (d < nearestDist) {
                nearestDist = d;
                nearest = s;
            }
        }
        return nearest ? { sample: nearest, dist: nearestDist } : null;
    }

    function collect(sample) {
        sample.collected = true;
        sample._mesh?.material.color.set(0x5ee08a);
        inventory.push({ ...sample, _mesh: undefined });

        // Leave a sealed cache container beside the marker for the lift
        // drone to sling out (lab.js). Offset so it doesn't z-fight the cone.
        const mesh = makeContainerMesh();
        const cx = sample.x + 1.6, cz = sample.z + 1.2;
        // Placed by BASE now (container grounds at y=0) — terrain height,
        // no half-height lift.
        mesh.position.set(cx, terrain.sampleHeight(cx, cz), cz);
        group.add(mesh);
        containers.push({ id: sample.id, name: sample.name, note: sample.note, finding: sample.finding, mesh, state: 'field' });
    }

    /** Reveal subsurface targets only once recon fog coverage reaches the
        zone's requested threshold. This is intentionally stateful so the
        caller can announce a newly located core exactly once. */
    function revealBuried(surveyZones, revealedFraction) {
        const newlySurveyed = [];
        for (const s of site.samples) {
            if (!s.buried || s.surveyed || s.collected) continue;
            const zone = surveyZones?.find((z) => z.id === s.buried.surveyZone);
            if (!zone || revealedFraction(zone) < (s.buried.revealAt ?? 0.65)) continue;
            s.surveyed = true;
            newlySurveyed.push(s);
        }
        return newlySurveyed;
    }

    /** Nearest field (not slung/delivered) container within `radius`. */
    function nearestContainer(position, radius) {
        let nearest = null;
        let nearestDist = Infinity;
        for (const c of containers) {
            if (c.state !== 'field') continue;
            const d = Math.hypot(position.x - c.mesh.position.x, position.z - c.mesh.position.z);
            if (d < nearestDist) {
                nearestDist = d;
                nearest = c;
            }
        }
        return nearestDist <= radius ? nearest : null;
    }

    return {
        group, inventory, containers, nearestUncollected, nearestInfo,
        nearestContainer, collect, revealBuried,
        // fog.render uses physical marker meshes; surveyed buried cores are
        // deliberately absent here, even while their TGT coordinates exist.
        get markers() { return site.samples.filter((s) => s._mesh); },
    };
}
