// AI ad copy for PocketLink's Meta ads flow — server-only.
//
// The model only sees the store's real facts and returns JSON that matches a
// schema. Every suggestion, and anything the merchant types instead, then goes
// through the same screening before it can reach an ad:
//   • Meta-friendly lengths (headline 40, primary text 125, description 30)
//   • no links, phone numbers or hashtags (the ad's button carries the link)
//   • no price that is not one of the store's own prices
//   • no discount, sale or free-delivery claim the store data does not support
// Only words come from here. The link, image and button target are always the
// store's own, set by the campaign builder.
//
// No SDK import: the route passes in a client, so this file stays testable.

export const COPY_MODEL = 'claude-opus-5';
export const COPY_FALLBACK_MODEL = 'claude-opus-4-8';
export const COPY_TIMEOUT_MS = 25000;   // inside the route's 30 s limit, no retries

export const LIMITS = Object.freeze({ headline: 40, primaryText: 125, description: 30 });
export const CTA_ALLOWED = Object.freeze(['SHOP_NOW', 'ORDER_NOW', 'BUY_NOW', 'LEARN_MORE']);

export const COPY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['variants', 'audience', 'notes'],
  properties: {
    variants: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['headline', 'primaryText', 'description', 'cta', 'angle'],
        properties: {
          headline: { type: 'string', description: 'At most 40 characters.' },
          primaryText: { type: 'string', description: 'At most 125 characters.' },
          description: { type: 'string', description: 'At most 30 characters.' },
          cta: { type: 'string', enum: [...CTA_ALLOWED] },
          angle: { type: 'string', description: 'Two or three words naming the idea, e.g. "Value for money".' },
        },
      },
    },
    audience: {
      type: 'object',
      additionalProperties: false,
      required: ['ageMin', 'ageMax', 'gender', 'why'],
      properties: {
        ageMin: { type: 'integer' },
        ageMax: { type: 'integer' },
        gender: { type: 'string', enum: ['all', 'women', 'men'] },
        why: { type: 'string' },
      },
    },
    notes: { type: 'string' },
  },
};

const SYSTEM = [
  'You write Facebook and Instagram ad copy for small Indian shops that sell through PocketLink.',
  'Use only the facts you are given. Do not invent offers, discounts, delivery times, free delivery, health or medical benefits, rankings, awards, reviews or quantities.',
  'If you mention a price, use exactly the price given, written as ₹ followed by the number. Mention the MRP only when one is given.',
  'Write in simple, friendly Indian English that a shop owner would be happy to sign.',
  'Keep every headline to 40 characters, every primary text to 125 characters and every description to 30 characters.',
  'Do not include links, phone numbers or hashtags. Use at most one emoji per variant.',
  'Follow Meta advertising policy: never address the reader\'s personal attributes (health, body, finances, age), and avoid sensational or before-and-after claims.',
  'Give three variants with clearly different angles, for example value, quality or taste, and convenience.',
  'Suggest an audience: an age range between 18 and 65, and a gender only when the product is clearly meant for one; otherwise "all". Explain the choice in one short sentence.',
  'Use notes for anything the shop owner should know, such as a fact that would make the ads stronger if they added it to the product.',
].join('\n');

// ── Facts the model may use ───────────────────────────────────────────────────

/** Store + product facts for the prompt, plus the prices and claims the copy may state. */
export function copyFacts(cfg = {}, product = null, { packLabel = null } = {}) {
  const price = Number(product?.price) || null;
  const options = Array.isArray(product?.variants?.options) ? product.variants.options : [];
  const matching = options.find((o) => Number(o?.price) === price);
  const mrpRaw = Number(product?.mrp || matching?.mrp) || null;
  const mrp = price && mrpRaw && mrpRaw > price ? mrpRaw : null;
  const discountPercent = mrp ? Math.round((1 - price / mrp) * 100) : null;
  const variantPrices = options.map((o) => Number(o?.price)).filter((n) => Number.isFinite(n) && n > 0);
  return {
    store: String(cfg.businessName || ''),
    city: String(cfg.city || ''),
    tagline: String(cfg.tagline || ''),
    product: product ? {
      name: String(product.name || ''),
      description: String(product.description || '').slice(0, 400),
      price, mrp, pack: packLabel, unit: product.unit || null, category: product.category || null,
    } : null,
    freeDelivery: cfg?.cart?.freeDelivery === true,
    discountPercent,
    allowedPrices: [...new Set([price, mrp, ...variantPrices].filter(Boolean))],
  };
}

// ── Screening ─────────────────────────────────────────────────────────────────

const URL_RE = /\bhttps?:\/\/\S+|\bwww\.\S+|\b[a-z0-9-]+\.(?:com|in|co|store|net|org|shop)\b\S*/gi;
const PHONE_RE = /(?:\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}\b/g;
const HASHTAG_RE = /#[\p{L}\p{N}_]+/gu;

