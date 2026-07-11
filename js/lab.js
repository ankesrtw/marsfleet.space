/* ============================================================
   lab.js — FIELD LAB base structure + the sling-load logistics
   that feed it.

   The lab is the delivery target of the sample loop: ground units
   collect a sample -> a sealed cache container is left at the site
   (MSR-style depot caching) -> the LIFT drone slings it out and
   lowers it onto the lab pad. createLab builds the structure
   (landing pad, hab dome, mast, beacon) on the flattest spot near
   spawn; createSling owns the one container being carried — cable
   line + pendulum lag so the load visibly swings and settles.

   Same idioms as the rest of the unit layer: terrain.sampleHeight/
   sampleNormal for grounding, no physics engine, additive beacon
   like waypoint.js so the lab is findable over ridgelines.
   ============================================================ */

import * as THREE from 'three';

const PAD_RADIUS = 5.5;
const DELIVER_RADIUS = 7.5;   // horizontal "over the pad" test
const CABLE_LEN = 4.2;        // m, drone belly to container top

export function createLab(scene, site, terrain, rocks) {
    // Flattest of 8 candidate spots ~30m around spawn (not on a boulder).
    let best = null;
    for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const x = site.spawn.x + Math.sin(a) * 30;
        const z = site.spawn.z + Math.cos(a) * 30;
        if (rocks?.collides(x, z, PAD_RADIUS)) continue;
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

    // hab dome + airlock box, offset so the pad stays clear for the drone
    const domeMat = new THREE.MeshStandardMaterial({ color: 0xd9d4c8, roughness: 0.6, metalness: 0.15 });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(3.0, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2), domeMat);
    dome.position.set(-(PAD_RADIUS + 4.5), 0.1, 0);
    group.add(dome);
    const airlock = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.6, 1.4), domeMat);
    airlock.position.set(-(PAD_RADIUS + 1.6), 0.85, 0);
    group.add(airlock);

    const mast = new THREE.Mesh(
        new THREE.CylinderGeometry(0.05, 0.08, 6, 6),
        new THREE.MeshStandardMaterial({ color: 0x777777 })
    );
    mast.position.set(-(PAD_RADIUS + 4.5), 5.6, 0);
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
        container.mesh.position.set(
            padPos.x + Math.sin(a) * r,
            padPos.y + 0.35 + 0.28,
            padPos.z + Math.cos(a) * r
        );
        container.mesh.rotation.set(0, a, 0);
        delivered.push(container);
        return delivered.length;
    }

    let t = 0;
    function update(dt) {
        t += dt;
        beaconMat.opacity = 0.16 + 0.08 * (0.5 + 0.5 * Math.sin(t * 1.6));
    }

    // Solid-structure footprints for the collision registry (colliders.js):
    // dome, airlock box, comms mast. World x/z + radius + height above
    // ground. The pad (0.35m) stays drivable; the beacon is just light.
    const obstacles = [
        { x: padPos.x - (PAD_RADIUS + 4.5), z: padPos.z, r: 3.2, h: 3.1 },  // hab dome
        { x: padPos.x - (PAD_RADIUS + 1.6), z: padPos.z, r: 1.5, h: 1.7 },  // airlock
        { x: padPos.x - (PAD_RADIUS + 4.5), z: padPos.z, r: 0.4, h: 8.6 },  // mast (above dome)
    ];

    return { group, padPos, isOverPad, deliver, delivered, update, obstacles };
}

export function createSling(scene, terrain) {
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
        const groundMin = terrain.sampleHeight(m.position.x, m.position.z) + 0.3;
        m.position.y = Math.max(groundMin, dronePos.y - CABLE_LEN);
        // sway tilt from lateral velocity
        m.rotation.z = THREE.MathUtils.clamp(-vel.x * 0.04, -0.4, 0.4);
        m.rotation.x = THREE.MathUtils.clamp(vel.y * 0.04, -0.4, 0.4);

        cablePos[0] = dronePos.x; cablePos[1] = dronePos.y - 0.15; cablePos[2] = dronePos.z;
        cablePos[3] = m.position.x; cablePos[4] = m.position.y + 0.3; cablePos[5] = m.position.z;
        cableGeo.attributes.position.needsUpdate = true;
    }

    return { attach, detach, update, get carrying() { return carrying; } };
}
