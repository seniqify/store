// POST /api/meta/ads  — Stage 2a dashboard + 2E-2 measurement (read-mostly).
// PIN-gated. Reads the store's Meta token + ad account (service role), calls Meta's
// Marketing API for aggregated performance, AND — for campaigns PocketLink launched
// (in the meta_campaigns ledger) — reconciles Meta's reported funnel against our own
// order/revenue truth and snapshots an outcome row (on-view capture). The token
// never reaches the browser; this endpoint never writes to Meta or spends.
import { SB, verifyStorePin, getMetaAccount, graphGet, serviceKey } from './_meta.js';

// Action types that count as each funnel step across Meta's variants.
const PURCHASE = ['purchase', 'omni_purchase', 'offsite_conversion.fct_purchase', 'onsite_conversion.purchase'];
const ADD_TO_CART = ['add_to_cart', 'omni_add_to_cart', 'offsite_conversion.fct_add_to_cart', 'onsite_web_add_to_cart'];
const CHECKOUT = ['initiate_checkout', 'omni_initiated_checkout', 'offsite_conversion.fct_initiate_checkout', 'onsite_web_initiate_checkout'];

function actionVal(actions, types) {
  if (!Array.isArray(actions)) return 0;
  for (const t of types) {
    const a = actions.find((x) => x.action_type === t);
    if (a) return Number(a.value) || 0;
  }
  return 0;
}

// Reduce one insights row → the full funnel the dashboard + measurement need.
function shape(row) {
  const spend = Number(row?.spend || 0);
  const actions = row?.actions;
  const values = row?.action_values;
  const purchases = actionVal(actions, PURCHASE);
  const revenue = actionVal(values, PURCHASE);
  const lpv = actionVal(actions, ['landing_page_view']);
  const atc = actionVal(actions, ADD_TO_CART);
  const checkout = actionVal(actions, CHECKOUT);
  const linkClicks = actionVal(actions, ['link_click']);
  const results = purchases || lpv || linkClicks || 0;
  const resultLabel = purchases ? 'purchases' : lpv ? 'landing views' : 'link clicks';
  return {
    spend, reach: Number(row?.reach || 0), impressions: Number(row?.impressions || 0),
    clicks: Number(row?.clicks || 0), ctr: Number(row?.ctr || 0), cpm: Number(row?.cpm || 0), cpc: Number(row?.cpc || 0),
    purchases, revenue, lpv, atc, checkout, linkClicks, results, resultLabel,
    costPerResult: results > 0 ? spend / results : null,
  };
}

