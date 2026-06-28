import { serve }        from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// send-campaign — broadcast a store's OWN approved Seniqify template to its saved
// customers. The owner's template URL + Bearer key live in store_whatsapp (never
// in public config); we read them with the service role, attach the key, and post
// the personalised "multiple" payload. Mirrors send-otp (same BSP, same auth).

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Recipients per "multiple" request. Kept modest so a big segment is chunked
// into several calls rather than one giant payload.
const BATCH_SIZE = 200;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const { slug, hashedPin, recipients } = await req.json();
    if (!slug || !hashedPin)            return json({ error: 'Missing store or PIN.' }, 400);
    if (!Array.isArray(recipients) || recipients.length === 0)
      return json({ error: 'No recipients.' }, 400);

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // PIN check — the store's hashed PIN must match.
    const { data: store } = await supabase
      .from('stores').select('pin').eq('slug', slug).maybeSingle();
    if (!store || store.pin !== hashedPin) return json({ error: 'Unauthorized.' }, 403);

    // Owner's saved WhatsApp credentials.
    const { data: cfg } = await supabase
      .from('store_whatsapp').select('template_url, api_key').eq('store_slug', slug).maybeSingle();
    if (!cfg?.template_url || !cfg?.api_key)
      return json({ error: 'WhatsApp is not connected for this store yet.' }, 400);

    const headers: Record<string, string> = {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${cfg.api_key}`,
    };

    // Normalise + de-dup recipients by receiver number.
    const seen = new Set<string>();
    const clean = recipients
      .map((r: any) => ({ receiver: String(r?.receiver || '').replace(/\D/g, ''), values: r?.values || {} }))
      .filter((r: any) => r.receiver.length >= 10 && !seen.has(r.receiver) && seen.add(r.receiver));

    if (clean.length === 0) return json({ error: 'No valid recipients.' }, 400);

    // Send in batches; tolerate per-batch failure so one bad chunk doesn't sink
    // the rest. The endpoint can be slow to respond, but the send is accepted
    // when the request lands.
    let sent = 0;
    let failed = 0;
    for (let i = 0; i < clean.length; i += BATCH_SIZE) {
      const batch = clean.slice(i, i + BATCH_SIZE);
      try {
        const res = await fetch(cfg.template_url, {
          method:  'POST',
          headers,
          body: JSON.stringify({ type: 'multiple', numbers: batch }),
        });
        if (res.ok) {
          sent += batch.length;
        } else {
          failed += batch.length;
          console.error(`send-campaign batch ${res.status}: ${(await res.text()).slice(0, 300)}`);
        }
      } catch (e) {
        failed += batch.length;
        console.error('send-campaign batch error:', (e as Error)?.message);
      }
    }

    return json({ success: failed === 0, sent, failed });
  } catch (err) {
    console.error('send-campaign error:', err);
    return json({ error: (err as Error).message ?? 'Internal error' }, 500);
  }
});
