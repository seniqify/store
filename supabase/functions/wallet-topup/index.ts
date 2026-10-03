import { serve }        from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// wallet-topup — a shop buys WhatsApp messages from PocketLink.
//
// Money goes to PocketLink's OWN Razorpay account (the same RAZORPAY_KEY_ID /
// RAZORPAY_KEY_SECRET that bill plans), never to the merchant's.
//
//   action 'create'  { slug, hashedPin, messages }
//      PIN check -> look the pack up HERE (the browser never names a price) ->
//      Razorpay order -> wallet_topups row. Returns what Checkout needs.
//
//   action 'confirm' { slug, hashedPin, order_id? }
//      PIN check -> for this store's unpaid top-ups (one, or every one from the
//      last 7 days) ask RAZORPAY whether the order has a captured payment of
//      exactly the top-up's amount -> wallet_credit_topup (idempotent, and it
//      checks the amount again). The browser's word is never enough to credit.
//
// Why ask Razorpay instead of trusting the Checkout callback: a shop whose
// browser closes right after paying still gets its messages, the next time the
// wallet is opened — no webhook to configure, nothing lost.

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// The packs. Rs 1.50 per message (wallet_message_price_paise() = 150).
// Keep in sync with WALLET_PACKS in src/utils/wallet.js (a test checks both).
const PACKS: Record<number, number> = {
  100:  15000,
  500:  75000,
  1000: 150000,
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const body = await req.json();
    const { action, slug, hashedPin } = body ?? {};
    if (!slug || !hashedPin) return json({ error: 'Missing store or PIN.' }, 400);

    const keyId     = Deno.env.get('RAZORPAY_KEY_ID');
    const keySecret = Deno.env.get('RAZORPAY_KEY_SECRET');
    if (!keyId || !keySecret) return json({ error: 'Payments are not set up yet.' }, 500);
    const rzpAuth = `Basic ${btoa(`${keyId}:${keySecret}`)}`;

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // PIN gate through the throttled verifier, before anything else.
    const { data: pinOk, error: pinErr } = await supabase.rpc('verify_store_pin', { p_slug: slug, p_hashed_pin: hashedPin });
    if (pinErr) return json({ error: 'Could not check your PIN right now. Please try again.' });
    if (pinOk !== true) return json({ error: 'Unauthorized.' }, 403);

    // ── create ───────────────────────────────────────────────────────────────
    if (action === 'create') {
      const messages = Number(body.messages);
      const amount = PACKS[messages];
      if (!amount) return json({ error: 'Pick one of the message packs.' }, 400);

      const res = await fetch('https://api.razorpay.com/v1/orders', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: rzpAuth },
        body: JSON.stringify({
          amount,
          currency: 'INR',
          receipt:  `wallet:${slug}`.slice(0, 40),
          notes:    { purpose: 'wallet_topup', store: slug, messages: String(messages) },
        }),
      });
      const order = await res.json();
      if (!order?.id) {
        console.error('wallet-topup: Razorpay order failed', res.status, order?.error?.description ?? '');
        return json({ error: 'Could not start the payment. Please try again.' });
      }

      const { error: insErr } = await supabase.from('wallet_topups').insert({
        store_slug: slug, razorpay_order_id: order.id, amount_paise: amount, messages,
      });
      if (insErr) {
        console.error('wallet-topup: could not record the top-up', insErr.message);
        return json({ error: 'Could not start the payment. Please try again.' });
      }

      return json({ order_id: order.id, key_id: keyId, amount, currency: 'INR', messages });
    }

    // ── confirm ──────────────────────────────────────────────────────────────
    if (action === 'confirm') {
      let q = supabase.from('wallet_topups')
        .select('razorpay_order_id, amount_paise')
        .eq('store_slug', slug)
        .eq('status', 'created')
        .gt('created_at', new Date(Date.now() - 7 * 86400000).toISOString())
        .order('created_at', { ascending: false })
        .limit(10);
      if (body.order_id) q = q.eq('razorpay_order_id', String(body.order_id));
      const { data: pending, error: pendErr } = await q;
      if (pendErr) return json({ error: 'Could not check your payment right now.' });

      let credited = 0;
      let waiting = 0;
      for (const t of pending ?? []) {
        const res = await fetch(`https://api.razorpay.com/v1/orders/${encodeURIComponent(t.razorpay_order_id)}/payments`, {
          headers: { Authorization: rzpAuth },
        });
        if (!res.ok) { waiting += 1; continue; }            // Razorpay blip: try again next time
        const list = await res.json();
        // A real, captured payment of exactly this top-up's amount, in rupees,
        // on exactly this order. Nothing else credits a wallet.
        const paid = (list?.items ?? []).find((p: Record<string, unknown>) =>
          p?.status === 'captured' &&
          p?.order_id === t.razorpay_order_id &&
          p?.currency === 'INR' &&
          Number(p?.amount) === Number(t.amount_paise));
        if (!paid) { waiting += 1; continue; }

        const { error: credErr } = await supabase.rpc('wallet_credit_topup', {
          p_order_id: t.razorpay_order_id, p_payment_id: String(paid.id), p_amount_paise: Number(t.amount_paise),
        });
        if (credErr) {
          console.error('wallet-topup: credit refused', t.razorpay_order_id, credErr.message);
          waiting += 1;
          continue;
        }
        credited += 1;
      }

      return json({ credited, waiting });
    }

    return json({ error: 'Unknown action.' }, 400);
  } catch (err) {
    console.error('wallet-topup error:', (err as Error).message);
    return json({ error: 'Something went wrong. Please try again.' }, 500);
  }
});
