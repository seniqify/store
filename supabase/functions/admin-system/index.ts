// ===========================================================================
//  admin-system  --  PocketLink Admin: System and switches
//
//  What the database cannot do by itself:
//    keys    which connection keys (edge function secrets) are set. Only
//            set / not set is returned; a value never leaves this function.
//    ping    asks every server function "are you there?" (an OPTIONS call:
//            each one answers it on its first line and does nothing else).
//    purge   removes a deleted shop for good: the DATABASE does the checks
//            and the erasing (admin_purge_store, asked as the signed-in
//            person: Owner, 2-step, 30 days, typed link), then this removes
//            the shop's photos from storage and logs how many (admin_note).
//
//  Who may do what is decided by the DATABASE, asked as the signed-in person:
//  admin_me (team + 2-step) and admin_can('see' | 'delete').
//  verify_jwt: true. Body: { action: 'keys' } | { action: 'ping' }
//                        | { action: 'purge', slug, confirm, reason }
// ===========================================================================
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

// Every server function in supabase/functions (this one excluded).
export const FUNCTIONS = [
  'admin-billing', 'admin-people', 'admin-salary', 'cart-reminders', 'cart-reminders-now', 'console-assistant', 'console-team',
  'create-razorpay-subscription', 'meta-capi', 'meta-insights-snapshot', 'order-create', 'payments-connect',
  'payments-create-order', 'payments-link', 'payments-verify', 'plan-activate', 'razorpay-webhook', 'review-asks',
  'review-asks-now', 'sales-lead-in', 'sales-report', 'sales-staff', 'send-campaign', 'send-offer', 'send-otp',
  'ship-updates', 'shipping-book', 'shipping-connect', 'shipping-ops', 'shipping-rate', 'shipping-sync',
  'shipping-webhook', 'status-sweep', 'subscription-sync', 'verify-razorpay-payment', 'wallet-topup',
];

// Connection keys the functions read, and what each one is for.
export const KEYS: [string, string][] = [
  ['RAZORPAY_KEY_ID', 'PocketLink plan payments and Coins'],
  ['RAZORPAY_KEY_SECRET', 'PocketLink plan payments and Coins'],
  ['RAZORPAY_WEBHOOK_SECRET', 'Payment messages from Razorpay'],
  ['SENIQIFY_API_KEY', 'Every WhatsApp message'],
  ['SENIQIFY_TEMPLATE_URL', 'Sign-in codes on WhatsApp'],
  ['SENIQIFY_WELCOME_TEMPLATE_URL', 'Welcome message to a new shop'],
  ['SENIQIFY_ORDER_SELLER_TEMPLATE_URL', 'New order message to the shop'],
  ['SENIQIFY_ORDER_CUSTOMER_TEMPLATE_URL', 'Order message to the buyer'],
  ['SENIQIFY_ORDER_CONFIRM_TEMPLATE_URL', '"Confirm my order" (cash on delivery)'],
  ['SENIQIFY_ORDER_CONFIRM_TRACK_TEMPLATE_URL', '"Confirm my order" with tracking'],
  ['SENIQIFY_ORDER_PAID_TRACK_TEMPLATE_URL', 'Paid order with tracking'],
  ['SENIQIFY_CART_REMINDER_TEMPLATE_URL', 'Cart reminders (English)'],
  ['SENIQIFY_CART_REMINDER_MR_TEMPLATE_URL', 'Cart reminders (Marathi)'],
  ['SENIQIFY_REVIEW_ASK_TEMPLATE_URL', 'Review requests (English)'],
  ['SENIQIFY_REVIEW_ASK_MR_TEMPLATE_URL', 'Review requests (Marathi)'],
  ['SENIQIFY_SHIP_SHIPPED_TEMPLATE_URL', 'Parcel update: shipped'],
  ['SENIQIFY_SHIP_OFD_TEMPLATE_URL', 'Parcel update: out for delivery'],
  ['SENIQIFY_SHIP_DELIVERED_TEMPLATE_URL', 'Parcel update: delivered'],
  ['SENIQIFY_SHIP_FAILED_TEMPLATE_URL', 'Parcel update: delivery failed'],
  ['SENIQIFY_SALES_DAILY_TEMPLATE_URL', 'The 7 pm sales report to managers'],
  ['SENIQIFY_SALES_WEEKLY_TEMPLATE_URL', 'The Monday sales report to managers'],
  ['SENIQIFY_SALARY_PAID_TEMPLATE_URL', '"Salary paid" message to the sales team'],
  ['SHADOWFAX_WEBHOOK_SECRET', 'Parcel messages from Shadowfax'],
  ['META_APP_SECRET', 'Facebook lead forms (sales leads)'],
  ['META_CAPI_SECRET', 'Facebook purchase tracking for shops'],
  ['META_GRAPH_VERSION', 'Facebook API version'],
  ['ANTHROPIC_API_KEY', 'The Console assistant'],
  ['ASSISTANT_MODEL', 'The Console assistant model'],
];

