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

const ORDER_COLS = 'id, store_slug, total, paid, status, payment_method, payment_ref, awb, customer_name, ' +
                   'customer_phone, confirm_token, payment_link_id, payment_link_url, created_at';

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

/** True only when a checkout Razorpay order is fully paid, for this order, at this order's total. */
function checkoutIsPaidFor(rz: any, order: any): boolean {
  return rz?.status === 'paid'
    && String(rz?.notes?.order_row_id ?? '') === String(order.id)
    && Number(rz?.amount) === toPaise(order.total)
    && Number(rz?.amount_paid) >= Number(rz?.amount);
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

/** Find the checkout payment on Razorpay; record it if really paid. */
async function settleCheckout(supabase: Supa, auth: string, order: any): Promise<string> {
  if (order.paid === true) return 'paid';
  const rz = await findCheckoutRazorpayOrder(auth, order);
  if (!rz) return 'not_found';
  if (!checkoutIsPaidFor(rz, order)) return 'pending';
  const pr = await fetch(`https://api.razorpay.com/v1/orders/${encodeURIComponent(rz.id)}/payments`, {
    headers: { 'Authorization': auth },
  });
  const pd = await pr.json().catch(() => ({}));
  const captured = (Array.isArray(pd?.items) ? pd.items : []).find((p: any) => p?.status === 'captured');
  if (!captured) return 'pending';
  await supabase
    .from('orders')
    .update({ paid: true, paid_at: new Date().toISOString(), paid_via: 'razorpay',
              payment_ref: String(captured.id), payment_provider: 'razorpay' })
    .eq('id', order.id)
    .eq('store_slug', order.store_slug)
    .eq('paid', false);
  return 'paid';
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
    const { data: pinOk, error: pinErr } = await supabase.rpc('verify_store_pin', { p_slug: slug, p_hashed_pin: hashedPin });
    // A failed check is not a wrong PIN: say so, rather than telling a seller
    // with the right PIN that it is wrong.
    if (pinErr) return json({ error: 'Could not check your PIN right now. Please try again.' });
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

    // ── reconcile: online checkouts paid on Razorpay but never confirmed ────
    if (action === 'reconcile') {
      // 60 days: a delivered order paid weeks ago must still get confirmed.
      const since = new Date(Date.now() - 60 * 86400000).toISOString();
      const { data: orders } = await supabase.from('orders').select(ORDER_COLS)
        .eq('store_slug', slug).eq('paid', false).eq('payment_method', 'online')
        .is('payment_ref', null).not('status', 'in', '(cancelled,abandoned)')
        .gte('created_at', since).limit(30);
      const results = [];
      for (const order of orders || []) {
        results.push({ order_id: order.id, status: await settleCheckout(supabase, auth, order) });
      }
      return json({ results });
    }

    // ── orphans: paid on Razorpay, but the PocketLink order never saved ─────
    // Read-only. Looks at the last 7 days of captured payments on the store's own
    // Razorpay account; any whose checkout order id is not in orders is money
    // without an order. The closest abandoned cart (same amount, placed shortly
    // before) is attached so the seller can see who paid and for what.
    if (action === 'orphans') {
      const to = Math.floor(Date.now() / 1000);
      const from = to - 7 * 86400;
      const captured: any[] = [];
      for (let skip = 0; skip < 500; skip += 100) {
        const r = await fetch(`https://api.razorpay.com/v1/payments?from=${from}&to=${to}&count=100&skip=${skip}`, { headers: { 'Authorization': auth } });
        const d = await r.json().catch(() => ({}));
        const items = Array.isArray(d?.items) ? d.items : [];
        captured.push(...items.filter((p: any) => p?.status === 'captured' && p?.order_id));
        if (items.length < 100) break;
      }
      // Payments already recorded on an order need no Razorpay round trip.
      const ids = captured.map((p: any) => String(p.id));
      const known = new Set<string>();
      for (let i = 0; i < ids.length; i += 100) {
        const { data: rows } = await supabase.from('orders').select('payment_ref')
          .eq('store_slug', slug).in('payment_ref', ids.slice(i, i + 100));
        for (const r of rows || []) known.add(String(r.payment_ref));
      }
      const orphans = [];
      for (const p of captured.filter((x: any) => !known.has(String(x.id))).slice(0, 40)) {
        const or = await fetch(`https://api.razorpay.com/v1/orders/${encodeURIComponent(p.order_id)}`, { headers: { 'Authorization': auth } });
        const rz = await or.json().catch(() => ({}));
        const ourId = String(rz?.notes?.order_row_id || '');
        // Payment links carry their own order id too; only checkout orders matter here.
        if (!/^[0-9a-f-]{36}$/i.test(ourId)) continue;
        const { data: saved } = await supabase.from('orders').select('id').eq('id', ourId).maybeSingle();
        if (saved) continue;
        const paidAt = new Date(Number(p.created_at) * 1000);
        const { data: carts } = await supabase.from('orders')
          .select('id, customer_name, customer_phone, total, items, created_at')
          .eq('store_slug', slug).eq('status', 'abandoned').eq('total', Number(p.amount) / 100)
          .gte('created_at', new Date(paidAt.getTime() - 3 * 3600e3).toISOString())
          .lte('created_at', paidAt.toISOString())
          .order('created_at', { ascending: false }).limit(1);
        const cart = carts?.[0] || null;
        orphans.push({
          payment_id: p.id,
          amount: Number(p.amount) / 100,
          paid_at: paidAt.toISOString(),
          method: p.method || null,
          cart: cart ? {
            customer_name: cart.customer_name || '',
            customer_phone: String(cart.customer_phone || ''),
            items: (Array.isArray(cart.items) ? cart.items : []).map((i: any) => `${i?.qty || 1}x ${i?.name || 'item'}`).join(', '),
          } : null,
        });
      }
      return json({ orphans });
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
