// Online payments: the charge comes from the saved order, and "paid" is set only
// for the order and amount Razorpay confirms. These edge functions are Deno and
// call live Razorpay, so the rules are pinned against the source.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (p) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), 'utf8');
const CREATE = read('supabase/functions/payments-create-order/index.ts');
const VERIFY = read('supabase/functions/payments-verify/index.ts');
const CLIENT = read('src/utils/onlinePayment.js');

const TO_PAISE = /function toPaise\(rupees: unknown\): number \{\s*return Math\.round\(Number\(rupees\) \* 100\);\s*\}/;

test('create-order never takes the amount from the request', () => {
  assert.equal(/\bamount\b[^\n]*=\s*(await req\.json\(\)|body)/.test(CREATE), false);
  assert.equal(/body\??\.amount/.test(CREATE), false, 'body.amount must not be read');
  assert.match(CREATE, /const amount = toPaise\(order\.total\);/);
  assert.match(CREATE, /amount,\s+\/\/ paise, from the saved order/);
});

test('create-order loads the order for this store and refuses what cannot be paid', () => {
  assert.match(CREATE, /\.from\('orders'\)[\s\S]{0,120}\.eq\('id', orderRowId\)\s*\.eq\('store_slug', slug\)/);
  assert.match(CREATE, /order\.paid === true/);
  assert.match(CREATE, /order\.status === 'cancelled' \|\| order\.status === 'abandoned'/);
  assert.match(CREATE, /toLowerCase\(\) !== 'online'/);
  assert.match(CREATE, /amount < 100/);
});

test('create-order stamps the order row id into the Razorpay order', () => {
  assert.match(CREATE, /notes:\s*\{ store: slug, order_row_id: order\.id \}/);
});

test('verify still checks the signature before anything else', () => {
  const sig = VERIFY.indexOf('computed !== razorpay_signature');
  const fetchAt = VERIFY.indexOf('api.razorpay.com/v1/orders/');
  assert.ok(sig > -1 && fetchAt > -1 && sig < fetchAt);
});

test('verify binds the payment to this order and this amount before marking paid', () => {
  const notes  = VERIFY.indexOf("rzOrder.notes?.order_row_id");
  const amount = VERIFY.indexOf('Number(rzOrder.amount) !== toPaise(order.total)');
  const update = VERIFY.indexOf(".update({ paid: true");
  assert.ok(notes > -1 && amount > -1 && update > -1, 'all three checks present');
  assert.ok(notes < update && amount < update, 'both checks run before the update');
  assert.match(VERIFY, /if \(!slug \|\| !razorpay_order_id \|\| !razorpay_payment_id \|\| !razorpay_signature \|\| !order_row_id\)/);
  assert.equal((VERIFY.match(/\.update\(\{ paid: true/g) || []).length, 1, 'one place marks paid');
});

test('both functions convert rupees to paise the same way', () => {
  assert.match(CREATE, TO_PAISE);
  assert.match(VERIFY, TO_PAISE);
});

test('the browser no longer sends an amount to create the payment', () => {
  const invoke = /functions\.invoke\('payments-create-order',\s*\{\s*body:\s*\{([^}]*)\}/.exec(CLIENT);
  assert.ok(invoke, 'create-order call found');
  assert.equal(/\bamount\b/.test(invoke[1]), false, invoke[1]);
  assert.match(invoke[1], /order_row_id: orderRowId/);
});
