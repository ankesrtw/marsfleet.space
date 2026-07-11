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
    // 2.2 was numerically taller than the rover GLB's 2.0m box, but the
    // rover renders as a ~3.9m-square hulk (Tripo export is bulkier than
    // the real 2.7m-wide Perseverance), so a 1.1m-wide figure still read
    // toy-sized beside it. 2.6 makes the humanoid read person-scale.
    humanoid: { url: 'assets/models/humanoid.glb', yaw: Math.PI / 2, size: 2.6, axis: 'y' },
};

// Stationary structures (no heading, so no yaw-to-heading convention to
// satisfy) — scaled to a target footprint (largest horizontal extent)
// instead of a single travel-axis size. yaw is still exposed per-entry
// since Tripo's source-image orientation is unpredictable per generation.
// doubleSide: the container GLB has window/door openings and single-sided
// walls — without it the interior shows the terrain through the shell.
// 15m footprint = hangar scale: the rover (3.9m rendered hulk), both
// drones and the humanoid all visually fit inside the dock.
const STATIC_MODELS = {
    station: { url: 'assets/models/station.glb', yaw: 0, footprint: 15, doubleSide: true },
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

// Hide the procedural fallback briefly while the GLB loads — kills the
// one-second "gray blocks" flash on boot. The fallback still appears if
// the load runs long or fails, keeping the play-offline guarantee.
const FALLBACK_DELAY_MS = 2500;

function deferFallback(group) {
    group.visible = false;
    const timer = setTimeout(() => { group.visible = true; }, FALLBACK_DELAY_MS);
    return () => { clearTimeout(timer); group.visible = true; };
}

export function attachUnitModel(group, name, onReady) {
    const cfg = MODELS[name];
    if (!cfg) return;

    const reveal = deferFallback(group);
    loader.load(cfg.url, (gltf) => {
        reveal();
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
        reveal(); /* keep the procedural fallback — never block the game on assets */
    });
}

/** Same fallback-first idiom as attachUnitModel, but for stationary
    structures: no yaw-to-heading normalization, scaled to a target
    footprint (horizontal bounding-box extent) instead of a single
    travel-axis size, and grounded/centered the same way. */
export function attachStaticModel(group, name, onReady) {
    const cfg = STATIC_MODELS[name];
    if (!cfg) return;

    const reveal = deferFallback(group);
    loader.load(cfg.url, (gltf) => {
        reveal();
        const model = gltf.scene;
        applyBrandFinish(model);
        if (cfg.doubleSide) {
            model.traverse((o) => {
                if (!o.isMesh || !o.material) return;
                const mats = Array.isArray(o.material) ? o.material : [o.material];
                for (const mat of mats) mat.side = THREE.DoubleSide;
            });
        }
        model.rotation.y = cfg.yaw;
        model.updateMatrixWorld(true);

        let box = new THREE.Box3().setFromObject(model);
        let size = box.getSize(new THREE.Vector3());
        const footprint = Math.max(size.x, size.z);
        if (!(footprint > 0)) return; // malformed export — keep fallback
        model.scale.setScalar(cfg.footprint / footprint);
        model.updateMatrixWorld(true);

        box = new THREE.Box3().setFromObject(model);
        const center = box.getCenter(new THREE.Vector3());
        model.position.x -= center.x;
        model.position.z -= center.z;
        model.position.y -= box.min.y;

        group.clear();
        group.add(model);
        onReady?.(model, box.getSize(new THREE.Vector3()));
    }, undefined, () => {
        reveal(); /* keep the procedural fallback — never block the game on assets */
    });
}
