import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

// Create a Razorpay order on the STORE's OWN Razorpay account (money settles to
// the merchant, never to PocketLink). Credentials live in the RLS-locked
// store_payment_accounts table — read here with the service role, never exposed
// to the browser. The browser only ever receives the public key_id + order_id.
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const { slug, amount, notes } = await req.json();
    if (!slug || !(Number(amount) > 0)) return json({ error: 'Missing slug or amount' });

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data: acct } = await supabase
      .from('store_payment_accounts')
      .select('*')
      .eq('store_slug', slug)
      .maybeSingle();

    if (!acct || acct.status !== 'connected') {
      return json({ error: 'This store has not connected online payments' });
    }

    // Auth: OAuth access token (Partner flow) is preferred; the key/secret path is
    // the test-mode bridge until Partner approval lands. Either way Razorpay
    // Checkout on the client needs the merchant's public key_id.
    let authHeader: string;
    if (acct.oauth_access_token) {
      authHeader = `Bearer ${acct.oauth_access_token}`;
    } else if (acct.key_id && acct.key_secret) {
      authHeader = `Basic ${btoa(`${acct.key_id}:${acct.key_secret}`)}`;
    } else {
      return json({ error: 'No payment credentials on file for this store' });
    }
    if (!acct.key_id) return json({ error: 'Missing public key_id for checkout' });

    const res = await fetch('https://api.razorpay.com/v1/orders', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': authHeader },
      body: JSON.stringify({
        amount:   Math.round(Number(amount) * 100),   // rupees → paise
        currency: 'INR',
        notes:    { store: slug, ...(notes || {}) },
      }),
    });
    const data = await res.json();
    if (!data.id) {
      return json({ error: data.error?.description ?? `Razorpay error: ${JSON.stringify(data)}` });
    }

    return json({
      order_id: data.id,
      key_id:   acct.key_id,
      amount:   data.amount,
      currency: data.currency,
      mode:     acct.mode,
    });
  } catch (err) {
    return json({ error: (err as Error).message });
  }
});
