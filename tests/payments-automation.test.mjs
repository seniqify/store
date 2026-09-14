// Automatic COD / payment status, pinned against the source.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { classifyBucket } from '../src/utils/deliveryStatus.js';

const read = (p) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), 'utf8').replace(/\r\n/g, '\n');
const SQL    = read('supabase/payments-automation.sql');
const VER    = read('supabase/payments-automation-verify.sql');
const SWEEP  = read('supabase/functions/status-sweep/index.ts');
const SYNC   = read('supabase/functions/shipping-sync/index.ts');
const OPS    = read('supabase/functions/shipping-ops/index.ts');
const LINK   = read('supabase/functions/payments-link/index.ts');
const TAB    = read('src/components/manage/PaymentsTab.jsx');

/** The source text of a named top-level function. */
function fnText(src, name) {
  const at = src.indexOf(`function ${name}(`);
  assert.notEqual(at, -1, `${name} not found`);
  const open = src.indexOf('{', src.indexOf(')', at));
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(at, i + 1);
  }
  throw new Error(`unbalanced ${name}`);
}

test('the scheduled sweep refuses to run without the secret, before any work', () => {
  const gate = SWEEP.indexOf("req.headers.get('x-sweep-secret')");
  const firstWork = SWEEP.indexOf("from('store_shipping_accounts')");
  assert.ok(gate > -1 && firstWork > gate);
  assert.match(SWEEP, /expected\.length < 48/);
  assert.match(SWEEP, /diff \|= expected\.charCodeAt\(i\) \^ got\.charCodeAt\(i\)/, 'constant-time compare');
});

test('the sweep and the seller functions share identical courier and Razorpay rules', () => {
  for (const name of ['isTerminal', 'delhiveryStatusText']) {
    assert.equal(fnText(SWEEP, name), fnText(SYNC, name), `${name} drifted from shipping-sync`);
  }
  for (const name of ['linkIsPaidFor', 'checkoutIsPaidFor', 'toPaise']) {
    assert.equal(fnText(SWEEP, name), fnText(LINK, name), `${name} drifted from payments-link`);
  }
  assert.equal(fnText(OPS, 'delhiveryStatusText'), fnText(SYNC, 'delhiveryStatusText'));
});

test('"Out For Delivery" is no longer treated as finished, so it keeps refreshing', () => {
  const isTerminal = new Function(`${fnText(SYNC, 'isTerminal').replace(/: string/g, '').replace('): boolean', ')')}; return isTerminal;`)();
  assert.equal(isTerminal('Out For Delivery'), false);
  assert.equal(isTerminal('Bag In Transit'), false);
  assert.equal(isTerminal('Undelivered'), false);
  for (const s of ['Delivered', 'Returned To Seller', 'RTO', 'In RTO/RTS Process', 'Cancelled', 'Lost']) {
    assert.equal(isTerminal(s), true, s);
  }
});

test('Delhivery returns keep their return marker in the saved status', () => {
  const f = new Function(`${fnText(SYNC, 'delhiveryStatusText').replace(/: any/g, '').replace('): string', ')')}; return delhiveryStatusText;`)();
  assert.equal(f({ Status: 'Delivered', StatusType: 'DL' }), 'Delivered');
  assert.equal(f({ Status: 'Delivered', StatusType: 'RT' }), 'RTO Delivered');
  assert.equal(f({ Status: 'In Transit', StatusType: 'RT' }), 'RTO In Transit');
  assert.equal(f({ Status: 'RTO', StatusType: 'RT' }), 'RTO');
  assert.match(SYNC, /const st {2}= delhiveryStatusText\(s\?\.Shipment\?\.Status\);/);
  assert.match(OPS, /const st {3}= delhiveryStatusText\(shp\?\.Status\) \|\| null;/);
});

test('the delivery board puts returns under attention, never under delivered', () => {
  assert.equal(classifyBucket({ shipment_status: 'RTO Delivered' }), 'attention');
  assert.equal(classifyBucket({ shipment_status: 'Returned To Seller' }), 'attention');
  assert.equal(classifyBucket({ shipment_status: 'Delivered' }), 'delivered');
});

test('the database reads returned before delivered, and acts only on a change', () => {
  const reader = /create or replace function public\.shipment_outcome_of[\s\S]*?\$function\$;/.exec(SQL)[0];
  const ret = reader.indexOf("'returned'");
  const del = reader.indexOf("then 'delivered'");
  assert.ok(ret > -1 && del > ret, 'returned is tested first');
  assert.match(SQL, /if TG_OP = 'UPDATE' and OLD\.shipment_outcome is not distinct from v_out then\s+return NEW;/);
  assert.match(SQL, /before insert or update of status, shipment_status on public\.orders/);
  assert.match(SQL, /NEW\.paid_via := 'cod_delivery';/);
  assert.match(SQL, /if NEW\.paid_via = 'cod_delivery' then\s+NEW\.paid {5}:= false;/);
});

test('history is brought up to date before the trigger exists, without inventing times', () => {
  const backfill = SQL.indexOf('update public.orders o');
  const trigger = SQL.indexOf('create trigger orders_payment_automation');
  assert.ok(backfill > -1 && trigger > backfill);
  const block = SQL.slice(backfill, SQL.indexOf(';', backfill));
  assert.equal(/paid_at|delivered_at|returned_at|now\(\)/.test(block), false, 'no times stamped on history');
});

test('checkout keeps working: the outcome reader is not revoked from anon', () => {
  const code = SQL.replace(/--[^\n]*/g, '');   // comments explain the choice; only statements count
  assert.equal(/revoke[^;]*shipment_outcome_of/i.test(code), false);
  assert.match(VER, /U3\.3 checkout \(anon\) can still write orders/);
});

test('the secret is locked away from every client role', () => {
  assert.match(SQL, /alter table public\.automation_secrets enable row level security;/);
  assert.match(SQL, /revoke all on public\.automation_secrets from public, anon, authenticated;/);
});

test('the Payments tab has no manual collection step and refreshes itself', () => {
  assert.equal(/Mark collected|markCollected|setOrderPaid/.test(TAB), false);
  assert.match(TAB, /syncDeliveryStatuses\(slug, pin\)/);
  assert.match(TAB, /reconcileOnlinePayments\(slug, pin\)/);
});

test('payments-link can confirm checkout payments for the seller, PIN first', () => {
  const at = LINK.indexOf("if (action === 'reconcile')");
  const pin = LINK.indexOf("rpc('verify_store_pin'");
  assert.ok(at > pin && pin > -1);
  assert.match(LINK, /settleCheckout\(supabase, auth, order\)/);
});
