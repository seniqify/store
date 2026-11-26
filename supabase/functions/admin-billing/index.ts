// ===========================================================================
//  admin-billing  --  PocketLink Admin: a shop's Razorpay auto-pay
//
//  Uses PocketLink's own Razorpay keys (RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET,
//  the plan account, as subscription-sync). Who may do what is decided by the
//  DATABASE, asked as the signed-in person: admin_me (team + 2-step) and
//  admin_can('money' | 'plan'); the change is recorded by admin_autopay_stopped
//  / admin_note, as that person, in the audit log.
//
//  verify_jwt: true. Body:
//    { action: 'status', slug }                         subscription + its invoices
//    { action: 'cancel', slug, atEnd, reason }          stop auto-pay (now or at the end of the paid term)
//    { action: 'refund', slug, paymentId, amountPaise?, reason }
//      only a payment of THIS shop's subscription; over Rs 5,000 the Owner only
// ===========================================================================
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const RZP = 'https://api.razorpay.com/v1';
const OWNER_ONLY_ABOVE_PAISE = 500000;   // Rs 5,000

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const authz = req.headers.get('Authorization') || '';
  if (!authz.startsWith('Bearer ')) return json({ error: 'sign in first' }, 401);

  const url = Deno.env.get('SUPABASE_URL')!;
  const asUser = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authz } }, auth: { persistSession: false },
  });
  const service = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const keyId = Deno.env.get('RAZORPAY_KEY_ID') ?? '';
  const keySecret = Deno.env.get('RAZORPAY_KEY_SECRET') ?? '';
  if (!keyId || !keySecret) return json({ error: 'Razorpay is not set up.' }, 500);
  const basic = 'Basic ' + btoa(`${keyId}:${keySecret}`);

  async function rzp(path: string, method = 'GET', body?: unknown) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 12000);
    try {
      const r = await fetch(`${RZP}${path}`, {
        method, signal: ctl.signal,
        headers: { Authorization: basic, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await r.json().catch(() => ({}));
      return { ok: r.ok, data };
    } catch {
      return { ok: false, data: { error: { description: 'Razorpay did not answer in time.' } } };
    } finally { clearTimeout(timer); }
  }
  const rzpError = (d: any) => String(d?.error?.description || 'Razorpay refused.').slice(0, 200);

  const { data: me } = await asUser.rpc('admin_me');
  if (!me || !me.mfa) return json({ error: 'Admin team with 2-step sign-in only.' }, 403);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* empty */ }
  const slug = String(body.slug ?? '').trim().toLowerCase();
  const reason = String(body.reason ?? '').trim().slice(0, 300);
  const need = body.action === 'status' ? 'money' : 'plan';
  const { data: allowed } = await asUser.rpc('admin_can', { p_what: need });
  if (allowed !== true) return json({ error: 'Your role cannot do this.' }, 403);

  const { data: store } = await service.from('stores').select('slug, config').eq('slug', slug).maybeSingle();
  if (!store) return json({ error: 'Store not found.' }, 404);
  const sub = String(store.config?.razorpaySubscriptionId ?? '');
  if (!/^sub_[A-Za-z0-9]+$/.test(sub)) {
    return body.action === 'status' ? json({ ok: true, subscription: null, invoices: [] }) : json({ error: 'This shop has no Razorpay auto-pay.' }, 400);
  }

  if (body.action === 'status') {
    const [s, inv] = await Promise.all([rzp(`/subscriptions/${sub}`), rzp(`/invoices?subscription_id=${sub}&count=50`)]);
    if (!s.ok) return json({ error: rzpError(s.data) }, 502);
    const d: any = s.data;
    return json({
      ok: true,
      subscription: {
        id: d.id, status: d.status, plan_id: d.plan_id, paid_count: d.paid_count, total_count: d.total_count,
        current_start: d.current_start, current_end: d.current_end, charge_at: d.charge_at, ended_at: d.ended_at,
      },
      stopped: store.config?.autopayStopped ?? null,
      invoices: ((inv.data as any)?.items || []).map((i: any) => ({
        id: i.id, payment_id: i.payment_id, amount: i.amount, amount_paid: i.amount_paid, status: i.status,
        date: i.paid_at || i.issued_at || i.date, billing_start: i.billing_start, billing_end: i.billing_end,
      })),
    });
  }

  if (body.action === 'cancel') {
    if (reason.length < 3) return json({ error: 'Write a reason.' }, 400);
    const atEnd = body.atEnd !== false;
    const c = await rzp(`/subscriptions/${sub}/cancel`, 'POST', { cancel_at_cycle_end: atEnd ? 1 : 0 });
    if (!c.ok) return json({ error: rzpError(c.data) }, 502);
    const { error } = await asUser.rpc('admin_autopay_stopped', { p_slug: slug, p_sub: sub, p_at_end: atEnd, p_reason: reason });
    if (error) return json({ error: `Stopped in Razorpay, but not recorded here: ${error.message}` }, 500);
    return json({ ok: true, status: (c.data as any)?.status });
  }

  if (body.action === 'refund') {
    if (reason.length < 3) return json({ error: 'Write a reason.' }, 400);
    const paymentId = String(body.paymentId ?? '');
    if (!/^pay_[A-Za-z0-9]+$/.test(paymentId)) return json({ error: 'Unknown payment.' }, 400);
    const p = await rzp(`/payments/${paymentId}`);
    if (!p.ok) return json({ error: rzpError(p.data) }, 502);
    const pay: any = p.data;
    // Only a payment of THIS shop's subscription.
    if (!pay.invoice_id) return json({ error: 'This payment is not from this shop’s auto-pay.' }, 400);
    const inv = await rzp(`/invoices/${pay.invoice_id}`);
    if (!inv.ok || (inv.data as any)?.subscription_id !== sub) return json({ error: 'This payment is not from this shop’s auto-pay.' }, 400);
    const left = Number(pay.amount || 0) - Number(pay.amount_refunded || 0);
    const amount = body.amountPaise == null ? left : Math.round(Number(body.amountPaise));
    if (!(amount > 0) || amount > left) return json({ error: 'Pick an amount up to what is left on this payment.' }, 400);
    if (amount > OWNER_ONLY_ABOVE_PAISE && me.role !== 'owner') return json({ error: 'Refunds over Rs 5,000 are for the Owner.' }, 403);
    const r = await rzp(`/payments/${paymentId}/refund`, 'POST', { amount, notes: { reason, by: String(me.name || '').slice(0, 60), source: 'PocketLink Admin' } });
    if (!r.ok) return json({ error: rzpError(r.data) }, 502);
    await asUser.rpc('admin_note', { p_need: 'plan', p_action: 'refund', p_kind: 'store', p_target: slug,
      p_after: { payment: paymentId, amount_paise: amount, refund: (r.data as any)?.id }, p_reason: reason });
    return json({ ok: true, refund: (r.data as any)?.id, amount });
  }

  return json({ error: 'Unknown action.' }, 400);
});