// ── Service-role helpers (2E-2 measurement) ──────────────────────────────────
const svc = () => ({ apikey: serviceKey(), Authorization: `Bearer ${serviceKey()}`, 'Content-Type': 'application/json' });
async function fetchLedger(slug) {
  try {
    const r = await fetch(`${SB}/rest/v1/meta_campaigns?store_slug=eq.${encodeURIComponent(slug)}&campaign_id=not.is.null&select=campaign_id,launch_id,status,created_at,activated_at,strategy_source,experiment_id,config`, { headers: svc() });
    return r.ok ? await r.json() : [];
  } catch { return []; }
}
async function fetchOrders(slug, sinceIso) {
  try {
    const q = `${SB}/rest/v1/orders?store_slug=eq.${encodeURIComponent(slug)}${sinceIso ? `&created_at=gte.${encodeURIComponent(sinceIso)}` : ''}&select=total,status&limit=5000`;
    const r = await fetch(q, { headers: svc() });
    return r.ok ? await r.json() : [];
  } catch { return []; }
}
async function upsertOutcome(row) {
  try {
    await fetch(`${SB}/rest/v1/meta_campaign_outcomes`, { method: 'POST', headers: { ...svc(), Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(row) });
  } catch { /* best-effort */ }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'method' }); return; }
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const slug = String(body.slug || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 60);
    const hashedPin = String(body.hashedPin || '');
    const range = body.range === '30d' ? 'last_30d' : 'last_7d';
    if (!slug || !hashedPin) { res.status(400).json({ error: 'missing' }); return; }
    if (!(await verifyStorePin(slug, hashedPin))) { res.status(403).json({ error: 'pin' }); return; }

    const acct = await getMetaAccount(slug);
    if (!acct || acct.status !== 'connected' || !acct.access_token) { res.status(200).json({ error: 'not_connected' }); return; }
    const adId = (acct.ad_account_ids || [])[0];
    if (!adId) { res.status(200).json({ error: 'no_ad_account' }); return; }
    const token = acct.access_token;

    const insightFields = 'spend,impressions,reach,cpm,clicks,ctr,cpc,actions,action_values';
    const [info, accIns, campIns, camps, maxIns] = await Promise.all([
      graphGet(adId,                { fields: 'currency,name', access_token: token }),
      graphGet(`${adId}/insights`,  { fields: insightFields, level: 'account',  date_preset: range, access_token: token }),
      graphGet(`${adId}/insights`,  { fields: `campaign_id,campaign_name,${insightFields}`, level: 'campaign', date_preset: range, limit: '200', access_token: token }),
      graphGet(`${adId}/campaigns`, { fields: 'id,name,status,objective', limit: '100', access_token: token }),
      graphGet(`${adId}/insights`,  { fields: `campaign_id,${insightFields}`, level: 'campaign', date_preset: 'maximum', limit: '200', access_token: token }),
    ]);

    const authErr = [info, accIns, campIns, camps, maxIns].some(
      (r) => r?.body?.error?.code === 190 || r?.body?.error?.type === 'OAuthException',
    );
    if (authErr) { res.status(200).json({ error: 'reauth' }); return; }

    const currency = info.body?.currency || 'INR';
    const accountName = info.body?.name || null;
    const totals = shape(accIns.body?.data?.[0] || {});

    const byCamp = new Map();
    for (const row of (campIns.body?.data || [])) byCamp.set(row.campaign_id, row);
    const byName = new Map((camps.body?.data || []).map((c) => [c.id, c.name]));

    const campaigns = (camps.body?.data || [])
      .map((c) => ({ id: c.id, name: c.name, status: c.status, objective: c.objective, ...shape(byCamp.get(c.id) || {}) }))
      .filter((c) => c.status === 'ACTIVE' || c.status === 'PAUSED' || c.spend > 0)
      .sort((a, b) => b.spend - a.spend)
      .slice(0, 25);

    // ── 2E-2: reconcile + snapshot outcomes for OUR launched campaigns ──
    const measured = [];
    try {
      const ledger = await fetchLedger(slug);
      if (ledger.length) {
        const maxMap = new Map();
        for (const r of (maxIns.body?.data || [])) maxMap.set(r.campaign_id, r);
        const today = new Date().toISOString().slice(0, 10);
        const nowIso = new Date().toISOString();
        for (const L of ledger) {
          const m = shape(maxMap.get(L.campaign_id) || {});
          const since = L.activated_at || L.created_at || null;
          const orders = await fetchOrders(slug, since);
          const placed = orders.filter((o) => ['new', 'confirmed', 'dispatched', 'delivered'].includes(o.status));
          const delivered = orders.filter((o) => o.status === 'delivered');
          const sum = (arr) => arr.reduce((s, o) => s + (Number(o.total) || 0), 0);
          const pl = { orders: placed.length, revenue: sum(placed), deliveredOrders: delivered.length, deliveredRevenue: sum(delivered) };
          await upsertOutcome({
            campaign_id: L.campaign_id, store_slug: slug, launch_id: L.launch_id, snapshot_date: today,
            spend: m.spend, impressions: m.impressions, reach: m.reach, cpm: m.cpm, clicks: m.clicks, ctr: m.ctr, cpc: m.cpc,
            lpv: m.lpv, atc: m.atc, checkout: m.checkout, purchases_meta: m.purchases, revenue_meta: m.revenue,
            orders_pl: pl.orders, revenue_pl: pl.revenue, delivered_orders_pl: pl.deliveredOrders, delivered_revenue_pl: pl.deliveredRevenue,
            currency, captured_at: nowIso,
          });
          measured.push({
            campaignId: L.campaign_id, name: byName.get(L.campaign_id) || '', status: L.status,
            strategySource: L.strategy_source, experimentId: L.experiment_id, snapshot: L.config || null,
            meta: { spend: m.spend, reach: m.reach, impressions: m.impressions, clicks: m.clicks, ctr: m.ctr, cpm: m.cpm, cpc: m.cpc, lpv: m.lpv, atc: m.atc, checkout: m.checkout, purchases: m.purchases, revenue: m.revenue },
            pl,
            derived: {
              cppMeta: m.purchases > 0 ? m.spend / m.purchases : null,
              cppPl: pl.orders > 0 ? m.spend / pl.orders : null,
              roasMeta: m.spend > 0 ? m.revenue / m.spend : null,
              roasPl: m.spend > 0 ? pl.revenue / m.spend : null,
            },
          });
        }
      }
    } catch { /* measurement is best-effort — never breaks the dashboard */ }

    res.status(200).json({ currency, accountName, range, totals, campaigns, measured });
  } catch {
    res.status(200).json({ error: 'server' });
  }
}
