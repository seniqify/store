/**
 * planActivation -- ask the server to activate a paid plan.
 *
 * This is the browser half of phase 3C. Everything it sends is an identifier
 * Razorpay just handed back; everything that decides what the merchant gets is
 * worked out on the server:
 *
 *   browser  ->  payment id, subscription id, signature
 *   server   ->  verifies the signature, fetches the subscription from
 *                Razorpay, derives plan / window / store / cycle, writes the
 *                entitlement and projects it into stores.config atomically
 *
 * IT SENDS NOTHING ELSE. No plan, no expiry, no amount, no store, no
 * verified_at, no Razorpay plan id. plan-activate refuses any body carrying an
 * unexpected field, so a future edit that "helpfully" adds one fails loudly
 * instead of quietly re-introducing browser authority.
 *
 * ---------------------------------------------------------------------------
 * THE OUTCOMES, AND WHAT THE CALLER MAY DO WITH THEM
 *
 *   activated       granted now                      done
 *   already_active  this cycle was already granted    done (a replay)
 *   no_store_yet    paid, but no store to grant to    use the pre-store path
 *   refused         will never succeed as submitted   DO NOT FALL BACK
 *   retry           infrastructure; already retried   fall back (compat only)
 *
 * The distinction between `refused` and `retry` is the whole point. During the
 * cutover the caller keeps the legacy browser-authored path as a compatibility
 * fallback so a transient blip cannot cost a merchant a plan they paid for.
 * Running that fallback after a REFUSAL would turn a rejected activation into a
 * browser-authored one, which is the hole this phase exists to close.
 *
 * A refusal is safe to be final because the razorpay-webhook is unchanged and
 * still provisions on subscription.charged: the merchant gets their plan a few
 * moments later instead of instantly.
 */

const SB_URL = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_SUPABASE_URL) || '';
const SB_KEY = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_SUPABASE_ANON_KEY) || '';

/** Long enough for a signature check plus a Razorpay round trip on mobile. */
export const ACTIVATE_TIMEOUT_MS = 12000;

/** Attempts for a transient outcome. Same identifiers every time -- the server's
 *  idempotency contract makes a repeat of a committed activation a no-op, which
 *  is what makes "timed out after the server already committed" recoverable. */
export const ACTIVATE_ATTEMPTS = 3;

/** Overridable only so the tests can exercise the real request path. */
export const ACTIVATE_ENDPOINT = SB_URL ? `${SB_URL}/functions/v1/plan-activate` : '';

export const ACTIVATION_OUTCOMES = Object.freeze([
  'activated', 'already_active', 'no_store_yet', 'refused', 'retry',
]);

/** True for an outcome the caller must not follow with the legacy path. */
export function isSettled(outcome) {
  return outcome === 'activated' || outcome === 'already_active' || outcome === 'refused';
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** One attempt. Returns an outcome string; never throws. */
async function attempt(body, endpoint, timeoutMs, fetchImpl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(endpoint, {
      method: 'POST',
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    // 400 is the server saying "never". Anything else that is not a success is
    // treated as infrastructure -- including 404, which is what an undeployed
    // function looks like.
    if (res.status === 400) return 'refused';
    if (!res.ok) return 'retry';

    const data = await res.json().catch(() => null);
    if (!data || data.ok !== true) return 'retry';
    if (data.activated === true) {
      return data.status === 'already_active' ? 'already_active' : 'activated';
    }
    if (data.activated === false) return 'no_store_yet';
    return 'retry';
  } catch {
    // Abort, DNS, offline, CORS, malformed response -- all indistinguishable
    // from here, and all transient as far as the caller is concerned.
    return 'retry';
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Activate a paid plan. Never throws; always resolves to one of
 * ACTIVATION_OUTCOMES.
 *
 * Transient outcomes are retried with the SAME identifiers, which is safe and
 * deliberate: if the first call committed and only the response was lost, the
 * server recognises the cycle and answers `already_active` instead of granting
 * twice.
 */
export async function activatePaidPlan(
  { paymentId, subscriptionId, signature },
  { endpoint = ACTIVATE_ENDPOINT, timeoutMs = ACTIVATE_TIMEOUT_MS,
    attempts = ACTIVATE_ATTEMPTS, fetchImpl = (typeof fetch !== 'undefined' ? fetch : null),
    delayMs = 700 } = {},
) {
  if (!endpoint || !fetchImpl) return 'retry';
  if (!paymentId || !subscriptionId || !signature) return 'refused';

  // Exactly three fields. Built here, from arguments, so nothing can be spread
  // in from a caller's object.
  const body = {
    razorpay_payment_id: String(paymentId),
    razorpay_subscription_id: String(subscriptionId),
    razorpay_signature: String(signature),
  };

  let outcome = 'retry';
  for (let i = 0; i < attempts; i++) {
    outcome = await attempt(body, endpoint, timeoutMs, fetchImpl);
    if (outcome !== 'retry') return outcome;
    if (i < attempts - 1) await sleep(delayMs);
  }
  return outcome;
}

/**
 * Minimal, safe telemetry. The subscription id is already in the browser and is
 * not a credential, and it is the only thing that makes a billing incident
 * traceable. The signature, the payment id and the request body never appear.
 */
export function logActivation(outcome, subscriptionId) {
  const line = `plan-activate: ${outcome} sub=${subscriptionId ?? '(none)'}`;
  if (outcome === 'activated' || outcome === 'already_active') console.info(line);
  else console.warn(line);
}
