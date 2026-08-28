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

    const { data: order } = await supabase.from('orders')
      .select('awb, courier, shipment_status').eq('id', orderId).eq('store_slug', slug).maybeSingle();
    const bookedCourier = String(order?.courier || 'delhivery').toLowerCase();
    const { data: acct } = await supabase.from('store_shipping_accounts')
      .select('provider, api_token, mode').eq('store_slug', slug).eq('provider', bookedCourier).maybeSingle();
    const token = acct?.api_token;
    const awb = order?.awb;
    if (!token) return json({ error: 'Shipping not connected' });
    if (!awb) return json({ error: 'This order has no shipment yet' });

    // ── Shadowfax ops (the Delhivery code below is untouched) ──
    if (order?.courier === 'shadowfax' || acct?.provider === 'shadowfax') {
      const sBase = acct?.mode === 'production' ? 'https://dale.shadowfax.in/api' : 'https://dale.staging.shadowfax.in/api';
      if (action === 'track') {
        // Live status + full hub-by-hub journey via the v4 tracking API. Returns a
        // normalised timeline the Delivery board renders in-app (no courier login).
        const tr = await fetch(`${sBase}/v4/clients/orders/${awb}/track/`, { headers: { Authorization: `Token ${token}` } });
        const td = await tr.json().catch(() => ({}));
        const od = td?.order_details || {};
        const events = Array.isArray(td?.tracking_details) ? td.tracking_details : [];
        const timeline = events.map((e: any) => ({
          code:   String(e?.status_id || '').toLowerCase(),
          label:  e?.status || '',
          place:  e?.location || '',
          ts:     e?.created || '',
          remarks: e?.remarks || '',
        }));
        const st = od.status_display || od.status || order?.shipment_status || 'Booked';
        if (od.status_display) await supabase.from('orders').update({ shipment_status: st }).eq('id', orderId).eq('store_slug', slug);
        // NDR reason: if the latest scan is an attempt/exception code, surface its remark.
        const last = events[events.length - 1] || {};
        const lastCode = String(last?.status_id || '').toLowerCase();
        const ndrCodes = ['nc', 'undelivered', 'cnr', 'npr', 'ud', 'customer_not_available', 'reattempt', 'address_issue', 'rto', 'rto_initiated'];
        const ndr = ndrCodes.some((c) => lastCode.includes(c)) ? (last?.remarks || st) : null;

        // Proof of delivery — only fetchable once delivered / returned-to-seller.
        // Gives who received it (name + contact) and a signature/photo report link.
        let pod = null;
        if (/deliver|rts_d/i.test(`${st} ${lastCode}`)) {
          try {
            const pr = await fetch(`${sBase}/v1/clients/pod_details/`, {
              method: 'POST',
              headers: { Authorization: `Token ${token}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ awb_numbers: [awb] }),
            });
            const pd = await pr.json().catch(() => ({}));
            const rec = pd?.pod_details?.[awb];
            if (rec) {
              const clean = (v: unknown) => (v && v !== 'None' && v !== 'null' ? String(v) : null);
              const urls = String(rec.recipient_signature || '').match(/https?:\/\/[^\s'"\]]+/g) || [];
              pod = {
                name:    clean(rec.recipient_name),
                contact: clean(rec.recipient_contact),
                by:      clean(rec.recipient),        // "CUSTOMER" etc.
                proof:   urls,
              };
            }
          } catch { /* POD is a nicety — never block tracking on it */ }
        }

        return json({
          status: st,
          timeline,
          rider: od.rider_name ? { name: od.rider_name, phone: od.rider_contact || '' } : null,
          promisedDate: od.promised_delivery_date || null,
          customerTrackUrl: od.customer_track_url || null,
          ndrReason: ndr,
          pod,
          trackUrl: null,
        });
      }
      if (action === 'label')  return json({ error: 'Shadowfax doesn’t need a printed label — the pickup rider carries it.' });
      if (action === 'cancel') {
        // Shadowfax cancel: request_id is the AWB. Replies { responseCode, responseMsg }.
        const cr = await fetch(`${sBase}/v3/clients/orders/cancel/`, {
          method: 'POST',
          headers: { Authorization: `Token ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ request_id: awb }),
        });
        const cd = await cr.json().catch(() => ({}));
        const ok = cd?.responseCode === 200 || /cancel/i.test(cd?.responseMsg || '');
        if (ok) await supabase.from('orders').update({ awb: null, shipment_status: 'Cancelled' }).eq('id', orderId).eq('store_slug', slug);
        return json({ cancelled: ok, raw: ok ? undefined : (cd?.responseMsg || JSON.stringify(cd).slice(0, 150)) });
      }
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
      const shp  = d?.ShipmentData?.[0]?.Shipment || {};
      const st   = shp?.Status?.Status || null;
      const inst = shp?.Status?.Instructions || '';
      const scans = Array.isArray(shp?.Scans) ? shp.Scans : [];
      const timeline = scans.map((s: any) => {
        const sc = s?.ScanDetail || {};
        return {
          code:   String(sc?.StatusCode || '').toLowerCase(),
          label:  sc?.Scan || '',
          place:  sc?.ScannedLocation || '',
          ts:     sc?.ScanDateTime || '',
          remarks: sc?.Instructions || '',
        };
      });
      if (st) await supabase.from('orders').update({ shipment_status: st }).eq('id', orderId).eq('store_slug', slug);
      const ndr = /pending|undeliver|not deliver|exception|\brto\b|address|refus|held/i.test(`${st} ${inst}`) ? (inst || st) : null;
      return json({
        status: st,
        instructions: inst,
        timeline,
        rider: null,
        promisedDate: shp?.ExpectedDeliveryDate || null,
        customerTrackUrl: null,
        ndrReason: ndr,
        trackUrl: `https://www.delhivery.com/track/package/${awb}`,
      });
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
