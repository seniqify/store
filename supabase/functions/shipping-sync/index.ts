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

/** A shipment whose courier status will not change any more. */
function isTerminal(s: string): boolean {
  const t = String(s || '');
  return /cancel|rto|rts|return|\blost\b/i.test(t) || (/\bdelivered\b/i.test(t) && !/undeliver|not deliver/i.test(t));
}

/** Delhivery reports a return as StatusType "RT"; keep that in the saved text. */
function delhiveryStatusText(status: any): string {
  const raw = String(status?.Status || '');
  if (!raw) return '';
  return status?.StatusType === 'RT' && !/rto|return/i.test(raw) ? `RTO ${raw}` : raw;
}

/**
 * The store's open shipments: booked, not yet delivered / returned / lost (the
 * trigger's shipment_outcome), from the last 90 days, OLDEST first -- a stable
 * order, so pickForRefresh's window moves through them run after run. A
 * courier-side cancellation is dropped by isTerminal.
 */
async function loadOpenShipments(supabase: any, slug: string): Promise<any[]> {
  const since = new Date(Date.now() - 90 * 86400000).toISOString();
  const { data: rows } = await supabase
    .from('orders')
    .select('id, awb, courier, shipment_status')
    .eq('store_slug', slug)
    .not('awb', 'is', null)
    .is('shipment_outcome', null)
    .gte('created_at', since)
    .order('created_at', { ascending: true })
    .limit(1000);
  return (rows || []).filter((o: any) => !isTerminal(o.shipment_status));
}

/**
 * Which of `rows` to ask the courier about on this run. All of them while there
 * are at most `cap`. Past that, a window of `cap` that moves on by `cap` every
 * run (`slot` = the run's number), wrapping around: every open shipment is asked
 * about within ceil(rows / cap) runs, so the oldest are never starved. (It used
 * to be the newest 80 only, so a busy store's older parcels never updated and
 * their delivered cash-on-delivery never turned Paid.)
 */
function pickForRefresh(rows: any[], cap: number, slot: number): any[] {
  const n = rows.length;
  if (n <= cap) return rows;
  const start = (((slot * cap) % n) + n) % n;
  const end = start + cap;
  return end <= n ? rows.slice(start, end) : rows.slice(start).concat(rows.slice(0, end - n));
}

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

    // PIN gate through the throttled verifier (pin-bypass-closure-forward.sql). A
    // direct stores.pin comparison here let anyone guess a PIN without limit.
    const { data: pinOk, error: pinErr } = await supabase.rpc('verify_store_pin', { p_slug: slug, p_hashed_pin: hashedPin });
    if (pinErr) return json({ error: 'Could not check your PIN right now. Please try again.' });
    if (pinOk !== true) return json({ error: 'Incorrect PIN' });

    const { data: accts } = await supabase
      .from('store_shipping_accounts')
      .select('provider, mode, api_token, status')
      .eq('store_slug', slug);
    const acctOf = (p: string) => (accts || []).find((a: any) => a.provider === p && a.status === 'connected' && a.api_token);

    // Open shipments only (skip delivered/cancelled/RTO — they won't change).
    const open = await loadOpenShipments(supabase, slug);
    // A seller is waiting on this one, so it asks about fewer at a time; the
    // window moves on every minute, and the 30-minute sweep covers the rest.
    const slot = Math.floor(Date.now() / 60000);

    const updates: { id: string; status: string }[] = [];

    // ── Shadowfax: parallel single-AWB track (80 per run, rotating, so the backlog clears) ──
    const sfx = acctOf('shadowfax');
    if (sfx) {
      const sBase = sfx.mode === 'production' ? 'https://dale.shadowfax.in/api' : 'https://dale.staging.shadowfax.in/api';
      const sfxOrders = pickForRefresh(open.filter((o: any) => String(o.courier).toLowerCase() === 'shadowfax'), 80, slot);
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
      const dlvOrders = pickForRefresh(open.filter((o: any) => String(o.courier || 'delhivery').toLowerCase() === 'delhivery'), 160, slot);
      for (let i = 0; i < dlvOrders.length; i += 40) {
        const chunk = dlvOrders.slice(i, i + 40);
        try {
          const awbs = chunk.map((o: any) => o.awb).join(',');
          const r = await fetch(`${DLV_BASE}/api/v1/packages/json/?waybill=${awbs}`, { headers: { Authorization: `Token ${dlv.api_token}` } });
          const d = await r.json().catch(() => ({}));
          const byAwb: Record<string, string> = {};
          for (const s of (d?.ShipmentData || [])) {
            const awb = String(s?.Shipment?.AWB || '');
            const st  = delhiveryStatusText(s?.Shipment?.Status);
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
