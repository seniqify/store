import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Razorpay Plan IDs. plan → period → plan_id. 2026-07 pricing: internal key
// 'business' is displayed "Growth" (₹199/mo · ₹1,999/yr) and 'premium' is
// displayed "Pro" (₹599/mo · ₹5,999/yr). The amounts debited are these plans'
// amounts — they MUST match the prices shown in src/pages/Plans.jsx & Checkout.
// All older plans (starter 149, legacy pro 249 'plan_Szqmm…', old business 500
// 'plan_Szqmn3…', old premium 1000 'plan_SzqmnP…') are retired but permanent —
// existing mandates keep charging them until migrated.
const PLAN_IDS: Record<string, Record<string, string>> = {
  starter:  { monthly: 'plan_T534Tj7pKAPhOP', yearly: 'plan_T534TvGMXAl18M' },
  pro:      { monthly: 'plan_Szqmme5MgX3kcg', yearly: 'plan_SzqmmuDV66K4lm' },   // legacy ₹249 — grandfathered renewals only
  business: { monthly: 'plan_T8tUVJDyKVHUqA', yearly: 'plan_T8tUVTmHtEauYl' },   // Growth ₹199 / ₹1,999
  premium:  { monthly: 'plan_T8tUVd3OJkD8m8', yearly: 'plan_T8tUVnFLUkTGYl' },   // Pro ₹599 / ₹5,999
};

// How many billing cycles the mandate runs for before it ends (≈10 years each).
const TOTAL_COUNT: Record<string, number> = { monthly: 120, yearly: 10 };

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const { plan, period = 'monthly', phone } = await req.json();

    const planId = PLAN_IDS[plan]?.[period];
    if (!planId) throw new Error('Invalid plan or billing period');

    const keyId     = Deno.env.get('RAZORPAY_KEY_ID');
    const keySecret = Deno.env.get('RAZORPAY_KEY_SECRET');
    if (!keyId || !keySecret) throw new Error('Razorpay credentials not configured');

    const auth = btoa(`${keyId}:${keySecret}`);

    const res = await fetch('https://api.razorpay.com/v1/subscriptions', {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Basic ${auth}`,
      },
      body: JSON.stringify({
        plan_id:         planId,
        total_count:     TOTAL_COUNT[period] ?? 120,
        quantity:        1,
        customer_notify: 1,
        notes:           { plan, period, phone: String(phone) },
      }),
    });

    const data = await res.json();

    if (!data.id) {
      throw new Error(data.error?.description ?? `Razorpay error: ${JSON.stringify(data)}`);
    }

    return new Response(
      JSON.stringify({ subscription_id: data.id, key_id: keyId, plan, period }),
      { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } },
    );
  }
});
