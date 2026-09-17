// Phase 3C PR 2: the server-authoritative entitlement writer.
//
// shared/razorpay-plans.mjs is pure, so the derivation rules get real
// executable tests -- forged inputs go in, and what comes out is checked. The
// SQL writer and the edge function cannot run from here, so those are read the
// way a reviewer has to: what they do, in what order, with which privileges.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  PLAN_BY_ID, KNOWN_PLANS, GRACE_MS, CYCLE_DAYS, PAID_STATUSES,
  planFromSubscription, expiryFromSubscription, startFromSubscription,
  cycleIdempotencyKey, resolveActivation, phoneLast10,
  isSubscriptionId, isPaymentId, isSignature,
} from '../shared/razorpay-plans.mjs';

const read = (p) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), 'utf8');

const FWD = read('supabase/plan-activation-forward.sql');
const VERIFY = read('supabase/plan-activation-verify.sql');
const ROLLBACK = read('supabase/plan-activation-ROLLBACK.sql');
const FN = read('supabase/functions/plan-activate/index.ts');
const WEBHOOK = read('supabase/functions/razorpay-webhook/index.ts');
const LEDGER_FWD = read('supabase/plan-entitlements-forward.sql');

/** The edge function with its leading documentation block removed, so that
 *  ordering assertions measure the CODE and not the comment that describes it. */
const FN_CODE = FN.slice(FN.indexOf("import { serve }"));

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

const WRITER = FWD.slice(FWD.indexOf('create or replace function public.apply_plan_entitlement'),
                         FWD.indexOf('$function$;'));

/** A realistic Razorpay subscription entity: premium monthly, one charge paid. */
const NOW = Date.UTC(2026, 8, 17, 6, 0, 0);
const sub = (over = {}) => ({
  id: 'sub_RealMandate123',
  entity: 'subscription',
  plan_id: 'plan_TX4Yj0ktnJ9Ic3',          // premium monthly
  status: 'active',
  current_start: Math.floor(NOW / 1000) - 86400,
  current_end: Math.floor(NOW / 1000) + 30 * 86400,
  paid_count: 1,
  total_count: 120,
  notes: { plan: 'premium', period: 'monthly', phone: '919175187668' },
  ...over,
});

// ── A. the browser is authoritative for nothing ──────────────────────────────

test('a forged plan in notes is ignored: the plan comes from plan_id alone', () => {
  // notes are written from the browser's request body by
  // create-razorpay-subscription, so they can never decide what was bought.
  const forged = sub({ plan_id: 'plan_T534Tj7pKAPhOP',      // starter monthly
                       notes: { plan: 'premium', period: 'yearly', phone: '919175187668' } });
  assert.equal(planFromSubscription(forged).plan, 'starter');
  assert.equal(resolveActivation(forged, NOW).plan, 'starter');
  // and the period likewise comes from the mapping, not from notes
  assert.equal(resolveActivation(forged, NOW).period, 'monthly');
});

test('an unknown plan_id is refused, never guessed', () => {
  // Guessing is how a retired price becomes a free upgrade.
  assert.equal(planFromSubscription(sub({ plan_id: 'plan_NotOurs' })), null);
  assert.equal(planFromSubscription(sub({ plan_id: '' })), null);
  assert.equal(planFromSubscription({}), null);
  const r = resolveActivation(sub({ plan_id: 'plan_NotOurs' }), NOW);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'plan_unresolved');
});

test('a prototype-polluting plan_id cannot resolve to a plan', () => {
  for (const evil of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
    assert.equal(planFromSubscription(sub({ plan_id: evil })), null, evil);
  }
});

test('a forged expiry is ignored: the expiry is derived from current_end', () => {
  const forged = sub({ current_end: Math.floor(NOW / 1000) + 10 * 86400 });
  const got = resolveActivation(forged, NOW).expiresAt;
  const want = new Date((Math.floor(NOW / 1000) + 10 * 86400) * 1000 + GRACE_MS).toISOString();
  assert.equal(got, want);
  // Nothing in the resolver reads a caller-supplied date.
  assert.equal(resolveActivation({ ...forged, expires_at: '2099-01-01T00:00:00Z' }, NOW).expiresAt, want);
});

