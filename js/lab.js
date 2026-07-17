/* ============================================================
   lab.js — FIELD LAB base structure + the sling-load logistics
   that feed it.

   The lab is the delivery target of the sample loop: ground units
   collect a sample -> a sealed cache container is left at the site
   (MSR-style depot caching) -> the LIFT drone slings it out and
   lowers it onto the lab pad. createLab builds the structure
   (landing pad, station dock GLB, mast, beacon) on the flattest
   spot near spawn; createSling owns the one container being
   carried — cable line + pendulum lag so the load visibly swings
   and settles.

   Same idioms as the rest of the unit layer: terrain.sampleHeight/
   sampleNormal for grounding, no physics engine, additive beacon
   like waypoint.js so the lab is findable over ridgelines.
   ============================================================ */

import * as THREE from 'three';
import { attachStaticModel } from './models.js';
import { makeLabel, plateScale } from './outposts.js';

const PAD_RADIUS = 5.5;
const DELIVER_RADIUS = 7.5;   // horizontal "over the pad" test
// Real cargo drones keep slung loads on SHORT lines — operators trade
// line length for control authority (less pendulum), and winch systems
// (A2Z RDS-class) snug the payload close under the airframe for cruise;
// long lines are a crane/helicopter-longline thing. Per the reference
// (sample-container.jpeg — a package harnessed right under the belly,
// barely a gap), the load rides snug: 0.9m belly-to-container-top.
const CABLE_LEN = 0.9;        // m, drone belly to container top
// Station dock center, west of the pad. The GLB scales to a 15m footprint
// (models.js STATIC_MODELS), so its half-length is ~7.5m — offset keeps a
// ~1m gap to the pad skirt.
const STATION_OFFSET = PAD_RADIUS + 9;
const STATION_RADIUS = 7.6;   // collision circle over the 15 x 7.5m box

export function createLab(scene, site, terrain, rocks) {
    // Flattest of 8 candidate spots ~30m around spawn — clear of boulders
    // at both the pad AND the station dock footprint west of it.
    let best = null;
    for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const x = site.spawn.x + Math.sin(a) * 30;
        const z = site.spawn.z + Math.cos(a) * 30;
        if (rocks?.collides(x, z, PAD_RADIUS)) continue;
        if (rocks?.collides(x - STATION_OFFSET, z, STATION_RADIUS)) continue;
        const slope = 1 - terrain.sampleNormal(x, z).y;
        if (!best || slope < best.slope) best = { x, z, slope };
    }
    if (!best) best = { x: site.spawn.x + 30, z: site.spawn.z, slope: 0 };
    const padPos = new THREE.Vector3(best.x, terrain.sampleHeight(best.x, best.z), best.z);

    const group = new THREE.Group();
    group.name = 'field-lab';
    group.position.copy(padPos);

    const padMat = new THREE.MeshStandardMaterial({ color: 0xb8b4ac, roughness: 0.85, metalness: 0.1 });
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(PAD_RADIUS, PAD_RADIUS + 0.5, 0.35, 24), padMat);
    pad.position.y = 0.18;
    group.add(pad);

    const ring = new THREE.Mesh(
        new THREE.TorusGeometry(PAD_RADIUS - 1.2, 0.09, 6, 32),
        new THREE.MeshBasicMaterial({ color: 0xe07b39 })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.37;
    group.add(ring);

    // Station dock: procedural placeholder (fallback-first, same idiom as
    // unit GLBs in models.js) swapped for the real cargo-container GLB
    // once it loads; any load failure keeps this placeholder forever.
    // Placeholder is a container-scale box so the hardcoded collision
    // footprint below stays honest either way.
    const shellMat = new THREE.MeshStandardMaterial({ color: 0xd9d4c8, roughness: 0.6, metalness: 0.15 });
    const stationGroup = new THREE.Group();
    // Ground the dock on ITS OWN terrain height, not the pad's — 14.5m of
    // Mars can drop half a metre, and the container visibly floated on it.
    const stationGroundY = terrain.sampleHeight(padPos.x - STATION_OFFSET, padPos.z);
    stationGroup.position.set(-STATION_OFFSET, stationGroundY - padPos.y, 0);
    const shell = new THREE.Mesh(new THREE.BoxGeometry(14, 6.5, 7), shellMat);
    shell.position.y = 3.25;
    stationGroup.add(shell);
    group.add(stationGroup);
    attachStaticModel(stationGroup, 'station');

    // Comms mast beside the dock (clear of the container's z half-width).
    const mast = new THREE.Mesh(
        new THREE.CylinderGeometry(0.05, 0.08, 6, 6),
        new THREE.MeshStandardMaterial({ color: 0x777777 })
    );
    mast.position.set(-(PAD_RADIUS + 4.5), 5.6, 6.5);
    group.add(mast);

    // beacon column (additive, like waypoint.js) — lab is findable from afar
    const beaconMat = new THREE.MeshBasicMaterial({
        color: 0x59d8c9,
        transparent: true,
        opacity: 0.22,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
    });
    const beacon = new THREE.Mesh(
        new THREE.CylinderGeometry(0.9, 0.35, 60, 10, 1, true), beaconMat
    );
    beacon.position.y = 30;
    group.add(beacon);

    // Wave 10 carry-over: the origin base finally wears a name plate —
    // same canvas-chip language as the outposts', above the station dock.
    const plate = makeLabel('FIELD LAB');
    plate.sprite.position.set(-STATION_OFFSET, 10.5, 0);
    group.add(plate.sprite);

    scene.add(group);

    const delivered = [];

    /** Horizontal over-the-pad test for the hovering drone. */
    function isOverPad(pos) {
        return Math.hypot(pos.x - padPos.x, pos.z - padPos.z) <= DELIVER_RADIUS;
    }

    /** Park a delivered container on its pad slot. */
    function deliver(container) {
        container.state = 'delivered';
        const a = delivered.length * (Math.PI / 3.5) + 0.4;
        const r = PAD_RADIUS - 2.4;
        // Container grounds at its base (y=0), so rest it ON the pad top
        // surface (padPos.y + 0.35) — no half-height lift.
        container.mesh.position.set(
            padPos.x + Math.sin(a) * r,
            padPos.y + 0.35,
            padPos.z + Math.cos(a) * r
        );
        container.mesh.rotation.set(0, a, 0);
        delivered.push(container);
        return delivered.length;
    }

    let t = 0;
    const _camPos = new THREE.Vector3();
    const _v = new THREE.Vector3();
    function update(dt, camera) {
        t += dt;
        beaconMat.opacity = 0.16 + 0.08 * (0.5 + 0.5 * Math.sin(t * 1.6));
        // plate holds a constant on-screen size, same rule as outposts.js
        if (camera) {
            camera.getWorldPosition(_camPos);
            const s = plateScale(_camPos.distanceTo(plate.sprite.getWorldPosition(_v)));
            plate.sprite.scale.set(plate.w * s, plate.h * s, 1);
        }
    }

    // Solid-structure footprints for the collision registry (colliders.js):
    // station dock, comms mast. World x/z + radius + height above ground.
    // The pad (0.35m) stays drivable; the beacon is just light. Station
    // height matches the GLB's 15m-footprint scale (~8.2m tall).
    const obstacles = [
        { x: padPos.x - STATION_OFFSET, z: padPos.z, r: STATION_RADIUS, h: 8.5 },   // station dock
        { x: padPos.x - (PAD_RADIUS + 4.5), z: padPos.z + 6.5, r: 0.4, h: 8.6 },    // comms mast
    ];

    // stationPos/stationGroup: the dock's resting world position + node —
    // the landing intro (intro.js) hides the real dock and cargo-drops a
    // copy onto exactly this spot, then hands off seamlessly. y is the
    // dock's OWN ground height (see stationGroundY above).
    const stationPos = new THREE.Vector3(padPos.x - STATION_OFFSET, stationGroundY, padPos.z);

    return { group, padPos, isOverPad, deliver, delivered, update, obstacles, stationPos, stationGroup };
}

