/**
 * Promo coupons.
 * A valid code grants a paid plan FREE for `days` days. After that the page
 * auto-reverts to Free (see effectivePlan() in planLimits.js) — there is no
 * stored card, so the owner is never auto-charged; they choose to pay to keep
 * the features. "One shared code" model — fine for comping a few close ones,
 * since the worst a leaked code does is give someone a free month, then they pay.
 *
 * To add/disable codes, just edit this map.
 */
export const COUPONS = {
  SCGT: { plan: 'business', days: 30, label: '1 month of Business — free' },
};

/** Returns the coupon definition for a code, or null if invalid. Case-insensitive. */
export function validateCoupon(code) {
  return COUPONS[String(code || '').trim().toUpperCase()] ?? null;
}
