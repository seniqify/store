// Paying stores keep their plan (founder, 2026-11-23: "lets start with point 1
// fix that"). A paying store's planExpiresAt never moved on renewal, so
// monthly payers dropped to Free while Razorpay kept charging them. The daily
// subscription-sync asks Razorpay and moves the date forward; the webhook now
// finds the store by its subscription id before its phone.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { syncDecision, reportLine } from '../shared/subscription-sync.mjs';
import { GRACE_MS } from '../shared/razorpay-plans.mjs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const code = (s) => s.replace(/--.*$/gm, '');

const NOW = Date.parse('2026-11-23T10:00:00Z');
const DAY = 86400000;
const MONTHLY = 'plan_TX4Yj0ktnJ9Ic3';           // premium monthly
const BUSINESS_MONTHLY = 'plan_T8tUVJDyKVHUqA';  // business monthly
const sec = (ms) => Math.floor(ms / 1000);

const store = (over = {}) => ({
  slug: 'shop-a',
  config: { plan: 'premium', planExpiresAt: '2026-11-13T04:30:32.163Z', razorpaySubscriptionId: 'sub_AAA111', whatsappNumber: '919999999999', ...over },
});
const sub = (over = {}) => ({
  id: 'sub_AAA111', status: 'active', plan_id: MONTHLY, paid_count: 2,
  current_start: sec(NOW - 12 * DAY), current_end: sec(NOW + 18 * DAY), ...over,
});

test('a lapsed store whose mandate is active is extended to current_end + grace', () => {
  const d = syncDecision(store(), sub(), NOW);
  assert.equal(d.action, 'extend');
  assert.equal(d.reason, 'lapsed_but_paying');
  assert.equal(d.plan, 'premium');
  assert.equal(d.expiresAt, new Date(sec(NOW + 18 * DAY) * 1000 + GRACE_MS).toISOString());
  assert.equal(d.previous, '2026-11-13T04:30:32.163Z');
});

test('a store still inside its window is extended when Razorpay has a later cycle', () => {
  const d = syncDecision(store({ planExpiresAt: new Date(NOW + 2 * DAY).toISOString() }), sub(), NOW);
  assert.equal(d.action, 'extend');
  assert.equal(d.reason, 'renewed');
});

test('it never shortens: an equal or later stored date is kept', () => {
  const later = new Date(NOW + 60 * DAY).toISOString();
  assert.equal(syncDecision(store({ planExpiresAt: later }), sub(), NOW).action, 'keep');
  assert.equal(syncDecision(store({ planExpiresAt: later }), sub(), NOW).reason, 'up_to_date');
  const same = new Date(sec(NOW + 18 * DAY) * 1000 + GRACE_MS).toISOString();
  assert.equal(syncDecision(store({ planExpiresAt: same }), sub(), NOW).reason, 'up_to_date');
});

test('only an active mandate extends; cancelled, halted, paused, pending, authenticated are left alone', () => {
  for (const status of ['cancelled', 'halted', 'paused', 'pending', 'authenticated', 'completed', 'expired', 'created']) {
    const d = syncDecision(store(), sub({ status }), NOW);
    assert.equal(d.action, 'keep', status);
    assert.equal(d.reason, `status_${status}`);
    assert.equal(d.expiresAt, undefined);
  }
});

test('a cycle Razorpay has not renewed yet does not extend into the past', () => {
  const d = syncDecision(store(), sub({ current_end: sec(NOW - 5 * DAY) }), NOW);
  assert.equal(d.action, 'keep');
  assert.equal(d.reason, 'cycle_not_renewed_yet');
});

test('the subscription must be the one the store records', () => {
  assert.equal(syncDecision(store(), sub({ id: 'sub_OTHER9' }), NOW).reason, 'subscription_mismatch');
  assert.equal(syncDecision(store({ razorpaySubscriptionId: undefined }), sub(), NOW).reason, 'no_subscription');
  assert.equal(syncDecision(store({ razorpaySubscriptionId: 'nope' }), sub(), NOW).reason, 'no_subscription');
  assert.equal(syncDecision(store(), null, NOW).reason, 'not_found');
});

test('an unknown plan_id is refused, never guessed', () => {
  const d = syncDecision(store(), sub({ plan_id: 'plan_UNKNOWN' }), NOW);
  assert.equal(d.action, 'skip');
  assert.equal(d.reason, 'plan_unknown');
});

test('a store on a richer paid plan keeps it; a free store gets the plan its mandate pays for', () => {
  assert.equal(syncDecision(store({ plan: 'premium' }), sub({ plan_id: BUSINESS_MONTHLY }), NOW).plan, 'premium');
  assert.equal(syncDecision(store({ plan: 'free' }), sub({ plan_id: BUSINESS_MONTHLY }), NOW).plan, 'business');
  assert.equal(syncDecision(store({ plan: undefined }), sub(), NOW).plan, 'premium');
});

