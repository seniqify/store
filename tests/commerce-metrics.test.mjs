// Commerce metrics, PR 3: the canonical model.
//
// src/utils/commerceMetrics.js is pure, so this is a real test suite, not source
// pinning: orders go in, numbers come out, and the invariants are proved rather
// than asserted in a comment.
//
// NOTHING CONSUMES THE MODULE YET. Expected merchant-visible change: zero.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  buildCommerceMetrics, checkInvariants,
  classifyOrder, paymentState, shipmentState, isPaymentIncomplete, isShippedOrDelivered,
  dayKeyInZone, dayKeysBetween,
  ORDER_KINDS, PAYMENT_STATES, DELIVERY_STATES,
} from '../src/utils/commerceMetrics.js';

const FIXTURE = JSON.parse(readFileSync(
  fileURLToPath(new URL('./fixtures/commerce-royalfoods.json', import.meta.url)), 'utf8'));

/** A minimal valid sale order; override whatever the case is about. */
const order = (over = {}) => ({
  id: over.id ?? `o-${Math.random().toString(36).slice(2)}`,
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

const M = (rows, opts) => buildCommerceMetrics(rows, opts);

// ── A. the Royal Foods fixture ───────────────────────────────────────────────
//
// 447 real production rows, PII-free. Razorpay refs, payment-link ids and AWBs
// are replaced with stable placeholders; every one was non-null before and
// after, so nothing the model reads has changed.
//
// The AUDITED anchors are reproduced exactly. The collected/outstanding and
// delivered/in-flight splits have moved by one order since the audit, because a
// COD parcel was delivered and collected in between -- real money, not a model
// change. Both identities still balance to the rupee.

test('fixture: Sales Orders and Gross Sales match the audited baseline exactly', () => {
  const m = M(FIXTURE);
  assert.equal(m.population.saleOrders.count, 182);
  assert.equal(m.money.grossSales, 86018);
  assert.equal(m.population.revenueOrders.count, 182);
});

test('fixture: the money identity holds to the rupee', () => {
  const m = M(FIXTURE);
  assert.equal(m.money.collected.amount + m.money.outstanding.amount + m.money.writtenOff.amount,
    m.money.grossSales);
  // current production values (audited: 90/45103, 64/28966, 28/11949)
  assert.deepEqual(m.money.collected, { count: 91, amount: 45443 });
  assert.deepEqual(m.money.outstanding, { count: 63, amount: 28626 });
  assert.deepEqual(m.money.writtenOff, { count: 28, amount: 11949 });
});

test('fixture: the delivery identity holds, and matches the audited totals', () => {
  const m = M(FIXTURE);
  assert.deepEqual(m.delivery.orders, { count: 144, amount: 68132 });   // audited
  assert.deepEqual(m.delivery.returned, { count: 28, amount: 11949 });  // audited
  // audited: 78/39353 delivered, 38/16830 in flight
  assert.deepEqual(m.delivery.delivered, { count: 79, amount: 39693 });
  assert.deepEqual(m.delivery.inFlight, { count: 37, amount: 16490 });
  assert.equal(m.delivery.delivered.count + m.delivery.returned.count + m.delivery.inFlight.count,
    m.delivery.orders.count);
  assert.equal(m.delivery.delivered.amount + m.delivery.returned.amount + m.delivery.inFlight.amount,
    m.delivery.orders.amount);
});

test('fixture: the excluded populations are accounted for, and nothing is lost', () => {
  const m = M(FIXTURE);
  const e = m.population.excluded;
  assert.deepEqual(e.abandoned, { count: 246, amount: 110374 });
  assert.deepEqual(e.cancelled, { count: 18, amount: 7196 });
  assert.deepEqual(e.paymentIncomplete, { count: 1, amount: 320 });
  assert.deepEqual(e.enquiry, { count: 0, amount: 0 });
  // every row lands in exactly one kind
  assert.equal(m.population.saleOrders.count + e.abandoned.count + e.cancelled.count
    + e.paymentIncomplete.count, FIXTURE.length);
});

test('fixture: the undated-money problem is surfaced, not hidden', () => {
  const m = M(FIXTURE);
  // 75 of 91 collected orders have no paid_at: 86% of the money by count.
  assert.deepEqual(m.money.collectedUnknownDate, { count: 75, amount: 39033 });
  assert.ok(m.money.collectedUnknownDate.amount < m.money.collected.amount);
});

test('fixture: the Delivery COD tile is a strict subset of COD outstanding', () => {
  const m = M(FIXTURE);
  assert.deepEqual(m.money.cod.outstanding, { count: 51, amount: 22677 });
  assert.deepEqual(m.delivery.codOnUndelivered, { count: 31, amount: 13610 });
  assert.ok(m.delivery.codOnUndelivered.amount < m.money.cod.outstanding.amount,
    'different populations, so they may differ -- but one contains the other');
});

test('fixture: all invariants hold', () => {
  assert.deepEqual(checkInvariants(M(FIXTURE)), []);
});

// ── B. THE PARTITION PROPERTIES — the most important tests here ──────────────

test('every revenue order lands in exactly one of collected / outstanding / written_off', () => {
  const m = M(FIXTURE);
  const { collected, outstanding, writtenOff } = m.money;
  assert.equal(collected.count + outstanding.count + writtenOff.count,
    m.population.revenueOrders.count, 'no double counting, no residue');
  // and independently, per row
  const seen = { collected: 0, outstanding: 0, written_off: 0 };
  for (const o of FIXTURE) {
    if (classifyOrder(o) !== 'sale') continue;
    const s = paymentState(o);
    assert.ok(PAYMENT_STATES.includes(s), `unknown payment state ${s}`);
    seen[s] += 1;
  }
  assert.equal(seen.collected, collected.count);
  assert.equal(seen.outstanding, outstanding.count);
  assert.equal(seen.written_off, writtenOff.count);
});

test('every delivery order lands in exactly one of delivered / returned / in_flight', () => {
  const m = M(FIXTURE);
  const seen = { delivered: 0, returned: 0, in_flight: 0 };
  for (const o of FIXTURE) {
    const kind = classifyOrder(o);
    if (kind !== 'sale' && kind !== 'enquiry') continue;
    if (!o.awb) continue;
    const s = shipmentState(o) ?? 'in_flight';
    assert.ok(DELIVERY_STATES.includes(s), `unknown delivery state ${s}`);
    seen[s] += 1;
  }
  assert.equal(seen.delivered, m.delivery.delivered.count);
  assert.equal(seen.returned, m.delivery.returned.count);
  assert.equal(seen.in_flight, m.delivery.inFlight.count);
  assert.equal(seen.delivered + seen.returned + seen.in_flight, m.delivery.orders.count);
});

test('classifyOrder always returns exactly one known kind', () => {
  for (const o of FIXTURE) assert.ok(ORDER_KINDS.includes(classifyOrder(o)));
});

// ── C. adversarial classification ────────────────────────────────────────────

test('a cancelled order is excluded even when it is paid', () => {
  const m = M([order({ status: 'cancelled', paid: true, paid_at: '2026-09-02T00:00:00Z', total: 500 })]);
  assert.equal(m.population.saleOrders.count, 0);
  assert.equal(m.money.grossSales, 0);
  assert.equal(m.money.collected.amount, 0);
  assert.deepEqual(m.population.excluded.cancelled, { count: 1, amount: 500 });
});

test('an abandoned checkout is excluded, and beats every other rule', () => {
  const m = M([order({ status: 'abandoned', paid: true, total: 700 })]);
  assert.deepEqual(m.population.excluded.abandoned, { count: 1, amount: 700 });
  assert.equal(m.population.saleOrders.count, 0);
});

test('an online order the customer never paid for is payment_incomplete, not a sale', () => {
  const o = order({ payment_method: 'online', paid: false, payment_ref: null, total: 900 });
  assert.equal(isPaymentIncomplete(o), true);
  assert.equal(classifyOrder(o), 'payment_incomplete');
  const m = M([o]);
  assert.equal(m.money.grossSales, 0);
  assert.deepEqual(m.population.excluded.paymentIncomplete, { count: 1, amount: 900 });
});

test('the same online order becomes a sale once it ships, even while unpaid', () => {
  // "unconfirmed": shipped, so the money almost certainly arrived.
  const o = order({ payment_method: 'online', paid: false, payment_ref: null, awb: 'AWB1', total: 900 });
  assert.equal(isPaymentIncomplete(o), false);
  assert.equal(classifyOrder(o), 'sale');
  const m = M([o]);
  assert.equal(m.money.grossSales, 900);
  assert.equal(m.money.outstanding.amount, 900);
});

test('a COD order that is unpaid is outstanding, not written off', () => {
  const m = M([order({ payment_method: 'cod', paid: false, total: 400 })]);
  assert.deepEqual(m.money.outstanding, { count: 1, amount: 400 });
  assert.deepEqual(m.money.cod.outstanding, { count: 1, amount: 400 });
  assert.equal(m.money.writtenOff.amount, 0);
});

test('a COD parcel the courier says is delivered but the row says unpaid is OUTSTANDING', () => {
  // The courier moving the box does not mean the seller has the cash. `paid` is
  // the authority for collected; the shipment only decides written_off.
  const o = order({ payment_method: 'cod', paid: false, awb: 'AWB1',
                    shipment_status: 'Delivered', shipment_outcome: 'delivered', total: 400 });
  const m = M([o]);
  assert.equal(paymentState(o), 'outstanding');
  assert.deepEqual(m.money.outstanding, { count: 1, amount: 400 });
  assert.deepEqual(m.delivery.delivered, { count: 1, amount: 400 });
  // ...and it is NOT on the "COD on undelivered shipments" tile
  assert.equal(m.delivery.codOnUndelivered.count, 0);
});

test('a returned COD order is written off, never outstanding', () => {
  const o = order({ payment_method: 'cod', paid: false, awb: 'AWB1',
                    shipment_outcome: 'returned', total: 450 });
  assert.equal(paymentState(o), 'written_off');
  const m = M([o]);
  assert.deepEqual(m.money.writtenOff, { count: 1, amount: 450 });
  assert.equal(m.money.outstanding.amount, 0);
  assert.deepEqual(m.delivery.returned, { count: 1, amount: 450 });
});

test('"RTO Delivered" is a RETURN, not a delivery', () => {
  // The whole reason return is evaluated before delivered.
  const o = order({ awb: 'AWB1', shipment_status: 'RTO Delivered', total: 300 });
  assert.equal(shipmentState(o), 'returned');
  const m = M([o]);
  assert.deepEqual(m.delivery.returned, { count: 1, amount: 300 });
  assert.equal(m.delivery.delivered.count, 0);
  assert.deepEqual(m.money.writtenOff, { count: 1, amount: 300 });
});

test('"Undelivered" is not a delivery either', () => {
  assert.equal(shipmentState(order({ awb: 'A', shipment_status: 'Undelivered' })), 'in_flight');
  assert.equal(shipmentState(order({ awb: 'A', shipment_status: 'Not Delivered' })), 'in_flight');
});

test('shipment_outcome beats order.status, which beats the courier string', () => {
  // 1. outcome wins over a contradicting status AND string
  assert.equal(shipmentState(order({ shipment_outcome: 'returned', status: 'delivered',
                                     shipment_status: 'Delivered', awb: 'A' })), 'returned');
  // 2. status wins when there is no outcome
  assert.equal(shipmentState(order({ status: 'delivered', shipment_status: 'In Transit', awb: 'A' })),
    'delivered');
  // 3. the string is the last resort
  assert.equal(shipmentState(order({ shipment_status: 'In Transit', awb: 'A' })), 'in_flight');
  // 4. 'lost' is a return
  assert.equal(shipmentState(order({ shipment_outcome: 'lost', awb: 'A' })), 'returned');
});

test('no AWB means no shipment at all', () => {
  assert.equal(shipmentState(order({})), null);
  const m = M([order({ total: 200 })]);
  assert.equal(m.delivery.orders.count, 0);
});

test('a cancelled order never reaches the delivery board, even with an AWB', () => {
  const m = M([order({ status: 'cancelled', awb: 'AWB1', shipment_status: 'In Transit', total: 340 })]);
  assert.equal(m.delivery.orders.count, 0, 'DELIVERY_ORDERS is a subset of SALE_ORDERS');
});

test('isShippedOrDelivered is NULL-safe', () => {
  // A SQL predicate written as `... or shipment_outcome = 'delivered'` goes NULL
  // when the column is NULL and silently drops rows. That bug was in the audit's
  // own helper queries.
  assert.equal(isShippedOrDelivered(order({})), false);
  assert.equal(isShippedOrDelivered(order({ awb: '' })), false);
  assert.equal(isShippedOrDelivered(order({ shipment_outcome: null })), false);
  assert.equal(isShippedOrDelivered(order({ awb: 'A' })), true);
  assert.equal(isShippedOrDelivered(order({ status: 'delivered' })), true);
});

// ── D. timestamps and flows ──────────────────────────────────────────────────

test('a paid order with no paid_at counts in the BALANCE but never in a dated flow', () => {
  const o = order({ paid: true, paid_at: null, paid_via: 'cod_delivery', total: 600 });
  const m = M([o], { rangeFrom: Date.parse('2026-01-01T00:00:00Z'),
                     rangeTo: Date.parse('2030-01-01T00:00:00Z') });
  assert.deepEqual(m.money.collected, { count: 1, amount: 600 });
  assert.deepEqual(m.money.collectedUnknownDate, { count: 1, amount: 600 });
  assert.equal(m.flows.collected.amount, 0, 'never dated into a flow');
  assert.deepEqual(m.flows.collectedUndated, { count: 1, amount: 600 });
});

test('collected flow uses paid_at ONLY — never delivered_at or created_at', () => {
  // The existing ledger falls back paid_at -> delivered_at -> created_at, which
  // on production attributes 86% of collected money to the order date.
  const o = order({ paid: true, paid_at: null, total: 600,
                    delivered_at: '2026-09-05T10:00:00Z', created_at: '2026-09-05T10:00:00Z' });
  const m = M([o], { rangeFrom: Date.parse('2026-09-01T00:00:00Z'),
                     rangeTo: Date.parse('2026-09-30T00:00:00Z') });
  assert.equal(m.flows.collected.amount, 0);
  assert.equal(m.money.collectedUnknownDate.amount, 600);
});

test('each flow is dated by its own event', () => {
  const rows = [
    order({ id: 'a', total: 100, created_at: '2026-09-10T06:00:00Z' }),
    order({ id: 'b', total: 200, paid: true, paid_at: '2026-09-11T06:00:00Z',
            created_at: '2026-08-01T06:00:00Z' }),
    order({ id: 'c', total: 300, awb: 'A', shipment_outcome: 'delivered',
            delivered_at: '2026-09-12T06:00:00Z', created_at: '2026-08-01T06:00:00Z' }),
    order({ id: 'd', total: 400, awb: 'A', shipment_outcome: 'returned',
            returned_at: '2026-09-13T06:00:00Z', created_at: '2026-08-01T06:00:00Z' }),
  ];
  const m = M(rows, { rangeFrom: Date.parse('2026-09-09T00:00:00Z'),
                      rangeTo: Date.parse('2026-09-14T00:00:00Z') });
  assert.equal(m.flows.sales.amount, 100, 'only the order created in range');
  assert.equal(m.flows.collected.amount, 200);
  assert.equal(m.flows.delivered.amount, 300);
  assert.equal(m.flows.returned.amount, 400);
});

test('balances are never range-scoped', () => {
  const rows = [order({ total: 100, paid: true, paid_at: '2020-01-01T00:00:00Z' })];
  const narrow = M(rows, { rangeFrom: Date.parse('2026-09-01T00:00:00Z'),
                           rangeTo: Date.parse('2026-09-02T00:00:00Z') });
  const wide = M(rows);
  assert.equal(narrow.money.collected.amount, 100);
  assert.equal(wide.money.collected.amount, 100, 'the balance ignores the range entirely');
  assert.equal(narrow.flows.collected.amount, 0, 'the flow does not');
});

test('with no range, flows are empty and the range is reported as null', () => {
  const m = M([order({ paid: true, paid_at: '2026-09-01T00:00:00Z', total: 100 })]);
  assert.equal(m.flows.range, null);
  assert.equal(m.flows.collected.amount, 0);
  assert.deepEqual(m.flows.byDay, []);
});

test('a return with no returned_at is never invented into a flow', () => {
  const o = order({ awb: 'A', shipment_outcome: 'returned', returned_at: null, total: 250,
                    created_at: '2026-09-10T06:00:00Z' });
  const m = M([o], { rangeFrom: Date.parse('2026-09-01T00:00:00Z'),
                     rangeTo: Date.parse('2026-09-30T00:00:00Z') });
  assert.equal(m.money.writtenOff.amount, 250, 'the balance is real');
  assert.equal(m.flows.returned.amount, 0, 'the date is not');
});

test('day keys follow the merchant timezone across the Asia/Kolkata boundary', () => {
  // 18:29:59Z is still the previous day in IST (+05:30); 18:30:00Z is the next.
  assert.equal(dayKeyInZone(Date.parse('2026-09-10T18:29:59Z'), 'Asia/Kolkata'), '2026-09-10');
  assert.equal(dayKeyInZone(Date.parse('2026-09-10T18:30:00Z'), 'Asia/Kolkata'), '2026-09-11');
  // ...and UTC would disagree, which is the whole point of passing the zone.
  assert.equal(dayKeyInZone(Date.parse('2026-09-10T18:30:00Z'), 'UTC'), '2026-09-10');
});

test('an order just after IST midnight lands on the new day, not the old one', () => {
  const rows = [
    order({ id: 'before', total: 100, created_at: '2026-09-10T18:29:00Z' }),
    order({ id: 'after', total: 200, created_at: '2026-09-10T18:31:00Z' }),
  ];
  const m = M(rows, { timeZone: 'Asia/Kolkata',
                      rangeFrom: Date.parse('2026-09-09T00:00:00Z'),
                      rangeTo: Date.parse('2026-09-12T00:00:00Z') });
  const d10 = m.flows.byDay.find((d) => d.day === '2026-09-10');
  const d11 = m.flows.byDay.find((d) => d.day === '2026-09-11');
  assert.equal(d10.sales, 100);
  assert.equal(d11.sales, 200);
});

test('dayKeysBetween produces a contiguous run with no gaps or repeats', () => {
  const keys = dayKeysBetween(Date.parse('2026-09-09T00:00:00Z'),
                              Date.parse('2026-09-12T00:00:00Z'), 'Asia/Kolkata');
  assert.deepEqual([...new Set(keys)], keys, 'no repeats');
  assert.ok(keys.length >= 4);
  for (let i = 1; i < keys.length; i++) {
    const prev = Date.parse(keys[i - 1] + 'T00:00:00Z');
    assert.equal(Date.parse(keys[i] + 'T00:00:00Z') - prev, 86400000, 'no gaps');
  }
});

test('a malformed or missing timestamp never throws and never lands in a flow', () => {
  const rows = [
    order({ total: 100, created_at: null }),
    order({ total: 200, created_at: 'not a date' }),
    // a VALID created_at, so the flow has something legitimate to count and the
    // assertion below distinguishes "excluded" from "everything is excluded"
    order({ total: 300, created_at: '2026-09-05T06:00:00Z', paid: true, paid_at: 'nonsense' }),
  ];
  const m = M(rows, { rangeFrom: 0, rangeTo: Date.parse('2030-01-01T00:00:00Z') });
  assert.equal(m.money.grossSales, 600, 'balances are unaffected by a bad date');
  assert.equal(m.flows.sales.amount, 300, 'only the row with a parseable created_at');
  assert.equal(m.money.collected.amount, 300, 'it is still collected money');
  assert.equal(m.money.collectedUnknownDate.amount, 300, 'an unparseable paid_at is UNKNOWN');
  assert.equal(m.flows.collected.amount, 0, 'and never enters the dated flow');
});

// ── E. zero and negative totals ──────────────────────────────────────────────

test('a zero-total lead counts as an order but not as revenue, and never dilutes AOV', () => {
  const rows = [order({ total: 0 }), order({ total: 100 }), order({ total: 300 })];
  const m = M(rows);
  assert.equal(m.population.saleOrders.count, 3, 'it is still an order the merchant received');
  assert.equal(m.population.revenueOrders.count, 2);
  assert.deepEqual(m.population.excluded.enquiry, { count: 1, amount: 0 });
  assert.equal(m.money.grossSales, 400);
  assert.equal(m.money.averageOrderValue, 200, '400/2, not 400/3');
});

test('a negative total is treated as an enquiry, not as negative revenue', () => {
  const m = M([order({ total: -50 }), order({ total: 100 })]);
  assert.equal(m.money.grossSales, 100, 'a negative total never reduces gross sales');
  assert.equal(m.population.excluded.enquiry.count, 1);
  assert.equal(m.population.revenueOrders.count, 1);
  assert.deepEqual(checkInvariants(m), []);
});

test('an enquiry never appears in collected, outstanding or written off', () => {
  const m = M([order({ total: 0, paid: true }), order({ total: 0, awb: 'A', shipment_outcome: 'returned' })]);
  assert.equal(m.money.collected.count, 0);
  assert.equal(m.money.outstanding.count, 0);
  assert.equal(m.money.writtenOff.count, 0);
  // ...but a zero-value parcel is still a shipment on the board
  assert.equal(m.delivery.orders.count, 1);
});

test('AOV is zero when there are no revenue orders, never NaN', () => {
  assert.equal(M([]).money.averageOrderValue, 0);
  assert.equal(M([order({ total: 0 })]).money.averageOrderValue, 0);
});

// ── F. purity and determinism ────────────────────────────────────────────────

test('the module does not mutate its input', () => {
  const rows = FIXTURE.slice(0, 50).map((o) => ({ ...o }));
  const before = JSON.stringify(rows);
  buildCommerceMetrics(rows, { rangeFrom: 0, rangeTo: Date.now() });
  assert.equal(JSON.stringify(rows), before);
});

test('row order does not change any aggregate', () => {
  const shuffled = [...FIXTURE];
  // deterministic shuffle, so a failure is reproducible
  let seed = 42;
  for (let i = shuffled.length - 1; i > 0; i--) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    const j = seed % (i + 1);
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  assert.deepEqual(M(shuffled), M(FIXTURE));
});

test('the same input twice gives byte-identical output', () => {
  const a = M(FIXTURE, { now: 1, rangeFrom: 0, rangeTo: 2 });
  const b = M(FIXTURE, { now: 1, rangeFrom: 0, rangeTo: 2 });
  assert.deepEqual(a, b);
});

test('it handles an empty or malformed input without throwing', () => {
  for (const input of [[], null, undefined, 'nonsense', 42, {}]) {
    const m = buildCommerceMetrics(input);
    assert.equal(m.money.grossSales, 0);
    assert.deepEqual(checkInvariants(m), []);
  }
});

test('the module contains NO clock read at all', () => {
  // Stronger than "the answer does not change with now": there is no Date.now()
  // in the source, so the module cannot depend on the time even by accident.
  const src = readFileSync(
    fileURLToPath(new URL('../src/utils/commerceMetrics.js', import.meta.url)), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
  assert.equal(/Date\.now\s*\(/.test(src), false, 'no Date.now()');
  assert.equal(/new Date\(\s*\)/.test(src), false, 'no new Date() with no argument');
  // ...and the balances are identical whatever the caller thinks the time is.
  assert.deepEqual(M(FIXTURE).money, M(FIXTURE, { rangeFrom: 0, rangeTo: 1 }).money);
});

test('the module imports nothing from the app, and touches no I/O', () => {
  // Comments stripped: the module's own header says "no network, no Supabase,
  // no React" in prose, and the assertion is about what executes.
  const src = readFileSync(
    fileURLToPath(new URL('../src/utils/commerceMetrics.js', import.meta.url)), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
  assert.equal(/^import\s/m.test(src), false, 'no imports at all');
  for (const forbidden of ['supabase', 'fetch(', 'require(', 'react', 'window.', 'document.',
                           'localStorage', 'process.env']) {
    assert.equal(src.toLowerCase().includes(forbidden.toLowerCase()), false,
      `the module must not reference ${forbidden}`);
  }
});

// ── G. invariants over generated data ────────────────────────────────────────

test('the invariants hold across a large generated mix of adversarial rows', () => {
  const statuses = ['new', 'confirmed', 'dispatched', 'delivered', 'cancelled', 'abandoned'];
  const methods = ['cod', 'online', '', null];
  const ships = [null, '', 'Delivered', 'RTO Delivered', 'In Transit', 'Not Contactable',
                 'rto', 'returned to seller', 'lost', 'Undelivered', 'Manifested'];
  const outcomes = [null, 'delivered', 'returned', 'lost'];
  const totals = [0, -10, 1, 100, 99999.99];
  const rows = [];
  let seed = 7;
  const pick = (arr) => { seed = (seed * 1103515245 + 12345) % 2147483648; return arr[seed % arr.length]; };
  for (let i = 0; i < 2000; i++) {
    rows.push(order({
      id: `g-${i}`,
      status: pick(statuses),
      payment_method: pick(methods),
      total: pick(totals),
      paid: pick([true, false, null]),
      paid_at: pick([null, '2026-09-10T06:00:00Z', 'rubbish']),
      paid_via: pick([null, 'cod_delivery', 'razorpay', 'payment_link', 'seller']),
      payment_ref: pick([null, 'pay_1']),
      awb: pick([null, '', 'AWB1']),
      shipment_status: pick(ships),
      shipment_outcome: pick(outcomes),
      delivered_at: pick([null, '2026-09-11T06:00:00Z']),
      returned_at: pick([null, '2026-09-12T06:00:00Z']),
      created_at: pick([null, '2026-09-10T18:31:00Z', '2026-09-10T18:29:00Z']),
    }));
  }
  const m = M(rows, { rangeFrom: Date.parse('2026-09-01T00:00:00Z'),
                      rangeTo: Date.parse('2026-09-30T00:00:00Z') });
  assert.deepEqual(checkInvariants(m), []);
  // and the partitions are exact on generated data too
  assert.equal(m.money.collected.count + m.money.outstanding.count + m.money.writtenOff.count,
    m.population.revenueOrders.count);
  assert.equal(m.delivery.delivered.count + m.delivery.returned.count + m.delivery.inFlight.count,
    m.delivery.orders.count);
});

test('checkInvariants actually reports a violation when one exists', () => {
  // A guard that can never fail is worth nothing -- the lesson from the PR 11
  // and 12 reviews, applied to the invariant checker itself.
  const m = M(FIXTURE);
  const broken = JSON.parse(JSON.stringify(m));
  broken.money.collected.amount += 1;
  assert.ok(checkInvariants(broken).length > 0, 'a broken identity must be reported');
  broken.money.collected.amount -= 1;
  assert.deepEqual(checkInvariants(broken), []);
  const brokenDelivery = JSON.parse(JSON.stringify(m));
  brokenDelivery.delivery.delivered.count += 1;
  assert.ok(checkInvariants(brokenDelivery).length > 0);
});

// ── H. scope: nothing is wired up ────────────────────────────────────────────

test('no screen consumes the module yet', () => {
  for (const f of ['src/components/manage/OverviewTab.jsx', 'src/components/manage/OrdersTab.jsx',
                   'src/components/manage/PaymentsTab.jsx', 'src/components/manage/DeliveryBoard.jsx',
                   'src/components/manage/AnalyticsTab.jsx', 'src/utils/overviewStats.js',
                   'src/utils/paymentsLedger.js', 'src/utils/orderService.js']) {
    const src = readFileSync(fileURLToPath(new URL(`../${f}`, import.meta.url)), 'utf8');
    assert.equal(/commerceMetrics/.test(src), false, `${f} must not consume the model yet`);
  }
});

test('classifyBucket is still presentation-only and is not used for accounting', () => {
  const src = readFileSync(
    fileURLToPath(new URL('../src/utils/commerceMetrics.js', import.meta.url)), 'utf8');
  assert.equal(/classifyBucket/.test(src), false,
    'the accounting model must not depend on the layout classifier');
});

// ── I. parity with the SQL classifier ────────────────────────────────────────
//
// shipmentState() and the database's shipment_outcome_of() must agree on every
// courier string production actually contains, or the trigger and the dashboard
// will book different money. The fixture is every DISTINCT shipment_status in
// public.orders, with the outcome SQL assigns it.

const COURIER_STRINGS = JSON.parse(readFileSync(
  fileURLToPath(new URL('./fixtures/shipment-status-strings.json', import.meta.url)), 'utf8'));

test('shipmentState agrees with the SQL classifier on every real courier string', () => {
  const disagreements = [];
  for (const { shipment_status, sql_outcome } of COURIER_STRINGS) {
    // SQL returns 'delivered' | 'returned' | 'lost' | '' (null). 'lost' and
    // 'returned' are one state here, because both mean the money is not coming.
    const expected = sql_outcome === 'delivered' ? 'delivered'
      : (sql_outcome === 'returned' || sql_outcome === 'lost') ? 'returned'
        : 'in_flight';
    const got = shipmentState(order({ awb: 'A', shipment_status, shipment_outcome: null }));
    if (got !== expected) disagreements.push(`${JSON.stringify(shipment_status)}: sql=${sql_outcome || 'null'} js=${got}`);
  }
  assert.deepEqual(disagreements, []);
});

test('the courier-string fixture covers the strings production actually has', () => {
  assert.ok(COURIER_STRINGS.length >= 20, `only ${COURIER_STRINGS.length} strings captured`);
  const set = new Set(COURIER_STRINGS.map((s) => s.shipment_status));
  for (const o of FIXTURE) assert.ok(set.has(String(o.shipment_status ?? '')),
    `fixture row uses an uncaptured status: ${o.shipment_status}`);
});
