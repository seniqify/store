import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
function json(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

// Delhivery production base. (Read-only calls here — serviceability + rate — never
// create a shipment or a pickup, so they're safe on any live account.)
const BASE = 'https://track.delhivery.com';

// Checkout helper: is the customer's pincode serviceable, and what does Delhivery
// charge to ship there? Uses the STORE's own Delhivery token (server-side only).
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const { slug, destPincode, weightG, paymentMode } = await req.json();
    const dest = String(destPincode || '').replace(/\D/g, '');
    if (!slug || dest.length !== 6) return json({ error: 'Missing store or a valid 6-digit pincode' });

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    const { data: acct } = await supabase
      .from('store_shipping_accounts')
      .select('api_token, pickup_pincode, default_weight_g, status')
      .eq('store_slug', slug)
      .maybeSingle();
    if (!acct || acct.status !== 'connected' || !acct.api_token) {
      return json({ error: 'This store has not connected Delhivery' });
    }

    const token   = acct.api_token;
    const origin  = String(acct.pickup_pincode || '').replace(/\D/g, '');
    const weight  = Math.max(50, Number(weightG) || acct.default_weight_g || 500);
    const pt      = paymentMode === 'COD' ? 'COD' : 'Pre-paid';
    const headers = { Authorization: `Token ${token}` };

    // 1) Serviceability (read-only)
    const sRes = await fetch(`${BASE}/c/api/pin-codes/json/?filter_codes=${dest}`, { headers });
    const sData = await sRes.json().catch(() => ({}));
    const pc = sData?.delivery_codes?.[0]?.postal_code;
    if (!pc) return json({ serviceable: false, reason: 'Delhivery does not deliver to this pincode' });
    const codOk     = String(pc.cod).toUpperCase() === 'Y';
    const prepaidOk = String(pc.pre_paid).toUpperCase() === 'Y';
    if (pt === 'COD' && !codOk) {
      return json({ serviceable: true, cod: false, prepaid: prepaidOk, reason: 'COD not available at this pincode — choose Prepaid' });
    }

    // 2) Rate (read-only)
    const q = `md=E&ss=Delivered&d_pin=${dest}&o_pin=${origin}&cgm=${weight}&pt=${encodeURIComponent(pt)}`;
    const rRes = await fetch(`${BASE}/api/kinko/v1/invoice/charges/.json?${q}`, { headers });
    const rData = await rRes.json().catch(() => ([]));
    const row = Array.isArray(rData) ? rData[0] : rData;
    const amount = Number(row?.total_amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      // Serviceable but no priced rate — let the caller fall back to the flat charge.
      return json({ serviceable: true, cod: codOk, prepaid: prepaidOk, amount: null, district: pc.district });
    }

    return json({
      serviceable: true,
      cod: codOk,
      prepaid: prepaidOk,
      amount: Math.ceil(amount),   // round up to the rupee
      district: pc.district,
      state: pc.state_code,
      zone: row?.zone,
    });
  } catch (err) {
    return json({ error: (err as Error).message });
  }
});
