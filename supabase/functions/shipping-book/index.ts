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

// Delhivery rejects non-Latin (Devanagari) consignee data as "suspicious" and
// partial-saves it (name/phone/address dropped). Its labels can't render
// Devanagari either. So transliterate any Devanagari to readable Latin before
// sending. Approximate (schwa-deleted at word end) but legible for a courier.
function toLatin(input: string): string {
  const s = String(input || '');
  if (!/[ऀ-ॿ]/.test(s)) return s;   // nothing Devanagari → leave as-is
  const V: Record<string, string> = { 'अ':'a','आ':'aa','इ':'i','ई':'ee','उ':'u','ऊ':'oo','ऋ':'ri','ए':'e','ऐ':'ai','ओ':'o','औ':'au','ऑ':'o','ऍ':'e','ॲ':'a' };
  const M: Record<string, string> = { 'ा':'aa','ि':'i','ी':'ee','ु':'u','ू':'oo','ृ':'ri','े':'e','ै':'ai','ो':'o','ौ':'au','ॉ':'o','ॅ':'e' };
  const C: Record<string, string> = {
    'क':'k','ख':'kh','ग':'g','घ':'gh','ङ':'ng','च':'ch','छ':'chh','ज':'j','झ':'jh','ञ':'ny',
    'ट':'t','ठ':'th','ड':'d','ढ':'dh','ण':'n','त':'t','थ':'th','द':'d','ध':'dh','न':'n',
    'प':'p','फ':'ph','ब':'b','भ':'bh','म':'m','य':'y','र':'r','ल':'l','व':'v','श':'sh','ष':'sh','स':'s','ह':'h','ळ':'l',
    'क़':'q','ख़':'kh','ग़':'g','ज़':'z','ड़':'r','ढ़':'rh','फ़':'f','य़':'y',
  };
  const D: Record<string, string> = { '०':'0','१':'1','२':'2','३':'3','४':'4','५':'5','६':'6','७':'7','८':'8','९':'9' };
  let out = '', pend = false;
  const flush = (end: boolean) => { if (pend) { if (!end) out += 'a'; pend = false; } };
  for (const ch of s) {
    if (C[ch] !== undefined)      { flush(false); out += C[ch]; pend = true; }
    else if (M[ch] !== undefined) { out += M[ch]; pend = false; }
    else if (ch === '्')          { pend = false; }
    else if (ch === 'ं' || ch === 'ँ') { flush(false); out += 'n'; }
    else if (ch === 'ः')          { flush(false); out += 'h'; }
    else if (V[ch] !== undefined) { flush(false); out += V[ch]; }
    else if (D[ch] !== undefined) { flush(false); out += D[ch]; }
    else                          { flush(true); out += ch; }   // space / latin / punctuation
  }
  flush(true);
  return out.replace(/\s+/g, ' ').trim();
}
const titleCase = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());

