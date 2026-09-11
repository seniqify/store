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
import { verifyStorePin, getMetaAccount, getStoreConfig, patchStoreConfig, graphGet, normalizeAdAccountId, resolveAdAccount, updateMetaStatus, slugAllowed } from './_meta.js';
import { buildCampaign } from './_campaignBuild.js';
import { recommend } from './_recommend.js';

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

// action 'select-ad-account' — persist WHICH ad account this store advertises
// from. Validated twice before it is written: the id must be one of the accounts
// granted at consent (so a caller cannot point a store at someone else's
// account), and it must still be readable from Meta right now.
async function selectAdAccount(res, slug, acct, requestedRaw) {
  const requested = normalizeAdAccountId(requestedRaw);
  if (!requested) { res.status(400).json({ error: 'missing' }); return; }

  const granted = (acct.ad_account_ids || []).map(normalizeAdAccountId).filter(Boolean);
  if (!granted.includes(requested)) { res.status(403).json({ error: 'ad_account_not_connected' }); return; }

  const r = await graphGet(requested, { fields: 'id,name,account_status,currency,timezone_name', access_token: acct.access_token });
  if (r?.body?.error?.code === 190 || r?.body?.error?.type === 'OAuthException') { res.status(200).json({ error: 'reauth' }); return; }
  if (r?.body?.error || !r?.body?.id) {
    res.status(200).json({ error: 'ad_account_unreadable', message: r?.body?.error?.message || 'Meta could not read that ad account.' });
    return;
  }

  const ok = await updateMetaStatus(slug, { selected_ad_account_id: requested });
  if (!ok) { res.status(200).json({ error: 'save_failed' }); return; }
  res.status(200).json({
    ok: true, adAccountId: requested, name: r.body.name || null,
    accountStatus: r.body.account_status ?? null, currency: r.body.currency || null,
    timezone: r.body.timezone_name || null,
  });
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

    const action = String(body.action || 'preview');
    // Staging guard: a preview deployment may only WRITE selections for the store
    // it was designated for. Previewing is read-only and stays unrestricted.
    if ((action === 'select-page' || action === 'select-ad-account') && !slugAllowed(slug)) {
      res.status(403).json({ error: 'not_allowed_in_this_environment' });
      return;
    }
    if (action === 'select-page') { await selectPage(res, slug, acct, config, body.pageId); return; }
    if (action === 'select-ad-account') { await selectAdAccount(res, slug, acct, body.adAccountId); return; }

    // ── Stage 2E preview (default): recommendation engine → shared builder ──
    // The seller sends BUSINESS decisions; recommend() turns them into the exact
    // technical config; buildCampaign() renders the dry-run. `resolved` is echoed
    // back so the launch sends the identical config (preview == launch).
    // One resolver for reporting, preview and creation — never ad_account_ids[0].
    const picked = resolveAdAccount(acct);
    if (picked.error) { res.status(200).json({ error: picked.error, adAccounts: picked.available }); return; }
    const adId = picked.adAccount;
    const biz = {
      goal: body.goal, promote: body.promote, productId: body.productId,
      audienceMode: body.audienceMode, budgetMode: body.budgetMode,
      dailyBudget: body.dailyBudget, days: body.days,
      radiusKm: body.radiusKm, ageMin: body.ageMin, ageMax: body.ageMax, gender: body.gender,
    };
    const rec = await recommend({ slug, cfg: config || {}, biz });
    const out = await buildCampaign({ slug, adId, token: acct.access_token, cfg: config || {} }, rec.input);
    res.status(200).json({ ...out, recommendation: rec.recommendation, resolved: rec.resolved });
  } catch {
    res.status(200).json({ error: 'server' });
  }
}
