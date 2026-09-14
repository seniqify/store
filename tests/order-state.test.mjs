import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isPaymentIncomplete, countsAsSale } from '../src/utils/orderState.js';

const read = (p) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), 'utf8');

test('an online order nobody paid for is payment-incomplete', () => {
  assert.equal(isPaymentIncomplete({ payment_method: 'online', paid: false, payment_ref: null }), true);
  assert.equal(isPaymentIncomplete({ payment_method: 'Online', paid: false }), true);
});

test('paid, referenced, or not online is not payment-incomplete', () => {
  assert.equal(isPaymentIncomplete({ payment_method: 'online', paid: true }), false);
  assert.equal(isPaymentIncomplete({ payment_method: 'online', paid: false, payment_ref: 'pay_123' }), false);
  assert.equal(isPaymentIncomplete({ payment_method: 'cod', paid: false }), false);
  assert.equal(isPaymentIncomplete({ payment_method: '', paid: false }), false);
  assert.equal(isPaymentIncomplete({ payment_method: 'upi', paid: false }), false);
});

test('only real sales count', () => {
  assert.equal(countsAsSale({ status: 'new', payment_method: 'cod' }), true);
  assert.equal(countsAsSale({ status: 'new', payment_method: 'online', paid: true }), true);
  assert.equal(countsAsSale({ status: 'new', payment_method: 'online', paid: false }), false);
  assert.equal(countsAsSale({ status: 'cancelled', payment_method: 'cod' }), false);
  assert.equal(countsAsSale({ status: 'abandoned', payment_method: 'cod' }), false);
});

test('every sales total uses the shared rule', () => {
  assert.match(read('src/utils/overviewStats.js'), /const real\s+= orders\.filter\(countsAsSale\);/);
  assert.match(read('src/components/manage/AnalyticsTab.jsx'), /const valid\s+= orders\.filter\(\(o\) => o\.status !== 'cancelled' && !isPaymentIncomplete\(o\)\);/);
  assert.match(read('src/utils/customers.js'), /const cancelled = o\.status === 'cancelled' \|\| isPaymentIncomplete\(o\);/);
  assert.match(read('src/pages/Console.jsx'), /const active = orders\.filter\(\(o\) => o\.status !== 'cancelled' && !isPaymentIncomplete\(o\)\);/);
});

test('the order card never offers Accept for an unpaid online order', () => {
  const ot = read('src/components/manage/OrdersTab.jsx');
  assert.match(ot, /\{o\.status === 'new' && !payIncomplete && \(<Advance to="confirmed" label="✅ Accept order"/);
  assert.match(ot, /Payment not completed/);
});

test('Pay again reuses the order saved on the first attempt', () => {
  const f = read('src/components/form/CustomerDetailsForm.jsx');
  assert.match(f, /const retry = formData\.paymentMethod === 'online' && pendingPay\.current\?\.key === buyKey/);
  assert.match(f, /if \(!retry\) \{\s*const saved = await saveOrder\(/);
  assert.equal(/Your order is saved — tap Pay again/.test(f), false, 'the customer must not be told a failed payment placed the order');
  assert.match(f, /pendingPay\.current = null;/);
});
