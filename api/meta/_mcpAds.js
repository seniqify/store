// Meta ads through the MCP server — server-only executors.
//
// Every function takes an open session from _mcp.js (openMcpSession), so the
// token handling, allowlist and error mapping live in one place. Nothing here
// decides WHETHER an action is allowed — the route checks the PIN, the pilot
// gate, the WhatsApp step-up and the engine first. These functions only carry
// out a decision that has already been made.
//
// Safety properties the tests pin:
//   • creation arguments come from buildCampaign — the same builder the preview
//     renders — so what the merchant approved is exactly what gets created
//   • creation never calls a spend tool; Meta creates every object PAUSED
//   • activation runs ad → ad set → campaign, so if any step fails the campaign
//     is still paused and nothing delivers
//   • budgets are integers in the account currency's minor unit (paise)
import { normalizeAdAccountId } from './_meta.js';
import { CAPS } from './_campaignBuild.js';

/** Numeric ad account id without the act_ prefix, as the MCP tools expect. */
export function accountDigits(adAccount) {
  return String(normalizeAdAccountId(adAccount) || '').replace(/^act_/, '');
}

const rows = (v) => (Array.isArray(v) ? v : []);

// ── Creation ─────────────────────────────────────────────────────────────────

/**
 * The four MCP create calls for a plan returned by buildCampaign.
 * Budget sits on the campaign (Meta's recommended campaign budget), with a stop
 * time, so the total stays bounded:
 *   lifetime → campaign_lifetime_budget + campaign_stop_time
 *   daily    → campaign_daily_budget    + campaign_stop_time
 * A campaign spend cap is added when the builder applied one.
 * → { campaign, adSet, creative, ad }  or  { error }
 */
export function mcpCreateArgs(built, { budgetType = 'lifetime', igUserId = null, imageHash = null } = {}) {
  if (!built || built.error) return { error: built?.error || 'no_plan' };
  if (!built.launchReady) return { error: 'blocked' };
  const account = accountDigits(built.adAccountId);
  if (!account) return { error: 'no_ad_account' };

  const P = built.payloads || {};
  const camp = P.campaign?.body || {};
  const adset = P.adset?.body || {};
  const story = P.adcreative?.body?.object_story_spec || {};
  const link = story.link_data || {};
  const budget = built.budget || {};

  const daily = budgetType === 'daily';
  const dailyMinor = Math.round(Number(budget.daily || 0) * 100);
  const lifetimeMinor = Math.round(Number(budget.lifetimeMinor || 0));
  if (daily ? !(dailyMinor > 0) : !(lifetimeMinor > 0)) return { error: 'no_budget' };
  const stopTime = budget.endTime || adset.end_time;
  if (!stopTime) return { error: 'no_end_date' };
  if (!story.page_id || !/^\d+$/.test(String(story.page_id))) return { error: 'no_page' };

  const campaign = {
    ad_account_id: account,
    campaign_name: camp.name,
    objective: camp.objective,
    buying_type: 'AUCTION',
    special_ad_categories: JSON.stringify(camp.special_ad_categories || []),
    campaign_bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
    ...(daily ? { campaign_daily_budget: dailyMinor } : { campaign_lifetime_budget: lifetimeMinor }),
    campaign_stop_time: stopTime,
    ...(camp.spend_cap ? { campaign_spend_cap: Math.round(Number(camp.spend_cap)) } : {}),
  };

  // No budget on the ad set: Meta rejects an ad set budget under a campaign budget.
  const adSet = {
    ad_account_id: account,
    ad_set_name: adset.name,
    billing_event: adset.billing_event,
    optimization_goal: adset.optimization_goal,
    targeting: JSON.stringify(adset.targeting || {}),
    destination_type: adset.destination_type || 'WEBSITE',
    ...(adset.start_time ? { start_time: adset.start_time } : {}),
    end_time: adset.end_time || stopTime,
    ...(adset.promoted_object ? { promoted_object: JSON.stringify(adset.promoted_object) } : {}),
  };

  const creative = {
    ad_account_id: account,
    page_id: String(story.page_id),
    name: P.adcreative?.body?.name,
    link_url: link.link,
    message: link.message,
    headline: link.name,
    ...(link.description ? { description: link.description } : {}),
    call_to_action_type: link.call_to_action?.type || 'SHOP_NOW',
    ...(imageHash ? { image_hash: String(imageHash) } : link.picture ? { image_url: link.picture } : {}),
    ...(igUserId ? { instagram_user_id: String(igUserId) } : {}),
  };

  const ad = { ad_account_id: account, ad_name: P.ad?.body?.name };
  return { campaign, adSet, creative, ad };
}

