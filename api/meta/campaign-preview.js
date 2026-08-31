// POST /api/meta/campaign-preview — Stage 2C: DRY-RUN campaign builder.
//
// PIN-gated. Reads the store's ad account / pixel / token + config server-side and
// BUILDS the exact Marketing API payloads a launch (Stage 2D) would POST — then
// returns them. It makes ONLY read-only GET calls to Meta (account fields,
// available Pages, geo resolution).
//
// ██ HARD INVARIANT ██  This endpoint NEVER creates anything and NEVER spends:
// no Marketing API POST / create call under any circumstance. Every graphGet
// below is a GET. The built payloads are returned for preview/approval only.
import { verifyStorePin, getMetaAccount, getStoreConfig, graphGet } from './_meta.js';

// Objective registry — extensible. Traffic is live; Sales/Purchase is defined
// (with the pixel promoted_object) but not yet selectable — a later stage flips
// `available` to true. Purchase optimization is intentionally preserved here.
const OBJECTIVES = {
  traffic: { key: 'traffic', label: 'Website visits', campaignObjective: 'OUTCOME_TRAFFIC', optimizationGoal: 'LINK_CLICKS', billingEvent: 'IMPRESSIONS', available: true },
  sales:   { key: 'sales',   label: 'Sales / Purchases', campaignObjective: 'OUTCOME_SALES', optimizationGoal: 'OFFSITE_CONVERSIONS', billingEvent: 'IMPRESSIONS', usesPixelPurchase: true, available: false },
};

