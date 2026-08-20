import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, account_name, x-webhook-secret',
};
function reply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

// Shadowfax pushes a status update here on every shipment event. This is a PUBLIC
// endpoint — deploy with `--no-verify-jwt` and register its URL in the Shadowfax
// client portal (Webhook tab). It maps the update to a PocketLink order by AWB and
// records the latest courier status. An optional shared secret (env
// SHADOWFAX_WEBHOOK_SECRET) guards it — set it and configure the same value in the
// portal's Authorization header.
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const secret = Deno.env.get('SHADOWFAX_WEBHOOK_SECRET');
    if (secret) {
      const got = req.headers.get('authorization') || req.headers.get('x-webhook-secret') || '';
      if (got !== secret && got !== `Token ${secret}`) return reply({ ok: false, error: 'unauthorized' }, 401);
    }

    const body   = await req.json().catch(() => ({}));
    const awb    = String(body.awb_number || '').trim();
    const status = String(body.status || body.event || '').trim();
    if (!awb) return reply({ ok: false, error: 'missing awb_number' });

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    if (status) {
      await supabase.from('orders')
        .update({ shipment_status: status })
        .eq('awb', awb).eq('courier', 'shadowfax');
    }
    return reply({ ok: true });
  } catch (err) {
    return reply({ ok: false, error: (err as Error).message });
  }
});