const ID_KEYS = {
  campaign: ['campaign_id', 'id'],
  ad_set: ['ad_set_id', 'adset_id', 'id'],
  creative: ['creative_id', 'id'],
  ad: ['ad_id', 'id'],
  media: ['image_hash', 'hash', 'video_id', 'id'],
};

/** The id Meta returned for a created object, wherever the tool put it. */
export function pickCreatedId(data, kind, depth = 0) {
  if (!data || typeof data !== 'object' || depth > 3) return null;
  for (const k of ID_KEYS[kind] || ['id']) {
    const v = data[k];
    if (v == null) continue;
    const s = String(v);
    if (kind === 'media' ? /^[A-Za-z0-9_-]{6,}$/.test(s) : /^\d+$/.test(s)) return s;
  }
  const nested = data[kind] || data[kind === 'ad_set' ? 'adset' : kind] || data.result || data.data;
  return nested && typeof nested === 'object' && nested !== data ? pickCreatedId(nested, kind, depth + 1) : null;
}

/**
 * Create campaign → ad set → creative → ad through MCP.
 * `existing` resumes a launch that already has some ids; those steps are skipped.
 * `onCreated(kind, key, id)` is awaited after each create so the ledger records
 * the id before the next call.
 * → { ok: true, ids, made }
 * → { ok: false, step, error, uncertain, ids, made, detail }
 *   uncertain = Meta may have created the object even though we got no id back
 *   (timeout, or a reply without an id). Read back before retrying.
 * MCP has no delete tool for campaigns, ad sets or ads; cleaning up `made`
 * after a failure is the caller's job (Marketing API) when it has permission.
 */
export async function createPausedViaMcp(session, args, { existing = {}, onCreated = async () => {}, request = '' } = {}) {
  const ids = {
    campaign_id: existing.campaign_id || null,
    adset_id: existing.adset_id || null,
    creative_id: existing.creative_id || null,
    ad_id: existing.ad_id || null,
  };
  const made = [];
  const steps = [
    ['campaign', 'campaign_id', 'ads_create_campaign', () => args.campaign],
    ['ad_set', 'adset_id', 'ads_create_ad_set', () => ({ ...args.adSet, campaign_id: ids.campaign_id })],
    ['creative', 'creative_id', 'ads_create_creative', () => args.creative],
    ['ad', 'ad_id', 'ads_create_ad', () => ({ ...args.ad, ad_set_id: ids.adset_id, creative: JSON.stringify({ creative_id: ids.creative_id }) })],
  ];
  for (const [kind, key, tool, build] of steps) {
    if (ids[key]) continue;
    const r = await session.call(tool, build(), { request });
    if (!r.ok) {
      return { ok: false, step: kind, error: r.error, uncertain: r.error?.code === 'unreachable', ids, made, detail: r.data ?? null };
    }
    const id = pickCreatedId(r.data, kind);
    if (!id) {
      return { ok: false, step: kind, error: { code: 'meta_error', message: 'Meta did not return an id.' }, uncertain: true, ids, made, detail: r.data ?? null };
    }
    ids[key] = id;
    made.push({ kind, id });
    await onCreated(kind, key, id);
  }
  return { ok: true, ids, made };
}

/**
 * Read back what Meta holds for each created object.
 * Objects MCP staged as an Ads Manager draft (not yet published) report
 * status 'DRAFT' — they cannot deliver either.
 * → { statuses: { campaign, adset, ad }, notRunning, anyActive }
 */