const APP_ORIGIN = 'https://www.pocketlink.store';
const PAGE_PLACEHOLDER = 'PAGE_ID_REQUIRED';
const MAX_DAILY_BUDGET = 100000;   // ₹1,00,000/day — fat-finger guard

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
    const token = acct.access_token;
    const cfg = config || {};
    const meta = cfg.meta || {};
    const businessId = acct.business_id || meta.businessId || null;

    // ── Inputs ──
    const objDef = OBJECTIVES[String(body.objective || 'traffic')] || OBJECTIVES.traffic;
    if (!objDef.available) { res.status(200).json({ error: 'objective_unavailable' }); return; }
    const days = Math.max(1, Math.min(90, Number(body.days) || 7));
    let dailyBudget = Math.max(0, Number(body.dailyBudget) || 0);
    const promote = body.promote === 'product' ? 'product' : 'store';
    const product = promote === 'product'
      ? (cfg.products || []).find((p) => String(p.id) === String(body.productId)) || null
      : null;

    const warnings = [];
    const launchBlockers = [];

    // ── Read-only: account currency + min budget + status ──
    const accInfo = await graphGet(adId, { fields: 'currency,name,min_daily_budget,account_status', access_token: token });
    if (accInfo?.body?.error?.code === 190 || accInfo?.body?.error?.type === 'OAuthException') { res.status(200).json({ error: 'reauth' }); return; }
    const currency = accInfo.body?.currency || 'INR';
    const minRupees = Number(accInfo.body?.min_daily_budget || 0) ? Math.ceil(Number(accInfo.body.min_daily_budget) / 100) : 0;
    const accountActive = Number(accInfo.body?.account_status) === 1;
    if (!accountActive) launchBlockers.push('Your Meta ad account is not active.');

    if (dailyBudget > MAX_DAILY_BUDGET) { dailyBudget = MAX_DAILY_BUDGET; warnings.push(`Daily budget capped at ₹${MAX_DAILY_BUDGET.toLocaleString('en-IN')}.`); }
    if (dailyBudget <= 0) launchBlockers.push('Set a daily budget.');
    else if (minRupees && dailyBudget < minRupees) launchBlockers.push(`Daily budget must be at least ₹${minRupees} for this ad account.`);

    // ── Read-only: is an eligible Facebook Page available in the connected business? ──
    let page = null;
    if (businessId) {
      const [owned, client] = await Promise.all([
        graphGet(`${businessId}/owned_pages`, { fields: 'id,name', access_token: token }),
        graphGet(`${businessId}/client_pages`, { fields: 'id,name', access_token: token }),
      ]);
      page = owned.body?.data?.[0] || client.body?.data?.[0] || null;
    }
    if (!page) launchBlockers.push('No Facebook Page is available in your connected Meta business — a Page is required to run ads. Add/connect a Page in Meta Business settings, then reconnect Meta.');

    // ── Read-only: resolve the store's location dynamically (never hardcoded) ──
    let geo = null; let geoLabel = '';
    const city = String(cfg.city || '').trim();
    const region = String(cfg.state || '').trim();
    if (city) {
      const gr = await graphGet('search', { type: 'adgeolocation', location_types: JSON.stringify(['city']), q: city, access_token: token });
      const hit = (gr.body?.data || [])[0];
      if (hit?.key) { geo = { cities: [{ key: hit.key, radius: 25, distance_unit: 'kilometer' }] }; geoLabel = `${hit.name}${hit.region ? `, ${hit.region}` : ''} · +25km`; }
    }
    if (!geo && region) {
      const gr = await graphGet('search', { type: 'adgeolocation', location_types: JSON.stringify(['region']), q: region, access_token: token });
      const hit = (gr.body?.data || [])[0];
      if (hit?.key) { geo = { regions: [{ key: hit.key }] }; geoLabel = hit.name; warnings.push('Using your state as the ad location — set a more specific city in Settings for tighter targeting.'); }
    }
    if (!geo) launchBlockers.push('Your store has no usable ad location — set your city in Settings → Location.');

    // ── Creative (from real store data) ──
    const link = (promote === 'product' && product) ? `${APP_ORIGIN}/${slug}/p/${product.id}` : `${APP_ORIGIN}/${slug}`;
    const imageUrl = product?.image || cfg.coverImage || cfg.logo || null;
    const headline = product?.name || cfg.businessName || 'Shop with us';
    const primaryText = product
      ? `${product.name}${product.price ? ` — ₹${product.price}` : ''}. ${cfg.tagline || 'Order now on WhatsApp.'}`
      : `${cfg.businessName || 'Our shop'} — ${cfg.tagline || 'Order now on WhatsApp.'}`;
    if (!imageUrl) launchBlockers.push('Add a product photo or a store cover image to use in the ad.');

    // ── Build the EXACT Stage-2D payloads (NOT sent) ──
    const name = `PocketLink · ${cfg.businessName || slug}`;
    const adset = {
      name: `${name} · ad set`,
      campaign_id: '{{campaign_id}}',
      daily_budget: Math.round(dailyBudget * 100),   // paise (INR minor units)
      billing_event: objDef.billingEvent,
      optimization_goal: objDef.optimizationGoal,
      bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
      destination_type: 'WEBSITE',
      targeting: { ...(geo ? { geo_locations: geo } : {}), age_min: 18, age_max: 65 },
      start_time: new Date(Date.now() + 5 * 60000).toISOString(),
      end_time: new Date(Date.now() + days * 86400000).toISOString(),
      status: 'PAUSED',
    };
    if (objDef.usesPixelPurchase && meta.pixelId) adset.promoted_object = { pixel_id: String(meta.pixelId), custom_event_type: 'PURCHASE' };

    const payloads = {
      _note: 'Stage 2C dry-run — NOT sent. Stage 2D POSTs these in order (campaign → adset → adcreative → ad). {{…}} values resolve from the previous create.',
      campaign:   { endpoint: `POST /act_${adId}/campaigns`, body: { name, objective: objDef.campaignObjective, status: 'PAUSED', special_ad_categories: [] } },
      adset:      { endpoint: `POST /act_${adId}/adsets`, body: adset },
      adcreative: {
        endpoint: `POST /act_${adId}/adcreatives`,
        body: {
          name: `${name} · creative`,
          object_story_spec: {
            page_id: page ? page.id : PAGE_PLACEHOLDER,
            link_data: {
              link, message: primaryText, name: headline,
              ...(cfg.tagline ? { description: cfg.tagline } : {}),
              ...(imageUrl ? { picture: imageUrl } : {}),
              call_to_action: { type: 'SHOP_NOW', value: { link } },
            },
          },
        },
        placeholders: page ? [] : ['object_story_spec.page_id'],
      },
      ad: { endpoint: `POST /act_${adId}/ads`, body: { name: `${name} · ad`, adset_id: '{{adset_id}}', creative: { creative_id: '{{creative_id}}' }, status: 'PAUSED' } },
    };

    res.status(200).json({
      ok: true,
      currency,
      minDailyBudget: minRupees,
      accountActive,
      objective: { key: objDef.key, label: objDef.label },
      budget: { daily: dailyBudget, days, total: dailyBudget * days, currency },
      creative: { imageUrl, headline, primaryText, link, cta: 'Shop Now', promote, productName: product?.name || null },
      targeting: { label: geoLabel, ageMin: 18, ageMax: 65, resolved: !!geo },
      page: page ? { id: page.id, name: page.name } : null,
      warnings,
      launchBlockers,
      launchReady: launchBlockers.length === 0,
      payloads,
    });
  } catch {
    res.status(200).json({ error: 'server' });
  }
}
