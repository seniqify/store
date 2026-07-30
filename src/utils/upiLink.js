// Builds a UPI deep link (`upi://pay?…`) so a customer can pay the seller
// directly from any UPI app (GPay / PhonePe / Paytm / BHIM …).
//
// Spec: NPCI UPI Linking Specification — params pa (payee VPA), pn (payee name),
// am (amount), cu (currency), tn (transaction note).

/**
 * True only for a real UPI VPA: `name@handle` where the handle is a bank / PSP
 * code (oksbi, ybl, paytm, okhdfcbank, barodampay …). The handle is always
 * plain letters/digits and NEVER a dotted domain — that dot is exactly what
 * separates a VPA from an EMAIL. A merchant who types `name@gmail.com` has no
 * valid UPI address, so the app opens but every payment fails to resolve. This
 * guard stops that: an email / malformed value is treated as "no UPI".
 */
export function isValidUpiVpa(value) {
  const v = String(value || '').trim();
  return /^[a-zA-Z0-9][a-zA-Z0-9._-]{1,}@[a-zA-Z0-9]{2,}$/.test(v);
}

/** Returns a `upi://pay?…` link, or null when the UPI ID isn't a valid VPA. */
export function buildUpiLink({ upi, payeeName = '', amount, note = '' } = {}) {
  const vpa = String(upi || '').trim();
  if (!isValidUpiVpa(vpa)) return null;

  // The VPA (pa) must stay literal — UPI apps expect `name@bank`, not `name%40bank`.
  // Other free-text params (pn / tn) are percent-encoded. Keep pn/tn ASCII —
  // some UPI apps reject a transaction note with non-ASCII characters (e.g. an
  // em-dash), so strip anything outside basic ASCII before encoding.
  const ascii = (s) => String(s).replace(/[^\x20-\x7E]/g, ' ').replace(/\s+/g, ' ').trim();
  const parts = [`pa=${vpa}`, 'cu=INR'];
  if (payeeName) parts.push(`pn=${encodeURIComponent(ascii(payeeName))}`);
  if (amount != null && Number(amount) > 0) parts.push(`am=${Number(amount).toFixed(2)}`);
  if (note) parts.push(`tn=${encodeURIComponent(ascii(note).slice(0, 50))}`);

  return `upi://pay?${parts.join('&')}`;
}

/** True when the config has a usable, valid UPI VPA. */
export function hasUpi(config = {}) {
  return isValidUpiVpa(config.upi);
}
