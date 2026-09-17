// Phase 3C PR 1: the plan entitlement ledger.
//
// This PR adds a table and imports 36 rows into it. Its entire safety claim is
// negative -- that it changed nothing else, and that nothing a browser can
// reach can write it. None of this SQL can run from here, so the tests read it
// the way a reviewer has to: what the migration does, in what order, with
// which privileges, and just as importantly what it does NOT contain.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (p) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), 'utf8');

const FWD      = read('supabase/plan-entitlements-forward.sql');
const VERIFY   = read('supabase/plan-entitlements-verify.sql');
const ROLLBACK = read('supabase/plan-entitlements-ROLLBACK.sql');

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

// ── A. a browser role cannot touch the ledger ────────────────────────────────
//
// The reason this needs its own section: this project's default privileges in
// schema public grant arwdDxtm -- everything, TRUNCATE included -- to anon and
// authenticated on every new table. A bare CREATE TABLE here is world-writable.
// That is how pending_signups and console_audit got the grants earlier phases
// had to strip. So the REVOKE is load-bearing, not hygiene.

test('anon and authenticated are stripped of every privilege', () => {
  assert.match(FWD_CODE, /revoke all on public\.plan_entitlements from anon, authenticated/);
  assert.match(FWD_CODE, /revoke all on public\.plan_entitlements from public/);
});

test('the revoke runs in the same transaction as the create, so the table is never briefly open', () => {
  const begin  = FWD_CODE.indexOf('begin');
  const create = FWD_CODE.indexOf('create table if not exists public.plan_entitlements');
  const revoke = FWD_CODE.indexOf('revoke all on public.plan_entitlements from anon');
  const commit = FWD_CODE.indexOf('commit');
  assert.ok(begin > -1 && create > begin, 'the create is inside a transaction');
  assert.ok(revoke > create, 'revoked after it exists');
  assert.ok(revoke < commit, 'and before anything else can see it');
});

test('anon and authenticated are never granted anything, anywhere in the file', () => {
  const grants = FWD_CODE.match(/grant[^;]*;/g) ?? [];
  for (const g of grants) {
    assert.equal(/\banon\b/.test(g), false, `browser grant found: ${g.trim()}`);
    assert.equal(/\bauthenticated\b/.test(g), false, `browser grant found: ${g.trim()}`);
  }
});

test('RLS is enabled and no policy is ever created', () => {
  assert.match(FWD_CODE, /alter table public\.plan_entitlements enable row level security/);
  assert.equal(/create policy/i.test(FWD_CODE), false,
    'zero policies is what makes RLS a real second lock');
});

test('service_role can write but cannot erase the evidence', () => {
  assert.match(FWD_CODE, /grant select, insert, update on public\.plan_entitlements to service_role/);
  const grants = FWD_CODE.match(/grant[^;]*;/g) ?? [];
  for (const g of grants) {
    assert.equal(/\bdelete\b/i.test(g), false, 'no DELETE grant');
    assert.equal(/\btruncate\b/i.test(g), false, 'no TRUNCATE grant');
  }
});

test('service_role is revoked BEFORE it is granted, or the defaults survive', () => {
  // The schema default hands service_role arwdDxtm too. Granting a subset does
  // not remove a privilege that is already there, so without this revoke the
  // role keeps DELETE and TRUNCATE. A rolled-back dry run of the forward file
  // caught exactly that: service_role read DELETE,INSERT,REFERENCES,SELECT,
  // TRIGGER,TRUNCATE,UPDATE instead of INSERT,SELECT,UPDATE.
  const revoke = FWD_CODE.indexOf('revoke all on public.plan_entitlements from service_role');
  const grant  = FWD_CODE.indexOf('grant select, insert, update on public.plan_entitlements to service_role');
  assert.ok(revoke > -1, 'service_role must be revoked first');
  assert.ok(revoke < grant, 'and the revoke must come before the grant');
  // The verifier pins the exact resulting privilege set.
  assert.match(VERIFY, /= 'INSERT,SELECT,UPDATE'/);
});

test('the migration creates no function at all, so there is no RPC to manufacture an entitlement', () => {
  assert.equal(/create (or replace )?function/i.test(FWD_CODE), false);
  // ...and the verifier fails if one ever appears that a browser role can call.
  assert.match(VERIFY, /A5 no RPC exists that lets a browser role manufacture an entitlement/);
  assert.match(VERIFY, /has_function_privilege\('anon', p\.oid, 'EXECUTE'\)/);
});

