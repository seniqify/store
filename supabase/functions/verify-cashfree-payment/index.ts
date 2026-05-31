import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const BASE = Deno.env.get('CASHFREE_ENV') === 'production'
  ? 'https://api.cashfree.com/pg'
  : 'https://sandbox.cashfree.com/pg';

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { order_id } = await req.json();
    if (!order_id) throw new Error('order_id is required');

    const res = await fetch(`${BASE}/orders/${order_id}`, {
      headers: {
        'x-api-version': '2023-08-01',
        'x-client-id': Deno.env.get('CASHFREE_APP_ID')!,
        'x-client-secret': Deno.env.get('CASHFREE_SECRET_KEY')!,
      },
    });

    const data = await res.json();

    // order_id format: PL_STARTER_1234567890
    const match = String(order_id).match(/^PL_([A-Z]+)_/);
    const plan = match ? match[1].toLowerCase() : null;

    return new Response(
      JSON.stringify({
        verified: data.order_status === 'PAID',
        plan,
        order_status: data.order_status,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message, verified: false }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
