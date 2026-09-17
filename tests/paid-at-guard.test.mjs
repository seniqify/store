// Commerce metrics, PR 2: orders_payment_time_guard.
//
// A transition-only trigger that stamps paid_at when an order becomes paid and
// the writer left it empty. Its entire safety claim is negative: it must never
// touch a historical row, never overwrite a real timestamp, and never write any
// column but paid_at.
//
// The behavioural matrix (cases A-G) was executed against production inside a
// rolled-back transaction; the measured outcomes are recorded below and pinned
// here structurally, because the SQL cannot run from the test runner.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (p) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), 'utf8');

const FWD = read('supabase/paid-at-guard-forward.sql');
const VERIFY = read('supabase/paid-at-guard-verify.sql');
const ROLLBACK = read('supabase/paid-at-guard-ROLLBACK.sql');
const AUTOMATION = read('supabase/payments-automation.sql');
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
/** The function body, comments removed: what actually runs on a transition. */
const BODY = FWD.slice(FWD.indexOf('as $function$'), FWD.indexOf('$function$;'))
  .replace(/--.*$/gm, '');

// ── A. the transition contract ───────────────────────────────────────────────
//
// Measured against production, rolled back, with the legacy rows created BEFORE
// the trigger existed (the first attempt created them after, and the guard
// stamped them -- which is the invariant working, and a badly ordered test):
//
//   A unpaid + NULL paid_at -> paid=true          STAMPED (correct)
//   B unpaid + supplied paid_at -> paid=true      PRESERVED (correct)
//   C legacy paid + NULL paid_at, unrelated edit  STILL NULL (correct)
//   D paid + real paid_at, unrelated edit         UNCHANGED (correct)
//   E update leaving/setting paid=false           NO TIMESTAMP (correct)
//   F false->true carrying a historical paid_at   PRESERVED (correct)
//   G the transition itself                       ONLY paid_at CHANGED (correct)
//   H direct call                                 REJECTED by PostgreSQL
//   I acl after revoke                            postgres=X only, anon false
//   J the 84 production legacy rows               still 84, still NULL

test('the guard stamps only when paid_at is empty', () => {
  assert.match(BODY, /if NEW\.paid_at is null then\s*\n\s*NEW\.paid_at := now\(\);\s*\n\s*end if;/);
});

test('it never overwrites an existing paid_at', () => {
  // The only assignment is inside the `is null` branch, so a row that already
  // carries a time -- including one carried through a false -> true transition
  // -- keeps it exactly.
  const assignments = BODY.match(/NEW\.[a-z_]+\s*:=/g) ?? [];
  assert.deepEqual(assignments, ['NEW.paid_at :='],
    'exactly one assignment, and it is paid_at');
});

test('it writes no column other than paid_at', () => {
  for (const col of ['paid', 'paid_via', 'payment_ref', 'payment_method', 'payment_provider',
                     'status', 'total', 'subtotal', 'shipment_status', 'shipment_outcome',
                     'delivered_at', 'returned_at', 'notes']) {
    assert.equal(new RegExp(`NEW\\.${col}\\s*:=`).test(BODY), false,
      `the guard must never assign ${col}`);
  }
});

test('the body touches no other row: no update, insert or delete', () => {
  assert.equal(/\b(update|insert|delete)\b/i.test(BODY), false);
});

// ── B. transition-only, enforced by the WHEN clause ──────────────────────────

test('the trigger carries the WHEN clause, so the function is not even called otherwise', () => {
  assert.match(FWD_CODE, /when \(old\.paid is not true and new\.paid is true\)/);
  // That is what makes cases C, D and E structural rather than a matter of
  // reading the body correctly.
});

test('it uses `is not true`, so a NULL -> true transition is covered', () => {
  // paid is nullable. `old.paid = false` would miss NULL -> true.
  assert.match(FWD_CODE, /old\.paid is not true/);
  assert.equal(/old\.paid = false/.test(FWD_CODE), false);
});

test('it is BEFORE UPDATE, per row, and not on insert or delete', () => {
  assert.match(FWD_CODE, /before update on public\.orders\s*\n\s*for each row/);
  assert.equal(/before insert/i.test(FWD_CODE), false);
  assert.equal(/after (insert|update)/i.test(FWD_CODE), false);
});

test('UPDATE-only is complete: no INSERT can create a paid row', () => {
  // phase 1 forces paid=false on every insert...
  assert.match(FWD, /orders_insert_guard forces paid = false on every INSERT/);
  // ...and the client insert never sends a paid field at all. Comments stripped:
  // the neighbouring JSDoc uses the word "paid" in prose, and the assertion is
  // about what the row builder actually returns.
  const build = ORDER_SVC
    .slice(ORDER_SVC.indexOf('export function buildOrderRow'),
           ORDER_SVC.indexOf('export async function saveOrder'))
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
  assert.equal(/\bpaid\b\s*:/.test(build), false, 'buildOrderRow must not set a paid field');
  assert.equal(/\bpaid_at\b/.test(build), false, 'buildOrderRow must not set paid_at');
});

