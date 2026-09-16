// Phase-2 SQL and the shadow endpoint, checked mechanically.
//
// None of this can be run from here: the SQL is pasted into production by hand
// and the endpoint is Deno. So these tests pin the properties a reviewer would
// otherwise have to hold in their head — above all that this phase changes
// NOTHING that is currently live, and that the new writer cannot be reached
// from a browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (p) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), 'utf8');

const FWD      = read('supabase/order-integrity-phase2-forward.sql');
const VERIFY   = read('supabase/order-integrity-phase2-verify.sql');
const ROLLBACK = read('supabase/order-integrity-phase2-ROLLBACK.sql');
const SHADOW   = read('supabase/functions/order-create/index.ts');

/** Strip -- comments, $tag$ blocks and '...' literals, leaving statements. */
function stripToCode(sql) {
  let out = '';
  for (let i = 0; i < sql.length; i++) {
    const tag = sql.slice(i).match(/^\$[a-z_]*\$/);
    if (tag) {
      const end = sql.indexOf(tag[0], i + tag[0].length);
      i = end === -1 ? sql.length : end + tag[0].length - 1;
      out += ' $BLOCK$ ';
    } else if (sql[i] === '-' && sql[i + 1] === '-') {
      while (i < sql.length && sql[i] !== '\n') i++;
      out += '\n';
    } else if (sql[i] === "'") {
      const end = sql.indexOf("'", i + 1);
      i = end === -1 ? sql.length : end;
      out += " 'LITERAL' ";
    } else {
      out += sql[i];
    }
  }
  return out;
}
const CODE = stripToCode(FWD);

// ── this phase must not disturb anything that is live ────────────────────────

test('the migration adds only — it drops and alters nothing existing', () => {
  assert.equal(/\bdrop\s+(table|trigger|policy|column)\b/i.test(CODE), false);
  assert.equal(/\balter\s+table\s+public\.orders\b/i.test(CODE), false);
  assert.equal(/drop\s+policy|orders_anon_insert/i.test(CODE), false,
    'the storefront path stays until a separate, later step');
  assert.equal(/trg_decrement_stock/i.test(CODE), false,
    'the old stock trigger stays until that same step');
});

test('it touches no payment, shipping or ads object', () => {
  for (const name of ['payments', 'razorpay', 'shipping', 'courier', 'meta_', 'capi', 'campaign']) {
    assert.equal(CODE.toLowerCase().includes(name), false, `${name} must not appear`);
  }
});

test('and the verify file proves the live path is still intact afterwards', () => {
  assert.match(VERIFY, /V5\.1 the storefront can still insert orders \(policy intact\)/);
  assert.match(VERIFY, /V5\.2 the old stock trigger is still in place/);
  assert.match(VERIFY, /V5\.3 the phase-1 payment guard is still in place/);
});

test('the forward file is one transaction and idempotent', () => {
  assert.equal((CODE.match(/\bbegin;/g) || []).length, 1);
  assert.equal((CODE.match(/\bcommit;/g) || []).length, 1);
  assert.ok(CODE.indexOf('begin;') < CODE.indexOf('commit;'));
  for (const t of ['order_requests', 'order_integrity', 'order_pricing_shadow']) {
    assert.ok(CODE.includes(`create table if not exists public.${t}`), t);
  }
});

// ── privilege and exposure ───────────────────────────────────────────────────

test('the three new tables are locked to the service role', () => {
  for (const t of ['order_requests', 'order_integrity', 'order_pricing_shadow']) {
    assert.ok(CODE.includes(`alter table public.${t}       enable row level security`)
           || CODE.includes(`alter table public.${t}      enable row level security`)
           || CODE.includes(`alter table public.${t} enable row level security`), `${t} RLS`);
    assert.match(CODE, new RegExp(`revoke all on public\\.${t}\\s+from anon, authenticated, public;`), t);
  }
  assert.equal(/create policy/i.test(CODE), false, 'no policy means no browser reach at all');
});