function tidy(value, max) {
  let t = String(value ?? '').replace(URL_RE, '').replace(PHONE_RE, '').replace(HASHTAG_RE, '').replace(/\s+/g, ' ').trim();
  if (t.length > max) {
    const cut = t.slice(0, max);
    t = (cut.replace(/\s+\S*$/, '') || cut).trim();
  }
  return t;
}

/** Every ₹ / Rs / INR amount in the text is one of the store's own prices. */
export function pricesAreTrue(text, allowedPrices = []) {
  const allowed = new Set(allowedPrices.map(Number));
  const amounts = [...String(text).matchAll(/(?:₹|\brs\.?|\binr)\s?([\d,]+(?:\.\d+)?)/gi)]
    .map((m) => Number(m[1].replace(/,/g, '')));
  return amounts.every((a) => allowed.has(a));
}

/** No discount, sale or free-delivery claim the store data does not support. */
export function claimsAreTrue(text, { discountPercent = null, freeDelivery = false } = {}) {
  const s = String(text);
  const percents = [...s.matchAll(/(\d{1,2})\s?%/g)].map((m) => Number(m[1]));
  if (percents.length && !percents.every((p) => discountPercent != null && p === discountPercent)) return false;
  if (/\b(discount|sale|off)\b/i.test(s) && discountPercent == null) return false;
  if (/\bfree\s+(home\s+)?(delivery|shipping)\b/i.test(s) && !freeDelivery) return false;
  return true;
}

/** One variant (from the model or the merchant) → safe copy, or null. */
export function cleanCopy(variant, facts = {}) {
  if (!variant || typeof variant !== 'object') return null;
  const headline = tidy(variant.headline, LIMITS.headline);
  const primaryText = tidy(variant.primaryText, LIMITS.primaryText);
  const description = tidy(variant.description, LIMITS.description);
  if (headline.length < 3 || primaryText.length < 10) return null;
  const all = `${headline} ${primaryText} ${description}`;
  if (!pricesAreTrue(all, facts.allowedPrices || [])) return null;
  if (!claimsAreTrue(all, facts)) return null;
  return {
    headline, primaryText, description,
    cta: CTA_ALLOWED.includes(variant.cta) ? variant.cta : 'SHOP_NOW',
    angle: tidy(variant.angle, 40),
  };
}

/** Audience suggestion → inside Meta's and PocketLink's bounds. */
export function cleanAudience(a) {
  let ageMin = Math.round(Number(a?.ageMin) || 18);
  ageMin = Math.min(65, Math.max(18, ageMin));
  let ageMax = Math.round(Number(a?.ageMax) || 65);
  ageMax = Math.min(65, Math.max(ageMin, ageMax));
  const gender = ['all', 'women', 'men'].includes(a?.gender) ? a.gender : 'all';
  return { ageMin, ageMax, gender, why: tidy(a?.why, 160) };
}

// ── Request ───────────────────────────────────────────────────────────────────

/** The Messages API request (beta endpoint, for server-side refusal fallback). */
export function buildCopyRequest(facts) {
  // Screening data (allowedPrices) is ours; the model only needs the facts.
  const forModel = { ...(facts || {}) };
  delete forModel.allowedPrices;
  return {
    model: COPY_MODEL,
    max_tokens: 4000,
    betas: ['server-side-fallback-2026-06-01'],
    fallbacks: [{ model: COPY_FALLBACK_MODEL }],
    system: SYSTEM,
    output_config: { effort: 'low', format: { type: 'json_schema', schema: COPY_SCHEMA } },
    messages: [{ role: 'user', content: `Write ads for this shop.\n\n${JSON.stringify(forModel)}` }],
  };
}

/**
 * Ask the model for ad copy and screen it.
 * → { variants, audience, notes }  or  { error: 'busy' | 'declined' | 'no_suggestion' }
 */
export async function generateAdCopy({ client, facts }) {
  let response;
  try {
    response = await client.beta.messages.create(buildCopyRequest(facts), { timeout: COPY_TIMEOUT_MS, maxRetries: 0 });
  } catch {
    return { error: 'busy' };
  }
  if (response?.stop_reason === 'refusal') return { error: 'declined' };
  const text = (Array.isArray(response?.content) ? response.content : [])
    .filter((b) => b?.type === 'text')
    .map((b) => b.text)
    .join('');
  let data;
  try { data = JSON.parse(text); } catch { return { error: 'no_suggestion' }; }
  const variants = (Array.isArray(data?.variants) ? data.variants : [])
    .map((v) => cleanCopy(v, facts))
    .filter(Boolean)
    .slice(0, 3);
  if (!variants.length) return { error: 'no_suggestion' };
  return { variants, audience: cleanAudience(data.audience), notes: tidy(data.notes, 300) };
}