test('the name places it AFTER orders_payment_automation, which fires alphabetically', () => {
  // BEFORE row triggers fire in name order. This guard must see the final NEW
  // row, so that a COD delivery stamped by the automation is left alone.
  assert.ok('orders_payment_automation' < 'orders_payment_time_guard');
  assert.match(FWD_CODE, /create trigger orders_payment_time_guard/);
});

// ── C. nothing historical is rewritten ───────────────────────────────────────

test('the migration contains no UPDATE, INSERT or DELETE of any kind', () => {
  assert.equal(/\bupdate\s+public\./i.test(FWD_CODE), false);
  assert.equal(/\binsert\s+into\b/i.test(FWD_CODE), false);
  assert.equal(/\bdelete\s+from\b/i.test(FWD_CODE), false);
});

test('there is no backfill of paid_at anywhere in the PR', () => {
  for (const sql of [FWD_CODE, stripToCode(ROLLBACK)]) {
    assert.equal(/set\s+paid_at\s*=/i.test(sql), false, 'no statement may set paid_at in bulk');
  }
});

test('the verifier pins the 84 legacy rows by count AND by row id', () => {
  assert.match(VERIFY, /H1 the 84 legacy rows still have paid_at NULL, and are the SAME rows/);
  assert.match(VERIFY, /= 84/);
  assert.match(VERIFY, /14a6d549e7da52aada52e1a7857c0670/);
});

test('the one-time backfill that created the legacy rows is left alone', () => {
  // payments-automation.sql set paid and paid_via and deliberately did not
  // invent a paid_at. This PR does not revisit that decision.
  assert.match(AUTOMATION, /paid_via = case when x\.outcome = 'delivered'/);
  assert.equal(/paid_at\s*=/.test(AUTOMATION.slice(AUTOMATION.indexOf('update public.orders o'))), false,
    'the historical backfill never stamped paid_at, and must stay that way');
});

// ── D. security ──────────────────────────────────────────────────────────────

test('the function is SECURITY INVOKER with a pinned search_path', () => {
  assert.match(FWD_CODE, /security invoker/);
  assert.match(FWD_CODE, /set search_path = public, pg_temp/);
  assert.equal(/security definer/.test(FWD_CODE), false);
});

test('EXECUTE is revoked from every role, and the trigger still fires', () => {
  // PostgreSQL checks EXECUTE at CREATE TRIGGER time, not at fire time. Proven
  // in the rolled-back run: acl came back as postgres=X/postgres only, anon
  // false, and cases A/B/F/G still behaved correctly.
  assert.match(FWD_CODE, /revoke all on function public\.orders_payment_time_guard\(\) from public, anon, authenticated, service_role/);
  const revoke = FWD_CODE.indexOf('revoke all on function public.orders_payment_time_guard');
  const commit = FWD_CODE.lastIndexOf('commit');
  assert.ok(revoke > -1 && revoke < commit, 'revoked inside the same transaction');
});

test('no grant is issued to anything', () => {
  assert.equal(/\bgrant\b/i.test(FWD_CODE), false, 'nothing needs to call a trigger function');
});

// ── E. scope ─────────────────────────────────────────────────────────────────

test('no existing payment writer is modified', () => {
  for (const writer of ['set_order_paid', 'orders_payment_automation', 'shipment_outcome_of',
                        'get_store_order_facts', 'get_store_orders']) {
    assert.equal(FWD_CODE.includes(writer), false, `${writer} must not appear in executable SQL`);
  }
  // ...and the verifier fails if any of them moves.
  for (const row of ['W1 set_order_paid unchanged',
                     'W2 orders_payment_automation unchanged',
                     'W3 get_store_order_facts (PR 1) unchanged',
                     'W4 shipment_outcome_of unchanged']) {
    assert.ok(VERIFY.includes(row), `missing verifier row: ${row}`);
  }
});

test('it touches no policy, no grant on orders, and no other table', () => {
  assert.equal(/create policy|alter policy|drop policy/i.test(FWD_CODE), false);
  assert.equal(/on public\.orders to |on public\.orders from /i.test(FWD_CODE), false);
  assert.equal(/alter table/i.test(FWD_CODE), false);
  for (const t of ['plan_entitlements', 'pending_signups', 'stores', 'order_integrity']) {
    assert.equal(FWD_CODE.includes(t), false, `${t} must not be touched`);
  }
});

