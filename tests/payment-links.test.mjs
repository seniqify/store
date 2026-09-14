// Payment links and payment times, pinned against the source (the edge function
// is Deno and calls live Razorpay; the SQL runs on Postgres).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { paymentLinkMessage } from '../src/utils/paymentLinkMessage.js';

const read = (p) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), 'utf8');
const FN  = read('supabase/functions/payments-link/index.ts');
const SQL = read('supabase/payments-tracking.sql');
const RB  = read('supabase/payments-tracking-rollback.sql');
const VER = read('supabase/payments-tracking-verify.sql');
const VERIFY_FN = read('supabase/functions/payments-verify/index.ts');

test('seller actions check the store PIN before touching any order', () => {
  const pin = FN.indexOf("rpc('verify_store_pin'");
  const confirmEnd = FN.indexOf("// ── Everything else is the seller");
  const firstSellerOrderRead = FN.indexOf(".from('orders')", confirmEnd);
  assert.ok(pin > confirmEnd && firstSellerOrderRead > pin, 'PIN check comes first for check/create');
  assert.match(FN, /if \(pinOk !== true\) return json\(\{ error:/);
});

test('the link amount comes from the saved order, never the request', () => {
  assert.match(FN, /const amount = toPaise\(order\.total\);/);
  assert.equal(/body\??\.amount/.test(FN), false);
  assert.match(FN, /notes: \{ store: slug, order_row_id: order\.id \}/);
});

test('an order already booked with a courier cannot be switched to prepaid', () => {
  assert.match(FN, /if \(order\.awb\) \{\s*return json\(\{ error:/);
});

test('an order becomes paid only when Razorpay reports the link paid for this order at this amount', () => {
  const guard = /function linkIsPaidFor\(link: any, order: any\): boolean \{([\s\S]*?)\n\}/.exec(FN)[1];
  assert.match(guard, /link\?\.status === 'paid'/);
  assert.match(guard, /link\?\.notes\?\.order_row_id \?\? ''\) === String\(order\.id\)/);
  assert.match(guard, /Number\(link\?\.amount\) === toPaise\(order\.total\)/);
  assert.match(guard, /Number\(link\?\.amount_paid\) >= Number\(link\?\.amount\)/);
  const check = FN.indexOf('if (linkIsPaidFor(link, order))');
  const update = FN.indexOf("paid_via: 'payment_link'");
  assert.ok(check > -1 && update > check);
  assert.equal((FN.match(/paid: true,\s*\n\s*paid_at:/g) || []).length, 1, 'one place marks an order paid');
});

test('a link payment makes the order prepaid and never overwrites a paid order', () => {
  assert.match(FN, /payment_method: 'online',/);
  assert.match(FN, /\.eq\('paid', false\);/);
});

test('confirm needs no PIN but reads the order by its token and trusts nothing from the request', () => {
  const at = FN.indexOf("if (action === 'confirm')");
  const block = FN.slice(at, FN.indexOf("// ── Everything else is the seller"));
  assert.match(block, /\.eq\('confirm_token', token\)/);
  assert.match(block, /settleFromRazorpay\(supabase, auth, order\)/);
  assert.equal(/body\?\.(amount|paid|order_id|status)/.test(block), false);
});

test('checkout payments record their time and source too', () => {
  assert.match(VERIFY_FN, /\.update\(\{ paid: true, paid_at: new Date\(\)\.toISOString\(\), paid_via: 'razorpay', payment_ref: razorpay_payment_id, payment_provider: 'razorpay' \}\)/);
});

test('set_order_paid keeps its signature and PIN throttle, and stamps time and source', () => {
  for (const [label, sql] of [['forward', SQL], ['rollback', RB]]) {
    assert.match(sql, /create or replace function public\.set_order_paid\(\s*p_slug text, p_hashed_pin text, p_order_id uuid, p_paid boolean\)/, label);
    assert.match(sql, /if public\.verify_store_pin\(p_slug, p_hashed_pin\) then/, label);
    assert.match(sql, /set search_path = public, pg_temp/, label);
    assert.match(sql, /security definer/, label);
    assert.equal((sql.match(/^begin;$/gm) || []).length, 1, label);
    assert.equal((sql.match(/^commit;$/gm) || []).length, 1, label);
  }
  assert.match(SQL, /paid_at\s+= case when p_paid then coalesce\(paid_at, now\(\)\) else null end/);
  assert.match(SQL, /paid_via = case when p_paid then coalesce\(paid_via, 'seller'\) else null end/);
  assert.match(SQL, /check \(paid_via is null or paid_via in \('razorpay', 'payment_link', 'seller'\)\)/);
  assert.equal(/drop column/i.test(SQL + RB), false, 'nothing is dropped');
});

test('the verification file is one read-only SELECT', () => {
  const code = VER.replace(/--[^\n]*/g, '').replace(/'(?:[^']|'')*'/g, "''");
  const found = ['create', 'insert', 'update', 'delete', 'grant', 'revoke', 'drop', 'alter', 'truncate', 'begin', 'commit']
    .filter((w) => new RegExp(`\\b${w}\\b`, 'i').test(code));
  assert.deepEqual(found, []);
  assert.equal((code.match(/;/g) || []).length, 1);
});

test('the WhatsApp message carries the link and the amount, no emoji', () => {
  const msg = paymentLinkMessage({ customerName: 'Asha Rao', storeName: 'Sankalp', total: 1250, url: 'https://rzp.io/l/abc' });
  assert.match(msg, /^Hi Asha,/);
  assert.match(msg, /₹1,250/);
  assert.ok(msg.includes('https://rzp.io/l/abc'));
  assert.equal(/\p{Extended_Pictographic}/u.test(msg), false);
});
