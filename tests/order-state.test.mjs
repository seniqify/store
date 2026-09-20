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

test('every sales total uses a shared rule, and never a private one', () => {
  // Screens not yet migrated share orderState's countsAsSale / isPaymentIncomplete.
  assert.match(read('src/components/manage/AnalyticsTab.jsx'), /const valid\s+= orders\.filter\(\(o\) => o\.status !== 'cancelled' && !isPaymentIncomplete\(o\)\);/);
  assert.match(read('src/utils/customers.js'), /const cancelled = o\.status === 'cancelled' \|\| isPaymentIncomplete\(o\);/);
  assert.match(read('src/pages/Console.jsx'), /const active = orders\.filter\(\(o\) => o\.status !== 'cancelled' && !isPaymentIncomplete\(o\)\);/);

  // Home moved to the canonical model in commerce-metrics PR 5, so it no longer
  // goes through countsAsSale - it goes through classifyOrder instead. What must
  // still hold is that it has not grown a rule of its own.
  const home = read('src/utils/overviewMetrics.js');
  assert.match(home, /classifyOrder/, 'Home takes eligibility from the canonical classifier');
  assert.equal(/status\s*!==\s*'cancelled'/.test(home), false, 'and defines no filter of its own');
  assert.equal(/isPaymentIncomplete/.test(home), false);
  // The old helper must not still carry a second copy of the rule.
  assert.equal(/countsAsSale/.test(read('src/utils/overviewStats.js')), false,
    'overviewStats is stock and reviews only now');
});

test('the order card never offers Accept for an unpaid online order', () => {
  const ot = read('src/components/manage/OrdersTab.jsx');
  assert.match(ot, /\{o\.status === 'new' && !payIncomplete && \(<Advance to="confirmed" label="✅ Accept order"/);
  assert.match(ot, /Payment not completed/);
});

test('Pay again reuses the order saved on the first attempt', () => {
  const f = read('src/components/form/CustomerDetailsForm.jsx');
  assert.match(f, /const retry = formData\.paymentMethod === 'online' && pendingPay\.current\?\.key === buyKey/);
  // `saved` is declared before the branch now, so the shadow observation below
  // can reuse the id on a Pay-again retry. Same order, same gating.
  assert.match(f, /let saved = retry \? retry\.orderId : null;\s*if \(!retry\) \{\s*saved = await saveOrder\(/);
  assert.equal(/Your order is saved — tap Pay again/.test(f), false, 'the customer must not be told a failed payment placed the order');
  assert.match(f, /pendingPay\.current = null;/);
});
