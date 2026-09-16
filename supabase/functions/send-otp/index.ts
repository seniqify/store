import { serve }        from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// WhatsApp template URLs. A Seniqify /process URL IS the credential — anyone
// holding one can send WhatsApp messages as PocketLink — so it lives only in a
// Supabase secret and never in this repository, which is public. No fallback:
// a missing secret fails closed with a 503 rather than sending from a URL that
// strangers can read. Set these before deploying (docs/security-phase-1-runbook.md):
//   SENIQIFY_TEMPLATE_URL                OTP code
//   SENIQIFY_WELCOME_TEMPLATE_URL        store-registration welcome
//   SENIQIFY_ORDER_CONFIRM_TEMPLATE_URL  COD "Confirm my order"
//   SENIQIFY_ORDER_SELLER_TEMPLATE_URL   seller new-order alert
//   SENIQIFY_ORDER_CUSTOMER_TEMPLATE_URL buyer thank-you
const SENIQIFY_URL = Deno.env.get('SENIQIFY_TEMPLATE_URL') ?? '';

// How long the OTP is valid. The live template now has a SECOND variable {{2}}
// (validity in minutes) — sending only {{1}} makes the provider reject the send
// with 422 "Missing values for keys: 2", so the OTP silently never goes out.
// Keep this in sync with both the expiry below and the template copy.
const OTP_TTL_MIN = 10;

/**
 * A six-digit OTP from the platform CSPRNG.
 *
 * Was `Math.floor(100000 + Math.random() * 900000)`. Math.random() is not a
 * cryptographic RNG — V8's xorshift128+ state can be recovered from a modest
 * number of observed outputs, and anyone can observe outputs here by requesting
 * codes for their own number. This code is the only thing standing between a
 * store's public WhatsApp number and reset_store_pin, so it has to be random in
 * the sense that matters.
 *
 * Rejection sampling rather than a plain modulo: 2^32 is not a multiple of
 * 900000, so `x % 900000` would make the low ~62% of the range slightly more
 * likely. The loop discards the short tail and almost never runs twice.
 */
