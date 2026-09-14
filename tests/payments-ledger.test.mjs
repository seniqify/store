import test from 'node:test';
import assert from 'node:assert/strict';
import { paymentKind, buildPayments, dayKey, isReturned } from '../src/utils/paymentsLedger.js';

const DAY = 86400000;
// Noon today, so "today" and "yesterday" never straddle a midnight during the run.
const noon = (() => { const d = new Date(); d.setHours(12, 0, 0, 0); return d.getTime(); })();
const iso = (ms) => new Date(ms).toISOString();

test('paymentKind reads how the money stands, with no manual step for COD', () => {
  assert.equal(paymentKind({ payment_method: 'online', paid: true, payment_ref: 'pay_1' }), 'online');
  assert.equal(paymentKind({ payment_method: 'online', paid: true, paid_via: 'payment_link', payment_ref: 'p' }), 'link');
  assert.equal(paymentKind({ payment_method: 'cod', paid: true, paid_via: 'cod_delivery' }), 'cod_collected');
  assert.equal(paymentKind({ payment_method: 'cod', paid: true }), 'cod_collected');
  assert.equal(paymentKind({ payment_method: 'upi', paid: true }), 'marked');
  assert.equal(paymentKind({ payment_method: 'online', paid: false }), 'incomplete');
  assert.equal(paymentKind({ payment_method: 'cod', paid: false }), 'cod_due');
  assert.equal(paymentKind({ payment_method: 'cod', paid: false, shipment_outcome: 'returned' }), 'cod_returned');
  assert.equal(paymentKind({ payment_method: 'cod', paid: false, shipment_status: 'Returned To Seller' }), 'cod_returned');
  assert.equal(paymentKind({ payment_method: 'cod', paid: true, status: 'cancelled' }), 'void');
});

test('isReturned matches the real courier texts, and not deliveries', () => {
  for (const s of ['Returned To Seller', 'Returned To Client', 'In Transit for Return', 'In RTO/RTS Process', 'RTO', 'rts_d', 'Lost']) {
    assert.equal(isReturned({ shipment_status: s }), true, s);
  }
  for (const s of ['Delivered', 'Out For Delivery', 'Bag In Transit', 'Not Contactable', 'Pending', '']) {
    assert.equal(isReturned({ shipment_status: s }), false, s);
  }
});

test('received money is dated by when it arrived, split online / COD / other', () => {
  const orders = [
    { id: 'a', total: 500, payment_method: 'online', paid: true, payment_ref: 'p', paid_at: iso(noon), created_at: iso(noon - 3 * DAY) },
    { id: 'b', total: 200, payment_method: 'cod', paid: true, paid_via: 'cod_delivery', paid_at: iso(noon - 60000), created_at: iso(noon - 2 * DAY) },
    { id: 'c', total: 99, payment_method: 'upi', paid: true, paid_at: iso(noon), created_at: iso(noon) },
    { id: 'd', total: 700, payment_method: 'cod', paid: true, paid_via: 'cod_delivery', paid_at: iso(noon - DAY) },
  ];
  const today = buildPayments(orders, { days: 1, now: noon });
  assert.deepEqual([today.received.online, today.received.cod, today.received.other, today.received.total], [500, 200, 99, 799]);
  const week = buildPayments(orders, { days: 7, now: noon });
  assert.equal(week.received.total, 1499);
  assert.equal(week.ledger.length, 7);
  assert.equal(week.ledger.find((r) => r.key === dayKey(noon - DAY)).cod, 700);
});

test('history collected before times were recorded falls back to the order date', () => {
  const r = buildPayments([{ id: 'x', total: 300, payment_method: 'cod', paid: true, paid_via: 'cod_delivery', paid_at: null, created_at: iso(noon) }], { days: 1, now: noon });
  assert.equal(r.received.cod, 300);
  assert.equal(r.recent[0].timeKnown, false);
});

test('returned COD leaves "still to collect" and is totalled separately', () => {
  const r = buildPayments([
    { id: 'due', total: 150, payment_method: 'cod', paid: false, awb: 'A1', shipment_status: 'Bag In Transit', created_at: iso(noon - 20 * DAY) },
    { id: 'ret', total: 400, payment_method: 'cod', paid: false, shipment_outcome: 'returned', returned_at: iso(noon), created_at: iso(noon - 5 * DAY) },
    { id: 'can', total: 999, payment_method: 'cod', paid: false, status: 'cancelled', created_at: iso(noon) },
  ], { days: 1, now: noon });
  assert.deepEqual(r.codDue, { amount: 150, count: 1 });
  assert.deepEqual(r.returned, { amount: 400, count: 1 });
});

test('needs attention holds only what the system cannot finish: no "mark collected"', () => {
  const r = buildPayments([
    { id: 'link', total: 400, payment_method: 'cod', paid: false, payment_link_id: 'plink_1', created_at: iso(noon - 3000) },
    { id: 'inc', total: 300, payment_method: 'online', paid: false, created_at: iso(noon - 2000) },
    { id: 'nc', total: 200, payment_method: 'cod', paid: false, awb: 'A2', shipment_status: 'Not Contactable', created_at: iso(noon - 1000) },
    { id: 'transit', total: 100, payment_method: 'cod', paid: false, awb: 'A3', shipment_status: 'Out For Delivery', created_at: iso(noon) },
    { id: 'collected', total: 100, payment_method: 'cod', paid: true, paid_via: 'cod_delivery', status: 'delivered', created_at: iso(noon) },
  ], { days: 1, now: noon });
  const reasons = Object.fromEntries(r.attention.map((a) => [a.order.id, a.reason]));
  assert.deepEqual(reasons, { link: 'link_pending', inc: 'incomplete', nc: 'delivery_issue' });
  assert.equal(r.attention.some((a) => a.reason === 'cod_delivered'), false);
});
