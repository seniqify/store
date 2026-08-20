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

// Owner-only (PIN-checked) shipment ops on a booked order:
//   label  → return the packing-slip PDF link (print)
//   track  → current Delhivery status
//   cancel → cancel the shipment and clear the AWB
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const { action, slug, hashedPin, orderId } = await req.json();
    if (!slug || !hashedPin || !orderId) return json({ error: 'Missing store, PIN, or order' });

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    const { data: store } = await supabase.from('stores').select('pin').eq('slug', slug).maybeSingle();
    if (!store) return json({ error: 'Store not found' });
    if (store.pin !== hashedPin) return json({ error: 'Incorrect PIN' });

    const { data: acct } = await supabase.from('store_shipping_accounts')
      .select('provider, api_token').eq('store_slug', slug).maybeSingle();
    const { data: order } = await supabase.from('orders')
      .select('awb, courier, shipment_status').eq('id', orderId).eq('store_slug', slug).maybeSingle();
    const token = acct?.api_token;
    const awb = order?.awb;
    if (!token) return json({ error: 'Shipping not connected' });
    if (!awb) return json({ error: 'This order has no shipment yet' });

    // ── Shadowfax ops (the Delhivery code below is untouched) ──
    if (order?.courier === 'shadowfax' || acct?.provider === 'shadowfax') {
      if (action === 'track')  return json({ status: order?.shipment_status || 'Booked', trackUrl: null, note: 'Shadowfax updates the status automatically as the parcel moves.' });
      if (action === 'label')  return json({ error: 'Shadowfax doesn’t need a printed label — the pickup rider carries it.' });
      if (action === 'cancel') return json({ error: 'To cancel a Shadowfax pickup, contact Shadowfax support for now.' });
      return json({ error: 'Unknown action' });
    }

    const headers = { Authorization: `Token ${token}` };

    if (action === 'label') {
      const r = await fetch(`${BASE}/api/p/packing_slip?wbns=${awb}&pdf=true&pdf_size=4R`, { headers });
      const d = await r.json().catch(() => ({}));
      const link = d?.packages?.[0]?.pdf_download_link || d?.pdf_download_link || null;
      if (!link) return json({ error: 'Label not ready yet — try again in a moment.' });
      return json({ labelUrl: link });
    }

    if (action === 'track') {
      const r = await fetch(`${BASE}/api/v1/packages/json/?waybill=${awb}`, { headers });
      const d = await r.json().catch(() => ({}));
      const st = d?.ShipmentData?.[0]?.Shipment?.Status?.Status || null;
      const inst = d?.ShipmentData?.[0]?.Shipment?.Status?.Instructions || '';
      if (st) await supabase.from('orders').update({ shipment_status: st }).eq('id', orderId).eq('store_slug', slug);
      return json({ status: st, instructions: inst, trackUrl: `https://www.delhivery.com/track/package/${awb}` });
    }

    if (action === 'cancel') {
      const r = await fetch(`${BASE}/api/p/edit`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ waybill: String(awb), cancellation: 'true' }),
      });
      // Delhivery's cancel replies with XML (<status>True</status>), not JSON.
      const txt = await r.text();
      const ok = /<status>\s*true\s*<\/status>/i.test(txt) || /cancell?ed/i.test(txt) || /"status"\s*:\s*true/i.test(txt);
      if (ok) await supabase.from('orders').update({ awb: null, shipment_status: 'Cancelled' }).eq('id', orderId).eq('store_slug', slug);
      return json({ cancelled: ok, raw: ok ? undefined : txt.slice(0, 200) });
    }

    return json({ error: 'Unknown action' });
  } catch (err) {
    return json({ error: (err as Error).message });
  }
});
