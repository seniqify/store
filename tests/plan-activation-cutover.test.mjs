// Phase 3C PR 3: the browser paid-activation path moves onto plan-activate.
//
// src/utils/planActivation.js is pure enough to drive directly with a stubbed
// fetch, so the outcome contract, the retry behaviour and "exactly three
// identifiers" are exercised for real rather than pinned. Checkout.jsx is a
// React page, so its wiring is read the way a reviewer has to.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  activatePaidPlan, isSettled, logActivation,
  ACTIVATION_OUTCOMES, ACTIVATE_ATTEMPTS,
} from '../src/utils/planActivation.js';

const read = (p) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), 'utf8');

const CHECKOUT = read('src/pages/Checkout.jsx');
const ACTIVATION = read('src/utils/planActivation.js');
const FN = read('supabase/functions/plan-activate/index.ts');
const WEBHOOK = read('supabase/functions/razorpay-webhook/index.ts');
const STORESVC = read('src/utils/storeService.js');
const ACT_FWD = read('supabase/plan-activation-forward.sql');

const IDS = { paymentId: 'pay_Abc123', subscriptionId: 'sub_Xyz789', signature: 'a'.repeat(64) };
const OPTS = { endpoint: 'https://example.test/functions/v1/plan-activate', delayMs: 0 };

/** A fetch stub that records every call and replays scripted responses. */
function stubFetch(script) {
  const calls = [];
  const queue = Array.isArray(script) ? [...script] : [script];
  const impl = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    const next = queue.length > 1 ? queue.shift() : queue[0];
    if (typeof next === 'function') return next();
    return {
      ok: next.status >= 200 && next.status < 300,
      status: next.status,
      json: async () => next.body,
    };
  };
  return { impl, calls };
}

const ok = (body) => ({ status: 200, body });
const refused = { status: 400, body: { ok: false, status: 'refused', error: 'invalid_request' } };
const unavailable = { status: 503, body: { ok: false, status: 'retry', error: 'temporarily_unavailable' } };

// ── A. exactly three identifiers, and nothing else ───────────────────────────

test('a successful callback sends exactly the three identifiers', async () => {
  const { impl, calls } = stubFetch(ok({ ok: true, activated: true, status: 'activated' }));
  const outcome = await activatePaidPlan(IDS, { ...OPTS, fetchImpl: impl });
  assert.equal(outcome, 'activated');
  assert.equal(calls.length, 1);
  assert.deepEqual(Object.keys(calls[0].body).sort(), [
    'razorpay_payment_id', 'razorpay_signature', 'razorpay_subscription_id',
  ]);
  assert.deepEqual(calls[0].body, {
    razorpay_payment_id: 'pay_Abc123',
    razorpay_subscription_id: 'sub_Xyz789',
    razorpay_signature: 'a'.repeat(64),
  });
});

test('the browser sends no plan, expiry, amount, store or verified_at', async () => {
  const { impl, calls } = stubFetch(ok({ ok: true, activated: true, status: 'activated' }));
  // Even when the caller's object carries extras, they cannot reach the wire:
  // the body is rebuilt from named arguments.
  await activatePaidPlan(
    { ...IDS, plan: 'premium', expires: '2099-01-01', amount: 1, store_slug: 'showme',
      verified_at: 'now', razorpay_plan_id: 'plan_x' },
    { ...OPTS, fetchImpl: impl },
  );
  const sent = JSON.stringify(calls[0].body);
  for (const forbidden of ['plan', 'expire', 'amount', 'store', 'slug', 'verified']) {
    assert.equal(new RegExp(forbidden, 'i').test(sent.replace(/razorpay_(payment|subscription)_id/g, '')), false,
      `${forbidden} must never be sent`);
  }
});

test('the body is built from named arguments, not spread from the caller', () => {
  assert.match(ACTIVATION, /razorpay_payment_id: String\(paymentId\)/);
  assert.match(ACTIVATION, /razorpay_subscription_id: String\(subscriptionId\)/);
  assert.match(ACTIVATION, /razorpay_signature: String\(signature\)/);
  assert.equal(/\.\.\.\w+/.test(ACTIVATION.slice(ACTIVATION.indexOf('const body = {'),
                                                 ACTIVATION.indexOf('let outcome'))), false,
    'nothing may be spread into the request body');
});

