// Builds a UPI deep link (`upi://pay?…`) so a customer can pay the seller
// directly from any UPI app (GPay / PhonePe / Paytm / BHIM …).
//
// Spec: NPCI UPI Linking Specification — params pa (payee VPA), pn (payee name),
// am (amount), cu (currency), tn (transaction note).

/** Returns a `upi://pay?…` link, or null when no UPI ID is configured. */
export function buildUpiLink({ upi, payeeName = '', amount, note = '' } = {}) {
  const vpa = String(upi || '').trim();
  if (!vpa) return null;

  // The VPA (pa) must stay literal — UPI apps expect `name@bank`, not `name%40bank`.
  // Other free-text params (pn / tn) are percent-encoded.
  const parts = [`pa=${vpa}`, 'cu=INR'];
  if (payeeName) parts.push(`pn=${encodeURIComponent(payeeName)}`);
  if (amount != null && Number(amount) > 0) parts.push(`am=${Number(amount).toFixed(2)}`);
  if (note) parts.push(`tn=${encodeURIComponent(note.slice(0, 50))}`);

  return `upi://pay?${parts.join('&')}`;
}

/** True when the config has a usable UPI ID (looks like name@bank). */
export function hasUpi(config = {}) {
  return /.+@.+/.test(String(config.upi || '').trim());
}
