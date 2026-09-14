import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Scheduled status sweep (pg_cron -> net.http_post every 30 minutes; see
// supabase/payments-automation-schedule.sql). For EVERY store:
//
//   1. couriers  refresh open shipments from Delhivery / Shadowfax. Writing
//                shipment_status fires orders_payment_automation, which marks
//                delivered COD collected and returned COD returned.
//   2. Razorpay  confirm payment links and checkout payments that were paid but
//                never confirmed (customer closed the app, verify hiccuped).
//
// Nobody has to open Manage for either to happen.
//
// Auth: the shared secret in public.automation_secrets, sent as x-sweep-secret.
// Deploy with verify_jwt = false (called by the database, not a browser).
//
// The courier and Razorpay helpers below are kept byte-identical to the copies
// in shipping-sync and payments-link; tests/payments-automation.test.mjs
// compares them so the two can never drift apart.

const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });
const DLV_BASE = 'https://track.delhivery.com';

/** Rupees (numeric column) → integer paise. Same function in payments-create-order. */
function toPaise(rupees: unknown): number {
  return Math.round(Number(rupees) * 100);
}

async function inChunks<T>(items: T[], size: number, fn: (x: T) => Promise<void>) {
  for (let i = 0; i < items.length; i += size) {
    await Promise.all(items.slice(i, i + size).map(fn));
  }
}

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

/** True only when Razorpay says this link is fully paid, for this order, at this order's total. */
function linkIsPaidFor(link: any, order: any): boolean {
  return link?.status === 'paid'
    && String(link?.notes?.order_row_id ?? '') === String(order.id)
    && Number(link?.amount) === toPaise(order.total)
    && Number(link?.amount_paid) >= Number(link?.amount);
}

/** True only when a checkout Razorpay order is fully paid, for this order, at this order's total. */
function checkoutIsPaidFor(rz: any, order: any): boolean {
  return rz?.status === 'paid'
    && String(rz?.notes?.order_row_id ?? '') === String(order.id)
    && Number(rz?.amount) === toPaise(order.total)
    && Number(rz?.amount_paid) >= Number(rz?.amount);
}

type Supa = ReturnType<typeof createClient>;

async function syncCouriers(supabase: Supa, slug: string, accts: any[]): Promise<number> {
  const acctOf = (p: string) => accts.find((a) => a.provider === p && a.status === 'connected' && a.api_token);
  const { data: rows } = await supabase
    .from('orders')
    .select('id, awb, courier, shipment_status')
    .eq('store_slug', slug)
    .not('awb', 'is', null)
    .order('created_at', { ascending: false })
    .limit(300);
  const open = (rows || []).filter((o: any) => !isTerminal(o.shipment_status));
  const updates: { id: string; status: string }[] = [];

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

  await inChunks(updates, 10, async (u) => {
    await supabase.from('orders').update({ shipment_status: u.status }).eq('id', u.id).eq('store_slug', slug);
  });
  return updates.length;
}

async function settleLink(supabase: Supa, auth: string, order: any): Promise<boolean> {
  const res = await fetch(`https://api.razorpay.com/v1/payment_links/${encodeURIComponent(order.payment_link_id)}`, {
    headers: { 'Authorization': auth },
  });
  const link = await res.json().catch(() => ({}));
  if (!res.ok || !linkIsPaidFor(link, order)) return false;
  const paymentId = Array.isArray(link.payments) && link.payments.length
    ? String(link.payments[link.payments.length - 1]?.payment_id || '') : '';
  await supabase.from('orders')
    .update({ paid: true, paid_at: new Date().toISOString(), paid_via: 'payment_link', payment_method: 'online',
              payment_ref: paymentId || link.id, payment_provider: 'razorpay' })
    .eq('id', order.id).eq('store_slug', order.store_slug).eq('paid', false);
  return true;
}