test('the server refuses an unexpected field, so a future edit fails loudly', () => {
  assert.match(FN, /const extra = Object\.keys\(body\)\.filter\(\(k\) => !ALLOWED_FIELDS\.includes\(k\)\)/);
  assert.match(FN, /if \(extra\.length > 0\)/);
});

// ── B. the outcome contract ──────────────────────────────────────────────────

test('every documented outcome is produced from the matching response', async () => {
  const cases = [
    [ok({ ok: true, activated: true, status: 'activated' }), 'activated'],
    [ok({ ok: true, activated: true, status: 'already_active' }), 'already_active'],
    [ok({ ok: true, activated: false, status: 'no_store_yet' }), 'no_store_yet'],
    [refused, 'refused'],
  ];
  for (const [res, want] of cases) {
    const { impl } = stubFetch(res);
    assert.equal(await activatePaidPlan(IDS, { ...OPTS, fetchImpl: impl }), want);
  }
  for (const o of ACTIVATION_OUTCOMES) assert.ok(typeof o === 'string');
});

test('a definitive refusal is returned immediately and is never retried', async () => {
  const { impl, calls } = stubFetch(refused);
  assert.equal(await activatePaidPlan(IDS, { ...OPTS, fetchImpl: impl }), 'refused');
  assert.equal(calls.length, 1, 'a refusal must not be retried');
});

test('isSettled marks exactly the outcomes that forbid the legacy path', () => {
  assert.equal(isSettled('activated'), true);
  assert.equal(isSettled('already_active'), true);
  assert.equal(isSettled('refused'), true);
  assert.equal(isSettled('retry'), false);
  assert.equal(isSettled('no_store_yet'), false);
});

// ── C. retries and the timeout-after-commit case ─────────────────────────────

test('a transient outcome is retried with the SAME identifiers', async () => {
  const { impl, calls } = stubFetch([unavailable, unavailable, ok({ ok: true, activated: true, status: 'activated' })]);
  assert.equal(await activatePaidPlan(IDS, { ...OPTS, fetchImpl: impl }), 'activated');
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[0].body, calls[1].body);
  assert.deepEqual(calls[1].body, calls[2].body);
});

test('a timeout AFTER the server committed is recoverable by retrying', async () => {
  // First attempt aborts (the commit landed, the response was lost). The retry
  // sends the identical identifiers and the server recognises the cycle.
  let n = 0;
  const impl = async () => {
    n += 1;
    if (n === 1) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    return { ok: true, status: 200, json: async () => ({ ok: true, activated: true, status: 'already_active' }) };
  };
  assert.equal(await activatePaidPlan(IDS, { ...OPTS, fetchImpl: impl }), 'already_active');
  assert.equal(n, 2);
});

test('an exact replay reports already_active, never a second grant', async () => {
  const { impl } = stubFetch(ok({ ok: true, activated: true, status: 'already_active' }));
  assert.equal(await activatePaidPlan(IDS, { ...OPTS, fetchImpl: impl }), 'already_active');
  // The server-side contract that makes this true is PR 2's, unchanged here.
  assert.match(ACT_FWD, /on conflict \(idempotency_key\) do nothing/);
});

test('retries are bounded and end in retry, not in a throw', async () => {
  const { impl, calls } = stubFetch(unavailable);
  assert.equal(await activatePaidPlan(IDS, { ...OPTS, fetchImpl: impl }), 'retry');
  assert.equal(calls.length, ACTIVATE_ATTEMPTS);
});

test('a network failure, an offline browser and a 404 are all transient', async () => {
  for (const res of [() => { throw new Error('offline'); }, { status: 404, body: {} }, { status: 500, body: {} }]) {
    const { impl } = stubFetch(res);
    assert.equal(await activatePaidPlan(IDS, { ...OPTS, fetchImpl: impl }), 'retry');
  }
});

test('a missing endpoint or missing identifiers never throws', async () => {
  assert.equal(await activatePaidPlan(IDS, { ...OPTS, endpoint: '' }), 'retry');
  assert.equal(await activatePaidPlan({ ...IDS, signature: '' }, OPTS), 'refused');
});

test('a malformed success body is treated as transient, not as success', async () => {
  for (const body of [{ ok: true }, { ok: false }, null, { activated: true }]) {
    const { impl } = stubFetch(ok(body));
    assert.equal(await activatePaidPlan(IDS, { ...OPTS, fetchImpl: impl }), 'retry');
  }
});

// ── D. Checkout wiring: no client authority on the migrated path ─────────────

