/* ============================================================
   ongak.js — ONGAK, the music companion (plan 27).

   音楽 (ongaku) = music. The name went to the quadruped in plan 25;
   plan 27 gave the quadruped a name that describes it (GRATBOT) and
   this one to the machine that earns it.

   Ongak is deliberately NOT in the unit switch cycle. A unit you
   select but cannot usefully drive — one that only changes tracks —
   makes the cycle longer and the unit hollow. It is a companion
   instead, with two verbs:

     FOLLOW  trails the active unit at ~4m, terrain-hugging
     PARK    holds position and keeps playing

   Which is why it is worth having a body at all: the music bus routes
   through a PannerNode pinned to this bot, so parking it at base and
   driving away FADES the soundtrack behind you, and recalling it
   swells it back. A HUD checkbox cannot do that.

   Movement is a simple seek with a stop band (no gait, no legs — it
   hovers on a repulsor skirt), which keeps it cheap next to the two
   walkers it shares the site with.
   ============================================================ */

import * as THREE from 'three';

const FOLLOW_DIST = 4.2;    // m — trailing distance from the active unit
const STOP_BAND = 1.1;      // m of slack before it bothers moving (anti-jitter)
const MAX_SPEED = 7.0;      // m/s — must out-run the rover's G2 to keep up
const ACCEL = 6.0;          // m/s^2
const TURN_RATE = 3.2;      // rad/s
const HOVER_H = 0.55;       // m — skirt clearance over local ground
const BOB_AMP = 0.06;
const BODY_RADIUS = 0.6;
// Spatial audio falloff. refDistance = full volume inside the follow
// distance; maxDistance is where it bottoms out. Linear (not inverse) so
// "park it at base and drive out" fades predictably instead of dropping
// off a cliff in the first ten metres.
const AUDIO_REF = 6;
const AUDIO_MAX = 140;

