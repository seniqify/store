/**
 * Manage → Delivery: the fulfilment picture, projected from the canonical model.
 *
 * DELIVERY IS THE LOGISTICS AUTHORITY. PAYMENTS IS THE FINANCIAL ONE. This file
 * deliberately does not produce Gross Sales, Collected, Still to collect or
 * Written off — those belong to Payments, and duplicating them here is how two
 * screens start disagreeing about the same money.
 *
 * What it does produce is the shipment population and the one money figure that
 * is genuinely about shipments rather than about the books.
 *
 * ── THE POPULATION ──────────────────────────────────────────────────────────
 *
 *   DELIVERY_ORDERS = SALE_ORDERS that carry an AWB.
 *
 * A cancelled order keeps its AWB, so the board's list can still show it for
 * historical tracking — but it is NOT a delivery order and must never reach
 * these totals. On the audited store exactly one row is in that position, worth
 * ₹340, and it is the same row that has had to be excluded on Orders, Home and
 * Payments in turn.
 *
 * Orders with no AWB are not deliveries either. They are "not shipped yet",
 * reported separately and deliberately OUTSIDE the identity:
 *
 *   Delivery Orders = Delivered + Returned + In Flight
 *
 * ── THE CLASSIFIER ──────────────────────────────────────────────────────────
 *
 * Every state here comes from canonical shipmentState, never from the board's
 * display buckets. classifyBucket reads only `shipment_status`, so a parcel
 * whose `shipment_outcome` says "returned" while its status string still reads
 * "Item added to Bag" shows as in transit — four such parcels on the audited
 * store, ₹1,360 of returns presented as still moving. Buckets stay useful for
 * courier detail; they decide nothing that is counted.
 *
 * ── THE MONEY ───────────────────────────────────────────────────────────────
 *
 * The old board summed COD on anything its bucket did not call delivered or
 * cancelled, and never looked at `paid`. That produced 58 / ₹25,230, of which
 * ₹11,620 was on parcels that had already come back. The canonical replacement
 * is codOnUndelivered — COD owed on shipments still in flight — which excludes
 * returns and paid orders by construction. It is a strict subset of Payments'
 * Outstanding and must never be labelled as if it were the whole of it.
 *
 * NO DATE RANGES. delivered_at exists on 15 of 80 delivered rows and
 * returned_at on 9 of 29 returned ones, so a "delivered this week" figure would
 * be mostly blind. Current state only, and no timestamp is ever inferred.
 */
import {
  buildCommerceMetrics, checkInvariants, classifyOrder, shipmentState, paymentState,
} from './commerceMetrics.js';
// One backend fact, named once: get_store_orders returns at most 500 rows.
import { DETAILED_ORDER_CAP } from './ordersView.js';

export { DETAILED_ORDER_CAP };

const paise = (v) => { const n = Number(v); return Number.isFinite(n) ? Math.round(n * 100) : 0; };
const empty = () => ({ count: 0, amount: 0 });
const add = (b, p) => { b.count += 1; b.amount += p; };
const done = (b) => ({ count: b.count, amount: b.amount / 100 });

/** A row the store actually took. Canonical eligibility, nothing else. */
const isSale = (o) => classifyOrder(o) === 'sale';

/** Did the detailed feed hand back a full page? Measured on the raw rows. */
export function isAtDetailedCap(rawRowCount) {
  return Number(rawRowCount) >= DETAILED_ORDER_CAP;
}

/**
 * @param {Array<object>} facts  rows from get_store_order_facts (UNCAPPED)
 * @param {object} [opts]
 * @param {string} [opts.timeZone]  only forwarded to the model; nothing here is dated
 */
export function buildDeliveryMetrics(facts, { timeZone = 'Asia/Kolkata' } = {}) {
  const rows = Array.isArray(facts) ? facts : [];
  const canonical = buildCommerceMetrics(rows, { timeZone });
  const d = canonical.delivery;

  // ── Secondary, row-selected. Everything below takes its eligibility, its
  //    shipment state and its payment state from the canonical helpers.
  const notShipped = empty();
  const notShippedOutstanding = empty();
  const deliveredPaymentPending = empty();
  const returnedPaymentRecorded = empty();

  for (const o of rows) {
    if (!isSale(o)) continue;                 // cancelled / abandoned / incomplete
    const amount = paise(o?.total);
    const ship = shipmentState(o);
    const pay = paymentState(o);

    if (!String(o?.awb ?? '').trim()) {
      // Accepted, not handed to a courier. Outside DELIVERY_ORDERS on purpose.
      add(notShipped, amount);
      if (pay === 'outstanding') add(notShippedOutstanding, amount);
      continue;
    }

    // Goods gone, money not in. Operationally urgent; NOT a second "still to
    // collect" - Payments owns that number over a different population.
    if (ship === 'delivered' && pay === 'outstanding') add(deliveredPaymentPending, amount);

    // The parcel came back AND the money is recorded as received. We cannot say
    // whether it was refunded: PocketLink stores no refund state at all. Named
    // neutrally for that reason.
    if (ship === 'returned' && pay === 'collected') add(returnedPaymentRecorded, amount);
  }

  const identityHolds =
    d.delivered.count + d.returned.count + d.inFlight.count === d.orders.count
    && paise(d.delivered.amount) + paise(d.returned.amount) + paise(d.inFlight.amount)
       === paise(d.orders.amount);

  return {
    // the canonical fulfilment population
    orders: d.orders,
    delivered: d.delivered,
    returned: d.returned,
    inFlight: d.inFlight,
    identityHolds,

    // the one money figure that is about shipments, not about the books
    codOnUndelivered: d.codOnUndelivered,

    // operational queues, deliberately outside the identity above
    notShipped: done(notShipped),
    notShippedOutstanding: done(notShippedOutstanding),
    deliveredPaymentPending: done(deliveredPaymentPending),
    returnedPaymentRecorded: done(returnedPaymentRecorded),

    canonical,
    invariants: checkInvariants(canonical),
  };
}
