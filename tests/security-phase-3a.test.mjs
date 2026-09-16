// Security phase 3A: the PIN throttle under parallel load, atomic OTP
// consumption in recovery, and the two tables the audit found open.
//
// None of this SQL can be run from here, so the tests read it the way a
// reviewer would have to: what the functions do, in what order, with which
// privileges — plus the client change that keeps onboarding working.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (p) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), 'utf8');

const FWD      = read('supabase/security-phase-3a-forward.sql');
const VERIFY   = read('supabase/security-phase-3a-verify.sql');
const ROLLBACK = read('supabase/security-phase-3a-ROLLBACK.sql');
const STORESVC = read('src/utils/storeService.js');

/** Strip -- comments, $tag$ blocks and '...' literals: the executable statements. */
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

const fnBody = (sql, name) => {
  const at = sql.indexOf(`create or replace function public.${name}(`);
  assert.ok(at > -1, `${name} must be defined`);
  const end = sql.indexOf('$function$;', at);
  return sql.slice(at, end === -1 ? sql.length : end);
};

const PIN   = fnBody(FWD, 'verify_store_pin');
const RESET = fnBody(FWD, 'reset_store_pin');

// ── A. the PIN throttle cannot be out-run ────────────────────────────────────

test('the throttle decides under a lock, before it counts anything', () => {
  // Counting failures and then recording one is a check-then-act: requests that
  // arrive together read the same count, all find room, and the cap bounds only
  // a serial attacker. Against 10,000 possible PINs that is the whole ballgame.
  const lock  = PIN.indexOf('pg_advisory_xact_lock');
  const count = PIN.indexOf('count(*) filter');
  assert.ok(lock > -1, 'a lock must be taken');
  assert.ok(lock < count, 'and it must be held before the count is read');
});