test('the run report carries no phone number', () => {
  const s = store();
  const line = reportLine(s.slug, sub(), syncDecision(s, sub(), NOW));
  assert.doesNotMatch(JSON.stringify(line), /9999999999|whatsapp|phone/i);
  assert.deepEqual(Object.keys(line), ['slug', 'status', 'paid_count', 'current_end', 'action', 'reason', 'previous', 'next']);
});

// ---------------------------------------------------------------------------
// SQL
// ---------------------------------------------------------------------------
const FWD = read('supabase/subscription-sync-forward.sql');
const VERIFY = read('supabase/subscription-sync-verify.sql');
const RB = read('supabase/subscription-sync-ROLLBACK.sql');
const SCHED = read('supabase/subscription-sync-schedule.sql');

test('the write function is SECURITY DEFINER, pinned, and service_role only', () => {
  const c = code(FWD);
  assert.match(c, /security definer\s+set search_path = public, pg_temp/);
  assert.match(c, /revoke all on function public\.extend_store_plan_from_razorpay\(text, text, text, text\) from public, anon, authenticated;/);
  assert.match(c, /grant execute on function public\.extend_store_plan_from_razorpay\(text, text, text, text\) to service_role;/);
  assert.doesNotMatch(c, /grant[^;]*\b(anon|authenticated)\b/);
});

test('it only extends, only the recorded subscription, and merges two keys', () => {
  const c = code(FWD);
  assert.match(c, /for update/);
  assert.match(c, /<> p_subscription_id then\s+return 'subscription_mismatch'/);
  assert.match(c, /v_new <= v_prev then\s+return 'not_later'/);
  assert.match(c, /set config = config \|\| jsonb_build_object\('plan', p_plan, 'planExpiresAt', p_expires_at\)/);
  assert.match(c, /interval '400 days'/);
});

test('the forward file adds a function and a secret, nothing else', () => {
  const c = code(FWD);
  assert.doesNotMatch(c, /\b(drop|alter table|create table|create trigger|create policy|truncate)\b/i);
  assert.doesNotMatch(c, /\bdelete from\b/i);
  assert.match(c, /insert into public\.automation_secrets \(name, secret\)[\s\S]*on conflict \(name\) do nothing;/);
});

test('verify only reads, plus two refusals that write nothing', () => {
  const c = code(VERIFY);
  assert.doesNotMatch(c, /\b(insert|update|delete|drop|alter|create|grant|revoke)\b/i);
  assert.match(c, /'bad_input'/);
  assert.match(c, /'not_found'/);
});

test('the job reads its secret at run time and the rollback stops it', () => {
  const c = code(SCHED);
  assert.match(c, /'pocketlink-subscription-sync'/);
  assert.match(c, /select secret from public\.automation_secrets where name = 'subscription-sync'/);
  assert.match(c, /functions\/v1\/subscription-sync/);
  assert.doesNotMatch(c, /[a-f0-9]{32,}/);
  const r = code(RB);
  assert.match(r, /cron\.unschedule[\s\S]*'pocketlink-subscription-sync'/);
  assert.match(r, /drop function if exists public\.extend_store_plan_from_razorpay\(text, text, text, text\);/);
});

// ---------------------------------------------------------------------------
// Edge functions
// ---------------------------------------------------------------------------
const SYNC = read('supabase/functions/subscription-sync/index.ts');
const WEBHOOK = read('supabase/functions/razorpay-webhook/index.ts');

test('subscription-sync is gated by its own shared secret and writes only through the RPC', () => {
  assert.match(SYNC, /\.eq\('name', 'subscription-sync'\)/);
  assert.match(SYNC, /req\.headers\.get\('x-sweep-secret'\)/);
  assert.match(SYNC, /rpc\('extend_store_plan_from_razorpay'/);
  assert.doesNotMatch(SYNC, /\.update\(|\.insert\(|\.upsert\(|\.delete\(/);
  assert.match(SYNC, /decision\.action === 'extend' && !dryRun/);
});

test('subscription-sync never reports a phone number', () => {
  assert.doesNotMatch(SYNC, /whatsappNumber|ownerPhone|notes\.phone|contact/);
});

test('the webhook finds the store by subscription id before trying the phone', () => {
  const bySub = WEBHOOK.indexOf(".eq('config->>razorpaySubscriptionId', sub.id)");
  const byPhone = WEBHOOK.indexOf("'config->>whatsappNumber'");
  assert.ok(bySub > 0, 'looks up by subscription id');
  assert.ok(byPhone > bySub, 'phone is the fallback');
});

test('the webhook never shortens a paid date and asks Razorpay to retry a failed save', () => {
  assert.match(WEBHOOK, /if \(active && Number\.isFinite\(prevMs\) && planExpiresAt && prevMs > new Date\(planExpiresAt\)\.getTime\(\)\)/);
  assert.match(WEBHOOK, /const \{ error: updErr \} = await supabase/);
  assert.match(WEBHOOK, /if \(updErr\) \{[\s\S]*?status: 500/);
});
