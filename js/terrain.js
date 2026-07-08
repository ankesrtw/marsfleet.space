/* ============================================================
   terrain.js — real-heightmap terrain, GPU display + CPU sampling.

   Same "one height function, two call sites" discipline as
   rocket-island/js/island.js: the vertex shader displaces the mesh
   by sampling the heightmap texture directly (GPU), while a plain
   JS `sampleHeight()` bilinearly samples a decoded copy of the same
   pixel data (CPU) for rover/drone/humanoid ground-contact, slope,
   and sample-marker placement. Two reads of the same source, never
   a GPU readback.

   Heightmap is an 8-bit grayscale PNG (see scripts/mars-terrain/
   prep_site.sh) — canvas getImageData() is always 8-bit-per-channel
   regardless of source PNG bit depth, so 8-bit is what the browser
   actually gives us; real-world meters are recovered via the site's
   baked elevMin/elevMax.
   ============================================================ */

import * as THREE from 'three';
import { SUN_DIR, FOG, createDetailTexture } from './environment.js';

export async function loadTerrain(site, quality) {
    const img = await loadImageBitmap(site.heightmapUrl);
    const res = img.width; // heightmap is square (see prep script, 1024x1024)

    const canvas = document.createElement('canvas');
    canvas.width = res;
    canvas.height = res;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const pixels = ctx.getImageData(0, 0, res, res).data;

    const range = site.elevMax - site.elevMin;
    const heights = new Float32Array(res * res);
    for (let i = 0; i < res * res; i++) {
        heights[i] = site.elevMin + (pixels[i * 4] / 255) * range;
    }

    const heightTexture = new THREE.CanvasTexture(canvas);
    heightTexture.minFilter = THREE.LinearFilter;
    heightTexture.magFilter = THREE.LinearFilter;
    heightTexture.wrapS = THREE.ClampToEdgeWrapping;
    heightTexture.wrapT = THREE.ClampToEdgeWrapping;

    const albedoTexture = await loadTexture(site.textureUrl);

    const seg = quality.terrainSegments || 256;
    const geo = new THREE.PlaneGeometry(site.worldSize, site.worldSize, seg, seg);
    geo.rotateX(-Math.PI / 2);

    const uniforms = {
        uHeightmap: { value: heightTexture },
        uAlbedo: { value: albedoTexture },
        uDetail: { value: createDetailTexture() },
        uElevMin: { value: site.elevMin },
        uElevRange: { value: range },
        uTexel: { value: 1 / res },
        uWorldStep: { value: site.worldSize / res },
        uSunDir: { value: SUN_DIR },
        uFogColor: { value: FOG.color },
        uFogDensity: { value: FOG.density },
        // Per-site albedo tint: grayscale source imagery (Jezero's CTX
        // ortho) gets a Mars-rust multiply; real-color sources use white.
        uTint: { value: new THREE.Color(site.tint ?? 0xffffff) },
    };

    const mat = new THREE.ShaderMaterial({
        uniforms,
        lights: false,
        vertexShader: /* glsl */ `
            uniform sampler2D uHeightmap;
            uniform float uElevMin, uElevRange, uTexel, uWorldStep;
            varying vec2 vUv;
            varying vec3 vNormal;
            varying float vViewDist;
            void main() {
                vUv = uv;
                float h = uElevMin + texture2D(uHeightmap, uv).r * uElevRange;
                vec3 displaced = position + normal * h;

                // Relief normal from heightmap central differences — this is
                // what turns the flat ortho into visibly 3D terrain.
                float hL = texture2D(uHeightmap, uv - vec2(uTexel, 0.0)).r * uElevRange;
                float hR = texture2D(uHeightmap, uv + vec2(uTexel, 0.0)).r * uElevRange;
                float hD = texture2D(uHeightmap, uv - vec2(0.0, uTexel)).r * uElevRange;
                float hU = texture2D(uHeightmap, uv + vec2(0.0, uTexel)).r * uElevRange;
                // uv v runs north->south flipped vs world z (flipY texture),
                // so the v-difference sign flips into world space here.
                vNormal = normalize(vec3(hL - hR, 2.0 * uWorldStep, hU - hD));

                vec4 mv = modelViewMatrix * vec4(displaced, 1.0);
                vViewDist = -mv.z;
                gl_Position = projectionMatrix * mv;
            }
        `,
        fragmentShader: /* glsl */ `
            uniform sampler2D uAlbedo;
            uniform sampler2D uDetail;
            uniform vec3 uTint;
            uniform vec3 uSunDir;
            uniform vec3 uFogColor;
            uniform float uFogDensity;
            varying vec2 vUv;
            varying vec3 vNormal;
            varying float vViewDist;
            void main() {
                vec3 albedo = texture2D(uAlbedo, vUv).rgb * uTint;

                // High-frequency detail so the ground is not a blur at
                // rover scale; fades out with distance to avoid tiling.
                float detail = texture2D(uDetail, vUv * 96.0).r;
                float detailAmt = 1.0 - smoothstep(200.0, 900.0, vViewDist);
                albedo *= mix(1.0, 0.72 + 0.56 * detail, detailAmt);

                // Sun + ambient relief shading from the real DEM normals.
                // Ambient tracks sun elevation so night actually darkens
                // (uSunDir is mutated in place by the day/night cycle).
                vec3 n = normalize(vNormal);
                float diff = max(dot(n, uSunDir), 0.0);
                float dayAmt = smoothstep(-0.10, 0.20, uSunDir.y);
                vec3 lit = albedo * ((0.07 + 0.31 * dayAmt) + 0.85 * diff);

                // Dust haze, same params as scene.fog on standard materials.
                float fogAmt = 1.0 - exp(-uFogDensity * uFogDensity * vViewDist * vViewDist);
                gl_FragColor = vec4(mix(lit, uFogColor, fogAmt), 1.0);
            }
        `,
    });

    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'terrain';

    // CPU-side mirror of the same source data, for height/slope queries.
    function sampleHeight(worldX, worldZ) {
        const u = (worldX / site.worldSize) + 0.5;
        const v = (worldZ / site.worldSize) + 0.5;
        return bilinear(heights, res, u, v);
    }

    function sampleNormal(worldX, worldZ, eps = 2) {
        const hL = sampleHeight(worldX - eps, worldZ);
        const hR = sampleHeight(worldX + eps, worldZ);
        const hD = sampleHeight(worldX, worldZ - eps);
        const hU = sampleHeight(worldX, worldZ + eps);
        const n = new THREE.Vector3(hL - hR, 2 * eps, hD - hU);
        return n.normalize();
    }

    return { mesh, sampleHeight, sampleNormal, worldSize: site.worldSize };
}

function bilinear(heights, res, u, v) {
    const x = clamp01(u) * (res - 1);
    const y = clamp01(v) * (res - 1);
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const x1 = Math.min(x0 + 1, res - 1), y1 = Math.min(y0 + 1, res - 1);
    const tx = x - x0, ty = y - y0;

    const h00 = heights[y0 * res + x0];
    const h10 = heights[y0 * res + x1];
    const h01 = heights[y1 * res + x0];
    const h11 = heights[y1 * res + x1];

    const a = h00 * (1 - tx) + h10 * tx;
    const b = h01 * (1 - tx) + h11 * tx;
    return a * (1 - ty) + b * ty;
}

function clamp01(v) {
    return Math.min(1, Math.max(0, v));
}

function loadImageBitmap(url) {
    return fetch(url).then((r) => r.blob()).then((b) => createImageBitmap(b));
}

async function loadTexture(url) {
    return new Promise((resolve, reject) => {
        new THREE.TextureLoader().load(url, resolve, undefined, reject);
    });
}
