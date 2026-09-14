import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

/** Rupees (numeric column) → integer paise. Same function in payments-verify. */
function toPaise(rupees: unknown): number {
  return Math.round(Number(rupees) * 100);
}

// Create a Razorpay order on the STORE's OWN Razorpay account (money settles to
// the merchant, never to PocketLink). Credentials live in the RLS-locked
// store_payment_accounts table — read here with the service role, never exposed
// to the browser. The browser only ever receives the public key_id + order_id.
//
// THE AMOUNT NEVER COMES FROM THE BROWSER. It used to: the request carried
// `amount`, so anyone could open the payment sheet for ₹1 against a ₹5,000
// order. The charge is now read from the saved order row, and that row's id is
// written into the Razorpay order's notes so payments-verify can prove a payment
// belongs to exactly this order and this amount.
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const body = await req.json();
    const slug = body?.slug;
    // Top-level order_row_id; notes.order_row_id is what checkout builds cached
    // before this change still send. Any `amount` in the body is ignored.
    const orderRowId = body?.order_row_id ?? body?.notes?.order_row_id;
    if (!slug || !orderRowId) return json({ error: 'Missing store or order' });

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data: order } = await supabase
      .from('orders')
      .select('id, store_slug, total, paid, status, payment_method')
      .eq('id', orderRowId)
      .eq('store_slug', slug)
      .maybeSingle();

    if (!order) return json({ error: 'We could not find this order. Please try again.' });
    if (order.paid === true) return json({ error: 'This order is already paid.' });
    if (order.status === 'cancelled' || order.status === 'abandoned') {
      return json({ error: 'This order can no longer be paid.' });
    }
    if (String(order.payment_method || '').toLowerCase() !== 'online') {
      return json({ error: 'This order is not set to be paid online.' });
    }
    const amount = toPaise(order.total);
    if (!Number.isInteger(amount) || amount < 100) {   // Razorpay's minimum is ₹1
      return json({ error: 'This order has no amount to pay.' });
    }

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
        amount,                                   // paise, from the saved order
        currency: 'INR',
        receipt:  String(order.id).slice(0, 40),
        notes:    { store: slug, order_row_id: order.id },
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
