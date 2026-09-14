/**
 * Pure helpers for verified-purchase reviews — no network and no React, so they
 * run in plain node (tests/review-shape.test.mjs). The service layer
 * (reviewService.js) and the components build on these.
 */

/** The catalogue product id of a cart line. Variant lines are `${id}::${pick}…`. */
export function lineProductId(line) {
  const raw = line?.id;
  if (raw === undefined || raw === null || raw === '') return null;
  return String(raw).split('::')[0] || null;
}

/**
 * A public product_reviews row → the shape the storefront renders. Keeps the
 * old field names (customer_name, comment, created_at) so the header, hero,
 * checkout and overview that already read reviews keep working unchanged.
 */
export function toPublicReview(row = {}) {
  return {
    id:            row.id,
    customer_name: row.display_name || 'Customer',
    rating:        Number(row.rating) || 0,
    comment:       row.body || '',
    created_at:    row.submitted_at || null,
    verified:      row.verified_purchase === true,
    productId:     row.product_id ?? null,
    itemName:      row.item_name || '',
    variant:       row.variant || '',
    reply:         row.merchant_reply || '',
    repliedAt:     row.merchant_replied_at || null,
    edited:        Number(row.edit_count) > 0,
  };
}

/** { avg, count } from a list of reviews. avg rounded to 1 dp. */
export function reviewStats(reviews = []) {
  const count = reviews.length;
  if (!count) return { avg: 0, count: 0 };
  const sum = reviews.reduce((s, r) => s + (Number(r.rating) || 0), 0);
  return { avg: Math.round((sum / count) * 10) / 10, count };
}

/** [{ store_slug, rating }] → { [slug]: { avg, count } } for the marketplace. */
export function ratingsByStore(rows = []) {
  const acc = {};
  for (const r of rows || []) {
    const k = r?.store_slug;
    if (!k) continue;
    (acc[k] ??= { sum: 0, count: 0 });
    acc[k].sum += Number(r.rating) || 0;
    acc[k].count += 1;
  }
  const out = {};
  for (const [k, v] of Object.entries(acc)) {
    out[k] = { avg: Math.round((v.sum / v.count) * 10) / 10, count: v.count };
  }
  return out;
}

/** The customer's review page for one invite token. */
export function reviewLink(origin, token) {
  const base = String(origin || 'https://www.pocketlink.store').replace(/\/+$/, '');
  return `${base}/review/${encodeURIComponent(token)}`;
}

/**
 * The WhatsApp message a seller sends with the link. Plain text on purpose: no
 * emoji (they turn into � on some WhatsApp clients), and it says the link is
 * personal so it is not forwarded around.
 */
export function reviewInviteMessage({ customerName, storeName, link } = {}) {
  const first = String(customerName || '').trim().split(/\s+/)[0];
  return `${first ? `Hi ${first}` : 'Hi'}, thank you for your order from *${storeName || 'our store'}*.\n\n` +
    `How was it? Please rate what you bought. It takes 30 seconds and helps other customers:\n` +
    `${link}\n\n` +
    `This link is only for your order.`;
}
