// Step-up codes for custom-domain actions (activate / set_primary / disconnect).
//
// The server generates the code, keeps only an HMAC of it, and sends the code
// itself to the store's OWNER phone -- read from the store record, never from
// the request. The database (domain_challenge_create) stores only the HMAC and
// enforces the 10-minute expiry, 5 attempts, single use and 5 codes per store
// per hour; there is no second challenge store here.
//
// The HMAC input binds the code to the store, the action and the hostname, so a
// hash made for one purpose can never verify another -- on top of the purpose
// binding the database already does.
//
// Neither the code nor its HMAC is ever logged or returned to a browser.
import crypto from 'node:crypto';

export const OTP_TTL_MIN = 10;           // must match domain_challenge_create
const OTP_CONTEXT = 'pocketlink-domain-otp:v1';

/** Six digits from the platform CSPRNG (crypto.randomInt is unbiased). */
export function generateOtp(randomInt = crypto.randomInt) {
  return String(randomInt(100000, 1000000));
}

export function otpHash(secret, { slug, action, target, code }) {
  return crypto.createHmac('sha256', secret)
    .update(`${OTP_CONTEXT}:${slug}:${action}:${target}:${code}`)
    .digest('hex');
}

/**
 * The owner phone as stored at signup ("91" + ten digits) -> WhatsApp receiver
 * digits, or null. Anything that is not an Indian mobile in that shape is
 * refused rather than guessed at: a step-up code sent to the wrong number is a
 * code handed to a stranger.
 */
export function normalizeOwnerPhone(raw) {
  const d = String(raw ?? '').replace(/\D/g, '');
  const ten = d.length === 10 ? d : d.length === 12 && d.startsWith('91') ? d.slice(2) : null;
  return ten && /^[6-9]\d{9}$/.test(ten) ? `91${ten}` : null;
}

/** "+91 •••••• 3210" -- enough for the owner to recognise, useless to anyone else. */
export function maskPhone(receiver) {
  const d = String(receiver ?? '');
  return d.length >= 4 ? `+91 •••••• ${d.slice(-4)}` : null;
}

/**
 * Send a code through the existing WhatsApp OTP template (Seniqify BSP, the
 * same template and payload send-otp uses: {{1}} = code, {{2}} = minutes).
 *   { sent: true }                  provider accepted it
 *   { sent: 'unconfirmed' }         request delivered, provider slow to answer
 *                                   (Seniqify can take ~60 s to respond)
 *   { sent: false, reason }         refused or unreachable
 */
export async function sendWhatsAppOtp({ url, apiKey, receiver, code, fetchImpl = globalThis.fetch, timeoutMs = 12000 }) {
  if (!url) return { sent: false, reason: 'whatsapp_unconfigured' };
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetchImpl(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ receiver, values: { 1: code, 2: String(OTP_TTL_MIN) } }),
      signal: ctrl.signal,
    });
    if (r.ok) return { sent: true };
    return { sent: false, reason: `whatsapp_http_${r.status}` };
  } catch (e) {
    return e?.name === 'AbortError' ? { sent: 'unconfirmed' } : { sent: false, reason: 'whatsapp_network' };
  } finally {
    clearTimeout(timer);
  }
}