export async function readStatusesViaMcp(session, adAccount, ids) {
  const account = accountDigits(adAccount);
  const levels = [['campaign', ids?.campaign_id], ['adset', ids?.adset_id], ['ad', ids?.ad_id]].filter(([, id]) => id);
  const statuses = {};
  for (const [level, id] of levels) {
    const live = await session.call('ads_get_ad_entities', {
      ad_account_id: account, level, object_ids: [String(id)], fields: ['id', 'name', 'status', 'effective_status'],
    });
    const row = live.ok ? rows(live.data?.ad_entities).find((x) => String(x?.id) === String(id)) : null;
    if (row) {
      statuses[level] = { status: row.status || null, effectiveStatus: row.effective_status || null, published: true };
      continue;
    }
    const draft = await session.call('ads_get_ad_entities', {
      ad_account_id: account, level, object_ids: [String(id)], object_state: 'draft',
    });
    statuses[level] = draft.ok && rows(draft.data?.ad_drafts).length
      ? { status: 'DRAFT', effectiveStatus: null, published: false }
      : { error: live.ok ? 'not_found' : (live.error?.code || 'read_failed') };
  }
  const read = Object.values(statuses);
  return {
    statuses,
    notRunning: levels.length > 0 && read.every((s) => s.status === 'PAUSED' || s.status === 'DRAFT'),
    anyActive: read.some((s) => s.status === 'ACTIVE'),
  };
}

// ── Delivery control ─────────────────────────────────────────────────────────

/**
 * Start delivery. Children first, campaign last: until the campaign itself is
 * active nothing spends, so a failure part-way leaves the campaign paused.
 * The caller must already have passed every activation gate.
 */
export async function activateViaMcp(session, adAccount, ids, { request = '' } = {}) {
  const account = accountDigits(adAccount);
  const order = [['ad', ids?.ad_id], ['ad_set', ids?.adset_id], ['campaign', ids?.campaign_id]];
  if (order.some(([, id]) => !id)) return { ok: false, error: { code: 'not_created', message: 'The campaign is incomplete.' }, activated: [] };
  const activated = [];
  for (const [entity_type, entity_id] of order) {
    const r = await session.call('ads_activate_entity', { ad_account_id: account, entity_id: String(entity_id), entity_type }, { allowSpend: true, request });
    if (!r.ok) return { ok: false, step: entity_type, error: r.error, activated };
    activated.push(entity_type);
  }
  return { ok: true, activated };
}

/** Resume a paused campaign (its ad set and ad stayed active). Spends. */
export async function resumeViaMcp(session, adAccount, campaignId, { request = '' } = {}) {
  if (!campaignId) return { ok: false, error: { code: 'not_created', message: 'No campaign.' } };
  const r = await session.call('ads_activate_entity', {
    ad_account_id: accountDigits(adAccount), entity_id: String(campaignId), entity_type: 'campaign',
  }, { allowSpend: true, request });
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}

// ads_update_entity: when Meta returns active_errors the edit went into a draft
// and is not live yet — report it as pending rather than done.
async function updateEntity(session, adAccount, entityType, entityId, fields, request) {
  if (!entityId) return { ok: false, error: { code: 'not_created', message: 'Nothing to update.' } };
  const r = await session.call('ads_update_entity', {
    ad_account_id: accountDigits(adAccount), entity_id: String(entityId), entity_type: entityType, fields: JSON.stringify(fields),
  }, { request });
  if (!r.ok) return { ok: false, error: r.error };
  const pendingErrors = rows(r.data?.active_errors);
  return { ok: true, pending: pendingErrors.length > 0, pendingErrors };
}

/** Pause a campaign. Only ever reduces delivery. */
export function pauseViaMcp(session, adAccount, campaignId, { request = '' } = {}) {
  return updateEntity(session, adAccount, 'campaign', campaignId, { status: 'PAUSED' }, request);
}

/**
 * Budget update fields in minor units, refusing anything outside PocketLink's
 * server caps. → { fields } or { error }
 */
