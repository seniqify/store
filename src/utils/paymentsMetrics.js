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
  buildCommerceMetrics, checkInvariants, classifyOrder, paymentState,
  dayKeyInZone, dayKeysBetween,
} from './commerceMetrics.js';

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
