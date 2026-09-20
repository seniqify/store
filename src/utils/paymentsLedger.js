/**
 * Manage → Payments: the OPERATIONAL lists, and nothing else.
 *
 * Every money total on this screen — received, still to collect, written off,
 * gross sales — now comes from src/utils/paymentsMetrics.js over the canonical
 * model and the uncapped facts feed. What is left here is the two lists that
 * genuinely need detailed rows, because they show a customer's name and phone
 * and hand off to WhatsApp: "needs attention" and "payments received".
 *
 * Those lists come from get_store_orders and are therefore CAPPED at the newest
 * 500 rows. That is acceptable for a worklist and unacceptable for accounting,
 * which is exactly why the two are no longer computed together. Do not add a
 * total here: a sum over a capped feed is a wrong number with a confident face.
 *
 * What was removed, and why:
 *   paymentKind()  a private ten-value money classifier. Superseded by canonical
 *                  classifyOrder / paymentState / shipmentState.
 *   isReturned()   a second return regex. Superseded by shipmentState, which it
 *                  agreed with on all 29 returned rows of the audited store.
 *   buildPayments() the money maths, including `paid_at || delivered_at ||
 *                  created_at` — the fallback that dated 77% of a 30-day
 *                  "received" figure by order date.
 */
import { classifyOrder, paymentState, dayKeyInZone } from './commerceMetrics.js';
import { isPaymentIncomplete, isPaymentUnconfirmed } from './orderState.js';
import { classifyBucket } from './deliveryStatus.js';
// The same backend fact Orders names: get_store_orders returns at most 500 rows.
import { DETAILED_ORDER_CAP } from './ordersView.js';

export { DETAILED_ORDER_CAP };

/** How collected money actually arrived. paid_via is the record of that; the
 *  customer's chosen payment_method is not evidence of anything. */
export function collectedChannel(o) {
  const via = String(o?.paid_via ?? '').toLowerCase().trim();
  if (via === 'cod_delivery') return 'cod_collected';
  if (via === 'razorpay') return 'online';
  if (via === 'payment_link') return 'link';
  // A COD order marked paid with no paid_via: the shopkeeper took the cash.
  if (!via && String(o?.payment_method ?? '').toLowerCase().trim() === 'cod') return 'cod_collected';
  return 'marked';
}

export const KIND_LABEL = {
  online:        'Paid online · Razorpay',
  link:          'Paid by payment link',
  cod_collected: 'COD collected on delivery',
  marked:        'Recorded as paid',
};

/** Did the detailed feed hand back a full page? Measured on the raw rows. */
export function isAtDetailedCap(rawRowCount) {
  return Number(rawRowCount) >= DETAILED_ORDER_CAP;
}

/**
 * The two lists.
 *
 * @param {Array}  orders     detailed rows from get_store_orders (capped)
 * @param {object} opts
 * @param {Set<string>|Array<string>} opts.periodKeys  merchant civil days in view
 * @param {string} [opts.timeZone]
 */
export function buildPaymentsLists(orders = [], { periodKeys = [], timeZone = 'Asia/Kolkata' } = {}) {
  const window = periodKeys instanceof Set ? periodKeys : new Set(periodKeys);
  const attention = [];
  const recent = [];

  for (const o of (Array.isArray(orders) ? orders : [])) {
    const kind = classifyOrder(o);
    // Cancelled and abandoned rows are nothing to chase. A payment-incomplete
    // one is not revenue either, but it IS what a worklist is for, so it stays.
    if (kind === 'cancelled' || kind === 'abandoned') continue;
    const amount = Number(o?.total) || 0;
    const state = kind === 'sale' ? paymentState(o) : 'outstanding';

    if (state === 'collected') {
      // Dated by paid_at and nothing else. A payment whose date was never
      // recorded cannot honestly be placed in a period, so it is not listed
      // here; its money is reported as undated on the card above.
      const key = o?.paid_at ? dayKeyInZone(Date.parse(o.paid_at), timeZone) : null;
      if (key && window.has(key)) {
        recent.push({ order: o, at: Date.parse(o.paid_at), amount, kind: collectedChannel(o) });
      }
      continue;
    }

    // ── Needs attention: ONE row per order.
    // The reasons are tested in the order they were before, and the first that
    // applies wins. Previously a delivery problem and a pending payment link
    // were pushed independently, so one order could occupy two rows of the
    // worklist. A pure projection fix; no reason changed its meaning.
    const reason =
      (o?.awb && classifyBucket(o) === 'attention') ? 'delivery_issue'
      : o?.payment_link_id ? 'link_pending'
      : isPaymentIncomplete(o) ? 'incomplete'
      : isPaymentUnconfirmed(o) ? 'unconfirmed'
      : null;
    if (reason) attention.push({ order: o, reason, amount });
  }

  const at = (o) => { const t = Date.parse(o?.created_at); return Number.isNaN(t) ? 0 : t; };
  attention.sort((a, b) => at(b.order) - at(a.order));
  recent.sort((a, b) => b.at - a.at);

  return { attention, recent: recent.slice(0, 50) };
}
