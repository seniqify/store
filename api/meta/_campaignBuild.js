// Shared campaign builder — the SINGLE source of truth for both the 2C preview
// (campaign-preview.js) and the 2D launch (campaign-launch.js), so what you
// preview is exactly what launches. Makes ONLY read-only GET calls to Meta
// (account fields, business Pages, geo resolution). Builds the exact Marketing
// API payloads; never POSTs/creates anything itself.
import { graphGet } from './_meta.js';

// Hard server-side caps (authoritative — the real financial gate we control).
export const CAPS = { maxDaily: 5000, maxTotal: 25000, maxDays: 30, spendCapMinRupees: 8500 };

const APP_ORIGIN = 'https://www.pocketlink.store';
const PAGE_PLACEHOLDER = 'PAGE_ID_REQUIRED';

export const OBJECTIVES = {
  traffic: { key: 'traffic', label: 'Website visits', campaignObjective: 'OUTCOME_TRAFFIC', optimizationGoal: 'LINK_CLICKS', billingEvent: 'IMPRESSIONS', available: true },
  sales:   { key: 'sales',   label: 'Sales / Purchases', campaignObjective: 'OUTCOME_SALES', optimizationGoal: 'OFFSITE_CONVERSIONS', billingEvent: 'IMPRESSIONS', usesPixelPurchase: true, available: false },
};

