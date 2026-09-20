// Commerce metrics, PR 7: the Payments screen on the canonical model.
//
// The two things this PR fixes, and the two things these tests guard hardest:
//
//   1. "Received in period" was dated `paid_at || delivered_at || created_at`.
//      On the audited store only ₹6,410 of ₹45,443 has a real payment date, so
//      the 30-day figure was ₹27,780 of which ₹21,370 was placed by ORDER date.
//   2. "COD still to collect" was COD-only and excluded 12 real receivables.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  buildPaymentsMetrics, periodKeys, PAYMENT_RANGES, PAYMENTS_TZ,
} from '../src/utils/paymentsMetrics.js';
import { buildPaymentsLists } from '../src/utils/paymentsLedger.js';
import {
  buildCommerceMetrics, checkInvariants, classifyOrder, shipmentState, paymentState,
} from '../src/utils/commerceMetrics.js';
import { factsFromRpc, factsFailed } from '../src/utils/orderFactsResult.js';

const FIXTURE = JSON.parse(readFileSync(
  fileURLToPath(new URL('./fixtures/commerce-royalfoods.json', import.meta.url)), 'utf8'));

const SRC = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');
const code = (p) => SRC(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const TZ = 'Asia/Kolkata';
const NOW = Date.parse('2026-09-20T06:30:00Z');   // 12:00 IST on the 20th
const P = (rows, days = 30) => buildPaymentsMetrics(rows, { timeZone: TZ, now: NOW, days });
const M = buildCommerceMetrics(FIXTURE, { timeZone: TZ });

const row = (over = {}) => ({
  id: over.id ?? `p-${Math.random().toString(36).slice(2)}`,
  created_at: '2026-09-18T10:00:00.000Z',
  status: 'new',
  payment_method: 'cod',
  total: 100,
  paid: false,
  paid_at: null,
  paid_via: null,
  payment_ref: null,
  awb: null,
  shipment_status: null,
  shipment_outcome: null,
  delivered_at: null,
  returned_at: null,
  ...over,
});

// ── 1-5. Royal Foods balances and the identity ──────────────────────────────

test('GATE: gross sales, collected, outstanding and written off', () => {
  const p = P(FIXTURE);
  assert.equal(p.balances.grossSales, 86018);
  assert.equal(p.balances.collected.count, 91);
  assert.equal(p.balances.collected.amount, 45443);
  assert.equal(p.balances.outstanding.count, 63);
  assert.equal(p.balances.outstanding.amount, 28626);
  assert.equal(p.balances.writtenOff.count, 28);
  assert.equal(p.balances.writtenOff.amount, 11949);
});

test('GATE: the identity holds exactly', () => {
  const p = P(FIXTURE);
  assert.equal(
    p.balances.collected.amount + p.balances.outstanding.amount + p.balances.writtenOff.amount,
    86018, '45443 + 28626 + 11949 = 86018');
  assert.equal(p.reconciles, true);
  assert.deepEqual(p.invariants, []);
  assert.deepEqual(checkInvariants(M), []);
});

// ── 6-13. the old numbers, and exactly why they were wrong ──────────────────

const OLD_COD_DUE = (rows) => rows.filter((o) => o.status !== 'abandoned'
  && Number(o.total) > 0
  && o.status !== 'cancelled'
  && o.paid !== true
  && String(o.payment_method || '').toLowerCase() === 'cod'
  && !(o.shipment_outcome === 'returned' || o.shipment_outcome === 'lost'
       || /rto|rts|return/i.test(String(o.shipment_status || ''))
       || /\blost\b/i.test(String(o.shipment_status || '')))
  && !(String(o.payment_method || '').toLowerCase() === 'online' && !o.payment_ref));
const money = (rows) => rows.reduce((s, o) => s + Math.round((Number(o.total) || 0) * 100), 0) / 100;

test('the old COD-only balance was 51 / 22677', () => {
  const old = OLD_COD_DUE(FIXTURE).filter((o) => {
    // the one row the old ledger routed to "unconfirmed" instead
    const unconfirmed = String(o.payment_method || '').toLowerCase() === 'online'
      && !o.paid && !o.payment_ref && Boolean(o.awb);
    return !unconfirmed;
  });
  assert.equal(old.length, 51);
  assert.equal(money(old), 22677);
});

test('the 12 orders / 5949 the old balance could not see, by reason', () => {
  const p = P(FIXTURE);
  const canonical = FIXTURE.filter((o) => classifyOrder(o) === 'sale' && o.paid !== true
    && shipmentState(o) !== 'returned' && Number(o.total) > 0);
  assert.equal(canonical.length, 63);
  assert.equal(money(canonical), 28626);
  assert.equal(p.balances.outstanding.count, 63);

  const oldSet = new Set(OLD_COD_DUE(FIXTURE).map((o) => o.id));
  const missed = canonical.filter((o) => !oldSet.has(o.id));
  const byMethod = {};
  for (const o of missed) {
    const k = String(o.payment_method || '').toLowerCase() || '(blank)';
    byMethod[k] = byMethod[k] || { n: 0, amt: 0 };
    byMethod[k].n += 1; byMethod[k].amt += Math.round((Number(o.total) || 0) * 100);
  }
  // 8 UPI / 3819, 3 QR / 1230, 1 online-unconfirmed / 900
  assert.equal(byMethod.upi.n, 8);
  assert.equal(byMethod.upi.amt / 100, 3819);
  assert.equal(byMethod.qr.n, 3);
  assert.equal(byMethod.qr.amt / 100, 1230);
  assert.equal(byMethod.online.n, 1);
  assert.equal(byMethod.online.amt / 100, 900);
  assert.equal(missed.length, 12);
  assert.equal(money(missed), 5949);
  assert.equal(51 + 12, 63);
  assert.equal(22677 + 5949, 28626);
});

test('the old returned tile was 26 / 11280; canonical written off is 28 / 11949', () => {
  const oldReturned = FIXTURE.filter((o) => o.status !== 'abandoned' && o.status !== 'cancelled'
    && Number(o.total) > 0 && o.paid !== true
    && String(o.payment_method || '').toLowerCase() === 'cod'
    && (o.shipment_outcome === 'returned' || o.shipment_outcome === 'lost'
        || /rto|rts|return/i.test(String(o.shipment_status || ''))
        || /\blost\b/i.test(String(o.shipment_status || ''))));
  assert.equal(oldReturned.length, 26);
  assert.equal(money(oldReturned), 11280);

  const p = P(FIXTURE);
  assert.equal(p.balances.writtenOff.count, 28);
  assert.equal(p.balances.writtenOff.amount, 11949);

  const oldSet = new Set(oldReturned.map((o) => o.id));
  const canonWO = FIXTURE.filter((o) => classifyOrder(o) === 'sale' && o.paid !== true
    && shipmentState(o) === 'returned');
  const missed = canonWO.filter((o) => !oldSet.has(o.id));
  assert.equal(missed.length, 2, 'two returns the COD-only test could not see');
  assert.equal(money(missed), 669);
  assert.ok(missed.every((o) => String(o.payment_method).toLowerCase() === 'upi'));
  assert.equal(26 + 2, 28);
  assert.equal(11280 + 669, 11949);
});

// ── 14-21. flows ────────────────────────────────────────────────────────────

test('GATE: received is dated by paid_at only — 6410 on this store', () => {
  assert.equal(P(FIXTURE, 1).period.received.amount, 0);
  assert.equal(P(FIXTURE, 7).period.received.amount, 6410);
  assert.equal(P(FIXTURE, 30).period.received.amount, 6410);
  // The old fallback would have shown 27780 over 30 days.
  assert.notEqual(P(FIXTURE, 30).period.received.amount, 27780);
});

test('a payment with no paid_at appears in NO period, at any range', () => {
  const rows = [row({ id: 'u', total: 5000, paid: true, paid_via: 'cod_delivery',
    paid_at: null, delivered_at: '2026-09-20T05:00:00.000Z', created_at: '2026-09-20T04:00:00.000Z' })];
  for (const days of [1, 7, 30]) {
    const p = P(rows, days);
    assert.equal(p.period.received.amount, 0, `days=${days}`);
    assert.equal(p.period.received.count, 0);
  }
  // but the money is real and in the balance
  const p = P(rows);
  assert.equal(p.balances.collected.amount, 5000);
  assert.equal(p.balances.undatedCollected.amount, 5000);
  assert.equal(p.balances.undatedCollected.count, 1);
});

test('moving created_at does not move received', () => {
  const base = row({ id: 'a', total: 700, paid: true, paid_via: 'cod_delivery',
    paid_at: '2026-01-05T05:00:00.000Z' });
  const inside = { ...base, created_at: '2026-09-20T05:00:00.000Z' };
  const outside = { ...base, created_at: '2025-01-01T05:00:00.000Z' };
  assert.equal(P([inside], 30).period.received.amount, 0);
  assert.equal(P([outside], 30).period.received.amount, 0);
});

test('moving delivered_at does not move received', () => {
  const base = row({ id: 'b', total: 700, paid: true, paid_via: 'cod_delivery',
    paid_at: '2026-01-05T05:00:00.000Z', awb: 'A1', shipment_outcome: 'delivered' });
  assert.equal(P([{ ...base, delivered_at: '2026-09-20T05:00:00.000Z' }], 30).period.received.amount, 0);
  assert.equal(P([{ ...base, delivered_at: null }], 30).period.received.amount, 0);
});

test('the returned flow is dated by returned_at only', () => {
  const base = row({ id: 'r', total: 400, awb: 'A1', shipment_outcome: 'returned' });
  // returned_at inside the window
  assert.equal(P([{ ...base, returned_at: '2026-09-19T05:00:00.000Z' }], 30).period.returned.amount, 400);
  // returned_at outside, created_at inside: the old fallback would have counted it
  assert.equal(P([{ ...base, returned_at: '2026-01-01T05:00:00.000Z',
    created_at: '2026-09-20T05:00:00.000Z' }], 30).period.returned.amount, 0);
  // no returned_at at all: balance only, no period
  const p = P([{ ...base, returned_at: null, created_at: '2026-09-20T05:00:00.000Z' }], 30);
  assert.equal(p.period.returned.amount, 0);
  assert.equal(p.balances.writtenOff.amount, 400, 'still written off');
});

test('a future timestamp cannot enter the current period', () => {
  const future = new Date(NOW + 3 * 86400000).toISOString();
  const p = P([row({ id: 'f', total: 900, paid: true, paid_via: 'cod_delivery', paid_at: future })], 30);
  assert.equal(p.period.received.amount, 0, 'the old window ran to now + 1 day');
  assert.equal(p.period.to, '2026-09-20', 'the window ends today');
});

test('period windows are Asia/Kolkata civil days', () => {
  assert.equal(PAYMENTS_TZ, 'Asia/Kolkata');
  assert.deepEqual(periodKeys(NOW, 1), ['2026-09-20']);
  assert.deepEqual(periodKeys(NOW, 2), ['2026-09-19', '2026-09-20']);
  assert.equal(periodKeys(NOW, 30).length, 30);
  assert.equal(periodKeys(NOW, 30)[0], '2026-08-22');
  assert.deepEqual(periodKeys(null, 7), []);
  // 18:29:59Z is still the 19th in IST; 18:30:00Z is the 20th.
  const before = row({ id: 'x', total: 100, paid: true, paid_via: 'cod_delivery', paid_at: '2026-09-19T18:29:59.000Z' });
  const after = row({ id: 'y', total: 250, paid: true, paid_via: 'cod_delivery', paid_at: '2026-09-19T18:30:00.000Z' });
  assert.equal(P([before, after], 1).period.received.amount, 250, 'only the later one is today');
  assert.equal(P([before, after], 2).period.received.amount, 350);
});

test('the daily breakdown covers exactly the window, oldest first', () => {
  const p = P(FIXTURE, 7);
  assert.equal(p.period.daily.length, 7);
  assert.equal(p.period.daily[0].key, '2026-09-14');
  assert.equal(p.period.daily[6].key, '2026-09-20');
  assert.equal(p.period.daily.reduce((s, d) => s + d.amount, 0), p.period.received.amount,
    'the days sum to the period total');
});

// ── 22-24. undated money ────────────────────────────────────────────────────

test('GATE: undated collected is 75 / 39033 and is reported separately', () => {
  const p = P(FIXTURE);
  assert.equal(p.balances.undatedCollected.count, 75);
  assert.equal(p.balances.undatedCollected.amount, 39033);
  assert.equal(p.balances.collected.amount, 45443);
  assert.equal(p.balances.undatedCollected.amount + 6410, 45443,
    'dated + undated = collected');
});

test('undated money is never silently added to a period', () => {
  const p30 = P(FIXTURE, 30);
  assert.equal(p30.period.received.amount, 6410);
  assert.notEqual(p30.period.received.amount,
    p30.period.received.amount + p30.balances.undatedCollected.amount);
  // and the screen shows it as its own line
  const tab = SRC('../src/components/manage/PaymentsTab.jsx');
  assert.match(tab, /undatedCollected/, 'it is rendered');
  assert.match(tab, /payment date not recorded/, 'and named honestly');
  assert.ok(!/collected earlier/.test(tab), 'we do not know when it was collected');
});

// ── 25-28. balances do not move with the range ──────────────────────────────

test('GATE: every balance is identical under Today, 7 days and 30 days', () => {
  const seen = PAYMENT_RANGES.map((r) => P(FIXTURE, r.days)).map((p) => JSON.stringify({
    gross: p.balances.grossSales,
    collected: p.balances.collected,
    outstanding: p.balances.outstanding,
    writtenOff: p.balances.writtenOff,
    undated: p.balances.undatedCollected,
    channels: p.channels,
  }));
  assert.equal(new Set(seen).size, 1, 'a balance must not move with the chip');
  const p = P(FIXTURE, 1);
  assert.equal(p.balances.outstanding.amount, 28626);
  assert.equal(p.balances.writtenOff.amount, 11949);
  assert.equal(p.balances.grossSales, 86018);
});

test('the flows DO move with the range', () => {
  assert.notEqual(P(FIXTURE, 1).period.received.amount, P(FIXTURE, 7).period.received.amount);
  assert.notEqual(P(FIXTURE, 1).period.returned.amount, P(FIXTURE, 7).period.returned.amount);
});

// ── 29-33. cap and failure ──────────────────────────────────────────────────

test('accounting is uncapped: 600 synthetic orders all count', () => {
  const rows = [];
  for (let i = 0; i < 600; i++) {
    rows.push(row({ id: `n-${i}`, total: 100, paid: true, paid_via: 'cod_delivery',
      paid_at: new Date(NOW - i * 3600000).toISOString() }));
  }
  const p = P(rows, 30);
  assert.equal(p.balances.collected.count, 600);
  assert.equal(p.balances.collected.amount, 60000);
  assert.notEqual(p.balances.collected.amount, 50000);
});

test('the operational lists may cap independently of the totals', () => {
  const tab = code('../src/components/manage/PaymentsTab.jsx');
  assert.match(tab, /fetchOrderFacts/, 'accounting reads the uncapped feed');
  assert.match(tab, /buildPaymentsMetrics/, 'through the canonical projection');
  assert.match(tab, /isAtDetailedCap\(rawCount\)/, 'the lists know when they are capped');
  assert.match(tab, /listsCapped/, 'and say so');
  // Accounting must never be computed from the detailed rows.
  assert.ok(!/buildPaymentsMetrics\(orders/.test(tab), 'totals never read the capped feed');
});

test('a failed read does not render accounting zeroes', () => {
  assert.deepEqual(factsFromRpc({ data: null, error: { message: 'x' } }),
    { ok: false, data: [], reason: 'rpc' });
  assert.deepEqual(factsFromRpc({ data: { a: 1 }, error: null }),
    { ok: false, data: [], reason: 'malformed' });
  assert.deepEqual(factsFailed('unavailable'), { ok: false, data: [], reason: 'unavailable' });

  const tab = code('../src/components/manage/PaymentsTab.jsx');
  assert.match(tab, /const accountingOk = factsResult\?\.ok === true/);
  assert.match(tab, /\{!accountingOk \? \(/, 'the money block is gated');
  const guard = tab.indexOf('!accountingOk');
  const firstTile = tab.indexOf('label={`Received');
  assert.ok(guard !== -1 && firstTile !== -1 && guard < firstTile,
    'the error state comes before any figure');
});

test('the failure state offers a retry and shows no figure', () => {
  const tab = SRC('../src/components/manage/PaymentsTab.jsx');
  const from = tab.indexOf('Money figures unavailable');
  assert.ok(from !== -1, 'the error card exists');
  const branch = tab.slice(from - 400, from + 700);
  assert.match(branch, /onClick=\{\(\) => refresh\(\)\}/, 'retry uses the existing loader');
  assert.ok(!/formatINR\(Math\.round\(acc\./.test(branch), 'and shows no money');
});

test('an empty successful read is a legitimate zero', () => {
  const p = P([], 30);
  assert.equal(p.balances.grossSales, 0);
  assert.equal(p.balances.outstanding.amount, 0);
  assert.equal(p.period.received.amount, 0);
  assert.deepEqual(p.invariants, [], 'zero is coherent');
  assert.equal(p.reconciles, true);
});

// ── 34-36. how money arrived ────────────────────────────────────────────────

test('GATE: the channel split uses paid_via, not payment_method', () => {
  const p = P(FIXTURE);
  assert.equal(p.channels.cod.count, 72);
  assert.equal(p.channels.cod.amount, 36333);
  assert.equal(p.channels.online.count, 3);
  assert.equal(p.channels.online.amount, 1050);
  assert.equal(p.channels.other.count, 16);
  assert.equal(p.channels.other.amount, 8060);
  assert.equal(p.channels.cod.amount + p.channels.online.amount + p.channels.other.amount,
    p.balances.collected.amount, 'the channels sum to collected');
});

test('the 11 "online" rows with no paid_via are NOT claimed as Razorpay', () => {
  const looksOnline = FIXTURE.filter((o) => classifyOrder(o) === 'sale' && o.paid === true
    && String(o.payment_method).toLowerCase() === 'online' && !o.paid_via);
  assert.equal(looksOnline.length, 11, 'the fixture really has them');
  const p = P(FIXTURE);
  assert.equal(p.channels.online.count, 3, 'only the three with paid_via = razorpay');
  // the old screen booked all 14 as online
  assert.notEqual(p.channels.online.count, 14);
});

test('unknown paid_via stays unknown', () => {
  const p = P([
    row({ id: 'k', total: 100, paid: true, paid_via: 'razorpay' }),
    row({ id: 'u', total: 200, paid: true, paid_via: null, payment_method: 'upi' }),
  ], 30);
  assert.equal(p.channels.online.amount, 100);
  assert.equal(p.channels.other.amount, 200, 'not guessed into a channel');
});

// ── 37-40. population ───────────────────────────────────────────────────────

test('cancelled and payment-incomplete never become money', () => {
  const p = P([
    row({ id: 'ok', total: 500, paid: true, paid_via: 'cod_delivery', paid_at: '2026-09-20T05:00:00.000Z' }),
    row({ id: 'c', total: 900, status: 'cancelled' }),
    row({ id: 'i', total: 300, payment_method: 'online', paid: false }),
  ], 30);
  assert.equal(p.balances.grossSales, 500);
  assert.equal(p.balances.collected.amount, 500);
  assert.equal(p.balances.outstanding.amount, 0);
  assert.equal(p.period.received.amount, 500);
});

test('a zero-value enquiry adds no money and breaks no identity', () => {
  const p = P([
    row({ id: 'e', total: 0 }),
    row({ id: 's', total: 400 }),
  ], 30);
  assert.equal(p.balances.grossSales, 400);
  assert.equal(p.balances.outstanding.amount, 400);
  assert.deepEqual(p.invariants, []);
  assert.equal(p.reconciles, true);
});

test('returns are canonical shipmentState, including UPI and bare status strings', () => {
  for (const over of [{ shipment_outcome: 'returned' }, { shipment_outcome: 'lost' },
                      { shipment_status: 'RTO Delivered' }, { shipment_status: 'Received at RTS DC' }]) {
    const r = row({ id: 'r', total: 500, payment_method: 'upi', awb: 'A1', ...over });
    assert.equal(shipmentState(r), 'returned', JSON.stringify(over));
    assert.equal(paymentState(r), 'written_off');
    const p = P([r], 30);
    assert.equal(p.balances.writtenOff.amount, 500, JSON.stringify(over));
    assert.equal(p.balances.outstanding.amount, 0);
  }
});

test('paymentsMetrics defines no rule of its own', () => {
  const src = code('../src/utils/paymentsMetrics.js');
  assert.match(src, /from '\.\/commerceMetrics\.js'/);
  assert.ok(!/rto|rts|Returned To Seller/i.test(src), 'no private return matching');
  assert.ok(!/status\s*===\s*'cancelled'/.test(src), 'no private cancelled test');
  assert.ok(!/isPaymentIncomplete/.test(src), 'no second payment-incomplete test');
  assert.ok(!/Date\.now/.test(src), 'no clock of its own');
  assert.ok(!/delivered_at\s*\|\||created_at\s*\|\|/.test(src), 'no timestamp fallback');
});

// ── 41-46. scope ────────────────────────────────────────────────────────────

test('accounting needs no PII', () => {
  const src = code('../src/utils/paymentsMetrics.js');
  for (const f of ['customer_name', 'customer_phone', 'destination', 'pincode', 'items']) {
    assert.ok(!src.includes(f), `paymentsMetrics must not reference ${f}`);
  }
});

test('Home, Stats, Orders and Delivery are untouched', () => {
  assert.match(SRC('../src/components/manage/OverviewTab.jsx'), /overviewMetrics/);
  assert.match(SRC('../src/components/manage/AnalyticsTab.jsx'), /statsMetrics/);
  assert.match(SRC('../src/components/manage/OrdersTab.jsx'), /ordersView/);
  for (const f of ['../src/components/manage/OverviewTab.jsx',
                   '../src/components/manage/AnalyticsTab.jsx',
                   '../src/components/manage/OrdersTab.jsx']) {
    assert.ok(!SRC(f).includes('paymentsMetrics'), `${f} does not borrow the Payments projection`);
  }
  const delivery = SRC('../src/components/manage/DeliveryBoard.jsx');
  assert.equal(/commerceMetrics|statsMetrics|overviewMetrics|ordersView|paymentsMetrics/.test(delivery),
    false, 'Delivery is PR 8, not this one');
});

test('no mutation helper changed', () => {
  const tab = code('../src/components/manage/PaymentsTab.jsx');
  for (const helper of ['createPaymentLink', 'checkPaymentLinks', 'reconcileOnlinePayments',
                        'findPaymentOrphans', 'syncDeliveryStatuses', 'paymentLinkMessage']) {
    assert.ok(tab.includes(helper), `${helper} still wired`);
  }
  // Both projections are pure.
  for (const f of ['../src/utils/paymentsMetrics.js', '../src/utils/paymentsLedger.js']) {
    const src = code(f);
    assert.ok(!/supabase|\brpc\(|await /.test(src), `${f} must be pure`);
  }
});

test('the projections never mutate the rows they are given', () => {
  const before = JSON.stringify(FIXTURE);
  P(FIXTURE, 30);
  buildPaymentsLists(FIXTURE, { periodKeys: periodKeys(NOW, 30) });
  assert.equal(JSON.stringify(FIXTURE), before);
});

test('unusable input yields zeroes and never throws', () => {
  for (const input of [[], null, undefined, 'nonsense']) {
    const p = buildPaymentsMetrics(input, { timeZone: TZ, now: NOW, days: 7 });
    assert.equal(p.balances.grossSales, 0);
    assert.equal(p.period.received.amount, 0);
    assert.equal(p.period.daily.length, 7);
  }
  const noClock = buildPaymentsMetrics(FIXTURE, { timeZone: TZ, now: null, days: 7 });
  assert.equal(noClock.balances.outstanding.amount, 28626, 'a balance needs no clock');
  assert.deepEqual(noClock.period.keys, []);
  assert.equal(noClock.period.received.amount, 0);
});
