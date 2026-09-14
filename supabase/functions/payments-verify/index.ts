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

/** Rupees (numeric column) → integer paise. Same function in payments-create-order. */
function toPaise(rupees: unknown): number {
  return Math.round(Number(rupees) * 100);
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
// PAID.
//
// A valid signature proves money was paid for SOME Razorpay order on this
// store's account. On its own it used to be enough, which let a genuine ₹1
// payment mark any other order of the store paid: nothing tied the Razorpay
// order to the row being flipped, or its amount to the row's total. Now the
// Razorpay order is fetched and must carry this row's id in its notes (set by
// payments-create-order) and exactly this row's total in paise.
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const { slug, razorpay_order_id, razorpay_payment_id, razorpay_signature, order_row_id } = await req.json();
    if (!slug || !razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !order_row_id) {
      return json({ verified: false, error: 'Missing payment details' });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data: acct } = await supabase
      .from('store_payment_accounts')
      .select('key_id, key_secret, oauth_access_token')
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

    // ── Bind the payment to THIS order and THIS amount ─────────────────────
    const authHeader = acct.oauth_access_token
      ? `Bearer ${acct.oauth_access_token}`
      : `Basic ${btoa(`${acct.key_id}:${secret}`)}`;
    const rzRes = await fetch(`https://api.razorpay.com/v1/orders/${encodeURIComponent(razorpay_order_id)}`, {
      headers: { 'Authorization': authHeader },
    });
    const rzOrder = await rzRes.json();
    if (!rzRes.ok || !rzOrder?.id) {
      return json({ verified: false, error: 'Could not confirm the payment with Razorpay' });
    }

    const { data: order } = await supabase
      .from('orders')
      .select('id, total')
      .eq('id', order_row_id)
      .eq('store_slug', slug)
      .maybeSingle();
    if (!order) return json({ verified: false, error: 'Order not found for this store' });

    if (String(rzOrder.notes?.order_row_id ?? '') !== String(order.id)) {
      return json({ verified: false, error: 'This payment belongs to a different order' });
    }
    if (Number(rzOrder.amount) !== toPaise(order.total)) {
      return json({ verified: false, error: 'The amount paid does not match the order total' });
    }

    // Signature valid, and the payment is for this order at its full amount.
    await supabase
      .from('orders')
      .update({ paid: true, paid_at: new Date().toISOString(), paid_via: 'razorpay', payment_ref: razorpay_payment_id, payment_provider: 'razorpay' })
      .eq('id', order.id)
      .eq('store_slug', slug);

    return json({ verified: true });
  } catch (err) {
    return json({ verified: false, error: (err as Error).message });
  }
});
