// Shared campaign builder — the SINGLE source of truth for both the 2C preview
// (campaign-preview.js) and the 2D launch (campaign-launch.js), so what you
// preview is exactly what launches. Makes ONLY read-only GET calls to Meta
// (account fields, business Pages, geo resolution). Builds the exact Marketing
// API payloads; never POSTs/creates anything itself.
import { graphGet, normalizeAdAccountId } from './_meta.js';

// Hard server-side caps (authoritative — the real financial gate we control).
export const CAPS = { maxDaily: 5000, maxTotal: 25000, maxDays: 30, spendCapMinRupees: 8500 };

const APP_ORIGIN = 'https://www.pocketlink.store';
const PAGE_PLACEHOLDER = 'PAGE_ID_REQUIRED';

export const OBJECTIVES = {
  traffic: { key: 'traffic', label: 'Website visits', campaignObjective: 'OUTCOME_TRAFFIC', optimizationGoal: 'LINK_CLICKS', billingEvent: 'IMPRESSIONS', available: true },
  sales:   { key: 'sales',   label: 'Sales / Purchases', campaignObjective: 'OUTCOME_SALES', optimizationGoal: 'OFFSITE_CONVERSIONS', billingEvent: 'IMPRESSIONS', usesPixelPurchase: true, available: true },
  awareness:{ key: 'awareness', label: 'Awareness / Reach', campaignObjective: 'OUTCOME_AWARENESS', optimizationGoal: 'REACH', billingEvent: 'IMPRESSIONS', available: true },
};

// ── Pack-aware product display ────────────────────────────────────────────────
// A product's headline price can belong to a MULTIPACK variant: "Bajar Amti 90 g
// Per Packet" lists at ₹270, but that ₹270 actually buys the "3 x Packet"
// option. Advertising "90 g Per Packet — ₹270" reads as ₹270 for one packet,
// which is not what the shopper receives — and an ad has to be true.
//
// Entirely data-driven: find the variant whose price equals the headline price
// and read the quantity out of its own name. No per-product special cases.
// Reads only — never alters price, MRP, quantity or inventory.
export function productDisplay(product) {
  if (!product) return null;
  const rawName = String(product.name || '').trim();
  const price = Number(product.price);
  const prettyUnit = String(product.unit || '').trim().replace(/(\d)\s*([a-zA-Z])/, '$1 $2'); // "90g" → "90 g"

  const options = product?.variants?.options;
  const match = Array.isArray(options) ? options.find((o) => Number(o?.price) === price) : null;
  const qty = match ? parseInt(String(match.name || '').match(/(\d+)/)?.[1] ?? '', 10) : NaN;

  if (!Number.isFinite(qty) || qty <= 1 || !prettyUnit) {
    return { name: rawName, title: rawName, packLabel: null, qty: null, unit: prettyUnit || null };
  }
  // Strip a trailing size descriptor ("… 90 g Per Packet") ONLY because we are
  // about to restate it more accurately on the next line.
  const base = rawName.replace(/\s*\d+\s*(kg|gms?|grams?|g|ml|ltr|litres?|liters?|l|pcs?|pieces?)\b.*$/i, '').trim() || rawName;
  const packLabel = `Pack of ${qty} × ${prettyUnit}`;
  return { name: base, title: `${base} — ${packLabel}`, packLabel, qty, unit: prettyUnit };
}