const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;
const BUCKET = 'product-images';

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const authz = req.headers.get('Authorization') || '';
  if (!authz.startsWith('Bearer ')) return json({ error: 'sign in first' }, 401);

  const url = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const asUser = createClient(url, anonKey, { global: { headers: { Authorization: authz } }, auth: { persistSession: false } });

  const { data: me } = await asUser.rpc('admin_me');
  if (!me || !me.mfa) return json({ error: 'Admin team with 2-step sign-in only.' }, 403);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* empty */ }

  if (body.action === 'keys') {
    return json({ ok: true, keys: KEYS.map(([name, use]) => ({ name, use, set: Boolean((Deno.env.get(name) || '').trim()) })) });
  }

  if (body.action === 'ping') {
    const results = await Promise.all(FUNCTIONS.map(async (name) => {
      const t0 = Date.now();
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 10000);
      try {
        const r = await fetch(`${url}/functions/v1/${name}`, {
          method: 'OPTIONS',
          headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`, 'Access-Control-Request-Method': 'POST' },
          signal: ctl.signal,
        });
        const text = await r.text().catch(() => '');
        const state = r.status === 404 ? 'missing' : r.status >= 500 ? 'failing' : 'ok';
        return { name, status: r.status, ms: Date.now() - t0, state, note: state === 'ok' ? '' : text.slice(0, 120) };
      } catch {
        return { name, status: 0, ms: Date.now() - t0, state: 'failing', note: ctl.signal.aborted ? 'no answer in 10 seconds' : 'could not reach it' };
      } finally {
        clearTimeout(timer);
      }
    }));
    return json({ ok: true, functions: results });
  }

  if (body.action === 'purge') {
    const { data: canDelete } = await asUser.rpc('admin_can', { p_what: 'delete' });
    if (canDelete !== true) return json({ error: 'Only the Owner can remove a shop for good.' }, 403);
    const slug = String(body.slug ?? '');
    const confirm = String(body.confirm ?? '');
    const reason = String(body.reason ?? '').trim().slice(0, 300);
    if (!SLUG.test(slug)) return json({ error: 'Unknown shop.' }, 400);
    if (reason.length < 3) return json({ error: 'Write a reason.' }, 400);

    // 1. The database checks everything and erases (as the signed-in person).
    const { data: res, error } = await asUser.rpc('admin_purge_store', { p_slug: slug, p_confirm: confirm, p_reason: reason });
    if (error) return json({ error: error.message }, 400);
    const already = (res as any)?.already === true;

    // 2. The photos, only after the database said yes.
    const service = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
    const bucket = service.storage.from(BUCKET);
    const paths: string[] = [];
    let photos = 0;
    let photoError = '';
    try {
      const walk = async (prefix: string, depth: number) => {
        for (let offset = 0; offset < 20000; offset += 1000) {
          const { data, error: e } = await bucket.list(prefix, { limit: 1000, offset });
          if (e) throw new Error(e.message);
          for (const f of data || []) {
            if (f.id) paths.push(`${prefix}/${f.name}`);
            else if (depth < 3) await walk(`${prefix}/${f.name}`, depth + 1);
          }
          if (!data || data.length < 1000) break;
        }
      };
      await walk(slug, 0);
      for (let i = 0; i < paths.length; i += 100) {
        const { data, error: e } = await bucket.remove(paths.slice(i, i + 100));
        if (e) throw new Error(e.message);
        photos += (data || []).length;
      }
    } catch (e) {
      photoError = `Photos not all removed (${String((e as Error)?.message || e).slice(0, 120)}). Press Remove for good again to retry.`;
    }
    if (!already || photos > 0) {
      await asUser.rpc('admin_note', { p_need: 'delete', p_action: 'purge_photos', p_kind: 'store', p_target: slug,
        p_after: { photos, found: paths.length, error: photoError || null }, p_reason: reason });
    }
    return json({ ok: true, already, removed: (res as any)?.removed ?? {}, photos, photoError });
  }

  return json({ error: 'Unknown action.' }, 400);
});
