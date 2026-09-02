import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Razorpay Plan IDs. plan -> period -> plan_id.
//
// 2026-09 pricing: PocketLink is now ONE plan — ₹1,099/mo · ₹9,999/yr — that
// includes every feature (see src/utils/planLimits.js). The internal key stays
// 'premium' because that key is already recorded on stores and carried through
// the subscription notes + webhook, so collapsing the tiers needed no migration.
//
// IMPORTANT: changing a plan_id here only affects NEW subscriptions. Existing
// mandates keep charging the plan_id they were created with inside Razorpay, so
// grandfathered customers are untouched by this map.
//
// Retired but permanent (existing mandates keep renewing on them):
//   starter  149 : plan_T534Tj7pKAPhOP / plan_T534TvGMXAl18M
//   pro      249 : plan_Szqmme5MgX3kcg / plan_SzqmmuDV66K4lm
//   business 199 : plan_T8tUVJDyKVHUqA / plan_T8tUVTmHtEauYl
//   premium  599 : plan_T8tUVd3OJkD8m8 / plan_T8tUVnFLUkTGYl
//   prem+   1000 : plan_SzqmnPq8JoWcSc / plan_SzqmnZ9M5keufj
const PLAN_IDS: Record<string, Record<string, string>> = {
  // THE plan — ₹1,099/mo · ₹9,999/yr (created 2026-09-01, GST-inclusive).
  // The amount debited is the plan_id's amount, NEVER the price shown in the UI:
  // if you change the displayed price, create new plans and swap these ids, and
  // always deploy this function BEFORE the front-end.
  premium: {
    monthly: 'plan_TX4Yj0ktnJ9Ic3',
    yearly:  'plan_TX4a4orxglrlrC',
  },

  // Legacy keys kept so any in-flight/grandfathered checkout still resolves.
  starter:      { monthly: 'plan_T534Tj7pKAPhOP', yearly: 'plan_T534TvGMXAl18M' },
  pro:          { monthly: 'plan_Szqmme5MgX3kcg', yearly: 'plan_SzqmmuDV66K4lm' },
  business:     { monthly: 'plan_T8tUVJDyKVHUqA', yearly: 'plan_T8tUVTmHtEauYl' },
  premium_plus: { monthly: 'plan_SzqmnPq8JoWcSc', yearly: 'plan_SzqmnZ9M5keufj' },
};

// How many billing cycles the mandate runs for before it ends (≈10 years each).
const TOTAL_COUNT: Record<string, number> = { monthly: 120, yearly: 10 };

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const { plan, period = 'monthly', phone } = await req.json();

    const planId = PLAN_IDS[plan]?.[period];
    if (!planId) throw new Error('Invalid plan or billing period');
    // Fail loudly rather than silently charging a wrong/stale amount.
    if (planId.startsWith('REPLACE_WITH_')) {
      throw new Error('Razorpay plan_id not configured for this plan/period yet');
    }

    // The ₹1,000 online tier (premium_plus) grants the same features as Pro, so
    // the store is recorded as 'premium' — only the debited amount differs. The
    // webhook + client read this from notes/echo when provisioning the store.
    const storePlan = plan === 'premium_plus' ? 'premium' : plan;

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
        notes:           { plan: storePlan, period, phone: String(phone) },
      }),
    });

    const data = await res.json();

    if (!data.id) {
      throw new Error(data.error?.description ?? `Razorpay error: ${JSON.stringify(data)}`);
    }

    return new Response(
      JSON.stringify({ subscription_id: data.id, key_id: keyId, plan: storePlan, period }),
      { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } },
    );
  }
});
