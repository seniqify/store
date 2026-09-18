/**
 * commerceMetrics — the one definition of every commerce number PocketLink shows.
 *
 * Manage → Home, Orders, Payments, Delivery and Stats are five views of one
 * table. Today each computes its own totals from its own fetch, through four
 * different validity filters and four different shipment classifiers, and two
 * of them print "COD still to collect" from populations that do not agree.
 * This module is the single implementation they will all consume.
 *
 * NOTHING CONSUMES IT YET. PR 3 adds the model; PRs 4-8 move the screens one at
 * a time, and the first two must not change a single number.
 *
 * ---------------------------------------------------------------------------
 * PURE, BY CONTRACT
 *
 *   * no network, no Supabase, no React, no imports from the app
 *   * never mutates its input, and never returns a reference into it
 *   * deterministic: same input, same output, in any row order
 *   * NO CLOCK AT ALL. The module never calls Date.now(). Balances do not
 *     depend on the time, and a flow is bounded by an explicit range the caller
 *     passes in.
 *   * no hidden timezone — `timeZone` is an argument, because "today" for a
 *     merchant in Solapur is not the server's today, and a test must be able to
 *     sit on either side of midnight
 *
 * ---------------------------------------------------------------------------
 * BALANCES VS FLOWS — the rule the codebase never wrote down
 *
 *   A BALANCE is a position. It is never range-scoped. "Outstanding" means
 *   everything still owed, not everything owed that happens to have been
 *   ordered this month.
 *
 *   A FLOW is money or events moving in a window, and it is dated by the event
 *   that actually happened: a payment by paid_at, a delivery by delivered_at,
 *   a return by returned_at, an order by created_at.
 *
 *   A flow NEVER falls back to a different timestamp. The existing payments
 *   ledger dates money paid_at -> delivered_at -> created_at, which on the
 *   busiest production store attributes 87% of collected money to the ORDER
 *   date. Here, money whose paid_at is unknown is reported separately as
 *   `collectedUnknownDate` and is excluded from every dated flow. It still
 *   counts in the Collected BALANCE, because the money is real; only its date
 *   is not.
 */

// ── primitives ───────────────────────────────────────────────────────────────

const ms = (iso) => {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : null;
};

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const lower = (v) => String(v ?? '').toLowerCase().trim();

/** Money is compared and summed in whole paise to keep the identities exact. */
const paise = (v) => Math.round(num(v) * 100);
const rupees = (p) => p / 100;

// ── canonical vocabularies ───────────────────────────────────────────────────

/** What KIND of row this is. Mutually exclusive, evaluated in this order. */
export const ORDER_KINDS = Object.freeze([
  'abandoned',           // a checkout the customer never sent
  'cancelled',           // the seller cancelled it
  'payment_incomplete',  // online, unpaid, no reference, never shipped
  'enquiry',             // a service lead: total <= 0
  'sale',                // everything else
]);

/** Where an order's money stands. Mutually exclusive over REVENUE_ORDERS. */
export const PAYMENT_STATES = Object.freeze(['collected', 'outstanding', 'written_off']);

/** Where a shipment stands. Mutually exclusive over DELIVERY_ORDERS. */
export const DELIVERY_STATES = Object.freeze(['delivered', 'returned', 'in_flight']);

/** Courier strings that mean the parcel is coming back, is back, or is gone. */
const RETURN_RE = /rto|rts|return|lost/;
/**
 * \b alone is not enough. It correctly refuses "undelivered" (no boundary
 * between "un" and "delivered") but it HAPPILY MATCHES "Not Delivered", which
 * is a failed attempt, not a delivery. The SQL classifier
 * shipment_outcome_of() guards this explicitly with
 *   p_status !~* '(undeliver|not deliver)'
 * and this must agree with it or the two disagree on real courier strings.
 */
const DELIVERED_RE = /\bdelivered\b/;
const NOT_DELIVERED_RE = /undeliver|not deliver/;

