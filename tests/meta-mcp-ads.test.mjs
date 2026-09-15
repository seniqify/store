// MCP executors. Plans come from the real buildCampaign (Graph stubbed, as in
// meta-campaign.test.mjs) and MCP is a recording fake — no Meta call is made and
// no Meta object is created.
import test from 'node:test';
import assert from 'node:assert/strict';

import { buildCampaign } from '../api/meta/_campaignBuild.js';
import { toolClass } from '../api/meta/_mcp.js';
import {
  mcpCreateArgs, pickCreatedId, createPausedViaMcp, readStatusesViaMcp, activateViaMcp, resumeViaMcp,
  pauseViaMcp, budgetFields, updateBudgetViaMcp, updateTargetingViaMcp, uploadMediaViaMcp, assetsViaMcp,
  errorsViaMcp, parseMetaNumber, shapeMcpMetrics, reportViaMcp, accountDigits,
} from '../api/meta/_mcpAds.js';

// ── a real plan from the shared builder ──────────────────────────────────────
const realFetch = globalThis.fetch;
test.afterEach(() => { globalThis.fetch = realFetch; });

const CFG = {
  businessName: 'PocketLink Demo', city: 'Solapur', state: 'Maharashtra', tagline: 'Order online',
  meta: { pageId: '1124874604040958', pageName: 'PocketLink' },
  products: [{ id: 'p1', name: 'Protein Shake 1 kg', price: '1499', unit: '1kg', image: 'https://cdn.example/p1.jpg' }],
};

async function plan(input = {}) {
  globalThis.fetch = async (url) => {
    const u = String(url);
    const body = u.includes('/search?') ? { data: [{ key: '1010461', name: 'Solapur', region: 'Maharashtra' }] }
      : u.includes('1124874604040958') ? { id: '1124874604040958', name: 'PocketLink' }
      : u.includes('act_') ? { currency: 'INR', name: 'PocketLink', min_daily_budget: 9491, account_status: 1, timezone_name: 'Asia/Kolkata' }
      : { data: [] };
    return { ok: true, status: 200, json: async () => body };
  };
  return buildCampaign({ slug: 'showme', adId: 'act_962613363265198', token: 'TEST', cfg: CFG },
    { objective: 'traffic', days: 7, dailyBudget: 300, promote: 'product', productId: 'p1', audienceStrategy: 'auto', ...input });
}

// ── a recording fake session ─────────────────────────────────────────────────
function fakeSession(handlers = {}) {
  const log = [];
  let n = 0;
  return {
    log,
    async call(name, args = {}, opts = {}) {
      assert.ok(toolClass(name), `executor called a tool outside the allowlist: ${name}`);
      if (toolClass(name) === 'spend') assert.equal(opts.allowSpend, true, `${name} without allowSpend`);
      log.push({ name, args, opts });
      const h = handlers[name];
      if (typeof h === 'function') return h(args, ++n);
      if (h) return h;
      return { ok: true, data: {} };
    },
  };
}
const created = (key, id) => ({ ok: true, data: { [key]: id } });

// ── creation arguments ───────────────────────────────────────────────────────
test('create arguments come from the approved plan, with the budget on the campaign', async () => {
  const built = await plan();
  const a = mcpCreateArgs(built);
  assert.equal(a.campaign.ad_account_id, '962613363265198');
  assert.equal(a.campaign.objective, 'OUTCOME_TRAFFIC');
  assert.equal(a.campaign.campaign_lifetime_budget, built.budget.lifetimeMinor);
  assert.equal(a.campaign.campaign_lifetime_budget, 300 * 7 * 100, 'paise');
  assert.equal(a.campaign.campaign_stop_time, built.budget.endTime);
  assert.equal('daily_budget' in a.adSet || 'lifetime_budget' in a.adSet, false, 'no ad set budget under a campaign budget');
  assert.equal(a.adSet.optimization_goal, built.payloads.adset.body.optimization_goal);
  assert.equal(JSON.parse(a.adSet.targeting).targeting_automation.advantage_audience, 1);
  assert.equal(a.creative.page_id, '1124874604040958');
  assert.equal(a.creative.image_url, 'https://cdn.example/p1.jpg');
  assert.equal(a.creative.link_url, built.creative.link);
  assert.equal(a.creative.headline, built.creative.headline);
  assert.equal(a.creative.message, built.creative.primaryText);
  assert.equal(a.creative.call_to_action_type, 'SHOP_NOW');
});

