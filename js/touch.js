/* ============================================================
   touch.js — on-screen virtual joysticks (touch-first control).

   No existing joystick precedent elsewhere in this project (only
   pointerdown/move HUD drag-drop in rocket-island), so this is a
   fresh minimal implementation using the same unified Pointer
   Events API (works for mouse AND touch, one code path).

   Two independent nub-style sticks: left = move (throttle/steer or
   forward/strafe depending on active unit), right = look/camera.
   Each exposes a normalized {x, y} in [-1, 1], read every frame by
   whichever unit controller is active — same pattern as reading a
   gamepad axis.
   ============================================================ */

export function createJoystick(zoneEl) {
    const nub = document.createElement('div');
    nub.className = 'joy-nub';
    const base = document.createElement('div');
    base.className = 'joy-base';
    base.appendChild(nub);
    zoneEl.appendChild(base);

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
        nub.style.transform = 'translate(0, 0)';
        base.style.opacity = '0';
    }

    zoneEl.addEventListener('pointerdown', start);
    zoneEl.addEventListener('pointermove', move);
    zoneEl.addEventListener('pointerup', end);
    zoneEl.addEventListener('pointercancel', end);

    return {
        get value() { return value; },
        get active() { return active; },
    };
}

export function isTouchDevice() {
    return window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
}
