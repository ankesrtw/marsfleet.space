# Ariana Voice Implementation

Generated AWS Polly voice lines for Ariana hologram and mission briefings using the Joanna neural voice (US English).

## Audio Files Generated

- **18 MP3 files** (1 MB total) in `assets/audio/ariana/`
- Neural voice quality (Joanna, US English)
- ~3.5 second delay between lines (built into hologram dialog timing)

### Hologram Lines (Site-Agnostic)
- `ariana-intro.mp3` — Ariana's introduction (who she is)
- `ariana-lab.mp3` — Lab mission briefing (sample collection)

### Site Briefings (Per-Site Pairs)
- `jezero-1.mp3` & `jezero-2.mp3`
- `gale-1.mp3` & `gale-2.mp3`
- `gusev-1.mp3` & `gusev-2.mp3`
- `syrtis-1.mp3` & `syrtis-2.mp3`
- `elysium-1.mp3` & `elysium-2.mp3`
- `meridiani-1.mp3` & `meridiani-2.mp3`
- `olympus-1.mp3` & `olympus-2.mp3`
- `hellas-1.mp3` & `hellas-2.mp3`

## Code Changes

### [hologram.js](js/hologram.js)

**Exports:**
- `setVoiceEnabled(enabled)` — Toggle voice playback (persists to localStorage)
- `getVoiceEnabled()` — Get current voice state

**Changes:**
1. Updated `ARIANA_LINES` to include audio IDs alongside text
2. Added voice playback function that:
   - Respects the `mc-voice` localStorage toggle (default: ON)
   - Stops previous audio before playing new line
   - Silently fails if autoplay is blocked
3. Auto-maps site briefing lines to audio files: `{site.id}-{index}.mp3`
4. Plays audio when dialog triggers (proximity-detected) and advances per line

**Dialog Sequence:**
- Player enters FIELD LAB hologram trigger radius (15m)
- Hologram appears, first line displays with audio
- 3.5s later: next line displays + plays
- Continues through all site briefing + character lines
- 30s cooldown before hologram can be re-triggered

## Integration with HUD

To add a voice toggle button to the HUD (currently shows only SFX button):

```javascript
// In hud.js, add alongside sfxBtn:
import { getVoiceEnabled, setVoiceEnabled } from './hologram.js';

// After sfxBtn handler:
const voiceBtn = rootEl.querySelector('#mc-voice');
if (voiceBtn) {
    voiceBtn.addEventListener('click', () => {
        const on = !getVoiceEnabled();
        setVoiceEnabled(on);
        voiceBtn.textContent = `VOICE ${on ? 'ON' : 'OFF'}`;
    });
}
```

And in the HUD HTML template, add:
```html
<button class="mars-btn mars-btn--voice" id="mc-voice">VOICE ON</button>
```

## Browser Support

- ✅ All modern browsers (Chrome, Firefox, Safari, Edge)
- ✅ Mobile & desktop
- ✅ Works offline (files are static assets)
- ✅ Autoplay may be blocked on mute browsers (silently degrades to text-only)

## File Size & Caching

- **Per line:** 45–63 KB MP3
- **Total:** 1 MB (negligible for a modern website)
- **Served as:** Static assets (full HTTP cache headers via Cloudflare CDN)
- **No backend calls** — voice is pre-computed and cached in Assets

## Testing Checklist

- [ ] Visit a landing site (Jezero, Gale, etc.)
- [ ] Walk to the FIELD LAB (marked by a lab structure)
- [ ] Get within 15m of Ariana's hologram
- [ ] Verify: hologram appears, first line displays + plays
- [ ] Verify: each line plays in sync with text toast
- [ ] Verify: SFX toggle doesn't affect voice (independent control)
- [ ] Verify: refreshing page preserves voice ON/OFF state
- [ ] On mute tab: text displays, audio silently skips (no errors)

## Future Enhancements

1. **Voice selector** — if different Ariana voice needed (e.g., different accent, gender)
2. **Audio visualization** — waveform or lip-sync animation tied to playback
3. **Subtitle styling** — Ariana text in different color/font from other toasts
4. **Audio mixing** — control relative volume vs. background music/SFX