export function budgetFields({ budgetType, amount }) {
  const rupees = Number(amount);
  if (!Number.isFinite(rupees) || rupees <= 0) return { error: 'invalid_budget' };
  if (budgetType === 'daily') {
    if (rupees > CAPS.maxDaily) return { error: 'over_cap', cap: CAPS.maxDaily };
    return { fields: { daily_budget: Math.round(rupees * 100) } };
  }
  if (budgetType === 'lifetime') {
    if (rupees > CAPS.maxTotal) return { error: 'over_cap', cap: CAPS.maxTotal };
    return { fields: { lifetime_budget: Math.round(rupees * 100) } };
  }
  return { error: 'invalid_budget_type' };
}

/** Change a campaign's (or ad set's) budget. */
export function updateBudgetViaMcp(session, adAccount, { entityType = 'campaign', entityId, budgetType, amount }, { request = '' } = {}) {
  const b = budgetFields({ budgetType, amount });
  if (b.error) return Promise.resolve({ ok: false, error: { code: b.error, message: b.cap ? `Cap ₹${b.cap}` : b.error } });
  return updateEntity(session, adAccount, entityType === 'ad_set' ? 'ad_set' : 'campaign', entityId, b.fields, request);
}

/** Replace an ad set's targeting (already validated by the caller). */
export function updateTargetingViaMcp(session, adAccount, adSetId, targeting, { request = '' } = {}) {
  if (!targeting || typeof targeting !== 'object') return Promise.resolve({ ok: false, error: { code: 'invalid', message: 'No targeting.' } });
  return updateEntity(session, adAccount, 'ad_set', adSetId, { targeting }, request);
}

// ── Media, assets, diagnostics ───────────────────────────────────────────────