test('a daily budget becomes a campaign daily budget with the same stop time', async () => {
  const built = await plan();
  const a = mcpCreateArgs(built, { budgetType: 'daily' });
  assert.equal(a.campaign.campaign_daily_budget, 30000);
  assert.equal('campaign_lifetime_budget' in a.campaign, false);
  assert.equal(a.campaign.campaign_stop_time, built.budget.endTime);
});

test('no creation argument ever says ACTIVE', async () => {
  const a = mcpCreateArgs(await plan());
  assert.equal(/ACTIVE/.test(JSON.stringify(a)), false);
});

test('an uploaded image and an Instagram account are used when given', async () => {
  const a = mcpCreateArgs(await plan(), { imageHash: 'abc123hash', igUserId: '17841400000000000' });
  assert.equal(a.creative.image_hash, 'abc123hash');
  assert.equal('image_url' in a.creative, false, 'never both');
  assert.equal(a.creative.instagram_user_id, '17841400000000000');
});

test('a plan with blockers, or without a Page, cannot become create arguments', async () => {
  const blocked = await plan({ dailyBudget: 0 });
  assert.equal(blocked.launchReady, false);
  assert.equal(mcpCreateArgs(blocked).error, 'blocked');
  assert.equal(mcpCreateArgs(null).error, 'no_plan');
  const noPage = { ...(await plan()), payloads: { ...(await plan()).payloads, adcreative: { body: { object_story_spec: { page_id: 'PAGE_ID_REQUIRED', link_data: {} } } } } };
  assert.equal(mcpCreateArgs(noPage).error, 'no_page');
});

test('created ids are found wherever the tool puts them', () => {
  assert.equal(pickCreatedId({ campaign_id: '120254893943870188' }, 'campaign'), '120254893943870188');
  assert.equal(pickCreatedId({ id: 42 }, 'ad'), '42');
  assert.equal(pickCreatedId({ ad_set: { id: '77' } }, 'ad_set'), '77');
  assert.equal(pickCreatedId({ campaign_id: 'not-a-number' }, 'campaign'), null);
  assert.equal(pickCreatedId({ image_hash: 'e1f2a3b4c5' }, 'media'), 'e1f2a3b4c5');
  assert.equal(pickCreatedId(null, 'ad'), null);
});

// ── creation flow ────────────────────────────────────────────────────────────
test('creation runs campaign → ad set → creative → ad, chaining ids, and never spends', async () => {
  const s = fakeSession({
    ads_create_campaign: created('campaign_id', '101'),
    ads_create_ad_set: created('ad_set_id', '202'),
    ads_create_creative: created('creative_id', '303'),
    ads_create_ad: created('ad_id', '404'),
  });
  const recorded = [];
  const r = await createPausedViaMcp(s, mcpCreateArgs(await plan()), { onCreated: async (kind, key, id) => recorded.push([key, id]) });
  assert.equal(r.ok, true);
  assert.deepEqual(r.ids, { campaign_id: '101', adset_id: '202', creative_id: '303', ad_id: '404' });
  assert.deepEqual(s.log.map((c) => c.name), ['ads_create_campaign', 'ads_create_ad_set', 'ads_create_creative', 'ads_create_ad']);
  assert.equal(s.log[1].args.campaign_id, '101');
  assert.equal(s.log[3].args.ad_set_id, '202');
  assert.deepEqual(JSON.parse(s.log[3].args.creative), { creative_id: '303' });
  assert.deepEqual(recorded, [['campaign_id', '101'], ['adset_id', '202'], ['creative_id', '303'], ['ad_id', '404']]);
  assert.equal(s.log.some((c) => toolClass(c.name) === 'spend'), false);
});

test('a failure stops at that step and reports exactly what was made', async () => {
  const s = fakeSession({
    ads_create_campaign: created('campaign_id', '101'),
    ads_create_ad_set: { ok: false, error: { code: 'invalid', message: 'Invalid targeting' } },
  });
  const r = await createPausedViaMcp(s, mcpCreateArgs(await plan()));
  assert.equal(r.ok, false);
  assert.equal(r.step, 'ad_set');
  assert.equal(r.uncertain, false);
  assert.deepEqual(r.made, [{ kind: 'campaign', id: '101' }]);
  assert.equal(s.log.length, 2, 'nothing after the failed step');
});

