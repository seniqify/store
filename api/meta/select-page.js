// POST /api/meta/select-page — PIN-gated: choose which connected Facebook Page the
// store advertises from (the Stage 2C/2D ad identity). Validates the chosen pageId
// against the seller's LIVE granted Pages (/me/accounts) using the server-only
// token, then writes the public-safe selection into config.meta. An arbitrary or
// ungranted id is rejected — the client can never store a Page Meta didn't actually
// grant, and Instagram is taken straight from the selected Page. Runs server-side;
// the access token never reaches the browser. Does NOT touch the token, ad account,
// Pixel, or CAPI configuration.
import {
  verifyStorePin, serviceKey, graphGet,
  getMetaAccount, getStoreConfig, patchStoreConfig,
} from './_meta.js';

const mapPage = (p) => ({
  id: String(p.id),
  name: p.name || 'Facebook Page',
  ig: p.instagram_business_account?.id
    ? { id: String(p.instagram_business_account.id), username: p.instagram_business_account.username || p.instagram_business_account.name || '' }
    : null,
});

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  try {
    if (!serviceKey()) { res.status(503).json({ error: 'Meta connection is not configured yet.' }); return; }

    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const slug = String(body.slug || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 60);
    const hashedPin = String(body.hashedPin || '');
    const pageId = String(body.pageId || '').replace(/[^0-9]/g, '');   // Page IDs are numeric
    if (!slug || !hashedPin || !pageId) { res.status(400).json({ error: 'missing' }); return; }
    if (!(await verifyStorePin(slug, hashedPin))) { res.status(403).json({ error: 'pin' }); return; }

    const acct = await getMetaAccount(slug);
    if (!acct || acct.status !== 'connected' || !acct.access_token) { res.status(200).json({ error: 'not_connected' }); return; }

    // Validate against Meta's LIVE granted pages (authoritative) — and refresh the
    // full menu + the selected Page's name/Instagram from the same response.
    const r = await graphGet('me/accounts', { fields: 'id,name,instagram_business_account{id,username,name}', access_token: acct.access_token });
    if (r.body?.error?.code === 190 || r.body?.error?.type === 'OAuthException') { res.status(200).json({ error: 'reauth' }); return; }
    const list = Array.isArray(r.body?.data) ? r.body.data.filter((p) => p?.id) : [];
    const match = list.find((p) => String(p.id) === pageId);
    if (!match) { res.status(200).json({ error: 'not_granted' }); return; }
    const chosen = mapPage(match);

    const config = await getStoreConfig(slug);
    if (!config) { res.status(200).json({ error: 'no_store' }); return; }
    const patch = {
      ...config,
      meta: {
        ...(config.meta || {}),
        connected: true,
        pages: list.map(mapPage),                 // keep the menu fresh
        pageId: chosen.id,                         // the explicit, validated selection
        pageName: chosen.name,
        igId: chosen.ig?.id || null,
        igUsername: chosen.ig?.username || null,
      },
    };
    await patchStoreConfig(slug, patch);

    res.status(200).json({ ok: true, pageId: chosen.id, pageName: chosen.name, ig: chosen.ig });
  } catch {
    res.status(200).json({ error: 'server' });
  }
}
