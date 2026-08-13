import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

// Owner-only (PIN-checked): connect or disconnect a store's Razorpay account.
// Credentials are written to the RLS-locked store_payment_accounts table with the
// service role — the browser never stores or reads the secret. A public-safe flag
// (config.payments) is mirrored onto the store so the storefront can show/hide
// "Pay Online" without touching the locked table.
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const { action = 'connect', slug, hashedPin, keyId, keySecret } = await req.json();
    if (!slug || !hashedPin) return json({ error: 'Missing store or PIN' });

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // PIN gate: the stored pin is the sha256 hash; compare against what the client sends.
    const { data: store } = await supabase.from('stores').select('pin, config').eq('slug', slug).maybeSingle();
    if (!store) return json({ error: 'Store not found' });
    if (store.pin !== hashedPin) return json({ error: 'Incorrect PIN' });

    const config = store.config || {};
    const now = new Date().toISOString();

    if (action === 'disconnect') {
      await supabase.from('store_payment_accounts')
        .update({ status: 'revoked', updated_at: now })
        .eq('store_slug', slug);
      const newConfig = { ...config, payments: { ...(config.payments || {}), razorpay: false } };
      await supabase.from('stores').update({ config: newConfig, updated_at: now }).eq('slug', slug);
      return json({ connected: false });
    }

    // ── connect ──
    const cleanId     = String(keyId || '').trim();
    const cleanSecret = String(keySecret || '').trim();
    if (!cleanId || !cleanSecret) return json({ error: 'Enter both the Key ID and the Key Secret' });
    if (!/^rzp_(test|live)_/.test(cleanId)) {
      return json({ error: 'Key ID should look like rzp_test_… or rzp_live_…' });
    }

    // Validate the credentials with Razorpay before saving (401 = wrong keys).
    const auth = btoa(`${cleanId}:${cleanSecret}`);
    const check = await fetch('https://api.razorpay.com/v1/payments?count=1', {
      headers: { Authorization: `Basic ${auth}` },
    });
    if (check.status === 401) {
      return json({ error: 'Razorpay rejected these keys — double-check the Key ID and Secret.' });
    }

    const mode = cleanId.startsWith('rzp_live_') ? 'live' : 'test';
    const keyIdMasked = `${cleanId.slice(0, 12)}••••${cleanId.slice(-4)}`;

    await supabase.from('store_payment_accounts').upsert({
      store_slug:  slug,
      provider:    'razorpay',
      mode,
      key_id:      cleanId,
      key_secret:  cleanSecret,
      status:      'connected',
      connected_at: now,
      updated_at:  now,
    }, { onConflict: 'store_slug' });

    const newConfig = { ...config, payments: { ...(config.payments || {}), razorpay: true, mode, keyIdMasked } };
    await supabase.from('stores').update({ config: newConfig, updated_at: now }).eq('slug', slug);

    return json({ connected: true, mode, keyIdMasked });
  } catch (err) {
    return json({ error: (err as Error).message });
  }
});
