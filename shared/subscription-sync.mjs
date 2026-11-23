/**
 * Daily subscription sync: what to do for one store, given what Razorpay says
 * about its subscription.
 *
 * WHY THIS EXISTS
 * A paying store's planExpiresAt is set once at sign-up and is meant to move
 * forward on every renewal through razorpay-webhook. On 2026-11-11 we found it
 * never had: no store with a razorpaySubscriptionId carried a webhook-written
 * expiry, and a monthly payer lapsed to Free on its renewal date. Whatever
 * the webhook's trouble (dashboard config, secret, delivery), a paying store
 * must not depend on one push arriving. This sync asks Razorpay directly,
 * once a day, and moves the date forward when Razorpay says the mandate is
 * active.
 *
 * RULES
 *   - Only ever EXTENDS. A cancelled, halted or paused subscription is left
 *     alone: the store keeps the time it already has and lapses on its own
 *     date. Shortening is the webhook's job, on the event that says so.
 *   - Only `active` extends. `authenticated` has not been charged yet;
 *     `pending` / `halted` mean charges are failing.
 *   - The new date is Razorpay's current_end + the shared 3-day grace,
 *     from shared/razorpay-plans.mjs, so the webhook, plan-activate and this
 *     sync agree on the window.
 *   - The subscription must be the one the store records. A store that
 *     re-subscribed gets its new id from the webhook or checkout, never here.
 *   - An unknown plan_id is refused: never guess an entitlement.
 *
 * Pure: no network, no clock unless passed in, no Deno/Node APIs.
 */
import { planFromSubscription, expiryFromSubscription, isSubscriptionId } from './razorpay-plans.mjs';

/** Plans that mean the store already pays for something. */
const PAID_PLANS = Object.freeze(['starter', 'pro', 'business', 'premium', 'premium_plus']);

function ms(v) {
  if (!v) return NaN;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : NaN;
}

/**
 * @param {{ slug: string, config: object }} store
 * @param {object|null} sub   Razorpay subscription entity (GET /v1/subscriptions/:id)
 * @param {number} now        epoch ms
 * @returns {{ action: 'extend'|'keep'|'skip', reason: string,
 *             plan?: string, expiresAt?: string, previous?: string|null }}
 */
export function syncDecision(store, sub, now = Date.now()) {
  const cfg = (store && store.config) || {};
  const subId = cfg.razorpaySubscriptionId;
  const previous = cfg.planExpiresAt || null;

  if (!isSubscriptionId(subId)) return { action: 'skip', reason: 'no_subscription', previous };
  if (!sub || typeof sub !== 'object') return { action: 'skip', reason: 'not_found', previous };
  if (sub.id !== subId) return { action: 'skip', reason: 'subscription_mismatch', previous };

  if (sub.status !== 'active') return { action: 'keep', reason: `status_${String(sub.status || 'unknown')}`, previous };

  const mapped = planFromSubscription(sub);
  if (!mapped) return { action: 'skip', reason: 'plan_unknown', previous };

  const expiresAt = expiryFromSubscription(sub, mapped.period);
  if (!expiresAt) return { action: 'skip', reason: 'no_cycle_window', previous };

  const next = ms(expiresAt);
  if (next <= now) return { action: 'keep', reason: 'cycle_not_renewed_yet', previous };

  const prev = ms(previous);
  if (Number.isFinite(prev) && next <= prev) return { action: 'keep', reason: 'up_to_date', previous };

  // Keep the plan the store already has if it is a paid one (a store can be on
  // a richer plan than the mandate, by coupon or by hand); otherwise record the
  // plan the mandate pays for.
  const plan = PAID_PLANS.includes(cfg.plan) ? cfg.plan : mapped.plan;
  return { action: 'extend', reason: Number.isFinite(prev) && prev < now ? 'lapsed_but_paying' : 'renewed', plan, expiresAt, previous };
}

/** One line per store for the run report; never includes phone numbers. */
export function reportLine(slug, sub, decision) {
  return {
    slug,
    status: sub && sub.status ? String(sub.status) : null,
    paid_count: sub && Number.isInteger(sub.paid_count) ? sub.paid_count : null,
    current_end: sub && Number.isFinite(sub.current_end) && sub.current_end > 0
      ? new Date(sub.current_end * 1000).toISOString() : null,
    action: decision.action,
    reason: decision.reason,
    previous: decision.previous ?? null,
    next: decision.expiresAt ?? null,
  };
}