// ── classification ───────────────────────────────────────────────────────────

/**
 * Has this order been handed to a courier or reached the customer?
 *
 * NULL-SAFE ON PURPOSE. Written as a SQL predicate this reads
 *   awb <> '' or status in (...) or shipment_outcome = 'delivered'
 * and a NULL shipment_outcome makes the whole disjunction NULL rather than
 * false, which silently drops rows. That bug was in the audit's own helper
 * queries. Here every comparison is on a coerced string.
 */
export function isShippedOrDelivered(o) {
  return Boolean(lower(o?.awb))
    || lower(o?.status) === 'dispatched'
    || lower(o?.status) === 'delivered'
    || lower(o?.shipment_outcome) === 'delivered';
}

/** An online order the customer left without paying, and nothing happened since. */
export function isPaymentIncomplete(o) {
  return lower(o?.payment_method) === 'online'
    && o?.paid !== true
    && !o?.payment_ref
    && !isShippedOrDelivered(o);
}

/**
 * The kind of row. Order matters: a cancelled order that is also payment
 * incomplete is cancelled, and an abandoned checkout is abandoned first of all.
 */
export function classifyOrder(o) {
  const status = lower(o?.status);
  if (status === 'abandoned') return 'abandoned';
  if (status === 'cancelled') return 'cancelled';
  if (isPaymentIncomplete(o)) return 'payment_incomplete';
  if (paise(o?.total) <= 0) return 'enquiry';
  return 'sale';
}

/**
 * Where a shipment stands, by the approved precedence:
 *
 *   1. shipment_outcome   the database's own classification, written by the
 *                         orders_payment_automation trigger from
 *                         shipment_outcome_of(). Authoritative.
 *   2. order.status       the seller's own confirmation, e.g. a local delivery
 *                         with no courier at all.
 *   3. shipment_status    the raw courier string, for rows the trigger never
 *                         swept.
 *
 * RETURN IS EVALUATED BEFORE DELIVERED at every level, because legacy courier
 * strings contain both: Delhivery's "RTO Delivered" is a parcel that came BACK,
 * and reading it as a delivery would book revenue that never arrived.
 *
 * Returns null when there is no shipment at all.
 */
export function shipmentState(o) {
  const outcome = lower(o?.shipment_outcome);
  if (outcome === 'returned' || outcome === 'lost') return 'returned';
  if (outcome === 'delivered') return 'delivered';

  const status = lower(o?.status);
  if (status === 'delivered') return 'delivered';

  const raw = lower(o?.shipment_status);
  if (RETURN_RE.test(raw)) return 'returned';
  if (DELIVERED_RE.test(raw) && !NOT_DELIVERED_RE.test(raw)) return 'delivered';

  return lower(o?.awb) ? 'in_flight' : null;
}

/**
 * Where an order's money stands. Defined over REVENUE_ORDERS only.
 *
 *   collected    the money arrived
 *   written_off  it did not, and the parcel came back — it is not coming
 *   outstanding  everything else: still owed
 *
 * `paid` is the authority for collected, not the courier status: a seller who
 * marks a COD order paid has been paid, whatever the tracking says.
 */
export function paymentState(o) {
  if (o?.paid === true) return 'collected';
  if (shipmentState(o) === 'returned') return 'written_off';
  return 'outstanding';
}

// ── date handling ────────────────────────────────────────────────────────────

/**
 * The calendar day an instant falls on, in a named zone.
 * Returns 'YYYY-MM-DD' — the merchant's day, not the server's.
 */
export function dayKeyInZone(msVal, timeZone = 'Asia/Kolkata') {
  if (msVal === null || msVal === undefined) return null;
  const d = new Date(msVal);
  if (Number.isNaN(d.getTime())) return null;
  // en-CA renders as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
}

/**
 * Split a day key back into its parts, as a UTC-midnight instant.
 * A day key is a civil date, so this is string parsing, not a zone conversion.
 */
