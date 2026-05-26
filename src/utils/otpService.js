/**
 * otpService — calls the Supabase Edge Function to send/verify WhatsApp OTP.
 * Edge function: supabase/functions/send-otp/index.ts
 */

const EDGE_URL  = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-otp`;
const ANON_KEY  = import.meta.env.VITE_SUPABASE_ANON_KEY;

async function call(body) {
  const res = await fetch(EDGE_URL, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${ANON_KEY}`,
    },
    body: JSON.stringify(body),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || 'OTP service error');
  return json;
}

/** Send a 6-digit OTP to the given WhatsApp number via MSG91. */
export async function sendOtp(phone) {
  return call({ action: 'send', phone });
}

/** Verify the OTP entered by the user. Throws if invalid / expired. */
export async function verifyOtp(phone, code) {
  return call({ action: 'verify', phone, code });
}
