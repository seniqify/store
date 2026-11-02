import { hostMode } from './hostMode.js';

/**
 * Online payment (the shop's own Razorpay) on the shop's own domain.
 *
 * Razorpay takes LIVE payments only on websites registered on that Razorpay
 * account: a shop adds its domain under Account & Settings → Business website
 * detail → Add additional website/app, and Razorpay reviews it (about 24–48
 * hours). Until then a live payment there is refused, so "Pay Online" would
 * open and fail. The shop tells us when Razorpay has approved its domain
 * (`payments.razorpayDomains`); only then is online payment offered there.
 *
 *  - On PocketLink (no host marker): exactly as before.
 *  - In Razorpay TEST mode: offered everywhere, as test payments are not checked.
 *  - On the shop's own domain, live: only on a domain the shop has confirmed.
 */

const HOST = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

const cleanHost = (h) => String(h ?? '').trim().toLowerCase().replace(/\.$/, '');

/** The domains the shop has confirmed Razorpay approved, cleaned. */
export function razorpayApprovedHosts(payments) {
  const list = Array.isArray(payments?.razorpayDomains) ? payments.razorpayDomains : [];
  return [...new Set(list.map(cleanHost).filter((h) => HOST.test(h)))];
}

/** True when the shop's Razorpay is in test mode (test payments are never refused for the website). */
export function razorpayTestMode(payments) {
  return String(payments?.mode || '').toLowerCase() === 'test';
}

/** Does `host` still need the shop to confirm Razorpay's approval before online payment shows there? */
export function needsRazorpayApproval(payments, host) {
  return Boolean(payments?.razorpay) && !razorpayTestMode(payments)
    && !razorpayApprovedHosts(payments).includes(cleanHost(host));
}

/** May this page offer "Pay Online"? */
export function onlinePayOffered(payments, mode = hostMode()) {
  if (!payments?.razorpay) return false;
  if (mode?.mode !== 'merchant') return true;            // PocketLink: as before
  let host;
  try { host = new URL(mode.base).hostname; } catch { return false; }
  return !needsRazorpayApproval(payments, host);
}

/** `payments` with `host` added to (or removed from) the confirmed domains. */
export function withRazorpayHost(payments, host, approved) {
  const h = cleanHost(host);
  const rest = razorpayApprovedHosts(payments).filter((x) => x !== h);
  return { ...(payments || {}), razorpayDomains: approved && HOST.test(h) ? [...rest, h] : rest };
}