function dayKeyToUtcMidnight(key) {
  if (typeof key !== 'string' || key.length !== 10) return null;
  if (key[4] !== '-' || key[7] !== '-') return null;
  const y = Number(key.slice(0, 4));
  const mo = Number(key.slice(5, 7));
  const d = Number(key.slice(8, 10));
  if (!Number.isInteger(y) || !Number.isInteger(mo) || !Number.isInteger(d)) return null;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const t = Date.UTC(y, mo - 1, d);
  return Number.isNaN(t) ? null : t;
}

/** Render a UTC-midnight instant back as a civil date. */
function utcMidnightToDayKey(t) {
  const d = new Date(t);
  return `${String(d.getUTCFullYear()).padStart(4, '0')}-${
    String(d.getUTCMonth() + 1).padStart(2, '0')}-${
    String(d.getUTCDate()).padStart(2, '0')}`;
}

/** Widest span this will enumerate (~27 years), so a garbage range cannot hang. */
export const MAX_DAY_KEYS = 10000;

/**
 * Inclusive run of merchant-LOCAL CALENDAR DAYS, as day keys: from the local day
 * containing `fromMs` through the local day containing `toMs`.
 *
 * The two ends are resolved in `timeZone` — that is the only place the zone is
 * consulted. Everything after it is calendar arithmetic on civil dates, carried
 * out in UTC, where a day is always exactly 86,400,000 ms. Stepping in UTC across
 * *local instants* would be wrong, because a local day can be 23 or 25 hours on a
 * DST boundary; stepping across *civil dates* in UTC is exact, because a civil
 * date has no duration to shift.
 *
 * Reversed or unparseable ranges yield [] rather than a partial or wrapped run.
 */
export function dayKeysBetween(fromMs, toMs, timeZone = 'Asia/Kolkata') {
  const startKey = dayKeyInZone(fromMs, timeZone);
  const endKey = dayKeyInZone(toMs, timeZone);
  if (!startKey || !endKey) return [];

  const start = dayKeyToUtcMidnight(startKey);
  const end = dayKeyToUtcMidnight(endKey);
  if (start === null || end === null || end < start) return [];

  const DAY = 86400000;
  const span = Math.min(Math.round((end - start) / DAY), MAX_DAY_KEYS - 1);
  const keys = [];
  for (let i = 0; i <= span; i++) keys.push(utcMidnightToDayKey(start + i * DAY));
  return keys;
}

// ── the model ────────────────────────────────────────────────────────────────

const emptyMoney = () => ({ count: 0, amount: 0 });
const addTo = (bucket, amountPaise) => { bucket.count += 1; bucket.amount += amountPaise; };
const toRupees = (b) => ({ count: b.count, amount: rupees(b.amount) });

/**
 * Build every canonical commerce metric from a list of order facts.
 *
 * @param {Array<object>} orders  rows as get_store_order_facts returns them.
 *                                Never mutated; never referenced in the result.
 * @param {object}   [opts]
 *                                NOTE: there is no `now` option and no clock read
 *                                anywhere in this module. Balances do not depend on
 *                                the time, and flows are bounded by an explicit
 *                                range the caller supplies.
 * @param {string}   [opts.timeZone]   IANA zone for day boundaries
 * @param {number}   [opts.rangeFrom]  epoch ms, inclusive — flows only
 * @param {number}   [opts.rangeTo]    epoch ms, inclusive — flows only
 */
