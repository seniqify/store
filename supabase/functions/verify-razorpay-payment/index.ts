import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { crypto } from 'https://deno.land/std@0.168.0/crypto/mod.ts';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Verify a Razorpay payment by signature ONLY.
//
// Why no further Razorpay API calls: the signature is what proves the payment is
// authentic, and once it matches, the money is real. Previously this function
// also fetched the subscription/order to read `notes.plan` — and if that second
// call was slow or blipped, the whole thing fell into the catch and returned
// verified:false, flipping a genuine, captured payment to "failed". The client
// already knows the plan/period it's paying for, so we don't fetch it here.
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const {
      razorpay_order_id,
      razorpay_subscription_id,
      razorpay_payment_id,
      razorpay_signature,
    } = await req.json();

    const keySecret = Deno.env.get('RAZORPAY_KEY_SECRET');
    if (!keySecret) throw new Error('Razorpay secret not configured');

    if (!razorpay_payment_id || !razorpay_signature) {
      return json({ verified: false, error: 'Missing payment details' });
    }

    // Subscriptions sign payment_id|subscription_id; one-time orders sign
    // order_id|payment_id.
    const message = razorpay_subscription_id
      ? `${razorpay_payment_id}|${razorpay_subscription_id}`
      : razorpay_order_id
        ? `${razorpay_order_id}|${razorpay_payment_id}`
        : null;

    if (!message) return json({ verified: false, error: 'Missing order or subscription id' });

    const computed = await hmacHex(keySecret, message);
    const ok = computed === razorpay_signature;

    return json(ok ? { verified: true } : { verified: false, error: 'Payment signature mismatch' });
  } catch (err) {
    return json({ verified: false, error: (err as Error).message });
  }
});
