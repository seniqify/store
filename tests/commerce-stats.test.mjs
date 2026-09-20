// Commerce metrics, PR 4: the Stats screen on the canonical model.
//
// The Stats numbers are projected by src/utils/statsMetrics.js, which is pure
// and takes `now` as an argument — so everything the screen shows can be tested
// here directly, without rendering React.
//
// The hard gate: Royal Foods must still read 182 sale orders and ₹86,018.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildStatsMetrics, chartDayLabel } from '../src/utils/statsMetrics.js';
import {
  buildCommerceMetrics, checkInvariants, classifyOrder,
  hourInZone, weekdayInZone,
} from '../src/utils/commerceMetrics.js';
import { isPaymentIncomplete as legacyIncomplete } from '../src/utils/orderState.js';

const FIXTURE = JSON.parse(readFileSync(
  fileURLToPath(new URL('./fixtures/commerce-royalfoods.json', import.meta.url)), 'utf8'));

const SRC = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');
/** Source with comments stripped — so a test never matches its own prose. */
const code = (p) => SRC(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const TZ = 'Asia/Kolkata';
const DAY = 86400000;
const NOW = Date.parse('2026-09-20T06:30:00Z');   // pinned; 12:00 IST

const order = (over = {}) => ({
  id: over.id ?? `s-${Math.random().toString(36).slice(2)}`,
  created_at: '2026-09-01T10:00:00.000Z',
  status: 'new',
  payment_method: 'cod',
  total: 100,
  paid: false,
  paid_at: null,
  paid_via: null,
  payment_ref: null,
  payment_link_id: null,
  awb: null,
  courier: null,
  shipment_status: null,
  shipment_outcome: null,
  delivered_at: null,
  returned_at: null,
  ...over,
});

// ── THE HARD GATE ───────────────────────────────────────────────────────────

test('GATE: Royal Foods still reads 182 sale orders on the Stats screen', () => {
  const s = buildStatsMetrics(FIXTURE, { timeZone: TZ, now: NOW });
  assert.equal(s.orders, 182);
});

test('GATE: Royal Foods still reads gross sales of 86018 on the Stats screen', () => {
  const s = buildStatsMetrics(FIXTURE, { timeZone: TZ, now: NOW });
  assert.equal(s.revenue, 86018);
});

test('GATE: the fixture still satisfies every canonical invariant', () => {
  const s = buildStatsMetrics(FIXTURE, { timeZone: TZ, now: NOW });
  assert.deepEqual(s.invariants, []);
  assert.deepEqual(checkInvariants(buildCommerceMetrics(FIXTURE, { timeZone: TZ })), []);
});

test('the Stats numbers ARE the canonical numbers, not a parallel calculation', () => {
  const s = buildStatsMetrics(FIXTURE, { timeZone: TZ, now: NOW });
  const m = buildCommerceMetrics(FIXTURE, { timeZone: TZ });
  assert.equal(s.orders, m.population.saleOrders.count, 'orders');
  assert.equal(s.revenue, m.money.grossSales, 'revenue');
  assert.equal(s.aov, m.money.averageOrderValue, 'AOV');
});

test('Stats reproduces what the screen showed before the migration', () => {
  // The pre-PR-4 path, verbatim: fetchOrders dropped abandoned, then
  // AnalyticsTab dropped cancelled and payment-incomplete.
  const legacy = FIXTURE
    .filter((o) => o.status !== 'abandoned')
    .filter((o) => o.status !== 'cancelled' && !legacyIncomplete(o));
  const legacyRevenue = legacy.reduce((sum, o) => sum + (Number(o.total) || 0), 0);

  const s = buildStatsMetrics(FIXTURE, { timeZone: TZ, now: NOW });
  assert.equal(s.orders, legacy.length, 'order count unchanged');
  assert.equal(s.revenue, legacyRevenue, 'revenue unchanged');
  assert.equal(Math.round(s.aov), Math.round(legacyRevenue / legacy.length), 'AOV unchanged');
});

// ── THE CAP ─────────────────────────────────────────────────────────────────

test('scalar Stats are NOT capped at 500 orders', () => {
  const rows = [];
  for (let i = 0; i < 600; i++) {
    rows.push(order({ id: `n-${i}`, total: 100, created_at: new Date(NOW - i * 3600000).toISOString() }));
  }
  const s = buildStatsMetrics(rows, { timeZone: TZ, now: NOW });
  assert.equal(s.orders, 600, 'every order counted');
  assert.equal(s.revenue, 60000, 'every rupee counted');
  // What the capped feed would have shown, kept here so a regression is obvious.
  assert.notEqual(s.orders, 500);
  assert.notEqual(s.revenue, 50000);
});

test('the cap is not reintroduced by the classification step either', () => {
  // 900 rows of mixed kinds: only the sales must count, and all of them.
  const rows = [];
  for (let i = 0; i < 900; i++) {
    const kind = i % 3;
    rows.push(order({
      id: `m-${i}`,
      total: 50,
      status: kind === 1 ? 'abandoned' : kind === 2 ? 'cancelled' : 'new',
      created_at: new Date(NOW - i * 600000).toISOString(),
    }));
  }
  const s = buildStatsMetrics(rows, { timeZone: TZ, now: NOW });
  assert.equal(s.orders, 300, 'the 300 sales, none of the 600 excluded rows');
  assert.equal(s.revenue, 15000);
});

// ── THE SEPARATION ──────────────────────────────────────────────────────────

test('statsMetrics cannot touch items or PII — it has neither available', () => {
  const src = code('../src/utils/statsMetrics.js');
  for (const forbidden of ['items', 'customer_phone', 'customer_name', 'destination', 'pincode']) {
    assert.ok(!src.includes(forbidden),
      `statsMetrics references ${forbidden}, which the facts feed does not carry`);
  }
});

test('statsMetrics defines no accounting rule of its own', () => {
  const src = code('../src/utils/statsMetrics.js');
  // No second opinion on what counts: the only population test is the canonical
  // classifier, and nothing re-implements the payment/shipment predicates.
  assert.ok(src.includes('classifyOrder'), 'uses the canonical classifier');
  assert.ok(!/status\s*!==\s*['"]cancelled['"]/.test(src), 'no hand-rolled cancelled filter');
  assert.ok(!/status\s*!==\s*['"]abandoned['"]/.test(src), 'no hand-rolled abandoned filter');
  assert.ok(!src.includes('isPaymentIncomplete'), 'no second payment-incomplete test');
  assert.ok(!/paid\s*===\s*true/.test(src), 'no hand-rolled payment classification');
});

test('AnalyticsTab computes no accounting scalar of its own', () => {
  const src = code('../src/components/manage/AnalyticsTab.jsx');
  assert.ok(src.includes('buildStatsMetrics'), 'consumes the canonical projection');
  // The old parallel calculation must be gone, not merely unused.
  assert.ok(!/const\s+revenue\s*=\s*valid\.reduce/.test(src), 'revenue no longer summed locally');
  assert.ok(!/const\s+count\s*=\s*valid\.length/.test(src), 'count no longer taken locally');
  assert.ok(!/const\s+aov\s*=\s*count\s*\?/.test(src), 'AOV no longer divided locally');
  assert.ok(!/toDateString\(\)/.test(src), 'day buckets no longer browser-local');
  assert.ok(!/getHours\(\)/.test(src), 'hour buckets no longer browser-local');
});

test('the detailed, capped analytics are still fed by the detailed feed', () => {
  const src = code('../src/components/manage/AnalyticsTab.jsx');
  assert.ok(src.includes('fetchOrders'), 'still loads the detailed feed');
  assert.ok(src.includes('fetchOrderFacts'), 'and the uncapped facts feed');
  // Top products and profit must keep reading real items, never scalars.
  assert.ok(/o\.items/.test(src), 'item-level analytics still read items');
  assert.ok(src.includes('customer_phone'), 'customer counts still read phones');
});

test('a capped section says so on screen', () => {
  const src = SRC('../src/components/manage/AnalyticsTab.jsx');
  assert.ok(src.includes('DETAILED_CAP'), 'the cap is named');
  assert.ok(/last \{DETAILED_CAP\} orders/.test(src), 'and shown to the merchant');
  assert.ok(/capped\s*=\s*orders\.length\s*>=\s*DETAILED_CAP/.test(src),
    'and only claimed when the feed is actually at the cap');
});

// ── SEMANTICS THAT MUST NOT DRIFT ───────────────────────────────────────────

test('cancelled, abandoned and payment-incomplete are excluded, exactly as before', () => {
  const rows = [
    order({ id: 'ok', total: 500 }),
    order({ id: 'cancelled', total: 900, status: 'cancelled' }),
    order({ id: 'abandoned', total: 700, status: 'abandoned' }),
    order({ id: 'incomplete', total: 300, payment_method: 'online', paid: false, payment_ref: null }),
  ];
  const s = buildStatsMetrics(rows, { timeZone: TZ, now: NOW });
  assert.equal(s.orders, 1);
  assert.equal(s.revenue, 500);
});

test('an online order that shipped is NOT payment-incomplete, on both definitions', () => {
  const shipped = order({ id: 'ship', total: 400, payment_method: 'online', paid: false, awb: 'AWB1' });
  assert.equal(legacyIncomplete(shipped), false, 'legacy agrees');
  assert.equal(classifyOrder(shipped), 'sale', 'canonical agrees');
  const s = buildStatsMetrics([shipped], { timeZone: TZ, now: NOW });
  assert.equal(s.orders, 1);
  assert.equal(s.revenue, 400);
});

test('the canonical population matches the legacy one row for row on real data', () => {
  const legacy = new Set(FIXTURE
    .filter((o) => o.status !== 'abandoned')
    .filter((o) => o.status !== 'cancelled' && !legacyIncomplete(o))
    .map((o) => o.id));
  let onlyLegacy = 0; let onlyCanonical = 0;
  for (const o of FIXTURE) {
    const kind = classifyOrder(o);
    const canonical = kind === 'sale' || kind === 'enquiry';
    if (legacy.has(o.id) && !canonical) onlyLegacy += 1;
    if (canonical && !legacy.has(o.id)) onlyCanonical += 1;
  }
  assert.equal(onlyLegacy, 0, 'no row the old screen counted is now dropped');
  assert.equal(onlyCanonical, 0, 'no row the old screen dropped is now counted');
});

// ── TIME ────────────────────────────────────────────────────────────────────

test('day buckets fall on the merchant Asia/Kolkata boundary, not UTC', () => {
  // 18:29:59Z is still the 10th in IST; 18:30:00Z is the 11th.
  const rows = [
    order({ id: 'before', total: 100, created_at: '2026-09-17T18:29:59.000Z' }),
    order({ id: 'after', total: 200, created_at: '2026-09-17T18:30:00.000Z' }),
  ];
  const s = buildStatsMetrics(rows, { timeZone: TZ, now: NOW });
  const d17 = s.days.find((d) => d.key === '2026-09-17');
  const d18 = s.days.find((d) => d.key === '2026-09-18');
  assert.ok(d17 && d18, 'both days are in the 14-day window');
  assert.equal(d17.orders, 1); assert.equal(d17.revenue, 100);
  assert.equal(d18.orders, 1); assert.equal(d18.revenue, 200);
});

test('the same instants would fall on ONE day in UTC — the zone is doing work', () => {
  const rows = [
    order({ id: 'before', total: 100, created_at: '2026-09-17T18:29:59.000Z' }),
    order({ id: 'after', total: 200, created_at: '2026-09-17T18:30:00.000Z' }),
  ];
  const utc = buildStatsMetrics(rows, { timeZone: 'UTC', now: NOW });
  const d17 = utc.days.find((d) => d.key === '2026-09-17');
  assert.equal(d17.orders, 2, 'UTC puts both on the 17th');
  assert.equal(d17.revenue, 300);
});

test('the charts cover exactly 14 whole merchant days, newest last', () => {
  const s = buildStatsMetrics(FIXTURE, { timeZone: TZ, now: NOW });
  assert.equal(s.days.length, 14);
  assert.equal(new Set(s.days.map((d) => d.key)).size, 14, 'no repeats');
  for (let i = 1; i < s.days.length; i++) {
    assert.equal(
      Date.parse(s.days[i].key + 'T00:00:00Z') - Date.parse(s.days[i - 1].key + 'T00:00:00Z'),
      DAY, `gap before ${s.days[i].key}`);
  }
  assert.equal(s.days[13].key, '2026-09-20', 'today, in IST');
});

test('a day at the far edge of the window is counted whole, not part', () => {
  // 00:05 IST on the oldest day shown = 18:35Z the day before. A window that
  // started at "now minus 13 days" to the minute would miss it.
  const oldest = Date.parse('2026-09-06T18:35:00Z');   // 2026-09-07 00:05 IST
  const rows = [order({ id: 'edge', total: 777, created_at: new Date(oldest).toISOString() })];
  const s = buildStatsMetrics(rows, { timeZone: TZ, now: NOW });
  const d = s.days.find((x) => x.key === '2026-09-07');
  assert.ok(d, 'the oldest shown day exists');
  assert.equal(d.orders, 1, 'and the order in its small hours is in it');
  assert.equal(d.revenue, 777);
});

test('week-on-week compares two windows that cannot share an order', () => {
  const rows = [
    order({ id: 'this-1', total: 10, created_at: new Date(NOW - 1 * DAY).toISOString() }),
    order({ id: 'this-2', total: 10, created_at: new Date(NOW - 6 * DAY).toISOString() }),
    order({ id: 'prev-1', total: 10, created_at: new Date(NOW - 8 * DAY).toISOString() }),
    order({ id: 'boundary', total: 10, created_at: new Date(NOW - 7 * DAY).toISOString() }),
  ];
  const s = buildStatsMetrics(rows, { timeZone: TZ, now: NOW });
  assert.equal(s.thisWeekOrders + s.lastWeekOrders, 4, 'every order in exactly one window');
  assert.equal(s.thisWeekOrders, 3);
  assert.equal(s.lastWeekOrders, 1);
  assert.equal(s.wow, 200, '3 vs 1');
});

test('peak hour is the store clock, not the machine clock', () => {
  // 03:30Z = 09:00 IST.
  const rows = [
    order({ id: 'a', created_at: '2026-09-15T03:30:00.000Z' }),
    order({ id: 'b', created_at: '2026-09-16T03:40:00.000Z' }),
    order({ id: 'c', created_at: '2026-09-17T03:50:00.000Z' }),
    order({ id: 'd', created_at: '2026-09-18T20:00:00.000Z' }),
  ];
  const s = buildStatsMetrics(rows, { timeZone: TZ, now: NOW });
  assert.equal(s.peakHour, 9, '09:00 IST');
  assert.equal(hourInZone(Date.parse('2026-09-15T03:30:00.000Z'), TZ), 9);
  assert.equal(hourInZone(Date.parse('2026-09-15T03:30:00.000Z'), 'UTC'), 3);
});

test('busiest weekday is the store clock too', () => {
  // 2026-09-17 is a Thursday; 18:45Z on Wednesday the 16th is already Thursday IST.
  const rows = [
    order({ id: 'a', created_at: '2026-09-16T18:45:00.000Z' }),
    order({ id: 'b', created_at: '2026-09-17T06:00:00.000Z' }),
    order({ id: 'c', created_at: '2026-09-14T06:00:00.000Z' }),
  ];
  const s = buildStatsMetrics(rows, { timeZone: TZ, now: NOW });
  assert.equal(s.busiestWeekday, 4, 'Thursday');
  assert.equal(weekdayInZone(Date.parse('2026-09-16T18:45:00.000Z'), TZ), 4, 'Thu in IST');
  assert.equal(weekdayInZone(Date.parse('2026-09-16T18:45:00.000Z'), 'UTC'), 3, 'still Wed in UTC');
});

test('behaviour histograms ignore cancelled and abandoned rows', () => {
  const rows = [
    order({ id: 'sale', created_at: '2026-09-15T03:30:00.000Z' }),
    order({ id: 'x1', status: 'abandoned', created_at: '2026-09-15T20:00:00.000Z' }),
    order({ id: 'x2', status: 'abandoned', created_at: '2026-09-16T20:00:00.000Z' }),
    order({ id: 'x3', status: 'cancelled', created_at: '2026-09-17T20:00:00.000Z' }),
  ];
  const s = buildStatsMetrics(rows, { timeZone: TZ, now: NOW });
  assert.equal(s.peakHour, 9, 'the one real sale, not the three excluded rows at 01:30 IST');
  assert.equal(s.hours.reduce((a, b) => a + b, 0), 1);
});

// ── BALANCES vs FLOWS ───────────────────────────────────────────────────────

test('balances are all-time and ignore the chart window entirely', () => {
  // Every order is far older than the 14-day chart window.
  const rows = [
    order({ id: 'old-1', total: 1000, created_at: '2026-01-05T06:00:00.000Z' }),
    order({ id: 'old-2', total: 2000, created_at: '2026-02-05T06:00:00.000Z' }),
  ];
  const s = buildStatsMetrics(rows, { timeZone: TZ, now: NOW });
  assert.equal(s.orders, 2, 'counted although outside every window');
  assert.equal(s.revenue, 3000);
  assert.equal(s.days.reduce((a, d) => a + d.orders, 0), 0, 'and absent from the flows');
  assert.equal(s.thisWeekOrders, 0);
});

test('without a clock the balances still hold and the flows are simply empty', () => {
  const s = buildStatsMetrics(FIXTURE, { timeZone: TZ, now: null });
  assert.equal(s.orders, 182, 'the gate does not depend on the clock');
  assert.equal(s.revenue, 86018);
  assert.deepEqual(s.days, []);
  assert.equal(s.wow, 0);
});

test('an empty or unusable feed yields zeroes and never throws', () => {
  for (const input of [[], null, undefined, 'nonsense']) {
    const s = buildStatsMetrics(input, { timeZone: TZ, now: NOW });
    assert.equal(s.orders, 0);
    assert.equal(s.revenue, 0);
    assert.equal(s.peakHour, null);
    assert.equal(s.busiestWeekday, null);
  }
});

test('the model is never mutated by building the Stats view of it', () => {
  const before = JSON.stringify(FIXTURE);
  buildStatsMetrics(FIXTURE, { timeZone: TZ, now: NOW });
  assert.equal(JSON.stringify(FIXTURE), before);
});

test('chart labels are read from the day key, with no Date involved', () => {
  assert.equal(chartDayLabel('2026-09-07'), '7');
  assert.equal(chartDayLabel('2026-09-20'), '20');
  assert.equal(chartDayLabel(''), '');
  assert.equal(chartDayLabel(null), '');
  assert.ok(!code('../src/utils/statsMetrics.js').includes('Date.now'),
    'statsMetrics reads no clock of its own');
});