// ── B. the honesty rules ─────────────────────────────────────────────────────

test('every imported row is written unverified', () => {
  const insert = FWD.slice(FWD.indexOf('insert into public.plan_entitlements'));
  // verified_at is the last column of the insert, and the last value of the
  // select is a literal null -- so no import can ever carry a payment proof.
  assert.match(insert, /razorpay_subscription_id, idempotency_key, verified_at\s*\)/);
  assert.match(insert, /'migration_backfill:' \|\| s\.slug,\s*\n\s*null\b/,
    'the value after idempotency_key is verified_at, and it is null');
  assert.match(insert, /'migration_backfill',/, 'source says where it came from too');
  // Nothing in the import may put a timestamp into verified_at.
  const selectList = insert.slice(insert.indexOf('select'), insert.indexOf('from public.stores'));
  assert.equal(/now\(\)|current_timestamp/i.test(selectList), false,
    'no clock value may reach verified_at');
});

test('a constraint makes "imported is never verified payment" permanent', () => {
  assert.match(FWD, /constraint plan_entitlements_imported_is_never_verified check \(\s*source <> 'migration_backfill' or verified_at is null\s*\)/);
});

test('the other direction is constrained too: a payment source must carry its proof', () => {
  assert.match(FWD, /plan_entitlements_payment_sources_are_verified check \(\s*source not in \('razorpay_subscription', 'razorpay_payment'\)\s*or verified_at is not null\s*\)/);
});

test('no Razorpay evidence is invented for the console-billed stores', () => {
  // Five stores carry a billingNote and none of them has a payment reference.
  // The backfill must read razorpay_subscription_id and nothing else.
  const insert = FWD.slice(FWD.indexOf('insert into public.plan_entitlements'));
  assert.equal(/billingNote/.test(insert), false, 'the backfill must not mine billingNote for evidence');
  assert.equal(/razorpay_payment_id/.test(FWD_CODE), false, 'no payment-id column exists to invent one in');
});

// ── C. parity: nothing about who is entitled may change ──────────────────────

test('plan, expiry and subscription id are copied verbatim, never recomputed', () => {
  const insert = FWD.slice(FWD.indexOf('insert into public.plan_entitlements'));
  assert.match(insert, /coalesce\(s\.config->>'plan', 'free'\)/);
  assert.match(insert, /\(s\.config->>'planExpiresAt'\)::timestamptz/);
  assert.match(insert, /s\.config->>'razorpaySubscriptionId'/);
  // Nothing that would move an expiry.
  assert.equal(/interval|now\(\) \+|\+ \d+ \* 86400/.test(insert), false,
    'an import must not extend or shorten anything');
});

test('a missing expiry imports as NULL, not as a date', () => {
  // Two production stores hold a paid plan with no planExpiresAt and are
  // entitled indefinitely. jsonb_typeof guards against the JSON null becoming
  // the string "null".
  const insert = FWD.slice(FWD.indexOf('insert into public.plan_entitlements'));
  assert.match(insert, /jsonb_typeof\(s\.config->'planExpiresAt'\) = 'string'/);
  assert.match(insert, /jsonb_typeof\(s\.config->'razorpaySubscriptionId'\) = 'string'/);
});

test('lapsed stores stay lapsed because in-force is derived, not frozen into status', () => {
  // status='active' means "this grant stands", not "this plan is in force".
  // If the migration wrote an 'expired' status instead, a time-derived fact
  // would be frozen into a column and go stale.
  const insert = FWD.slice(FWD.indexOf('insert into public.plan_entitlements'));
  assert.equal(/'expired'|'lapsed'/.test(insert), false);
  assert.match(FWD, /plan_entitlements_status_known check \(\s*status in \('active', 'superseded', 'revoked'\)\s*\)/);
  // ...and the verifier re-derives it the way effectivePlan() does.
  assert.match(VERIFY, /P4 in-force parity/);
  assert.match(VERIFY, /e\.expires_at is null or e\.expires_at > now\(\)/);
});

test('the migration never writes to stores', () => {
  assert.equal(/update\s+public\.stores/i.test(FWD_CODE), false);
  assert.equal(/insert\s+into\s+public\.stores/i.test(FWD_CODE), false);
  assert.equal(/delete\s+from\s+public\.stores/i.test(FWD_CODE), false);
  // public.stores appears only as a read source and as the FK target.
  assert.match(FWD_CODE, /references public\.stores\(slug\) on delete restrict/);
  assert.match(FWD_CODE, /from public\.stores s/);
});

