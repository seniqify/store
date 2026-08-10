/**
 * otpService — calls the Supabase Edge Function to send/verify WhatsApp OTP.
 * Edge function: supabase/functions/send-otp/index.ts
 */

const EDGE_URL  = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-otp`;
const ANON_KEY  = import.meta.env.VITE_SUPABASE_ANON_KEY;

async function call(body, { timeoutMs = 12000 } = {}) {
  // Hard timeout — a hung edge function must never freeze the caller (e.g. the
  // checkout "Order placed" screen). On timeout the fetch aborts and throws, so
  // best-effort callers fall back cleanly instead of waiting forever.
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(EDGE_URL, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${ANON_KEY}`,
      },
      body:   JSON.stringify(body),
      signal: ctrl.signal,
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || 'OTP service error');
    return json;
  } finally {
    clearTimeout(timer);
  }
}

/** Send a 6-digit OTP to the given WhatsApp number via MSG91. */
export async function sendOtp(phone) {
  return call({ action: 'send', phone });
}

/** Verify the OTP entered by the user. Throws if invalid / expired. */
export async function verifyOtp(phone, code) {
  return call({ action: 'verify', phone, code });
}

/**
 * Fire the store-registration welcome message over WhatsApp — store link, QR
 * image, and a "Manage my store" button. Best-effort: callers should not let a
 * failure block onboarding.
 */
export async function sendWelcome(phone, businessName, slug) {
  return call({ action: 'welcome', phone, businessName, slug });
}

/**
 * Ask PocketLink to WhatsApp both parties about a new order — the seller gets
 * "you got a new order", the customer gets "thanks for ordering". Returns true
 * ONLY when the server actually sent them (templates configured); false → the
 * caller must fall back to the wa.me hand-off so no order goes un-notified.
 */
export async function sendOrderNotifications(payload) {
  try {
    const res = await call({ action: 'order-notify', ...payload });
    return res?.notified === true;
  } catch {
    return false;
  }
}