test('a timeout or a reply without an id is flagged uncertain — read back before retrying', async () => {
  const timeout = await createPausedViaMcp(fakeSession({ ads_create_campaign: { ok: false, error: { code: 'unreachable' } } }), mcpCreateArgs(await plan()));
  assert.equal(timeout.uncertain, true);
  const noId = await createPausedViaMcp(fakeSession({ ads_create_campaign: { ok: true, data: { message: 'ok' } } }), mcpCreateArgs(await plan()));
  assert.equal(noId.uncertain, true);
});

test('a resumed launch skips the objects it already has', async () => {
  const s = fakeSession({ ads_create_creative: created('creative_id', '303'), ads_create_ad: created('ad_id', '404') });
  const r = await createPausedViaMcp(s, mcpCreateArgs(await plan()), { existing: { campaign_id: '101', adset_id: '202' } });
  assert.equal(r.ok, true);
  assert.deepEqual(s.log.map((c) => c.name), ['ads_create_creative', 'ads_create_ad']);
  assert.deepEqual(r.made.map((m) => m.kind), ['creative', 'ad']);
});

test('read-back reports paused, drafts and anything active', async () => {
  const s = fakeSession({
    ads_get_ad_entities: (args) => {
      if (args.object_state === 'draft') return { ok: true, data: { ad_drafts: [{ id: args.object_ids[0] }] } };
      if (args.level === 'ad') return { ok: true, data: { ad_entities: [] } };
      return { ok: true, data: { ad_entities: [{ id: args.object_ids[0], status: 'PAUSED', effective_status: 'PAUSED' }] } };
    },
  });
  const r = await readStatusesViaMcp(s, 'act_962613363265198', { campaign_id: '101', adset_id: '202', ad_id: '404' });
  assert.equal(r.statuses.campaign.status, 'PAUSED');
  assert.equal(r.statuses.ad.status, 'DRAFT');
  assert.equal(r.notRunning, true);
  assert.equal(r.anyActive, false);

  const active = await readStatusesViaMcp(fakeSession({ ads_get_ad_entities: (a) => ({ ok: true, data: { ad_entities: [{ id: a.object_ids[0], status: 'ACTIVE' }] } }) }), '1', { campaign_id: '101' });
  assert.equal(active.anyActive, true);
  assert.equal(active.notRunning, false);
});

// ── delivery control ─────────────────────────────────────────────────────────
test('activation goes ad → ad set → campaign, so a failure leaves the campaign paused', async () => {
  const s = fakeSession();
  const r = await activateViaMcp(s, 'act_962613363265198', { campaign_id: '101', adset_id: '202', ad_id: '404' });
  assert.equal(r.ok, true);
  assert.deepEqual(s.log.map((c) => `${c.args.entity_type}:${c.args.entity_id}`), ['ad:404', 'ad_set:202', 'campaign:101']);
  assert.ok(s.log.every((c) => c.opts.allowSpend === true));

  const failing = fakeSession({ ads_activate_entity: (args) => (args.entity_type === 'campaign' ? { ok: false, error: { code: 'invalid' } } : { ok: true, data: {} }) });
  const f = await activateViaMcp(failing, '1', { campaign_id: '101', adset_id: '202', ad_id: '404' });
  assert.equal(f.ok, false);
  assert.equal(f.step, 'campaign');
  assert.deepEqual(f.activated, ['ad', 'ad_set']);
});

test('an incomplete campaign is never activated', async () => {
  const s = fakeSession();
  const r = await activateViaMcp(s, '1', { campaign_id: '101', adset_id: '202' });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'not_created');
  assert.equal(s.log.length, 0);
});

test('pause edits the campaign status and never touches a spend tool', async () => {
  const s = fakeSession();
  const r = await pauseViaMcp(s, 'act_962613363265198', '101');
  assert.equal(r.ok, true);
  assert.equal(s.log.length, 1);
  assert.equal(s.log[0].name, 'ads_update_entity');
  assert.equal(s.log[0].args.entity_type, 'campaign');
  assert.deepEqual(JSON.parse(s.log[0].args.fields), { status: 'PAUSED' });
});

test('an edit Meta staged as a draft is reported as pending, not done', async () => {
  const s = fakeSession({ ads_update_entity: { ok: true, data: { updated_fields: { status: 'PAUSED' }, active_errors: [{ message: 'needs review' }] } } });
  const r = await pauseViaMcp(s, '1', '101');
  assert.equal(r.pending, true);
});

