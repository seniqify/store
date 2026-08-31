// POST /api/meta/campaign-preview — Stage 2C: DRY-RUN campaign builder (read-only).
// PIN-gated (store owner). Delegates to the shared _campaignBuild builder so the
// preview is byte-for-byte what Stage 2D launches. HARD INVARIANT: read-only —
// never creates anything, never spends.
import { verifyStorePin, getMetaAccount, getStoreConfig } from './_meta.js';
import { buildCampaign } from './_campaignBuild.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'method' }); return; }
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const slug = String(body.slug || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 60);
    const hashedPin = String(body.hashedPin || '');
    if (!slug || !hashedPin) { res.status(400).json({ error: 'missing' }); return; }
    if (!(await verifyStorePin(slug, hashedPin))) { res.status(403).json({ error: 'pin' }); return; }

    const [acct, config] = await Promise.all([getMetaAccount(slug), getStoreConfig(slug)]);
    if (!acct || acct.status !== 'connected' || !acct.access_token) { res.status(200).json({ error: 'not_connected' }); return; }
    const adId = (acct.ad_account_ids || [])[0];
    if (!adId) { res.status(200).json({ error: 'no_ad_account' }); return; }

    const out = await buildCampaign(
      { slug, adId, token: acct.access_token, cfg: config || {} },
      { objective: body.objective, days: body.days, dailyBudget: body.dailyBudget, promote: body.promote, productId: body.productId },
    );
    res.status(200).json(out);
  } catch {
    res.status(200).json({ error: 'server' });
  }
}