test('a missing current_end falls back to one cycle, never to nothing', () => {
  const monthly = resolveActivation(sub({ current_end: undefined }), NOW);
  assert.equal(monthly.expiresAt,
    new Date(NOW + CYCLE_DAYS.monthly * 86400000 + GRACE_MS).toISOString());
  const yearly = resolveActivation(
    sub({ current_end: 0, plan_id: 'plan_TX4a4orxglrlrC' }), NOW);
  assert.equal(yearly.expiresAt,
    new Date(NOW + CYCLE_DAYS.yearly * 86400000 + GRACE_MS).toISOString());
});

test('a forged subscription id cannot be substituted: shape is checked and the fetch is authoritative', () => {
  assert.equal(isSubscriptionId('sub_Real123'), true);
  for (const bad of ['sub_', 'pay_Real123', 'sub_ 123', "sub_'; drop", '', null, 42, {}]) {
    assert.equal(isSubscriptionId(bad), false, String(bad));
  }
  // The function re-checks the FETCHED entity's id against the submitted one,
  // so a signature replayed against a different subscription cannot land.
  assert.match(FN, /if \(sub\?\.id !== subscriptionId\)/);
});

test('the resolver reads only fields that come from the fetched entity', () => {
  const r = resolveActivation(sub(), NOW);
  assert.deepEqual(Object.keys(r).sort(), [
    'expiresAt', 'idempotencyKey', 'ok', 'ownerPhoneLast10', 'period',
    'plan', 'razorpayPlanId', 'startsAt', 'subscriptionId',
  ]);
  assert.equal(r.subscriptionId, 'sub_RealMandate123');
  assert.equal(r.razorpayPlanId, 'plan_TX4Yj0ktnJ9Ic3');
});

// ── B. payment proof ─────────────────────────────────────────────────────────

test('the edge function refuses any field beyond the three identifiers', () => {
  assert.match(FN, /const ALLOWED_FIELDS = \['razorpay_payment_id', 'razorpay_subscription_id', 'razorpay_signature'\]/);
  assert.match(FN, /const extra = Object\.keys\(body\)\.filter\(\(k\) => !ALLOWED_FIELDS\.includes\(k\)\)/);
  assert.match(FN, /if \(extra\.length > 0\)/);
  // Refused, not ignored -- nobody may send plan and get a success back.
  const guard = FN.slice(FN.indexOf('const extra ='), FN.indexOf('const paymentId'));
  assert.match(guard, /return refuse\(\)/);
});

test('the signature is verified before anything else happens', () => {
  const sig = FN_CODE.indexOf('timingSafeEqual(expected, signature');
  const fetchSub = FN_CODE.indexOf('api.razorpay.com/v1/subscriptions');
  const rpc = FN_CODE.indexOf("supabase.rpc('apply_plan_entitlement'");
  assert.ok(sig > -1 && fetchSub > sig, 'the fetch happens only after the signature matches');
  assert.ok(rpc > fetchSub, 'the write happens only after the authoritative fetch');
  assert.match(FN, /hmacHex\(keySecret, `\$\{paymentId\}\|\$\{subscriptionId\}`\)/);
});

test('signature comparison is constant time', () => {
  assert.match(FN, /function timingSafeEqual/);
  assert.match(FN, /diff \|= a\.charCodeAt\(i\) \^ b\.charCodeAt\(i\)/);
  assert.equal(/expected === signature|signature === expected/.test(FN), false);
});

test('an invalid payment proof is rejected and nothing is written', () => {
  const mismatch = FN_CODE.slice(FN_CODE.indexOf('if (!timingSafeEqual'),
                                 FN_CODE.indexOf('api.razorpay.com'));
  assert.match(mismatch, /return refuse\(\)/);
  assert.ok(FN_CODE.indexOf('if (!timingSafeEqual')
            < FN_CODE.indexOf("supabase.rpc('apply_plan_entitlement'"));
});

