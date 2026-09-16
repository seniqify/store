// A signed-in browser could not place an order: public.orders had one INSERT
// policy and it named only `anon`, so PostgREST running the request as
// `authenticated` was refused by RLS. The fix is one ALTER POLICY.
//
// None of this SQL can be run from here, so these tests pin what the files are
// allowed to do — above all that the fix stays *small*, and that the payment
// guard it depends on is not quietly edited along with it.
//
//   supabase/orders-authenticated-insert-forward.sql   changes production
//   supabase/orders-authenticated-insert-ROLLBACK.sql  puts it back
//   supabase/orders-authenticated-insert-verify.sql    read-only checks
//   supabase/orders-authenticated-insert-PROOF.sql     inserts, then rolls back
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (p) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), 'utf8');

const FWD      = read('supabase/orders-authenticated-insert-forward.sql');
const ROLLBACK = read('supabase/orders-authenticated-insert-ROLLBACK.sql');
const VERIFY   = read('supabase/orders-authenticated-insert-verify.sql');
const PROOF    = read('supabase/orders-authenticated-insert-PROOF.sql');

/** Strip -- comments and '...' literals, leaving executable SQL. */
function stripToCode(sql) {
  let out = '';
  for (let i = 0; i < sql.length; i++) {
    if (sql[i] === '-' && sql[i + 1] === '-') {
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

const FWD_CODE  = stripToCode(FWD);
const BACK_CODE = stripToCode(ROLLBACK);

// ── the fix is one statement, and only that statement ────────────────────────

test('the forward migration alters exactly one policy, to both roles', () => {
  assert.match(FWD_CODE, /alter policy orders_anon_insert on public\.orders to anon, authenticated;/);
  const statements = FWD_CODE.split(';').map((s) => s.trim()).filter(Boolean);
  assert.deepEqual(statements.map((s) => s.split(/\s+/)[0].toLowerCase()),
    ['begin', 'alter', 'commit'], 'begin, one alter, commit — nothing else');
});

test('it does not touch the policy command or its check', () => {
  // ALTER POLICY ... TO changes roles only. A `using` or `with check` here would
  // be rewriting the rule, not re-pointing it.
  assert.equal(/with check/i.test(FWD_CODE), false);
  assert.equal(/\busing\b/i.test(FWD_CODE), false);
  assert.equal(/create policy|drop policy/i.test(FWD_CODE), false);
});

test('it grants nothing and revokes nothing', () => {
  assert.equal(/\bgrant\b|\brevoke\b/i.test(FWD_CODE), false,
    'privileges are not part of this fix — the failure was RLS, not a grant');
});

test('it does not widen any other command', () => {
  for (const cmd of ['select', 'update', 'delete', 'all']) {
    assert.equal(new RegExp(`for\\s+${cmd}\\b`, 'i').test(FWD_CODE), false, cmd);
  }
  assert.equal(/to\s+public\b/i.test(FWD_CODE), false, 'never PUBLIC');
});

test('it leaves the payment guard, payments and ads alone', () => {
  for (const name of ['orders_insert_guard', 'payments', 'razorpay', 'meta_', 'campaign']) {
    assert.equal(FWD_CODE.toLowerCase().includes(name), false, `${name} must not appear in the change`);
  }
});

test('nothing destructive is in the forward file', () => {
  assert.equal(/\bdrop\b|\btruncate\b|\bdelete\s+from\b|\bupdate\s+public\./i.test(FWD_CODE), false);
});

// ── the rollback really rolls back ───────────────────────────────────────────

test('the rollback restores the policy to anon only', () => {
  assert.match(BACK_CODE, /alter policy orders_anon_insert on public\.orders to anon;/);
  assert.equal(/authenticated/i.test(BACK_CODE), false, 'the undo must not keep the new role');
  const statements = BACK_CODE.split(';').map((s) => s.trim()).filter(Boolean);
  assert.deepEqual(statements.map((s) => s.split(/\s+/)[0].toLowerCase()),
    ['begin', 'alter', 'commit']);
});

// ── the verification file ────────────────────────────────────────────────────

test('the verify file is read-only: one SELECT, no DDL', () => {
  const code = stripToCode(VERIFY);
  assert.equal(/\b(insert|update|delete|alter|drop|create|grant|revoke|truncate|begin|commit|set\s+role)\b/i.test(code), false);
  assert.equal((code.match(/;/g) || []).length, 1, 'exactly one statement');
  assert.match(code, /^\s*with /i);
});

test('verification covers the roles, the untouched check, and the guard', () => {
  assert.match(VERIFY, /V1\.2 it applies to anon AND authenticated/);
  assert.match(VERIFY, /V1\.3 the check is unchanged \(true\)/);
  assert.match(VERIFY, /V1\.4 the policy was not widened to PUBLIC/);
  assert.match(VERIFY, /V2\.1 no SELECT, UPDATE or DELETE policy for authenticated/);
  assert.match(VERIFY, /V2\.2 anon and authenticated still cannot DELETE or TRUNCATE/);
  assert.match(VERIFY, /V3\.1 orders_insert_guard still fires BEFORE INSERT/);
  assert.match(VERIFY, /V3\.2 it still clears every payment column and clamps status/);
});

// ── the proof: both roles insert, neither can claim payment ──────────────────

test('the proof writes nothing: it opens a transaction and always rolls back', () => {
  const code = stripToCode(PROOF);
  assert.match(code, /^\s*begin;/);
  assert.match(code, /rollback;\s*$/);
  assert.equal(/\bcommit\b/i.test(code), false, 'a commit here would leave rows behind');
});

test('the proof inserts as anon AND as authenticated', () => {
  assert.match(PROOF, /set local role anon;/);
  assert.match(PROOF, /set local role authenticated;/);
  const inserts = PROOF.match(/insert into public\.orders/g) || [];
  assert.equal(inserts.length, 2, 'one insert per role');
  assert.ok(PROOF.indexOf('set local role anon') < PROOF.indexOf('set local role authenticated'));
});

test('each proof insert claims payment, so the guard has something to strip', () => {
  // A row that never claimed anything would prove nothing about the guard.
  for (const claim of ['true, now\\(\\), \'razorpay\'', 'pay_forged_anon', 'pay_forged_authed']) {
    assert.match(PROOF, new RegExp(claim), claim);
  }
  assert.equal((PROOF.match(/'delivered'/g) || []).length, 2,
    'both rows also claim a status that would skip the seller');
});

test('the proof checks what actually landed, and says PASS or FAIL', () => {
  const check = PROOF.slice(PROOF.indexOf('reset role;'));
  for (const col of ['paid', 'paid_at', 'paid_via', 'payment_ref', 'payment_provider']) {
    assert.match(check, new RegExp(`o\\.${col}`), col);
  }
  assert.match(check, /o\.status = 'new'/);
  assert.match(check, /PASS - the payment claim was stripped/);
  assert.match(check, /FAIL - a payment claim survived the insert/);
});

test('the proof uses a store_slug no merchant can see', () => {
  assert.match(PROOF, /'__proof__'/);
  assert.equal(/royalfoods|showme|store_slug\s*=\s*'[a-z]+-[a-z]+'/i.test(PROOF), false,
    'never a real store');
});
