import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Meta Conversions API (Stage 2B) — sends the server-side Purchase for a confirmed
// order. Invoked by the orders trigger (pg_net) or a scheduled sweep. The Meta
// request is AWAITED and its result persisted (never fire-and-forget); the caller
// (the DB trigger) is async so the customer/payment path is never blocked.
//
// Auth: a shared secret header (x-capi-secret) — deploy with --no-verify-jwt.
// The access token is read server-side from the RLS-locked store_meta_accounts;
// it never reaches the browser. No raw PII is logged.

const GRAPH_VER = 'v25.0';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type, x-capi-secret' };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });

const admin = () => createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

async function sha256hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

const PURCHASE_STATUSES = ['confirmed', 'dispatched', 'delivered'];

// Send the Purchase for one order id. Returns a short result string.
async function processOrder(supabase: ReturnType<typeof createClient>, orderId: string): Promise<string> {
  // 1) Load the order.
  const { data: order } = await supabase
    .from('orders')
    .select('id, store_slug, status, paid, total, item_count, customer_phone, items, fbp, fbc, client_ua, created_at')
    .eq('id', orderId).maybeSingle();
  if (!order) return 'no_order';

  // 2) Eligibility (mirrors the trigger — defense in depth).
  const eligible = (order.paid === true) || PURCHASE_STATUSES.includes(String(order.status));
  if (!eligible || order.status === 'abandoned' || Number(order.total) <= 0) return 'ineligible';

  // 3) Store's Meta connection + CAPI settings (opt-out via config.meta.capiEnabled=false).
  const [{ data: store }, { data: acct }] = await Promise.all([
    supabase.from('stores').select('config').eq('slug', order.store_slug).maybeSingle(),
    supabase.from('store_meta_accounts').select('access_token, status').eq('store_slug', order.store_slug).maybeSingle(),
  ]);
  const meta = store?.config?.meta || {};
  const pixelId = meta.pixelId;
  const testCode = meta.capiTestCode || null;
  if (meta.capiEnabled === false) return 'disabled';
  if (!acct || acct.status !== 'connected' || !acct.access_token || !pixelId) return 'not_connected';

  // 4) Atomically claim (or re-claim a stale/failed) the send.
  const { data: claim } = await supabase.rpc('meta_capi_claim', {
    p_order_id: orderId, p_event_name: 'Purchase', p_store_slug: order.store_slug,
    p_event_id: orderId, p_pixel_id: String(pixelId),
  });
  if (claim !== 'claimed') return String(claim);   // already_sent | locked | exhausted

  // 5) Build the payload (hashed PII; never logged raw).
  const digits = String(order.customer_phone || '').replace(/\D/g, '');
  const e164 = digits.length === 10 ? `91${digits}` : digits;
  const user_data: Record<string, unknown> = {};
  if (e164.length >= 10) user_data.ph = [await sha256hex(e164)];
  if (order.fbp) user_data.fbp = order.fbp;
  if (order.fbc) user_data.fbc = order.fbc;
  if (order.client_ua) user_data.client_user_agent = order.client_ua;

  const contents = Array.isArray(order.items)
    ? order.items.map((i: Record<string, unknown>) => ({ id: String(i.name ?? ''), quantity: Number(i.qty ?? 1), item_price: Number(i.price ?? 0) }))
    : [];
  const eventTime = Math.min(
    Math.floor(Date.now() / 1000),
    order.created_at ? Math.floor(new Date(order.created_at).getTime() / 1000) : Math.floor(Date.now() / 1000),
  );

  const body: Record<string, unknown> = {
    data: [{
      event_name: 'Purchase',
      event_time: eventTime,
      event_id: orderId,
      action_source: 'website',
      event_source_url: `https://www.pocketlink.store/${order.store_slug}`,
      user_data,
      custom_data: {
        currency: 'INR',
        value: Number(order.total) || 0,
        num_items: Number(order.item_count) || contents.length,
        content_type: 'product',
        contents,
        order_id: orderId,
      },
    }],
  };
  if (testCode) body.test_event_code = testCode;

  // 6) Await the Meta request (with in-function retries for transient failures).
  const url = `https://graph.facebook.com/${GRAPH_VER}/${pixelId}/events?access_token=${encodeURIComponent(acct.access_token)}`;
  let httpCode = 0; let errText = ''; let ok = false;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      httpCode = r.status;
      const rb = await r.json().catch(() => ({}));
      if (r.ok) { ok = true; break; }
      // Auth/permission error → not worth retrying; flag for reconnect.
      if (rb?.error?.code === 190 || rb?.error?.type === 'OAuthException') { errText = 'reauth'; break; }
      errText = String(rb?.error?.message || `http ${r.status}`).slice(0, 300);
      if (r.status < 500) break;   // 4xx (other than 190) won't fix on retry
    } catch (e) {
      errText = (e as Error)?.message?.slice(0, 300) || 'network';
    }
    if (attempt < 3) await new Promise((res) => setTimeout(res, 400 * attempt));
  }

  // 7) Persist the outcome. 'failed' stays retryable (re-claimable) by a later run.
  await supabase.rpc('meta_capi_mark', {
    p_order_id: orderId, p_event_name: 'Purchase',
    p_status: ok ? 'sent' : 'failed', p_http_code: httpCode, p_error: ok ? null : errText,
  });
  return ok ? 'sent' : `failed:${errText}`;
}

// Re-drive retryable rows (scheduled sweep). Safe: same event_id is reused.
async function sweep(supabase: ReturnType<typeof createClient>, limit = 50): Promise<number> {
  const staleBefore = new Date(Date.now() - 120_000).toISOString();
  const { data } = await supabase
    .from('meta_capi_events')
    .select('order_id, status, claimed_at, attempts')
    .or(`status.eq.failed,and(status.eq.sending,claimed_at.lt.${staleBefore})`)
    .lte('attempts', 6)
    .limit(limit);
  let n = 0;
  for (const row of (data || [])) { await processOrder(supabase, String(row.order_id)); n++; }
  return n;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    if (req.headers.get('x-capi-secret') !== Deno.env.get('META_CAPI_SECRET')) return json({ error: 'unauthorized' }, 401);
    const supabase = admin();
    const { order_id, sweep: doSweep } = await req.json().catch(() => ({}));
    if (doSweep) return json({ swept: await sweep(supabase) });
    if (!order_id) return json({ error: 'order_id required' }, 400);
    return json({ result: await processOrder(supabase, String(order_id)) });
  } catch (e) {
    return json({ error: (e as Error).message }, 200);   // never surface a 5xx to pg_net's retry
  }
});
