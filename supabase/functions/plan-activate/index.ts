// ===========================================================================
//  plan-activate  --  server-authoritative plan activation
//
//  Phase 3C PR 2. Deployed but called by NOTHING: the browser still uses
//  upgrade_store_plan, and that path is still wide open. This function is the
//  replacement authority, built before the old one is removed.
//
//  ---------------------------------------------------------------------------
//  THE TRUST BOUNDARY
//
//    browser
//      -> submits THREE IDENTIFIERS ONLY:
//           razorpay_payment_id, razorpay_subscription_id, razorpay_signature
//         and nothing else. A body carrying plan, expiry, amount, store_slug
//         or status is REJECTED, not ignored, so nobody can believe it worked.
//
//    [1] CRYPTOGRAPHIC VERIFICATION -- here, in this function
//      -> HMAC-SHA256(payment_id + "|" + subscription_id, RAZORPAY_KEY_SECRET)
//         compared to the submitted signature, in constant time.
//         This proves Razorpay signed this payment against THIS subscription.
//         It is also what binds the payment to the subscription: a payment
//         belonging to a different subscription cannot produce this signature.
//
//    [2] AUTHORITATIVE RESOLUTION -- server-side fetch, not browser input
//      -> GET https://api.razorpay.com/v1/subscriptions/<id> with our own key.
//         Everything that matters is read from THAT response:
//           plan     <- plan_id, through shared/razorpay-plans.mjs
//           expiry   <- current_end + grace
//           start    <- current_start
//           owner    <- notes.phone
//           cycle    <- paid_count
//           paid?    <- status in (active, completed)
//
//    [3] ENTITLEMENT + PROJECTION -- one transaction, in the database
//      -> public.apply_plan_entitlement(...) as service_role. It resolves the
//         store itself, locks it, claims the cycle, and projects into
//         stores.config atomically. This function never names a store.
//
//  The browser is authoritative for nothing. It cannot choose the plan, the
//  expiry, the amount, the store, or whether the payment succeeded.
//
//  ---------------------------------------------------------------------------
//  WHY THE SUBSCRIPTION IS FETCHED AND THE PAYMENT IS NOT
//
//  verify-razorpay-payment used to fetch a second entity to read notes.plan,
//  and when that call blipped it flipped a real captured payment to
//  "verified: false". The scar is in its source comment. So: exactly one
//  outbound call, to the entity that actually carries the authority. The
//  signature already binds the payment to the subscription, and
//  status in (active, completed) with paid_count >= 1 is Razorpay's own
//  statement that money was collected on this mandate.
//
//  Deploy: supabase functions deploy plan-activate
//  (JWT verification left at the default; it is not an auth boundary here --
//   the signature is. Nothing calls this function until PR 3.)
// ===========================================================================
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  resolveActivation, isPaymentId, isSubscriptionId, isSignature,
} from '../../../shared/razorpay-plans.mjs';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/** Fields a caller may send. Anything else is a forgery attempt or a bug. */
const ALLOWED_FIELDS = ['razorpay_payment_id', 'razorpay_subscription_id', 'razorpay_signature'];