// ── D. idempotency ───────────────────────────────────────────────────────────

test('a rerun inserts nothing: the key is unique and the insert yields on conflict', () => {
  assert.match(FWD, /'migration_backfill:' \|\| s\.slug/);
  assert.match(FWD_CODE, /constraint plan_entitlements_idempotency_key_key unique \(idempotency_key\)/);
  assert.match(FWD_CODE, /on conflict \(idempotency_key\) do nothing/);
});

test('every object is created if-not-exists, so a partial run can be repeated', () => {
  assert.match(FWD_CODE, /create table if not exists public\.plan_entitlements/);
  for (const idx of ['plan_entitlements_store_slug_idx',
                     'plan_entitlements_store_active_idx',
                     'plan_entitlements_subscription_idx']) {
    assert.match(FWD_CODE, new RegExp(`create index if not exists ${idx}`));
  }
});

test('the verifier fails if a rerun ever does duplicate a store', () => {
  assert.match(VERIFY, /E2 no store was imported twice/);
  assert.match(VERIFY, /group by store_slug having count\(\*\) > 1/);
});

// ── E. external identifiers, against inspected production reality ────────────

test('razorpay_subscription_id is nullable and deliberately NOT unique', () => {
  // 29 of 36 stores have no subscription id, so NOT NULL would reject them.
  // 0 of the 7 that do have one are duplicated -- so a UNIQUE constraint would
  // pass today, which is exactly why leaving it out has to be deliberate: the
  // ledger is append-only and every renewal reuses the same subscription id.
  const table = FWD_CODE.slice(FWD_CODE.indexOf('create table if not exists'),
                               FWD_CODE.indexOf('comment on table'));
  assert.match(table, /razorpay_subscription_id text,/);
  assert.equal(/razorpay_subscription_id[^,]*not null/.test(table), false);
  assert.equal(/unique[^;]*razorpay_subscription_id/i.test(FWD_CODE), false);
  assert.equal(/create unique index[^;]*razorpay_subscription_id/i.test(FWD_CODE), false);
  assert.match(VERIFY, /S3 razorpay_subscription_id is deliberately NOT unique/);
});

test('no format CHECK is imposed on a third party identifier', () => {
  // All 7 production values match ^sub_[A-Za-z0-9]+$, but a hard constraint on
  // Razorpay's id format has one failure mode: a webhook INSERT rejecting a
  // real payment.
  assert.equal(/razorpay_subscription_id\s*~/.test(FWD_CODE), false);
});

test('the plan CHECK admits every retired plan key, because grandfathered mandates still renew', () => {
  assert.match(FWD, /plan in \('free', 'starter', 'pro', 'business', 'premium', 'premium_plus'\)/);
});

// ── F. scope: this PR closes nothing and must change nothing ─────────────────

test('the migration does not touch any existing billing object', () => {
  for (const forbidden of ['upgrade_store_plan', 'pending_signups', 'update_store_config',
                           'console_update_store', 'verify_store_pin', 'otp_consume',
                           'create_order_secure', 'order_integrity', 'order_pricing_shadow',
                           'orders_insert_guard', 'trg_decrement_stock']) {
    assert.equal(FWD_CODE.includes(forbidden), false,
      `${forbidden} must not appear in executable code - this PR is additive only`);
  }
});

test('the migration alters no grant on anything that already existed', () => {
  const statements = (FWD_CODE.match(/(grant|revoke)[^;]*;/gi) ?? []);
  for (const s of statements) {
    assert.match(s, /plan_entitlements/,
      `every grant/revoke must be about the new table, found: ${s.trim()}`);
  }
});

test('the phase 3B search_path sweep has not snuck in', () => {
  assert.equal(/alter function/i.test(FWD_CODE), false);
  assert.equal(/set search_path/i.test(FWD_CODE), false);
});

test('no client code is needed, so nothing here implies a deploy', () => {
  assert.match(FWD, /THIS MIGRATION IS NOT AN AUTHORITY SWITCH/);
  assert.match(FWD, /The application keeps reading stores\.config/);
});

// ── G. the verifier itself ───────────────────────────────────────────────────