test('phase 1, phase 2 and phase 3C objects are not named in executable SQL', () => {
  for (const o of ['orders_insert_guard', 'trg_decrement_stock', 'create_order_secure',
                   'upgrade_store_plan', 'apply_plan_entitlement']) {
    assert.equal(FWD_CODE.includes(o), false, `${o} must not appear`);
  }
  assert.match(VERIFY, /B4 phase 1, phase 2 and phase 3C objects unchanged/);
});

test('no client code, UI or edge function is involved', () => {
  // The audit confirmed every live writer already stamps paid_at, so the PR
  // needed no application change at all.
  assert.match(FWD, /Every live writer already stamps paid_at/);
});

// ── F. the verifier ──────────────────────────────────────────────────────────

test('the verifier is one read-only SELECT that survives both states', () => {
  const code = VERIFY.replace(/--.*$/gm, '').trim();
  assert.ok(/^select\b/i.test(code));
  assert.equal((code.match(/;/g) ?? []).length, 1);
  assert.match(VERIFY, /to_regprocedure\('public\.orders_payment_time_guard\(\)'\)/);
  const guards = VERIFY.match(/'N\/A - guard not installed'/g) ?? [];
  assert.ok(guards.length >= 6, `each T row needs a guard, found ${guards.length}`);
});

test('the verifier proves the orders baseline changed by exactly one trigger', () => {
  assert.match(VERIFY, /B1 the other four order triggers are untouched/);
  assert.match(VERIFY, /t\.tgname <> 'orders_payment_time_guard'/);
  assert.match(VERIFY, /11af8163bb6f3fa4d110377466aa79ab/);
  assert.match(VERIFY, /B2 exactly one trigger was added, and it is ours/);
  assert.match(VERIFY, /B3 orders policies and browser grants unchanged/);
});

test('the WHEN-clause check matches semantics, not bracketing', () => {
  // PostgreSQL renders WHEN (((old.paid IS NOT TRUE) AND (new.paid IS TRUE))).
  // Pinning the paren count made T3 fail against a correctly installed trigger.
  const t3 = VERIFY.slice(VERIFY.indexOf("'T3'"), VERIFY.indexOf("'T4'"));
  assert.match(t3, /like '%WHEN %old\.paid IS NOT TRUE%AND%new\.paid IS TRUE%'/);
  assert.match(t3, /not like '% OR %'/);
});

test('no verifier row compares a subquery against an identical copy of itself', () => {
  // The regression guard added in the PR 11 review, applied to this file too.
  const body = VERIFY.replace(/--.*$/gm, '').replace(/\s+/g, ' ').trim();
  const subqueries = body.match(/\(select [^()]*(?:\([^()]*\)[^()]*)*\)/g) ?? [];
  for (const q of new Set(subqueries)) {
    assert.equal(body.includes(`${q} = ${q}`), false, `tautology: ${q.slice(0, 80)}`);
  }
});

test('no verifier row detects PUBLIC by substring-matching a flattened acl', () => {
  const body = VERIFY.replace(/--.*$/gm, '');
  assert.equal(/array_to_string\([^)]*proacl[^)]*\)[^;]{0,120}like\s*'%=/.test(body), false);
  for (const c of body.match(/a::text like '[^']*'/g) ?? []) {
    assert.equal(c, "a::text like '=%'", `unanchored aclitem match: ${c}`);
  }
});

// ── G. rollback ──────────────────────────────────────────────────────────────

test('the rollback drops the trigger then the function, without cascade', () => {
  const code = stripToCode(ROLLBACK);
  assert.match(code, /drop trigger if exists orders_payment_time_guard on public\.orders/);
  assert.match(code, /drop function if exists public\.orders_payment_time_guard\(\)/);
  assert.ok(code.indexOf('drop trigger') < code.indexOf('drop function'));
  assert.equal(/cascade/i.test(code), false);
});

test('the rollback refuses if anything else depends on the guard', () => {
  assert.match(ROLLBACK, /REFUSED - other triggers use this function/);
  assert.match(ROLLBACK, /REFUSED - these functions reference the guard/);
  assert.match(ROLLBACK, /prosrc ilike '%orders_payment_time_guard%'/);
});

test('the rollback rewrites no row and touches nothing else', () => {
  const code = stripToCode(ROLLBACK);
  assert.equal(/\bupdate\b|\binsert\b|\bdelete from\b/i.test(code), false);
  for (const o of ['set_order_paid', 'orders_payment_automation', 'get_store_order_facts',
                   'upgrade_store_plan', 'plan_entitlements']) {
    assert.equal(code.includes(o), false, `${o} must not be touched on undo`);
  }
});

test('raise messages carry no semicolon, which would break a one-statement paste', () => {
  for (const [name, sql] of [['forward', FWD], ['rollback', ROLLBACK]]) {
    for (const m of sql.match(/message\s*=\s*format\([^)]*\)/g) ?? []) {
      assert.equal(m.includes(';'), false, `${name}: ${m}`);
    }
  }
});