test('both budgets are locked, in a stable order, transaction-scoped', () => {
  assert.match(PIN, /hashtext\('pin:slug:' \|\| p_slug\)/);
  assert.match(PIN, /hashtext\('pin:ip:' \|\| p_slug \|\| ':' \|\| v_ip\)/);
  assert.match(PIN, /least\(v_k_slug, v_k_ip\)/);
  assert.match(PIN, /greatest\(v_k_slug, v_k_ip\)/);
  assert.match(PIN, /if v_k_ip is null or v_k_ip = v_k_slug then/);
  assert.equal(/pg_advisory_lock\(/.test(PIN), false, 'never a session lock');
  assert.equal(/pg_advisory_unlock/.test(PIN), false, 'xact locks release themselves');
});

test('the lock namespace is its own, not otp_guard\'s', () => {
  // Sharing 774411 would make OTP traffic and PIN traffic block each other.
  assert.match(PIN, /c_lock_ns    constant integer  := 774412;/);
  assert.match(RESET, /c_lock_ns    constant integer  := 774413;/);
});

test('a correct PIN still returns true, and is still not recorded', () => {
  assert.match(PIN, /select exists \(\s*select 1 from public\.stores\s*where slug = p_slug and pin = p_hashed_pin\s*\) into v_ok;/);
  assert.match(PIN, /if not v_ok then\s*insert into public\.pin_attempts/);
  assert.equal(/values \(p_slug, v_ip, true/.test(PIN), false, 'successes stay unrecorded');
  assert.match(PIN, /return v_ok;/);
});

test('a wrong PIN is still recorded, and a locked-out caller still refused', () => {
  assert.match(PIN, /if \(v_ip is not null and v_fails_ip >= c_max_ip\) or v_fails_slug >= c_max_store then/);
  const lockedOut = PIN.slice(PIN.indexOf('>= c_max_store then'), PIN.indexOf('select exists ('));
  assert.match(lockedOut, /insert into public\.pin_attempts/, 'the window keeps sliding');
  assert.match(lockedOut, /return false;/);
});

test('the limits, the window and the pruning are untouched', () => {
  assert.match(PIN, /c_max_ip     constant integer  := 10;/);
  assert.match(PIN, /c_max_store  constant integer  := 50;/);
  assert.match(PIN, /c_window     constant interval := interval '15 minutes';/);
  assert.match(PIN, /if random\(\) < 0\.01 then/);
});

test('it stays SECURITY DEFINER with a pinned search_path, same signature', () => {
  assert.match(FWD, /create or replace function public\.verify_store_pin\(p_slug text, p_hashed_pin text\)\s*\nreturns boolean/);
  assert.match(PIN, /security definer/);
  assert.match(PIN, /set search_path = public, pg_temp/);
});

// ── B. recovery spends the OTP exactly once ──────────────────────────────────

test('reset_store_pin consumes the code through otp_consume', () => {
  assert.match(RESET, /if not public\.otp_consume\(p_whatsapp, p_code\) then/);
  assert.equal(/select exists \(\s*select 1 from public\.otp_codes/.test(RESET), false,
    'the read-then-delete shape is what allowed a replay');
  assert.equal(/delete from public\.otp_codes/.test(RESET), false,
    'deleting separately is otp_consume\'s job now');
});

test('a failed consume is recorded and refuses, exactly as a wrong code did', () => {
  const after = RESET.slice(RESET.indexOf('otp_consume(p_whatsapp, p_code)'));
  assert.match(after, /insert into public\.pin_attempts[\s\S]{0,120}'otp'\);/);
  assert.match(after, /return false;/);
  assert.ok(after.indexOf('return false;') < after.indexOf('update public.stores set pin'),
    'no PIN is set when the code is refused');
});

test('the OTP is still bound to the number, the store and the expiry', () => {
  // The number on the storefront must be the number asking...
  assert.match(RESET, /stored10 <> input10/);
  assert.match(RESET, /config->>'whatsappNumber'/);
  // ...and expiry lives inside otp_consume, which the verifier also checks.
  assert.match(VERIFY, /V2\.2 otp_consume is still the single-statement claim/);
  assert.match(VERIFY, /expires_at > now\(\)/);
});

test('recovery keeps its own rate limits, and now serializes them too', () => {
  assert.match(RESET, /c_max_ip     constant integer  := 5;/);
  assert.match(RESET, /c_max_store  constant integer  := 20;/);
  assert.match(RESET, /pg_advisory_xact_lock/);
  const lock = RESET.indexOf('pg_advisory_xact_lock');
  assert.ok(lock < RESET.indexOf('count(*) filter'), 'locked before counting');
});

test('a successful reset still clears that store\'s recent OTP failures', () => {
  assert.match(RESET, /if n > 0 then\s*delete from public\.pin_attempts\s*where slug = p_slug and kind = 'otp'/);
});

test('the recovery signature and privileges are unchanged', () => {
  assert.match(FWD, /create or replace function public\.reset_store_pin\(\s*p_slug text, p_whatsapp text, p_code text, p_new_hashed_pin text\)/);
  assert.match(RESET, /security definer/);
  assert.match(RESET, /set search_path = public, pg_temp/);
});

// ── C. pending_signups ───────────────────────────────────────────────────────

test('the anonymous read is removed, policy and grant together', () => {
  const code = stripToCode(FWD);
  assert.match(code, /drop policy if exists "pending select" on public\.pending_signups;/);
  assert.match(code, /revoke select on public\.pending_signups from anon, authenticated;/);
});

test('the write paths the signup flow depends on are deliberately kept', () => {
  // Checkout writes the row after payment and is the ONLY writer on the coupon
  // path; Onboarding deletes it once the store exists. Removing these would
  // break signup recovery, which this phase must not do.
  const code = stripToCode(FWD);
  for (const cmd of ['insert', 'update', 'delete']) {
    assert.equal(new RegExp(`drop policy if exists "pending ${cmd}"`, 'i').test(code), false,
      `the ${cmd} policy must survive`);
  }
  assert.match(FWD, /INSERT, UPDATE and DELETE stay for now/);
});

test('the residual billing bypass is stated, not glossed', () => {
  // Anyone may still insert themselves a paid plan and claim it at onboarding.
  assert.match(FWD, /KNOWN AND NOT CLOSED HERE/);
  assert.match(FWD, /billing bypass/i);
  assert.match(FWD, /merchant identity/i);
});

test('lookup moves behind a pinned, definer function callable by the browser', () => {
  const fn = FWD.slice(FWD.indexOf('create or replace function public.get_pending_signup'),
                       FWD.indexOf('revoke all on function public.get_pending_signup'));
  assert.match(fn, /security definer/);
  assert.match(fn, /set search_path = public, pg_temp/);
  assert.match(fn, /\bstable\b/);
  assert.match(fn, /where s\.phone = right\(regexp_replace\(coalesce\(p_phone, ''\), '\\D', '', 'g'\), 10\)/);
  assert.match(fn, /limit 1/);
  const code = stripToCode(FWD);
  assert.match(code, /grant execute on function public\.get_pending_signup\(text\) to anon, authenticated, service_role;/);
});

test('an empty phone matches nothing', () => {
  const fn = FWD.slice(FWD.indexOf('create or replace function public.get_pending_signup'),
                       FWD.indexOf('revoke all on function public.get_pending_signup'));
  assert.match(fn, /coalesce\(btrim\(p_phone\), ''\) <> ''/);
});

test('the subscription id still reaches onboarding — publish needs it', () => {
  // Withholding it would unlink a recovered signup from its Razorpay
  // subscription at publish, which is a silent billing regression.
  assert.match(FWD, /returns table \(plan text, plan_expires_at timestamptz, subscription_id text\)/);
  assert.match(STORESVC, /rpc\('get_pending_signup', \{ p_phone: last10 \}\)/);
  assert.match(STORESVC, /subscriptionId: row\.subscription_id \|\| null/);
});

test('the lookup falls back to the old path only while the RPC is missing', () => {
  // Either deploy order leaves a window otherwise: the site alone has no RPC to
  // call, and the SQL alone leaves cached bundles reading a table they may no
  // longer read. Both ends of that window told a paid merchant they had no plan.
  const fn = STORESVC.slice(STORESVC.indexOf('export async function getPendingSignup'),
                            STORESVC.indexOf('/** Clear a pending signup'));
  assert.match(fn, /const \{ data, error \} = await supabase\.rpc\('get_pending_signup'/);
  assert.match(fn, /if \(error\) \{/, 'the fallback is reached only on an RPC error');
  assert.match(fn, /TEMPORARY, and delete it once security-phase-3a-forward\.sql is applied/);
  // It reads the table, which the migration makes unreadable — so it expires by
  // itself rather than lingering as a way around the new rule.
  assert.match(fn, /\.from\('pending_signups'\)/);
  assert.ok(fn.indexOf("rpc('get_pending_signup'") < fn.indexOf(".from('pending_signups')"),
    'the RPC is always tried first');
});

test('the client still writes and clears signups exactly as before', () => {
  assert.match(STORESVC, /from\('pending_signups'\)\.upsert\(/);
  assert.match(STORESVC, /from\('pending_signups'\)\.delete\(\)\.eq\('phone', last10\)/);
});

// ── D. console_audit ─────────────────────────────────────────────────────────

test('the staff read policy is left alone — it was never world-readable', () => {
  // The audit called it public after reading the role list; the predicate is
  // is_crm_admin(), so an anonymous reader already gets nothing. Narrowing it
  // would risk staff access for no gain.
  const code = stripToCode(FWD);
  assert.equal(/console_audit_read/.test(code), false, 'the policy must not be touched');
  assert.equal(/create policy[\s\S]{0,60}console_audit/i.test(code), false);
  assert.match(FWD, /the audit's finding was WRONG/i);
});

test('only the unused destructive grants are removed', () => {
  const code = stripToCode(FWD);
  assert.match(code, /revoke truncate, delete, insert, update on public\.console_audit from anon, authenticated;/);
  assert.equal(/revoke select on public\.console_audit/.test(code), false,
    'SELECT is governed by the policy, and staff need it');
});

// ── the files themselves ─────────────────────────────────────────────────────

test('the forward file is one transaction and touches nothing out of scope', () => {
  const code = stripToCode(FWD);
  assert.equal((code.match(/\bbegin;/g) || []).length, 1);
  assert.equal((code.match(/\bcommit;/g) || []).length, 1);
  for (const forbidden of ['orders_anon_insert', 'trg_decrement_stock', 'create_order_secure',
                           'order_pricing_shadow', 'payments', 'razorpay_', 'shipping', 'meta_']) {
    assert.equal(code.toLowerCase().includes(forbidden), false, `${forbidden} is out of scope`);
  }
  assert.equal(/drop table|drop function|alter table/i.test(code), false, 'nothing destructive');
});

test('the 14-function search_path sweep is NOT in this PR', () => {
  // Wider blast radius; it is being reviewed separately.
  const code = stripToCode(FWD);
  const pinned = code.match(/set search_path/g) || [];
  assert.ok(pinned.length <= 3, `only the functions being rewritten set it, found ${pinned.length}`);
  for (const other of ['get_store_view_stats', 'confirm_order_by_token', 'is_crm_member',
                       'decrement_stock_on_order', 'get_product_sales']) {
    assert.equal(code.includes(other), false, `${other} must not be swept here`);
  }
});

test('the verifier is read-only and runs in both states', () => {
  const code = stripToCode(VERIFY);
  assert.equal(/\b(insert|update|delete|alter|drop|create|grant|revoke|truncate|begin|commit)\b/i.test(code), false);
  assert.equal((code.match(/;/g) || []).length, 1, 'exactly one statement');
  assert.match(code, /^\s*with /i);
  // Anything the migration creates must be reached without naming it where the
  // parser would resolve it — the lesson from phase 2.
  assert.equal(/get_pending_signup\s*\(/.test(code), false, 'no direct call to a function that may not exist');
  assert.match(VERIFY, /to_regprocedure\('public\.get_pending_signup\(text\)'\)/);
});

test('the rollback restores the old behaviour and keeps the lookup function', () => {
  const code = stripToCode(ROLLBACK);
  assert.match(code, /create or replace function public\.verify_store_pin/);
  assert.match(code, /create or replace function public\.reset_store_pin/);
  assert.match(code, /grant select on public\.pending_signups to anon, authenticated;/);
  assert.match(code, /create policy "pending select"/);
  assert.equal(/drop function if exists public\.get_pending_signup/.test(code), false,
    'the deployed client calls it — dropping it would break onboarding');
  assert.equal(/^\s*grant[^;]*console_audit/im.test(code), false,
    'the console_audit grants stay revoked');
});

test('the rollback really is the old code, not the new code renamed', () => {
  const back = stripToCode(ROLLBACK);
  assert.equal(/pg_advisory_xact_lock/.test(back), false, 'the lock is what it undoes');
  assert.equal(/otp_consume/.test(back), false, 'and the atomic consumer too');
});
