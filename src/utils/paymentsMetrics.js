/**
 * Manage → Payments: the store's money, projected from the canonical model.
 *
 * Like statsMetrics, overviewMetrics and ordersView, this file owns NO
 * accounting rules. Eligibility, payment state, shipment state and every total
 * come from commerceMetrics. What it owns is which canonical figure each card
 * shows, and the civil-day windows the period chips mean.
 *
 * Pure, and takes `now` as an argument rather than reading the clock.
 *
 * ── BALANCE vs FLOW, the distinction this screen used to blur ───────────────
 *
 *   BALANCES are positions. Still to collect, Written off, Collected and Gross
 *   Sales are true right now, all-time, and DO NOT MOVE when the merchant picks
 *   Today or 30 days. The old screen got this right for its COD figure and this
 *   one keeps it right for all of them.
 *
 *   FLOWS are events in a window. Received and Returned are dated by the event
 *   that happened — paid_at and returned_at — and by NOTHING ELSE. The old
 *   ledger read `paid_at || delivered_at || created_at`, which placed money in
 *   periods by order date: on the audited store only ₹6,410 of ₹45,443 has a
 *   real payment date, so its "received in 30 days" was 77% invented.
 *
 * ── MONEY WITH NO PAYMENT DATE ──────────────────────────────────────────────
 *
 * 75 of that store's orders are paid = true with paid_at = null: real money,
 * genuinely collected, date never recorded. They are in the Collected BALANCE,
 * reported separately as `undatedCollected`, and they enter NO period. Giving
 * them a date would be inventing one, and the merchant would never know.
 *
 * ── HOW MONEY ARRIVED ───────────────────────────────────────────────────────
 *
 * The channel split uses paid_via, which records how payment was actually taken.
 * payment_method is what the customer CHOSE at checkout and is not proof of
 * anything: on the audited store 11 rows say payment_method "online" with no
 * paid_via at all, and the old screen booked every one of them as a Razorpay
 * payment. Those now sit in `other`, where "we do not know" belongs.
 */
import {
  buildCommerceMetrics, checkInvariants, classifyOrder, paymentState, shipmentState,
  dayKeyInZone, dayKeysBetween,
} from './commerceMetrics.js';
// The shared operational helpers, reused rather than re-derived: an online order
// already shipped whose payment Razorpay has not confirmed, and the courier
// status families the Delivery board shows.
import { isPaymentUnconfirmed } from './orderState.js';
import { classifyBucket } from './deliveryStatus.js';

/** The merchant's clock. Every period boundary on this screen is a civil day. */
export const PAYMENTS_TZ = 'Asia/Kolkata';

/** The period chips, in days ending today (today included). */
export const PAYMENT_RANGES = Object.freeze([
  { days: 1, label: 'Today' },
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
]);

const DAY = 86400000;
const paise = (v) => { const n = Number(v); return Number.isFinite(n) ? Math.round(n * 100) : 0; };
const rupees = (p) => p / 100;
const emptyBucket = () => ({ count: 0, amount: 0 });
const add = (b, p) => { b.count += 1; b.amount += p; };
const done = (b) => ({ count: b.count, amount: rupees(b.amount) });

/**
 * The merchant civil days a period chip covers: `days` days ending today,
 * today included. Nothing after today is ever in the window, so a row stamped
 * in the future cannot land in the current period — the old range ran to
 * `now + 1 day` and quietly admitted tomorrow.
 */
export function periodKeys(now, days, timeZone = PAYMENTS_TZ) {
  if (typeof now !== 'number' || !Number.isFinite(now)) return [];
  const n = Math.max(1, Math.floor(Number(days) || 1));
  return dayKeysBetween(now - (n - 1) * DAY, now, timeZone).slice(-n);
}

/**
 * @param {Array<object>} facts  rows from get_store_order_facts (UNCAPPED)
 * @param {object}  opts
 * @param {string}  [opts.timeZone]
 * @param {number}   opts.now      epoch ms; the only clock reading, supplied
 * @param {number}  [opts.days]    the selected period chip
 */
