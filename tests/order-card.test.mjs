// The Orders card's "one next step" model (src/utils/orderCard.js) and its wiring
// in OrdersTab. The shop no longer moves an order by hand: where an order stands
// is read from what happened -- the buyer's WhatsApp confirmation or payment, the
// courier booking and the courier's own status (turned into delivered/returned,
// and delivered COD into paid, by the orders_payment_automation trigger), and the
// shop's own delivery boy.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  STAGE_TABS, orderStage, stageTab, tabCounts, confirmation, needsCallFirst, orderSteps, nextStep, paymentChip, courierProgress,
} from '../src/utils/orderCard.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const NOW = Date.parse('2026-10-05T10:00:00Z');
const ago = (min) => new Date(NOW - min * 60000).toISOString();
const order = (over = {}) => ({
  id: 'o1', status: 'new', payment_method: 'cod', paid: false, total: 340, created_at: ago(120),
  customer_name: 'Sanjay Shirkule', customer_phone: '9284074066', destination: 'Sokasan, Solapur', ...over,
});

// ── where an order stands ───────────────────────────────────────────────────

test('stage: read from what happened, in a fixed precedence', () => {
  const cases = [
    [{}, 'to_ship'],
    [{ status: 'confirmed' }, 'to_ship'],                                      // an old "Accepted" order
    [{ status: 'cancelled', awb: 'SF1', shipment_status: 'Delivered' }, 'cancelled'],
    [{ awb: 'SF1', shipment_status: 'In Transit' }, 'courier'],
    [{ awb: 'SF1', shipment_status: 'ofd' }, 'courier'],
    [{ awb: 'SF1', shipment_status: 'Delivered' }, 'delivered'],
    [{ awb: 'SF1', shipment_outcome: 'delivered' }, 'delivered'],
    [{ status: 'delivered' }, 'delivered'],                                    // own delivery, marked by the shop
    [{ awb: 'DL1', shipment_status: 'RTO Delivered' }, 'returned'],            // a return that says "delivered"
    [{ awb: 'SF1', shipment_outcome: 'returned' }, 'returned'],
    [{ awb: 'SF1', shipment_outcome: 'lost' }, 'returned'],
    [{ status: 'dispatched' }, 'with_rider'],
    [{ payment_method: 'online' }, 'not_paid'],                                // left the payment screen
    [{ payment_method: 'online', paid: true }, 'to_ship'],
    [{ payment_method: 'online', payment_ref: 'pay_1' }, 'to_ship'],
  ];
  for (const [over, want] of cases) assert.equal(orderStage(order(over)), want, JSON.stringify(over));
});

test('tabs: To ship / On the way / Delivered / Returned / Cancelled, every stage in exactly one', () => {
  assert.deepEqual(STAGE_TABS.map((t) => t.key), ['to_ship', 'on_the_way', 'delivered', 'returned', 'cancelled']);
  assert.equal(stageTab('not_paid'), 'to_ship');
  assert.equal(stageTab('courier'), 'on_the_way');
  assert.equal(stageTab('with_rider'), 'on_the_way');
  for (const s of ['to_ship', 'delivered', 'returned', 'cancelled']) assert.equal(stageTab(s), s);
  const rows = [order(), order({ awb: 'A', shipment_status: 'In Transit' }), order({ status: 'dispatched' }),
    order({ status: 'delivered' }), order({ status: 'cancelled' }), order({ payment_method: 'online' })];
  assert.deepEqual(tabCounts(rows), { to_ship: 2, on_the_way: 2, delivered: 1, returned: 0, cancelled: 1 });
  assert.deepEqual(tabCounts(null), { to_ship: 0, on_the_way: 0, delivered: 0, returned: 0, cancelled: 0 });
});

test('confirmation: WhatsApp, payment, an old Accept, or waiting for a COD buyer who was asked', () => {
  assert.deepEqual(confirmation(order({ customer_confirmed_at: ago(60) })), { done: true, waiting: false, how: 'on WhatsApp' });
  assert.equal(confirmation(order({ payment_method: 'upi', paid: true })).how, 'paid');
  assert.equal(confirmation(order({ status: 'confirmed' })).how, 'by you');
  assert.deepEqual(confirmation(order({ confirm_token: 't' })), { done: false, waiting: true, how: '' });
  assert.deepEqual(confirmation(order()), { done: false, waiting: false, how: '' }, 'never asked: not "waiting"');
  assert.equal(confirmation(order({ payment_method: 'upi', confirm_token: 't' })).waiting, false, 'only COD is asked');
});

