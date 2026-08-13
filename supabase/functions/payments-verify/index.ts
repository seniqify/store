import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { crypto } from 'https://deno.land/std@0.168.0/crypto/mod.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

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

// Verify a customer's Razorpay payment for a store order, then mark that order
// PAID. The signature (HMAC of `order_id|payment_id` with the merchant's key
// secret) is what proves the money is real — once it matches, we flip the order.
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const { slug, razorpay_order_id, razorpay_payment_id, razorpay_signature, order_row_id } = await req.json();
    if (!slug || !razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return json({ verified: false, error: 'Missing payment details' });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data: acct } = await supabase
      .from('store_payment_accounts')
      .select('key_secret')
      .eq('store_slug', slug)
      .maybeSingle();

    // Key-based (test bridge) verifies with the merchant's key_secret. In the
    // OAuth partner flow the partner may not hold the secret — there, the
    // authoritative "paid" signal is the payment.captured webhook (added later).
    const secret = acct?.key_secret;
    if (!secret) return json({ verified: false, error: 'No secret on file to verify (use webhook)' });

    const computed = await hmacHex(secret, `${razorpay_order_id}|${razorpay_payment_id}`);
    if (computed !== razorpay_signature) {
      return json({ verified: false, error: 'Payment signature mismatch' });
    }

    // Signature is valid → money is real. Mark the order paid (scoped to slug so a
    // valid signature for one store can't flip another store's order).
    if (order_row_id) {
      await supabase
        .from('orders')
        .update({ paid: true, payment_ref: razorpay_payment_id, payment_provider: 'razorpay' })
        .eq('id', order_row_id)
        .eq('store_slug', slug);
    }

    return json({ verified: true });
  } catch (err) {
    return json({ verified: false, error: (err as Error).message });
  }
});
