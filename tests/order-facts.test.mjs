// Commerce metrics, PR 1: get_store_order_facts.
//
// A read-only RPC that adds an uncapped, PII-free feed of order facts so that
// all-time commerce metrics stop being silently truncated at 500 rows. Nothing
// consumes it yet; the whole safety claim is that it adds a feed and changes
// nothing else.
//
// The SQL cannot run from here, so it is read the way a reviewer has to: what
// it returns, who may call it, and what it deliberately does NOT return.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (p) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), 'utf8');

const FWD = read('supabase/order-facts-forward.sql');
const VERIFY = read('supabase/order-facts-verify.sql');
const ROLLBACK = read('supabase/order-facts-ROLLBACK.sql');
const ORDER_SVC = read('src/utils/orderService.js');

/** Strip -- comments, $tag$ blocks and '...' literals: what actually executes. */
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

const FWD_CODE = stripToCode(FWD);

/** The declared RETURNS TABLE column list, in order. */
const RETURNED = (() => {
  const block = FWD.slice(FWD.indexOf('returns table ('), FWD.indexOf(')\nlanguage plpgsql'));
  return block.split('\n').slice(1)
    .map((l) => l.trim().split(/\s+/)[0].replace(/,$/, ''))
    .filter((n) => /^[a-z_]+$/.test(n));
})();

/** Exactly what the canonical metrics model needs, and nothing more. */
const EXPECTED_FIELDS = [
  'id', 'created_at', 'status', 'payment_method', 'total',
  'paid', 'paid_at', 'paid_via', 'payment_ref', 'payment_link_id',
  'awb', 'courier', 'shipment_status', 'shipment_outcome',
  'delivered_at', 'returned_at',
];

/** Columns that exist on public.orders and must never leave the server here. */
const BANNED_FIELDS = [
  'customer_name', 'customer_phone', 'destination', 'pincode', 'notes',
  'items', 'item_count', 'fbp', 'fbc', 'client_ua', 'confirm_token', 'store_slug',
  'subtotal', 'tax', 'shipping', 'packaging', 'cod_fee', 'shipping_cost',
  'payment_provider', 'payment_link_url', 'payment_link_created_at',
];

// ── A. the projection ────────────────────────────────────────────────────────

test('it returns exactly the sixteen fields the canonical model needs, in order', () => {
  assert.deepEqual(RETURNED, EXPECTED_FIELDS);
});

test('it returns NO customer PII and no bulk columns', () => {
  for (const banned of BANNED_FIELDS) {
    assert.equal(RETURNED.includes(banned), false, `${banned} must never be returned`);
  }
  // ...and the body must not select them either.
  const body = FWD_CODE.slice(FWD_CODE.indexOf('return query'), FWD_CODE.indexOf('end;'));
  for (const banned of ['customer_name', 'customer_phone', 'destination', 'pincode',
                        'notes', 'items', 'confirm_token']) {
    assert.equal(body.includes(banned), false, `the body must not select ${banned}`);
  }
});

