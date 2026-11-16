/**
 * "Ask for reviews" (founder, 2026-11-16; mockup 4G4RXkGPxexuUZYPDdwZeH): the
 * Reviews tab lists delivered orders, so nobody searches Orders one by one.
 *
 *   To ask           delivered, never asked, not skipped  (last 30 days; older on request)
 *   Asked, waiting   a review link was sent, no review yet
 *   Reviewed         at least one review came back for the order
 *
 * Pure (no network, no browser), so it is tested directly. The server
 * (issue_review_invite) is still the judge: canAskReview mirrors its rules so
 * the list never offers an order the server would refuse.
 */

export const ASK_WINDOW_DAYS = 30;
const DAY = 86400000;

/** The last 10 digits of any phone format (+91, spaces, dashes). */
export const phone10 = (v) => String(v ?? '').replace(/\D/g, '').slice(-10);

const ms = (iso) => {
  const t = Date.parse(iso ?? '');
  return Number.isFinite(t) ? t : null;
};

/** When it was delivered; created_at when the delivery time was not recorded. */
export const deliveredMs = (o) => ms(o?.delivered_at) ?? ms(o?.created_at);

/** Same rules as issue_review_invite (supabase/reviews-verified-forward.sql). */
export function canAskReview(o, shopPhones = []) {
  if (!o || o.status !== 'delivered') return false;
  if (!(Number(o.total) > 0)) return false;                       // service enquiries are ₹0
  if (!Array.isArray(o.items) || o.items.length === 0) return false;
  if (String(o.payment_method || '').toLowerCase() === 'online' && !o.paid && !o.payment_ref) return false;
  const p = phone10(o.customer_phone);
  if (!/^[6-9]\d{9}$/.test(p)) return false;
  if (shopPhones.map(phone10).filter(Boolean).includes(p)) return false; // the shop's own test orders
  return true;
}

const dayStart = (t) => {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

/** "today", "yesterday", "3 days ago". Empty when the time is unknown. */
export function daysAgo(t, now = Date.now()) {
  if (t === null || t === undefined || !Number.isFinite(t)) return '';
  const n = Math.max(0, Math.round((dayStart(now) - dayStart(t)) / DAY));
  return n === 0 ? 'today' : n === 1 ? 'yesterday' : `${n} days ago`;
}

/**
 * orders  — fetchOrders rows
 * asks    — get_review_asks rows: { order_id, asked_at, ask_count, skipped_at }
 * reviews — get_owner_reviews rows (order_id, rating, status, submitted_at)
 *
 * Returns the three lists plus `older` (never asked, delivered before the
 * window), `skipped` (how many the shop said not to ask) and `rate` (of the
 * orders asked, the share that reviewed; null before anyone was asked).
 */
export function buildReviewAsks(orders = [], asks = [], reviews = [], { now = Date.now(), shopPhones = [], days = ASK_WINDOW_DAYS } = {}) {
  const askBy = new Map((asks || []).map((a) => [String(a.order_id), a]));
  const revBy = new Map();
  for (const r of reviews || []) {
    if (!r?.order_id || r.status === 'legacy_unpublished') continue;
    const k = String(r.order_id);
    const cur = revBy.get(k) || { count: 0, sum: 0, at: 0 };
    cur.count += 1;
    cur.sum += Number(r.rating) || 0;
    cur.at = Math.max(cur.at, ms(r.submitted_at) || 0);
    revBy.set(k, cur);
  }

  const toAsk = [];
  const older = [];
  const asked = [];
  const reviewed = [];
  let skipped = 0;
  for (const o of orders || []) {
    if (!canAskReview(o, shopPhones)) continue;
    const id = String(o.id);
    const a = askBy.get(id);
    const rv = revBy.get(id);
    const row = { id, o, deliveredAt: deliveredMs(o), askedAt: ms(a?.asked_at), askCount: Number(a?.ask_count) || 0 };
    if (rv) {
      reviewed.push({ ...row, rating: Math.round((rv.sum / rv.count) * 10) / 10, reviews: rv.count, reviewedAt: rv.at });
    } else if (row.askCount > 0) {
      asked.push(row);
    } else if (a?.skipped_at) {
      skipped += 1;
    } else if (row.deliveredAt !== null && now - row.deliveredAt <= days * DAY) {
      toAsk.push(row);
    } else {
      older.push(row);
    }
  }
  toAsk.sort((x, y) => x.deliveredAt - y.deliveredAt);        // oldest first, before they forget
  older.sort((x, y) => (y.deliveredAt ?? 0) - (x.deliveredAt ?? 0));
  asked.sort((x, y) => (y.askedAt ?? 0) - (x.askedAt ?? 0));
  reviewed.sort((x, y) => y.reviewedAt - x.reviewedAt);
  const sent = asked.length + reviewed.length;
  return { toAsk, older, asked, reviewed, skipped, rate: sent ? Math.round((reviewed.length / sent) * 100) : null };
}

/** The asks list after this screen asked or skipped an order (before a reload). */
export function withAsk(asks = [], orderId, { asked = false, skipped = false, at = new Date().toISOString() } = {}) {
  const id = String(orderId);
  let found = false;
  const out = (asks || []).map((a) => {
    if (String(a.order_id) !== id) return a;
    found = true;
    return {
      ...a,
      ...(asked ? { asked_at: at, ask_count: (Number(a.ask_count) || 0) + 1, first_asked_at: a.first_asked_at || at } : {}),
      ...(skipped ? { skipped_at: at } : {}),
    };
  });
  if (!found) {
    out.push({
      order_id: orderId,
      asked_at: asked ? at : null,
      first_asked_at: asked ? at : null,
      ask_count: asked ? 1 : 0,
      skipped_at: skipped ? at : null,
    });
  }
  return out;
}
