/**
 * WhatsApp marketing consent at checkout — the customer's own, per shop.
 *
 * The checkout shows an UNTICKED box. Each tick / untick is recorded by
 * record_whatsapp_consent (supabase/whatsapp-consent-forward.sql) with the exact
 * words shown, the moment it happens: the cart reminder exists for customers who
 * never finish the order, so recording it with the order would be too late.
 *
 * This device also remembers the choice PER SHOP (never across shops — agreeing
 * to Krupa's offers is not agreeing to anyone else's), so a returning customer
 * sees the box as they left it, for that shop only.
 *
 * Pure, so it is tested directly. The network call is recordWhatsappConsent in
 * orderService.js, next to the other best-effort checkout writes.
 */

const KEY = 'pl_wa_optin_v1';

/** The sentence the customer sees, and the one recorded with their choice. */
export function optInWording(shopName) {
  const shop = String(shopName || '').trim() || 'this shop';
  return {
    title: 'Get offers & cart reminders on WhatsApp',
    detail: `From ${shop}. You can stop anytime.`,
    get recorded() { return `${this.title}. ${this.detail}`; },
  };
}

function readMap(storage) {
  try {
    const v = JSON.parse(storage?.getItem(KEY) || '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

/** Did this customer, on this device, tick the box for THIS shop? Default no. */
export function rememberedOptIn(slug, storage = globalThis.localStorage) {
  return Boolean(slug) && readMap(storage)[slug] === true;
}

/** Remember the choice for this shop only. Never throws. */
export function rememberOptIn(slug, value, storage = globalThis.localStorage) {
  if (!slug) return;
  try {
    const map = readMap(storage);
    if (value) map[slug] = true; else delete map[slug];
    storage?.setItem(KEY, JSON.stringify(map));
  } catch { /* storage blocked — the server record is what counts */ }
}