test('call first: only an unconfirmed COD order, asked over 30 minutes ago, still to ship', () => {
  assert.equal(needsCallFirst(order({ confirm_token: 't' }), NOW), true);
  assert.equal(needsCallFirst(order({ confirm_token: 't', created_at: ago(20) }), NOW), false, 'still reading the message');
  assert.equal(needsCallFirst(order({ confirm_token: 't', customer_confirmed_at: ago(5) }), NOW), false);
  assert.equal(needsCallFirst(order(), NOW), false, 'never asked');
  assert.equal(needsCallFirst(order({ confirm_token: 't', awb: 'A', shipment_status: 'new' }), NOW), false, 'already shipped');
  assert.equal(needsCallFirst(order({ confirm_token: 't' }), null), false, 'no clock, no warning');
});

// ── the one next step ───────────────────────────────────────────────────────

test('next step: one button for what the shop has to do now', () => {
  const ctx = { courier: 'Shadowfax', pickup: false, canPayLink: true, canRequestPay: true, now: NOW };
  const step = (over, c = ctx) => nextStep(order(over), c);
  assert.deepEqual(step({ customer_confirmed_at: ago(60) }), { primary: 'book', alt: 'rider' });
  assert.deepEqual(step({ confirm_token: 't' }), { primary: 'book', alt: 'call' }, 'unconfirmed COD: call first');
  assert.deepEqual(step({}, { ...ctx, courier: null }), { primary: 'rider', alt: null }, 'no courier: own delivery');
  assert.deepEqual(step({}, { ...ctx, pickup: true }), { primary: 'picked_up', alt: null });
  assert.deepEqual(step({ payment_method: 'online' }), { primary: 'pay_link', alt: null });
  assert.deepEqual(step({ payment_method: 'online' }, { ...ctx, canPayLink: false }), { primary: 'request_pay', alt: null });
  assert.deepEqual(step({ payment_method: 'online' }, { ...ctx, canPayLink: false, canRequestPay: false }), { primary: null, alt: null });
  assert.deepEqual(step({ status: 'dispatched' }), { primary: 'delivered', alt: null });
  assert.deepEqual(step({ awb: 'A', shipment_status: 'In Transit' }), { primary: null, alt: null }, 'courier has it: nothing to do');
  assert.deepEqual(step({ awb: 'A', shipment_status: 'Not Contactable' }), { primary: null, alt: 'call' }, 'a delivery problem');
  assert.deepEqual(step({ status: 'delivered', payment_method: 'upi' }), { primary: 'received', alt: null });
  assert.deepEqual(step({ status: 'delivered', paid: true }), { primary: 'review', alt: null });
  assert.deepEqual(step({ status: 'cancelled' }), { primary: null, alt: 'restore' });
  assert.deepEqual(step({ awb: 'A', shipment_outcome: 'returned' }), { primary: null, alt: null });
  const kinds = new Set(['book', 'rider', 'picked_up', 'pay_link', 'request_pay', 'delivered', 'received', 'review', 'call', 'restore', null]);
  for (const over of [{}, { status: 'confirmed' }, { status: 'dispatched' }, { status: 'delivered' }, { awb: 'A' }]) {
    const s = step(over);
    assert.ok(kinds.has(s.primary) && kinds.has(s.alt), JSON.stringify(s));
  }
});

