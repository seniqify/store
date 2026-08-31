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
