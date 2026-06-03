import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { crypto } from 'https://deno.land/std@0.168.0/crypto/mod.ts';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const body = await req.json();
    const {
      razorpay_order_id,
      razorpay_subscription_id,
      razorpay_payment_id,
      razorpay_signature,
    } = body;

    const keySecret = Deno.env.get('RAZORPAY_KEY_SECRET');
    if (!keySecret) throw new Error('Razorpay secret not configured');
    const keyId = Deno.env.get('RAZORPAY_KEY_ID');
    const auth  = btoa(`${keyId}:${keySecret}`);

    // ── Subscription (auto-debit) — signature is payment_id|subscription_id ──────
    if (razorpay_subscription_id) {
      if (!razorpay_payment_id || !razorpay_signature) throw new Error('Missing payment details');

      const computed = await hmacHex(keySecret, `${razorpay_payment_id}|${razorpay_subscription_id}`);
      if (computed !== razorpay_signature) {
        return new Response(
          JSON.stringify({ verified: false, error: 'Payment signature mismatch' }),
          { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } },
        );
      }

      // Read plan/period back from the subscription's notes
      const subRes = await fetch(`https://api.razorpay.com/v1/subscriptions/${razorpay_subscription_id}`, {
        headers: { 'Authorization': `Basic ${auth}` },
      });
      const sub    = await subRes.json();
      const plan   = sub.notes?.plan ?? null;
      const period = sub.notes?.period ?? 'monthly';

      return new Response(
        JSON.stringify({ verified: true, plan, period, subscription_id: razorpay_subscription_id }),
        { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } },
      );
    }

    // ── One-time order (legacy) — signature is order_id|payment_id ───────────────
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      throw new Error('Missing payment details');
    }

    const computed = await hmacHex(keySecret, `${razorpay_order_id}|${razorpay_payment_id}`);
    if (computed !== razorpay_signature) {
      return new Response(
        JSON.stringify({ verified: false, error: 'Payment signature mismatch' }),
        { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } },
      );
    }

    const ordRes = await fetch(`https://api.razorpay.com/v1/orders/${razorpay_order_id}`, {
      headers: { 'Authorization': `Basic ${auth}` },
    });
    const order  = await ordRes.json();
    const plan   = order.notes?.plan ?? null;
    const period = order.notes?.period ?? 'monthly';

    return new Response(
      JSON.stringify({ verified: true, plan, period }),
      { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ verified: false, error: (err as Error).message }),
      { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } },
    );
  }
});
