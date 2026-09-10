import { hashPin } from './pinHash';

/**
 * Meta campaign — Stage 2C client helper. Builds a DRY-RUN preview of a campaign
 * from the PIN-gated /api/meta/campaign-preview endpoint. The endpoint is
 * read-only: it returns the exact Marketing API payloads a launch would send but
 * NEVER creates anything and NEVER spends. Returns the preview data, or an
 * { error } marker the UI handles.
 */
export async function previewCampaign(slug, pin, cfg) {
  const hashedPin = await hashPin(pin);
  const res = await fetch('/api/meta/campaign-preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug, hashedPin, ...cfg }),
  });
  const data = await res.json().catch(() => ({ error: 'server' }));
  if (!res.ok && !data?.error) return { error: 'server' };
  return data;
}

/**
 * Persist WHICH connected ad account this store advertises from. The server
 * validates the choice twice before saving — it must be one of the accounts
 * granted at consent, and still readable from Meta — so a caller can never point
 * a store at an account it does not own.
 *
 * Returns { ok, adAccountId, name, accountStatus, currency, timezone } or an
 * { error } marker: 'ad_account_not_connected' | 'ad_account_unreadable' |
 * 'reauth' | 'save_failed' | 'pin' | 'server'.
 */
export async function selectAdAccount(slug, pin, adAccountId) {
  const hashedPin = await hashPin(pin);
  const res = await fetch('/api/meta/campaign-preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug, hashedPin, action: 'select-ad-account', adAccountId }),
  });
  const data = await res.json().catch(() => ({ error: 'server' }));
  if (!res.ok && !data?.error) return { error: 'server' };
  return data;
}