export function createSling(scene, terrain, colliders) {
    const cableGeo = new THREE.BufferGeometry();
    const cablePos = new Float32Array(6);
    cableGeo.setAttribute('position', new THREE.BufferAttribute(cablePos, 3));
    const cable = new THREE.Line(cableGeo, new THREE.LineBasicMaterial({ color: 0x1a1a1a }));
    cable.frustumCulled = false;
    cable.visible = false;
    scene.add(cable);

    let carrying = null;
    const vel = new THREE.Vector2();

    function attach(container) {
        carrying = container;
        container.state = 'slung';
        vel.set(0, 0);
        cable.visible = true;
    }

    /** Detach and return the container (caller decides field-drop vs deliver). */
    function detach() {
        const c = carrying;
        carrying = null;
        cable.visible = false;
        return c;
    }

    /** Pendulum-ish lag: the load chases the point CABLE_LEN below the
        drone with a damped spring in x/z, so acceleration visibly swings
        it and it settles when the drone hovers. */
    function update(dt, dronePos) {
        if (!carrying) return;
        const m = carrying.mesh;
        const tx = dronePos.x, tz = dronePos.z;
        vel.x += (tx - m.position.x) * 14 * dt;
        vel.y += (tz - m.position.z) * 14 * dt;
        const damp = Math.max(0, 1 - 5.5 * dt);
        vel.multiplyScalar(damp);
        m.position.x += vel.x * dt;
        m.position.z += vel.y * dt;
        const groundMin = terrain.sampleHeight(m.position.x, m.position.z)
            + (colliders?.deckHeight(m.position.x, m.position.z) ?? 0) + 0.3;
        m.position.y = Math.max(groundMin, dronePos.y - CABLE_LEN);
        // sway tilt from lateral velocity
        m.rotation.z = THREE.MathUtils.clamp(-vel.x * 0.04, -0.4, 0.4);
        m.rotation.x = THREE.MathUtils.clamp(vel.y * 0.04, -0.4, 0.4);

        // Container grounds at its base, so attach the cable near its TOP
        // (~0.7m up) rather than just above the base — the line reads as
        // hooked to the lid, not passing through the box.
        cablePos[0] = dronePos.x; cablePos[1] = dronePos.y - 0.15; cablePos[2] = dronePos.z;
        cablePos[3] = m.position.x; cablePos[4] = m.position.y + 0.7; cablePos[5] = m.position.z;
        cableGeo.attributes.position.needsUpdate = true;
    }

    return { attach, detach, update, get carrying() { return carrying; } };
}
