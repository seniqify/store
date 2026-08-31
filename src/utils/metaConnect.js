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
  const res = await fetch('/api/meta/select-page', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug, hashedPin, pageId }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.error) throw new Error(SELECT_ERRORS[data?.error] || 'Could not save the Page. Please try again.');
  clearCachedStore(slug);   // so manage re-reads the fresh selection
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
