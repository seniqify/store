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
 *
 * ---------------------------------------------------------------------------
 * ONLY THE EXACT CONTRACT COUNTS
 *
 * An outcome is recognised only when the HTTP status, `ok`, `status` and
 * `activated` all agree with RESPONSE_CONTRACT below. Nothing is inferred from
 * the HTTP code alone, because the code alone is not ours: a 400 can come from
 * a CDN, a proxy or a misrouted request, and `refused` is the one outcome that
 * suppresses the fallback. Anything that does not speak the contract is
 * `retry`.
 *
 * A useful side effect: the function currently deployed answers success without
 * a `status` field, so a site-first deployment degrades to the legacy path
 * rather than being misread. The order is still function first, then site.
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

/**
 * THE SERVER CONTRACT, ENUMERATED.
 *
 * An outcome is only recognised when the HTTP status, `ok`, `status` and
 * `activated` ALL match one of these rows exactly. Nothing is inferred from
 * the HTTP code on its own.
 *
 * That matters most for 400. A 400 can come from a CDN, a proxy, a gateway or
 * a misrouted request as easily as from plan-activate, and `refused` is the one
 * outcome that SUPPRESSES the compatibility fallback. Reading "400" as "the
 * server refused this activation" would let any intermediary strand a paying
 * merchant. Only a body that actually speaks the contract can do that.
 *
 * `activated: undefined` means the field is not part of that row's contract.
 */
export const RESPONSE_CONTRACT = Object.freeze({
  activated:      Object.freeze({ http: 200, ok: true,  activated: true }),
  already_active: Object.freeze({ http: 200, ok: true,  activated: true }),
  no_store_yet:   Object.freeze({ http: 200, ok: true,  activated: false }),
  refused:        Object.freeze({ http: 400, ok: false, activated: undefined }),
  retry:          Object.freeze({ http: 503, ok: false, activated: undefined }),
});

/**
 * Map one response to an outcome, or to 'retry' if it does not speak the
 * contract exactly. Exported so the tests can drive it directly.
 *
 * Everything unrecognised becomes 'retry' rather than a refusal, including
 * 401/403 and 404: those are configuration or routing problems, not a ruling on
 * this payment, and during the cutover the safer reading of "I could not get an
 * answer" is "let the merchant through the legacy path" -- which still requires
 * a valid Razorpay signature before it writes anything.
 */
export function classifyResponse(httpStatus, data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return 'retry';

  const name = data.status;
  if (typeof name !== 'string') return 'retry';
  if (!Object.prototype.hasOwnProperty.call(RESPONSE_CONTRACT, name)) return 'retry';

  const spec = RESPONSE_CONTRACT[name];
  if (httpStatus !== spec.http) return 'retry';
  if (data.ok !== spec.ok) return 'retry';
  if (spec.activated === undefined) {
    // refused and retry carry no `activated` at all. A body that pairs a
    // refusal with an activation flag is contradicting itself.
    if ('activated' in data) return 'retry';
  } else if (data.activated !== spec.activated) {
    // status and activated must agree: no_store_yet with activated:true, or
    // activated with activated:false, is not a contract this client honours.
    return 'retry';
  }
  return name;
}

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

    // Parse FIRST, classify from the contract. The status code alone decides
    // nothing -- a non-JSON 400 from a proxy is 'retry', not a refusal.
    let data = null;
    try {
      data = await res.json();
    } catch {
      return 'retry';
    }
    return classifyResponse(res.status, data);
  } catch {
    // Abort, DNS, offline, CORS -- all indistinguishable from here, and all
    // transient as far as the caller is concerned.
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