test('the writer is SECURITY INVOKER with a pinned search_path', () => {
  const fn = FWD.slice(FWD.indexOf('create or replace function public.create_order_secure'),
                       FWD.indexOf('revoke all on function public.create_order_secure'));
  assert.match(fn, /security invoker/);
  assert.match(fn, /set search_path = public, pg_temp/);
  assert.equal(/security definer/.test(fn), false,
    'the only caller is the service role, which already bypasses RLS');
});

test('the writer is callable only by the service role', () => {
  assert.match(CODE, /revoke all on function public\.create_order_secure\([\s\S]{0,120}\) from public;/);
  assert.match(CODE, /revoke all on function public\.create_order_secure\([\s\S]{0,120}\) from anon, authenticated;/);
  assert.match(CODE, /grant execute on function public\.create_order_secure\([\s\S]{0,120}\) to service_role;/);
  assert.equal(/grant execute on function public\.create_order_secure[^;]*to[^;]*anon/.test(CODE), false);
});

test('the fingerprint helper is service-role only too, and pinned', () => {
  const fn = FWD.slice(FWD.indexOf('create or replace function public.store_pricing_fingerprint'),
                       FWD.indexOf('revoke all on function public.store_pricing_fingerprint'));
  assert.match(fn, /security definer/, 'it reads stores, so it needs to be definer');
  assert.match(fn, /set search_path = public, pg_temp/);
  assert.match(fn, /\bstable\b/);
  assert.match(CODE, /grant execute on function public\.store_pricing_fingerprint\(text\) to service_role;/);
  assert.equal(/grant execute on function public\.store_pricing_fingerprint[^;]*to[^;]*anon/.test(CODE), false);
});

test('the writer has no parameter for a trusted field', () => {
  const sig = FWD.slice(FWD.indexOf('create or replace function public.create_order_secure'),
                        FWD.indexOf(') returns jsonb'));
  for (const bad of ['p_paid', 'p_status', 'p_payment_ref', 'p_payment_provider',
                     'p_paid_at', 'p_paid_via', 'p_awb', 'p_courier', 'p_total ']) {
    assert.equal(sig.includes(bad), false, `${bad} must not be a parameter`);
  }
  assert.match(sig, /p_totals\s+jsonb/, 'money arrives as the server-computed totals object');
});

// ── the transaction model ────────────────────────────────────────────────────

test('the writer runs reserve, lock, verify, check, decrement, insert, snapshot in order', () => {
  const fn = FWD.slice(FWD.indexOf('create or replace function public.create_order_secure'));
  const at = (needle) => {
    const i = fn.indexOf(needle);
    assert.ok(i > -1, `missing step: ${needle}`);
    return i;
  };
  const order = [
    at('insert into public.order_requests'),
    at('for update'),
    at('store_pricing_fingerprint'),
    at('out_of_stock'),
    at('update public.stores s'),
    at('insert into public.orders'),
    at('insert into public.order_integrity'),
  ];
  assert.deepEqual(order, [...order].sort((a, b) => a - b), 'the steps must be in this order');
});

test('availability is checked per PRODUCT, not per line — duplicate lines cannot oversell', () => {
  // Two lines of one unit each against a stock of one: checked line by line
  // both see 1 >= 1 and pass, then the decrement takes 2 and floors at 0,
  // shipping an order for stock that was never there. The check has to group
  // exactly the way the decrement groups.
  const fn = FWD.slice(FWD.indexOf('create or replace function public.create_order_secure'));
  const check = fn.slice(fn.indexOf('4. Availability'), fn.indexOf('5. Decrement'));

  assert.match(check, /group by item->>'productId'/, 'the check must aggregate per product');
  assert.match(check, /sum\(coalesce\(nullif\(item->>'qty', ''\)::numeric, 1\)\)/,
    'and must sum quantities the same way the decrement does');
  assert.equal(/for v_line in select \* from jsonb_array_elements\(p_items\) loop/.test(check), false,
    'the per-line loop is the bug');
});