// Owner-only (PIN-checked): create a Delhivery shipment for an order and store the
// AWB. Does NOT schedule a pickup (that's a separate explicit step) — booking just
// manifests the shipment and gets the tracking number + label.
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const { slug, hashedPin, orderId, details = {} } = await req.json();
    if (!slug || !hashedPin || !orderId) return json({ error: 'Missing store, PIN, or order' });

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data: store } = await supabase.from('stores').select('pin, config').eq('slug', slug).maybeSingle();
    if (!store) return json({ error: 'Store not found' });
    if (store.pin !== hashedPin) return json({ error: 'Incorrect PIN' });

    const { data: acct } = await supabase
      .from('store_shipping_accounts')
      .select('api_token, pickup_name, default_weight_g, status')
      .eq('store_slug', slug).maybeSingle();
    if (!acct || acct.status !== 'connected' || !acct.api_token) return json({ error: 'Delhivery not connected' });

    const { data: order } = await supabase
      .from('orders')
      .select('id, awb, customer_name, customer_phone, destination, pincode, total, payment_method, item_count, items')
      .eq('id', orderId).eq('store_slug', slug).maybeSingle();
    if (!order) return json({ error: 'Order not found' });
    if (order.awb) return json({ awb: order.awb, alreadyBooked: true, trackUrl: `https://www.delhivery.com/track/package/${order.awb}` });

    const items = Array.isArray(order.items) ? order.items : [];
    const desc  = items.map((i: any) => `${i.qty}x ${i.name}`).join(', ').slice(0, 250) || 'Order';

    // The merchant's edited "details" (from the booking modal) take priority; the
    // order's own data is the fallback.
    const pick = (a: unknown, b: unknown) => (a !== undefined && a !== null && a !== '' ? a : b);
    const isCOD   = details.payment_mode ? details.payment_mode === 'COD' : order.payment_method === 'cod';
    const rawName = pick(details.name, order.customer_name);
    const rawAdd  = pick(details.add,  order.destination);

    // Destination pincode: edited value → stored column → last 6-digit run in address.
    let destPin = String(pick(details.pin, order.pincode) || '').replace(/\D/g, '');
    if (destPin.length !== 6) {
      const sixes = String(rawAdd || '').match(/\d{6}/g);
      if (sixes && sixes.length) destPin = sixes[sixes.length - 1];
    }
    if (destPin.length !== 6) {
      return json({ error: 'No valid 6-digit pincode — add the pincode and retry.' });
    }

    const weight = Math.max(50, Math.round(Number(details.weight)) || Number(acct.default_weight_g) || 500);
    const L = Math.round(Number(details.length))  || 0;
    const B = Math.round(Number(details.breadth)) || 0;
    const Hh = Math.round(Number(details.height))  || 0;

    const shipment: Record<string, unknown> = {
      name:         titleCase(toLatin(String(rawName || ''))).slice(0, 60) || 'Customer',
      add:          toLatin(String(rawAdd || '')).slice(0, 250) || 'Address on order',
      pin:          destPin,
      phone:        String(pick(details.phone, order.customer_phone) || '').replace(/\D/g, '').slice(-10),
      order:        String(order.id).slice(0, 20),
      payment_mode: isCOD ? 'COD' : 'Prepaid',
      cod_amount:   isCOD ? Number(pick(details.cod_amount, order.total)) || 0 : 0,
      total_amount: Number(pick(details.total_amount, order.total)) || 0,
      weight:       weight,
      quantity:     Number(order.item_count) || 1,
      products_desc: toLatin(desc).slice(0, 250) || 'Order',
      seller_name:  toLatin(store.config?.businessName || slug),
      country:      'India',
      ...(L && B && Hh ? { shipment_length: L, shipment_width: B, shipment_height: Hh } : {}),
    };

    const payload = 'format=json&data=' + encodeURIComponent(JSON.stringify({
      shipments: [shipment],
      pickup_location: { name: acct.pickup_name || (store.config?.businessName || slug) },
    }));

    const res = await fetch(`${BASE}/api/cmu/create.json`, {
      method: 'POST',
      headers: { Authorization: `Token ${acct.api_token}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: payload,
    });
    const data = await res.json().catch(() => ({}));
    const pkg = data?.packages?.[0];
    const awb = pkg?.waybill;
    if (!awb) {
      const reason = pkg?.remarks?.join?.('; ') || data?.rmk || data?.error || JSON.stringify(data).slice(0, 200);
      return json({ error: `Delhivery could not book this shipment: ${reason}` });
    }

    await supabase.from('orders')
      .update({ awb, courier: 'delhivery', shipment_status: pkg?.status || 'Manifested' })
      .eq('id', order.id).eq('store_slug', slug);

    // ── Auto-schedule a pickup so a courier actually comes (else it just sits at
    // "Ready to Ship"). Delhivery allows only ONE open pickup per location per day,
    // so the first booking of the day schedules it and later ones are "covered".
    let pickup: Record<string, unknown> = { scheduled: false };
    try {
      const nowIST = new Date(Date.now() + 5.5 * 3600 * 1000);
      const day = new Date(nowIST);
      let time = '15:00:00';
      if (nowIST.getUTCHours() >= 13) { day.setUTCDate(day.getUTCDate() + 1); time = '12:00:00'; }
      const date = day.toISOString().slice(0, 10);
      const pr = await fetch(`${BASE}/fm/request/new/`, {
        method: 'POST',
        headers: { Authorization: `Token ${acct.api_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ pickup_location: acct.pickup_name, pickup_date: date, pickup_time: time, expected_package_count: 1 }),
      });
      const pd = await pr.json().catch(() => ({}));
      const blob = JSON.stringify(pd).toLowerCase();
      if (pd?.pickup_id) {
        pickup = { scheduled: true, id: pd.pickup_id, date };
      } else if (/exist|already|pending|open pickup|duplicate/.test(blob)) {
        pickup = { scheduled: true, covered: true, date };   // today's pickup already booked → this parcel is included
      } else {
        pickup = { scheduled: false, reason: pd?.error || pd?.pr_exist || blob.slice(0, 140) };
      }
    } catch {
      pickup = { scheduled: false, reason: 'pickup request failed' };
    }

    return json({ awb, status: pkg?.status || 'Manifested', trackUrl: `https://www.delhivery.com/track/package/${awb}`, pickup });
  } catch (err) {
    return json({ error: (err as Error).message });
  }
});