test('only a paid subscription can grant anything', () => {
  assert.deepEqual([...PAID_STATUSES], ['active', 'completed']);
  for (const status of ['created', 'authenticated', 'pending', 'halted', 'cancelled', 'expired', 'paused']) {
    const r = resolveActivation(sub({ status }), NOW);
    assert.equal(r.ok, false, status);
    assert.equal(r.reason, 'subscription_not_paid');
  }
  assert.equal(resolveActivation(sub({ status: 'active' }), NOW).ok, true);
  assert.equal(resolveActivation(sub({ status: 'completed' }), NOW).ok, true);
});

test('a stale subscription with no successful charge cannot grant', () => {
  for (const paid_count of [0, -1, undefined, null, 1.5, '1']) {
    const r = resolveActivation(sub({ paid_count }), NOW);
    assert.equal(r.ok, false, String(paid_count));
    assert.equal(r.reason, 'cycle_unresolved');
  }
});

// ── C. idempotency identity ──────────────────────────────────────────────────

test('the identity is one grant per subscription per billing cycle', () => {
  assert.equal(cycleIdempotencyKey(sub()), 'razorpay_subscription:sub_RealMandate123:1');
  assert.equal(cycleIdempotencyKey(sub({ paid_count: 2 })), 'razorpay_subscription:sub_RealMandate123:2');
});

test('a retry of the same charge produces the SAME key', () => {
  // Same entity fetched twice -- browser retry, double click, reload.
  assert.equal(cycleIdempotencyKey(sub()), cycleIdempotencyKey(sub()));
  // Even when the clock moved and current_end was republished.
  assert.equal(cycleIdempotencyKey(sub({ current_end: 999 })), cycleIdempotencyKey(sub()));
});

test('a renewal produces a DIFFERENT key, so subscription_id alone must not be unique', () => {
  assert.notEqual(cycleIdempotencyKey(sub({ paid_count: 1 })), cycleIdempotencyKey(sub({ paid_count: 2 })));
  // ...which is exactly why PR 1 left razorpay_subscription_id non-unique, and
  // why this PR must not add such an index.
  assert.equal(/unique[^;]*razorpay_subscription_id/i.test(stripToCode(FWD)), false);
  assert.match(VERIFY, /L4 razorpay_subscription_id is still NOT unique/);
});

test('the key is derived from the subscription entity, so webhook and browser collapse to one row', () => {
  // A payment-id key could not do this: subscription.activated carries no
  // payment entity, so the webhook could not reproduce it.
  assert.equal(/payment_id/.test(cycleIdempotencyKey(sub())), false);
  assert.match(FN, /p_idempotency_key: resolved\.idempotencyKey/);
});

test('different subscriptions never share a key', () => {
  assert.notEqual(cycleIdempotencyKey(sub({ id: 'sub_A' })), cycleIdempotencyKey(sub({ id: 'sub_B' })));
});

test('a malformed subscription yields no key at all', () => {
  assert.equal(cycleIdempotencyKey(null), null);
  assert.equal(cycleIdempotencyKey({ id: 'nope', paid_count: 1 }), null);
});

// ── D. the SQL writer ────────────────────────────────────────────────────────