test('resume activates only the campaign', async () => {
  const s = fakeSession();
  await resumeViaMcp(s, '1', '101');
  assert.deepEqual(s.log.map((c) => [c.name, c.args.entity_type]), [['ads_activate_entity', 'campaign']]);
});

test('budgets are paise, positive, and inside PocketLink\'s caps', () => {
  assert.deepEqual(budgetFields({ budgetType: 'daily', amount: 300 }).fields, { daily_budget: 30000 });
  assert.deepEqual(budgetFields({ budgetType: 'lifetime', amount: 2100.5 }).fields, { lifetime_budget: 210050 });
  assert.equal(budgetFields({ budgetType: 'daily', amount: 0 }).error, 'invalid_budget');
  assert.equal(budgetFields({ budgetType: 'daily', amount: -5 }).error, 'invalid_budget');
  assert.equal(budgetFields({ budgetType: 'daily', amount: 5001 }).error, 'over_cap');
  assert.equal(budgetFields({ budgetType: 'lifetime', amount: 25001 }).error, 'over_cap');
  assert.equal(budgetFields({ budgetType: 'weekly', amount: 10 }).error, 'invalid_budget_type');
});

test('an over-cap budget change is refused without calling Meta', async () => {
  const s = fakeSession();
  const r = await updateBudgetViaMcp(s, '1', { entityId: '101', budgetType: 'daily', amount: 99999 });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'over_cap');
  assert.equal(s.log.length, 0);
  const ok = await updateBudgetViaMcp(s, '1', { entityId: '101', budgetType: 'daily', amount: 400 });
  assert.equal(ok.ok, true);
  assert.deepEqual(JSON.parse(s.log[0].args.fields), { daily_budget: 40000 });
});

test('targeting edits go to the ad set', async () => {
  const s = fakeSession();
  await updateTargetingViaMcp(s, '1', '202', { geo_locations: { countries: ['IN'] }, age_min: 25 });
  assert.equal(s.log[0].args.entity_type, 'ad_set');
  assert.deepEqual(JSON.parse(s.log[0].args.fields), { targeting: { geo_locations: { countries: ['IN'] }, age_min: 25 } });
  assert.equal((await updateTargetingViaMcp(s, '1', '202', null)).ok, false);
});

// ── media, assets, diagnostics ───────────────────────────────────────────────
test('media uploads only from public https URLs and returns the image hash', async () => {
  const s = fakeSession({ ads_creative_upload_media: { ok: true, data: { image_hash: 'a1b2c3d4e5f6' } } });
  const r = await uploadMediaViaMcp(s, 'act_962613363265198', { url: 'https://cdn.example/p1.jpg', name: 'Protein' });
  assert.deepEqual([r.ok, r.imageHash], [true, 'a1b2c3d4e5f6']);
  assert.equal(s.log[0].args.upload_source, 'URL');
  assert.equal(s.log[0].args.media_type, 'IMAGE');
  const bad = await uploadMediaViaMcp(s, '1', { url: 'http://insecure.example/x.jpg' });
  assert.equal(bad.ok, false);
  assert.equal(s.log.length, 1);
});

test('assets normalise Meta\'s live shapes', async () => {
  const s = fakeSession({
    ads_catalog_get_businesses: { ok: true, data: { businesses: [{ business_id: '2046280469453502', name: 'Seniqify' }], page_info: { has_next_page: false } } },
    ads_get_user_pages: { ok: true, data: { pages: [{ page_id: '1124874604040958', page_name: 'PocketLink' }] } },
    ads_get_ig_accounts: { ok: true, data: [] },
  });
  const a = await assetsViaMcp(s, 'act_962613363265198');
  assert.deepEqual(a.businesses, [{ id: '2046280469453502', name: 'Seniqify' }]);
  assert.deepEqual(a.pages, [{ id: '1124874604040958', name: 'PocketLink' }]);
  assert.deepEqual(a.instagram, []);
  assert.deepEqual(a.errors, []);
  assert.equal(s.log.find((c) => c.name === 'ads_get_ig_accounts').args.ad_account_id, '962613363265198');
});

