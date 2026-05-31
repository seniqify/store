import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Charge amounts in ₹ (same structure as frontend PRICING constant)
const CHARGES: Record<string, Record<string, number>> = {
  pro: {
    monthly:  551,
    halfyear: 2814,
    yearly:   4668,
  },
  business: {
    monthly:  1000,
    halfyear: 5094,
    yearly:   8388,
  },
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const { plan, period = 'monthly', phone } = await req.json();

    const planCharges = CHARGES[plan];
    if (!planCharges) throw new Error('Invalid plan');

    const amount = planCharges[period];
    if (!amount) throw new Error('Invalid billing period');

    const keyId     = Deno.env.get('RAZORPAY_KEY_ID');
    const keySecret = Deno.env.get('RAZORPAY_KEY_SECRET');
    if (!keyId || !keySecret) throw new Error('Razorpay credentials not configured');

    const receipt  = `PL_${plan.toUpperCase()}_${period.toUpperCase()}_${Date.now()}`;
    const auth     = btoa(`${keyId}:${keySecret}`);

    const res  = await fetch('https://api.razorpay.com/v1/orders', {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Basic ${auth}`,
      },
      body: JSON.stringify({
        amount:   amount * 100, // Razorpay expects paise
        currency: 'INR',
        receipt,
        notes:    { plan, period, phone: String(phone) },
      }),
    });

    const data = await res.json();

    if (!data.id) {
      throw new Error(data.error?.description ?? `Razorpay error: ${JSON.stringify(data)}`);
    }

    return new Response(
      JSON.stringify({ order_id: data.id, amount, receipt, key_id: keyId }),
      { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } },
    );
  }
});
