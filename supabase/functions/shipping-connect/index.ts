import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
function json(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

const BASE = 'https://track.delhivery.com';

// Owner-only (PIN-checked): connect / disconnect a store's Delhivery account.
// The API token is written to the RLS-locked store_shipping_accounts table with
// the service role — never exposed to the browser. A public flag (config.shipping)
// is mirrored onto the store so the storefront can offer courier rates.
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const body = await req.json();
    const { action = 'connect', slug, hashedPin } = body;
    if (!slug || !hashedPin) return json({ error: 'Missing store or PIN' });

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data: store } = await supabase.from('stores').select('pin, config').eq('slug', slug).maybeSingle();
    if (!store) return json({ error: 'Store not found' });
    if (store.pin !== hashedPin) return json({ error: 'Incorrect PIN' });

    const config = store.config || {};
    const now = new Date().toISOString();

    if (action === 'disconnect') {
      await supabase.from('store_shipping_accounts').update({ status: 'revoked', updated_at: now }).eq('store_slug', slug);
      const newConfig = { ...config, shipping: { ...(config.shipping || {}), delhivery: false } };
      await supabase.from('stores').update({ config: newConfig, updated_at: now }).eq('slug', slug);
      return json({ connected: false });
    }

    // ── connect ──
    const token   = String(body.apiToken || '').trim();
    const pincode = String(body.pickupPincode || '').replace(/\D/g, '');
    const address = String(body.pickupAddress || '').trim();
    const phone   = String(body.pickupPhone || '').replace(/\D/g, '').slice(-10);
    if (!token) return json({ error: 'Enter your Delhivery API token' });
    if (pincode.length !== 6) return json({ error: 'Enter a valid 6-digit pickup pincode' });

    // Validate the token with a read-only serviceability call on the pickup pincode.
    const check = await fetch(`${BASE}/c/api/pin-codes/json/?filter_codes=${pincode}`, {
      headers: { Authorization: `Token ${token}` },
    });
    if (check.status === 401 || check.status === 403) {
      return json({ error: 'Delhivery rejected this token — double-check it.' });
    }
    const checkData = await check.json().catch(() => ({}));
    const pc = checkData?.delivery_codes?.[0]?.postal_code;
    if (!pc) return json({ error: `Delhivery could not verify pickup pincode ${pincode}. Check the pincode.` });
    if (String(pc.pickup).toUpperCase() !== 'Y') {
      return json({ error: `Delhivery pickup isn't available at ${pincode}.` });
    }

    // Default: pincodes sharing the pickup's first 3 digits are "local" (kept on
    // rider dispatch); everything else routes to Delhivery. Owner can override.
    const localPrefix = String(body.localPincodePrefix || pincode.slice(0, 3));
    const defaultWeight = Math.max(50, Number(body.defaultWeightG) || 500);

    // Register the pickup location (warehouse) — required by the shipment-create
    // API. Idempotent-ish: if one with this name already exists on the account,
    // Delhivery errors and we just reuse the name. Never blocks connect.
    const warehouseName = String(body.pickupName || config.businessName || slug).slice(0, 60);
    try {
      await fetch(`${BASE}/api/backend/clientwarehouse/create/`, {
        method: 'POST',
        headers: { Authorization: `Token ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: warehouseName, email: '', phone,
          address: address || warehouseName, city: pc.district || '', country: 'India', pin: pincode,
          return_address: address || warehouseName, return_pin: pincode,
          return_city: pc.district || '', return_state: pc.state_code || '', return_country: 'India',
        }),
      });
    } catch { /* already exists or transient — booking will use the name regardless */ }

    await supabase.from('store_shipping_accounts').upsert({
      store_slug:           slug,
      provider:             'delhivery',
      mode:                 token.length ? 'production' : 'staging',
      api_token:            token,
      pickup_name:          String(body.pickupName || config.businessName || slug).slice(0, 60),
      pickup_pincode:       pincode,
      pickup_phone:         phone,
      pickup_address:       address,
      pickup_city:          pc.district || '',
      local_pincode_prefix: localPrefix,
      default_weight_g:     defaultWeight,
      status:               'connected',
      connected_at:         now,
      updated_at:           now,
    }, { onConflict: 'store_slug' });

    const newConfig = {
      ...config,
      shipping: { ...(config.shipping || {}), delhivery: true, pickupPincode: pincode, localPrefix, district: pc.district || '' },
    };
    await supabase.from('stores').update({ config: newConfig, updated_at: now }).eq('slug', slug);

    return json({ connected: true, pickupPincode: pincode, district: pc.district });
  } catch (err) {
    return json({ error: (err as Error).message });
  }
});