test('the check and the decrement count quantities identically', () => {
  const fn = FWD.slice(FWD.indexOf('create or replace function public.create_order_secure'));
  const check = fn.slice(fn.indexOf('4. Availability'), fn.indexOf('5. Decrement'));
  const dec   = fn.slice(fn.indexOf('5. Decrement'), fn.indexOf('6. The order'));
  const qtyExpr = /sum\(coalesce\(nullif\(item->>'qty', ''\)::numeric, 1\)\)/;
  const groupBy = /group by item->>'productId'/;
  for (const [name, block] of [['check', check], ['decrement', dec]]) {
    assert.match(block, qtyExpr, `${name}: same quantity expression`);
    assert.match(block, groupBy, `${name}: same grouping`);
  }
});

test('a line with no product id is refused outright', () => {
  // It could decrement nothing, so it must not be orderable.
  const fn = FWD.slice(FWD.indexOf('create or replace function public.create_order_secure'));
  assert.match(fn, /raise exception 'line_without_product'/);
  assert.ok(fn.indexOf("raise exception 'line_without_product'") < fn.indexOf('update public.stores s'),
    'refused before anything is written');
});

test('stock is decremented by product id, and abandoned rows decrement nothing', () => {
  const fn = FWD.slice(FWD.indexOf('create or replace function public.create_order_secure'));
  assert.match(fn, /dec\.pid = prod->>'id'/);
  assert.equal(/dec\.name = prod->>'name'/.test(fn), false, 'matching by name is the old bug');
  assert.match(fn, /if v_status <> 'abandoned' then/);
});

test('the order row takes its money from the server totals only', () => {
  const fn = FWD.slice(FWD.indexOf('insert into public.orders'), FWD.indexOf('insert into public.order_integrity'));
  for (const col of ['subtotal', 'tax', 'shipping', 'packaging', 'codFee', 'total']) {
    assert.ok(fn.includes(`p_totals->>'${col}'`), `${col} must come from p_totals`);
  }
  assert.equal(/p_customer->>'(price|total|subtotal)'/.test(fn), false);
});

// ── rollback ─────────────────────────────────────────────────────────────────

test('the rollback removes only what this phase added', () => {
  const code = stripToCode(ROLLBACK);
  assert.match(code, /drop function if exists public\.create_order_secure/);
  assert.match(code, /drop function if exists public\.store_pricing_fingerprint\(text\)/);
  for (const t of ['order_pricing_shadow', 'order_requests', 'order_integrity']) {
    assert.ok(code.includes(`drop table if exists public.${t}`), t);
  }
  assert.equal(/orders_anon_insert|trg_decrement_stock|alter table public\.orders/i.test(code), false,
    'the live path is not in scope for this undo');
});

test('the verify file is read-only: one SELECT, no DDL', () => {
  const code = stripToCode(VERIFY);
  assert.equal(/\b(insert|update|delete|alter|drop|create|grant|revoke|truncate|begin|commit)\b/i.test(code), false);
  assert.equal((code.match(/;/g) || []).length, 1, 'exactly one statement');
  assert.match(code, /^\s*with /i);
});

// ── shadow mode: what it accepts, returns and records ────────────────────────

test('shadow mode returns nothing but ok — it is not a price oracle', () => {
  assert.match(SHADOW, /const OK\s*=\s*\{ ok: true \};/);
  assert.match(SHADOW, /return json\(OK\);/);
  const returns = [...SHADOW.matchAll(/return json\(([^)]*)\)/g)].map((m) => m[1].trim());
  for (const r of returns) {
    assert.ok(/^(OK|BAD_REQ)(,\s*\d+)?$/.test(r), `unexpected response shape: ${r}`);
  }
});

test('shadow mode never returns or logs anything merchant-private', () => {
  const logged = SHADOW.slice(SHADOW.indexOf(".from('order_pricing_shadow').insert("), SHADOW.indexOf('return json(OK)'))
    .replace(/\/\/.*$/gm, '');          // comments explain what is NOT logged; check the code
  for (const leak of ['cost', 'margin', 'packagingCost', 'deliveryCost', 'config', 'coupons',
                      'name:', 'products']) {
    assert.equal(logged.includes(leak), false, `${leak} must not be recorded`);
  }
  assert.equal(/reasons[\s\S]{0,200}coupon: quote\.ok \? quote\.coupon\.reason/.test(SHADOW), true,
    'only the coupon OUTCOME is recorded, never the coupon itself');
});