/**
 * External errors are deliberately generic. The reason is logged server-side
 * and never returned: "plan_unresolved" vs "subscription_not_paid" tells a
 * prober exactly which lever to pull next.
 */
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}
const refuse = () => json({ ok: false, error: 'invalid_request' }, 400);
const unavailable = () => json({ ok: false, error: 'temporarily_unavailable' }, 503);

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Length-independent comparison, so a mismatch leaks no position. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return refuse();

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return refuse();
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return refuse();

  // -- Strict input validation. An unexpected field is refused outright: a
  // -- caller that sends {plan:'premium'} must never get a success back and
  // -- conclude the plan was honoured.
  const extra = Object.keys(body).filter((k) => !ALLOWED_FIELDS.includes(k));
  if (extra.length > 0) {
    console.error(`plan-activate: refused, unexpected fields: ${extra.join(',')}`);
    return refuse();
  }

  const paymentId = body.razorpay_payment_id;
  const subscriptionId = body.razorpay_subscription_id;
  const signature = body.razorpay_signature;

  if (!isPaymentId(paymentId) || !isSubscriptionId(subscriptionId) || !isSignature(signature)) {
    return refuse();
  }

  const keyId = Deno.env.get('RAZORPAY_KEY_ID');
  const keySecret = Deno.env.get('RAZORPAY_KEY_SECRET');
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!keyId || !keySecret || !supabaseUrl || !serviceKey) {
    // Fail closed and say nothing useful. Never name which secret is missing.
    console.error('plan-activate: required configuration is absent');
    return unavailable();
  }

  try {
    // -- [1] CRYPTOGRAPHIC VERIFICATION ------------------------------------
    const expected = await hmacHex(keySecret, `${paymentId}|${subscriptionId}`);
    if (!timingSafeEqual(expected, signature as string)) {
      console.error(`plan-activate: signature mismatch for ${subscriptionId}`);
      return refuse();
    }

    // -- [2] AUTHORITATIVE RESOLUTION --------------------------------------
    const res = await fetch(
      `https://api.razorpay.com/v1/subscriptions/${encodeURIComponent(subscriptionId as string)}`,
      { headers: { Authorization: `Basic ${btoa(`${keyId}:${keySecret}`)}` } },
    );
    if (!res.ok) {
      // Razorpay's body can echo request detail. Log the status only.
      console.error(`plan-activate: razorpay fetch ${res.status} for ${subscriptionId}`);
      return unavailable();
    }
    const sub = await res.json();

    // The fetched entity must be the one that was signed for.
    if (sub?.id !== subscriptionId) {
      console.error(`plan-activate: subscription id mismatch for ${subscriptionId}`);
      return refuse();
    }

    const resolved = resolveActivation(sub);
    if (!resolved.ok) {
      console.error(`plan-activate: ${resolved.reason} for ${subscriptionId}`);
      // A stale or unpaid subscription is a client-visible refusal; an
      // unmapped plan_id is our configuration problem, not the caller's.
      return resolved.reason === 'plan_unresolved' || resolved.reason === 'cycle_unresolved'
        ? unavailable()
        : refuse();
    }

    // -- [3] ENTITLEMENT + PROJECTION, one transaction ----------------------
    const supabase = createClient(supabaseUrl, serviceKey);
    const { data, error } = await supabase.rpc('apply_plan_entitlement', {
      p_owner_phone_last10: resolved.ownerPhoneLast10,
      p_plan: resolved.plan,
      p_source: 'razorpay_subscription',
      p_starts_at: resolved.startsAt,
      p_expires_at: resolved.expiresAt,
      p_subscription_id: resolved.subscriptionId,
      p_payment_id: paymentId,
      p_razorpay_plan_id: resolved.razorpayPlanId,
      p_idempotency_key: resolved.idempotencyKey,
      p_verified_at: new Date().toISOString(),
    });

    if (error) {
      console.error(`plan-activate: writer failed for ${subscriptionId}: ${error.message}`);
      return unavailable();
    }
    if (!data?.ok) {
      console.error(`plan-activate: writer refused for ${subscriptionId}: ${data?.reason}`);
      return unavailable();
    }

    // The store this resolved to is NOT returned. The caller told us three
    // identifiers and gets back whether activation happened -- nothing that
    // could be used to enumerate stores by paying once.
    console.log(
      `plan-activate: ${subscriptionId} cycle=${resolved.idempotencyKey} ` +
      `activated=${data.activated} created=${data.created} plan=${resolved.plan}`,
    );
    return json({ ok: true, activated: Boolean(data.activated) });
  } catch (err) {
    console.error(`plan-activate: unexpected failure: ${(err as Error)?.message}`);
    return unavailable();
  }
});
