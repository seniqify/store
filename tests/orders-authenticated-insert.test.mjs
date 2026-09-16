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

/** Strip -- comments, $tag$...$tag$ blocks and '...' literals, leaving the
 *  top-level statements. A DO block counts as one statement, not as the
 *  semicolons inside it. */
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

const FWD_CODE  = stripToCode(FWD);
const BACK_CODE = stripToCode(ROLLBACK);

// ── the fix is one statement, and only that statement ────────────────────────

test('the forward migration alters exactly one policy, to both roles', () => {
  assert.match(FWD_CODE, /alter policy orders_anon_insert on public\.orders to anon, authenticated;/);
  const statements = FWD_CODE.split(';').map((s) => s.trim()).filter(Boolean);
  assert.deepEqual(statements.map((s) => s.split(/\s+/)[0].toLowerCase()),
    ['begin', 'do', 'alter', 'commit'],
    'begin, the precondition, one alter, commit — nothing else');
});

// ── the guard is a precondition, and the file enforces it ────────────────────
// The widening is safe only because orders_insert_guard strips payment claims
// for every role. That guard ships on another branch, so the repository cannot
// promise it is live — the database is asked, and the answer is binding.

const PRECONDITION = FWD.slice(FWD.indexOf('do $precondition$'), FWD.indexOf('$precondition$;'));

test('the forward migration refuses to run without the payment guard', () => {
  assert.ok(PRECONDITION.length > 0, 'a precondition block must exist');
  assert.match(PRECONDITION, /raise exception/);
  assert.ok(FWD.indexOf('do $precondition$') < FWD.indexOf('alter policy'),
    'it must run before the policy is touched');
  assert.ok(FWD.indexOf('begin;') < FWD.indexOf('do $precondition$'),
    'and inside the transaction, so a failure changes nothing');
});

test('the precondition checks the trigger is the real one, enabled, BEFORE INSERT', () => {
  assert.match(PRECONDITION, /t\.tgname = 'orders_insert_guard'/);
  assert.match(PRECONDITION, /p\.proname = 'orders_insert_guard'/);
  assert.match(PRECONDITION, /\(t\.tgtype & 1\) <> 0/, 'FOR EACH ROW');
  assert.match(PRECONDITION, /\(t\.tgtype & 2\) <> 0/, 'BEFORE');
  assert.match(PRECONDITION, /\(t\.tgtype & 4\) <> 0/, 'INSERT');
  assert.match(PRECONDITION, /t\.tgenabled = 'O'/, 'enabled, not replica-only');
  assert.match(PRECONDITION, /not t\.tgisinternal/);
});

test('the precondition checks the guard still strips every payment column', () => {
  // A same-named stub that no longer clears the columns must not pass.
  for (const col of ['NEW.paid ', 'NEW.paid_at', 'NEW.paid_via', 'NEW.payment_ref', 'NEW.payment_provider']) {
    assert.ok(PRECONDITION.includes(col), col);
  }
  assert.match(PRECONDITION, /not in \(''new'', ''abandoned''\)/, 'and still clamps status');
});

test('the precondition only reads the catalog', () => {
  // Compare executable SQL only: the words INSERT and ALTER appear legitimately
  // in its comments and in the hint it raises.
  const code = PRECONDITION
    .replace(/--.*$/gm, '')
    .replace(/'[^']*'/g, "'LITERAL'");
  assert.equal(/\b(insert|update|delete|alter|drop|create|grant|revoke|truncate)\b/i.test(code), false,
    'it inspects and raises — it must not change anything');
  assert.match(code, /select exists/, 'and what it does is a catalog read');
});

test('its failure message tells the operator what to do', () => {
  assert.match(PRECONDITION, /using hint =/);
  assert.match(PRECONDITION, /security-phase-1-forward\.sql/, 'name the file that installs the guard');
  assert.match(PRECONDITION, /Nothing has been changed/);
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
  // orders_insert_guard is named in the precondition, which only reads the
  // catalog. What must not appear is any attempt to define or move it.
  for (const bad of [/create\s+(or\s+replace\s+)?function/i, /create\s+trigger/i,
                     /drop\s+trigger/i, /alter\s+table/i]) {
    assert.equal(bad.test(FWD_CODE), false, String(bad));
  }
  for (const name of ['payments', 'razorpay', 'meta_', 'campaign']) {
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

// ── the proof cannot emit anything, even while its rows briefly exist ────────
// ROLLBACK only promises the rows do not persist. Triggers still FIRE, and one
// of them can make an outbound HTTP call, so each is accounted for.

test('the proof aborts if the INSERT triggers on orders are not the known set', () => {
  const preflight = PROOF.slice(PROOF.indexOf('do $preflight$'), PROOF.indexOf('$preflight$;'));
  assert.ok(preflight.length > 0, 'a preflight block must exist');
  assert.match(preflight, /orders_insert_guard, orders_payment_automation, trg_decrement_stock, trg_meta_capi/,
    'the expected set is named, so a new trigger cannot slip in unreviewed');
  assert.match(preflight, /\(t\.tgtype & 4\) <> 0/, 'only INSERT triggers matter here');
  assert.match(preflight, /t\.tgenabled <> 'D'/, 'a disabled trigger does not fire');
  assert.match(preflight, /raise exception/);
  assert.ok(PROOF.indexOf('do $preflight$') < PROOF.indexOf('insert into public.orders'),
    'it runs before anything is inserted');
});

test('the proof rows cannot reach the Meta CAPI trigger', () => {
  // meta_capi_notify returns at `coalesce(NEW.total, 0) <= 0`, so zero amounts
  // stop it before it evaluates anything else. Belt and braces on top of the
  // guard having already forced paid = false and status = 'new'.
  const rows = PROOF.match(/'\[\]'::jsonb, 0, 0, 0, 'delivered'/g) || [];
  assert.equal(rows.length, 2, 'both rows carry empty items and zero amounts');
  assert.match(PROOF, /coalesce\(NEW\.total, 0\) <= 0/, 'the header states why zero matters');
});

test('the proof documents each trigger and why it is inert', () => {
  const header = PROOF.slice(0, PROOF.indexOf('begin;'));
  for (const trg of ['orders_insert_guard', 'orders_payment_automation',
                     'trg_decrement_stock', 'trg_meta_capi']) {
    assert.ok(header.includes(trg), `${trg} must be accounted for in the header`);
  }
  assert.match(header, /net\.http_request_queue/,
    'and why a queued request would not survive the rollback');
  assert.match(header, /IMMUTABLE|immutable/, 'shipment_outcome_of is pure');
});

test('the proof does not disable triggers to make itself safe', () => {
  // Disabling trg_meta_capi would need ACCESS EXCLUSIVE on orders and would
  // block live checkout for the length of the transaction; disabling the guard
  // would void the thing being proved.
  assert.equal(/disable\s+trigger|session_replication_role/i.test(PROOF), false);
});

test('the proof uses a store_slug no merchant can see', () => {
  assert.match(PROOF, /'__proof__'/);
  assert.equal(/royalfoods|showme|store_slug\s*=\s*'[a-z]+-[a-z]+'/i.test(PROOF), false,
    'never a real store');
});
