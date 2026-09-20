/**
 * The Stats screen's numbers, projected from the canonical commerce model.
 *
 * This module owns NO accounting rules. Every population, classification,
 * timestamp rule and money total comes from commerceMetrics; all this file does
 * is choose which canonical figure each Stats card shows, and shape the two
 * rolling charts. If a number here disagrees with commerceMetrics, this file is
 * wrong — that is the whole point of it existing.
 *
 * It is pure and takes `now` as an argument rather than reading the clock, so a
 * test can pin a date and the same input always gives the same output.
 *
 * WHAT IT CANNOT DO: the facts feed (get_store_order_facts) is deliberately free
 * of items and PII, so top products, per-product profit, operating costs and
 * unique/returning customers cannot be built from it. Those stay on the capped
 * get_store_orders feed and are labelled as such on screen. Do not fabricate
 * them from scalars.
 */
import {
  buildCommerceMetrics, checkInvariants, classifyOrder,
  dayKeysBetween, hourInZone, weekdayInZone,
} from './commerceMetrics.js';

const DAY = 86400000;

/**
 * @param {Array<object>} facts  rows from get_store_order_facts (UNCAPPED).
 * @param {object}  opts
 * @param {string}  [opts.timeZone]   the merchant's zone — day and hour buckets
 * @param {number}   opts.now         epoch ms; the only clock reading, supplied
 * @param {number}  [opts.chartDays]  how many local days the two charts cover
 */
export function buildStatsMetrics(facts, { timeZone = 'Asia/Kolkata', now, chartDays = 14 } = {}) {
  const rows = Array.isArray(facts) ? facts : [];
  const clock = Number.isFinite(now) ? now : null;

  // ── Balances. Never range-scoped: "revenue" and "orders" on Stats mean
  //    all-time, and the screen has no date selector to say otherwise. ──
  const canonical = buildCommerceMetrics(rows, { timeZone });

  const revenue = canonical.money.grossSales;
  const orders = canonical.population.saleOrders.count;
  const aov = canonical.money.averageOrderValue;

  // ── Flows. Every one is bounded by an explicit range built from `now`. ──
  const empty = { days: [], thisWeekOrders: 0, lastWeekOrders: 0, wow: 0 };
  let flow = empty;

  if (clock !== null) {
    // Two rolling 7-day windows, dated by created_at, exactly as the screen has
    // always drawn them. The earlier window stops 1ms before the later one
    // starts, so a single order can never land in both.
    const thisWeek = buildCommerceMetrics(rows, {
      timeZone, rangeFrom: clock - 7 * DAY, rangeTo: clock,
    });
    const lastWeek = buildCommerceMetrics(rows, {
      timeZone, rangeFrom: clock - 14 * DAY, rangeTo: clock - 7 * DAY - 1,
    });
    const thisWeekOrders = thisWeek.flows.sales.count;
    const lastWeekOrders = lastWeek.flows.sales.count;

    // Charts. The range runs a day wider than the days actually shown, so every
    // displayed day is covered end to end and no bucket is a part-day.
    const wide = buildCommerceMetrics(rows, {
      timeZone, rangeFrom: clock - (chartDays + 1) * DAY, rangeTo: clock,
    });
    const byKey = new Map(wide.flows.byDay.map((d) => [d.day, d]));
    const keys = dayKeysBetween(clock - (chartDays - 1) * DAY, clock, timeZone).slice(-chartDays);
    const days = keys.map((key) => {
      const row = byKey.get(key);
      return { key, orders: row?.salesCount ?? 0, revenue: row?.sales ?? 0 };
    });

    flow = {
      days,
      thisWeekOrders,
      lastWeekOrders,
      wow: lastWeekOrders
        ? Math.round(((thisWeekOrders - lastWeekOrders) / lastWeekOrders) * 100)
        : (thisWeekOrders ? 100 : 0),
    };
  }

  // ── Behaviour: when this store is busy, in the merchant's own clock.
  //    Over the canonical sale population, so a cancelled or abandoned row can
  //    never make an hour look busy. ──
  const hours = Array(24).fill(0);
  const weekdays = Array(7).fill(0);
  for (const o of rows) {
    const kind = classifyOrder(o);
    if (kind !== 'sale' && kind !== 'enquiry') continue;
    const t = Date.parse(o?.created_at);
    if (Number.isNaN(t)) continue;
    const h = hourInZone(t, timeZone);
    const w = weekdayInZone(t, timeZone);
    if (h !== null) hours[h] += 1;
    if (w !== null) weekdays[w] += 1;
  }
  const peakHour = hours.some((n) => n > 0) ? hours.indexOf(Math.max(...hours)) : null;
  const busiestWeekday = weekdays.some((n) => n > 0) ? weekdays.indexOf(Math.max(...weekdays)) : null;

  return {
    // balances
    revenue,
    orders,
    aov,
    // flows
    days: flow.days,
    thisWeekOrders: flow.thisWeekOrders,
    lastWeekOrders: flow.lastWeekOrders,
    wow: flow.wow,
    // behaviour
    hours,
    weekdays,
    peakHour,
    busiestWeekday,
    // the model itself, so a caller can assert against it rather than trust this
    canonical,
    invariants: checkInvariants(canonical),
  };
}

/** The day number a chart key should be labelled with. Pure string work — the
 *  key is already the merchant's own calendar day, so no Date is involved. */
export function chartDayLabel(key) {
  return String(Number(String(key || '').slice(8, 10)) || '');
}
