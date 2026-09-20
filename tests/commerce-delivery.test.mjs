// Commerce metrics, PR 8: the Delivery board on the canonical model.
//
// Delivery is the fulfilment authority; Payments is the financial one. What this
// PR fixes:
//
//   1. The board summed COD on anything its display bucket did not call
//      delivered or cancelled, and never checked `paid`. On the frozen fixture
//      that is 58 / ₹25,230 — of which ₹11,620 sits on parcels that came back.
//   2. Its bucket classifier reads only shipment_status, so four parcels whose
//      shipment_outcome says "returned" showed as In transit.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  buildDeliveryMetrics, isAtDetailedCap, DETAILED_ORDER_CAP,
} from '../src/utils/deliveryMetrics.js';
import {
  buildCommerceMetrics, checkInvariants, classifyOrder, shipmentState, paymentState,
} from '../src/utils/commerceMetrics.js';
import { classifyBucket } from '../src/utils/deliveryStatus.js';
import { factsFromRpc, factsFailed } from '../src/utils/orderFactsResult.js';

const FIXTURE = JSON.parse(readFileSync(
  fileURLToPath(new URL('./fixtures/commerce-royalfoods.json', import.meta.url)), 'utf8'));

const SRC = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');
const code = (p) => SRC(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const D = buildDeliveryMetrics(FIXTURE);
const M = buildCommerceMetrics(FIXTURE, { timeZone: 'Asia/Kolkata' });
const money = (rows) => rows.reduce((s, o) => s + Math.round((Number(o.total) || 0) * 100), 0) / 100;

const row = (over = {}) => ({
  id: over.id ?? `d-${Math.random().toString(36).slice(2)}`,
  created_at: '2026-09-18T10:00:00.000Z',
  status: 'new',
  payment_method: 'cod',
  total: 100,
  paid: false,
  paid_at: null,
  paid_via: null,
  payment_ref: null,
  awb: 'AWB1',
  courier: 'delhivery',
  shipment_status: null,
  shipment_outcome: null,
  delivered_at: null,
  returned_at: null,
  ...over,
});

// ── 21. the frozen fixture ──────────────────────────────────────────────────

test('GATE: canonical Delivery on the frozen fixture', () => {
  assert.equal(M.population.saleOrders.count, 182);
  assert.equal(M.money.grossSales, 86018);
  assert.equal(D.orders.count, 144);
  assert.equal(D.orders.amount, 68132);
  assert.equal(D.delivered.count, 79);
  assert.equal(D.delivered.amount, 39693);
  assert.equal(D.returned.count, 28);
  assert.equal(D.returned.amount, 11949);
  assert.equal(D.inFlight.count, 37);
  assert.equal(D.inFlight.amount, 16490);
});

test('GATE: the identity holds in count and in money', () => {
  assert.equal(D.delivered.count + D.returned.count + D.inFlight.count, D.orders.count);
  assert.equal(79 + 28 + 37, 144);
  assert.equal(D.delivered.amount + D.returned.amount + D.inFlight.amount, D.orders.amount);
  assert.equal(39693 + 11949 + 16490, 68132);
  assert.equal(D.identityHolds, true);
  assert.deepEqual(D.invariants, []);
  assert.deepEqual(checkInvariants(M), []);
});

// ── 22. the legacy COD defect ───────────────────────────────────────────────

/** The formula this PR deletes, kept so its defect can be asserted, not assumed. */
const legacyCod = (rows) => rows
  .filter((o) => o.status !== 'abandoned' && o.awb)
  .filter((o) => o.payment_method === 'cod'
    && !['delivered', 'cancelled'].includes(classifyBucket(o)));

test('the old COD tile was 58 / 25230', () => {
  const old = legacyCod(FIXTURE);
  assert.equal(old.length, 58);
  assert.equal(money(old), 25230);
});

test('and 27 / 11620 of it was money that had already come back', () => {
  const old = legacyCod(FIXTURE);
  const returned = old.filter((o) => shipmentState(o) === 'returned');
  assert.equal(returned.length, 27);
  assert.equal(money(returned), 11620);
  const cancelled = old.filter((o) => classifyOrder(o) === 'cancelled');
  assert.equal(cancelled.length, 1, 'and one cancelled order');
  assert.equal(money(cancelled), 340);
});

test('GATE: the replacement is canonical codOnUndelivered, 31 / 13610', () => {
  assert.equal(D.codOnUndelivered.count, 31);
  assert.equal(D.codOnUndelivered.amount, 13610);
  assert.equal(D.codOnUndelivered.amount, M.delivery.codOnUndelivered.amount,
    'consumed, not recomputed');
  // Explicitly not the old number, and not Payments' number either.
  assert.notEqual(D.codOnUndelivered.amount, 25230);
  assert.notEqual(D.codOnUndelivered.amount, M.money.outstanding.amount);
  assert.ok(D.codOnUndelivered.amount < M.money.outstanding.amount, 'a strict subset');
});

test('a PAID COD shipment still in flight is not owed', () => {
  // The old filter never looked at `paid`; this one cannot miss it.
  const paidInFlight = row({ id: 'p', total: 900, paid: true, paid_via: 'cod_delivery',
    shipment_status: 'In Transit' });
  const d = buildDeliveryMetrics([paidInFlight]);
  assert.equal(shipmentState(paidInFlight), 'in_flight');
  assert.equal(paymentState(paidInFlight), 'collected');
  assert.equal(d.codOnUndelivered.amount, 0);
  assert.equal(d.inFlight.count, 1, 'but it is still a shipment in flight');
});

test('a returned COD shipment is not owed', () => {
  const d = buildDeliveryMetrics([row({ id: 'r', total: 500, shipment_outcome: 'returned' })]);
  assert.equal(d.codOnUndelivered.amount, 0);
  assert.equal(d.returned.count, 1);
});

test('Delivery money is labelled by its population, never as Payments\' number', () => {
  const board = SRC('../src/components/manage/DeliveryBoard.jsx');
  assert.match(board, /COD on shipments not yet delivered/);
  assert.ok(!/COD still to collect/.test(board), 'the old label is gone');
  assert.ok(!/>Still to collect</.test(board), 'and Payments\' label is not borrowed');
  assert.ok(!/Outstanding/.test(board), 'nor the accounting word');
  // Delivery must not grow the Payments cards.
  const b = code('../src/components/manage/DeliveryBoard.jsx');
  assert.ok(!/grossSales|money\.collected|money\.writtenOff|money\.outstanding/.test(b),
    'no financial accounting card on the fulfilment screen');
});

// ── 23. the classifier ──────────────────────────────────────────────────────

test('the four outcome-vs-status rows classify as Returned, not In flight', () => {
  const odd = FIXTURE.filter((o) => o.shipment_outcome === 'returned'
    && String(o.shipment_status || '') === 'Item added to Bag');
  assert.equal(odd.length, 4, 'the fixture really has them');
  assert.equal(money(odd), 1360);
  for (const o of odd) {
    assert.equal(shipmentState(o), 'returned', 'canonical reads the outcome column');
    assert.equal(classifyBucket(o), 'transit', 'the display bucket reads only the status string');
  }
  // And they are inside the canonical Returned total.
  assert.equal(D.returned.count, 28);
});

test('shipmentState decides every canonical state, on real courier wording', () => {
  const cases = [
    ['RTO Delivered', 'returned'],
    ['Returned To Seller', 'returned'],
    ['Received at RTS DC', 'returned'],
    ['In Transit for Return', 'returned'],
    ['Lost', 'returned'],
    ['Delivered', 'delivered'],
    ['Undelivered', 'in_flight'],
    ['Not Delivered', 'in_flight'],
    ['Out For Delivery', 'in_flight'],
    ['In Transit', 'in_flight'],
  ];
  for (const [status, expected] of cases) {
    assert.equal(shipmentState(row({ shipment_status: status })), expected, status);
  }
});

test('the return outcome wins over a delivered-looking status', () => {
  assert.equal(shipmentState(row({ shipment_outcome: 'returned', shipment_status: 'Delivered' })), 'returned');
  assert.equal(shipmentState(row({ shipment_outcome: 'lost', shipment_status: 'Delivered' })), 'returned');
  assert.equal(shipmentState(row({ shipment_status: 'RTO Delivered' })), 'returned');
});

test('the projection never uses the display bucket to decide anything counted', () => {
  const src = code('../src/utils/deliveryMetrics.js');
  assert.ok(!src.includes('classifyBucket'), 'no bucket in the projection');
  assert.ok(!src.includes('deliveryStatus'), 'and it does not import the display module');
  assert.match(src, /shipmentState/, 'it uses the canonical classifier');
  // No second regex anywhere.
  assert.ok(!/rto|rts|\blost\b|Returned To Seller/i.test(src), 'no private return matching');
});

// ── 24. the population ──────────────────────────────────────────────────────

test('a cancelled order with an AWB is NOT a delivery order', () => {
  const cancelledShipped = FIXTURE.filter((o) => classifyOrder(o) === 'cancelled' && o.awb);
  assert.equal(cancelledShipped.length, 1, 'the fixture has exactly one');
  assert.equal(money(cancelledShipped), 340);
  // 145 rows carry an AWB once abandoned rows are dropped; only 144 are deliveries.
  const withAwb = FIXTURE.filter((o) => o.status !== 'abandoned' && o.awb);
  assert.equal(withAwb.length, 145);
  assert.equal(D.orders.count, 144, 'the cancelled one is excluded');
  assert.equal(money(withAwb) - D.orders.amount, 340);

  const d = buildDeliveryMetrics([row({ id: 'c', total: 340, status: 'cancelled',
    shipment_outcome: 'returned' })]);
  assert.equal(d.orders.count, 0);
  assert.equal(d.returned.count, 0);
  assert.equal(d.codOnUndelivered.amount, 0);
  assert.equal(d.notShipped.count, 0, 'nor does it become "not shipped"');
});

test('payment-incomplete and abandoned rows with an AWB are excluded', () => {
  const inc = row({ id: 'i', total: 300, payment_method: 'online', paid: false, payment_ref: null,
    awb: null });
  assert.equal(classifyOrder(inc), 'payment_incomplete');
  const ab = row({ id: 'a', total: 400, status: 'abandoned' });
  const d = buildDeliveryMetrics([inc, ab, row({ id: 'ok', total: 100 })]);
  assert.equal(d.orders.count, 1, 'only the real shipment');
  assert.equal(d.notShipped.count, 0, 'the incomplete one is not an unshipped sale either');
});

test('a zero-value enquiry with an AWB follows the canonical definition', () => {
  // classifyOrder calls total <= 0 an enquiry; enquiries carry no money, and the
  // delivery population is SALE_ORDERS (sale + enquiry) with an AWB.
  const enq = row({ id: 'e', total: 0 });
  assert.equal(classifyOrder(enq), 'enquiry');
  const d = buildDeliveryMetrics([enq]);
  assert.equal(d.orders.count, 1, 'it is a shipment');
  assert.equal(d.orders.amount, 0, 'carrying no money');
  assert.equal(d.identityHolds, true);
});

test('a sale with an AWB is included; without one it is not', () => {
  const shipped = row({ id: 's', total: 500 });
  const notShipped = row({ id: 'n', total: 700, awb: null });
  const d = buildDeliveryMetrics([shipped, notShipped]);
  assert.equal(d.orders.count, 1);
  assert.equal(d.orders.amount, 500);
  assert.equal(d.notShipped.count, 1);
  assert.equal(d.notShipped.amount, 700);
});

// ── 25. not shipped yet ─────────────────────────────────────────────────────

test('GATE: not shipped yet is 38 / 17886 and is OUTSIDE the identity', () => {
  assert.equal(D.notShipped.count, 38);
  assert.equal(D.notShipped.amount, 17886);
  // It is not added to Delivery Orders.
  assert.equal(D.orders.count, 144);
  assert.equal(D.delivered.count + D.returned.count + D.inFlight.count, 144);
  assert.notEqual(D.orders.count, 144 + 38);
  // But it does complete the sale population.
  assert.equal(D.orders.count + D.notShipped.count, M.population.saleOrders.count);
  assert.equal(D.orders.amount + D.notShipped.amount, M.population.saleOrders.amount);
});

test('26 / 12066 of the unshipped orders are payment outstanding', () => {
  assert.equal(D.notShippedOutstanding.count, 26);
  assert.equal(D.notShippedOutstanding.amount, 12066);
  // It is a subset of the unshipped queue, and not a Payments replacement.
  assert.ok(D.notShippedOutstanding.count <= D.notShipped.count);
  assert.notEqual(D.notShippedOutstanding.amount, M.money.outstanding.amount);
});

// ── 26. delivered, payment pending ──────────────────────────────────────────

test('GATE: delivered but payment outstanding is 5 / 2650', () => {
  assert.equal(D.deliveredPaymentPending.count, 5);
  assert.equal(D.deliveredPaymentPending.amount, 2650);
  const rows = FIXTURE.filter((o) => classifyOrder(o) === 'sale'
    && shipmentState(o) === 'delivered' && paymentState(o) === 'outstanding');
  assert.equal(rows.length, 5);
  assert.equal(money(rows), 2650);
  // Current composition on this fixture; the production rule hardcodes no method.
  const methods = rows.reduce((a, o) => { a[o.payment_method] = (a[o.payment_method] || 0) + 1; return a; }, {});
  assert.deepEqual(methods, { online: 1, qr: 2, upi: 2 });
  assert.equal(methods.cod ?? 0, 0, 'COD deliveries are marked paid automatically');
  // No payment method appears in the projection's logic.
  const src = code('../src/utils/deliveryMetrics.js');
  assert.ok(!/payment_method/.test(src), 'the rule is paymentState, not a method list');
});

test('delivered-payment-pending is not a second "still to collect"', () => {
  const board = SRC('../src/components/manage/DeliveryBoard.jsx');
  assert.match(board, /delivered · payment pending/i);
  assert.ok(!/still to collect/i.test(board));
});

// ── 27. returned, payment recorded ──────────────────────────────────────────

test('returned-but-paid is 0 on the fixture and detected when it happens', () => {
  assert.equal(D.returnedPaymentRecorded.count, 0);
  assert.equal(D.returnedPaymentRecorded.amount, 0);
  const paidReturn = row({ id: 'pr', total: 800, paid: true, paid_via: 'cod_delivery',
    shipment_outcome: 'returned' });
  const d = buildDeliveryMetrics([paidReturn]);
  assert.equal(d.returnedPaymentRecorded.count, 1);
  assert.equal(d.returnedPaymentRecorded.amount, 800);
  assert.equal(d.returned.count, 1, 'and it is still a return');
});

test('no refund state is invented anywhere', () => {
  const src = code('../src/utils/deliveryMetrics.js');
  const board = code('../src/components/manage/DeliveryBoard.jsx');
  for (const word of ['refund', 'refunded', 'refundDue', 'reimburse']) {
    assert.ok(!new RegExp(word, 'i').test(src), `deliveryMetrics must not mention ${word}`);
    assert.ok(!new RegExp(word, 'i').test(board), `DeliveryBoard must not mention ${word}`);
  }
  // The data has no refund column to read, which is why.
  assert.equal(Object.keys(FIXTURE[0]).filter((k) => /refund/i.test(k)).length, 0);
});

// ── 28. the cap ─────────────────────────────────────────────────────────────

test('the summary is uncapped while the list stays capped', () => {
  const rows = [];
  for (let i = 0; i < 600; i++) rows.push(row({ id: `n-${i}`, total: 100, shipment_status: 'In Transit' }));
  const d = buildDeliveryMetrics(rows);
  assert.equal(d.orders.count, 600);
  assert.equal(d.orders.amount, 60000);
  assert.equal(d.inFlight.count, 600);
  assert.equal(d.codOnUndelivered.amount, 60000);
  assert.notEqual(d.orders.count, 500);

  assert.equal(DETAILED_ORDER_CAP, 500);
  assert.equal(isAtDetailedCap(500), true);
  assert.equal(isAtDetailedCap(499), false);
  assert.equal(isAtDetailedCap(447), false, 'the audited store is not truncated');
});

test('no summary number is derived from the detailed rows', () => {
  const board = code('../src/components/manage/DeliveryBoard.jsx');
  assert.match(board, /buildDeliveryMetrics\(factsResult\?\.ok \? factsResult\.data : \[\]\)/,
    'the summary reads the facts envelope only');
  assert.ok(!/buildDeliveryMetrics\(orders/.test(board), 'never the capped rows');
  assert.ok(!/buildDeliveryMetrics\(pool/.test(board));
  assert.match(board, /isAtDetailedCap\(rawCount\)/, 'and the list says when it is truncated');
  assert.match(SRC('../src/components/manage/DeliveryBoard.jsx'),
    /newest \{DETAILED_ORDER_CAP\} orders/);
});

// ── 29. failure ─────────────────────────────────────────────────────────────

test('a failed facts read is not an empty delivery board', () => {
  assert.deepEqual(factsFromRpc({ data: null, error: { message: 'x' } }),
    { ok: false, data: [], reason: 'rpc' });
  assert.deepEqual(factsFromRpc({ data: { a: 1 }, error: null }),
    { ok: false, data: [], reason: 'malformed' });
  assert.deepEqual(factsFailed('unavailable'), { ok: false, data: [], reason: 'unavailable' });

  const board = code('../src/components/manage/DeliveryBoard.jsx');
  assert.match(board, /const summaryOk = factsResult\?\.ok === true/);
  assert.match(board, /\{!summaryOk \? \(/, 'the summary is gated');
  const guard = board.indexOf('!summaryOk');
  const firstCount = board.indexOf('summary.delivered.count');
  assert.ok(guard !== -1 && firstCount !== -1 && guard < firstCount,
    'the error state comes before any figure');
});

test('the summary failure offers a retry and shows no number', () => {
  const board = SRC('../src/components/manage/DeliveryBoard.jsx');
  const from = board.indexOf('Delivery summary unavailable');
  assert.ok(from !== -1, 'the error card exists');
  const branch = board.slice(from - 500, from + 700);
  assert.match(branch, /onClick=\{sync\}/, 'retry uses the existing loader');
  assert.ok(!/formatINR\(Math\.round\(summary\./.test(branch), 'and shows no money');
});

test('a courier sync failure is visible and does NOT erase loaded data', () => {
  const board = code('../src/components/manage/DeliveryBoard.jsx');
  // shippingConnect reports failure instead of throwing; the board used to drop it.
  assert.match(board, /const r = await syncDeliveryStatuses\(slug, pin\)/);
  assert.match(board, /setSyncStale\(Boolean\(r\?\.error\)\)/);
  const full = SRC('../src/components/manage/DeliveryBoard.jsx');
  assert.match(full, /Courier status refresh failed\. Showing the last loaded delivery data\./);
  // It is a warning beside the data, not a replacement for it.
  assert.match(board, /\{syncStale && !syncing && \(/);
  assert.ok(!/syncStale \? \([\s\S]{0,200}return null/.test(board), 'it never blanks the board');
});

test('the two failures are different states', () => {
  const board = code('../src/components/manage/DeliveryBoard.jsx');
  assert.ok(board.includes('summaryOk') && board.includes('syncStale'),
    'accounting failure and courier failure are tracked separately');
  assert.notEqual(board.indexOf('Delivery summary unavailable'),
    board.indexOf('Courier status refresh failed'));
});

test('an empty successful read is a legitimate zero', () => {
  const d = buildDeliveryMetrics([]);
  assert.equal(d.orders.count, 0);
  assert.equal(d.notShipped.count, 0);
  assert.equal(d.codOnUndelivered.amount, 0);
  assert.equal(d.identityHolds, true);
  assert.deepEqual(d.invariants, []);
});

// ── 30. scope ───────────────────────────────────────────────────────────────

test('the projection is pure and needs no PII', () => {
  const src = code('../src/utils/deliveryMetrics.js');
  for (const f of ['customer_name', 'customer_phone', 'destination', 'pincode', 'items']) {
    assert.ok(!src.includes(f), `deliveryMetrics must not reference ${f}`);
  }
  assert.ok(!/supabase|\brpc\(|await |fetch\(/.test(src), 'no network, no await');
  assert.ok(!/Date\.now|new Date\(\)/.test(src), 'no clock: this PR has no date ranges');
});

test('this PR adds no date range to Delivery', () => {
  const board = code('../src/components/manage/DeliveryBoard.jsx');
  assert.ok(!/delivered_at|returned_at/.test(code('../src/utils/deliveryMetrics.js')),
    'no event timestamp is read - 81% of deliveries have none');
  assert.ok(!/Today|7 days|30 days/.test(board), 'and no period chips were added');
});

test('canonical helpers are reused, never redefined', () => {
  const src = code('../src/utils/deliveryMetrics.js');
  assert.match(src, /from '\.\/commerceMetrics\.js'/);
  assert.ok(!/status\s*===\s*'cancelled'/.test(src), 'no private cancelled test');
  assert.ok(!/isPaymentIncomplete|payment_ref/.test(src), 'no private payment-incomplete test');
  assert.ok(!/paid\s*===\s*true/.test(src), 'payment state comes from paymentState');
});

test('Payments, Home, Stats and Orders are untouched', () => {
  assert.match(SRC('../src/components/manage/PaymentsTab.jsx'), /paymentsMetrics/);
  assert.match(SRC('../src/components/manage/OverviewTab.jsx'), /overviewMetrics/);
  assert.match(SRC('../src/components/manage/AnalyticsTab.jsx'), /statsMetrics/);
  assert.match(SRC('../src/components/manage/OrdersTab.jsx'), /ordersView/);
  for (const f of ['../src/components/manage/PaymentsTab.jsx',
                   '../src/components/manage/OverviewTab.jsx',
                   '../src/components/manage/AnalyticsTab.jsx',
                   '../src/components/manage/OrdersTab.jsx']) {
    assert.ok(!SRC(f).includes('deliveryMetrics'), `${f} does not borrow the Delivery projection`);
  }
});

test('every Delivery mutation is still wired', () => {
  const board = code('../src/components/manage/DeliveryBoard.jsx');
  for (const helper of ['syncDeliveryStatuses', 'shipmentOp', 'trackWaLink', 'buyerTrackUrl']) {
    assert.ok(board.includes(helper), `${helper} still present`);
  }
  assert.match(board, /shipmentOp\(slug, pin, o\.id, 'track'\)/, 'tracking unchanged');
  // The operational UI the board is for.
  for (const bit of ['matchesShipmentSearch', 'classifyBucket', 'courierInfo', 'prettyStatus']) {
    assert.ok(board.includes(bit), `${bit} still used for display`);
  }
});

test('the attention overlay survives as operational UI', () => {
  const board = code('../src/components/manage/DeliveryBoard.jsx');
  assert.match(board, /count\('attention'\)/, 'the NDR tile is still there');
  // ...but it decides nothing canonical.
  const src = code('../src/utils/deliveryMetrics.js');
  assert.ok(!src.includes('attention'), 'attention is not a canonical state');
});

test('the projection never mutates the rows it is given', () => {
  const before = JSON.stringify(FIXTURE);
  buildDeliveryMetrics(FIXTURE);
  assert.equal(JSON.stringify(FIXTURE), before);
});

test('unusable input yields zeroes and never throws', () => {
  for (const input of [[], null, undefined, 'nonsense']) {
    const d = buildDeliveryMetrics(input);
    assert.equal(d.orders.count, 0);
    assert.equal(d.notShipped.count, 0);
    assert.equal(d.identityHolds, true);
  }
});

// ── 28. courier cancellation ────────────────────────────────────────────────
//
// A booking the courier called off. It keeps its AWB — only cancelling through
// PocketLink clears that — so before this it sat in In Flight permanently and
// its COD read as collectible. It is not a fulfilment state, so it is not in
// the Delivered + Returned + In Flight identity; it gets its own count and its
// own place on the board.

const cancelledRow = (over = {}) => row({ awb: 'CX1', shipment_status: 'Cancelled', ...over });

test('a cancelled shipment leaves Delivery Orders entirely', () => {
  const d = buildDeliveryMetrics([cancelledRow({ id: 'c', total: 1500 })]);
  assert.equal(d.orders.count, 0, 'not a delivery order');
  assert.equal(d.inFlight.count, 0, 'and certainly not in flight');
  assert.equal(d.delivered.count, 0);
  assert.equal(d.returned.count, 0);
  assert.equal(d.cancelledShipments.count, 1);
  assert.equal(d.cancelledShipments.amount, 1500);
  assert.equal(d.notShipped.count, 0, 'it WAS shipped, so it is not unshipped either');
  assert.equal(d.identityHolds, true);
  assert.equal(d.reconciles, true);
});

test('unpaid COD on a cancelled shipment is not collectible on delivery', () => {
  const d = buildDeliveryMetrics([
    cancelledRow({ id: 'c', total: 1500, payment_method: 'cod', paid: false }),
  ]);
  assert.equal(d.codOnUndelivered.count, 0);
  assert.equal(d.codOnUndelivered.amount, 0,
    'nothing is in flight, so nothing is owed on delivery');
});

test('a cancelled shipment is not delivered-pending or returned-paid', () => {
  const d = buildDeliveryMetrics([
    cancelledRow({ id: 'a', total: 400, paid: false }),
    cancelledRow({ id: 'b', total: 500, paid: true, paid_at: '2026-09-02T10:00:00.000Z' }),
  ]);
  assert.equal(d.deliveredPaymentPending.count, 0);
  assert.equal(d.returnedPaymentRecorded.count, 0);
  assert.equal(d.cancelledShipments.count, 2);
  assert.equal(d.cancelledShipments.amount, 900);
});

test('BOTH identities hold on the fixture plus cancelled shipments', () => {
  const rows = [...FIXTURE,
    cancelledRow({ id: 'k1', total: 1500 }),
    cancelledRow({ id: 'k2', total: 900 })];
  const d = buildDeliveryMetrics(rows);
  const m = d.canonical;

  // active fulfilment
  assert.equal(d.delivered.count + d.returned.count + d.inFlight.count, d.orders.count);
  assert.equal(d.delivered.amount + d.returned.amount + d.inFlight.amount, d.orders.amount);
  assert.equal(d.identityHolds, true);

  // commerce -> fulfilment
  assert.equal(d.orders.count + d.notShipped.count + d.cancelledShipments.count,
    m.population.saleOrders.count);
  assert.equal(d.orders.amount + d.notShipped.amount + d.cancelledShipments.amount,
    m.population.saleOrders.amount);
  assert.equal(d.reconciles, true);

  // and the active numbers are exactly the frozen ones
  assert.equal(d.orders.count, 144);
  assert.equal(d.inFlight.count, 37);
  assert.equal(d.codOnUndelivered.amount, 13610);
  assert.equal(d.cancelledShipments.count, 2);
});

test('the frozen fixture has no cancelled shipment at all', () => {
  assert.equal(D.cancelledShipments.count, 0);
  assert.equal(D.cancelledShipments.amount, 0);
  assert.equal(D.reconciles, true);
  // 144 + 38 + 0 = 182, still exact.
  assert.equal(D.orders.count + D.notShipped.count + D.cancelledShipments.count,
    D.canonical.population.saleOrders.count);
});

test('the projection reads the canonical state, it does not re-derive it', () => {
  const src = code('../src/utils/deliveryMetrics.js');
  assert.equal(/cancel/i.test(src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '')
    .replace(/cancelledShipments/g, '')), false,
    'no second cancellation rule lives in the projection');
  assert.match(src, /d\.cancelledShipments/, 'it takes the count from the model');
});

// ── 29. the display mapper ──────────────────────────────────────────────────

test('a failed attempt is never shown as Delivered', () => {
  for (const s of ['Not Delivered', 'not delivered', 'NOT DELIVERED']) {
    assert.notEqual(classifyBucket({ shipment_status: s }), 'delivered', s);
    assert.equal(classifyBucket({ shipment_status: s }), 'attention', s);
    // and canonical still calls it in flight, because it has not come back
    assert.equal(shipmentState({ shipment_status: s, awb: 'A' }), 'in_flight', s);
  }
});

test('Undelivered and Delivered are unchanged', () => {
  assert.equal(classifyBucket({ shipment_status: 'Undelivered' }), 'attention');
  assert.equal(classifyBucket({ shipment_status: 'Delivered' }), 'delivered');
  assert.equal(classifyBucket({ shipment_status: 'RTO Delivered' }), 'attention');
});

test('a return that says cancelled is not displayed as a cancellation', () => {
  // The bucket mapper used to test cancellation first and would have called
  // these cancelled, contradicting the summary above them on the same screen.
  for (const s of ['RTO Cancelled', 'RTS Cancelled']) {
    assert.equal(classifyBucket({ shipment_status: s }), 'attention', s);
    assert.equal(shipmentState({ shipment_status: s, awb: 'A' }), 'returned', s);
  }
  assert.equal(classifyBucket({ shipment_status: 'Cancelled' }), 'cancelled');
  assert.equal(classifyBucket({ shipment_status: 'cancelled' }), 'cancelled');
});

test('every other status keeps the bucket it had', () => {
  const unchanged = {
    'In Transit': 'transit', 'Bag In Transit': 'transit', 'Item added to Bag': 'transit',
    'Out For Delivery': 'ofd', 'Assigned For Delivery': 'ofd', dispatched: 'ofd',
    Manifested: 'pickup', new: 'pickup', 'Not Picked': 'pickup',
    'Not Contactable': 'attention', 'On Hold': 'attention',
    'Returned To Seller': 'attention', Lost: 'attention',
    'Received at RTS DC': 'attention', 'In RTO/RTS Process': 'attention',
  };
  for (const [status, bucket] of Object.entries(unchanged)) {
    assert.equal(classifyBucket({ shipment_status: status }), bucket, status);
  }
});

test('the board gives cancelled shipments somewhere to appear', () => {
  const board = code('../src/components/manage/DeliveryBoard.jsx');
  assert.match(board, /LIST_BUCKETS/, 'the list covers more than the five live buckets');
  assert.match(board, /\.\.\.BUCKETS, 'cancelled'/, 'and the extra one is the cancellation');
  assert.equal(/[^_]BUCKETS\.(reduce|filter|forEach)/.test(board), false,
    'nothing still iterates the five alone, which is what hid these rows');
  assert.match(board, /summary\.cancelledShipments/, 'and the summary names them');
});

test('the wording says the COURIER cancelled, not the customer', () => {
  const board = code('../src/components/manage/DeliveryBoard.jsx');
  assert.match(board, /cancelled by the courier/, 'the summary line is explicit');
  assert.match(board, /order still open/, 'and says the order itself survives');
  const status = code('../src/utils/deliveryStatus.js');
  assert.match(status, /label: 'Courier cancelled'/, 'so is the bucket label');
});

test('cancelled shipments are not added to the active summary identity', () => {
  const board = code('../src/components/manage/DeliveryBoard.jsx');
  const card = board.slice(board.indexOf('Shipments'), board.indexOf('syncStale &&'));
  for (const bit of ['summary.delivered.count', 'summary.inFlight.count', 'summary.returned.count']) {
    assert.ok(card.includes(bit), `${bit} is still in the three-way card`);
  }
  assert.equal(/dl className[^>]*grid-cols-4/.test(card), false,
    'the identity stays three columns wide');
});

test('the cancelled summary comes from the uncapped facts, not the capped list', () => {
  const board = code('../src/components/manage/DeliveryBoard.jsx');
  assert.match(board, /const summary = buildDeliveryMetrics\(factsResult\?\.ok \? factsResult\.data : \[\]\)/);
  assert.equal(/buildDeliveryMetrics\(pool|buildDeliveryMetrics\(orders/.test(board), false,
    'no total, cancelled included, is computed from the capped rows');
});