export function buildCommerceMetrics(orders = [], opts = {}) {
  const {
    timeZone = 'Asia/Kolkata',
    rangeFrom = null,
    rangeTo = null,
  } = opts;

  const rows = Array.isArray(orders) ? orders : [];
  const hasRange = rangeFrom !== null && rangeTo !== null;
  const inRange = (t) => t !== null && hasRange && t >= rangeFrom && t <= rangeTo;

  // -- populations ----------------------------------------------------------
  const kinds = { abandoned: emptyMoney(), cancelled: emptyMoney(),
                  payment_incomplete: emptyMoney(), enquiry: emptyMoney(), sale: emptyMoney() };

  const saleOrders = emptyMoney();       // sale + enquiry  -> "Sales Orders"
  const revenueOrders = emptyMoney();    // sale only       -> "Gross Sales"

  // -- money balances --------------------------------------------------------
  const collected = emptyMoney();
  const outstanding = emptyMoney();
  const writtenOff = emptyMoney();
  const collectedUnknownDate = emptyMoney();
  const cod = { outstanding: emptyMoney(), collected: emptyMoney() };
  const online = { collected: emptyMoney() };

  // -- delivery balances -----------------------------------------------------
  const deliveryOrders = emptyMoney();
  const delivered = emptyMoney();
  const returned = emptyMoney();
  const inFlight = emptyMoney();
  const codOnUndelivered = emptyMoney();

  // -- flows -----------------------------------------------------------------
  const flows = {
    sales: emptyMoney(),        // by created_at
    collected: emptyMoney(),    // by paid_at
    delivered: emptyMoney(),    // by delivered_at
    returned: emptyMoney(),     // by returned_at
    collectedUndated: emptyMoney(),
    byDay: new Map(),
  };
  if (hasRange) {
    for (const k of dayKeysBetween(rangeFrom, rangeTo, timeZone)) {
      flows.byDay.set(k, { day: k, sales: 0, collected: 0 });
    }
  }
  const bumpDay = (key, field, amountPaise) => {
    const row = flows.byDay.get(key);
    if (row) row[field] += amountPaise;
  };

  for (const o of rows) {
    const kind = classifyOrder(o);
    const amount = paise(o?.total);
    addTo(kinds[kind], amount);

    if (kind !== 'sale' && kind !== 'enquiry') continue;
    addTo(saleOrders, amount);

    // -- order flow, dated by created_at
    const createdAt = ms(o?.created_at);
    if (inRange(createdAt)) {
      addTo(flows.sales, amount);
      bumpDay(dayKeyInZone(createdAt, timeZone), 'sales', amount);
    }

    // -- delivery population: a subset of SALE_ORDERS, so a cancelled or
    //    abandoned row can never appear on the board.
    const ship = shipmentState(o);
    if (lower(o?.awb)) {
      addTo(deliveryOrders, amount);
      if (ship === 'delivered') {
        addTo(delivered, amount);
        const deliveredAt = ms(o?.delivered_at);
        if (inRange(deliveredAt)) addTo(flows.delivered, amount);
      } else if (ship === 'returned') {
        addTo(returned, amount);
        const returnedAt = ms(o?.returned_at);
        if (inRange(returnedAt)) addTo(flows.returned, amount);
      } else {
        addTo(inFlight, amount);
      }
    }

    // -- enquiries carry no money: they are counted as orders and nothing else.
    if (kind === 'enquiry') continue;
    addTo(revenueOrders, amount);

    const pay = paymentState(o);
    const method = lower(o?.payment_method);
    const via = lower(o?.paid_via);

    if (pay === 'collected') {
      addTo(collected, amount);
      if (via === 'cod_delivery' || (method === 'cod' && !via)) addTo(cod.collected, amount);
      if (via === 'razorpay' || via === 'payment_link') addTo(online.collected, amount);

      // THE FLOW RULE. paid_at only. No fallback to delivered_at or created_at.
      const paidAt = ms(o?.paid_at);
      if (paidAt === null) {
        addTo(collectedUnknownDate, amount);
        addTo(flows.collectedUndated, amount);
      } else if (inRange(paidAt)) {
        addTo(flows.collected, amount);
        bumpDay(dayKeyInZone(paidAt, timeZone), 'collected', amount);
      }
    } else if (pay === 'written_off') {
      addTo(writtenOff, amount);
    } else {
      addTo(outstanding, amount);
      if (method === 'cod') {
        addTo(cod.outstanding, amount);
        // The Delivery board's tile: COD owed on shipments not yet delivered.
        // A strict SUBSET of cod.outstanding, and labelled as such.
        if (lower(o?.awb) && ship === 'in_flight') addTo(codOnUndelivered, amount);
      }
    }
  }

  const byDay = [...flows.byDay.values()].map((d) => ({
    day: d.day, sales: rupees(d.sales), collected: rupees(d.collected),
  }));

  return {
    population: {
      saleOrders: toRupees(saleOrders),
      revenueOrders: toRupees(revenueOrders),
      deliveryOrders: toRupees(deliveryOrders),
      excluded: {
        abandoned: toRupees(kinds.abandoned),
        cancelled: toRupees(kinds.cancelled),
        paymentIncomplete: toRupees(kinds.payment_incomplete),
        enquiry: toRupees(kinds.enquiry),
      },
    },
    money: {
      grossSales: rupees(revenueOrders.amount),
      collected: toRupees(collected),
      outstanding: toRupees(outstanding),
      writtenOff: toRupees(writtenOff),
      collectedUnknownDate: toRupees(collectedUnknownDate),
      cod: { outstanding: toRupees(cod.outstanding), collected: toRupees(cod.collected) },
      online: { collected: toRupees(online.collected) },
      // Average over REVENUE orders, so zero-value leads cannot dilute it.
      averageOrderValue: revenueOrders.count
        ? rupees(Math.round(revenueOrders.amount / revenueOrders.count))
        : 0,
    },
    delivery: {
      orders: toRupees(deliveryOrders),
      delivered: toRupees(delivered),
      returned: toRupees(returned),
      inFlight: toRupees(inFlight),
      codOnUndelivered: toRupees(codOnUndelivered),
    },
    flows: {
      range: hasRange ? { from: rangeFrom, to: rangeTo, timeZone } : null,
      sales: toRupees(flows.sales),
      collected: toRupees(flows.collected),
      delivered: toRupees(flows.delivered),
      returned: toRupees(flows.returned),
      collectedUndated: toRupees(flows.collectedUndated),
      byDay,
    },
  };
}