export function createOngak(site, terrain, obstacles) {
    const mesh = new THREE.Group();
    mesh.name = 'ongak';
    mesh.position.set(site.spawn.x + 3, 0, site.spawn.z + 6);

    const mats = {
        panel: new THREE.MeshStandardMaterial({ color: 0xe8e2d6, roughness: 0.44, metalness: 0.3 }),
        accent: new THREE.MeshStandardMaterial({ color: 0xc4562e, roughness: 0.38, metalness: 0.4 }),
        dark: new THREE.MeshStandardMaterial({ color: 0x17181b, roughness: 0.5, metalness: 0.45 }),
        cone: new THREE.MeshStandardMaterial({ color: 0x2a2320, roughness: 0.75, metalness: 0.15 }),
        glow: new THREE.MeshStandardMaterial({
            color: 0x0b0d12, roughness: 0.4, metalness: 0.3,
            emissive: 0xffb347, emissiveIntensity: 1.1,
        }),
    };

    // ---- chassis: a rounded speaker cabinet on a hover skirt --------
    const hull = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.36, 0.5, 12), mats.panel);
    hull.position.y = 0.62;
    mesh.add(hull);

    const skirt = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.46, 0.14, 12), mats.dark);
    skirt.position.y = 0.32;
    mesh.add(skirt);

    const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.42, 0.07, 12), mats.accent);
    lid.position.y = 0.9;
    mesh.add(lid);

    // ---- horn array: the beat-reactive part ------------------------
    // Two forward horns (−Z) plus the underside sub. These are the meshes
    // pulse() drives, so they are kept on the returned rig.
    const hornGeo = new THREE.ConeGeometry(0.17, 0.22, 14, 1, true);
    const horns = [];
    for (const sx of [-1, 1]) {
        const horn = new THREE.Mesh(hornGeo, mats.cone);
        // cone points −Z: tip forward, mouth opening toward the listener
        horn.rotation.x = -Math.PI / 2;
        horn.position.set(sx * 0.19, 0.68, -0.34);
        mesh.add(horn);
        horns.push(horn);
    }

    // glowing ring around the cabinet — the "powered" read, and the
    // clearest surface to pulse on the beat
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.022, 8, 24), mats.glow);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.78;
    mesh.add(ring);

    const sub = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.05, 14), mats.cone);
    sub.position.y = 0.38;
    mesh.add(sub);

    // whip antenna + tip beacon (matches the fleet's silhouette language)
    const whip = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.5, 6), mats.dark);
    whip.position.set(0.22, 1.13, 0.16);
    mesh.add(whip);
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.026, 8, 6), mats.glow);
    beacon.position.set(0.22, 1.38, 0.16);
    mesh.add(beacon);

    let heading = site.spawn.heading;
    let parked = false;
    let speed = 0;
    let bob = 0;
    let panner = null;

    const _fwd = new THREE.Vector3();

    function groundAt(x, z) {
        return terrain.sampleGroundHeight(x, z) + (obstacles?.deckHeight?.(x, z) ?? 0);
    }

    /** Wire the music bus through a panner pinned to this bot. Called once
        from main.js after the AudioContext exists. Falls back silently on
        browsers without the positional API (the music simply stays 2D). */
    function attachAudio(music) {
        const ctx = music.ctx;
        if (!ctx || panner) return false;
        try {
            panner = ctx.createPanner();
            panner.panningModel = 'HRTF';
            panner.distanceModel = 'linear';
            panner.refDistance = AUDIO_REF;
            panner.maxDistance = AUDIO_MAX;
            panner.rolloffFactor = 1;
            panner.connect(ctx.destination);
            music.setOutput(panner);
        } catch {
            panner = null;
            return false;
        }
        return true;
    }

    /** Per frame: move the panner to the bot and the listener to the camera.
        Split from update() because the listener is a camera concern and the
        bot may be parked (not updating its own transform meaningfully). */
    function syncAudio(ctx, camera) {
        if (!panner || !ctx) return;
        const t = ctx.currentTime;
        // setPosition is deprecated but is the only path on Safari/older
        // Chrome; prefer the AudioParam form where it exists.
        if (panner.positionX) {
            panner.positionX.setTargetAtTime(mesh.position.x, t, 0.03);
            panner.positionY.setTargetAtTime(mesh.position.y, t, 0.03);
            panner.positionZ.setTargetAtTime(mesh.position.z, t, 0.03);
        } else if (panner.setPosition) {
            panner.setPosition(mesh.position.x, mesh.position.y, mesh.position.z);
        }
        const L = ctx.listener;
        if (L.positionX) {
            L.positionX.setTargetAtTime(camera.position.x, t, 0.03);
            L.positionY.setTargetAtTime(camera.position.y, t, 0.03);
            L.positionZ.setTargetAtTime(camera.position.z, t, 0.03);
        } else if (L.setPosition) {
            L.setPosition(camera.position.x, camera.position.y, camera.position.z);
        }
    }

    /** Beat-reactive body. level 0..1 = loudness, beat 0..1 = kick decay.
        Emissive only — no geometry rebuild, no material churn. */
    function pulse(level, beat) {
        const lift = 1 + beat * 0.9 + level * 0.5;
        mats.glow.emissiveIntensity = 0.5 + lift * 0.7;
        const s = 1 + beat * 0.12;
        for (const horn of horns) horn.scale.set(s, 1, s);
        sub.scale.set(1 + beat * 0.2, 1, 1 + beat * 0.2);
    }

    /**
     * dt, followPos: the active unit's position (null = nothing to follow).
     * Parked bots hold station; following bots seek a point FOLLOW_DIST
     * short of the target so they trail rather than crowd it.
     */
    function update(dt, followPos) {
        if (!parked && followPos) {
            const dx = followPos.x - mesh.position.x;
            const dz = followPos.z - mesh.position.z;
            const dist = Math.hypot(dx, dz);
            const want = dist - FOLLOW_DIST;
            if (want > STOP_BAND) {
                // steer toward the target, accelerate up to a speed that
                // closes the gap without overshooting into it
                const desired = Math.atan2(dx, dz);
                let diff = ((desired - heading + Math.PI) % (Math.PI * 2)
                    + Math.PI * 2) % (Math.PI * 2) - Math.PI;
                const turn = THREE.MathUtils.clamp(diff, -TURN_RATE * dt, TURN_RATE * dt);
                heading += turn;
                const cap = Math.min(MAX_SPEED, want * 1.6);
                speed = Math.min(cap, speed + ACCEL * dt);
            } else {
                speed = Math.max(0, speed - ACCEL * 1.5 * dt);
            }
        } else {
            speed = Math.max(0, speed - ACCEL * 1.5 * dt);
        }

        if (speed > 0.001) {
            const step = speed * dt;
            const inside = obstacles?.collides(mesh.position.x, mesh.position.z, BODY_RADIUS);
            // Straight ahead first, then progressively wider sidesteps. A
            // driven unit can be steered around the lab dome by the player;
            // a follower cannot, so "stop when blocked" strands it behind
            // the first obstacle on the line home and it never catches up
            // again (measured: stuck 11m out instead of closing to 4.2m).
            // Trying ±35°/±70° lets it slide along the wall and re-acquire.
            let moved = false;
            for (const off of [0, 0.6, -0.6, 1.2, -1.2]) {
                const h = heading + off;
                const nx = mesh.position.x + Math.sin(h) * step;
                const nz = mesh.position.z + Math.cos(h) * step;
                // blocked entry, never trapped — same idiom as every ground unit
                if (!inside && obstacles?.collides(nx, nz, BODY_RADIUS)) continue;
                mesh.position.x = nx;
                mesh.position.z = nz;
                // ease the nose toward whichever way actually worked
                if (off !== 0) heading += THREE.MathUtils.clamp(off, -TURN_RATE * dt, TURN_RATE * dt);
                moved = true;
                break;
            }
            if (!moved) speed = 0;
        }
        _fwd.set(Math.sin(heading), 0, Math.cos(heading));

        bob += dt * (1.4 + speed * 0.3);
        mesh.position.y = groundAt(mesh.position.x, mesh.position.z)
            + HOVER_H + Math.sin(bob) * BOB_AMP;
        mesh.rotation.y = heading;
        // lean into acceleration a touch — sells the hover
        mesh.rotation.x = -speed / MAX_SPEED * 0.09;
    }

    return {
        mesh, update, attachAudio, syncAudio, pulse,
        get position() { return mesh.position; },
        get heading() { return heading; },
        get parked() { return parked; },
        get spatial() { return !!panner; },
        /** Flip FOLLOW/PARK; returns true when now parked. */
        togglePark() {
            parked = !parked;
            return parked;
        },
        teleport(x, z) {
            mesh.position.set(x, groundAt(x, z) + HOVER_H, z);
            speed = 0;
        },
    };
}
