/**
 * Razorpay -> PocketLink plan resolution. The single server-side authority for
 * "what did this subscription actually buy".
 *
 * Pure: no secrets, no network, no Deno/Node APIs. Imported by the
 * plan-activate edge function and executed directly by the test suite, the same
 * arrangement shared/pricing.mjs uses for order pricing.
 *
 * ---------------------------------------------------------------------------
 * WHY plan_id AND NOT notes.plan
 *
 * A Razorpay subscription carries notes {plan, period, phone} that
 * create-razorpay-subscription writes from the browser's request body. The
 * razorpay-webhook reads `sub.notes?.plan ?? mapped?.plan` -- notes first.
 *
 * This module deliberately does NOT do that. It resolves the plan from
 * `plan_id` alone, because plan_id is the object Razorpay bills against: it
 * determines the amount actually debited. Deriving the plan from it means the
 * entitlement granted can never be richer than the money that moved.
 *
 * notes are never consulted for plan or period. They are consulted for the
 * owner's phone only, which is how the subscription is bound to a store, and
 * which is a pre-existing weakness shared with the webhook (documented in the
 * phase 3C audit, tightened in a later PR, not here).
 *
 * An unknown plan_id resolves to null. Callers MUST refuse rather than guess --
 * guessing is how a retired price becomes a free upgrade.
 * ---------------------------------------------------------------------------
 */

/**
 * plan_id -> {plan, period}. Must stay in step with PLAN_IDS in
 * supabase/functions/create-razorpay-subscription/index.ts and PLAN_BY_ID in
 * supabase/functions/razorpay-webhook/index.ts. A test fails if the webhook's
 * copy drifts from this one; the webhook is pointed at this module in the PR
 * that switches it over, not in this one.
 */
export const PLAN_BY_ID = Object.freeze({
  // Current plan -- INR 1,099/mo, INR 9,999/yr (created 2026-09-01).
  plan_TX4Yj0ktnJ9Ic3: { plan: 'premium', period: 'monthly' },
  plan_TX4a4orxglrlrC: { plan: 'premium', period: 'yearly' },
  // Retired but permanent: existing mandates keep renewing on these ids, so
  // removing one would strand a paying merchant at the next charge.
  plan_T534Tj7pKAPhOP: { plan: 'starter', period: 'monthly' },
  plan_T534TvGMXAl18M: { plan: 'starter', period: 'yearly' },
  plan_Szqmme5MgX3kcg: { plan: 'pro', period: 'monthly' },
  plan_SzqmmuDV66K4lm: { plan: 'pro', period: 'yearly' },
  plan_T8tUVJDyKVHUqA: { plan: 'business', period: 'monthly' },
  plan_T8tUVTmHtEauYl: { plan: 'business', period: 'yearly' },
  plan_T8tUVd3OJkD8m8: { plan: 'premium', period: 'monthly' },
  plan_T8tUVnFLUkTGYl: { plan: 'premium', period: 'yearly' },
  // premium_plus billed a different amount but granted Pro features, so it is
  // recorded as 'premium'.
  plan_SzqmnPq8JoWcSc: { plan: 'premium', period: 'monthly' },
  plan_SzqmnZ9M5keufj: { plan: 'premium', period: 'yearly' },
});

/** Plan keys the ledger's plan_entitlements_plan_known CHECK accepts. */
export const KNOWN_PLANS = Object.freeze([
  'free', 'starter', 'pro', 'business', 'premium', 'premium_plus',
]);

/** Cushion so a slightly late auto-charge never lapses a paying store. */
export const GRACE_MS = 3 * 86400 * 1000;

/** One cycle, used only when Razorpay has not published current_end yet. */
export const CYCLE_DAYS = Object.freeze({ monthly: 33, yearly: 368 });

/** Subscription states that mean money has actually been collected. */
export const PAID_STATUSES = Object.freeze(['active', 'completed']);

const SUB_ID_RE = /^sub_[A-Za-z0-9]+$/;
const PAY_ID_RE = /^pay_[A-Za-z0-9]+$/;
const SIG_RE = /^[a-f0-9]{64}$/;

/** Shape checks for the three identifiers the browser is allowed to submit. */
export function isSubscriptionId(v) { return typeof v === 'string' && SUB_ID_RE.test(v); }
export function isPaymentId(v) { return typeof v === 'string' && PAY_ID_RE.test(v); }
export function isSignature(v) { return typeof v === 'string' && SIG_RE.test(v); }

