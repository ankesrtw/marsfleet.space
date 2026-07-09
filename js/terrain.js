/* ============================================================
   terrain.js — real-heightmap terrain, GPU display + CPU sampling.

   Same "one height function, two call sites" discipline as
   rocket-island/js/island.js: the vertex shader displaces the mesh
   by sampling the heightmap texture directly (GPU), while a plain
   JS `sampleHeight()` bilinearly samples a decoded copy of the same
   pixel data (CPU) for rover/drone/humanoid ground-contact, slope,
   and sample-marker placement. Two reads of the same source, never
   a GPU readback.

   Heightmap is an RG-packed 16-bit PNG (R=high byte, G=low byte —
   see scripts/mars-terrain/pack_rg16.py): canvas getImageData() is
   always 8-bit-per-channel regardless of source PNG bit depth, so
   16-bit elevation ships as two 8-bit channels and both samplers
   decode (R*256+G)/65535. The decode is exactly backward-compatible
   with the old 8-bit grayscale maps (R=G=v ⇒ v*257/65535 = v/255),
   and it survives LinearFilter because the combine is linear in R,G.
   Real-world meters are recovered via the site's baked elevMin/Max.
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

            // RG-packed 16-bit decode: (R*256 + G) / 65535, in 0..1.
            // Matches texelFetchBilinear() on the CPU exactly.
            float heightAt(vec2 uv) {
                vec2 rg = texture2D(uHeightmap, uv).rg;
                return dot(rg, vec2(65280.0, 255.0)) / 65535.0;
            }

            void main() {
                vUv = uv;
                float h = uElevMin + heightAt(uv) * uElevRange;
                vec3 displaced = position + normal * h;

                // Relief normal from heightmap central differences — this is
                // what turns the flat ortho into visibly 3D terrain.
                float hL = heightAt(uv - vec2(uTexel, 0.0)) * uElevRange;
                float hR = heightAt(uv + vec2(uTexel, 0.0)) * uElevRange;
                float hD = heightAt(uv - vec2(0.0, uTexel)) * uElevRange;
                float hU = heightAt(uv + vec2(0.0, uTexel)) * uElevRange;
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

                // Slope-driven material blend ON TOP of the real ortho (the
                // photo stays the base — this only nudges): flats collect
                // bright red dust (patchy, via low-freq noise), steep faces
                // read as darker desaturated bedrock with fine grain.
                vec3 nMat = normalize(vNormal);
                float slope = 1.0 - nMat.y;
                // ("patch" is a GLSL reserved word — hence patchN)
                float patchN = texture2D(uDetail, vUv * 6.0).r;
                float grain = texture2D(uDetail, vUv * 340.0).r;
                float dustAmt = smoothstep(0.10, 0.02, slope) * (0.30 + 0.70 * patchN);
                float rockAmt = smoothstep(0.16, 0.40, slope);
                vec3 dustCol = albedo * vec3(1.10, 0.97, 0.88);
                vec3 rockCol = albedo * vec3(0.80, 0.79, 0.82) * (0.82 + 0.36 * grain);
                albedo = mix(mix(albedo, dustCol, dustAmt * 0.55), rockCol, rockAmt * 0.65);

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
                vec3 lit = albedo * ((0.12 + 0.26 * dayAmt) + 0.85 * diff);

                // Dust haze, same params as scene.fog on standard materials.
                float fogAmt = 1.0 - exp(-uFogDensity * uFogDensity * vViewDist * vViewDist);
                gl_FragColor = vec4(mix(lit, uFogColor, fogAmt), 1.0);
            }
        `,
    });

    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'terrain';

    // CPU-side mirror of the RENDERED surface, for height/slope queries.
    //
    // Sampling the full-res height data directly made units sink into the
    // ground: the mesh only displaces its (seg+1)² vertices, so between
    // vertices the drawn triangles sit above the finer data in concave
    // spots. Instead, mirror what the GPU actually renders — the heights
    // at the mesh vertices (GL-exact bilinear texture filtering), then
    // interpolate across the same triangles the rasterizer draws
    // (PlaneGeometry splits each quad along the b–d diagonal).
    const gridN = seg + 1;
    const grid = new Float32Array(gridN * gridN);
    for (let iy = 0; iy <= seg; iy++) {
        for (let ix = 0; ix <= seg; ix++) {
            grid[iy * gridN + ix] = site.elevMin + texelFetchBilinear(pixels, res, ix / seg, iy / seg) * range;
        }
    }

    function sampleHeight(worldX, worldZ) {
        const fx = clamp01(worldX / site.worldSize + 0.5) * seg;
        const fz = clamp01(worldZ / site.worldSize + 0.5) * seg;
        const ix = Math.min(Math.floor(fx), seg - 1);
        const iz = Math.min(Math.floor(fz), seg - 1);
        const tx = fx - ix, tz = fz - iz;
        const ha = grid[iz * gridN + ix];
        const hb = grid[(iz + 1) * gridN + ix];
        const hc = grid[(iz + 1) * gridN + ix + 1];
        const hd = grid[iz * gridN + ix + 1];
        return (tx + tz <= 1)
            ? ha + (hb - ha) * tz + (hd - ha) * tx
            : hc + (hb - hc) * (1 - tx) + (hd - hc) * (1 - tz);
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

/** GL-exact LinearFilter lookup of the RG-packed 16-bit height (0..1),
    replicating how the vertex shader samples uHeightmap: texel space is
    u*res - 0.5 with clamp-to-edge, NOT pixel space u*(res-1). */
function texelFetchBilinear(pixels, res, u, v) {
    const x = Math.min(Math.max(u * res - 0.5, 0), res - 1);
    const y = Math.min(Math.max(v * res - 0.5, 0), res - 1);
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const x1 = Math.min(x0 + 1, res - 1), y1 = Math.min(y0 + 1, res - 1);
    const tx = x - x0, ty = y - y0;

    // (R*256 + G) — same decode as the shader's heightAt()
    const i00 = (y0 * res + x0) * 4, i10 = (y0 * res + x1) * 4;
    const i01 = (y1 * res + x0) * 4, i11 = (y1 * res + x1) * 4;
    const h00 = pixels[i00] * 256 + pixels[i00 + 1];
    const h10 = pixels[i10] * 256 + pixels[i10 + 1];
    const h01 = pixels[i01] * 256 + pixels[i01 + 1];
    const h11 = pixels[i11] * 256 + pixels[i11 + 1];

    const a = h00 * (1 - tx) + h10 * tx;
    const b = h01 * (1 - tx) + h11 * tx;
    return (a * (1 - ty) + b * ty) / 65535;
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
