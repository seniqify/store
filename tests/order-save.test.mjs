// A customer must never pay for an order that was not saved (2026-09-09: Rs 1,170
// captured on Razorpay, order row missing). supabase-js returns errors instead of
// throwing, so every order save has to read `error`. Pinned against the source.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (p) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), 'utf8').replace(/\r\n/g, '\n');
const SERVICE = read('src/utils/orderService.js');
const FORM = read('src/components/form/CustomerDetailsForm.jsx');
const OTP = read('supabase/functions/send-otp/index.ts');
const LINK = read('supabase/functions/payments-link/index.ts');
const CLIENT = read('src/utils/paymentLinks.js');
const TAB = read('src/components/manage/PaymentsTab.jsx');

const saveOrderBody = SERVICE.slice(SERVICE.indexOf('export async function saveOrder'),
  SERVICE.indexOf('\n}\n', SERVICE.indexOf('export async function saveOrder')));

test('saveOrder reads the insert error and only reports success when the row landed', () => {
  assert.match(saveOrderBody, /const \{ error \} = await supabase\.from\('orders'\)\.insert\(row\)/);
  assert.match(saveOrderBody, /if \(!error \|\| error\.code === '23505'\) return rowId \|\| null;/);
  assert.match(saveOrderBody, /attempt < 2/, 'retries once');
  assert.match(saveOrderBody, /return null;\s*$/, 'a refused save returns null');
  assert.equal(/await supabase\.from\('orders'\)\.insert\([^)]*\);\s*return rowId/.test(saveOrderBody), false,
    'must not return the id without checking the insert');
});

test('checkout does not start an online payment when the order did not save', () => {
  const at = FORM.indexOf('const saved = await saveOrder(');
  const pay = FORM.indexOf('await payOnline(');
  assert.ok(at > 0 && pay > at, 'save is checked before payment starts');
  const guard = FORM.slice(at, pay);
  assert.match(guard, /if \(!saved && formData\.paymentMethod === 'online'\) \{[\s\S]*?setPayError\([\s\S]*?return;/);
});

test('order-notify safety net checks its upsert error', () => {
  assert.match(OTP, /const \{ error: saveErr \} = await supabase\.from\('orders'\)\.upsert\(order,/);
  assert.match(OTP, /if \(saveErr\) console\.error/);
  assert.equal(/^\s*await supabase\.from\('orders'\)\.upsert\(order/m.test(OTP), false);
});

test('payments-link finds captured payments whose order never saved, behind the PIN', () => {
  const orphans = LINK.indexOf("if (action === 'orphans')");
  assert.ok(orphans > LINK.indexOf("rpc('verify_store_pin'"), 'orphans runs after the PIN check');
  const body = LINK.slice(orphans, LINK.indexOf("if (action === 'create')"));
  assert.match(body, /p\?\.status === 'captured'/);
  assert.match(body, /notes\?\.order_row_id/);
  assert.match(body, /\.eq\('store_slug', slug\)\.in\('payment_ref'/, 'recorded payments are skipped');
  assert.equal(/\.(update|insert|upsert|delete)\(/.test(body), false, 'read-only: never changes orders');
});

test('Payments tab asks for orphans and shows them', () => {
  assert.match(CLIENT, /export async function findPaymentOrphans\(slug, pin\)/);
  assert.match(TAB, /findPaymentOrphans\(slug, pin\)/);
  assert.match(TAB, /Paid on Razorpay, but the order didn’t save/);
});
