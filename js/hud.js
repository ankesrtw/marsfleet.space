/* ============================================================
   hud.js — DOM/CSS overlay: unit switch, collect prompt, inventory.

   Touch-first: the collect action and unit-switch are always
   on-screen tappable buttons (not keyboard-only), with a keyboard
   hint shown only on non-touch devices.
   ============================================================ */

import { isTouchDevice } from './touch.js';

export function createHud(rootEl, { onSwitchUnit, onCollect }) {
    rootEl.innerHTML = `
        <div class="mars-hud">
            <div class="mars-hud__top">
                <button class="mars-btn mars-btn--switch" id="mc-switch">SWITCH UNIT<span class="mars-btn__hint">[TAB]</span></button>
                <div class="mars-hud__unit" id="mc-active-unit">ROVER</div>
            </div>
            <div class="mars-hud__minimap" id="mc-minimap"></div>
            <div class="mars-hud__prompt" id="mc-prompt" hidden>
                <button class="mars-btn mars-btn--collect" id="mc-collect">COLLECT<span class="mars-btn__hint">[E]</span></button>
            </div>
            <div class="mars-hud__inventory" id="mc-inventory">
                <div class="mars-hud__inventory-title">SAMPLES <span id="mc-inv-count">0</span></div>
                <ul id="mc-inv-list"></ul>
            </div>
        </div>
    `;

    const switchBtn = rootEl.querySelector('#mc-switch');
    const collectBtn = rootEl.querySelector('#mc-collect');
    const promptEl = rootEl.querySelector('#mc-prompt');
    const unitLabel = rootEl.querySelector('#mc-active-unit');
    const invCount = rootEl.querySelector('#mc-inv-count');
    const invList = rootEl.querySelector('#mc-inv-list');
    const minimapEl = rootEl.querySelector('#mc-minimap');

    switchBtn.addEventListener('click', onSwitchUnit);
    collectBtn.addEventListener('click', onCollect);

    if (!isTouchDevice()) {
        rootEl.classList.add('mars-hud--desktop');
    }

    function setActiveUnit(name) {
        unitLabel.textContent = name.toUpperCase();
    }

    function setPrompt(sampleName) {
        if (sampleName) {
            promptEl.hidden = false;
            collectBtn.firstChild.textContent = `COLLECT: ${sampleName}`;
        } else {
            promptEl.hidden = true;
        }
    }

    function setInventory(items) {
        invCount.textContent = items.length;
        invList.replaceChildren(...items.map((i) => {
            const li = document.createElement('li');
            li.textContent = i.name;
            return li;
        }));
    }

    return { minimapEl, setActiveUnit, setPrompt, setInventory };
}
