import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Razorpay payment links for store orders — turn a COD order into a prepaid one.
//
//   create   (store PIN)  make or reuse a link for one unpaid, unshipped order
//   check    (store PIN)  ask Razorpay whether up to 50 orders' links were paid
//   confirm  (no PIN)     the customer's order page, after Razorpay redirects
//                         back: same check, for the order behind that token
//
// The amount always comes from the saved order, never from the request. An
// order becomes paid ONLY when Razorpay itself reports the link as paid, for
// exactly this order (notes.order_row_id) and exactly its total. That is why
// confirm needs no PIN: it can only record what Razorpay already says.
//
// Money settles to the merchant's own Razorpay account, like checkout payments.

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const SITE = 'https://www.pocketlink.store';

function json(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

/** Rupees (numeric column) → integer paise. Same function in payments-create-order. */
function toPaise(rupees: unknown): number {
  return Math.round(Number(rupees) * 100);
}

const ORDER_COLS = 'id, store_slug, total, paid, status, payment_method, awb, customer_name, ' +
                   'customer_phone, confirm_token, payment_link_id, payment_link_url';

type Supa = ReturnType<typeof createClient>;

async function accountAuth(supabase: Supa, slug: string): Promise<string | null> {
  const { data: acct } = await supabase
    .from('store_payment_accounts')
    .select('status, key_id, key_secret, oauth_access_token')
    .eq('store_slug', slug)
    .maybeSingle();
  if (!acct || acct.status !== 'connected') return null;
  if (acct.oauth_access_token) return `Bearer ${acct.oauth_access_token}`;
  if (acct.key_id && acct.key_secret) return `Basic ${btoa(`${acct.key_id}:${acct.key_secret}`)}`;
  return null;
}

/** True only when Razorpay says this link is fully paid, for this order, at this order's total. */
function linkIsPaidFor(link: any, order: any): boolean {
  return link?.status === 'paid'
    && String(link?.notes?.order_row_id ?? '') === String(order.id)
    && Number(link?.amount) === toPaise(order.total)
    && Number(link?.amount_paid) >= Number(link?.amount);
}

/** Look the order's link up on Razorpay; record the payment if it is really paid. */
async function settleFromRazorpay(supabase: Supa, auth: string, order: any): Promise<string> {
  if (order.paid === true) return 'paid';
  if (!order.payment_link_id) return 'no_link';
  const res = await fetch(`https://api.razorpay.com/v1/payment_links/${encodeURIComponent(order.payment_link_id)}`, {
    headers: { 'Authorization': auth },
  });
  const link = await res.json();
  if (!res.ok || !link?.id) return 'error';

  if (linkIsPaidFor(link, order)) {
    const paymentId = Array.isArray(link.payments) && link.payments.length
      ? String(link.payments[link.payments.length - 1]?.payment_id || '') : '';
    await supabase
      .from('orders')
      .update({
        paid: true,
        paid_at: new Date().toISOString(),
        paid_via: 'payment_link',
        // Prepaid now: the courier must not collect cash for this order.
        payment_method: 'online',
        payment_ref: paymentId || link.id,
        payment_provider: 'razorpay',
      })
      .eq('id', order.id)
      .eq('store_slug', order.store_slug)
      .eq('paid', false);
    return 'paid';
  }
  if (link.status === 'paid') return 'mismatch';          // paid, but not for this order/amount
  if (link.status === 'expired' || link.status === 'cancelled') return link.status;
  return 'pending';
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const body = await req.json();
    const action = String(body?.action || '');
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // ── confirm: the customer's order page, no PIN ─────────────────────────
    if (action === 'confirm') {
      const token = String(body?.token || '');
      if (!/^[0-9a-f-]{36}$/i.test(token)) return json({ paid: false });
      const { data: order } = await supabase.from('orders').select(ORDER_COLS)
        .eq('confirm_token', token).maybeSingle();
      if (!order || !order.payment_link_id) return json({ paid: false });
      const auth = await accountAuth(supabase, order.store_slug);
      if (!auth) return json({ paid: false });
      const status = await settleFromRazorpay(supabase, auth, order);
      return json({ paid: status === 'paid' });
    }

    // ── Everything else is the seller, gated by the store PIN ──────────────
    const slug = String(body?.slug || '');
    const hashedPin = String(body?.hashed_pin || '');
    if (!slug || !hashedPin) return json({ error: 'Missing store or PIN' });
    const { data: pinOk } = await supabase.rpc('verify_store_pin', { p_slug: slug, p_hashed_pin: hashedPin });
    if (pinOk !== true) return json({ error: 'Wrong PIN. Please sign in to Manage again.' });

    const auth = await accountAuth(supabase, slug);
    if (!auth) return json({ error: 'Connect Razorpay in Settings to use payment links.' });

    // ── check: has the customer paid? ──────────────────────────────────────
    if (action === 'check') {
      const ids = (Array.isArray(body?.order_ids) ? body.order_ids : []).map(String).slice(0, 50);
      if (!ids.length) return json({ results: [] });
      const { data: orders } = await supabase.from('orders').select(ORDER_COLS)
        .eq('store_slug', slug).in('id', ids);
      const results = [];
      for (const order of orders || []) {
        results.push({ order_id: order.id, status: await settleFromRazorpay(supabase, auth, order) });
      }
      return json({ results });
    }

    // ── create: make (or reuse) the link ──────────────────────────────────
    if (action === 'create') {
      const orderId = String(body?.order_id || '');
      const { data: order } = await supabase.from('orders').select(ORDER_COLS)
        .eq('id', orderId).eq('store_slug', slug).maybeSingle();
      if (!order) return json({ error: 'Order not found for this store.' });
      if (order.paid === true) return json({ paid: true });
      if (order.status === 'cancelled' || order.status === 'abandoned') {
        return json({ error: 'This order is cancelled.' });
      }
      if (order.awb) {
        return json({ error: 'This order is already booked with the courier as COD. Cancel that shipment before switching it to online payment.' });
      }
      const amount = toPaise(order.total);
      if (!Number.isInteger(amount) || amount < 100) return json({ error: 'This order has no amount to pay.' });

      // An open link for the same amount is reused; a paid one is recorded.
      if (order.payment_link_id) {
        const status = await settleFromRazorpay(supabase, auth, order);
        if (status === 'paid') return json({ paid: true });
        if (status === 'pending' && order.payment_link_url) {
          return json({ url: order.payment_link_url, reused: true });
        }
      }

      const { data: store } = await supabase.from('stores').select('config').eq('slug', slug).maybeSingle();
      const storeName = String(store?.config?.businessName || 'our store').slice(0, 60);
      const phone = String(order.customer_phone || '').replace(/\D/g, '').slice(-10);

      const res = await fetch('https://api.razorpay.com/v1/payment_links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': auth },
        body: JSON.stringify({
          amount,                                           // paise, from the saved order
          currency: 'INR',
          accept_partial: false,
          // Unique per link (Razorpay rejects a reused reference), so a fresh link
          // can replace an expired one. The order binding lives in notes.
          reference_id: `pl-${Date.now().toString(36)}-${String(order.id).slice(0, 8)}`,
          description: `Order from ${storeName}`,
          customer: {
            name: String(order.customer_name || 'Customer').slice(0, 60),
            ...(phone.length === 10 ? { contact: `+91${phone}` } : {}),
          },
          notify: { sms: false, email: false },             // the seller sends it on WhatsApp
          reminder_enable: false,
          notes: { store: slug, order_row_id: order.id },
          ...(order.confirm_token
            ? { callback_url: `${SITE}/order/${order.confirm_token}`, callback_method: 'get' }
            : {}),
        }),
      });
      const link = await res.json();
      if (!res.ok || !link?.id || !link?.short_url) {
        return json({ error: link?.error?.description || 'Razorpay could not create the payment link.' });
      }

      await supabase.from('orders')
        .update({ payment_link_id: link.id, payment_link_url: link.short_url,
                  payment_link_created_at: new Date().toISOString() })
        .eq('id', order.id).eq('store_slug', slug);

      return json({ url: link.short_url, reused: false });
    }

    return json({ error: 'Unknown action' });
  } catch (err) {
    return json({ error: (err as Error).message });
  }
});
