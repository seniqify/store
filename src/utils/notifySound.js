/**
 * New-order alert sound + buzz.
 *
 * The chime is synthesised with the Web Audio API (a short two-note "ding-dong")
 * so there's no audio file to ship or fetch — it works offline and passes any CSP.
 * The sound preference is DEVICE-LOCAL (localStorage), not part of the store
 * config: an owner may manage from a phone and a laptop, and "make my phone
 * chime" is a per-device choice, not something to sync to the DB.
 */

const SOUND_KEY = 'pl_order_sound';   // '1' = on, '0'/absent = off (opt-in)

export function orderSoundOn() {
  try { return localStorage.getItem(SOUND_KEY) === '1'; } catch { return false; }
}

export function setOrderSoundOn(on) {
  try { localStorage.setItem(SOUND_KEY, on ? '1' : '0'); } catch { /* private mode */ }
}

// One shared AudioContext, created lazily on first use (after a user gesture, so
// the browser lets it make sound). Resumed each time in case the tab suspended it.
let ctx = null;
function audioCtx() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!ctx) ctx = new AC();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  } catch { return null; }
}

/** A pleasant two-note chime. Best-effort — silently does nothing if audio is
 *  blocked (e.g. tab never interacted with, or autoplay policy). */
export function playOrderChime() {
  const ac = audioCtx();
  if (!ac) return;
  const now = ac.currentTime;
  // E6 → A6, a gentle rising "ding-dong".
  [[1318.51, 0], [1760.0, 0.15]].forEach(([freq, t]) => {
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, now + t);
    gain.gain.exponentialRampToValueAtTime(0.16, now + t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + t + 0.5);
    osc.connect(gain);
    gain.connect(ac.destination);
    osc.start(now + t);
    osc.stop(now + t + 0.55);
  });
}

/** Vibrate the phone (no-op on desktop / unsupported browsers). */
export function buzz() {
  try { navigator.vibrate?.([130, 70, 130]); } catch { /* unsupported */ }
}

/** Fire the alert for a new order, respecting the device's sound preference. */
export function alertNewOrder() {
  if (!orderSoundOn()) return;
  playOrderChime();
  buzz();
}
