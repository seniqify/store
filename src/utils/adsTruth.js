/**
 * Ads truth: when Meta's numbers and the shop's own orders disagree, say so.
 *
 * Meta's purchases are attributed and partly modelled, so a small difference
 * from real orders is normal. A large one means Meta is being told about
 * purchases that never happened, most often by a rule saved on the pixel in
 * Events Manager (see api/meta/_pixelHealth.js). Pure.
 */

/**
 * Is Meta's purchase count clearly above the shop's real orders?
 * At least 1.5 times as many, and at least 3 more: 24 against 5 is flagged,
 * 6 against 4 is not.
 */
export function purchaseGap(metaPurchases, orders) {
  const meta = Math.max(0, Math.round(Number(metaPurchases) || 0));
  const real = Math.max(0, Math.round(Number(orders) || 0));
  const extra = meta - real;
  return { inflated: extra >= 3 && meta >= real * 1.5, extra: Math.max(0, extra), meta, real };
}

const EVENT_WORDS = {
  Purchase: 'purchases', AddToCart: 'add-to-carts', InitiateCheckout: 'checkouts', AddPaymentInfo: 'payment steps',
  Lead: 'leads', CompleteRegistration: 'sign-ups', Subscribe: 'subscriptions', StartTrial: 'trials',
  Contact: 'contacts', Schedule: 'bookings', SubmitApplication: 'applications',
};
export const eventWords = (event) => EVENT_WORDS[event] || 'conversions';

/**
 * The one problem to show from a pixel check ({ pixels: [...] }): the first
 * critical finding (a rule that logs purchases), else the first warning, else
 * null. Carries the pixel it is on.
 */
export function topPixelProblem(health) {
  const pixels = Array.isArray(health?.pixels) ? health.pixels : [];
  let pick = null;
  for (const p of pixels) {
    for (const f of Array.isArray(p.findings) ? p.findings : []) {
      if (!pick || (f.severity === 'critical' && pick.severity !== 'critical')) pick = { ...f, pixelId: p.pixelId };
    }
  }
  return pick;
}

/** Page addresses as the shop knows them: without https:// and www. */
export const shortPage = (url) => String(url || '').replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '');