// buildCampaign — validate + build. READ-ONLY. Returns the preview object with
// the exact payloads + launchBlockers; { error } for auth/config problems.
export async function buildCampaign({ slug, adId, token, cfg, businessId }, input) {
  const meta = cfg.meta || {};
  const warnings = [];
  const launchBlockers = [];

  const objDef = OBJECTIVES[String(input.objective || 'traffic')] || OBJECTIVES.traffic;
  if (!objDef.available) launchBlockers.push('That objective is not available yet.');

  // Clamp to hard caps (server-authoritative — never trust the client).
  let days = Math.floor(Number(input.days) || 7);
  if (days < 1) days = 1;
  if (days > CAPS.maxDays) { days = CAPS.maxDays; warnings.push(`Duration capped at ${CAPS.maxDays} days.`); }
  let daily = Math.floor(Number(input.dailyBudget) || 0);
  if (daily > CAPS.maxDaily) { daily = CAPS.maxDaily; warnings.push(`Daily budget capped at ₹${CAPS.maxDaily.toLocaleString('en-IN')}.`); }
  let total = daily * days;
  if (total > CAPS.maxTotal) {
    days = Math.max(1, Math.floor(CAPS.maxTotal / Math.max(1, daily)));
    total = daily * days;
    warnings.push(`Total capped at ₹${CAPS.maxTotal.toLocaleString('en-IN')} — duration reduced to ${days} days.`);
  }

  const promote = input.promote === 'product' ? 'product' : 'store';
  const product = promote === 'product' ? (cfg.products || []).find((p) => String(p.id) === String(input.productId)) || null : null;

  // ── Read-only: account currency + min budget + status ──
  const accInfo = await graphGet(adId, { fields: 'currency,name,min_daily_budget,account_status', access_token: token });
  if (accInfo?.body?.error?.code === 190 || accInfo?.body?.error?.type === 'OAuthException') return { error: 'reauth' };
  const currency = accInfo.body?.currency || 'INR';
  const minRupees = Number(accInfo.body?.min_daily_budget || 0) ? Math.ceil(Number(accInfo.body.min_daily_budget) / 100) : 0;
  const accountActive = Number(accInfo.body?.account_status) === 1;
  if (!accountActive) launchBlockers.push('Your Meta ad account is not active.');
  if (daily <= 0) launchBlockers.push('Set a daily budget.');
  else if (minRupees && daily < minRupees) launchBlockers.push(`Daily budget must be at least ₹${minRupees} for this ad account.`);

  // ── Read-only: eligible Facebook Page from the connected business ──
  let page = null;
  if (businessId) {
    const [owned, client] = await Promise.all([
      graphGet(`${businessId}/owned_pages`, { fields: 'id,name', access_token: token }),
      graphGet(`${businessId}/client_pages`, { fields: 'id,name', access_token: token }),
    ]);
    page = owned.body?.data?.[0] || client.body?.data?.[0] || null;
  }
  if (!page) launchBlockers.push('No Facebook Page is available in your connected Meta business — a Page is required to run ads. Add/connect a Page in Meta Business settings, then reconnect Meta.');

  // ── Read-only: resolve location dynamically (never hardcoded) ──
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
    if (hit?.key) { geo = { regions: [{ key: hit.key }] }; geoLabel = hit.name; warnings.push('Using your state as the ad location — set a city in Settings for tighter targeting.'); }
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

  // ── Payloads: lifetime_budget + end_time = Meta's true total cap ──
  const name = `PocketLink · ${cfg.businessName || slug}`;
  const lifetimeMinor = Math.round(total * 100);   // paise
  const startTime = new Date(Date.now() + 5 * 60000).toISOString();
  const endTime = new Date(Date.now() + days * 86400000).toISOString();

  const adset = {
    name: `${name} · ad set`,
    campaign_id: '{{campaign_id}}',
    lifetime_budget: lifetimeMinor,
    billing_event: objDef.billingEvent,
    optimization_goal: objDef.optimizationGoal,
    bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
    destination_type: 'WEBSITE',
    targeting: { ...(geo ? { geo_locations: geo } : {}), age_min: 18, age_max: 65 },
    start_time: startTime,
    end_time: endTime,
    status: 'PAUSED',
  };
  if (objDef.usesPixelPurchase && meta.pixelId) adset.promoted_object = { pixel_id: String(meta.pixelId), custom_event_type: 'PURCHASE' };

  // spend_cap only when total ≥ Meta's minimum (~$100/₹8,500). Secondary belt,
  // NOT the primary ceiling (lifetime_budget + end_time + our caps are).
  const spendCapEligible = total >= CAPS.spendCapMinRupees;
  const campaignBody = { name, objective: objDef.campaignObjective, status: 'PAUSED', special_ad_categories: [] };
  if (spendCapEligible) campaignBody.spend_cap = lifetimeMinor;
  else warnings.push(`Campaign spend-cap not applied (Meta minimum ≈ ₹${CAPS.spendCapMinRupees.toLocaleString('en-IN')}). Total is bounded by the lifetime budget + end date and our server caps.`);

  const payloads = {
    _note: 'Dry-run — Stage 2D POSTs these in order (campaign → adset → adcreative → ad). {{…}} resolve from the previous create. Budgets in paise. All created PAUSED.',
    campaign:   { endpoint: `POST /act_${adId}/campaigns`, body: campaignBody },
    adset:      { endpoint: `POST /act_${adId}/adsets`, body: adset },
    adcreative: {
      endpoint: `POST /act_${adId}/adcreatives`,
      body: {
        name: `${name} · creative`,
        object_story_spec: {
          page_id: page ? page.id : PAGE_PLACEHOLDER,
          link_data: { link, message: primaryText, name: headline, ...(cfg.tagline ? { description: cfg.tagline } : {}), ...(imageUrl ? { picture: imageUrl } : {}), call_to_action: { type: 'SHOP_NOW', value: { link } } },
        },
      },
      placeholders: page ? [] : ['object_story_spec.page_id'],
    },
    ad: { endpoint: `POST /act_${adId}/ads`, body: { name: `${name} · ad`, adset_id: '{{adset_id}}', creative: { creative_id: '{{creative_id}}' }, status: 'PAUSED' } },
  };

  return {
    ok: true, currency, minDailyBudget: minRupees, accountActive,
    objective: { key: objDef.key, label: objDef.label },
    budget: { daily, days, total, currency, lifetimeMinor, spendCapApplied: spendCapEligible },
    creative: { imageUrl, headline, primaryText, link, cta: 'Shop Now', promote, productName: product?.name || null },
    targeting: { label: geoLabel, ageMin: 18, ageMax: 65, resolved: !!geo },
    page: page ? { id: page.id, name: page.name } : null,
    warnings, launchBlockers, launchReady: launchBlockers.length === 0,
    payloads, caps: CAPS,
  };
}
