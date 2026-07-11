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

const COLLECT_RADIUS = 8;

const containerGeo = new THREE.BoxGeometry(0.56, 0.56, 0.56);
const containerMat = new THREE.MeshStandardMaterial({ color: 0xdadde3, metalness: 0.55, roughness: 0.35 });
const containerLidMat = new THREE.MeshStandardMaterial({ color: 0xe07b39, metalness: 0.3, roughness: 0.5 });

export function createSamples(site, terrain) {
    const group = new THREE.Group();
    group.name = 'samples';
    const inventory = [];
    const containers = [];

    const markerGeo = new THREE.ConeGeometry(0.8, 2.2, 8);

    for (const s of site.samples) {
        const mesh = new THREE.Mesh(
            markerGeo,
            new THREE.MeshStandardMaterial({ color: 0xe0b95e })
        );
        const y = terrain.sampleHeight(s.x, s.z);
        mesh.position.set(s.x, y + 1.1, s.z);
        mesh.userData.sampleId = s.id;
        group.add(mesh);
        s._mesh = mesh;
        s.collected = false;
    }

    function nearestUncollected(position) {
        let nearest = null;
        let nearestDist = Infinity;
        for (const s of site.samples) {
            if (s.collected) continue;
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
            if (s.collected) continue;
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
        sample._mesh.material.color.set(0x5ee08a);
        inventory.push({ ...sample, _mesh: undefined });

        // Leave a sealed cache container beside the marker for the lift
        // drone to sling out (lab.js). Offset so it doesn't z-fight the cone.
        const mesh = new THREE.Mesh(containerGeo, containerMat);
        const lid = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.1, 0.6), containerLidMat);
        lid.position.y = 0.31;
        mesh.add(lid);
        const cx = sample.x + 1.6, cz = sample.z + 1.2;
        mesh.position.set(cx, terrain.sampleHeight(cx, cz) + 0.28, cz);
        group.add(mesh);
        containers.push({ id: sample.id, name: sample.name, note: sample.note, finding: sample.finding, mesh, state: 'field' });
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

    return { group, inventory, containers, nearestUncollected, nearestInfo, nearestContainer, collect, markers: site.samples };
}
