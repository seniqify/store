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

// Owner-only (PIN-checked): create a Delhivery shipment for an order and store the
// AWB. Does NOT schedule a pickup (that's a separate explicit step) — booking just
// manifests the shipment and gets the tracking number + label.
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const { slug, hashedPin, orderId } = await req.json();
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

    const isCOD = order.payment_method === 'cod';
    const items = Array.isArray(order.items) ? order.items : [];
    const desc  = items.map((i: any) => `${i.qty}x ${i.name}`).join(', ').slice(0, 250) || 'Order';

    const shipment = {
      name:         order.customer_name || 'Customer',
      add:          order.destination || '',
      pin:          String(order.pincode || '').replace(/\D/g, ''),
      phone:        String(order.customer_phone || '').replace(/\D/g, '').slice(-10),
      order:        String(order.id).slice(0, 20),
      payment_mode: isCOD ? 'COD' : 'Prepaid',
      cod_amount:   isCOD ? Number(order.total) || 0 : 0,
      total_amount: Number(order.total) || 0,
      weight:       Number(acct.default_weight_g) || 500,
      quantity:     Number(order.item_count) || 1,
      products_desc: desc,
      seller_name:  store.config?.businessName || slug,
      country:      'India',
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

    return json({ awb, status: pkg?.status || 'Manifested', trackUrl: `https://www.delhivery.com/track/package/${awb}` });
  } catch (err) {
    return json({ error: (err as Error).message });
  }
});
