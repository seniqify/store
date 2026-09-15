import { hashPin } from './pinHash';
import { clearCachedStore } from './businessStorage';

/**
 * Meta (Facebook Login for Business) — Stage 1 client helpers.
 *
 * Both calls PIN-check the owner server-side (the raw PIN is hashed here first,
 * exactly like paymentsConnect). The access token lives only in the RLS-locked
 * store_meta_accounts table server-side — it never touches the browser, so there
 * is nothing sensitive to read back here; the UI reads connection status from the
 * public-safe config.meta mirror.
 */

/** Owner-only: begin the Meta connect flow. On success the browser is redirected
 *  to Meta's Login for Business screen (this call does not return in that case). */
export async function startMetaConnect(slug, pin) {
  const hashedPin = await hashPin(pin);
  const res = await fetch('/api/meta/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug, hashedPin }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.error || !data?.url) {
    throw new Error(data?.error || 'Could not start the connection. Please try again.');
  }
  window.location.href = data.url;   // hand off to Meta
}

// Friendly copy for the select-page error codes.
const SELECT_ERRORS = {
  missing:       'Please choose a Page.',
  pin:           'Incorrect PIN.',
  not_connected: 'Connect Meta first, then choose your Page.',
  reauth:        'Your Meta session expired — please reconnect Meta.',
  not_granted:   'That Page isn’t in your Meta grant — reconnect Meta and include the Page.',
};

/** Owner/founder: choose which connected Facebook Page the store advertises from.
 *  The server re-validates the id against Meta's live granted Pages before storing
 *  it, and pulls the Page's Instagram account from the same response. */
export async function selectMetaPage(slug, pin, pageId) {
  const hashedPin = await hashPin(pin);
  // Served by the campaign-preview function (action: 'select-page') — one endpoint,
  // same PIN gate — to stay within Vercel's serverless-function limit.
  const res = await fetch('/api/meta/campaign-preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'select-page', slug, hashedPin, pageId }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.error) throw new Error(SELECT_ERRORS[data?.error] || 'Could not save the Page. Please try again.');
  clearCachedStore(slug);   // so manage re-reads the fresh selection
  return data;
}

// The Ads screen's other calls to the preview function. Returns the server's JSON
// (an `error` code on failure) and never throws, so screens can branch on codes.
async function adsAction(slug, pin, payload) {
  try {
    const hashedPin = await hashPin(pin);
    const res = await fetch('/api/meta/campaign-preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug, hashedPin, ...payload }),
    });
    const data = await res.json().catch(() => ({ error: 'server' }));
    if (res.status === 403 && !data?.error) return { error: 'pin' };
    return data;
  } catch {
    return { error: 'network' };
  }
}

/** The Ads screen's state: connected or not, mode, choices, selections, eligibility. */
export const fetchMetaConnection = (slug, pin) => adsAction(slug, pin, { action: 'connection' });

/** Same, after asking Meta again which ad accounts are enabled for automation. */
export const refreshMetaEligibility = (slug, pin) => adsAction(slug, pin, { action: 'refresh-eligibility' });

/** AI-written ad words and an audience suggestion for one product ('' = the whole store). */
export const fetchAdCopy = (slug, pin, productId) => adsAction(slug, pin, { action: 'ad-copy', productId: productId || '' });

/** Choose the business portfolio (one the connection can still see). */
export async function selectMetaBusiness(slug, pin, businessId) {
  const data = await adsAction(slug, pin, { action: 'select-business', businessId });
  if (data?.ok) clearCachedStore(slug);
  return data;
}

/** Choose the Instagram account linked to the selected Page ('' = Facebook only). */
export async function selectMetaInstagram(slug, pin, igId) {
  const data = await adsAction(slug, pin, { action: 'select-instagram', igId });
  if (data?.ok) clearCachedStore(slug);
  return data;
}

/** Owner-only: disconnect the store's Meta connection. */
export async function disconnectMeta(slug, pin) {
  const hashedPin = await hashPin(pin);
  const res = await fetch('/api/meta/disconnect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug, hashedPin }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.error) throw new Error(data?.error || 'Could not disconnect. Please try again.');
  clearCachedStore(slug);   // so the storefront/manage re-reads the fresh flag
  return data;
}