test('there is no Accept, no Out for delivery and no Send confirmation step any more', () => {
  const src = read('src/utils/orderCard.js');
  assert.ok(!/'accept'|'confirmed'\s*\)/.test(src.replace(/\/\*[\s\S]*?\*\//g, '')), 'no manual accept action');
  for (const o of [order(), order({ status: 'confirmed' }), order({ customer_confirmed_at: ago(9) })]) {
    const s = nextStep(o, { courier: 'Shadowfax', now: NOW });
    assert.notEqual(s.primary, 'accept');
    assert.notEqual(s.primary, 'dispatched');
  }
});

// ── progress, payment, courier words ────────────────────────────────────────

test('progress steps fill in from facts', () => {
  const st = (over) => orderSteps(order(over), () => 'x').map((s) => `${s.label}:${s.state}`).join(' ');
  assert.equal(st({ customer_confirmed_at: ago(60) }), 'Ordered:done Confirmed:done Shipped:now Delivered:pending');
  assert.equal(st({ confirm_token: 't' }), 'Ordered:done Confirmed:now Shipped:pending Delivered:pending');
  assert.equal(st({}), 'Ordered:done Confirmed:pending Shipped:now Delivered:pending');
  assert.equal(st({ payment_method: 'online' }), 'Ordered:done Paid:now Shipped:pending Delivered:pending');
  assert.equal(st({ awb: 'A', shipment_status: 'In Transit' }), 'Ordered:done Confirmed:done Shipped:done Delivered:now');
  assert.equal(st({ status: 'dispatched' }), 'Ordered:done Confirmed:done Shipped:done Delivered:now');
  assert.equal(st({ status: 'delivered' }), 'Ordered:done Confirmed:done Shipped:done Delivered:done');
  assert.equal(st({ awb: 'A', shipment_outcome: 'returned' }), 'Ordered:done Confirmed:done Shipped:done Returned:stop');
  const shipped = orderSteps(order({ awb: 'A', courier: 'shadowfax', shipment_status: 'ofd' }), () => '');
  assert.equal(shipped[2].sub, 'Shadowfax');
  assert.equal(shipped[3].sub, 'Out for delivery');
});

test('payment chip: paid (and how), not paid, returned, COD to collect', () => {
  assert.deepEqual(paymentChip(order({ paid: true, paid_via: 'cod_delivery' })), { tone: 'paid', text: 'Paid · cash collected' });
  assert.deepEqual(paymentChip(order({ paid: true, paid_via: 'razorpay' })), { tone: 'paid', text: 'Paid' });
  assert.deepEqual(paymentChip(order({ payment_method: 'online' })), { tone: 'bad', text: 'Not paid' });
  assert.deepEqual(paymentChip(order({ awb: 'A', shipment_outcome: 'returned' })), { tone: 'muted', text: 'Returned' });
  assert.deepEqual(paymentChip(order({ total: 2720 })), { tone: 'due', text: 'COD · collect ₹2,720' });
  assert.deepEqual(paymentChip(order({ payment_method: 'upi' })), { tone: 'due', text: 'Unpaid' });
});

test('courier words come from the Delivery board vocabulary', () => {
  assert.deepEqual(courierProgress(order({ awb: 'A', shipment_status: 'nc' })), { bucket: 'attention', label: 'Not contactable', problem: true });
  assert.equal(courierProgress(order({ awb: 'A', shipment_status: 'new' })).bucket, 'pickup');
  assert.equal(courierProgress(order({ awb: 'A', shipment_status: 'Cancelled' })).problem, true);
});

// ── wiring ──────────────────────────────────────────────────────────────────

test('OrdersTab: orders use the new card, leads keep theirs; nothing advances an order by hand', () => {
  const tab = read('src/components/manage/OrdersTab.jsx');
  const card = tab.slice(tab.indexOf('function OrderCard('), tab.indexOf('function ShipBlock('));
  assert.ok(card.length > 2000, 'the new card exists');
  assert.match(tab, /: <OrderCard key=\{o\.id\}[^>]*now=\{loadedAt\}/);
  assert.match(tab, /\? <LeadCard key=\{o\.id\}/);
  assert.ok(!/Accept order|Send confirmation to customer|Out for delivery"/.test(card), 'no manual Accept / Out for delivery / Send confirmation');
  assert.ok(!/<Advance /.test(card));
  for (const fn of ['nextStep(', 'orderSteps(', 'paymentChip(', 'orderStage(', 'needsCallFirst(']) assert.ok(card.includes(fn), fn);
  // Handing it to the delivery boy moves it to On the way; the database does the rest.
  assert.match(card, /onClick=\{\(\) => onStatus\(o\.id, 'dispatched'\)\}/);
  assert.match(tab, /if \(!leads\) refresh\(\);/, 'after a status change the row is read back (trigger-set paid / delivered_at)');
  // The paid chip still toggles by hand, and Unpaid still uses the shared predicate.
  assert.match(card, /onClick=\{\(\) => onPaid\(o\.id, !o\.paid\)\}/);
  assert.match(tab, /unpaidOnly \? isOrdersUnpaid\(o\)/);
  // Tabs.
  assert.match(tab, /stageTab\(orderStage\(o\)\) === filter/);
  assert.match(tab, /useState\(leads \? 'all' : 'to_ship'\)/);
});
