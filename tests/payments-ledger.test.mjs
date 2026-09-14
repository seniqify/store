import test from 'node:test';
import assert from 'node:assert/strict';
import { paymentKind, buildPayments, dayKey } from '../src/utils/paymentsLedger.js';

const DAY = 86400000;
// Noon today, so "today" and "yesterday" never straddle a midnight during the run.
const noon = (() => { const d = new Date(); d.setHours(12, 0, 0, 0); return d.getTime(); })();
const iso = (ms) => new Date(ms).toISOString();

test('paymentKind reads how the money stands', () => {
  assert.equal(paymentKind({ payment_method: 'online', paid: true, payment_ref: 'pay_1' }), 'online');
  assert.equal(paymentKind({ payment_method: 'online', paid: true, paid_via: 'payment_link', payment_ref: 'pay_2' }), 'link');
  assert.equal(paymentKind({ payment_method: 'cod', paid: true }), 'cod_collected');
  assert.equal(paymentKind({ payment_method: 'upi', paid: true }), 'marked');
  assert.equal(paymentKind({ payment_method: 'online', paid: true }), 'marked', 'online without a payment id was marked by hand');
  assert.equal(paymentKind({ payment_method: 'online', paid: false }), 'incomplete');
  assert.equal(paymentKind({ payment_method: 'cod', paid: false }), 'cod_due');
  assert.equal(paymentKind({ payment_method: 'cod', paid: true, status: 'cancelled' }), 'void');
});

test('received money is dated by paid_at and split online / COD / other', () => {
  const orders = [
    { id: 'a', total: 500, payment_method: 'online', paid: true, payment_ref: 'p', paid_at: iso(noon), created_at: iso(noon - 3 * DAY) },
    { id: 'b', total: 200, payment_method: 'cod', paid: true, paid_at: iso(noon - 60000), created_at: iso(noon - 2 * DAY) },
    { id: 'c', total: 99, payment_method: 'upi', paid: true, paid_at: iso(noon), created_at: iso(noon) },
    { id: 'd', total: 700, payment_method: 'cod', paid: true, paid_at: iso(noon - DAY) },   // yesterday
  ];
  const today = buildPayments(orders, { days: 1, now: noon });
  assert.deepEqual([today.received.online, today.received.cod, today.received.other, today.received.total], [500, 200, 99, 799]);
  assert.equal(today.ledger.length, 1);
  assert.equal(today.ledger[0].total, 799);

  const week = buildPayments(orders, { days: 7, now: noon });
  assert.equal(week.received.total, 1499);
  assert.equal(week.ledger.length, 7);
  assert.equal(week.ledger.find((r) => r.key === dayKey(noon - DAY)).cod, 700);
});

test('an order paid before paid_at existed falls back to its order date', () => {
  const r = buildPayments([{ id: 'x', total: 300, payment_method: 'cod', paid: true, paid_at: null, created_at: iso(noon) }], { days: 1, now: noon });
  assert.equal(r.received.cod, 300);
  assert.equal(r.recent[0].timeKnown, false);
});

test('COD still to collect counts every open COD order, whatever its date', () => {
  const r = buildPayments([
    { id: '1', total: 150, payment_method: 'cod', paid: false, created_at: iso(noon - 20 * DAY) },
    { id: '2', total: 250, payment_method: 'cod', paid: false, created_at: iso(noon) },
    { id: '3', total: 999, payment_method: 'cod', paid: false, status: 'cancelled', created_at: iso(noon) },
  ], { days: 1, now: noon });
  assert.deepEqual(r.codDue, { amount: 400, count: 2 });
});

test('needs attention: open link, unfinished online payment, delivered COD not collected', () => {
  const r = buildPayments([
    { id: 'link', total: 400, payment_method: 'cod', paid: false, payment_link_id: 'plink_1', created_at: iso(noon - 3000) },
    { id: 'inc', total: 300, payment_method: 'online', paid: false, created_at: iso(noon - 2000) },
    { id: 'dlv', total: 200, payment_method: 'cod', paid: false, status: 'delivered', created_at: iso(noon - 1000) },
    { id: 'shp', total: 100, payment_method: 'cod', paid: false, shipment_status: 'Delivered', created_at: iso(noon - 500) },
    { id: 'undel', total: 100, payment_method: 'cod', paid: false, shipment_status: 'Undelivered', created_at: iso(noon) },
    { id: 'transit', total: 100, payment_method: 'cod', paid: false, status: 'dispatched', created_at: iso(noon) },
  ], { days: 1, now: noon });
  const reasons = Object.fromEntries(r.attention.map((a) => [a.order.id, a.reason]));
  assert.deepEqual(reasons, { link: 'link_pending', inc: 'incomplete', dlv: 'cod_delivered', shp: 'cod_delivered' });
});

test('enquiries and cancelled orders carry no money', () => {
  const r = buildPayments([
    { id: 'lead', total: 0, payment_method: '', paid: false, created_at: iso(noon) },
    { id: 'can', total: 500, payment_method: 'online', paid: true, payment_ref: 'p', status: 'cancelled', paid_at: iso(noon) },
  ], { days: 1, now: noon });
  assert.equal(r.received.total, 0);
  assert.equal(r.attention.length, 0);
});
