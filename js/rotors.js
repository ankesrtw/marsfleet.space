/* ============================================================
   rotors.js — procedural spinning-rotor overlay for the drones.

   The Tripo GLBs are single fused meshes (rotors baked into the
   body), and a rotor-node re-export wasn't possible on this
   machine (no Blender; mesh-split tooling OOM'd). So rotor motion
   is an OVERLAY: four two-blade rotors + a speed-faded "motion
   blur" disc, placed at hub positions derived from the loaded
   model's bounding box (X-quad corner layout). Adjacent rotors
   counter-rotate like a real quad. Static baked rotors sit just
   below the spinning overlay; in motion the spin reads as the
   real thing.

   layout() is called twice per drone: once for the procedural
   fallback mesh (known hub positions) and again from the GLB
   onReady callback with box-derived hubs — attachUnitModel clears
   the group, so the rig re-adds itself after the swap.
   ============================================================ */

import * as THREE from 'three';

const SPIN_MAX = 55;        // rad/s at full effort — blades strobe, disc carries it
const SPIN_RESPONSE = 2.2;  // 1/s, spin-up/down smoothing

export function createRotorRig() {
    const group = new THREE.Group();
    group.name = 'rotor-rig';

    const bladeMat = new THREE.MeshStandardMaterial({ color: 0x1d1d1f, roughness: 0.6, metalness: 0.2 });
    const hubMat = new THREE.MeshStandardMaterial({ color: 0x3a3a3c, roughness: 0.5, metalness: 0.4 });
    const discMat = new THREE.MeshBasicMaterial({
        color: 0x151515,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
    });

    /** rotors: [{ pivot, dir }] — pivot spins around local Y. */
    let rotors = [];
    let spin = 0;        // current rad/s
    let phase = 0;

    /** (Re)build 4 rotors at the given hub points. radius = blade length. */
    function layout(hubs, radius) {
        for (const r of rotors) group.remove(r.pivot);
        rotors = hubs.map(([x, y, z], i) => {
            const pivot = new THREE.Group();
            pivot.position.set(x, y, z);

            const hub = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.12, radius * 0.14, radius * 0.16, 8), hubMat);
            pivot.add(hub);

            // two-blade prop: thin boxes with a slight pitch twist
            const bladeGeo = new THREE.BoxGeometry(radius * 2, radius * 0.03, radius * 0.13);
            const blades = new THREE.Mesh(bladeGeo, bladeMat);
            blades.rotation.z = 0.07; // blade pitch, reads in silhouette
            pivot.add(blades);

            const disc = new THREE.Mesh(new THREE.CircleGeometry(radius, 24), discMat.clone());
            disc.rotation.x = -Math.PI / 2;
            disc.position.y = radius * 0.02;
            pivot.add(disc);

            group.add(pivot);
            return { pivot, disc, dir: i % 2 === 0 ? 1 : -1, offset: (i * Math.PI) / 3 };
        });
    }

    /** Per frame. effort 0..1 — 0 parked (spin down to still), 1 full power. */
    function update(dt, effort) {
        const target = effort * SPIN_MAX;
        spin += (target - spin) * Math.min(1, SPIN_RESPONSE * dt);
        if (spin < 0.05 && target === 0) spin = 0;
        phase += spin * dt;
        const discOpacity = 0.30 * THREE.MathUtils.clamp((spin - 8) / (SPIN_MAX - 8), 0, 1);
        for (const r of rotors) {
            r.pivot.rotation.y = r.dir * (phase + r.offset);
            r.disc.material.opacity = discOpacity;
        }
    }

    return { group, layout, update, get spinning() { return spin > 1; } };
}

/** Hub positions for a loaded GLB: X-quad corners just above the frame.
    `size` = the model's group-local extents after models.js normalization
    (x/z centered on 0, y running 0..size.y). */
export function hubsFromSize(size) {
    const hx = size.x / 2, hz = size.z / 2;
    const y = size.y * 0.92;
    const fx = 0.60 * hx, fz = 0.60 * hz;
    return {
        hubs: [
            [+fx, y, +fz],
            [+fx, y, -fz],
            [-fx, y, -fz],
            [-fx, y, +fz],
        ],
        radius: Math.min(hx, hz) * 0.42,
    };
}