/** Upload an image or video from a public URL into the ad account's library. */
export async function uploadMediaViaMcp(session, adAccount, { url, type = 'IMAGE', name = '' }, { request = '' } = {}) {
  if (!/^https:\/\//i.test(String(url || ''))) return { ok: false, error: { code: 'invalid', message: 'Media must be a public https URL.' } };
  const mediaType = String(type).toUpperCase() === 'VIDEO' ? 'VIDEO' : 'IMAGE';
  const r = await session.call('ads_creative_upload_media', {
    ad_account_id: accountDigits(adAccount), upload_source: 'URL', media_type: mediaType, media_url: String(url), ...(name ? { name: String(name).slice(0, 100) } : {}),
  }, { request });
  if (!r.ok) return { ok: false, error: r.error };
  const d = r.data || {};
  return mediaType === 'VIDEO'
    ? { ok: true, type: 'VIDEO', videoId: pickCreatedId({ id: d.video_id ?? d.id }, 'media') }
    : { ok: true, type: 'IMAGE', imageHash: pickCreatedId({ id: d.image_hash ?? d.hash ?? d.images?.[0]?.hash }, 'media') };
}

/** Businesses, Facebook Pages and Instagram accounts the merchant can advertise with. */
export async function assetsViaMcp(session, adAccount) {
  const [biz, pages, ig] = await Promise.all([
    session.call('ads_catalog_get_businesses', { limit: 50 }),
    session.call('ads_get_user_pages', { limit: 50 }),
    adAccount ? session.call('ads_get_ig_accounts', { ad_account_id: accountDigits(adAccount) }) : Promise.resolve({ ok: true, data: [] }),
  ]);
  const igRows = Array.isArray(ig.data) ? ig.data : rows(ig.data?.ig_accounts || ig.data?.instagram_accounts || ig.data?.accounts);
  return {
    businesses: rows(biz.data?.businesses).map((b) => ({ id: String(b.business_id ?? b.id ?? ''), name: b.name || b.business_name || '' })).filter((b) => /^\d+$/.test(b.id)),
    pages: rows(pages.data?.pages).map((p) => ({ id: String(p.page_id ?? p.id ?? ''), name: p.page_name || p.name || '' })).filter((p) => /^\d+$/.test(p.id)),
    instagram: igRows.map((a) => ({ id: String(a.id ?? a.ig_account_id ?? a.instagram_account_id ?? ''), username: a.username || a.name || '' })).filter((a) => /^\d+$/.test(a.id)),
    errors: [biz, pages, ig].filter((r) => !r.ok).map((r) => r.error?.code || 'meta_error'),
  };
}

/** Delivery-blocking errors for the given campaign / ad set / ad ids. */
export async function errorsViaMcp(session, entityIds = []) {
  const ids = entityIds.map(String).filter((id) => /^\d+$/.test(id));
  if (!ids.length) return { ok: true, errors: [] };
  const r = await session.call('ads_get_errors', { entity_ids: ids });
  if (!r.ok) return { ok: false, error: r.error, errors: [] };
  return {
    ok: true,
    errors: rows(r.data?.errors).map((e) => ({
      entityId: e.entity_id ? String(e.entity_id) : null,
      title: e.title || e.error_title || e.summary || 'Delivery issue',
      message: e.message || e.description || e.error_message || '',
    })),
  };
}

// ── Reporting (fallback only) ────────────────────────────────────────────────
// MCP returns metrics as formatted, localised display text — "₹1,234.56 INR",
// {"value":"Not available (लिंक क्लिक)"} — not numbers. The Marketing API stays
// the source of numbers for the dashboard; this parser serves the fallback
// when only MCP can read an account.

const DEVANAGARI_DIGITS = '०१२३४५६७८९';

/** A number from Meta's display value, or null when there is none. */
export function parseMetaNumber(value) {
  if (value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) return value.length ? parseMetaNumber(value[0]?.value ?? value[0]) : null;
  if (typeof value === 'object') return parseMetaNumber(value.value ?? null);
  const s = String(value).replace(/[०-९]/g, (d) => String(DEVANAGARI_DIGITS.indexOf(d)));
  if (/not available|n\/a/i.test(s)) return null;
  const m = s.replace(/[\s,]/g, '').match(/-?\d+(?:\.\d+)?/);   // \s includes the non-breaking space Meta uses
  return m ? Number(m[0]) : null;
}

/** One MCP metrics row → the dashboard's shape (null where Meta has nothing). */
export function shapeMcpMetrics(row) {
  const n = (v) => parseMetaNumber(v);
  return {
    id: row?.id ? String(row.id) : null,
    name: row?.name || '',
    status: row?.status || null,
    effectiveStatus: row?.effective_status || null,
    objective: row?.objective || null,
    spend: n(row?.amount_spent) ?? 0,
    impressions: n(row?.impressions) ?? 0,
    reach: n(row?.reach) ?? 0,
    clicks: n(row?.clicks) ?? 0,
    ctr: n(row?.ctr),
    cpc: n(row?.cpc),
    cpm: n(row?.cpm),
    results: n(row?.results) ?? 0,
    resultIndicator: row?.results?.indicator || null,
    costPerResult: n(row?.cost_per_result),
    roas: n(row?.purchase_roas),
    dailyBudget: n(row?.daily_budget),
    lifetimeBudget: n(row?.lifetime_budget),
  };
}

const METRIC_FIELDS = ['id', 'name', 'amount_spent', 'impressions', 'reach', 'clicks', 'ctr', 'cpc', 'cpm', 'results', 'purchase_roas'];

/** Account totals + campaigns for a date preset, via MCP. */
export async function reportViaMcp(session, adAccount, { datePreset = 'last_7d' } = {}) {
  const account = accountDigits(adAccount);
  const [acc, camps] = await Promise.all([
    session.call('ads_get_ad_entities', { ad_account_id: account, level: 'ad_account', date_preset: datePreset, fields: METRIC_FIELDS }),
    session.call('ads_get_ad_entities', {
      ad_account_id: account, level: 'campaign', date_preset: datePreset, limit: 25,
      fields: [...METRIC_FIELDS, 'cost_per_result', 'effective_status', 'status', 'objective', 'daily_budget', 'lifetime_budget'],
    }),
  ]);
  if (!acc.ok) return { ok: false, error: acc.error };
  return {
    ok: true,
    totals: shapeMcpMetrics(rows(acc.data?.ad_entities)[0] || {}),
    campaigns: camps.ok ? rows(camps.data?.ad_entities).map(shapeMcpMetrics) : [],
    campaignsError: camps.ok ? null : camps.error,
  };
}
