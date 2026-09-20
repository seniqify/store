// Commerce metrics, PR 5: the Home / Overview screen on the canonical model.
//
// Home's numbers are projected by src/utils/overviewMetrics.js, which is pure
// and takes `now` as an argument, so everything the screen shows is tested here
// directly without rendering React.
//
// The headline of this PR is a deliberate merchant-visible correction: Home's
// "To collect" was `!paid && total > 0`, which counted every returned parcel as
// money still owed. It is now canonical Outstanding.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildOverviewMetrics, WEEKDAY_LETTERS } from '../src/utils/overviewMetrics.js';
import { buildOverviewExtras } from '../src/utils/overviewStats.js';
import {
  buildCommerceMetrics, checkInvariants, classifyOrder, shipmentState,
} from '../src/utils/commerceMetrics.js';
import { factsFromRpc, factsFailed } from '../src/utils/orderFactsResult.js';

const FIXTURE = JSON.parse(readFileSync(
  fileURLToPath(new URL('./fixtures/commerce-royalfoods.json', import.meta.url)), 'utf8'));

const SRC = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');
/** Source with comments stripped — so a test never matches its own prose. */
const code = (p) => SRC(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const TZ = 'Asia/Kolkata';
const DAY = 86400000;
const NOW = Date.parse('2026-09-20T06:30:00Z');   // pinned; 12:00 IST on the 20th

const order = (over = {}) => ({
  id: over.id ?? `h-${Math.random().toString(36).slice(2)}`,
  created_at: '2026-09-18T10:00:00.000Z',
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

const H = (rows, opts = {}) => buildOverviewMetrics(rows, { timeZone: TZ, now: NOW, ...opts });

// ── 1. canonical regression ─────────────────────────────────────────────────

test('GATE: the canonical model behind Home still reads 182 / 86018 / 472.63', () => {
  const h = H(FIXTURE);
  assert.equal(h.canonical.population.saleOrders.count, 182, 'Sales Orders');
  assert.equal(h.canonical.money.grossSales, 86018, 'Gross Sales');
  assert.equal(h.canonical.money.averageOrderValue, 472.63, 'AOV');
  assert.deepEqual(h.invariants, [], 'invariants');
  assert.deepEqual(checkInvariants(h.canonical), []);
});

test('Gross Sales is Collected plus Outstanding plus Written Off', () => {
  const m = buildCommerceMetrics(FIXTURE, { timeZone: TZ });
  assert.equal(m.money.collected.amount, 45443);
  assert.equal(m.money.outstanding.amount, 28626);
  assert.equal(m.money.writtenOff.amount, 11949);
  assert.equal(
    m.money.collected.amount + m.money.outstanding.amount + m.money.writtenOff.amount,
    86018, '45443 + 28626 + 11949 = 86018');
  assert.equal(m.money.grossSales, 86018);
});

// ── 2-4. To collect ─────────────────────────────────────────────────────────

test('GATE: Home To collect is 63 orders / 28626 on the audited data', () => {
  const h = H(FIXTURE);
  assert.equal(h.unpaidCount, 63);
  assert.equal(h.toCollect, 28626);
});

test('To collect IS canonical Outstanding, and nothing else', () => {
  const h = H(FIXTURE);
  const m = buildCommerceMetrics(FIXTURE, { timeZone: TZ });
  assert.equal(h.toCollect, m.money.outstanding.amount);
  assert.equal(h.unpaidCount, m.money.outstanding.count);
  // Explicitly NOT the old formula, and not the sum with written off.
  assert.notEqual(h.toCollect, m.money.outstanding.amount + m.money.writtenOff.amount);
  assert.notEqual(h.toCollect, 40575, 'the pre-migration Home figure');
});

test('returned / RTO money is excluded — 28 orders, 11949, gone from To collect', () => {
  const m = buildCommerceMetrics(FIXTURE, { timeZone: TZ });
  assert.equal(m.money.writtenOff.count, 28);
  assert.equal(m.money.writtenOff.amount, 11949);
  const h = H(FIXTURE);
  assert.equal(h.toCollect + m.money.writtenOff.amount, 40575,
    'the excluded money is exactly the old overstatement');
  // And no individual returned row can be inside the outstanding population.
  // Restricted to the revenue population, exactly as the model is: a returned
  // parcel on a cancelled order was never revenue, so it is neither collectible
  // nor written off.
  const isSale = (o) => ['sale', 'enquiry'].includes(classifyOrder(o));
  const returned = FIXTURE.filter((o) => isSale(o) && shipmentState(o) === 'returned' && o.paid !== true);
  assert.ok(returned.length > 0, 'the fixture really has returned unpaid parcels');
  assert.equal(returned.length, 28);
  const returnedValue = returned.reduce((s, o) => s + (Number(o.total) || 0), 0);
  assert.equal(returnedValue, 11949);
  // The looser set is bigger, which is why the population restriction matters.
  const looser = FIXTURE.filter((o) => shipmentState(o) === 'returned' && o.paid !== true);
  assert.equal(looser.length, 29, 'one returned unpaid row is not a sale at all');
});

test('a returned parcel never appears in To collect, however it was marked', () => {
  for (const over of [
    { shipment_outcome: 'returned' },
    { shipment_outcome: 'lost' },
    { shipment_status: 'RTO Delivered' },
    { shipment_status: 'Received at RTS DC' },
  ]) {
    const h = H([order({ id: 'r', total: 500, awb: 'AWB1', ...over })]);
    assert.equal(h.toCollect, 0, `${JSON.stringify(over)} must not be collectible`);
    assert.equal(h.unpaidCount, 0);
  }
});

test('a genuinely outstanding order with NO AWB stays in To collect', () => {
  // The common case: a COD order the shopkeeper has not dispatched yet.
  const h = H([
    order({ id: 'a', total: 300, payment_method: 'cod', awb: null }),
    order({ id: 'b', total: 200, payment_method: 'cod', awb: null, status: 'accepted' }),
  ]);
  assert.equal(h.unpaidCount, 2);
  assert.equal(h.toCollect, 500);
  // On the real fixture too: no-AWB unpaid rows are a large part of the total.
  const real = H(FIXTURE);
  const noAwb = FIXTURE.filter((o) => !o.awb && o.paid !== true && classifyOrder(o) === 'sale'
    && Number(o.total) > 0);
  assert.ok(noAwb.length >= 20, `expected the fixture to carry no-AWB unpaid rows, got ${noAwb.length}`);
  assert.ok(real.toCollect > 0);
});

test('a delivered but unpaid COD order is still collectible', () => {
  const h = H([order({ id: 'd', total: 700, awb: 'A1', shipment_outcome: 'delivered' })]);
  assert.equal(h.toCollect, 700, 'the courier delivered it; the money is still owed');
  assert.equal(h.unpaidCount, 1);
});

test('paid orders are not collectible', () => {
  const h = H([
    order({ id: 'p', total: 400, paid: true, paid_at: '2026-09-18T11:00:00.000Z' }),
    order({ id: 'u', total: 600 }),
  ]);
  assert.equal(h.toCollect, 600);
  assert.equal(h.unpaidCount, 1);
});

// ── 5. the cap ──────────────────────────────────────────────────────────────

test('Home totals are NOT capped at 500 orders', () => {
  const rows = [];
  for (let i = 0; i < 600; i++) {
    rows.push(order({ id: `n-${i}`, total: 100, created_at: new Date(NOW - i * 3600000).toISOString() }));
  }
  const h = H(rows);
  assert.equal(h.unpaidCount, 600, 'every unpaid order counted');
  assert.equal(h.toCollect, 60000, 'every rupee counted');
  assert.equal(h.newCount, 600);
  assert.notEqual(h.toCollect, 50000, 'what the capped feed would have shown');
});

// ── 6-8. time boundaries ────────────────────────────────────────────────────

test('today and yesterday split on the Asia/Kolkata midnight', () => {
  // 18:29:59Z on the 19th is still the 19th in IST; 18:30:00Z is the 20th.
  const rows = [
    order({ id: 'yest', total: 100, created_at: '2026-09-19T18:29:59.000Z' }),
    order({ id: 'today', total: 250, created_at: '2026-09-19T18:30:00.000Z' }),
  ];
  const h = H(rows);
  assert.equal(h.todaySales, 250, 'the later order is today in IST');
  assert.equal(h.todayCount, 1);
  assert.equal(h.todayDeltaPct, 150, '250 vs 100');
  const days = Object.fromEntries(h.week.map((d) => [d.key, d.sales]));
  assert.equal(days['2026-09-20'], 250);
  assert.equal(days['2026-09-19'], 100);
});

test('the same instants would land on one day in UTC — the zone is doing work', () => {
  const rows = [
    order({ id: 'a', total: 100, created_at: '2026-09-19T18:29:59.000Z' }),
    order({ id: 'b', total: 250, created_at: '2026-09-19T18:30:00.000Z' }),
  ];
  const utc = buildOverviewMetrics(rows, { timeZone: 'UTC', now: NOW });
  const days = Object.fromEntries(utc.week.map((d) => [d.key, d.sales]));
  assert.equal(days['2026-09-19'], 350, 'UTC puts both on the 19th');
});

test('the week chart is exactly seven merchant civil days, oldest to today', () => {
  const h = H(FIXTURE);
  assert.equal(h.week.length, 7);
  assert.equal(new Set(h.week.map((d) => d.key)).size, 7, 'no repeats');
  for (let i = 1; i < h.week.length; i++) {
    assert.equal(
      Date.parse(`${h.week[i].key}T00:00:00Z`) - Date.parse(`${h.week[i - 1].key}T00:00:00Z`),
      DAY, `gap before ${h.week[i].key}`);
  }
  assert.equal(h.week[6].key, '2026-09-20', 'today, in IST');
  assert.equal(h.week[0].key, '2026-09-14', 'six days earlier');
  assert.equal(h.weekTotal, h.week.reduce((s, d) => s + d.sales, 0));
});

test('a sale in the small hours of the oldest shown day is counted whole', () => {
  // 00:05 IST on 2026-09-14 = 18:35Z on the 13th.
  const h = H([order({ id: 'edge', total: 999, created_at: '2026-09-13T18:35:00.000Z' })]);
  const first = h.week[0];
  assert.equal(first.key, '2026-09-14');
  assert.equal(first.sales, 999, 'a part-day window would have missed it');
});

test('week day letters come from the key, with no Date in the component', () => {
  const h = H(FIXTURE);
  // 2026-09-20 is a Sunday.
  assert.equal(h.week[6].weekday, 0);
  assert.equal(WEEKDAY_LETTERS[h.week[6].weekday], 'S');
  assert.equal(WEEKDAY_LETTERS.length, 7);
  const src = code('../src/components/manage/OverviewTab.jsx');
  const chart = src.slice(src.indexOf('acc.week.map'), src.indexOf('end attention + week grid'));
  assert.ok(chart.length > 0, 'the chart block was found');
  assert.ok(!/new Date\(/.test(chart), 'the chart builds no Date; the weekday comes from the model');
  assert.ok(!/toLocaleDateString/.test(chart), 'and no browser-local day name');
});

test('the abandoned window is 30 merchant CIVIL DAYS ending today, inclusive', () => {
  // Day 1 of the window is 2026-08-22 (today minus 29 days). 2026-08-21 is out.
  const inFirst = order({ id: 'in', status: 'abandoned', total: 100,
    created_at: '2026-08-21T18:30:00.000Z' });   // 2026-08-22 00:00 IST
  const justOut = order({ id: 'out', status: 'abandoned', total: 500,
    created_at: '2026-08-21T18:29:59.000Z' });   // 2026-08-21 23:59:59 IST
  const today = order({ id: 'now', status: 'abandoned', total: 70,
    created_at: '2026-09-20T05:00:00.000Z' });

  const h = H([inFirst, justOut, today]);
  assert.equal(h.abandonedCount, 2, 'the first day of the window is in, the day before is out');
  assert.equal(h.abandonedValue, 170);
});

test('the abandoned window length is a parameter, and it is honoured', () => {
  const rows = [];
  for (let i = 0; i < 40; i++) {
    rows.push(order({ id: `ab-${i}`, status: 'abandoned', total: 10,
      created_at: new Date(NOW - i * DAY).toISOString() }));
  }
  assert.equal(H(rows, { abandonedDays: 30 }).abandonedCount, 30);
  assert.equal(H(rows, { abandonedDays: 7 }).abandonedCount, 7);
  assert.equal(H(rows, { abandonedDays: 1 }).abandonedCount, 1, 'today only');
});

// ── 9. the population cannot drift ──────────────────────────────────────────

test('cancelled, abandoned and payment-incomplete never leak into Home sales', () => {
  const rows = [
    order({ id: 'ok', total: 500, created_at: '2026-09-20T05:00:00.000Z' }),
    order({ id: 'cancelled', total: 900, status: 'cancelled', created_at: '2026-09-20T05:00:00.000Z' }),
    order({ id: 'abandoned', total: 700, status: 'abandoned', created_at: '2026-09-20T05:00:00.000Z' }),
    order({ id: 'incomplete', total: 300, payment_method: 'online', paid: false,
            payment_ref: null, created_at: '2026-09-20T05:00:00.000Z' }),
  ];
  const h = H(rows);
  assert.equal(h.todaySales, 500, 'only the real sale');
  assert.equal(h.todayCount, 1);
  assert.equal(h.toCollect, 500, 'and only it is collectible');
  assert.equal(h.unpaidCount, 1);
  assert.equal(h.newCount, 1, 'the cancelled row is not awaiting action');
  assert.equal(h.abandonedCount, 1, 'the abandoned row is counted as abandoned, not as a sale');
});

test('the new-order count uses canonical eligibility, not a fresh sale rule', () => {
  const rows = [
    order({ id: 'new', status: 'new' }),
    order({ id: 'accepted', status: 'accepted' }),
    order({ id: 'newbutcancelled', status: 'cancelled' }),
    order({ id: 'newbutabandoned', status: 'abandoned' }),
  ];
  assert.equal(H(rows).newCount, 1);
  const src = code('../src/utils/overviewMetrics.js');
  assert.ok(src.includes('classifyOrder'), 'eligibility comes from the canonical classifier');
  assert.ok(!/status\s*!==\s*['"]cancelled['"]/.test(src), 'no hand-rolled cancelled filter');
  assert.ok(!/countsAsSale/.test(src), 'and no second sale rule');
});

// ── 10-11. failure is not zero ──────────────────────────────────────────────

test('a successful read of an empty store is a real, usable zero', () => {
  const r = factsFromRpc({ data: [], error: null });
  assert.equal(r.ok, true);
  const h = H(r.data);
  assert.equal(h.toCollect, 0);
  assert.equal(h.todaySales, 0);
  assert.equal(h.newCount, 0);
  assert.deepEqual(h.invariants, [], 'zero is a coherent set of books');
});

test('RPC, malformed and network failures are failures, not empty stores', () => {
  assert.deepEqual(factsFromRpc({ data: null, error: { message: 'denied' } }),
    { ok: false, data: [], reason: 'rpc' });
  assert.deepEqual(factsFromRpc({ data: { nope: 1 }, error: null }),
    { ok: false, data: [], reason: 'malformed' });
  assert.deepEqual(factsFailed('unavailable'),
    { ok: false, data: [], reason: 'unavailable' });
});

test('a failed read and an empty store compute the same numbers — only ok separates them', () => {
  const failed = factsFailed('rpc');
  const empty = factsFromRpc({ data: [], error: null });
  assert.equal(H(failed.data).toCollect, H(empty.data).toCollect);
  assert.notEqual(failed.ok, empty.ok, 'which is why the screen must branch on the flag');
});

test('Home renders no accounting figure from a failed read', () => {
  const src = code('../src/components/manage/OverviewTab.jsx');
  assert.match(src, /const accountingOk = factsResult\?\.ok === true/, 'the flag exists');
  // Every accounting surface is gated on it.
  assert.match(src, /\{accountingOk \? \(/, 'the three tiles are gated');
  assert.match(src, /\{accountingOk && \(/, 'the week chart is gated');
  for (const row of ['newCount', 'toCollect', 'abandonedCount']) {
    const line = src.split('\n').find((l) => l.includes(`acc.${row} > 0`));
    assert.ok(line && line.includes('accountingOk'), `the ${row} attention row is gated`);
  }
});

test('the failure state offers a retry through the existing load path', () => {
  const src = SRC('../src/components/manage/OverviewTab.jsx');
  const from = src.indexOf('Sales figures unavailable');
  assert.ok(from !== -1, 'the compact error card exists');
  const branch = src.slice(from - 400, from + 600);
  assert.match(branch, /onClick=\{load\}/, 'retry calls the same loader');
  assert.ok(!/formatINR\(acc\./.test(branch), 'and shows no figure');
});

// ── 12. independent UI survives ─────────────────────────────────────────────

test('stock and reviews do not depend on the order feed at all', () => {
  const extras = buildOverviewExtras(
    { products: [{ name: 'Bhujia', stock: 0 }, { name: 'Chivda', inStock: false }, { name: 'Ladoo', stock: 5 }] },
    [{ created_at: new Date(NOW - DAY).toISOString(), customer_name: 'Asha', rating: 5 }],
    NOW,
  );
  assert.equal(extras.outOfStockCount, 2);
  assert.deepEqual(extras.outOfStockNames, ['Bhujia', 'Chivda']);
  assert.equal(extras.newReviewCount, 1);
  assert.equal(extras.latestReview.customer_name, 'Asha');
});

test('the stock and review rows are NOT gated on the order feed', () => {
  const src = code('../src/components/manage/OverviewTab.jsx');
  const stock = src.split('\n').find((l) => l.includes('extras.outOfStockCount > 0'));
  const revs = src.split('\n').find((l) => l.includes('extras.newReviewCount > 0'));
  assert.ok(stock && !stock.includes('accountingOk'), 'stock still shows when orders fail');
  assert.ok(revs && !revs.includes('accountingOk'), 'reviews still show when orders fail');
  // Greeting and quick actions are outside the gate too.
  assert.match(src, /QuickAction/, 'quick actions remain');
  assert.ok(src.indexOf('greeting') < src.indexOf('accountingOk ? ('), 'greeting renders regardless');
});

// ── 13-14. no fallback, no second implementation ────────────────────────────

test('Home never falls back to the capped detailed feed', () => {
  const src = code('../src/components/manage/OverviewTab.jsx');
  assert.ok(!/fetchOrders\b/.test(src), 'OverviewTab no longer imports or calls fetchOrders');
  assert.match(src, /fetchOrderFacts/, 'it reads the uncapped facts feed');
  assert.match(src, /factsResult\?\.ok \? factsResult\.data : \[\]/,
    'and feeds the model only a successful read');
});

test('overviewStats holds no order accounting or classification any more', () => {
  const src = code('../src/utils/overviewStats.js');
  for (const gone of ['countsAsSale', 'orderState', 'toCollect', 'todaySales', 'weekTotal',
                      'abandoned', 'o.paid', 'o.total', 'o.status', 'classifyOrder']) {
    assert.ok(!src.includes(gone), `overviewStats must not still contain ${gone}`);
  }
  assert.match(src, /buildOverviewExtras/, 'it is now the stock + reviews helper');
  assert.ok(!src.includes('commerceMetrics'), 'and it does not reimplement the model either');
});

test('overviewMetrics shapes canonical output but defines no rule', () => {
  const src = code('../src/utils/overviewMetrics.js');
  assert.match(src, /from '\.\/commerceMetrics\.js'/, 'it consumes the model');
  assert.ok(!/isPaymentIncomplete/.test(src), 'no second payment-incomplete test');
  assert.ok(!/paid\s*===\s*true/.test(src), 'no hand-rolled payment classification');
  assert.ok(!/shipment_outcome|shipment_status|awb/.test(src), 'no hand-rolled shipment rules');
  assert.ok(!/Date\.now/.test(src), 'and it reads no clock of its own');
});

// ── 15-17. scope ────────────────────────────────────────────────────────────

test('Orders, Payments and Delivery are untouched by this PR', () => {
  for (const f of ['../src/components/manage/OrdersTab.jsx',
                   '../src/components/manage/PaymentsTab.jsx',
                   '../src/components/manage/DeliveryBoard.jsx',
                   '../src/utils/paymentsLedger.js']) {
    const src = SRC(f);
    assert.equal(/commerceMetrics|statsMetrics|overviewMetrics/.test(src), false,
      `${f} is migrated by a later PR, not this one`);
  }
});

test('Stats is unchanged and still goes through its own projection', () => {
  const src = SRC('../src/components/manage/AnalyticsTab.jsx');
  assert.match(src, /statsMetrics/);
  assert.ok(!src.includes('overviewMetrics'), 'Stats does not borrow the Home projection');
});

test('Home and Stats share one authority, with no third definition between them', () => {
  const home = code('../src/utils/overviewMetrics.js');
  const stats = code('../src/utils/statsMetrics.js');
  for (const src of [home, stats]) {
    assert.match(src, /buildCommerceMetrics/, 'both build on the same model');
  }
  // Both take the population from the same classifier, not from each other.
  assert.ok(!home.includes('statsMetrics'), 'Home does not depend on the Stats projection');
  assert.ok(!stats.includes('overviewMetrics'), 'nor the other way round');
});

test('the model is never mutated by building the Home view of it', () => {
  const before = JSON.stringify(FIXTURE);
  H(FIXTURE);
  assert.equal(JSON.stringify(FIXTURE), before);
});

test('an empty or unusable feed yields zeroes and never throws', () => {
  for (const input of [[], null, undefined, 'nonsense']) {
    const h = buildOverviewMetrics(input, { timeZone: TZ, now: NOW });
    assert.equal(h.toCollect, 0);
    assert.equal(h.todaySales, 0);
    assert.equal(h.week.length, 7, 'the chart still has its seven days');
  }
});

test('without a clock the balance still holds and the flows are simply empty', () => {
  const h = buildOverviewMetrics(FIXTURE, { timeZone: TZ, now: null });
  assert.equal(h.toCollect, 28626, 'a position does not need a clock');
  assert.equal(h.unpaidCount, 63);
  assert.deepEqual(h.week, []);
  assert.equal(h.abandonedCount, 0);
});
