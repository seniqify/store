// Commerce metrics, PR 6: the Orders screen.
//
// Orders stays an OPERATIONAL LIST on the capped detailed feed. What changes is
// that its Unpaid chip and its payment labels stop being hand-rolled and start
// coming from the canonical model — and, critically, that the chip's number and
// the rows the chip opens are computed by one predicate.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  listableRows, isAtDetailedCap, isOrdersUnpaid, isListedSale, countUnpaid,
  statusCounts, paymentLabelState, orderDayKey, todayKeys, dayCounts,
  DETAILED_ORDER_CAP, ORDER_TZ,
} from '../src/utils/ordersView.js';
import {
  buildCommerceMetrics, classifyOrder, shipmentState,
} from '../src/utils/commerceMetrics.js';

const FIXTURE = JSON.parse(readFileSync(
  fileURLToPath(new URL('./fixtures/commerce-royalfoods.json', import.meta.url)), 'utf8'));

const SRC = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');
const code = (p) => SRC(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const TZ = 'Asia/Kolkata';
const NOW = Date.parse('2026-09-20T06:30:00Z');   // 12:00 IST on the 20th
/** What OrdersTab holds after loading: the listable rows. */
const LOADED = listableRows(FIXTURE);
const money = (rows) => rows.reduce((s, o) => s + Math.round((Number(o.total) || 0) * 100), 0) / 100;

const order = (over = {}) => ({
  id: over.id ?? `o-${Math.random().toString(36).slice(2)}`,
  created_at: '2026-09-18T10:00:00.000Z',
  status: 'new',
  payment_method: 'cod',
  total: 100,
  paid: false,
  payment_ref: null,
  awb: null,
  shipment_status: null,
  shipment_outcome: null,
  ...over,
});

// ── 1-2. the loaded list and its reconciliation ─────────────────────────────

test('GATE: the loaded Orders list is still 201 rows', () => {
  assert.equal(LOADED.length, 201);
});

test('201 reconciles to canonical, row for row', () => {
  const kinds = {};
  for (const o of LOADED) { const k = classifyOrder(o); kinds[k] = (kinds[k] || 0) + 1; }
  assert.equal(kinds.sale, 182, '182 canonical sale orders');
  assert.equal(kinds.cancelled, 18, '18 cancelled');
  assert.equal(kinds.payment_incomplete, 1, '1 payment-incomplete');
  assert.equal(kinds.abandoned, undefined, 'abandoned rows are not listed');
  assert.equal(182 + 18 + 1, LOADED.length, '182 + 18 + 1 = 201');

  const m = buildCommerceMetrics(FIXTURE, { timeZone: TZ });
  assert.equal(m.population.saleOrders.count, 182, 'and canonical agrees on the 182');
});

test('the list deliberately does NOT equal canonical Sales Orders', () => {
  const m = buildCommerceMetrics(FIXTURE, { timeZone: TZ });
  assert.notEqual(LOADED.length, m.population.saleOrders.count);
  assert.equal(LOADED.length - m.population.saleOrders.count, 19,
    'the 19 extra rows are operational, not accounting');
});

test('no accounting total is computed anywhere on this screen', () => {
  const view = code('../src/utils/ordersView.js');
  const tab = code('../src/components/manage/OrdersTab.jsx');
  for (const src of [view, tab]) {
    assert.ok(!/grossSales|averageOrderValue|money\.collected|money\.outstanding|money\.writtenOff/.test(src),
      'Orders shows no accounting aggregate');
    assert.ok(!/buildCommerceMetrics/.test(src), 'and does not build the model');
    assert.ok(!/fetchOrderFacts/.test(src), 'and does not read the uncapped feed');
  }
});

// ── 3-8. Unpaid ─────────────────────────────────────────────────────────────

test('GATE: Unpaid goes from 110 raw to 91 valid', () => {
  const rawUnpaid = LOADED.filter((o) => !o.paid);
  assert.equal(rawUnpaid.length, 110, 'the old formula');
  assert.equal(money(rawUnpaid), 48091);
  assert.equal(countUnpaid(LOADED), 91, 'the new one');
});

test('91 decomposes as 63 Outstanding + 28 Written Off', () => {
  const m = buildCommerceMetrics(FIXTURE, { timeZone: TZ });
  assert.equal(m.money.outstanding.count, 63);
  assert.equal(m.money.writtenOff.count, 28);
  assert.equal(m.money.outstanding.count + m.money.writtenOff.count, 91);
  assert.equal(countUnpaid(LOADED), 91);
});

test('Orders Unpaid is NOT canonical Outstanding — they answer different questions', () => {
  const m = buildCommerceMetrics(FIXTURE, { timeZone: TZ });
  assert.notEqual(countUnpaid(LOADED), m.money.outstanding.count);
  assert.equal(countUnpaid(LOADED), 91, 'payment status: money has not arrived');
  assert.equal(m.money.outstanding.count, 63, 'collectible balance: money can still arrive');
});

test('cancelled orders are excluded from Unpaid', () => {
  const cancelled = LOADED.filter((o) => classifyOrder(o) === 'cancelled');
  assert.equal(cancelled.length, 18);
  assert.ok(cancelled.every((o) => !o.paid), 'all 18 are unpaid by the old formula');
  assert.ok(cancelled.every((o) => !isOrdersUnpaid(o)), 'and none is Unpaid now');
});

test('a payment-incomplete order is excluded from Unpaid', () => {
  const incomplete = LOADED.filter((o) => classifyOrder(o) === 'payment_incomplete');
  assert.equal(incomplete.length, 1);
  assert.equal(isOrdersUnpaid(incomplete[0]), false);
  // and the synthetic case
  const row = order({ payment_method: 'online', paid: false, payment_ref: null });
  assert.equal(classifyOrder(row), 'payment_incomplete');
  assert.equal(isOrdersUnpaid(row), false);
});

test('a returned valid order STAYS Unpaid — payment status, not collectibility', () => {
  const returnedUnpaid = LOADED.filter((o) => isListedSale(o)
    && shipmentState(o) === 'returned' && !o.paid);
  assert.equal(returnedUnpaid.length, 28);
  assert.ok(returnedUnpaid.every(isOrdersUnpaid), 'every one is still Unpaid');
  // It is simultaneously labelled Returned. Both are true.
  assert.ok(returnedUnpaid.every((o) => paymentLabelState(o) === 'returned'));
});

test('CHIP EQUALS FILTER: the count is the number of rows the chip opens', () => {
  // The whole point of one predicate. Proven on the real fixture...
  const chip = countUnpaid(LOADED);
  const filtered = LOADED.filter((o) => (true ? isOrdersUnpaid(o) : true));
  assert.equal(chip, filtered.length, `chip said ${chip}, filter rendered ${filtered.length}`);
  assert.equal(chip, 91);

  // ...and on adversarial mixtures, so it cannot drift on some other store.
  const mixed = [
    order({ id: 'a' }),
    order({ id: 'b', paid: true }),
    order({ id: 'c', status: 'cancelled' }),
    order({ id: 'd', payment_method: 'online', paid: false }),
    order({ id: 'e', awb: 'A1', shipment_outcome: 'returned' }),
    order({ id: 'f', status: 'abandoned' }),
    order({ id: 'g', total: 0 }),
  ];
  const loaded = listableRows(mixed);
  assert.equal(countUnpaid(loaded), loaded.filter(isOrdersUnpaid).length);
  assert.equal(countUnpaid(loaded), 3, 'a, e and g — the zero-value enquiry counts as a row');
});

test('the component does not inline a second unpaid predicate', () => {
  const tab = code('../src/components/manage/OrdersTab.jsx');
  assert.ok(!/unpaidOnly \? !o\.paid/.test(tab), 'the old inline filter is gone');
  assert.ok(!/filter\(\(o\) => !o\.paid\)/.test(tab), 'and so is the old inline count');
  assert.match(tab, /unpaidOnly \? isOrdersUnpaid\(o\)/, 'the filter uses the shared predicate');
  assert.match(tab, /countUnpaid\(orders \|\| \[\], \{ leads \}\)/, 'and so does the count');
});

// ── 9-12. returns ───────────────────────────────────────────────────────────

test('canonical return detection catches all 29 returned rows, up from 26', () => {
  const canonReturned = LOADED.filter((o) => shipmentState(o) === 'returned');
  assert.equal(canonReturned.length, 29);
  // The old private test: COD only, and shipment_outcome only.
  const oldTest = (o) => !o.paid && String(o.payment_method || '').toLowerCase() === 'cod'
    && (o.shipment_outcome === 'returned' || o.shipment_outcome === 'lost');
  assert.equal(LOADED.filter(oldTest).length, 26, 'what the screen used to detect');
  assert.equal(canonReturned.filter((o) => !oldTest(o) && !o.paid).length, 3, 'the three it missed');
});

test('a returned UPI order is detected, not just COD', () => {
  const upi = order({ payment_method: 'upi', awb: 'A1', shipment_outcome: 'returned' });
  assert.equal(shipmentState(upi), 'returned');
  assert.equal(paymentLabelState(upi), 'returned');
});

test('a return evidenced only by the status string is detected', () => {
  for (const shipment_status of ['Returned To Seller', 'RTO', 'Received at RTS DC', 'RTO Delivered']) {
    const row = order({ awb: 'A1', shipment_outcome: null, shipment_status });
    assert.equal(shipmentState(row), 'returned', shipment_status);
    assert.equal(paymentLabelState(row), 'returned', shipment_status);
  }
});

test('the one cancelled+returned row is operationally returned but not Unpaid', () => {
  const both = LOADED.filter((o) => classifyOrder(o) === 'cancelled' && shipmentState(o) === 'returned');
  assert.equal(both.length, 1);
  const row = both[0];
  assert.equal(paymentLabelState(row), 'returned', 'its card still says Returned');
  assert.equal(isOrdersUnpaid(row), false, 'but it is not waiting for money');
  assert.equal(Number(row.total), 340);
});

// ── the payment-label precedence ────────────────────────────────────────────

test('payment label precedence is explicit and holds', () => {
  const cases = [
    ['normal unpaid',    order({}), 'unpaid'],
    ['normal paid',      order({ paid: true }), 'paid'],
    ['payment incomplete', order({ payment_method: 'online', paid: false, payment_ref: null }), 'incomplete'],
    ['payment unconfirmed', order({ payment_method: 'online', paid: false, payment_ref: null, awb: 'A1' }), 'unconfirmed'],
    ['returned + unpaid', order({ awb: 'A1', shipment_outcome: 'returned' }), 'returned'],
    ['returned + paid',   order({ paid: true, awb: 'A1', shipment_outcome: 'returned' }), 'paid'],
  ];
  for (const [name, row, expected] of cases) {
    assert.equal(paymentLabelState(row), expected, name);
  }
});

test('a generic Unpaid never hides Payment not completed', () => {
  const row = order({ payment_method: 'online', paid: false, payment_ref: null });
  assert.equal(paymentLabelState(row), 'incomplete');
  assert.notEqual(paymentLabelState(row), 'unpaid');
});

test('incomplete and returned cannot both apply, by construction', () => {
  // payment-incomplete requires the order NOT to have shipped; a return requires
  // that it did. So the precedence between them is never actually exercised.
  const shipped = order({ payment_method: 'online', paid: false, payment_ref: null,
    awb: 'A1', shipment_outcome: 'returned' });
  assert.notEqual(classifyOrder(shipped), 'payment_incomplete', 'shipping makes it a real sale');
  assert.equal(paymentLabelState(shipped), 'returned');
});

test('leads carry no payment state at all', () => {
  assert.equal(paymentLabelState(order({}), { leads: true }), null);
  assert.equal(paymentLabelState(order({ paid: true }), { leads: true }), null);
  assert.equal(countUnpaid(LOADED, { leads: true }), 0);
});

// ── 13. fulfilment counts ───────────────────────────────────────────────────

test('fulfilment status counts are loaded-list counts and are unchanged', () => {
  const counts = statusCounts(LOADED);
  assert.deepEqual(counts, { new: 36, confirmed: 65, delivered: 80, cancelled: 18, dispatched: 2 });
  assert.equal(Object.values(counts).reduce((a, b) => a + b, 0), 201, 'they tally to the list');
  // They are pure status tallies - no accounting classification involved.
  const view = code('../src/utils/ordersView.js');
  const fn = view.slice(view.indexOf('export function statusCounts'));
  assert.ok(!/classifyOrder|shipmentState|paid/.test(fn.slice(0, 300)),
    'statusCounts reads o.status and nothing else');
});

test('an order status is never inferred from the shipment state', () => {
  const view = code('../src/utils/ordersView.js');
  assert.ok(!/status\s*=\s*['"]/.test(view), 'nothing here writes a status');
  const tab = code('../src/components/manage/OrdersTab.jsx');
  // The only writer is the merchant's own action.
  const writes = (tab.match(/setOrderStatus\(/g) || []).length;
  assert.equal(writes, 1, 'exactly one status writer, the existing merchant action');
});

// ── 14. the cap ─────────────────────────────────────────────────────────────

test('the cap notice keys on the RAW page size, not the filtered list', () => {
  assert.equal(DETAILED_ORDER_CAP, 500, 'matches get_store_orders LIMIT 500');
  assert.equal(isAtDetailedCap(500), true);
  assert.equal(isAtDetailedCap(499), false);
  assert.equal(isAtDetailedCap(447), false, 'the audited store is not truncated');
  // The point of measuring raw: a mostly-abandoned store is truncated long
  // before its listable rows reach 500.
  const raw = [];
  for (let i = 0; i < 500; i++) raw.push(order({ id: `r-${i}`, status: i % 2 ? 'abandoned' : 'new' }));
  assert.equal(listableRows(raw).length, 250, 'only 250 are listable');
  assert.equal(isAtDetailedCap(raw.length), true, 'but the page was full, so the notice shows');
});

test('the component measures the cap before dropping abandoned rows', () => {
  const tab = code('../src/components/manage/OrdersTab.jsx');
  assert.match(tab, /fetchOrders\(slug, pin, \{ includeAbandoned: true \}\)/,
    'it asks for the raw page');
  assert.match(tab, /setRawCount\(raw\.length\)/, 'measures it');
  assert.match(tab, /listableRows\(raw\)/, 'then drops abandoned for the list');
  assert.match(tab, /isAtDetailedCap\(rawCount\)/, 'and keys the notice on the raw count');
});

test('the cap notice does not claim the merchant has exactly 500 orders', () => {
  const tab = SRC('../src/components/manage/OrdersTab.jsx');
  assert.match(tab, /Showing the newest \{DETAILED_ORDER_CAP\}/, 'it says "newest", not "total"');
  assert.ok(!/500 (orders|total|lifetime)/.test(tab), 'it never claims 500 is the whole story');
  // The cap number itself is the named constant, never typed out as a count.
  const tabCode = code('../src/components/manage/OrdersTab.jsx');
  assert.ok(!/=\s*500\b/.test(tabCode), 'no hard-coded 500 threshold in the component');
  assert.ok(!/>=?\s*500\b/.test(tabCode), 'and no hard-coded 500 comparison');
  assert.match(tabCode, /DETAILED_ORDER_CAP/, 'it uses the named constant');
});

test('with 600 rows the list stays capped and no uncapped number appears', () => {
  const raw = [];
  for (let i = 0; i < 600; i++) raw.push(order({ id: `b-${i}` }));
  // get_store_orders would only ever hand back 500 of these.
  const page = raw.slice(0, DETAILED_ORDER_CAP);
  const loaded = listableRows(page);
  assert.equal(loaded.length, 500);
  assert.equal(isAtDetailedCap(page.length), true);
  assert.equal(countUnpaid(loaded), 500, 'the counter describes the loaded list, honestly');
});

// ── 15. time ────────────────────────────────────────────────────────────────

test('date keys are the merchant Asia/Kolkata civil day', () => {
  assert.equal(ORDER_TZ, 'Asia/Kolkata');
  assert.equal(orderDayKey('2026-09-19T18:29:59.000Z'), '2026-09-19');
  assert.equal(orderDayKey('2026-09-19T18:30:00.000Z'), '2026-09-20', 'IST midnight');
  assert.equal(orderDayKey('2026-09-19T18:30:00.000Z', 'UTC'), '2026-09-19', 'UTC disagrees');
  assert.equal(orderDayKey('nonsense'), '');
  assert.equal(orderDayKey(null), '');
});

test('Today and Yesterday are merchant civil dates', () => {
  assert.deepEqual(todayKeys(NOW), { today: '2026-09-20', yesterday: '2026-09-19' });
  assert.deepEqual(todayKeys(null), { today: '', yesterday: '' });
  assert.deepEqual(todayKeys(NaN), { today: '', yesterday: '' });
});

test('day counts bucket on the IST boundary', () => {
  const rows = [
    order({ id: 'a', created_at: '2026-09-19T18:29:59.000Z' }),
    order({ id: 'b', created_at: '2026-09-19T18:30:00.000Z' }),
    order({ id: 'c', created_at: '2026-09-19T20:00:00.000Z' }),
  ];
  assert.deepEqual(dayCounts(rows), { '2026-09-19': 1, '2026-09-20': 2 });
});

test('the component no longer keys dates on the browser calendar', () => {
  const tab = code('../src/components/manage/OrdersTab.jsx');
  assert.ok(!/toLocaleDateString\('en-CA'\)/.test(tab), 'the browser-local key is gone');
  assert.match(tab, /orderDayKey\(iso\)/);
  assert.match(tab, /todayKeys\(loadedAt\)/, 'and the clock is read once, at load');
});

// ── 16-18. unchanged behaviour ──────────────────────────────────────────────

test('search semantics are unchanged: it ignores the chips and scans everything', () => {
  const tab = code('../src/components/manage/OrdersTab.jsx');
  assert.match(tab, /const filtered = searching\s*\n?\s*\? \(orders \|\| \[\]\)\.filter\(matchQuery\)/,
    'a search still bypasses status, date and unpaid');
  assert.match(tab, /qDigits\.length >= 3/, 'phone matching unchanged');
});

test('leads mode is untouched', () => {
  const tab = SRC('../src/components/manage/OrdersTab.jsx');
  assert.match(tab, /const FILTERS_LEADS\s*=\s*\['all', 'new', 'confirmed', 'delivered', 'cancelled'\]/);
  assert.match(tab, /confirmed:\s*\{ label: 'Contacted'/);
  assert.match(tab, /dispatched:\s*\{ label: 'In talks'/);
  assert.match(tab, /delivered:\s*\{ label: 'Won'/);
  assert.match(tab, /cancelled:\s*\{ label: 'Lost'/);
  assert.match(tab, /!leads && unpaidCount > 0/, 'no Unpaid chip in Leads');
});

test('no mutation helper was touched', () => {
  const tab = code('../src/components/manage/OrdersTab.jsx');
  // The mutation surface is exactly what it was.
  assert.match(tab, /await setOrderStatus\(slug, pin, id, status\)/);
  assert.match(tab, /await setOrderPaid\(slug, pin, id, paid\)/);
  for (const helper of ['shipmentOp', 'createPaymentLink', 'createReviewInvite', 'openDeliverySlip']) {
    assert.ok(tab.includes(helper), `${helper} still wired`);
  }
  // And ordersView writes nothing at all.
  const view = code('../src/utils/ordersView.js');
  assert.ok(!/supabase|rpc\(|setOrder|await /.test(view), 'the projection is pure');
});

// ── 19-21. scope ────────────────────────────────────────────────────────────

test('Home and Stats are unchanged and keep their own projections', () => {
  assert.match(SRC('../src/components/manage/OverviewTab.jsx'), /overviewMetrics/);
  assert.match(SRC('../src/components/manage/AnalyticsTab.jsx'), /statsMetrics/);
  for (const f of ['../src/components/manage/OverviewTab.jsx',
                   '../src/components/manage/AnalyticsTab.jsx']) {
    assert.ok(!SRC(f).includes('ordersView'), `${f} does not borrow the Orders view`);
  }
});

test('Payments and Delivery remain non-consumers', () => {
  for (const f of ['../src/components/manage/PaymentsTab.jsx',
                   '../src/components/manage/DeliveryBoard.jsx',
                   '../src/utils/paymentsLedger.js']) {
    const src = SRC(f);
    assert.equal(/commerceMetrics|statsMetrics|overviewMetrics|ordersView/.test(src), false,
      `${f} is migrated by a later PR, not this one`);
  }
});

test('ordersView shapes canonical output but defines no rule', () => {
  const src = code('../src/utils/ordersView.js');
  assert.match(src, /from '\.\/commerceMetrics\.js'/, 'it consumes the model');
  assert.ok(!/status\s*===\s*['"]cancelled['"]/.test(src), 'no private cancelled test');
  assert.ok(!/payment_method.*===.*['"]online['"]/.test(src), 'no private payment-incomplete test');
  assert.ok(!/rto|rts|RTO|Returned To Seller/.test(src), 'no private return matching');
  assert.ok(!/Date\.now/.test(src), 'and it reads no clock of its own');
});

test('the projection never mutates the rows it is given', () => {
  const before = JSON.stringify(FIXTURE);
  listableRows(FIXTURE); countUnpaid(LOADED); statusCounts(LOADED); dayCounts(LOADED);
  assert.equal(JSON.stringify(FIXTURE), before);
});

test('empty and unusable input is handled without throwing', () => {
  for (const input of [[], null, undefined, 'nonsense']) {
    assert.deepEqual(listableRows(input), []);
    assert.equal(countUnpaid(input), 0);
    assert.deepEqual(statusCounts(input), {});
    assert.deepEqual(dayCounts(input), {});
  }
  assert.equal(isOrdersUnpaid(null), false);
  assert.equal(isOrdersUnpaid(undefined), false);
});