/**
 * The invariants, checked rather than trusted. Returns a list of violations;
 * an empty list is a healthy result. Exported so the tests -- and, later, a
 * production canary -- can assert them over any dataset.
 */
export function checkInvariants(m) {
  const problems = [];
  const eq = (a, b) => Math.round(a * 100) === Math.round(b * 100);

  const { grossSales, collected, outstanding, writtenOff } = m.money;
  if (!eq(grossSales, collected.amount + outstanding.amount + writtenOff.amount)) {
    problems.push(`money: ${grossSales} != ${collected.amount} + ${outstanding.amount} + ${writtenOff.amount}`);
  }
  if (m.population.revenueOrders.count !== collected.count + outstanding.count + writtenOff.count) {
    problems.push(`revenue order count: ${m.population.revenueOrders.count} != `
      + `${collected.count} + ${outstanding.count} + ${writtenOff.count}`);
  }

  const d = m.delivery;
  if (d.orders.count !== d.delivered.count + d.returned.count + d.inFlight.count) {
    problems.push(`delivery count: ${d.orders.count} != ${d.delivered.count} + ${d.returned.count} + ${d.inFlight.count}`);
  }
  if (!eq(d.orders.amount, d.delivered.amount + d.returned.amount + d.inFlight.amount)) {
    problems.push(`delivery money: ${d.orders.amount} != ${d.delivered.amount} + ${d.returned.amount} + ${d.inFlight.amount}`);
  }

  if (m.population.saleOrders.count !== m.population.revenueOrders.count + m.population.excluded.enquiry.count) {
    problems.push('sale orders != revenue orders + enquiries');
  }
  if (m.money.collectedUnknownDate.amount > m.money.collected.amount) {
    problems.push('undated collected exceeds collected');
  }
  if (m.delivery.codOnUndelivered.amount > m.money.cod.outstanding.amount) {
    problems.push('COD on undelivered shipments exceeds COD outstanding');
  }
  return problems;
}
