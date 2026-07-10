/* ============================================================
   touch.js — on-screen virtual joysticks (touch-first control).

   No existing joystick precedent elsewhere in this project (only
   pointerdown/move HUD drag-drop in rocket-island), so this is a
   fresh minimal implementation using the same unified Pointer
   Events API (works for mouse AND touch, one code path).

   Each stick exposes a normalized {x, y} in [-1, 1], read every
   frame by whichever unit controller is active — same pattern as
   reading a gamepad axis.

   The pads are ALWAYS visible on touch devices (dim base + role
   label resting at the zone center; it brightens and re-anchors
   under the finger on touch) — an invisible zone reads as "no
   controls" on a phone. Roles are re-labelled per active unit:
   ground = MOVE (right zone hidden), drones = RC Mode 2
   (left stick throttle/yaw, right stick pitch/roll).
   ============================================================ */

// resting pads at 0.3 were near-invisible over dark terrain on phones
// ("where are the controls?") — 0.5 keeps them findable without shouting
const IDLE_OPACITY = '0.5';

export function createJoystick(zoneEl) {
    const nub = document.createElement('div');
    nub.className = 'joy-nub';
    const base = document.createElement('div');
    base.className = 'joy-base';
    base.appendChild(nub);
    const label = document.createElement('div');
    label.className = 'joy-label';
    zoneEl.appendChild(base);
    zoneEl.appendChild(label);

    function rest() {
        base.style.left = '50%';
        base.style.top = '55%';
        base.style.opacity = IDLE_OPACITY;
        nub.style.transform = 'translate(0, 0)';
    }
    rest();

    let active = false;
    let originX = 0, originY = 0;
    let value = { x: 0, y: 0 };
    const RADIUS = 44;

    function start(e) {
        active = true;
        const rect = zoneEl.getBoundingClientRect();
        originX = e.clientX;
        originY = e.clientY;
        base.style.left = `${e.clientX - rect.left}px`;
        base.style.top = `${e.clientY - rect.top}px`;
        base.style.opacity = '1';
        zoneEl.setPointerCapture(e.pointerId);
    }

    function move(e) {
        if (!active) return;
        const dx = e.clientX - originX;
        const dy = e.clientY - originY;
        const dist = Math.min(RADIUS, Math.hypot(dx, dy));
        const angle = Math.atan2(dy, dx);
        const nx = Math.cos(angle) * dist;
        const ny = Math.sin(angle) * dist;
        nub.style.transform = `translate(${nx}px, ${ny}px)`;
        value = { x: nx / RADIUS, y: ny / RADIUS };
    }

    function end() {
        active = false;
        value = { x: 0, y: 0 };
        rest();
    }

    zoneEl.addEventListener('pointerdown', start);
    zoneEl.addEventListener('pointermove', move);
    zoneEl.addEventListener('pointerup', end);
    zoneEl.addEventListener('pointercancel', end);

    return {
        get value() { return value; },
        get active() { return active; },
        setLabel(text) { label.textContent = text; },
        setHidden(hidden) { zoneEl.dataset.off = String(hidden); },
    };
}

export function isTouchDevice() {
    return window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
}