test('it is RETURNS TABLE, not SETOF orders, so the projection is part of the signature', () => {
  // SETOF orders would let a later `select o.*` ship the whole row without the
  // declared type changing. RETURNS TABLE makes that impossible silently.
  assert.match(FWD_CODE, /returns table \(/);
  assert.equal(/returns setof/i.test(FWD_CODE), false);
});

test('every column selected is qualified with the alias', () => {
  // The RETURNS TABLE names are plpgsql variables in this scope; an unqualified
  // `status` or `total` would be ambiguous at runtime.
  const body = FWD.slice(FWD.indexOf('return query'), FWD.indexOf('end;\n$function$'));
  const selected = body.slice(body.indexOf('select'), body.indexOf('from public.orders'));
  for (const f of EXPECTED_FIELDS) {
    assert.match(selected, new RegExp(`o\\.${f}\\b`), `${f} must be selected as o.${f}`);
  }
});

// ── B. the cap, which is the whole point ─────────────────────────────────────

test('the new feed has no LIMIT', () => {
  const fn = FWD_CODE.slice(FWD_CODE.indexOf('create or replace function public.get_store_order_facts'));
  assert.equal(/\blimit\b/i.test(fn), false, 'a cap here would defeat the entire PR');
});

test('it orders deterministically, so two calls agree', () => {
  assert.match(FWD, /order by o\.created_at desc, o\.id desc/);
});

test('get_store_orders is NOT modified and keeps its cap', () => {
  assert.equal(/get_store_orders/.test(FWD_CODE), false,
    'this PR must not touch the capped list feed');
  // The client still uses it, unchanged.
  assert.match(ORDER_SVC, /supabase\.rpc\('get_store_orders'/);
  // ...and the verifier fails if its source or grants move.
  assert.match(VERIFY, /G1 get_store_orders source UNCHANGED, still capped at 500/);
  assert.match(VERIFY, /4fc814c21f3e367777063cf3005f2048/);
  assert.match(VERIFY, /G2 get_store_orders grants unchanged/);
});

// ── C. authorization ─────────────────────────────────────────────────────────

test('it is PIN-gated exactly like get_store_orders, returning empty on failure', () => {
  assert.match(FWD, /if not public\.verify_store_pin\(p_slug, p_hashed_pin\) then\s*\n\s*return;/);
  // An empty set, never an exception -- nothing leaks about whether the store exists.
  const gate = FWD.slice(FWD.indexOf('if not public.verify_store_pin'), FWD.indexOf('return query'));
  assert.equal(/raise/i.test(gate), false);
});

test('it is SECURITY DEFINER with a pinned search_path', () => {
  assert.match(FWD_CODE, /security definer/);
  assert.match(FWD_CODE, /set search_path = public, pg_temp/);
});

test('PUBLIC is revoked and only the three real callers are granted', () => {
  // PostgreSQL grants EXECUTE on every new function to PUBLIC. That default is
  // how upgrade_store_plan became anon-callable.
  const revoke = FWD_CODE.indexOf('revoke all on function public.get_store_order_facts(text, text) from public');
  const grant = FWD_CODE.indexOf('grant execute on function public.get_store_order_facts(text, text)');
  const commit = FWD_CODE.lastIndexOf('commit');
  assert.ok(revoke > -1, 'PUBLIC must be revoked');
  assert.ok(revoke < grant, 'revoke before grant');
  assert.ok(grant < commit, 'both inside the one transaction');
  assert.match(FWD_CODE, /to anon, authenticated, service_role/);
  assert.match(VERIFY, /F4 PUBLIC cannot execute it/);
});

test('no grant in this file mentions anything but the new function', () => {
  for (const s of FWD_CODE.match(/(grant|revoke)[^;]*;/gi) ?? []) {
    assert.match(s, /get_store_order_facts/, `out-of-scope grant: ${s.trim()}`);
  }
});

// ── D. scope: this PR adds a feed and changes nothing else ───────────────────

test('it creates no table, trigger, policy or index and alters nothing', () => {
  assert.equal(/create table|create trigger|create policy|create index/i.test(FWD_CODE), false);
  assert.equal(/alter table|drop /i.test(FWD_CODE), false);
  assert.equal(/insert into|update |delete from/i.test(FWD_CODE), false,
    'this PR writes no data');
});

test('it touches nothing from the billing or order-integrity phases', () => {
  for (const forbidden of ['upgrade_store_plan', 'pending_signups', 'plan_entitlements',
                           'apply_plan_entitlement', 'create_order_secure', 'orders_insert_guard',
                           'trg_decrement_stock', 'order_pricing_shadow']) {
    assert.equal(FWD_CODE.includes(forbidden), false, `${forbidden} must not appear`);
  }
});

test('no client code consumes the feed yet', () => {
  assert.equal(/get_store_order_facts/.test(ORDER_SVC), false,
    'PR 1 adds the feed only; PRs 4-8 move the screens onto it');
  assert.match(VERIFY, /F9 nothing in the schema calls it yet/);
});

// ── E. the verifier ──────────────────────────────────────────────────────────

test('the verifier is one read-only SELECT that survives the pre-install state', () => {
  const code = VERIFY.replace(/--.*$/gm, '').trim();
  assert.ok(/^select\b/i.test(code));
  assert.equal((code.match(/;/g) ?? []).length, 1);
  assert.equal(/from public\.get_store_order_facts/.test(code), false,
    'a static reference would be resolved at parse time and crash pre-install');
  assert.match(VERIFY, /to_regprocedure\('public\.get_store_order_facts\(text,text\)'\)/);
  const guards = VERIFY.match(/'N\/A - facts feed not installed'/g) ?? [];
  assert.ok(guards.length >= 8, `each F row needs a guard, found ${guards.length}`);
});

test('the verifier proves the projection and the absence of PII', () => {
  assert.match(VERIFY, /F6 it returns EXACTLY the 16 declared scalar columns/);
  assert.match(VERIFY, /F7 it leaks NO customer PII and no bulk columns/);
  for (const banned of ['customer_name', 'customer_phone', 'destination', 'pincode', 'notes', 'items']) {
    assert.ok(VERIFY.includes(banned), `the verifier must check for ${banned}`);
  }
});

test('the verifier proves nothing else moved', () => {
  for (const row of ['G1 get_store_orders source UNCHANGED',
                     'G2 get_store_orders grants unchanged',
                     'G3 public.orders untouched',
                     'G4 verify_store_pin still the PIN gate',
                     'G5 phase 3C billing objects untouched']) {
    assert.ok(VERIFY.includes(row), `missing verifier row: ${row}`);
  }
});

// ── F. rollback ──────────────────────────────────────────────────────────────

test('the rollback refuses if anything in the database calls the feed', () => {
  assert.match(ROLLBACK, /prosrc ilike '%get_store_order_facts%'/);
  assert.match(ROLLBACK, /REFUSED - these functions call the facts feed/);
  assert.match(ROLLBACK, /pg_depend/);
  assert.match(ROLLBACK, /REFUSED - these object kinds depend on the facts feed/);
});

test('the rollback says plainly what it cannot check', () => {
  // The database cannot see which client build is deployed.
  assert.match(ROLLBACK, /confirm no deployed\n--  client build calls get_store_order_facts/);
});

test('the rollback does not cascade and reverts nothing else', () => {
  const code = stripToCode(ROLLBACK);
  assert.equal(/cascade/i.test(code), false);
  assert.match(code, /drop function if exists public\.get_store_order_facts\(text, text\)/);
  for (const forbidden of ['get_store_orders', 'public.orders', 'verify_store_pin',
                           'upgrade_store_plan', 'plan_entitlements']) {
    assert.equal(code.includes(forbidden), false, `${forbidden} must not be touched on undo`);
  }
});

test('raise messages carry no semicolon, which would break a one-statement paste', () => {
  for (const [name, sql] of [['forward', FWD], ['rollback', ROLLBACK]]) {
    for (const m of sql.match(/message\s*=\s*format\([^)]*\)/g) ?? []) {
      assert.equal(m.includes(';'), false, `${name}: ${m}`);
    }
  }
});
