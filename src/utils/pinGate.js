// Helpers for the PIN screen in front of a shop's dashboard (PinGate). PURE.

const HEX6 = /^#[0-9a-f]{6}$/i;
const HEX3 = /^#[0-9a-f]{3}$/i;

/**
 * The shop's colours for the PIN screen.
 *   accent -- the shop's theme colour (boxes, dots), or the PocketLink teal.
 *   button -- the accent 20% darker, so white button text stays readable on
 *             light theme colours (#16a34a is 3.3:1 against white text; 20%
 *             darker, #12823b, is about 4.9:1).
 *   ring   -- the accent at ~18% opacity, for the focus ring and button glow.
 */
export function pinColors(color, fallback = '#0d9488') {
  let hex = String(color ?? '').trim();
  if (HEX3.test(hex)) hex = '#' + hex.slice(1).split('').map((c) => c + c).join('');
  if (!HEX6.test(hex)) hex = fallback;
  hex = hex.toLowerCase();
  const n = parseInt(hex.slice(1), 16);
  const dark = (v) => Math.round(v * 0.8).toString(16).padStart(2, '0');
  const button = '#' + dark((n >> 16) & 255) + dark((n >> 8) & 255) + dark(n & 255);
  return { accent: hex, button, ring: `${hex}2e` };
}

/**
 * The digits a box row holds after the input changed to `raw`.
 * Only digits, at most `length`. `restart` is set after a wrong PIN: the old
 * digits are still drawn (in red), and the next key starts a fresh entry --
 * typed digits replace them, a delete clears them.
 */
export function nextDigits(prev, raw, length, restart = false) {
  const before = String(prev ?? '');
  const digits = String(raw ?? '').replace(/\D/g, '');
  if (restart) return digits.length > before.length ? digits.slice(before.length, before.length + length) : '';
  return digits.slice(0, length);
}

/** The letter shown when a shop has no logo. */
export function shopInitial(name) {
  const ch = String(name ?? '').trim().charAt(0);
  return ch ? ch.toUpperCase() : 'S';
}

/** A logo we can put in an <img>: a web or site URL, or an uploaded data image. */
export function isImageSrc(logo) {
  return typeof logo === 'string' && /^(https?:\/\/|data:image\/|\/)/i.test(logo.trim());
}