test('the verifier is one read-only SELECT', () => {
  const code = VERIFY.replace(/--.*$/gm, '').trim();
  assert.ok(/^select\b/i.test(code), 'starts with select');
  assert.equal((code.match(/;/g) ?? []).length, 1, 'exactly one statement');
  assert.ok(code.endsWith(';'));
  for (const w of ['insert ', 'update ', 'delete ', 'create ', 'drop ', 'alter ',
                   'grant ', 'revoke ', 'truncate ', 'set role']) {
    assert.equal(stripToCode(VERIFY).toLowerCase().includes(w), false,
      `the verifier must not contain ${w.trim()}`);
  }
});

test('the verifier survives running BEFORE the table exists', () => {
  // Phase 2 lost a cycle to a verifier that crashed with 42P01 pre-install.
  // Anything that may not exist must travel as text.
  assert.equal(/from public\.plan_entitlements/.test(stripToCode(VERIFY)), false,
    'a static FROM would be resolved at parse time and crash');
  assert.match(VERIFY, /to_regclass\('public\.plan_entitlements'\)/);
  assert.match(VERIFY, /query_to_xml\(/);
  const guards = VERIFY.match(/to_regclass\('public\.plan_entitlements'\) is null then 'N\/A/g) ?? [];
  assert.ok(guards.length >= 12, `every ledger row needs a guard, found ${guards.length}`);
});

test('the verifier proves the migration changed nothing that already existed', () => {
  assert.match(VERIFY, /B1 stores plan fingerprint \(MUST be identical before\/after\)/);
  assert.match(VERIFY, /B2 upgrade_store_plan source md5/);
  assert.match(VERIFY, /B3 upgrade_store_plan grants \(MUST still include anon/);
  assert.match(VERIFY, /B4 update_store_config source md5/);
  assert.match(VERIFY, /B5 console_update_store source md5/);
  assert.match(VERIFY, /B6 pending_signups policies \+ grants fingerprint/);
  assert.match(VERIFY, /B7 phase 1 and 2 protections still in place/);
});

test('the baseline fingerprints are pinned to the values read from production', () => {
  assert.match(VERIFY, /9f6bbf1eafb22765dc601eb11fc2dfcb/);  // upgrade_store_plan
  assert.match(VERIFY, /c3c6da5207a9561e79f7692383ffab1d/);  // update_store_config
  assert.match(VERIFY, /9d85170522f1c347d49bb2f0dd65016a/);  // console_update_store
});

// ── H. rollback ──────────────────────────────────────────────────────────────

test('the rollback refuses once anything but the migration has written the ledger', () => {
  assert.match(ROLLBACK, /source <> ''migration_backfill''/);
  assert.match(ROLLBACK, /REFUSED - %s entitlements were written by something other than the/);
});

test('the rollback refuses if any function references the ledger', () => {
  assert.match(ROLLBACK, /prosrc ilike '%plan_entitlements%'/);
  assert.match(ROLLBACK, /REFUSED - these functions reference the ledger/);
});

test('the rollback refuses if a view or other object depends on the ledger', () => {
  assert.match(ROLLBACK, /REFUSED - these objects depend on the ledger/);
  assert.match(ROLLBACK, /pg_depend/);
});

test('the guard runs before the drop, inside the same transaction', () => {
  const code = stripToCode(ROLLBACK);
  const begin = code.indexOf('begin');
  const guard = ROLLBACK.indexOf('$guard$');
  const drop  = code.indexOf('drop table if exists public.plan_entitlements');
  const commit = code.lastIndexOf('commit');
  assert.ok(begin > -1 && guard > begin);
  assert.ok(drop > begin && drop < commit, 'the drop is inside the transaction');
  assert.ok(ROLLBACK.indexOf('$guard$') < ROLLBACK.indexOf('drop table'));
});

test('the rollback does not cascade and reverts nothing else', () => {
  const code = stripToCode(ROLLBACK);
  assert.equal(/cascade/i.test(code), false, 'a surprise dependency should stop the drop');
  assert.equal(/grant |revoke /i.test(code), false, 'PR 1 altered no existing grant to restore');
  for (const forbidden of ['upgrade_store_plan', 'pending_signups', 'public.stores']) {
    assert.equal(code.includes(forbidden), false, `${forbidden} must not be touched on undo`);
  }
});

// ── I. no raise message may contain a semicolon ──────────────────────────────

test('raise messages carry no semicolon, which would break a one-statement paste', () => {
  for (const [name, sql] of [['forward', FWD], ['rollback', ROLLBACK]]) {
    for (const m of sql.match(/message\s*=\s*format\([^)]*\)/g) ?? []) {
      assert.equal(m.includes(';'), false, `${name}: ${m}`);
    }
  }
});
