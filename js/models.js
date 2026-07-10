/* ============================================================
   models.js — real GLB unit models with procedural fallback.

   Each unit module builds its procedural primitive mesh first (the
   game is playable immediately and offline), then attachUnitModel()
   swaps the group's children for the real GLB once it arrives.
   Any load failure silently keeps the fallback.

   The GLBs are Tripo image-to-3D exports, normalized here at load:
   - yaw: model forward → +Z, matching the unit heading convention
     (W drives along [sin h, 0, cos h] with mesh.rotation.y = h)
   - scale: to real-world meters, measured on the post-yaw bounds
   - ground: base at y=0, centered on x/z, so unit code can place
     position.y at terrain height with (near-)zero clearance
   ============================================================ */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const loader = new GLTFLoader();

// axis = which post-yaw extent `size` measures (rover length, drone
// span, humanoid height). yaw per model: Tripo orients each export
// by its source image, so forward differs per asset. All yaws map the
// model's face to local -Z — units travel along -[sin h, cos h] under
// forward input (verified by chase-cam renders: we must see each
// model's BACK while driving forward; +Z-facing had them all reversed).
const MODELS = {
    // Sizes below real-life for drone/recon/humanoid were reading as too
    // small on screen (chase cam frames the rover's 3m for scale, so
    // smaller units looked lost) — bumped ~20-25% over strict real-world
    // scale. Rover is untouched (already reads correctly at real size).
    rover: { url: 'assets/models/rover.glb', yaw: -Math.PI / 2, size: 3.0, axis: 'z' },
    drone: { url: 'assets/models/drone.glb', yaw: Math.PI / 2, size: 2.5, axis: 'x' },
    recon: { url: 'assets/models/recon.glb', yaw: Math.PI / 2, size: 1.4, axis: 'x' },
    humanoid: { url: 'assets/models/humanoid.glb', yaw: Math.PI / 2, size: 2.2, axis: 'y' },
};

// SIGNAL brand accent (cyan-teal — distinct from the amber logo mark) and
// a shinier hardware finish, applied on top of Tripo's flat export
// defaults (roughness 0.9/0.5, metalness 0, no tint, single basecolor —
// verified across all four GLBs). Tripo's UV charts are auto-unwrapped
// scatter atlases (not spatially coherent images), so per-panel painting
// isn't practical without a 3D paint tool; a uniform material push reads
// as "branded hardware" without needing new geometry or textures.
const BRAND_TINT = new THREE.Color(0x2ec4d6);
const TINT_STRENGTH = 0.22; // multiply-blend amount — keeps the real photo-derived texture visible
const ROUGHNESS = 0.38;
const METALNESS = 0.6;

function applyBrandFinish(model) {
    model.traverse((o) => {
        if (!o.isMesh || !o.material) return;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const mat of mats) {
            if (!mat.isMeshStandardMaterial) continue;
            mat.roughness = ROUGHNESS;
            mat.metalness = METALNESS;
            mat.color.lerp(BRAND_TINT, TINT_STRENGTH);
            mat.envMapIntensity = 1.2;
        }
    });
}

export function attachUnitModel(group, name, onReady) {
    const cfg = MODELS[name];
    if (!cfg) return;

    loader.load(cfg.url, (gltf) => {
        const model = gltf.scene;
        applyBrandFinish(model);
        model.rotation.y = cfg.yaw;
        model.updateMatrixWorld(true);

        let box = new THREE.Box3().setFromObject(model);
        const extent = box.getSize(new THREE.Vector3())[cfg.axis];
        if (!(extent > 0)) return; // malformed export — keep fallback
        model.scale.setScalar(cfg.size / extent);
        model.updateMatrixWorld(true);

        box = new THREE.Box3().setFromObject(model);
        const center = box.getCenter(new THREE.Vector3());
        model.position.x -= center.x;
        model.position.z -= center.z;
        model.position.y -= box.min.y;

        group.clear();
        group.add(model);
        // size = the model's group-local extents after normalization
        // (x/z centered, y from 0) — rotor overlays derive hubs from it.
        onReady?.(model, box.getSize(new THREE.Vector3()));
    }, undefined, () => {
        /* keep the procedural fallback — never block the game on assets */
    });
}
