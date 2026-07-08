/* ============================================================
   waypoint.js — glowing beacon column on the nearest uncollected
   sample, so TGT in the telemetry has a visible anchor in-world.

   Additive, depth-tested-but-not-written cylinder tall enough to
   read over ridgelines; pulses slowly. Repositions whenever the
   nearest target changes; hides when everything is collected.
   ============================================================ */

import * as THREE from 'three';

const BEACON_HEIGHT = 90;
const BEACON_RADIUS = 1.6;

export function createWaypoint(scene, terrain) {
    const mat = new THREE.MeshBasicMaterial({
        color: 0xe0b95e,
        transparent: true,
        opacity: 0.35,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
    });
    const beacon = new THREE.Mesh(
        new THREE.CylinderGeometry(BEACON_RADIUS, BEACON_RADIUS * 0.4, BEACON_HEIGHT, 12, 1, true),
        mat
    );
    beacon.name = 'waypoint-beacon';
    beacon.visible = false;
    scene.add(beacon);

    let currentId = null;
    let t = 0;

    /** targetInfo: { sample, dist } | null (from samples.nearestInfo). */
    function update(dt, targetInfo) {
        t += dt;
        if (!targetInfo) {
            beacon.visible = false;
            currentId = null;
            return;
        }
        const s = targetInfo.sample;
        if (s.id !== currentId) {
            currentId = s.id;
            const y = terrain.sampleHeight(s.x, s.z);
            beacon.position.set(s.x, y + BEACON_HEIGHT / 2, s.z);
        }
        beacon.visible = true;
        mat.opacity = 0.24 + 0.14 * (0.5 + 0.5 * Math.sin(t * 2.2));
    }

    return { update, _beacon: beacon };
}
