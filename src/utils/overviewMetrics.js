/**
 * The Manage → Home dashboard's numbers, projected from the canonical model.
 *
 * Like statsMetrics, this module owns NO accounting rules. Population,
 * classification, payment state, shipment state and money totals all come from
 * commerceMetrics; this file only chooses which canonical figure each Home card
 * shows and shapes the week chart. If a number here disagrees with
 * commerceMetrics, this file is wrong.
 *
 * It is pure and takes `now` as an argument rather than reading the clock, so a
 * test can pin a date and the same input always gives the same output.
 *
 * TERMINOLOGY. Home shows no all-time aggregate: there is no Gross Sales, Sales
 * Orders or Average Order Value card here. What it shows is
 *
 *   FLOWS      today's sales, yesterday's, the seven-day chart, abandoned carts
 *              in the recent window — each dated by created_at and bounded by an
 *              explicit range.
 *   A BALANCE  "To collect", a position: money still collectible right now.
 *   A COUNT    new orders awaiting action, all-time.
 *
 * TO COLLECT IS canonical OUTSTANDING, and nothing else. The old Home figure was
 * `!paid && total > 0`, which swept in every returned/RTO parcel — on the
 * audited store that was 28 orders and ₹11,949 of money that is never arriving,
 * inflating an action card by 42%. Outstanding excludes them because
 * commerceMetrics books a returned unpaid order as written off. Home must never
 * add written-off money back in: the card exists to tell a shopkeeper what to go
 * and chase, and you cannot chase a parcel that came back.
 *
 * Payments and Delivery still compute their own "to collect" over different
 * populations. Those are separate screens with separate migrations; do not make
 * them agree by editing this file.
 */
import {
  buildCommerceMetrics, checkInvariants, classifyOrder,
  dayKeyInZone, dayKeysBetween, weekdayInZone,
} from './commerceMetrics.js';

const DAY = 86400000;

const paise = (v) => { const n = Number(v); return Number.isFinite(n) ? Math.round(n * 100) : 0; };
const status = (o) => String(o?.status ?? '').toLowerCase().trim();

/** Is this row eligible to count as one of the store's sales? Canonical only. */
const isSaleRow = (o) => {
  const kind = classifyOrder(o);
  return kind === 'sale' || kind === 'enquiry';
};

/**
 * @param {Array<object>} facts  rows from get_store_order_facts (UNCAPPED).
 * @param {object}  opts
 * @param {string}  [opts.timeZone]       the merchant's zone; all day boundaries
 * @param {number}   opts.now             epoch ms; the only clock reading, supplied
 * @param {number}  [opts.weekDays]       civil days in the chart (default 7)
 * @param {number}  [opts.abandonedDays]  civil days in the abandoned window (default 30)
 */
export function buildOverviewMetrics(facts, {
  timeZone = 'Asia/Kolkata', now, weekDays = 7, abandonedDays = 30,
} = {}) {
  const rows = Array.isArray(facts) ? facts : [];
  const clock = Number.isFinite(now) ? now : null;

  const canonical = buildCommerceMetrics(rows, { timeZone });

  // ── The position metric. All-time, never range-scoped. ──
  const toCollect = canonical.money.outstanding.amount;
  const unpaidCount = canonical.money.outstanding.count;

  // ── Orders still awaiting the merchant. All-time, over canonical sales. ──
  let newCount = 0;
  for (const o of rows) if (isSaleRow(o) && status(o) === 'new') newCount += 1;

  // ── Flows. Every one bounded by an explicit range built from `now`. ──
  let todaySales = 0;
  let todayCount = 0;
  let todayDeltaPct = null;
  let week = [];
  let weekTotal = 0;
  let abandonedCount = 0;
  let abandonedValuePaise = 0;

  if (clock !== null) {
    // The range runs wider than the days actually shown, so every displayed day
    // is covered end to end and no bucket is a part-day.
    const ranged = buildCommerceMetrics(rows, {
      timeZone, rangeFrom: clock - (weekDays + 2) * DAY, rangeTo: clock,
    });
    const byKey = new Map(ranged.flows.byDay.map((d) => [d.day, d]));

    const weekKeys = dayKeysBetween(clock - (weekDays - 1) * DAY, clock, timeZone).slice(-weekDays);
    week = weekKeys.map((key) => {
      const row = byKey.get(key);
      // The weekday of a civil date is a property of the date, not of any zone,
      // so it is read back in UTC from the key itself.
      return {
        key,
        sales: row?.sales ?? 0,
        count: row?.salesCount ?? 0,
        weekday: weekdayInZone(Date.parse(`${key}T00:00:00Z`), 'UTC'),
      };
    });
    weekTotal = week.reduce((sum, d) => sum + d.sales, 0);

    // Today is the merchant's current civil day; yesterday the previous whole one.
    const todayKey = dayKeyInZone(clock, timeZone);
    const recent = dayKeysBetween(clock - 2 * DAY, clock, timeZone);
    const yesterdayKey = recent.length >= 2 ? recent[recent.length - 2] : null;

    todaySales = byKey.get(todayKey)?.sales ?? 0;
    todayCount = byKey.get(todayKey)?.salesCount ?? 0;
    const yesterdaySales = yesterdayKey ? (byKey.get(yesterdayKey)?.sales ?? 0) : 0;
    todayDeltaPct = yesterdaySales > 0
      ? Math.round(((todaySales - yesterdaySales) / yesterdaySales) * 100)
      : null;

    // Abandoned carts: EXACTLY `abandonedDays` merchant CIVIL DAYS ending today,
    // today included — not a rolling 30 × 24 hours. Membership is tested on the
    // day key, so the boundary is the merchant's midnight, same as every other
    // day boundary on this screen.
    const windowKeys = new Set(
      dayKeysBetween(clock - (abandonedDays - 1) * DAY, clock, timeZone).slice(-abandonedDays),
    );
    for (const o of rows) {
      if (classifyOrder(o) !== 'abandoned') continue;
      const key = dayKeyInZone(Date.parse(o?.created_at), timeZone);
      if (key && windowKeys.has(key)) {
        abandonedCount += 1;
        abandonedValuePaise += paise(o?.total);
      }
    }
  }

  return {
    // flows
    todaySales,
    todayCount,
    todayDeltaPct,
    week,
    weekTotal,
    abandonedCount,
    abandonedValue: abandonedValuePaise / 100,
    // balance (a position, not an aggregate)
    toCollect,
    unpaidCount,
    // count
    newCount,
    // the model itself, so a caller can assert against it rather than trust this
    canonical,
    invariants: checkInvariants(canonical),
  };
}

/** Narrow weekday letters, indexed as weekdayInZone returns (0 = Sunday). */
export const WEEKDAY_LETTERS = Object.freeze(['S', 'M', 'T', 'W', 'T', 'F', 'S']);
