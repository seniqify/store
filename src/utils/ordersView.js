/**
 * Manage → Orders: a pure view over the rows the screen has actually loaded.
 *
 * Orders is an OPERATIONAL LIST, not a set of books. Its counters answer "how
 * many can I open?", so they count the loaded detailed rows — including the
 * cancelled ones, which the merchant still needs to see. That is why "N total"
 * reads 201 on the audited store while canonical Sales Orders is 182: the extra
 * 19 are 18 cancelled orders and 1 abandoned online payment, all of them real
 * rows with real customers.
 *
 * Nothing here is an accounting total. Gross Sales, Collected, Outstanding and
 * Written Off belong to commerceMetrics and are shown on Home, Stats and
 * Payments — never on this screen, because this screen can only ever see the
 * newest 500 rows.
 *
 * WHAT THIS MODULE DOES OWN is the translation between the canonical model and
 * the two things the list needs: which rows count as unpaid, and what a row's
 * payment chip should say. It takes eligibility from classifyOrder, returns from
 * shipmentState and day boundaries from dayKeyInZone. It defines no rule of its
 * own — no cancelled test, no payment-incomplete test, no return regex.
 *
 * FOUR SEPARATE DIMENSIONS, kept separate on purpose:
 *   fulfilment status  o.status — new / confirmed / dispatched / delivered /
 *                      cancelled. The merchant drives it. Never inferred here.
 *   payment status     paid, or one of the unpaid kinds below.
 *   shipment state     canonical: delivered / returned / in flight.
 *   accounting state   collected / outstanding / written off — commerceMetrics.
 *
 * A returned parcel that was never paid for is BOTH "Returned" and "Unpaid".
 * Those are answers to different questions and neither cancels the other.
 */
import { classifyOrder, shipmentState, dayKeyInZone } from './commerceMetrics.js';
// The existing shared helper for the one operational state the canonical model
// does not name: an online order already shipped whose payment Razorpay has not
// confirmed. Reused rather than re-derived - a second copy would drift.
import { isPaymentUnconfirmed } from './orderState.js';

/** The merchant's clock: Orders day chips are their civil days, not the browser's. */
export const ORDER_TZ = 'Asia/Kolkata';

/**
 * The row limit get_store_orders applies (`order by created_at desc limit 500`).
 * The backend contract, not a UI preference — if that SQL changes, change this.
 */
export const DETAILED_ORDER_CAP = 500;

/**
 * Rows the Orders list shows. Abandoned checkouts are not orders anybody placed,
 * and have their own tab; everything else the store took is listed, cancelled
 * rows included, because the merchant still needs to open them.
 */
export function listableRows(rows) {
  return (Array.isArray(rows) ? rows : []).filter((o) => classifyOrder(o) !== 'abandoned');
}

/**
 * Did the backend hand back a full page? Measured on the RAW row count, before
 * abandoned rows are dropped, because the LIMIT is applied before that filter —
 * on a store that is half abandoned checkouts, the list can be badly truncated
 * while holding far fewer than 500 rows.
 */
export function isAtDetailedCap(rawRowCount) {
  return Number(rawRowCount) >= DETAILED_ORDER_CAP;
}

/**
 * Is this a row the store actually took? Canonical eligibility, nothing else.
 *
 * The guard matters: classifyOrder is written for rows, so a null reads as a
 * zero-value enquiry and would otherwise be counted as an unpaid order.
 */
export function isListedSale(o) {
  if (!o || typeof o !== 'object') return false;
  const kind = classifyOrder(o);
  return kind === 'sale' || kind === 'enquiry';
}

/**
 * THE Unpaid predicate — a real order whose money has not arrived.
 *
 * This is the single definition behind both the chip's number and the rows the
 * chip shows when tapped. Do not inline a second copy of it anywhere: a chip
 * that says 91 while the filter renders 110 rows is worse than no chip.
 *
 * It is PAYMENT STATUS, not collectible balance. A returned parcel stays unpaid
 * here — the money genuinely never arrived — even though Home correctly leaves
 * it out of "to collect", because nobody can chase a parcel that came back.
 * On the audited store: 91 unpaid = 63 outstanding + 28 returned.
 *
 * Cancelled orders and abandoned online payments are excluded: neither is
 * waiting for money.
 */
export function isOrdersUnpaid(o) {
  return isListedSale(o) && o?.paid !== true;
}

/** How many loaded rows are unpaid. Leads carry no payment at all. */
export function countUnpaid(rows, { leads = false } = {}) {
  if (leads) return 0;
  return (Array.isArray(rows) ? rows : []).filter(isOrdersUnpaid).length;
}

/** Fulfilment-status tally over the loaded list. Counts rows, not money. */
export function statusCounts(rows) {
  const out = {};
  for (const o of (Array.isArray(rows) ? rows : [])) {
    const key = o?.status;
    if (key) out[key] = (out[key] || 0) + 1;
  }
  return out;
}

/**
 * What the payment chip on a card should say, in precedence order:
 *
 *   paid         money arrived — the truth regardless of what the parcel did.
 *   incomplete   the customer left the payment screen and nothing has happened
 *                since. Operationally distinct: this may not be a real order.
 *   returned     the parcel came back, so no money is coming. Canonical, so it
 *                catches UPI as well as COD, and a bare "Returned To Seller" or
 *                "RTO" string as well as a set shipment_outcome.
 *   unconfirmed  shipped online order Razorpay has not confirmed yet — money
 *                probably arrived.
 *   unpaid       nothing special; it is simply still owed.
 *
 * `incomplete` and `returned` cannot both apply: payment-incomplete requires the
 * order NOT to have shipped, and a return requires that it did. The order
 * between them is therefore stated for readability, not to break a tie.
 *
 * Returns null for leads, which carry no payment at all.
 */
export function paymentLabelState(o, { leads = false } = {}) {
  if (leads) return null;
  if (o?.paid === true) return 'paid';
  const kind = classifyOrder(o);
  if (kind === 'payment_incomplete') return 'incomplete';
  if (shipmentState(o) === 'returned') return 'returned';
  // Shipped, online, unpaid and unreferenced: Razorpay has not told us yet.
  if (isPaymentUnconfirmed(o)) return 'unconfirmed';
  return 'unpaid';
}

/** The merchant's civil date for an order, as 'YYYY-MM-DD'. */
export function orderDayKey(iso, timeZone = ORDER_TZ) {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? '' : (dayKeyInZone(t, timeZone) || '');
}

/** The merchant's today and yesterday, as day keys. `now` is supplied. */
export function todayKeys(now, timeZone = ORDER_TZ) {
  // Number(null) is 0, which is finite - without this the epoch would pass for
  // a clock reading and "Today" would quietly mean 1 January 1970.
  if (typeof now !== 'number' || !Number.isFinite(now)) return { today: '', yesterday: '' };
  const t = now;
  return {
    today: dayKeyInZone(t, timeZone) || '',
    yesterday: dayKeyInZone(t - 86400000, timeZone) || '',
  };
}

/** Tally of loaded rows per merchant civil day, for the date chips. */
export function dayCounts(rows, timeZone = ORDER_TZ) {
  const out = {};
  for (const o of (Array.isArray(rows) ? rows : [])) {
    const key = orderDayKey(o?.created_at, timeZone);
    if (key) out[key] = (out[key] || 0) + 1;
  }
  return out;
}