/** Last ten digits, the form every phone comparison in this codebase uses. */
export function phoneLast10(v) {
  const d = String(v ?? '').replace(/\D/g, '');
  return d.length >= 10 ? d.slice(-10) : '';
}

/**
 * The plan a subscription bills for, from its plan_id alone.
 * Returns null for an unknown or missing plan_id -- callers must refuse.
 */
export function planFromSubscription(sub) {
  const id = sub && typeof sub.plan_id === 'string' ? sub.plan_id : '';
  const hit = Object.prototype.hasOwnProperty.call(PLAN_BY_ID, id) ? PLAN_BY_ID[id] : null;
  return hit ? { plan: hit.plan, period: hit.period, razorpayPlanId: id } : null;
}

/**
 * Paid-through date, server-derived.
 *
 * current_end is Razorpay's own "this cycle is paid until", in epoch seconds.
 * When it is absent -- which happens on a fresh activation before the first
 * cycle is published -- one period is used instead, so a merchant who has just
 * paid is never left without an entitlement window.
 */
export function expiryFromSubscription(sub, period, nowMs = Date.now()) {
  const endSec = sub && Number.isFinite(sub.current_end) ? sub.current_end : null;
  const baseMs = endSec !== null && endSec > 0
    ? endSec * 1000
    : nowMs + (CYCLE_DAYS[period] ?? CYCLE_DAYS.monthly) * 86400000;
  return new Date(baseMs + GRACE_MS).toISOString();
}

/** When the current cycle began, if Razorpay published it. */
export function startFromSubscription(sub) {
  const startSec = sub && Number.isFinite(sub.current_start) ? sub.current_start : null;
  return startSec !== null && startSec > 0 ? new Date(startSec * 1000).toISOString() : null;
}

/**
 * THE IDEMPOTENCY IDENTITY: one grant per subscription per billing cycle.
 *
 *   razorpay_subscription:<subscription_id>:<cycle>
 *
 * subscription_id alone is NOT unique -- every renewal reuses it, which is why
 * the ledger has no unique index on that column. paid_count is Razorpay's own
 * count of successful charges on the mandate, so it names the cycle and steps
 * exactly once per charge.
 *
 * It is derived from the SUBSCRIPTION ENTITY, never from a payment id, so the
 * browser-triggered activation and the webhook for the same charge produce the
 * SAME key and collapse to one row. A payment-id key could not do that: the
 * webhook's subscription.activated event carries no payment entity.
 *
 * Returns null when paid_count is missing, so the caller refuses rather than
 * writing a grant it cannot deduplicate.
 */
export function cycleIdempotencyKey(sub) {
  if (!sub || !isSubscriptionId(sub.id)) return null;
  if (!Number.isInteger(sub.paid_count) || sub.paid_count < 1) return null;
  return `razorpay_subscription:${sub.id}:${sub.paid_count}`;
}

/**
 * Everything the entitlement writer needs, derived from the Razorpay
 * subscription entity and nothing else.
 *
 * Returns { ok: false, reason } rather than throwing, so the caller can map
 * reasons to logs without leaking them to the browser.
 */
export function resolveActivation(sub, nowMs = Date.now()) {
  if (!sub || !isSubscriptionId(sub.id)) return { ok: false, reason: 'subscription_malformed' };
  if (!PAID_STATUSES.includes(sub.status)) return { ok: false, reason: 'subscription_not_paid' };

  const mapped = planFromSubscription(sub);
  if (!mapped) return { ok: false, reason: 'plan_unresolved' };
  if (!KNOWN_PLANS.includes(mapped.plan)) return { ok: false, reason: 'plan_unresolved' };

  const key = cycleIdempotencyKey(sub);
  if (!key) return { ok: false, reason: 'cycle_unresolved' };

  const phone = phoneLast10(sub.notes && sub.notes.phone);
  if (!phone) return { ok: false, reason: 'owner_unresolved' };

  return {
    ok: true,
    plan: mapped.plan,
    period: mapped.period,
    razorpayPlanId: mapped.razorpayPlanId,
    subscriptionId: sub.id,
    ownerPhoneLast10: phone,
    startsAt: startFromSubscription(sub),
    expiresAt: expiryFromSubscription(sub, mapped.period, nowMs),
    idempotencyKey: key,
  };
}
