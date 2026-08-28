import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
function json(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } });
}
const DLV_BASE = 'https://track.delhivery.com';

const isTerminal = (s: string) => /deliver|cancel|\brto\b|returned/i.test(String(s || ''));

async function inChunks<T>(items: T[], size: number, fn: (x: T) => Promise<void>) {
  for (let i = 0; i < items.length; i += size) {
    await Promise.all(items.slice(i, i + size).map(fn));
  }
}

// Owner-only (PIN-checked): refresh the LIVE courier status for every open shipment
// in one shot, so the Delivery board always matches the courier — without relying
// on the webhook or a manual per-order Track. Shadowfax: parallel single-AWB v4
// track. Delhivery: one multi-waybill call per 40. Writes back only what changed.
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const { slug, hashedPin } = await req.json();
    if (!slug || !hashedPin) return json({ error: 'Missing store or PIN' });

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data: store } = await supabase.from('stores').select('pin').eq('slug', slug).maybeSingle();
    if (!store) return json({ error: 'Store not found' });
    if (store.pin !== hashedPin) return json({ error: 'Incorrect PIN' });

    const { data: accts } = await supabase
      .from('store_shipping_accounts')
      .select('provider, mode, api_token, status')
      .eq('store_slug', slug);
    const acctOf = (p: string) => (accts || []).find((a: any) => a.provider === p && a.status === 'connected' && a.api_token);

    // Open shipments only (skip delivered/cancelled/RTO — they won't change), newest first.
    const { data: rows } = await supabase
      .from('orders')
      .select('id, awb, courier, shipment_status')
      .eq('store_slug', slug)
      .not('awb', 'is', null)
      .order('created_at', { ascending: false })
      .limit(300);
    const open = (rows || []).filter((o: any) => !isTerminal(o.shipment_status));

    const updates: { id: string; status: string }[] = [];

    // ── Shadowfax: parallel single-AWB track (cap 80 per run; backlog clears over a few opens) ──
    const sfx = acctOf('shadowfax');
    if (sfx) {
      const sBase = sfx.mode === 'production' ? 'https://dale.shadowfax.in/api' : 'https://dale.staging.shadowfax.in/api';
      const sfxOrders = open.filter((o: any) => String(o.courier).toLowerCase() === 'shadowfax').slice(0, 80);
      await inChunks(sfxOrders, 8, async (o: any) => {
        try {
          const r = await fetch(`${sBase}/v4/clients/orders/${o.awb}/track/`, { headers: { Authorization: `Token ${sfx.api_token}` } });
          const d = await r.json().catch(() => ({}));
          const st = d?.order_details?.status_display || d?.order_details?.status;
          if (st && st !== o.shipment_status) updates.push({ id: o.id, status: st });
        } catch { /* skip this one */ }
      });
    }

    // ── Delhivery: one multi-waybill call per 40 AWBs ──
    const dlv = acctOf('delhivery');
    if (dlv) {
      const dlvOrders = open.filter((o: any) => String(o.courier || 'delhivery').toLowerCase() === 'delhivery').slice(0, 160);
      for (let i = 0; i < dlvOrders.length; i += 40) {
        const chunk = dlvOrders.slice(i, i + 40);
        try {
          const awbs = chunk.map((o: any) => o.awb).join(',');
          const r = await fetch(`${DLV_BASE}/api/v1/packages/json/?waybill=${awbs}`, { headers: { Authorization: `Token ${dlv.api_token}` } });
          const d = await r.json().catch(() => ({}));
          const byAwb: Record<string, string> = {};
          for (const s of (d?.ShipmentData || [])) {
            const awb = String(s?.Shipment?.AWB || '');
            const st  = s?.Shipment?.Status?.Status;
            if (awb && st) byAwb[awb] = st;
          }
          chunk.forEach((o: any) => {
            const st = byAwb[String(o.awb)];
            if (st && st !== o.shipment_status) updates.push({ id: o.id, status: st });
          });
        } catch { /* skip this chunk */ }
      }
    }

    // Write back only the changes.
    await inChunks(updates, 10, async (u) => {
      await supabase.from('orders').update({ shipment_status: u.status }).eq('id', u.id).eq('store_slug', slug);
    });

    return json({ updated: updates.length, checked: open.length });
  } catch (err) {
    return json({ error: (err as Error).message });
  }
});
