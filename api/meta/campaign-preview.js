// POST /api/meta/campaign-preview — PIN-gated (store owner) endpoint for the ads
// flow. Two actions share the same PIN gate + Meta account lookup so we stay within
// Vercel's serverless-function limit (this is intentionally NOT a separate route):
//
//   action 'preview' (default) — Stage 2C DRY-RUN campaign builder. Delegates to the
//     shared _campaignBuild builder so the preview is byte-for-byte what Stage 2D
//     launches. HARD INVARIANT: read-only wrt Meta — never creates, never spends.
//   action 'select-page' — choose which connected Facebook Page the store advertises
//     from (the single source of truth for 2C/2D). Validates the chosen pageId
//     against Meta's LIVE granted Pages (/me/accounts) before writing it to
//     config.meta; Instagram follows the selected Page. An arbitrary/ungranted id is
//     rejected server-side. Writes only the local page selection — no Meta writes.
import { verifyStorePin, getMetaAccount, getStoreConfig, patchStoreConfig, graphGet } from './_meta.js';
import { buildCampaign } from './_campaignBuild.js';

const mapPage = (p) => ({
  id: String(p.id),
  name: p.name || 'Facebook Page',
  ig: p.instagram_business_account?.id
    ? { id: String(p.instagram_business_account.id), username: p.instagram_business_account.username || p.instagram_business_account.name || '' }
    : null,
});

// action 'select-page' — validate against Meta's live grant, then persist selection.
async function selectPage(res, slug, acct, config, pageIdRaw) {
  const pageId = String(pageIdRaw || '').replace(/[^0-9]/g, '');   // Page IDs are numeric
  if (!pageId) { res.status(400).json({ error: 'missing' }); return; }

  const r = await graphGet('me/accounts', { fields: 'id,name,instagram_business_account{id,username,name}', access_token: acct.access_token });
  if (r.body?.error?.code === 190 || r.body?.error?.type === 'OAuthException') { res.status(200).json({ error: 'reauth' }); return; }
  const list = Array.isArray(r.body?.data) ? r.body.data.filter((p) => p?.id) : [];
  const match = list.find((p) => String(p.id) === pageId);
  if (!match) { res.status(200).json({ error: 'not_granted' }); return; }
  const chosen = mapPage(match);

  if (!config) { res.status(200).json({ error: 'no_store' }); return; }
  const patch = {
    ...config,
    meta: {
      ...(config.meta || {}),
      connected: true,
      pages: list.map(mapPage),          // keep the menu fresh
      pageId: chosen.id,                 // the explicit, validated selection
      pageName: chosen.name,
      igId: chosen.ig?.id || null,
      igUsername: chosen.ig?.username || null,
    },
  };
  await patchStoreConfig(slug, patch);
  res.status(200).json({ ok: true, pageId: chosen.id, pageName: chosen.name, ig: chosen.ig });
}

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

    if (String(body.action || 'preview') === 'select-page') {
      await selectPage(res, slug, acct, config, body.pageId);
      return;
    }

    // ── Stage 2C preview (default) ──
    const adId = (acct.ad_account_ids || [])[0];
    if (!adId) { res.status(200).json({ error: 'no_ad_account' }); return; }
    const out = await buildCampaign(
      { slug, adId, token: acct.access_token, cfg: config || {} },
      { objective: body.objective, days: body.days, dailyBudget: body.dailyBudget, promote: body.promote, productId: body.productId, gender: body.gender, radiusKm: body.radiusKm, ageMin: body.ageMin, ageMax: body.ageMax },
    );
    res.status(200).json(out);
  } catch {
    res.status(200).json({ error: 'server' });
  }
}