test('errors are read for real ids only', async () => {
  const s = fakeSession({ ads_get_errors: { ok: true, data: { errors: [{ entity_id: '101', title: 'Payment method needed', message: 'Add a payment method' }] } } });
  const r = await errorsViaMcp(s, ['101', 'junk']);
  assert.deepEqual(s.log[0].args.entity_ids, ['101']);
  assert.equal(r.errors[0].title, 'Payment method needed');
  assert.deepEqual((await errorsViaMcp(fakeSession(), [])).errors, []);
});

// ── reporting fallback ───────────────────────────────────────────────────────
test('display values parse to numbers, and "Not available" is null', () => {
  assert.equal(parseMetaNumber('₹0.00 INR'), 0);
  assert.equal(parseMetaNumber('₹1,23,456.78 INR'), 123456.78);
  assert.equal(parseMetaNumber('₹१२३.५० INR'), 123.5);
  assert.equal(parseMetaNumber({ indicator: 'actions:link_click', value: 'Not available' }), null);
  assert.equal(parseMetaNumber({ value: 'Not available (लिंक क्लिक)' }), null);
  assert.equal(parseMetaNumber({ value: '12' }), 12);
  assert.equal(parseMetaNumber([{ action_type: 'omni_purchase', value: '3.25' }]), 3.25);
  assert.equal(parseMetaNumber('2.5%'), 2.5);
  assert.equal(parseMetaNumber(7), 7);
  assert.equal(parseMetaNumber(null), null);
  assert.equal(parseMetaNumber(''), null);
});

test('a live MCP metrics row shapes without inventing numbers', () => {
  const live = { id: '120254893943870188', name: 'PocketLink · Protine Hub', effective_status: 'PAUSED', status: 'PAUSED', objective: 'OUTCOME_TRAFFIC', amount_spent: '₹0.00 INR', impressions: null, reach: null, ctr: null, cpc: null, cpm: null, clicks: null, results: { indicator: 'actions:link_click', value: 'Not available' }, purchase_roas: null, cost_per_result: { value: 'Not available (लिंक क्लिक)' } };
  const m = shapeMcpMetrics(live);
  assert.equal(m.spend, 0);
  assert.equal(m.impressions, 0);
  assert.equal(m.cpc, null, 'no clicks → no CPC, not zero');
  assert.equal(m.costPerResult, null);
  assert.equal(m.roas, null);
  assert.equal(m.resultIndicator, 'actions:link_click');
  assert.equal(m.status, 'PAUSED');
});

test('reporting reads account totals and campaigns with verified field names', async () => {
  const s = fakeSession({
    ads_get_ad_entities: (args) => ({ ok: true, data: { ad_entities: args.level === 'ad_account'
      ? [{ id: '962613363265198', amount_spent: '₹450.00 INR', impressions: '12,000', reach: '9,100', clicks: '310', ctr: '2.58%', cpc: '₹1.45 INR', cpm: '₹37.50 INR', results: { value: '120' }, purchase_roas: null }]
      : [{ id: '101', name: 'A', status: 'ACTIVE', amount_spent: '₹450.00 INR', results: { value: '120' }, cost_per_result: { value: '₹3.75 INR' } }] } }),
  });
  const r = await reportViaMcp(s, 'act_962613363265198', { datePreset: 'last_7d' });
  assert.equal(r.ok, true);
  assert.deepEqual([r.totals.spend, r.totals.impressions, r.totals.reach, r.totals.clicks, r.totals.ctr, r.totals.cpc, r.totals.cpm, r.totals.results], [450, 12000, 9100, 310, 2.58, 1.45, 37.5, 120]);
  assert.equal(r.campaigns[0].costPerResult, 3.75);
  const fields = s.log.find((c) => c.args.level === 'campaign').args.fields;
  for (const f of ['amount_spent', 'impressions', 'reach', 'ctr', 'cpc', 'cpm', 'results', 'cost_per_result', 'purchase_roas', 'effective_status']) assert.ok(fields.includes(f), f);
  assert.equal(s.log.find((c) => c.args.level === 'ad_account').args.fields.includes('cost_per_result'), false, 'not valid at account level');
});

test('account ids lose exactly one act_ prefix', () => {
  assert.equal(accountDigits('act_962613363265198'), '962613363265198');
  assert.equal(accountDigits('962613363265198'), '962613363265198');
  assert.equal(accountDigits('act_act_5'), '5');
  assert.equal(accountDigits('junk'), '');
});
