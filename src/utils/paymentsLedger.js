import { isPaymentIncomplete } from './orderState.js';

/**
 * Manage → Payments: pure money maths over the store's orders. No network, so it
 * is unit-tested in node (tests/payments-ledger.test.mjs).
 *
 * Received money is dated by paid_at (when it arrived). Orders paid before
 * paid_at existed have no recorded time, so they fall back to their order date.
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
  cod_collected: 'COD collected',
  marked:        'Marked paid by you',
  cod_due:       'COD to collect',
  incomplete:    'Payment not completed',
  unpaid:        'Unpaid',
  void:          'Cancelled',
};

/** How an order's money stands. */
export function paymentKind(o) {
  if (o?.status === 'cancelled' || o?.status === 'abandoned') return 'void';
  const method = String(o?.payment_method || '').toLowerCase();
  if (o?.paid === true) {
    if (o.paid_via === 'payment_link') return 'link';
    if (method === 'cod') return 'cod_collected';
    if (method === 'online' && o.payment_ref) return 'online';
    return 'marked';
  }
  if (isPaymentIncomplete(o)) return 'incomplete';
  if (method === 'cod') return 'cod_due';
  return 'unpaid';
}

const PAID_KINDS = new Set(['online', 'link', 'cod_collected', 'marked']);

/** Did the courier or the seller mark this COD order delivered? */
function delivered(o) {
  if (o?.status === 'delivered') return true;
  const raw = String(o?.shipment_status || '').toLowerCase();
  return !/cancel/.test(raw) && /\bdelivered\b/.test(raw);
}

/**
 * @param {Array} orders   rows from get_store_orders (abandoned already excluded)
 * @param {{days?: number, now?: number}} opts  range = today and the days before it
 */
export function buildPayments(orders = [], { days = 1, now = Date.now() } = {}) {
  const start = startOfDay(now) - (Math.max(1, days) - 1) * DAY;

  const received = { online: 0, cod: 0, other: 0, total: 0, onlineCount: 0, codCount: 0, otherCount: 0 };
  const codDue = { amount: 0, count: 0 };
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
      const at = ts(o.paid_at) || ts(o.created_at);
      if (at >= start && at <= now + DAY) {
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

    if (kind === 'cod_due') {
      codDue.amount += total;
      codDue.count += 1;
    }

    // What the seller should act on, most urgent reason first.
    if (o.payment_link_id) {
      attention.push({ order: o, reason: 'link_pending', amount: total });
    } else if (kind === 'incomplete') {
      attention.push({ order: o, reason: 'incomplete', amount: total });
    } else if (kind === 'cod_due' && delivered(o)) {
      attention.push({ order: o, reason: 'cod_delivered', amount: total });
    }
  }

  attention.sort((a, b) => ts(b.order.created_at) - ts(a.order.created_at));
  recent.sort((a, b) => b.at - a.at);

  return {
    received,
    codDue,
    attention,
    ledger: [...ledger.values()],
    recent: recent.slice(0, 50),
  };
}
