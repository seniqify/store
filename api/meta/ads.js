// POST /api/meta/ads  — Stage 2a: read-only ad performance for a connected store.
// PIN-gated. Reads the store's Meta access token + ad account from the RLS-locked
// store_meta_accounts table (service role), calls Meta's Marketing API, and
// returns ONLY aggregated metrics. The token never reaches the browser, and this
// endpoint never writes or spends — pure read (ads_read).
import { verifyStorePin, getMetaAccount, graphGet } from './_meta.js';

// Action types that count as a "purchase" across Meta's variants.
const PURCHASE = ['purchase', 'omni_purchase', 'offsite_conversion.fct_purchase', 'onsite_conversion.purchase'];

function actionVal(actions, types) {
  if (!Array.isArray(actions)) return 0;
  for (const t of types) {
    const a = actions.find((x) => x.action_type === t);
    if (a) return Number(a.value) || 0;
  }
  return 0;
}

// Reduce one insights row → the numbers the dashboard shows. "results" is the
// most meaningful conversion available for the objective, in priority order.
function shape(row) {
  const spend       = Number(row?.spend || 0);
  const reach       = Number(row?.reach || 0);
  const impressions = Number(row?.impressions || 0);
  const clicks      = Number(row?.clicks || 0);
  const ctr         = Number(row?.ctr || 0);
  const actions     = row?.actions;
  const purchases   = actionVal(actions, PURCHASE);
  const lpv         = actionVal(actions, ['landing_page_view']);
  const linkClicks  = actionVal(actions, ['link_click']);
  const results     = purchases || lpv || linkClicks || 0;
  const resultLabel = purchases ? 'purchases' : lpv ? 'landing views' : 'link clicks';
  return {
    spend, reach, impressions, clicks, ctr, purchases, linkClicks,
    results, resultLabel,
    costPerResult: results > 0 ? spend / results : null,
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'method' }); return; }
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const slug = String(body.slug || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 60);
    const hashedPin = String(body.hashedPin || '');
    const range = body.range === '30d' ? 'last_30d' : 'last_7d';
    if (!slug || !hashedPin) { res.status(400).json({ error: 'missing' }); return; }

    // Owner-only.
    if (!(await verifyStorePin(slug, hashedPin))) { res.status(403).json({ error: 'pin' }); return; }

    const acct = await getMetaAccount(slug);
    if (!acct || acct.status !== 'connected' || !acct.access_token) { res.status(200).json({ error: 'not_connected' }); return; }
    const adId = (acct.ad_account_ids || [])[0];
    if (!adId) { res.status(200).json({ error: 'no_ad_account' }); return; }
    const token = acct.access_token;

    const insightFields = 'spend,impressions,reach,clicks,ctr,actions';
    const [info, accIns, campIns, camps] = await Promise.all([
      graphGet(adId,                { fields: 'currency,name', access_token: token }),
      graphGet(`${adId}/insights`,  { fields: insightFields, level: 'account',  date_preset: range, access_token: token }),
      graphGet(`${adId}/insights`,  { fields: `campaign_id,campaign_name,${insightFields}`, level: 'campaign', date_preset: range, limit: '200', access_token: token }),
      graphGet(`${adId}/campaigns`, { fields: 'id,name,status,objective', limit: '100', access_token: token }),
    ]);

    // Expired / revoked token (or lost permission) → tell the UI to prompt a reconnect.
    const authErr = [info, accIns, campIns, camps].some(
      (r) => r?.body?.error?.code === 190 || r?.body?.error?.type === 'OAuthException',
    );
    if (authErr) { res.status(200).json({ error: 'reauth' }); return; }

    const currency    = info.body?.currency || 'INR';
    const accountName = info.body?.name || null;
    const totals      = shape(accIns.body?.data?.[0] || {});

    const byCamp = new Map();
    for (const row of (campIns.body?.data || [])) byCamp.set(row.campaign_id, row);

    const campaigns = (camps.body?.data || [])
      .map((c) => ({ id: c.id, name: c.name, status: c.status, objective: c.objective, ...shape(byCamp.get(c.id) || {}) }))
      .filter((c) => c.status === 'ACTIVE' || c.status === 'PAUSED' || c.spend > 0)   // hide archived/deleted clutter
      .sort((a, b) => b.spend - a.spend)
      .slice(0, 25);

    res.status(200).json({ currency, accountName, range, totals, campaigns });
  } catch {
    res.status(200).json({ error: 'server' });
  }
}