function secureOtp(): string {
  const span = 900000;                                   // 100000-999999
  const limit = Math.floor(0xFFFFFFFF / span) * span;    // largest unbiased cut
  const buf = new Uint32Array(1);
  let x: number;
  do {
    crypto.getRandomValues(buf);
    x = buf[0];
  } while (x >= limit);
  return String(100000 + (x % span));
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

/** The caller's address, as far as the edge runtime can tell. Absent simply
 *  means the per-address limit cannot apply; the per-phone one still does. */
function callerIp(req: Request): string | null {
  const fwd = req.headers.get('x-forwarded-for') ?? '';
  return fwd.split(',')[0].trim() || null;
}

/** Ledger key for a phone: SHA-256 hex of its digits, so the rate-limit table
 *  never holds a raw number. Same phone, same key, on every call. */
async function phoneKey(phone: unknown): Promise<string> {
  const digits = String(phone ?? '').replace(/\D/g, '');
  if (!digits) return '';
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(digits));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * The OTP rate limit (public.otp_guard, applied by
 * supabase/security-phase-1-forward.sql).
 *
 *   send    may a code go out now?   Records the send when it may.
 *   verify  may a guess be made now?  Records the guess when it may.
 *   clear   the code was right: drop that phone's guesses.
 *
 * `verify` SPENDS the guess at the moment it allows it, inside one locked
 * transaction. This function must not report the outcome afterwards instead:
 * between a check here and a report from here, any number of parallel guesses
 * would pass, and five-per-fifteen-minutes would become five per round trip.
 *
 * Fails CLOSED for send and verify: if the guard is missing or the call errors,
 * the answer is no. An unlimited OTP endpoint is how a store's WhatsApp number
 * gets flooded and how a six-digit code gets guessed. `clear` is book-keeping,
 * so a failure there is logged and ignored.
 */
async function otpGuard(
  supabase: ReturnType<typeof createClient>,
  action: 'send' | 'verify' | 'clear',
  subject: string,
  ip: string | null,
): Promise<boolean> {
  if (!subject) return action === 'clear';
  try {
    const { data, error } = await supabase.rpc('otp_guard', {
      p_action: action, p_subject: subject, p_ip: ip,
    });
    if (error) {
      console.error(`otp_guard ${action} failed:`, error.message);
      return action === 'clear';
    }
    return data === true;
  } catch (e) {
    console.error(`otp_guard ${action} error:`, (e as Error)?.message);
    return action === 'clear';
  }
}

const TOO_MANY = 'Too many code requests. Please wait a few minutes and try again.';

/**
 * The order-notify safety net writes whatever the caller sent, with the SERVICE
 * ROLE — so this endpoint, not the browser, is the widest way into the orders
 * table. Everything a checkout legitimately fills is copied; everything else is
 * dropped, and the payment columns are forced to "not paid".
 *
 * Payment is recorded by payments-verify / the Razorpay webhook AFTER Razorpay
 * confirms it, never by a request body. The cost: when a customer's own insert
 * was blocked AND their online payment went through, this row lands unpaid with
 * no payment_ref — the seller's Payments tab lists it under orders to reconcile
 * (Razorpay carries the order id in its notes), instead of the row being taken
 * at its word. public.orders_insert_guard enforces the same thing at the
 * database, for every role; this is the near half of the same rule.
 */
const ORDER_COLUMNS = [
  'id', 'confirm_token', 'store_slug', 'customer_name', 'customer_phone',
  'destination', 'pincode', 'payment_method', 'notes', 'items', 'item_count',
  'subtotal', 'tax', 'shipping', 'packaging', 'cod_fee', 'total',
  'fbp', 'fbc', 'client_ua',
] as const;

function safeOrderRow(order: Record<string, unknown>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const key of ORDER_COLUMNS) {
    if (order[key] !== undefined) row[key] = order[key];
  }
  // A checkout writes exactly two statuses; anything else starts as a new order.
  row.status = order.status === 'abandoned' ? 'abandoned' : 'new';
  row.paid = false;
  row.paid_at = null;
  row.paid_via = null;
  row.payment_ref = null;
  row.payment_provider = null;
  return row;
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const {
      action, phone, code, businessName, slug,
      // order-notify fields:
      sellerPhone, customerPhone, customerName, storeName, itemsSummary, orderTotal, order,
    } = await req.json();
    // order-notify carries its own seller/customer numbers, not `phone`.
    if (action !== 'order-notify' && !phone) return json({ error: 'phone is required' }, 400);

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // ── SEND ─────────────────────────────────────────────────────────────────
    if (action === 'send') {
      // The credential first: refuse before a code is minted, so a misconfigured
      // deploy cannot leave unusable codes lying in otp_codes.
      if (!SENIQIFY_URL) {
        console.error('send-otp: SENIQIFY_TEMPLATE_URL is not set — refusing to send');
        return json({ error: 'OTP sending is not configured. Please try again later.' }, 503);
      }

      const subject = await phoneKey(phone);
      if (!(await otpGuard(supabase, 'send', subject, callerIp(req)))) {
        return json({ error: TOO_MANY }, 429);
      }

      const otp       = secureOtp();
      const expiresAt = new Date(Date.now() + OTP_TTL_MIN * 60 * 1000).toISOString();

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
            // Template now expects {{1}}=code and {{2}}=validity minutes.
            body: JSON.stringify({ receiver, values: { '1': otp, '2': String(OTP_TTL_MIN) } }),
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

      // A six-digit code is 900,000 values and lives for ten minutes. Without a
      // cap on guesses that is a few minutes of scripted requests, so the count
      // of guesses is what actually protects it. The guard spends one guess as
      // it allows this call -- guesses fired in parallel cannot slip past each
      // other -- and 'clear' gives them back when the code turns out right.
      const subject = await phoneKey(phone);
      const ip      = callerIp(req);
      if (!(await otpGuard(supabase, 'verify', subject, ip))) {
        return json({ error: 'Too many incorrect codes. Please wait a few minutes and try again.' }, 429);
      }

      const { data, error: fetchErr } = await supabase
        .from('otp_codes')
        .select('*')
        .eq('phone', phone)
        .eq('code',  String(code))
        .gt('expires_at', new Date().toISOString())
        .maybeSingle();

      if (fetchErr) throw new Error(fetchErr.message);

      if (!data) {
        // The guess is already on the ledger, spent by the 'verify' call above.
        return json({ error: 'Invalid or expired OTP. Please try again.' }, 400);
      }

      // One-time use — delete after successful verify
      await supabase.from('otp_codes').delete().eq('phone', phone);
      await otpGuard(supabase, 'clear', subject, ip);
      return json({ success: true });
    }

    // ── WELCOME (store-registration confirmation: link + QR + manage button) ──
    if (action === 'welcome') {
      if (!slug) return json({ error: 'slug is required' }, 400);

      const SITE = 'https://www.pocketlink.store';
      // Credential, not configuration — secret only, no fallback. See the note
      // at the top of this file.
      const WELCOME_URL = Deno.env.get('SENIQIFY_WELCOME_TEMPLATE_URL') ?? '';
      if (!WELCOME_URL) {
        console.error('send-otp: SENIQIFY_WELCOME_TEMPLATE_URL is not set — welcome not sent');
        return json({ error: 'Welcome messages are not configured.' }, 503);
      }

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
      // ── Safety net: persist the order server-side ────────────────────────────
      // The client already tries to INSERT the order itself, but that direct write
      // can be silently blocked on the customer's device (ad-blocker / privacy
      // browser / stale cached build / flaky network) while THIS call still gets
      // through — so the seller sees a WhatsApp alert but no order in the dashboard.
      // We re-save the exact row here with the service role. Idempotent: the row
      // carries the same client-minted id, so `upsert … ignoreDuplicates` is a
      // no-op when the client insert succeeded, and creates the row when it didn't.
      // Never blocks or fails the notification.
      if (order && typeof order === 'object' && order.id && order.store_slug) {
        try {
          // supabase-js returns errors instead of throwing: check it, or a refused
          // save is silent (how a paid order was lost on 2026-09-09).
          const { error: saveErr } = await supabase
            .from('orders')
            .upsert(safeOrderRow(order), { onConflict: 'id', ignoreDuplicates: true });
          if (saveErr) console.error('order-notify save refused:', order.id, saveErr.message);
        } catch (e) {
          console.error('order-notify save error:', (e as Error)?.message);
        }
      }

      const apiKey      = Deno.env.get('SENIQIFY_API_KEY');
      const sellerUrl   = Deno.env.get('SENIQIFY_ORDER_SELLER_TEMPLATE_URL');
      const customerUrl = Deno.env.get('SENIQIFY_ORDER_CUSTOMER_TEMPLATE_URL');
      // "order confirm" — the buyer's thank-you PLUS a "Confirm my order" button.
      // Only COD orders get it: that's where RTO and fake orders come from, and a
      // prepaid buyer has already committed. The /process URL is the credential,
      // so it is secret-only with no fallback. Unset degrades to the plain
      // thank-you below; it never blocks the order or the seller's alert.
      const confirmUrl  = Deno.env.get('SENIQIFY_ORDER_CONFIRM_TEMPLATE_URL') ?? '';
      if (!confirmUrl) console.error('send-otp: SENIQIFY_ORDER_CONFIRM_TEMPLATE_URL is not set — COD buyers get the plain thank-you');
      const isCod = String(order?.payment_method || '').toLowerCase() === 'cod';

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

        // Customer — exactly ONE message, never two. A COD buyer gets the "order
        // confirm" template (order details + a "Confirm my order" button); every
        // other payment method gets the plain thank-you.
        try {
          const cust = toWa(customerPhone);

          // confirm_token is minted by the DB, so it only exists once the row is
          // saved — read it back rather than minting one here. Both the client
          // insert and the safety-net upsert have already run, so the row is there.
          let token = '';
          if (cust && isCod && confirmUrl && order?.id) {
            const { data: saved } = await supabase
              .from('orders').select('confirm_token').eq('id', order.id).maybeSingle();
            token = saved?.confirm_token ? String(saved.confirm_token) : '';
            if (!token) console.error('order-notify: no confirm_token for order', order.id);
          }

          if (token) {
            // "order confirm": {{1}} buyer, {{2}} store, {{3}} items, {{4}} total,
            // {{5}} = the button's URL suffix → https://www.pocketlink.store/{{5}}.
            // Suffix ONLY — a full URL here would double the domain and Meta
            // rejects it. Tapping it opens /confirm/<token>, which calls
            // confirm_order_by_token and stamps orders.customer_confirmed_at.
            const r = await fetch(confirmUrl, { method: 'POST', headers, body: JSON.stringify({
              receiver: cust,
              values: {
                '1': String(customerName || 'there'),
                '2': String(storeName    || 'the store'),
                '3': String(itemsSummary || 'your items'),
                '4': String(orderTotal   || ''),
                '5': `confirm/${token}`,
              },
            }) });
            if (!r.ok) console.error(`order-notify confirm ${r.status}: ${await r.text()}`);
          } else if (customerUrl && cust) {
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
