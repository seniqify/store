import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const PRICES: Record<string, number> = { starter: 299, growth: 699 };

const BASE = Deno.env.get('CASHFREE_ENV') === 'production'
  ? 'https://api.cashfree.com/pg'
  : 'https://sandbox.cashfree.com/pg';

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { plan, phone } = await req.json();

    const amount = PRICES[plan];
    if (!amount) throw new Error('Invalid plan');

    const orderId = `PL_${plan.toUpperCase()}_${Date.now()}`;
    const customerPhone = String(phone).replace(/\D/g, '').slice(-10);

    const appId  = Deno.env.get('CASHFREE_APP_ID');
    const secret = Deno.env.get('CASHFREE_SECRET_KEY');
    const env    = Deno.env.get('CASHFREE_ENV');

    // Surface missing-secret problems immediately
    if (!appId || !secret) {
      throw new Error(`Missing credentials: appId=${!!appId} secret=${!!secret} env=${env}`);
    }

    const body = {
      order_id: orderId,
      order_amount: amount,
      order_currency: 'INR',
      customer_details: {
        customer_id: `cust_${customerPhone}`,
        customer_phone: customerPhone,
        customer_name: 'Customer',
        customer_email: 'customer@pocketlink.store',
      },
      order_meta: {
        return_url: `${Deno.env.get('SITE_URL') ?? 'https://pocketlink.store'}/checkout/${plan}`,
      },
    };

    const res = await fetch(`${BASE}/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-version': '2023-08-01',
        'x-client-id': appId,
        'x-client-secret': secret,
      },
      body: JSON.stringify(body),
    });

    const data = await res.json();

    if (!data.payment_session_id) {
      // Include HTTP status + full Cashfree body for debugging
      throw new Error(
        `Cashfree ${res.status}: ${data.message ?? data.type ?? JSON.stringify(data)}`
      );
    }

    return new Response(
      JSON.stringify({ order_id: orderId, payment_session_id: data.payment_session_id }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