const PROVISION = CHECKOUT.slice(CHECKOUT.indexOf('async function provisionPaidPlan'),
                                 CHECKOUT.indexOf('async function provisionPreStoreSignup'));

test('the existing-store path calls plan-activate and nothing else decides the plan', () => {
  assert.match(PROVISION, /const outcome = await activatePaidPlan\(\{ paymentId, subscriptionId, signature \}\)/);
  assert.equal(/upgradePlan\(/.test(PROVISION.slice(0, PROVISION.indexOf("outcome === 'retry'"))), false,
    'upgradePlan must not run before the transient branch');
});

test('a successful activation does NOT call upgrade_store_plan', () => {
  const success = PROVISION.slice(PROVISION.indexOf("if (outcome === 'activated'"),
                                  PROVISION.indexOf("if (outcome === 'refused'"));
  assert.match(success, /navigate\(`\/\$\{existing\}\/manage`\)/);
  assert.equal(/upgradePlan|savePendingSignup|planExpiresAt|razorpaySubscriptionId/.test(success), false);
  assert.match(success, /return;/);
});

test('a DEFINITIVE refusal does not fall back to the legacy path', () => {
  const branch = PROVISION.slice(PROVISION.indexOf("if (outcome === 'refused'"),
                                 PROVISION.indexOf("if (outcome === 'no_store_yet'"));
  assert.match(branch, /setPayError\(PAID_BUT_PENDING\)/);
  assert.match(branch, /return;/);
  assert.equal(/upgradePlan|legacyUpgrade/.test(branch), false,
    'a refusal must never become a browser-authored activation');
});

test('the transient branch is the ONLY caller of the legacy upgrade', () => {
  const tail = PROVISION.slice(PROVISION.indexOf("outcome === 'retry'"));
  assert.match(tail, /await legacyUpgrade\(existing, subscriptionId/);
  assert.equal((CHECKOUT.match(/legacyUpgrade\(/g) ?? []).length, 2,
    'declared once, called once');
  const legacy = CHECKOUT.slice(CHECKOUT.indexOf('async function legacyUpgrade'),
                                CHECKOUT.indexOf('async function verifySignature'));
  assert.match(legacy, /upgradePlan\(slug, storePlan, expires, subscriptionId\)/);
  // The comment sits above the declaration, and says plainly that PR 4 removes it.
  assert.match(CHECKOUT, /COMPATIBILITY ONLY, for the cutover[\s\S]{0,300}async function legacyUpgrade/);
});

test('the legacy fallback still verifies the signature before writing', () => {
  const legacy = CHECKOUT.slice(CHECKOUT.indexOf('async function legacyUpgrade'),
                                CHECKOUT.indexOf('async function verifySignature'));
  assert.ok(legacy.indexOf('verifySignature') < legacy.indexOf('upgradePlan'));
  assert.match(legacy, /if \(!verified\)/);
});

test('the outcome is logged for every branch, with no secret', () => {
  assert.match(PROVISION, /logActivation\(outcome, subscriptionId\)/);
  assert.match(ACTIVATION, /plan-activate: \$\{outcome\} sub=\$\{subscriptionId/);
  for (const leak of ['signature', 'paymentId', 'razorpay_signature', 'body']) {
    assert.equal(ACTIVATION.slice(ACTIVATION.indexOf('export function logActivation'))
      .includes('${' + leak + '}'), false, `logActivation leaks ${leak}`);
  }
  logActivation('activated', 'sub_X');   // must not throw
});

// ── E. the pre-store path is deliberately untouched ──────────────────────────

const PRESTORE = CHECKOUT.slice(CHECKOUT.indexOf('async function provisionPreStoreSignup'),
                                CHECKOUT.indexOf('async function legacyUpgrade'));

test('store_not_found is not treated as a failed payment', () => {
  const branch = PROVISION.slice(PROVISION.indexOf("if (outcome === 'no_store_yet'"),
                                 PROVISION.indexOf("outcome === 'retry'"));
  assert.match(branch, /provisionPreStoreSignup/);
  assert.equal(/setPayError/.test(branch), false, 'a paid customer must not see an error here');
});

test('the pre-store route still verifies, still records the signup, still onboards', () => {
  assert.ok(PRESTORE.indexOf('verifySignature') < PRESTORE.indexOf('savePendingSignup'));
  assert.match(PRESTORE, /savePendingSignup\(phone, storePlan, expires, subscriptionId\)/);
  assert.match(PRESTORE, /sessionStorage\.setItem\('pocketlink_plan', storePlan\)/);
  assert.match(PRESTORE, /navigate\('\/onboarding'\)/);
});

test('no phone-number lookup authority is introduced', () => {
  // The 3A merge blocker. Nothing here reads a paid plan back by phone.
  assert.equal(/get_pending_signup|getPendingSignup/.test(CHECKOUT), false);
  assert.equal(/get_pending_signup/.test(STORESVC), false);
});

test('pending_signups keeps its exact client contract', () => {
  assert.match(STORESVC, /export async function savePendingSignup\(phone, plan, planExpiresAt = null, subscriptionId = null\)/);
  assert.match(STORESVC, /\.from\('pending_signups'\)\s*\.upsert\(/);
});

// ── F. the coupon and free flows are unchanged ───────────────────────────────

test('the coupon path is untouched: no server verification exists for it yet', () => {
  const claim = CHECKOUT.slice(CHECKOUT.indexOf('async function handleClaim'));
  assert.match(claim, /upgradePlan\(existing, applied\.plan, expires\)/);
  assert.equal(/activatePaidPlan/.test(claim), false,
    'a coupon produces no Razorpay payment, so there is nothing for plan-activate to verify');
});

// ── G. scope guards ──────────────────────────────────────────────────────────

test('upgrade_store_plan is still available and its SQL is untouched', () => {
  assert.match(STORESVC, /supabase\.rpc\('upgrade_store_plan'/);
  // No migration in this PR touches it.
  assert.equal(/upgrade_store_plan/.test(ACT_FWD.replace(/--.*$/gm, '')), false);
});

test('the PR 2 writer and its grants are unchanged', () => {
  assert.match(ACT_FWD, /security invoker/);
  assert.match(ACT_FWD, /set search_path = public, pg_temp/);
  assert.match(ACT_FWD, /revoke all on function public\.apply_plan_entitlement/);
  assert.match(ACT_FWD, /grant execute on function public\.apply_plan_entitlement[\s\S]{0,200}to service_role/);
});

test('the webhook is unchanged', () => {
  assert.equal(/plan-activate|apply_plan_entitlement|planActivation/.test(WEBHOOK), false);
});

test('phase 2 and the order path are untouched by this PR', () => {
  for (const forbidden of ['create_order_secure', 'order_pricing_shadow', 'orderShadow',
                           'orders_insert_guard']) {
    assert.equal(ACTIVATION.includes(forbidden), false, `${forbidden} must not appear`);
  }
});

// ── H. the server contract this client depends on ────────────────────────────

test('the function classifies definitively vs transiently, and says so', () => {
  assert.match(FN, /const refuse = \(\) => json\(\{ ok: false, status: 'refused', error: 'invalid_request' \}, 400\)/);
  assert.match(FN, /const unavailable = \(\) => json\(\{ ok: false, status: 'retry', error: 'temporarily_unavailable' \}, 503\)/);
});

test('a writer refusal is DEFINITIVE, not transient', () => {
  // idempotency_conflict and owner_ambiguous used to return 503, which a client
  // would read as "retry, then fall back" -- laundering a refusal.
  const branch = FN.slice(FN.indexOf('if (!data?.ok)'), FN.indexOf('if (!data.activated)'));
  assert.match(branch, /return refuse\(\)/);
  assert.equal(/unavailable\(\)/.test(branch), false);
});

test('an unresolved plan is DEFINITIVE, because the only fallback is a browser claim', () => {
  const branch = FN.slice(FN.indexOf('const resolved = resolveActivation(sub)'),
                          FN.indexOf('// -- [3]'));
  assert.match(branch, /return refuse\(\)/);
  assert.equal(/unavailable\(\)/.test(branch), false);
});

test('a Razorpay 4xx is definitive and a 5xx is transient', () => {
  assert.match(FN, /return res\.status >= 500 \|\| res\.status === 429 \? unavailable\(\) : refuse\(\)/);
});

test('no_store_yet is reported as success with activated=false', () => {
  assert.match(FN, /return json\(\{ ok: true, activated: false, status: 'no_store_yet' \}\)/);
});

test('the success response still reveals no store', () => {
  assert.match(FN, /return json\(\{ ok: true, activated: true, status \}\)/);
  assert.equal(/store_slug: data|data\.store_slug/.test(FN), false);
});
