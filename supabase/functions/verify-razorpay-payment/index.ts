import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { crypto } from 'https://deno.land/std@0.168.0/crypto/mod.ts';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = await req.json();
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      throw new Error('Missing payment details');
    }

    const keySecret = Deno.env.get('RAZORPAY_KEY_SECRET');
    if (!keySecret) throw new Error('Razorpay secret not configured');

    // Verify HMAC-SHA256 signature
    const body    = `${razorpay_order_id}|${razorpay_payment_id}`;
    const key     = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(keySecret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const sigBytes  = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
    const computed  = Array.from(new Uint8Array(sigBytes))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    if (computed !== razorpay_signature) {
      return new Response(
        JSON.stringify({ verified: false, error: 'Payment signature mismatch' }),
        { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } },
      );
    }

    // Extract plan + period from order receipt via Razorpay fetch
    const keyId  = Deno.env.get('RAZORPAY_KEY_ID');
    const auth   = btoa(`${keyId}:${keySecret}`);
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