test('a valid activation writes exactly one verified entitlement', () => {
  assert.match(WRITER, /insert into public\.plan_entitlements \(/);
  assert.match(WRITER, /on conflict \(idempotency_key\) do nothing/);
  assert.match(FN, /p_source: 'razorpay_subscription'/);
  assert.match(FN, /p_verified_at: new Date\(\)\.toISOString\(\)/);
  // The ledger constraint from PR 1 forces verified_at to be present for this
  // source, so an unverified razorpay grant cannot be written at all.
  assert.match(LEDGER_FWD, /plan_entitlements_payment_sources_are_verified/);
});

test('verified_at is set by the server, never accepted from the browser', () => {
  assert.equal(/verified_at/.test(JSON.stringify(Object.keys(resolveActivation(sub(), NOW)))), false,
    'the resolver does not even carry a verified_at to be forged');
  assert.match(FN, /p_verified_at: new Date\(\)\.toISOString\(\)/);
});

test('the store is resolved inside the writer, so no caller can name one', () => {
  assert.equal(/p_store_slug/.test(stripToCode(FWD)), false, 'there is no store argument to forge');
  assert.match(WRITER, /right\(regexp_replace\(coalesce\(s\.config->>'whatsappNumber', ''\), '\\D', '', 'g'\), 10\)/);
  assert.equal(/store_slug/.test(FN_CODE), false, 'the edge function never mentions a store');
});

test('the store is locked before the ledger is touched, in one lock order', () => {
  const lock = WRITER.indexOf('for update');
  const insert = WRITER.indexOf('insert into public.plan_entitlements');
  const update = WRITER.indexOf('update public.stores s');
  assert.ok(lock > -1 && lock < insert, 'store locked before the ledger insert');
  assert.ok(insert < update, 'and the projection follows the claim');
});

test('an ambiguous owner is refused rather than resolved arbitrarily', () => {
  assert.match(WRITER, /if v_matches > 1 then/);
  assert.match(WRITER, /'owner_ambiguous'/);
});

test('no store yet is a benign no-op, not an error and not a write', () => {
  // The paid-before-building case still belongs to the existing
  // pending_signups path, which this PR does not touch.
  const branch = WRITER.slice(WRITER.indexOf('if v_matches = 0 then'), WRITER.indexOf('if v_matches > 1'));
  assert.match(branch, /'store_not_found'/);
  assert.match(branch, /'activated', false/);
  assert.equal(/insert into/.test(branch), false, 'nothing is written when there is no store');
});

test('a replay carrying a different grant is refused, not silently accepted', () => {
  assert.match(WRITER, /if not v_created then/);
  assert.match(WRITER, /v_existing\.store_slug is distinct from v_slug/);
  assert.match(WRITER, /v_existing\.plan is distinct from p_plan/);
  assert.match(WRITER, /'idempotency_conflict'/);
});

test('the projection never reduces an entitlement', () => {
  // An indefinite store stays indefinite; otherwise the expiry only moves
  // forward, so an out-of-order replay cannot shorten a paid term.
  assert.match(WRITER, /v_new_expiry := null;/);
  assert.match(WRITER, /greatest\(v_cur_expiry, p_expires_at\)/);
});

test('the projection is atomic with the ledger write', () => {
  const code = stripToCode(FWD);
  assert.match(code, /begin/);
  assert.match(code, /commit/);
  // One function, one transaction: there is no second RPC the caller could
  // half-complete.
  assert.equal((FN.match(/supabase\.rpc\(/g) ?? []).length, 1);
});

test('stores.config projection matches the entitlement it came from', () => {
  assert.match(WRITER, /'plan', to_jsonb\(p_plan\)/);
  assert.match(WRITER, /'razorpaySubscriptionId'/);
  // and it writes the same ISO shape the rest of the codebase stores
  assert.match(WRITER, /YYYY-MM-DD"T"HH24:MI:SS\.MS"Z"/);
});

// ── E. the browser cannot reach the writer ───────────────────────────────────

test('EXECUTE is revoked from the browser roles in the same transaction as the create', () => {
  // The schema default grants EXECUTE on every new function to anon and
  // authenticated -- that is exactly how upgrade_store_plan became callable.
  const code = stripToCode(FWD);
  const create = code.indexOf('create or replace function public.apply_plan_entitlement');
  const revoke = code.indexOf('revoke all on function public.apply_plan_entitlement');
  const grant = code.indexOf('grant execute on function public.apply_plan_entitlement');
  const commit = code.lastIndexOf('commit');
  assert.ok(create > -1 && revoke > create, 'revoked after it exists');
  assert.ok(revoke < grant, 'and before it is granted back');
  assert.ok(grant < commit, 'all inside the one transaction');
  assert.match(code, /from public, anon, authenticated/);
  assert.match(code, /to service_role/);
});

test('service_role is the only grantee', () => {
  const grants = stripToCode(FWD).match(/grant[^;]*;/g) ?? [];
  assert.ok(grants.length >= 1);
  for (const g of grants) {
    assert.equal(/\banon\b|\bauthenticated\b/.test(g), false, `browser grant: ${g.trim()}`);
    assert.match(g, /service_role/);
  }
});

test('the verifier fails if a browser role can ever execute the writer', () => {
  assert.match(VERIFY, /W4 anon and authenticated CANNOT execute the writer/);
  assert.match(VERIFY, /FAIL - a browser role can manufacture entitlements/);
  assert.match(VERIFY, /W6 no OTHER browser-callable function touches the ledger/);
});

test('the writer is SECURITY INVOKER with a pinned search_path', () => {
  assert.match(WRITER, /security invoker/);
  assert.match(WRITER, /set search_path = public, pg_temp/);
  assert.equal(/security definer/.test(WRITER), false);
  assert.match(VERIFY, /W2 it is SECURITY INVOKER, not DEFINER/);
});

// ── F. secrets and error hygiene ─────────────────────────────────────────────

test('no secret is ever returned or logged', () => {
  for (const secret of ['RAZORPAY_KEY_SECRET', 'SUPABASE_SERVICE_ROLE_KEY', 'RAZORPAY_KEY_ID']) {
    assert.match(FN, new RegExp(`Deno\\.env\\.get\\('${secret}'\\)`), `${secret} is read server-side`);
  }
  // A secret leaks only when it is INTERPOLATED into the message. The word
  // "signature" appearing in prose is fine -- `${signature}` would not be.
  for (const log of FN_CODE.match(/console\.(log|error)\([^;]*\);/g) ?? []) {
    for (const leak of ['keySecret', 'serviceKey', 'keyId', 'signature', 'expected', 'body']) {
      assert.equal(log.includes('${' + leak + '}'), false, `log leaks ${leak}: ${log.trim()}`);
    }
  }
});

test('external errors are generic and never name the internal reason', () => {
  assert.match(FN, /const refuse = \(\) => json\(\{ ok: false, error: 'invalid_request' \}, 400\)/);
  assert.match(FN, /const unavailable = \(\) => json\(\{ ok: false, error: 'temporarily_unavailable' \}, 503\)/);
  // Razorpay's own error body is never forwarded.
  assert.equal(/await res\.text\(\)|JSON\.stringify\(data\)/.test(FN), false);
  // The resolver's reason is logged, not returned.
  assert.match(FN, /console\.error\(`plan-activate: \$\{resolved\.reason\}/);
});

test('missing configuration fails closed without naming what is missing', () => {
  assert.match(FN, /if \(!keyId \|\| !keySecret \|\| !supabaseUrl \|\| !serviceKey\)/);
  assert.match(FN, /plan-activate: required configuration is absent/);
});

test('the successful response reveals nothing about the store', () => {
  assert.match(FN, /return json\(\{ ok: true, activated: Boolean\(data\.activated\) \}\)/);
  assert.equal(/store_slug: data|data\.store_slug/.test(FN), false);
});

// ── G. one shared authority, no second implementation ────────────────────────

test('the plan mapping the webhook uses has not drifted from the shared module', () => {
  // PR 2 does not modify the webhook -- pointing it at this module changes
  // every renewal in production and belongs in its own PR. Until then this
  // test is what stops the two copies diverging.
  const block = WEBHOOK.slice(WEBHOOK.indexOf('const PLAN_BY_ID'), WEBHOOK.indexOf('};', WEBHOOK.indexOf('const PLAN_BY_ID')));
  const fromWebhook = {};
  for (const m of block.matchAll(/(plan_[A-Za-z0-9]+):\s*\{\s*plan:\s*'([a-z_]+)',\s*period:\s*'([a-z]+)'\s*\}/g)) {
    fromWebhook[m[1]] = { plan: m[2], period: m[3] };
  }
  assert.deepEqual(fromWebhook, JSON.parse(JSON.stringify(PLAN_BY_ID)),
    'the webhook map and shared/razorpay-plans.mjs must stay identical');
});

test('every mapped plan is a plan the ledger will accept', () => {
  for (const [id, v] of Object.entries(PLAN_BY_ID)) {
    assert.ok(KNOWN_PLANS.includes(v.plan), `${id} maps to an unknown plan`);
    assert.ok(['monthly', 'yearly'].includes(v.period), `${id} has a bad period`);
  }
  assert.match(LEDGER_FWD, /plan in \('free', 'starter', 'pro', 'business', 'premium', 'premium_plus'\)/);
});

test('this PR does not change the webhook', () => {
  assert.equal(/apply_plan_entitlement|plan_entitlements|razorpay-plans/.test(WEBHOOK), false,
    'the webhook must be byte-identical to main in this PR');
});

// ── H. scope: PR 2 closes nothing ────────────────────────────────────────────

test('upgrade_store_plan is not modified, not revoked, not mentioned in executable SQL', () => {
  assert.equal(/upgrade_store_plan/.test(stripToCode(FWD)), false);
  assert.equal(/upgrade_store_plan/.test(stripToCode(ROLLBACK)), false);
  // ...and the verifier FAILS if it ever stops being anon-executable here.
  assert.match(VERIFY, /G1 upgrade_store_plan UNCHANGED and STILL anon-executable/);
  assert.match(VERIFY, /FAIL - PR 2 must not modify or close the legacy path/);
});

test('pending_signups is untouched and protected by the verifier', () => {
  assert.equal(/pending_signups/.test(stripToCode(FWD)), false);
  assert.equal(/pending_signups/.test(stripToCode(ROLLBACK)), false);
  assert.match(VERIFY, /G2 pending_signups policies and grants unchanged/);
});

test('phase 2 and the search_path sweep are untouched', () => {
  const code = stripToCode(FWD);
  for (const forbidden of ['create_order_secure', 'order_integrity', 'order_pricing_shadow',
                           'orders_insert_guard', 'trg_decrement_stock', 'order_requests']) {
    assert.equal(code.includes(forbidden), false, `${forbidden} must not appear`);
  }
  assert.equal(/alter function/i.test(code), false, 'no search_path sweep');
  assert.match(VERIFY, /G3 phase 1 and phase 2 protections intact/);
});

test('the 36 imported rows are not rewritten, only extended with nullable columns', () => {
  const code = stripToCode(FWD);
  assert.equal(/update public\.plan_entitlements/i.test(code), false, 'no backfill row is rewritten');
  assert.equal(/delete from public\.plan_entitlements/i.test(code), false);
  assert.match(code, /add column if not exists razorpay_payment_id text/);
  assert.match(code, /add column if not exists razorpay_plan_id\s+text/);
  assert.equal(/not null/i.test(code.slice(code.indexOf('add column if not exists razorpay_payment_id'),
                                           code.indexOf('comment on column'))), false,
    'the new columns must be nullable or the 36 existing rows would fail');
  assert.match(VERIFY, /L1 the 36 imported rows are still 36, still imported, still unverified/);
});

test('the new constraint cannot reject an existing imported row', () => {
  // It only binds source='razorpay_subscription'; all 36 rows are
  // migration_backfill, so it is satisfied vacuously for every one of them.
  assert.match(FWD, /source <> 'razorpay_subscription'\s*\n\s*or \(razorpay_subscription_id is not null and razorpay_plan_id is not null\)/);
});

test('the migration writes no store', () => {
  const code = stripToCode(FWD);
  const outsideWriter = code.slice(0, code.indexOf('create or replace function'))
                      + code.slice(code.indexOf('$BLOCK$', code.indexOf('create or replace function')));
  assert.equal(/update public\.stores/i.test(outsideWriter), false,
    'stores may only be written from inside the writer, at call time');
  assert.match(VERIFY, /B1 stores plan fingerprint \(MUST be identical before\/after\)/);
});

// ── I. migration package shape ───────────────────────────────────────────────

test('the verifier is one read-only SELECT that survives the pre-install state', () => {
  const code = VERIFY.replace(/--.*$/gm, '').trim();
  assert.ok(/^select\b/i.test(code));
  assert.equal((code.match(/;/g) ?? []).length, 1);
  assert.match(VERIFY, /to_regprocedure\('public\.apply_plan_entitlement/);
  assert.equal(/from public\.apply_plan_entitlement/.test(code), false);
  const guards = VERIFY.match(/'N\/A - writer not installed'/g) ?? [];
  assert.ok(guards.length >= 8, `every row that reads the writer needs a guard, found ${guards.length}`);
});

test('the rollback refuses once the writer has granted anything', () => {
  assert.match(ROLLBACK, /source <> ''migration_backfill''/);
  assert.match(ROLLBACK, /REFUSED - the writer has granted %s entitlements/);
  assert.match(ROLLBACK, /razorpay_payment_id is not null or razorpay_plan_id is not null/);
  assert.match(ROLLBACK, /REFUSED - these functions call the writer/);
});

test('the rollback does not cascade and leaves the ledger and the legacy path alone', () => {
  const code = stripToCode(ROLLBACK);
  assert.equal(/cascade/i.test(code), false);
  assert.equal(/drop table/i.test(code), false, 'the ledger itself is PR 1 rollback');
  assert.match(code, /drop function if exists public\.apply_plan_entitlement/);
  assert.match(code, /drop column if exists razorpay_payment_id/);
  assert.match(code, /drop column if exists razorpay_plan_id/);
});

test('raise messages carry no semicolon, which would break a one-statement paste', () => {
  for (const [name, sql] of [['forward', FWD], ['rollback', ROLLBACK]]) {
    for (const m of sql.match(/message\s*=\s*format\([^)]*\)/g) ?? []) {
      assert.equal(m.includes(';'), false, `${name}: ${m}`);
    }
  }
});

// ── J. helpers ───────────────────────────────────────────────────────────────

test('phoneLast10 refuses anything shorter than ten digits', () => {
  assert.equal(phoneLast10('919175187668'), '9175187668');
  assert.equal(phoneLast10('+91 91751-87668'), '9175187668');
  assert.equal(phoneLast10('12345'), '');
  assert.equal(phoneLast10(null), '');
  assert.equal(phoneLast10(undefined), '');
});

test('a subscription with no usable owner phone cannot grant', () => {
  const r = resolveActivation(sub({ notes: { phone: '123' } }), NOW);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'owner_unresolved');
  assert.equal(resolveActivation(sub({ notes: {} }), NOW).reason, 'owner_unresolved');
});

test('identifier shape checks reject injection-flavoured input', () => {
  assert.equal(isPaymentId("pay_x'; drop table stores--"), false);
  assert.equal(isSignature('not-a-hex-digest'), false);
  assert.equal(isSignature('a'.repeat(64)), true);
  assert.equal(isSignature('a'.repeat(63)), false);
});

test('startsAt is null when Razorpay has not published the cycle start', () => {
  assert.equal(startFromSubscription(sub({ current_start: undefined })), null);
  assert.equal(startFromSubscription(sub({ current_start: 0 })), null);
  assert.equal(startFromSubscription(sub()),
    new Date((Math.floor(NOW / 1000) - 86400) * 1000).toISOString());
});

test('the derived window always satisfies the ledger window constraint', () => {
  const r = resolveActivation(sub(), NOW);
  assert.ok(new Date(r.expiresAt).getTime() > new Date(r.startsAt).getTime(),
    'expires_at > starts_at, or plan_entitlements_window_ordered would reject the row');
});
