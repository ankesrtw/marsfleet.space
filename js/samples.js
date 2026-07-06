/* ============================================================
   samples.js — sample markers, proximity collection, inventory.

   4-6 hardcoded real mission sites per crater (see sites.js). Any
   ground unit (rover or humanoid; drone scouts but doesn't collect)
   within COLLECT_RADIUS of an uncollected marker triggers a HUD
   prompt. inventory[] holds the FULL sample object (not just an id)
   so a future lab-analysis phase can read it directly with no
   re-derivation needed — that's the intended extension point.
   ============================================================ */

import * as THREE from 'three';

const COLLECT_RADIUS = 8;

export function createSamples(site, terrain) {
    const group = new THREE.Group();
    group.name = 'samples';
    const inventory = [];

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

    function collect(sample) {
        sample.collected = true;
        sample._mesh.material.color.set(0x5ee08a);
        inventory.push({ ...sample, _mesh: undefined });
    }

    return { group, inventory, nearestUncollected, collect, markers: site.samples };
}
