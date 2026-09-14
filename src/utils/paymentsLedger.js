import { isPaymentIncomplete, isPaymentUnconfirmed } from './orderState.js';
import { classifyBucket } from './deliveryStatus.js';

/**
 * Manage → Payments: pure money maths over the store's orders. No network, so it
 * is unit-tested in node (tests/payments-ledger.test.mjs).
 *
 * Nothing here needs the seller to mark anything. COD becomes collected when the
 * courier (or the order) says delivered, and returned when the courier says it
 * came back — the database does that (supabase/payments-automation.sql). Online
 * payments are confirmed with Razorpay.
 *
 * Money is dated by when it happened: paid_at for money received, returned_at
 * for returns. Orders from before those times were recorded fall back to their
 * order date.
 */

const DAY = 86400000;

const ts = (iso) => { const t = new Date(iso).getTime(); return Number.isNaN(t) ? 0 : t; };
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const startOfDay = (ms) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };
/** Local calendar day, the seller's own today. */
export const dayKey = (ms) => new Date(ms).toLocaleDateString('en-CA');

export const KIND_LABEL = {
  online:        'Paid online · Razorpay',
  link:          'Paid by payment link',
  cod_collected: 'COD collected on delivery',
  marked:        'Marked paid by you',
  cod_due:       'COD to collect',
  cod_returned:  'Returned · not collected',
  incomplete:    'Payment not completed',
  unconfirmed:   'Payment not confirmed yet',
  unpaid:        'Unpaid',
  void:          'Cancelled',
};

/** Did the courier say this shipment is coming back, came back, or is lost? */
export function isReturned(o) {
  if (o?.shipment_outcome === 'returned' || o?.shipment_outcome === 'lost') return true;
  const raw = String(o?.shipment_status || '');
  return /rto|rts|return/i.test(raw) || /\blost\b/i.test(raw);
}

/** How an order's money stands. */
export function paymentKind(o) {
  if (o?.status === 'cancelled' || o?.status === 'abandoned') return 'void';
  const method = String(o?.payment_method || '').toLowerCase();
  if (o?.paid === true) {
    if (o.paid_via === 'payment_link') return 'link';
    if (o.paid_via === 'cod_delivery' || method === 'cod') return 'cod_collected';
    if (method === 'online' && o.payment_ref) return 'online';
    return 'marked';
  }
  if (method === 'cod' && isReturned(o)) return 'cod_returned';
  if (isPaymentUnconfirmed(o)) return 'unconfirmed';
  if (isPaymentIncomplete(o)) return 'incomplete';
  if (method === 'cod') return 'cod_due';
  return 'unpaid';
}

const PAID_KINDS = new Set(['online', 'link', 'cod_collected', 'marked']);

/**
 * @param {Array} orders   rows from get_store_orders (abandoned already excluded)
 * @param {{days?: number, now?: number}} opts  range = today and the days before it
 */
export function buildPayments(orders = [], { days = 1, now = Date.now() } = {}) {
  const start = startOfDay(now) - (Math.max(1, days) - 1) * DAY;
  const inRange = (at) => at >= start && at <= now + DAY;

  const received = { online: 0, cod: 0, other: 0, total: 0, onlineCount: 0, codCount: 0, otherCount: 0 };
  const codDue = { amount: 0, count: 0 };
  const returned = { amount: 0, count: 0 };
  const attention = [];
  const recent = [];

  const ledger = new Map();
  for (let d = startOfDay(now); d >= start; d -= DAY) {
    ledger.set(dayKey(d), { key: dayKey(d), at: d, online: 0, cod: 0, other: 0, total: 0 });
  }

  for (const o of orders || []) {
    const total = num(o?.total);
    if (total <= 0) continue;                 // enquiries carry no money
    const kind = paymentKind(o);
    if (kind === 'void') continue;

    if (PAID_KINDS.has(kind)) {
      const at = ts(o.paid_at) || ts(o.delivered_at) || ts(o.created_at);
      if (inRange(at)) {
        const bucket = kind === 'online' || kind === 'link' ? 'online' : kind === 'cod_collected' ? 'cod' : 'other';
        received[bucket] += total;
        received[`${bucket}Count`] += 1;
        received.total += total;
        const row = ledger.get(dayKey(at));
        if (row) { row[bucket] += total; row.total += total; }
        recent.push({ order: o, kind, at, amount: total, timeKnown: Boolean(o.paid_at) });
      }
      continue;
    }

    if (kind === 'cod_returned') {
      const at = ts(o.returned_at) || ts(o.created_at);
      if (inRange(at)) { returned.amount += total; returned.count += 1; }
      continue;
    }

    if (kind === 'cod_due') {
      codDue.amount += total;
      codDue.count += 1;
      // A delivery attempt went wrong (not contactable, undelivered, pending…).
      if (o.awb && classifyBucket(o) === 'attention') {
        attention.push({ order: o, reason: 'delivery_issue', amount: total });
      }
    }

    if (o.payment_link_id) {
      attention.push({ order: o, reason: 'link_pending', amount: total });
    } else if (kind === 'incomplete') {
      attention.push({ order: o, reason: 'incomplete', amount: total });
    } else if (kind === 'unconfirmed') {
      attention.push({ order: o, reason: 'unconfirmed', amount: total });
    }
  }

  attention.sort((a, b) => ts(b.order.created_at) - ts(a.order.created_at));
  recent.sort((a, b) => b.at - a.at);

  return {
    received,
    codDue,
    returned,
    attention,
    ledger: [...ledger.values()],
    recent: recent.slice(0, 50),
  };
}
