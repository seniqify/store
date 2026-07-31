import { serve }        from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// WhatsApp template that sends the OTP. To swap templates later, just change
// TEMPLATE_ID (or set the SENIQIFY_TEMPLATE_URL secret to override without a
// redeploy). Current: PocketLink template "opt" (sender 8482840808).
const TEMPLATE_ID  = 'z0vm5t48dw';
const SENIQIFY_URL = Deno.env.get('SENIQIFY_TEMPLATE_URL')
  ?? `https://adminapis.backendprod.com/lms_campaign/api/whatsapp/template/${TEMPLATE_ID}/process`;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const {
      action, phone, code, businessName, slug,
      // order-notify fields:
      sellerPhone, customerPhone, customerName, storeName, itemsSummary, orderTotal,
    } = await req.json();
    // order-notify carries its own seller/customer numbers, not `phone`.
    if (action !== 'order-notify' && !phone) return json({ error: 'phone is required' }, 400);

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // ── SEND ─────────────────────────────────────────────────────────────────
    if (action === 'send') {
      const otp       = String(Math.floor(100000 + Math.random() * 900000));
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 min

      // Replace any previous OTP for this phone
      await supabase.from('otp_codes').delete().eq('phone', phone);
      const { error: insertErr } = await supabase
        .from('otp_codes')
        .insert({ phone, code: otp, expires_at: expiresAt });

      if (insertErr) throw new Error(insertErr.message);

      // ── Seniqify WhatsApp API ────────────────────────────────────────────
      // Their template endpoint can take ~60s to RESPOND. We don't need to wait
      // for that response — the request reaches them immediately — so fire it in
      // the background and return now, instead of freezing the signup screen for
      // a minute. (Delivery speed itself is on Seniqify's side.)
      const apiKey   = Deno.env.get('SENIQIFY_API_KEY');
      const receiver = String(phone).replace(/\D/g, ''); // e.g. 919876543210

      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

      const dispatchOtp = async () => {
        try {
          const waRes = await fetch(SENIQIFY_URL, {
            method: 'POST',
            headers,
            body: JSON.stringify({ receiver, values: { '1': otp } }),
          });
          if (!waRes.ok) console.error(`Seniqify ${waRes.status}: ${await waRes.text()}`);
        } catch (e) {
          console.error('Seniqify send error:', (e as Error)?.message);
        }
      };

      // EdgeRuntime.waitUntil keeps the function alive to finish the send after
      // the response is returned (Supabase Edge supports it). Fallback: await.
      const ER = (globalThis as any).EdgeRuntime;
      if (ER && typeof ER.waitUntil === 'function') {
        ER.waitUntil(dispatchOtp());
      } else {
        await dispatchOtp();
      }

      return json({ success: true });
    }

    // ── VERIFY ───────────────────────────────────────────────────────────────
    if (action === 'verify') {
      if (!code) return json({ error: 'code is required' }, 400);

      const { data, error: fetchErr } = await supabase
        .from('otp_codes')
        .select('*')
        .eq('phone', phone)
        .eq('code',  String(code))
        .gt('expires_at', new Date().toISOString())
        .maybeSingle();

      if (fetchErr) throw new Error(fetchErr.message);

      if (!data) {
        return json({ error: 'Invalid or expired OTP. Please try again.' }, 400);
      }

      // One-time use — delete after successful verify
      await supabase.from('otp_codes').delete().eq('phone', phone);
      return json({ success: true });
    }

    // ── WELCOME (store-registration confirmation: link + QR + manage button) ──
    if (action === 'welcome') {
      if (!slug) return json({ error: 'slug is required' }, 400);

      const SITE = 'https://www.pocketlink.store';
      const WELCOME_URL = Deno.env.get('SENIQIFY_WELCOME_TEMPLATE_URL')
        ?? 'https://adminapis.backendprod.com/lms_campaign/api/whatsapp/template/6q73jsblu0/process';

      const receiver = String(phone).replace(/\D/g, '');
      const apiKey   = Deno.env.get('SENIQIFY_API_KEY');
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

      const waRes = await fetch(WELCOME_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          receiver,
          values: {
            '1': String(businessName || 'your store'),   // body {{1}} — business name
            '2': `${SITE}/${slug}`,                       // body {{2}} — store link
            '3': `${slug}/manage`,                        // button {{1}} — dynamic /manage suffix
          },
          media_url: `${SITE}/api/qr?slug=${encodeURIComponent(slug)}`, // header — QR image
        }),
      });
      const waBody = await waRes.text();
      if (!waRes.ok) throw new Error(`Seniqify welcome ${waRes.status}: ${waBody}`);

      return json({ success: true });
    }

    // ── ORDER NOTIFY — WhatsApp both sides when a customer places an order ────
    // Seller: "you got a new order"; Customer: "thanks for ordering". Both go
    // out from PocketLink's WhatsApp number via the Seniqify templates. Returns
    // { notified:false } when the templates aren't configured yet, so the client
    // falls back to the classic wa.me hand-off — no order ever goes un-notified.
    if (action === 'order-notify') {
      const apiKey      = Deno.env.get('SENIQIFY_API_KEY');
      const sellerUrl   = Deno.env.get('SENIQIFY_ORDER_SELLER_TEMPLATE_URL');
      const customerUrl = Deno.env.get('SENIQIFY_ORDER_CUSTOMER_TEMPLATE_URL');

      // Not set up yet → tell the client to fall back to wa.me. The seller alert
      // is the critical one (they must not miss an order), so gate on it.
      if (!sellerUrl) return json({ notified: false, reason: 'not_configured' });

      const clean   = (p: unknown) => String(p ?? '').replace(/\D/g, '');
      // WhatsApp receiver MUST carry the country code. Checkout captures the
      // customer's mobile as a bare 10-digit number, while the seller number is
      // already stored as 91XXXXXXXXXX — normalize both so either delivers.
      const toWa = (p: unknown) => {
        const d = clean(p);
        if (!d) return '';
        if (d.length === 10) return '91' + d;                    // bare Indian mobile
        if (d.length === 11 && d.startsWith('0')) return '91' + d.slice(1);
        return d;                                                // already has a country code
      };
      // The Seniqify /process URL is the credential; an API key is optional and
      // only added when present (same as the OTP/welcome sends).
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

      const dispatch = async () => {
        // Seller — "🛍️ New order! {{1}} ordered {{2}} — {{3}}. Contact: {{4}}"
        try {
          const seller = toWa(sellerPhone);
          if (seller) {
            const r = await fetch(sellerUrl, { method: 'POST', headers, body: JSON.stringify({
              receiver: seller,
              values: {
                '1': String(customerName || 'A customer'),
                '2': String(itemsSummary || 'your items'),
                '3': String(orderTotal || ''),
                '4': clean(customerPhone),        // body — customer phone
                // "View order" URL button suffix → https://www.pocketlink.store/{{1}}
                // (button variable continues the numbering after the 4 body vars).
                '5': `${String(slug || '')}/manage`,
              },
            }) });
            if (!r.ok) console.error(`order-notify seller ${r.status}: ${await r.text()}`);
          }
        } catch (e) { console.error('order-notify seller error:', (e as Error)?.message); }

        // Customer — "Thank you for your order at {{1}}! Total {{2}} …" (optional)
        try {
          const cust = toWa(customerPhone);
          if (customerUrl && cust) {
            const r = await fetch(customerUrl, { method: 'POST', headers, body: JSON.stringify({
              receiver: cust,
              values: { '1': String(storeName || 'the store'), '2': String(orderTotal || '') },
            }) });
            if (!r.ok) console.error(`order-notify customer ${r.status}: ${await r.text()}`);
          }
        } catch (e) { console.error('order-notify customer error:', (e as Error)?.message); }
      };

      const ER = (globalThis as any).EdgeRuntime;
      if (ER && typeof ER.waitUntil === 'function') ER.waitUntil(dispatch());
      else await dispatch();

      return json({ notified: true });
    }

    return json({ error: 'Unknown action' }, 400);

  } catch (err) {
    console.error('send-otp error:', err);
    return json({ error: (err as Error).message ?? 'Internal error' }, 500);
  }
});
