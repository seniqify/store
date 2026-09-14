// A delivered online order that Razorpay has not confirmed is not a customer who
// "didn't complete payment" — and older checkouts (before payments were matched
// by receipt) must still be found on Razorpay. Found on Royal Foods & Spices,
// 2026-09-15: a Rs 900 Shadowfax-delivered order shown as "payment not completed".
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isPaymentIncomplete, isPaymentUnconfirmed, countsAsSale } from '../src/utils/orderState.js';
import { paymentKind, buildPayments } from '../src/utils/paymentsLedger.js';

const read = (p) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), 'utf8').replace(/\r\n/g, '\n');

/** Source of an async function from its declaration to its closing brace line. */
function asyncFnText(src, name) {
  const at = src.indexOf(`async function ${name}(`);
  assert.notEqual(at, -1, `${name} not found`);
  return src.slice(at, src.indexOf('\n}\n', at) + 2);
}

const delivered = { payment_method: 'online', paid: false, payment_ref: null, status: 'delivered',
  awb: 'SF38627159675', courier: 'shadowfax', shipment_status: 'Delivered', shipment_outcome: 'delivered',
  total: 900, created_at: new Date().toISOString() };

test('a shipped or delivered unpaid online order is unconfirmed, not incomplete', () => {
  assert.equal(isPaymentUnconfirmed(delivered), true);
  assert.equal(isPaymentIncomplete(delivered), false);
  assert.equal(isPaymentUnconfirmed({ payment_method: 'online', paid: false, status: 'dispatched' }), true);
  assert.equal(isPaymentUnconfirmed({ payment_method: 'online', paid: false, awb: 'X1', status: 'confirmed' }), true);
});

test('a customer who left the payment screen is still incomplete', () => {
  const left = { payment_method: 'online', paid: false, status: 'new' };
  assert.equal(isPaymentIncomplete(left), true);
  assert.equal(isPaymentUnconfirmed(left), false);
  assert.equal(countsAsSale(left), false);
});

test('paid, referenced or COD orders are neither', () => {
  for (const o of [
    { ...delivered, paid: true },
    { ...delivered, payment_ref: 'pay_1' },
    { ...delivered, payment_method: 'cod' },
  ]) {
    assert.equal(isPaymentUnconfirmed(o), false);
    assert.equal(isPaymentIncomplete(o), false);
  }
});

test('Payments tab: unconfirmed needs attention with its own label, and is not money received', () => {
  assert.equal(paymentKind(delivered), 'unconfirmed');
  const p = buildPayments([delivered], { days: 30 });
  assert.equal(p.received.total, 0);
  assert.deepEqual(p.attention.map((a) => a.reason), ['unconfirmed']);
  const tab = read('src/components/manage/PaymentsTab.jsx');
  assert.match(tab, /unconfirmed: +\{ label: 'Shipped, Razorpay payment not confirmed yet'/);
});

test('the Orders card says "Payment not confirmed" for it, not "Payment not completed"', () => {
  const ot = read('src/components/manage/OrdersTab.jsx');
  assert.match(ot, /payIncomplete \? '● Payment not completed' : payUnconfirmed \? '● Payment not confirmed'/);
});

test('both Razorpay checks find older checkouts by order id near the order time, identically', () => {
  const link = read('supabase/functions/payments-link/index.ts');
  const sweep = read('supabase/functions/status-sweep/index.ts');
  const a = asyncFnText(link, 'findCheckoutRazorpayOrder');
  const b = asyncFnText(sweep, 'findCheckoutRazorpayOrder');
  assert.ok(a.length > 200, 'finder present in payments-link');
  assert.equal(a, b, 'the two copies drifted apart');
  assert.match(a, /orders\?receipt=/);
  assert.match(a, /orders\?from=\$\{from\}&to=\$\{to\}&count=100&skip=\$\{skip\}/);
  assert.match(a, /String\(it\?\.notes\?\.order_row_id \?\? ''\) === String\(order\.id\)/);
  // A paid Razorpay order wins when several carry the same checkout.
  assert.match(a, /matches\.find\(\(it: any\) => it\?\.status === 'paid'\)/);
  // Found is not paid: the amount and status binding still decides.
  assert.match(link, /const rz = await findCheckoutRazorpayOrder\(auth, order\);\n  if \(!rz\) return 'not_found';\n  if \(!checkoutIsPaidFor\(rz, order\)\) return 'pending';/);
  const settle = asyncFnText(sweep, 'settleCheckout');
  assert.match(settle, /if \(!rz\) return `no_razorpay_order; /);
  assert.match(settle, /if \(!checkoutIsPaidFor\(rz, order\)\) \{/);
  assert.ok(settle.indexOf('checkoutIsPaidFor(rz, order)') < settle.indexOf("paid_via: 'razorpay'"), 'binding before marking paid');
});

test('the sweep reports what Razorpay said per order, without phone numbers or keys', () => {
  const sweep = read('supabase/functions/status-sweep/index.ts');
  assert.match(sweep, /checkouts\.push\(\{ store: acct\.store_slug, order_id: o\.id, result \}\);/);
  const evidence = asyncFnText(sweep, 'paymentEvidence');
  assert.equal(/key_secret|oauth_access_token/.test(evidence), false);
  // The phone is only compared, never put into the returned text.
  assert.equal(/\$\{phone\}|\$\{p\.contact\}|\$\{order\.customer_phone\}/.test(evidence), false);
});

test('both checks look back 60 days, so a delivered order paid weeks ago is confirmed', () => {
  assert.match(read('supabase/functions/payments-link/index.ts'), /Date\.now\(\) - 60 \* 86400000/);
  const sweep = read('supabase/functions/status-sweep/index.ts');
  assert.match(sweep, /const since60 = new Date\(Date\.now\(\) - 60 \* 86400000\)/);
  assert.match(sweep, /\.select\('id, store_slug, total, paid, status, created_at, customer_phone'\)/);
  assert.equal(/since7\b/.test(sweep), false);
});