/** The checkout's Razorpay order: by receipt (checkouts from 2026-09-14), else by notes.order_row_id near the order time. */
async function findCheckoutRazorpayOrder(auth: string, order: any): Promise<any | null> {
  const list = async (url: string) => {
    const r = await fetch(url, { headers: { 'Authorization': auth } });
    const d = await r.json().catch(() => ({}));
    return r.ok && Array.isArray(d?.items) ? d.items : null;
  };
  const mine = (it: any) => String(it?.notes?.order_row_id ?? '') === String(order.id);
  // Several Razorpay orders can carry one checkout (a retry): a paid one wins.
  const pick = (items: any[]) => {
    const matches = items.filter(mine);
    return matches.find((it: any) => it?.status === 'paid') || matches[0] || null;
  };
  const byReceipt = await list(`https://api.razorpay.com/v1/orders?receipt=${encodeURIComponent(order.id)}&count=10`);
  let best = pick(byReceipt || []);
  if (best?.status === 'paid') return best;
  // Older checkouts sent no receipt, only notes.order_row_id: search around the time the order was placed.
  const placed = Math.floor(new Date(order.created_at).getTime() / 1000);
  if (!Number.isFinite(placed)) return best;
  const from = placed - 2 * 3600;
  const to = placed + 2 * 86400;
  for (let skip = 0; skip < 500; skip += 100) {
    const page = await list(`https://api.razorpay.com/v1/orders?from=${from}&to=${to}&count=100&skip=${skip}`);
    if (!page) break;
    const found = pick(page);
    if (found?.status === 'paid') return found;
    best = best || found;
    if (page.length < 100) break;
  }
  return best;
}

/**
 * Why a checkout is not confirmed, from Razorpay's own records: the payments on
 * its Razorpay order, and any payment of the same amount from the same phone
 * around the order time (a customer who paid through another route). Payment
 * ids and statuses only — never the phone number or keys.
 */
async function paymentEvidence(auth: string, order: any, rz: any): Promise<string> {
  const get = async (url: string) => {
    const r = await fetch(url, { headers: { 'Authorization': auth } });
    const d = await r.json().catch(() => ({}));
    return r.ok && Array.isArray(d?.items) ? d.items : [];
  };
  const onOrder = rz?.id ? await get(`https://api.razorpay.com/v1/orders/${encodeURIComponent(rz.id)}/payments`) : [];
  const phone = String(order.customer_phone || '').replace(/\D/g, '').slice(-10);
  const placed = Math.floor(new Date(order.created_at).getTime() / 1000);
  const nearby = [];
  if (phone.length === 10 && Number.isFinite(placed)) {
    for (let skip = 0; skip < 300; skip += 100) {
      const page = await get(`https://api.razorpay.com/v1/payments?from=${placed - 2 * 3600}&to=${placed + 3 * 86400}&count=100&skip=${skip}`);
      for (const p of page) {
        const same = Number(p?.amount) === toPaise(order.total)
          && String(p?.contact || '').replace(/\D/g, '').slice(-10) === phone;
        if (same) nearby.push(`${p.id} ${p.status}${p.order_id && p.order_id !== rz?.id ? ' (other Razorpay order)' : ''}`);
      }
      if (page.length < 100) break;
    }
  }
  const list = (a: string[]) => (a.length ? a.join(', ') : 'none');
  return `payments on its Razorpay order: ${list(onOrder.map((p: any) => `${p.id} ${p.status}`))}; ` +
    `same amount from the same phone nearby: ${list(nearby)}`;
}

/** Confirm one checkout with Razorpay. Returns "paid" or why not, so a run can be read back. */
async function settleCheckout(supabase: Supa, auth: string, order: any): Promise<string> {
  const rz = await findCheckoutRazorpayOrder(auth, order);
  if (!rz) return `no_razorpay_order; ${await paymentEvidence(auth, order, null)}`;
  if (!checkoutIsPaidFor(rz, order)) {
    return `not_paid: razorpay order ${rz.id} status ${rz.status}, amount ${rz.amount} paise, order total ${toPaise(order.total)} paise; ` +
      await paymentEvidence(auth, order, rz);
  }
  const pr = await fetch(`https://api.razorpay.com/v1/orders/${encodeURIComponent(rz.id)}/payments`, {
    headers: { 'Authorization': auth },
  });
  const pd = await pr.json().catch(() => ({}));
  const captured = (Array.isArray(pd?.items) ? pd.items : []).find((p: any) => p?.status === 'captured');
  if (!captured) return "no_captured_payment";
  await supabase.from('orders')
    .update({ paid: true, paid_at: new Date().toISOString(), paid_via: 'razorpay',
              payment_ref: String(captured.id), payment_provider: 'razorpay' })
    .eq('id', order.id).eq('store_slug', order.store_slug).eq('paid', false);
  return "paid";
}

serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  // ── Secret gate: nothing runs without it ─────────────────────────────────
  const { data: cfg, error: cfgErr } = await supabase.from('automation_secrets').select('secret').eq('name', 'status-sweep').maybeSingle();
  // Not being able to READ the secret is a server problem, not a bad caller:
  // report it as such so a failing schedule is diagnosable from its response.
  if (cfgErr) return json({ error: 'secret_unavailable', detail: String(cfgErr.message || '').slice(0, 160) }, 500);
  const expected = String(cfg?.secret || '');
  const got = req.headers.get('x-sweep-secret') || '';
  if (expected.length < 48 || got.length !== expected.length) return json({ error: 'unauthorized' }, 401);
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ got.charCodeAt(i);
  if (diff !== 0) return json({ error: 'unauthorized' }, 401);

  const summary = { stores: 0, courierUpdates: 0, linksPaid: 0, checkoutsPaid: 0, errors: 0 };
  // Per unconfirmed checkout: what Razorpay said. Order ids, statuses and amounts only.
  const checkouts: { store: string; order_id: string; result: string }[] = [];
  const since30 = new Date(Date.now() - 30 * 86400000).toISOString();
  const since60 = new Date(Date.now() - 60 * 86400000).toISOString();

  // ── 1. Couriers ──────────────────────────────────────────────────────────
  const { data: shipAccts } = await supabase
    .from('store_shipping_accounts').select('store_slug, provider, mode, api_token, status').eq('status', 'connected');
  const bySlug = new Map<string, any[]>();
  for (const a of shipAccts || []) (bySlug.get(a.store_slug) || bySlug.set(a.store_slug, []).get(a.store_slug)!).push(a);
  for (const [slug, accts] of bySlug) {
    try { summary.courierUpdates += await syncCouriers(supabase, slug, accts); }
    catch { summary.errors++; }
  }

  // ── 2. Razorpay ──────────────────────────────────────────────────────────
  const { data: payAccts } = await supabase
    .from('store_payment_accounts').select('store_slug, status, key_id, key_secret, oauth_access_token').eq('status', 'connected');
  for (const acct of payAccts || []) {
    const auth = acct.oauth_access_token ? `Bearer ${acct.oauth_access_token}`
      : (acct.key_id && acct.key_secret) ? `Basic ${btoa(`${acct.key_id}:${acct.key_secret}`)}` : '';
    if (!auth) continue;
    summary.stores++;
    try {
      const { data: links } = await supabase.from('orders')
        .select('id, store_slug, total, paid, payment_link_id')
        .eq('store_slug', acct.store_slug).eq('paid', false).not('payment_link_id', 'is', null)
        .gte('created_at', since30).limit(50);
      for (const o of links || []) if (await settleLink(supabase, auth, o)) summary.linksPaid++;

      const { data: online } = await supabase.from('orders')
        .select('id, store_slug, total, paid, status, created_at, customer_phone')
        .eq('store_slug', acct.store_slug).eq('paid', false).eq('payment_method', 'online')
        .is('payment_ref', null).not('status', 'in', '(cancelled,abandoned)')
        .gte('created_at', since60).limit(30);
      for (const o of online || []) {
        const result = await settleCheckout(supabase, auth, o);
        if (result === "paid") summary.checkoutsPaid++;
        checkouts.push({ store: acct.store_slug, order_id: o.id, result });
      }
    } catch { summary.errors++; }
  }

  return json({ ok: true, ...summary, checkouts });
});
