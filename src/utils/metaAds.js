import { hashPin } from './pinHash';

/**
 * Meta ads — Stage 2a client helper. Fetches read-only ad performance for a
 * store from the PIN-gated /api/meta/ads endpoint. The endpoint reads the access
 * token server-side; only aggregated metrics come back here (never the token).
 *
 * Returns the data object, or an { error } marker the UI handles:
 *   'not_connected' | 'no_ad_account' | 'reauth' | 'pin' | 'server' |
 *   'meta_error' (carries { message, code } — show it, never render zeros) |
 *   'ad_account_not_connected' (requested an account this store does not own)
 */
export async function fetchAdsPerformance(slug, pin, range = '7d', adAccountId = null) {
  const hashedPin = await hashPin(pin);
  const res = await fetch('/api/meta/ads', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug, hashedPin, range, ...(adAccountId ? { adAccountId } : {}) }),
  });
  const data = await res.json().catch(() => ({ error: 'server' }));
  if (!res.ok && !data?.error) return { error: 'server' };
  return data;
}

/**
 * Does this store's Meta Pixel log purchases (or other conversions) by itself?
 * /api/meta/pixel-health reads each pixel's public settings from Meta. Works
 * without a Meta connection. Returns { pixels: [{ pixelId, used, status,
 * findings }] } or { error }.
 */
export async function fetchPixelHealth(slug, pin) {
  try {
    const hashedPin = await hashPin(pin);
    const res = await fetch('/api/meta/pixel-health', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug, hashedPin }),
    });
    const data = await res.json().catch(() => ({ error: 'server' }));
    if (!res.ok && !data?.error) return { error: 'server' };
    return data;
  } catch {
    return { error: 'network' };
  }
}