// buildCampaign — validate + build. READ-ONLY. Returns the preview object with
// the exact payloads + launchBlockers; { error } for auth/config problems.
export async function buildCampaign({ slug, adId, token, cfg }, input) {
  // One canonical `act_<digits>` for every Graph path and every displayed
  // endpoint, so the preview shows exactly what the launch will POST.
  const account = normalizeAdAccountId(adId);
  if (!account) return { error: 'no_ad_account' };
  const meta = cfg.meta || {};
  const warnings = [];
  const launchBlockers = [];

  const objDef = OBJECTIVES[String(input.objective || 'traffic')] || OBJECTIVES.traffic;
  if (!objDef.available) launchBlockers.push('That objective is not available yet.');

  // Sales (purchase-optimised) needs a Pixel to optimise toward Purchase events.
  const pixelId = meta.pixelId || cfg.metaPixelId || null;
  if (objDef.usesPixelPurchase && !pixelId) launchBlockers.push('Connect your Meta Pixel to run a Sales (purchase-optimised) campaign — or choose the Website visits goal.');

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

  // Audience controls (smart & simple): location radius, age band, gender. Interests
  // stay broad on purpose — Meta optimises via the Purchase pixel. Clamp everything.
  let radiusKm = Math.floor(Number(input.radiusKm) || 25);
  if (radiusKm < 1) radiusKm = 1; if (radiusKm > 80) radiusKm = 80;          // Meta city-radius max ~80km
  let ageMin = Math.floor(Number(input.ageMin) || 18);
  if (ageMin < 13) ageMin = 13; if (ageMin > 65) ageMin = 65;                // Meta age floor 13
  let ageMax = Math.floor(Number(input.ageMax) || 65);
  if (ageMax > 65) ageMax = 65; if (ageMax < ageMin) ageMax = ageMin;
  const gender = ['women', 'men'].includes(String(input.gender)) ? String(input.gender) : 'all';
  const genders = gender === 'women' ? [2] : gender === 'men' ? [1] : null;  // Meta: 1=male, 2=female; omit = all
  const genderLabel = gender === 'women' ? 'Women' : gender === 'men' ? 'Men' : 'All';

  // Audience strategy. 'auto' = Advantage+ Audience: Meta's AI finds buyers and
  // treats geo/age/gender as limits — the "let PocketLink find buyers" default.
  // 'manual' = only the geo/age/gender we pass. (Interests etc. arrive in Advanced.)
  const audienceStrategy = input.audienceStrategy === 'manual' ? 'manual' : 'auto';
  const strategyLabel = audienceStrategy === 'auto' ? 'PocketLink finds buyers (Advantage+)' : 'Manual audience';

  // Advantage+ audience requires an OPEN upper age limit: Meta rejects the ad
  // set outright if age_max is below 65 (error 100 / subcode 1870189, "the
  // maximum age audience control can't be set to lower than 65"). Its own
  // guidance is that a lower maximum becomes a suggestion rather than a cut-off.
  //
  // Sending the seller's narrower value anyway failed every time, AFTER the
  // campaign had been created — so a perfectly reasonable choice like "25 to 55"
  // could never launch. Widen it here, and say so in plain words, because
  // silently ignoring what the seller asked for is worse than explaining it.
  const ageMaxRequested = ageMax;
  const ageMaxRelaxed = audienceStrategy === 'auto' && ageMax < 65;
  if (ageMaxRelaxed) {
    ageMax = 65;
    warnings.push(`Meta’s Advantage+ audience needs an open upper age limit, so your maximum of ${ageMaxRequested} is used as a guide rather than a hard cut-off. Switch the audience to Manual in Advanced controls to enforce it exactly.`);
  }

  const promote = input.promote === 'product' ? 'product' : 'store';
  const product = promote === 'product' ? (cfg.products || []).find((p) => String(p.id) === String(input.productId)) || null : null;

  // ── Read-only: account currency + min budget + status ──
  const accInfo = await graphGet(account, { fields: 'currency,name,min_daily_budget,account_status,timezone_name', access_token: token });
  if (accInfo?.body?.error?.code === 190 || accInfo?.body?.error?.type === 'OAuthException') return { error: 'reauth' };
  const currency = accInfo.body?.currency || 'INR';
  const minRupees = Number(accInfo.body?.min_daily_budget || 0) ? Math.ceil(Number(accInfo.body.min_daily_budget) / 100) : 0;
  const accountActive = Number(accInfo.body?.account_status) === 1;
  if (!accountActive) launchBlockers.push('Your Meta ad account is not active.');
  if (daily <= 0) launchBlockers.push('Set a daily budget.');
  else if (minRupees && daily < minRupees) launchBlockers.push(`Daily budget must be at least ₹${minRupees} for this ad account.`);

  // ── Read-only: the Facebook Page = ONLY the explicitly selected + still-accessible
  // one. config.meta.pageId is chosen in Settings → Connect Meta and validated
  // server-side by select-page.js; it is the single source of truth for 2C/2D. We
  // never auto-pick from several Pages, and we re-validate the selection live so a
  // revoked/removed Page becomes a hard blocker instead of a wrong-Page launch.
  let page = null;
  const selectedPageId = meta.pageId ? String(meta.pageId) : '';
  if (selectedPageId) {
    const pr = await graphGet(selectedPageId, { fields: 'id,name', access_token: token });
    if (pr?.body?.error?.code === 190 || pr?.body?.error?.type === 'OAuthException') return { error: 'reauth' };
    if (pr.body?.id) page = { id: String(pr.body.id), name: pr.body.name || meta.pageName || 'Facebook Page' };
  }
  if (!page) {
    if (!selectedPageId && Array.isArray(meta.pages) && meta.pages.length > 1) {
      launchBlockers.push('Choose which Facebook Page to advertise from in Settings → Connect Meta.');
    } else if (!selectedPageId) {
      launchBlockers.push('No Facebook Page is connected — add/connect a Page in Meta Business settings, then reconnect Meta.');
    } else {
      launchBlockers.push('Your selected Facebook Page is no longer accessible — reconnect Meta or reselect the Page.');
    }
  }

  // ── Read-only: resolve location dynamically (never hardcoded) ──
  let geo = null; let geoLabel = '';
  const city = String(cfg.city || '').trim();
  const region = String(cfg.state || '').trim();
  if (city) {
    const gr = await graphGet('search', { type: 'adgeolocation', location_types: JSON.stringify(['city']), q: city, access_token: token });
    const hit = (gr.body?.data || [])[0];
    if (hit?.key) { geo = { cities: [{ key: hit.key, radius: radiusKm, distance_unit: 'kilometer' }] }; geoLabel = `${hit.name}${hit.region ? `, ${hit.region}` : ''} · +${radiusKm}km`; }
  }
  if (!geo && region) {
    const gr = await graphGet('search', { type: 'adgeolocation', location_types: JSON.stringify(['region']), q: region, access_token: token });
    const hit = (gr.body?.data || [])[0];
    if (hit?.key) { geo = { regions: [{ key: hit.key }] }; geoLabel = hit.name; warnings.push('Using your state as the ad location — set a city in Settings for tighter targeting.'); }
  }
  if (!geo) launchBlockers.push('Your store has no usable ad location — set your city in Settings → Location.');

  // ── Creative (from real store data) ──
  const defaultLink = (promote === 'product' && product) ? `${APP_ORIGIN}/${slug}/p/${product.id}` : `${APP_ORIGIN}/${slug}`;
  const defaultImage = product?.image || cfg.coverImage || cfg.logo || null;
  // Pack-aware naming, and copy that matches where the ad actually lands: the
  // SHOP_NOW button opens the PocketLink product page (checkout hands off to
  // WhatsApp later), so the creative must not promise a WhatsApp destination.
  const disp = productDisplay(product);
  const shopLine = cfg.tagline || 'Order online from our shop.';

  // ── Test-only creative override ─────────────────────────────────────────────
  // Set ONLY by an explicit server-side call for an authorised backend creation
  // test — e.g. advertising a Page that is not the PocketLink storefront.
  // campaign-launch.js deliberately does NOT forward this field out of request
  // bodies, so no merchant can reach it, and when it is absent every value below
  // is exactly what it was before.
  const ov = (input.testCreative && typeof input.testCreative === 'object') ? input.testCreative : null;
  const link = ov?.link || defaultLink;
  const imageUrl = ov?.imageUrl || defaultImage;
  const ctaType = ov?.ctaType || 'SHOP_NOW';
  const headline = ov?.headline || disp?.title || cfg.businessName || 'Shop with us';
  const primaryText = ov?.primaryText || (disp
    ? `${disp.title}${product.price ? ` — ₹${product.price}` : ''}. ${shopLine}`
    : `${cfg.businessName || 'Our shop'} — ${shopLine}`);
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
    targeting: {
      ...(geo ? { geo_locations: geo } : {}),
      age_min: ageMin, age_max: ageMax, ...(genders ? { genders } : {}),
      ...(audienceStrategy === 'auto' ? { targeting_automation: { advantage_audience: 1 } } : {}),
    },
    start_time: startTime,
    end_time: endTime,
    status: 'PAUSED',
  };
  if (objDef.usesPixelPurchase && pixelId) adset.promoted_object = { pixel_id: String(pixelId), custom_event_type: 'PURCHASE' };

  // spend_cap only when total ≥ Meta's minimum (~$100/₹8,500). Secondary belt,
  // NOT the primary ceiling (lifetime_budget + end_time + our caps are).
  const spendCapEligible = total >= CAPS.spendCapMinRupees;
  const campaignBody = {
    name, objective: objDef.campaignObjective, status: 'PAUSED', special_ad_categories: [],
    // Required by Meta whenever the budget lives on the ad set rather than the
    // campaign (error 100 / subcode 4834011). FALSE on purpose: true lets ad sets
    // share 20% of each other's budget, which would break the per-ad-set lifetime
    // budget that is our actual spend ceiling.
    is_adset_budget_sharing_enabled: false,
  };
  if (spendCapEligible) campaignBody.spend_cap = lifetimeMinor;
  else warnings.push(`Campaign spend-cap not applied (Meta minimum ≈ ₹${CAPS.spendCapMinRupees.toLocaleString('en-IN')}). Total is bounded by the lifetime budget + end date and our server caps.`);

  const payloads = {
    _note: 'Dry-run — Stage 2D POSTs these in order (campaign → adset → adcreative → ad). {{…}} resolve from the previous create. Budgets in paise. All created PAUSED.',
    campaign:   { endpoint: `POST /${account}/campaigns`, body: campaignBody },
    adset:      { endpoint: `POST /${account}/adsets`, body: adset },
    adcreative: {
      endpoint: `POST /${account}/adcreatives`,
      body: {
        name: `${name} · creative`,
        object_story_spec: {
          page_id: page ? page.id : PAGE_PLACEHOLDER,
          link_data: { link, message: primaryText, name: headline, ...(cfg.tagline ? { description: cfg.tagline } : {}), ...(imageUrl ? { picture: imageUrl } : {}), call_to_action: { type: ctaType, value: { link } } },
        },
      },
      placeholders: page ? [] : ['object_story_spec.page_id'],
    },
    ad: { endpoint: `POST /${account}/ads`, body: { name: `${name} · ad`, adset_id: '{{adset_id}}', creative: { creative_id: '{{creative_id}}' }, status: 'PAUSED' } },
  };

  return {
    ok: true, currency, minDailyBudget: minRupees, accountActive, adAccountId: account, timezone: accInfo.body?.timezone_name || null,
    objective: { key: objDef.key, label: objDef.label },
    budget: {
      daily, days, total, currency, lifetimeMinor, spendCapApplied: spendCapEligible, endTime,
      // Say exactly what bounds the spend. At small totals Meta will not accept a
      // campaign spend_cap, so claiming one would be false — the real ceiling is
      // the ad set lifetime budget plus the end date.
      ceilingLabel: `Up to ₹${total.toLocaleString('en-IN')} total`,
      enforcedBy: spendCapEligible
        ? 'ad set lifetime budget + end date, plus a campaign spend cap'
        : `ad set lifetime budget + end date (no campaign spend cap — Meta requires ≈₹${CAPS.spendCapMinRupees.toLocaleString('en-IN')})`,
    },
    creative: {
      imageUrl, headline, primaryText, link, cta: ctaType, ctaType, promote,
      productName: product?.name || null,
      packLabel: disp?.packLabel || null,
      destinationLabel: ov?.link ? link : (promote === 'product' && product ? 'Your PocketLink product page' : 'Your PocketLink shop'),
    },
    // ageMax is what we actually send, so the plan the seller approves is the
    // plan that gets created. ageMaxRequested records what they asked for when
    // Advantage+ forced it open, so the UI can explain the difference.
    targeting: { label: geoLabel, ageMin, ageMax, ageMaxRequested, ageMaxRelaxed, genderLabel, strategy: audienceStrategy, strategyLabel, resolved: !!geo },
    page: page ? { id: page.id, name: page.name } : null,
    warnings, launchBlockers, launchReady: launchBlockers.length === 0,
    payloads, caps: CAPS,
  };
}