test('the comparison is against the saved row, never a number from the request', () => {
  assert.match(SHADOW, /from\('orders'\)\.select\('total'\)\.eq\('id', observedId\)/);
  assert.equal(/body\.(total|subtotal|amount)/.test(SHADOW), false,
    'server correctness must not depend on a browser total');
  assert.match(SHADOW, /read from the SAVED ROW rather than from/i, 'and the reason is written down');
});

test('price-bearing bodies are recorded in shadow mode, not yet refused', () => {
  assert.match(SHADOW, /const PRICE_FIELDS = \[/);
  assert.match(SHADOW, /priceFieldsSent: priceFieldsPresent\(body\)/);
  assert.equal(/priceFieldsPresent\(body\)[\s\S]{0,80}return json\(BAD_REQ/.test(SHADOW), false,
    'refusing them is the later step, once checkout is switched over');
});

test('the request is allowlisted before anything reads it', () => {
  assert.match(SHADOW, /function allowlist\(/);
  assert.ok(SHADOW.indexOf('const req0 = allowlist(body)') < SHADOW.indexOf('priceOrder('),
    'pricing only ever sees the allowlisted shape');
  const fn = SHADOW.slice(SHADOW.indexOf('function allowlist('), SHADOW.indexOf('/** Rate limits'));
  for (const bad of ['price', 'total', 'discount', 'gstRate']) {
    assert.equal(fn.includes(`${bad}:`), false, `${bad} must not survive the allowlist`);
  }
});

test('both rate budgets are measured, and the address is only ever a hash', () => {
  // One address hammering many stores, and many addresses hammering one store,
  // are different abuses; sizing either needs its own count.
  assert.match(SHADOW, /count\('ip_hash', ipHash\)/, 'per-address measurement');
  assert.match(SHADOW, /count\('store_slug', slug\)/, 'per-store measurement');
  assert.match(SHADOW, /return 'ip_10m'/);
  assert.match(SHADOW, /return 'store_10m'/);
  assert.match(SHADOW, /const ipHash = ip \? await sha256Short\(ip\) : null;/);
  assert.equal(/ip: ip|ip_address|callerIp\(req\),\s*$/m.test(SHADOW), false,
    'a raw address must never be logged');
  assert.match(FWD, /ip_hash        text,/, 'and the column exists to record it');
});

test('the shadow baseline is described as the browser figure, not as authoritative', () => {
  // db_total comes from the saved row, which makes it a trustworthy record of
  // what the old path produced — not a trustworthy price. That distinction is
  // the entire point of shadow mode.
  assert.equal(/[Bb]oth sides of this comparison are authoritative/.test(SHADOW), false);
  assert.match(SHADOW, /NOT an authoritative price/);
  assert.match(SHADOW, /baseline under suspicion/);
  assert.match(FWD, /NOT an authoritative price/, 'the table comment says so too');
});

test('rate limits are measured, not enforced, and the endpoint says so', () => {
  assert.match(SHADOW, /would_limit/);
  assert.match(SHADOW, /MEASURED not enforced/);
  assert.equal(/return json\(\{[^}]*rate/i.test(SHADOW), false, 'nobody is turned away yet');
});

test('the engine is priced from the store config, not from the caller', () => {
  assert.match(SHADOW, /from\('stores'\)\.select\('config'\)\.eq\('slug', req0\.slug\)/);
  assert.match(SHADOW, /priceOrder\(store\.config, req0\)/);
});

test('internal errors never reach a public caller', () => {
  const tail = SHADOW.slice(SHADOW.indexOf('} catch (err)'));
  assert.match(tail, /console\.error/);
  assert.match(tail, /return json\(BAD_REQ, 400\)/);
  // The caught error may be logged, but must never be part of the response.
  assert.equal(/return json\([^)]*err/.test(tail), false, 'no internal detail in the body');
});