export function buildPaymentsMetrics(facts, {
  timeZone = PAYMENTS_TZ, now, days = 1,
} = {}) {
  const rows = Array.isArray(facts) ? facts : [];
  const canonical = buildCommerceMetrics(rows, { timeZone });
  const m = canonical.money;

  // ── Balances. Never range-scoped. ────────────────────────────────────────
  const balances = {
    grossSales: m.grossSales,
    collected: m.collected,
    outstanding: m.outstanding,
    writtenOff: m.writtenOff,
    undatedCollected: m.collectedUnknownDate,
  };

  // Gross Sales = Collected + Still to collect + Written off, to the paise.
  const reconciles = paise(m.collected.amount) + paise(m.outstanding.amount)
    + paise(m.writtenOff.amount) === paise(m.grossSales);

  // ── How collected money actually arrived. paid_via, not payment_method. ──
  const otherCollected = {
    count: m.collected.count - m.cod.collected.count - m.online.collected.count,
    amount: rupees(paise(m.collected.amount) - paise(m.cod.collected.amount)
      - paise(m.online.collected.amount)),
  };
  const channels = { cod: m.cod.collected, online: m.online.collected, other: otherCollected };

  // ── Flows. Civil-day windows, each dated by its own event and nothing else.
  //    The model's own range flows take epoch bounds; these chips are calendar
  //    windows, so membership is tested on the day key instead. The eligibility
  //    behind each row is still entirely canonical.
  const keys = periodKeys(now, days, timeZone);
  const window = new Set(keys);
  const received = emptyBucket();
  const returnedFlow = emptyBucket();
  const perDay = new Map(keys.map((k) => [k, { key: k, amount: 0, count: 0 }]));

  for (const o of rows) {
    if (classifyOrder(o) !== 'sale') continue;      // enquiries carry no money
    const amount = paise(o?.total);
    const state = paymentState(o);

    if (state === 'collected') {
      // THE FLOW RULE. paid_at only. A row without one is in the balance and in
      // no period — see undatedCollected.
      const key = o?.paid_at ? dayKeyInZone(Date.parse(o.paid_at), timeZone) : null;
      if (key && window.has(key)) {
        add(received, amount);
        const row = perDay.get(key);
        if (row) { row.amount += amount; row.count += 1; }
      }
    } else if (state === 'written_off') {
      // Same rule for returns: returned_at only. Without one the money is in the
      // Written off balance but belongs to no dated period.
      const key = o?.returned_at ? dayKeyInZone(Date.parse(o.returned_at), timeZone) : null;
      if (key && window.has(key)) add(returnedFlow, amount);
    }
  }

  return {
    balances,
    channels,
    reconciles,
    period: {
      days: Math.max(1, Math.floor(Number(days) || 1)),
      keys,
      from: keys[0] ?? null,
      to: keys[keys.length - 1] ?? null,
      received: done(received),
      returned: done(returnedFlow),
      daily: [...perDay.values()].map((d) => ({ key: d.key, amount: rupees(d.amount), count: d.count })),
    },
    canonical,
    invariants: checkInvariants(canonical),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  The Money tab (Payments redesign, 2026-10-23)
// ═══════════════════════════════════════════════════════════════════════════

const lower = (v) => String(v ?? '').toLowerCase().trim();

/**
 * "Coming in": where an unpaid sale's money is right now. Every sale whose
 * paymentState is 'outstanding' lands in exactly one place, so the places add
 * up to Still to collect to the paise. Tested in this order:
 *
 *   to_check      the money may already be on its way or in: a payment link
 *                 is out, Razorpay has not confirmed an online order that
 *                 shipped, or the order is delivered and no payment is recorded
 *   stuck         with a courier who reports a problem (not contactable, ...)
 *   with_courier  with a courier, moving
 *   with_rider    the shop's own delivery person has it (status dispatched)
 *   not_shipped   not sent yet, including a courier booking that was cancelled
 */
export const COMING_IN_KEYS = Object.freeze(['with_rider', 'not_shipped', 'stuck', 'to_check', 'with_courier']);

export function comingInBucket(o) {
  if (isPaymentUnconfirmed(o) || lower(o?.payment_link_id)) return 'to_check';
  const ship = shipmentState(o);
  if (ship === 'delivered') return 'to_check';
  if (ship === 'in_flight') return classifyBucket(o) === 'attention' ? 'stuck' : 'with_courier';
  if (lower(o?.status) === 'dispatched') return 'with_rider';
  return 'not_shipped';
}

/** An online order the buyer never paid for is "recent" for this many days. */
export const NOT_PAID_RECENT_DAYS = 3;

/** Months the returns chart shows, ending with the current one. */
export const RETURN_MONTHS = 4;

function monthKeysEnding(now, n, timeZone) {
  const today = dayKeyInZone(now, timeZone);
  if (!today) return [];
  let y = Number(today.slice(0, 4));
  let m = Number(today.slice(5, 7));
  const keys = [];
  for (let i = 0; i < n; i++) {
    keys.unshift(`${y}-${String(m).padStart(2, '0')}`);
    m -= 1;
    if (m === 0) { m = 12; y -= 1; }
  }
  return keys;
}

/**
 * Everything the Money tab's home screen shows, from the uncapped facts feed.
 *
 * @param {Array<object>} facts  rows from get_store_order_facts (UNCAPPED)
 * @param {object}  opts
 * @param {number}   opts.now   epoch ms; the only clock reading, supplied
 * @param {number}  [opts.days] the period chip (1, 7, 30)
 * @returns the balances and channels of buildPaymentsMetrics, plus
 *   comingIn     { [key]: { count, amount } } over COMING_IN_KEYS
 *   period       received (paid_at flow, as before) AND `orders`: the sales
 *                PLACED in the window, split by where their money is now -
 *                dated by order time, so no payment needs a recorded date
 *   notPaid      online orders whose payment never went through: all, recent,
 *                older (not sales; kept out of every total above)
 *   returns      { months: [{ key, count, amount }], shipped, rate }
 */
export function buildMoneyHome(facts, { timeZone = PAYMENTS_TZ, now, days = 7 } = {}) {
  const rows = Array.isArray(facts) ? facts : [];
  const base = buildPaymentsMetrics(rows, { timeZone, now, days });

  const coming = Object.fromEntries(COMING_IN_KEYS.map((k) => [k, emptyBucket()]));
  const notPaid = { all: emptyBucket(), recent: emptyBucket(), older: emptyBucket() };
  const placed = { sold: emptyBucket(), collected: emptyBucket(), outstanding: emptyBucket(), writtenOff: emptyBucket() };
  const window = new Set(base.period.keys);
  const months = new Map(monthKeysEnding(now, RETURN_MONTHS, timeZone).map((k) => [k, emptyBucket()]));
  let shipped = 0;
  let returned = 0;

  for (const o of rows) {
    const kind = classifyOrder(o);
    const amount = paise(o?.total);
    if (kind === 'payment_incomplete') {
      add(notPaid.all, amount);
      const t = Date.parse(o?.created_at);
      const older = typeof now === 'number' && Number.isFinite(t) && now - t > NOT_PAID_RECENT_DAYS * DAY;
      add(older ? notPaid.older : notPaid.recent, amount);
      continue;
    }
    if (kind !== 'sale') continue;
    const state = paymentState(o);
    if (shipmentState(o) !== null) shipped += 1;
    if (state === 'outstanding') add(coming[comingInBucket(o)], amount);

    // Dated by when the order was placed - the one timestamp every row has.
    const placedOn = dayKeyInZone(Date.parse(o?.created_at), timeZone);
    if (placedOn && window.has(placedOn)) {
      add(placed.sold, amount);
      add(state === 'collected' ? placed.collected : state === 'written_off' ? placed.writtenOff : placed.outstanding, amount);
    }
    if (state === 'written_off') {
      returned += 1;
      const month = placedOn ? months.get(placedOn.slice(0, 7)) : null;
      if (month) add(month, amount);
    }
  }

  return {
    ...base,
    comingIn: Object.fromEntries(COMING_IN_KEYS.map((k) => [k, done(coming[k])])),
    period: {
      ...base.period,
      orders: {
        sold: done(placed.sold),
        collected: done(placed.collected),
        outstanding: done(placed.outstanding),
        writtenOff: done(placed.writtenOff),
      },
    },
    notPaid: { all: done(notPaid.all), recent: done(notPaid.recent), older: done(notPaid.older) },
    returns: {
      months: [...months.entries()].map(([key, b]) => ({ key, ...done(b) })),
      shipped,
      rate: shipped ? returned / shipped : 0,
    },
  };
}

