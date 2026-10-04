/**
 * WhatsApp offers — message text, pure (tested directly).
 *
 * A message is written with placeholders the server understands
 * (supabase/offers-forward.sql, offer_value_map): {name} and {shop} are filled
 * per customer; {offer} {item} {code} {date} are filled by the shop at send
 * time. The "Shop now" button is added to every message. These helpers only
 * PREVIEW and pre-check; the server checks again before anything is sent.
 */

export const OFFER_FIELDS = Object.freeze({
  offer: { label: 'Your offer',  placeholder: 'e.g. 20% off all agarbatti' },
  item:  { label: 'Product',     placeholder: 'e.g. Six-Fragrance Combo' },
  code:  { label: 'Coupon code', placeholder: 'e.g. DIWALI20' },
  date:  { label: 'Valid till',  placeholder: 'e.g. 31 Oct' },
});
const ALLOWED = new Set(['name', 'shop', ...Object.keys(OFFER_FIELDS)]);

/** Customers per send-offer call; the screen sends a big group in batches. */
export const OFFER_BATCH = 100;

/** The placeholders in a message, in order, and any the server would refuse. */
export function placeholdersIn(body) {
  const found = [...String(body || '').matchAll(/\{([^{}]*)\}/g)].map((m) => m[1]);
  return { keys: found.filter((k) => ALLOWED.has(k)), unknown: found.filter((k) => !ALLOWED.has(k)) };
}

/** Same rule as the server's offer_field_ok: one short line, never a link. */
export function fieldError(value) {
  const v = String(value ?? '').trim();
  if (!v) return 'Fill this in.';
  if (v.length > 60) return 'Keep it under 60 characters.';
  if (/(https?:\/\/|www\.|\.(com|in|net|org|link|ly|me)\b|wa\.me)/i.test(v)) return 'No links — the message already has a Shop now button.';
  return '';
}

/** Pre-check a shop's own message before requesting it. '' when fine. */
export function requestError(name, body) {
  if (String(name || '').trim().length < 2) return 'Give the message a short name.';
  const b = String(body || '').trim();
  if (b.length < 10 || b.length > 600) return 'The message must be 10 to 600 characters.';
  if (/(https?:\/\/|www\.|wa\.me)/i.test(b)) return 'Leave links out — every message gets a "Shop now" button to your shop.';
  const { unknown } = placeholdersIn(b);
  if (unknown.length) return `Unknown {${unknown[0]}} — use {name}, {shop}, {offer}, {item}, {code} or {date}.`;
  return '';
}

/** The message as a customer would read it. */
export function fillOffer(body, { name = '', shop = '', fields = {} } = {}) {
  return String(body || '').replace(/\{([^{}]*)\}/g, (all, k) => {
    if (k === 'name') return String(name || '').trim().split(/\s+/)[0] || 'there';
    if (k === 'shop') return String(shop || '').trim() || 'our shop';
    if (k in OFFER_FIELDS) return String(fields?.[k] || '').trim() || `{${k}}`;
    return all;
  });
}

const SAMPLE = {
  name: 'Asha', shop: 'Krupa Agarbatti Work', offer: '20% off all agarbatti',
  item: 'Six-Fragrance Combo', code: 'DIWALI20', date: '31 Oct',
};

/**
 * What the founder types into Seniqify for a message: placeholders become
 * {{1}}, {{2}}, ... in order of appearance (exactly offer_value_map's order),
 * the "Shop now" button is the next number, plus sample values for Meta's
 * review. The button URL follows the approved "order confirm" pattern:
 * https://www.pocketlink.store/ + {{n}} = the shop's slug.
 */
export function seniqifyTemplate(body, sampleSlug = 'krupaagarbattiwork') {
  let n = 0;
  const samples = [];
  const text = String(body || '').replace(/\{([^{}]*)\}/g, (all, k) => {
    if (!(k in SAMPLE)) return all;
    n += 1;
    samples.push({ n, key: k, sample: SAMPLE[k] });
    return `{{${n}}}`;
  });
  const button = n + 1;
  return {
    text,
    samples,
    button: {
      number: button,
      label: 'Shop now',
      websiteUrl: 'https://www.pocketlink.store/',
      sample: `https://www.pocketlink.store/${sampleSlug}`,
    },
  };
}

/** Split a list into send-offer sized batches. */
export function batches(list, size = OFFER_BATCH) {
  const out = [];
  const arr = Array.isArray(list) ? list : [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
