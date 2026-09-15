// campaign-launch routed through Meta's automation server or the Marketing API.
// Supabase (ledger, OTP, audit), Graph and the automation server are all faked
// at globalThis.fetch. No network; no Meta object is created; nothing spends.
import test from 'node:test';
import assert from 'node:assert/strict';
import launchHandler, { raisesBudget, publicLaunch, refreshedEnd } from '../api/meta/campaign-launch.js';

const realFetch = globalThis.fetch;
const ENV = ['SUPABASE_SERVICE_ROLE_KEY', 'META_ADS_PILOT_SLUGS', 'META_ADS_MERCHANT_WRITES', 'META_PAUSED_ONLY', 'META_ALLOWED_SLUGS'];
test.beforeEach(() => { process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key-for-tests'; });
test.afterEach(() => { globalThis.fetch = realFetch; for (const k of ENV) delete process.env[k]; });

const AUTOMATION = ['ads_mcp_management', 'ads_management', 'ads_read', 'business_management', 'pages_show_list'];
const STANDARD = ['ads_management', 'ads_read', 'business_management', 'pages_show_list'];
const CONFIG = {
  businessName: 'Protine Hub', city: 'Solapur', state: 'Maharashtra', tagline: 'Order online', whatsappNumber: '9876543210',
  meta: { connected: true, pageId: '1124874604040958', pageName: 'PocketLink', igId: null, pages: [{ id: '1124874604040958', name: 'PocketLink' }] },
  products: [{ id: 'p1', name: 'Whey Protein 1 kg', price: '1499', unit: '1kg', image: 'https://cdn.example/whey.jpg' }],
};

function world({
  slug = 'showme', scopes = AUTOMATION, automation = true, mcpInit = 200, mcpFail = {}, launches = [],
  otp = null, entityStatus = 'PAUSED', graphFail = {}, deleteSticks = true, mcpFailCategory = 'VALIDATION',
} = {}) {
  const log = { tools: [], graphPosts: [], graphDeletes: [], deleted: new Set(), ledger: new Map(launches.map((r) => [r.launch_id, { ...r }])), audits: [], otpDeleted: false };
  const acct = {
    store_slug: slug, status: 'connected', access_token: 'STORE-TOKEN', expires_at: new Date(Date.now() + 40 * 86400000).toISOString(),
    ad_account_ids: ['act_962613363265198'], selected_ad_account_id: 'act_962613363265198', scopes,
    ad_accounts: [{ id: 'act_962613363265198', name: 'PocketLink', automation: automation ? 'available' : 'unavailable', queryable: true }],
    mcp_checked_at: new Date().toISOString(), mcp_error: null, token_status: 'valid',
  };
  let graphId = 9000;

  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    const method = (init.method || 'GET').toUpperCase();
    const body = init.body ? JSON.parse(init.body) : null;
    const reply = (b, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'sess' }, json: async () => b, text: async () => (b == null ? '' : JSON.stringify(b)) });

    // Meta's automation server
    if (u.startsWith('https://mcp.facebook.com')) {
      if (body.method === 'initialize') return mcpInit === 200 ? reply({ jsonrpc: '2.0', id: body.id, result: { protocolVersion: '2025-06-18' } }) : reply({ title: 'restricted' }, mcpInit);
      if (body.method === 'notifications/initialized') return reply(null, 202);
      const { name, arguments: args } = body.params;
      log.tools.push({ name, args });
      const ok = (data) => reply({ jsonrpc: '2.0', id: body.id, result: { content: [{ type: 'text', text: JSON.stringify(data) }] } });
      // The failure shape in Meta's tool output schema: error_category / error_message / error_subcode.
      if (mcpFail[name]) {
        const validation = mcpFailCategory === 'VALIDATION';
        return reply({ jsonrpc: '2.0', id: body.id, result: { isError: true, content: [{ type: 'text', text: JSON.stringify({ error_category: mcpFailCategory, error_message: mcpFail[name], ...(validation ? { error_subcode: '1885272' } : {}), is_retryable: mcpFailCategory === 'TRANSIENT' }) }] } });
      }
      if (name === 'ads_create_campaign') return ok({ campaign_id: '101' });
      if (name === 'ads_create_ad_set') return ok({ ad_set_id: '202' });
      if (name === 'ads_create_creative') return ok({ creative_id: '303' });
      if (name === 'ads_create_ad') return ok({ ad_id: '404' });
      if (name === 'ads_get_ad_entities') return ok({ ad_entities: [{ id: args.object_ids?.[0], status: entityStatus, effective_status: entityStatus }] });
      if (name === 'ads_creative_upload_media') return ok({ image_hash: 'hash0123456789' });
      if (name === 'ads_get_errors') return ok({ errors: [{ entity_id: '404', title: 'Ad rejected', message: 'Text policy' }] });
      return ok({ success: true });
    }

    // Supabase
    if (u.includes('/rpc/verify_store_pin')) return reply(true);
    if (u.includes('/auth/v1/user')) return reply({}, 401);
    if (u.includes('/rpc/meta_campaign_claim')) {
      const existing = log.ledger.get(body.p_launch_id);
      if (existing && ['created', 'active', 'paused', 'stopped'].includes(existing.status)) return reply('already_created');
      log.ledger.set(body.p_launch_id, { ...(existing || {}), launch_id: body.p_launch_id, store_slug: body.p_store_slug, status: 'creating', config: body.p_config });
      return reply('claimed');
    }
    if (u.includes('/rpc/meta_campaign_set')) {
      const row = log.ledger.get(body.p_launch_id);
      if (row) for (const [k, v] of Object.entries(body.p_patch)) row[k] = v;
      return reply(null);
    }
    if (u.includes('/rest/v1/meta_campaigns')) {
      const m = u.match(/launch_id=eq\.([^&]+)/);
      if (m) { const row = log.ledger.get(decodeURIComponent(m[1])); return reply(row ? [row] : []); }
      return reply([...log.ledger.values()].filter((r) => r.campaign_id));
    }
    if (u.includes('/rest/v1/meta_ad_actions')) { log.audits.push(body); return reply(null, 201); }
    if (u.includes('/rest/v1/store_meta_accounts')) return method === 'GET' ? reply([acct]) : reply(null, 204);
    if (u.includes('/rest/v1/stores')) return reply([{ config: CONFIG }]);
    if (u.includes('/rest/v1/otp_codes')) {
      if (method === 'DELETE') { log.otpDeleted = true; return reply(null, 204); }
      return reply(otp && u.includes(`code=eq.${otp}`) ? [{ id: 1, phone: '919876543210' }] : []);
    }
    if (u.includes('/rest/v1/')) return reply([]);

    // Graph
    if (u.includes('/me/permissions')) return reply({ data: scopes.map((p) => ({ permission: p, status: 'granted' })) });
    if (u.includes('/me/businesses')) return reply({ data: [] });
    if (u.includes('/search?')) return reply({ data: [{ key: '1010461', name: 'Solapur', region: 'Maharashtra' }] });
    if (method === 'DELETE' && u.startsWith('https://graph.facebook.com')) {
      const id = u.match(/\/v\d+\.\d+\/(\d+)\?/)?.[1];
      log.graphDeletes.push(id);
      if (deleteSticks) log.deleted.add(id);
      return reply({ success: true });
    }
    if (method === 'POST' && u.startsWith('https://graph.facebook.com')) {
      log.graphPosts.push({ url: u, body });
      const path = u.replace(/^https:\/\/graph\.facebook\.com\/v\d+\.\d+\//, '');
      if (graphFail[path]) return reply({ error: { message: graphFail[path] } }, 400);
      if (/\/(campaigns|adsets|adcreatives|ads)$/.test(path)) return reply({ id: String(++graphId) });
      return reply({ success: true });
    }
    if (u.includes('/act_962613363265198?')) return reply({ currency: 'INR', name: 'PocketLink', min_daily_budget: 9491, account_status: 1, timezone_name: 'Asia/Kolkata' });
    if (u.includes('/1124874604040958?')) return reply({ id: '1124874604040958', name: 'PocketLink' });
    const readId = u.match(/\/v\d+\.\d+\/(\d+)\?/)?.[1];
    if (readId && log.deleted.has(readId)) return reply({ error: { code: 100, error_subcode: 33, message: 'Unsupported get request.' } }, 400);
    if (u.startsWith('https://graph.facebook.com')) return reply({ status: 'PAUSED', effective_status: 'PAUSED' });
    return reply({});
  };
  return log;
}

function res() {
  const r = { statusCode: 200, body: null };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
}
const call = async (body) => { const r = res(); await launchHandler({ method: 'POST', body: { hashedPin: 'h', ...body }, headers: {} }, r); return r; };
const CREATE = { action: 'create', slug: 'showme', launchId: '11111111-1111-1111-1111-111111111111', objective: 'traffic', promote: 'product', productId: 'p1', dailyBudget: 300, days: 7, audienceStrategy: 'auto' };
const MCP_ROW = (over = {}) => ({
  launch_id: '22222222-2222-2222-2222-222222222222', store_slug: 'showme', status: 'created', engine: 'mcp', budget_type: 'daily',
  campaign_id: '101', adset_id: '202', creative_id: '303', ad_id: '404', daily_budget: 300, lifetime_minor: 210000, objective: 'traffic',
  config: { adAccountId: 'act_962613363265198', product: 'Whey Protein 1 kg', creative: { headline: 'Whey' } }, ...over,
});

// ── production gate ──────────────────────────────────────────────────────────
test('a non-pilot store cannot create, and nothing reaches Meta', async () => {
  const log = world({ slug: 'royalfoodsmasale' });
  const r = await call({ ...CREATE, slug: 'royalfoodsmasale' });
  assert.equal(r.statusCode, 403);
  assert.equal(r.body.error, 'writes_disabled');
  assert.equal(log.tools.length + log.graphPosts.length, 0);
});

test('turning merchant writes on opens creation to every store', async () => {
  process.env.META_ADS_MERCHANT_WRITES = 'on';
  world({ slug: 'royalfoodsmasale' });
  const r = await call({ ...CREATE, slug: 'royalfoodsmasale' });
  assert.equal(r.body.error, undefined);
  assert.equal(r.body.ok, true);
});

// ── creation ─────────────────────────────────────────────────────────────────
test('automation: creates campaign → ad set → creative → ad paused, never activates, reads back', async () => {
  const log = world();
  const r = await call(CREATE);
  assert.equal(r.body.ok, true, JSON.stringify(r.body));
  assert.equal(r.body.mode, 'automated');
  assert.deepEqual(r.body.ids, { campaign_id: '101', adset_id: '202', creative_id: '303', ad_id: '404' });
  const creates = log.tools.map((t) => t.name).filter((n) => n.startsWith('ads_create_'));
  assert.deepEqual(creates, ['ads_create_campaign', 'ads_create_ad_set', 'ads_create_creative', 'ads_create_ad']);
  assert.equal(log.tools.some((t) => t.name === 'ads_activate_entity'), false);
  assert.ok(log.tools.some((t) => t.name === 'ads_get_ad_entities'), 'read back');
  assert.equal(log.graphPosts.length, 0);
  assert.equal(r.body.verified.allPaused, true);
  const row = log.ledger.get(CREATE.launchId);
  assert.deepEqual([row.status, row.engine, row.budget_type, row.campaign_id, row.ad_id], ['created', 'mcp', 'lifetime', '101', '404']);
  assert.equal(row.config.adAccountId, 'act_962613363265198');
  assert.equal(/mcp/i.test(JSON.stringify(r.body)), false, 'no protocol name reaches the browser');
  assert.ok(log.audits.some((a) => a.action === 'create' && a.ok === true && a.engine === 'mcp'));
});

test('automation: a daily budget becomes a campaign daily budget', async () => {
  const log = world();
  const r = await call({ ...CREATE, budgetType: 'daily' });
  assert.equal(r.body.ok, true);
  const camp = log.tools.find((t) => t.name === 'ads_create_campaign').args;
  assert.equal(camp.campaign_daily_budget, 30000);
  assert.equal(log.ledger.get(CREATE.launchId).budget_type, 'daily');
});

test('automation: if Meta reports something running after creation, it is paused at once', async () => {
  const log = world({ entityStatus: 'ACTIVE' });
  const r = await call(CREATE);
  assert.equal(r.body.verified.pausedAfterCheck, true);
  const pause = log.tools.find((t) => t.name === 'ads_update_entity');
  assert.deepEqual(JSON.parse(pause.args.fields), { status: 'PAUSED' });
});

test('standard: a store without the automation permission creates through the Marketing API', async () => {
  const log = world({ scopes: STANDARD });
  const r = await call(CREATE);
  assert.equal(r.body.ok, true, JSON.stringify(r.body));
  assert.equal(r.body.mode, 'standard');
  assert.equal(log.tools.length, 0);
  assert.deepEqual(log.graphPosts.map((p) => p.url.split('/').pop()), ['campaigns', 'adsets', 'adcreatives', 'ads']);
  assert.ok(log.graphPosts.every((p) => p.body.status !== 'ACTIVE'));
});

test('standard: an ad account not enabled for automation also uses the Marketing API', async () => {
  const log = world({ automation: false });
  const r = await call(CREATE);
  assert.equal(r.body.mode, 'standard');
  assert.equal(log.tools.filter((t) => t.name.startsWith('ads_create_')).length, 0);
});

test('standard: a daily budget replaces the lifetime budget on the ad set', async () => {
  const log = world({ scopes: STANDARD });
  await call({ ...CREATE, budgetType: 'daily' });
  const adset = log.graphPosts.find((p) => p.url.endsWith('/adsets')).body;
  assert.equal(adset.daily_budget, 30000);
  assert.equal('lifetime_budget' in adset, false);
});

test('an automation session that cannot open falls back before creating anything', async () => {
  const log = world({ mcpInit: 401 });
  const r = await call(CREATE);
  assert.equal(r.body.ok, true);
  assert.equal(r.body.mode, 'standard');
  assert.equal(log.ledger.get(CREATE.launchId).engine, 'graph');
  assert.equal(log.graphPosts.filter((p) => /\/(campaigns|adsets|adcreatives|ads)$/.test(p.url)).length, 4);
});

test('a failed automation create is rolled back through the Marketing API', async () => {
  const log = world({ mcpFail: { ads_create_ad_set: 'Invalid targeting spec' } });
  const r = await call(CREATE);
  assert.equal(r.body.error, 'failed');
  assert.equal(r.body.step, 'ad_set');
  assert.equal(r.body.cleanedUp, true);
  assert.deepEqual(log.graphDeletes, ['101'], 'the campaign this call made is deleted with a real DELETE');
  assert.equal(log.graphPosts.some((p) => p.body?._method), false, 'never a POST with a method override');
  const row = log.ledger.get(CREATE.launchId);
  assert.deepEqual([row.status, row.campaign_id], ['failed', null]);
  assert.ok(log.audits.some((a) => a.action === 'rollback'));
});

test('Meta\'s own reason for a rejected step reaches the merchant and the ledger', async () => {
  const log = world({ mcpFail: { ads_create_ad_set: 'The pixel is not available to this ad account.' } });
  const r = await call(CREATE);
  assert.equal(r.body.message, 'The pixel is not available to this ad account.');
  assert.match(log.ledger.get(CREATE.launchId).error, /^ad_set: invalid The pixel is not available to this ad account\. \(subcode 1885272\)$/);
  const failed = log.audits.find((a) => a.action === 'create' && a.ok === false);
  assert.deepEqual([failed.detail.subcode, failed.detail.message], ['1885272', 'The pixel is not available to this ad account.']);
});

test('a delete Meta accepts but does not carry out is reported as left behind', async () => {
  const log = world({ mcpFail: { ads_create_ad_set: 'Invalid targeting spec' }, deleteSticks: false });
  const r = await call(CREATE);
  assert.equal(r.body.cleanedUp, false);
  assert.deepEqual(r.body.leftovers, ['campaign 101']);
  const row = log.ledger.get(CREATE.launchId);
  assert.deepEqual([row.status, row.campaign_id], ['partial', '101'], 'the ledger keeps the id so the campaign is not lost');
});

test('a server-side problem in Meta\'s automation falls back to the Marketing API once cleanup is confirmed', async () => {
  const log = world({ mcpFail: { ads_create_ad_set: 'An internal error occurred. Please try again later.' }, mcpFailCategory: 'INTERNAL' });
  const r = await call(CREATE);
  assert.equal(r.body.ok, true, JSON.stringify(r.body));
  assert.equal(r.body.mode, 'standard');
  assert.deepEqual(log.graphDeletes, ['101'], 'the automation campaign is removed first');
  assert.equal(log.graphPosts.filter((p) => /\/(campaigns|adsets|adcreatives|ads)$/.test(p.url)).length, 4);
  const row = log.ledger.get(CREATE.launchId);
  assert.deepEqual([row.status, row.engine, row.config.engineFallback], ['created', 'graph', 'automation_internal']);
  const failed = log.audits.find((a) => a.action === 'create' && a.ok === false);
  assert.deepEqual([failed.detail.category, failed.detail.fellBackTo], ['INTERNAL', 'graph']);
});

test('no fallback when the automation campaign could not be confirmed deleted', async () => {
  const log = world({ mcpFail: { ads_create_ad_set: 'An internal error occurred. Please try again later.' }, mcpFailCategory: 'INTERNAL', deleteSticks: false });
  const r = await call(CREATE);
  assert.equal(r.body.error, 'failed');
  assert.equal(log.graphPosts.filter((p) => /\/(campaigns|adsets|adcreatives|ads)$/.test(p.url)).length, 0, 'nothing is created twice');
  const row = log.ledger.get(CREATE.launchId);
  assert.deepEqual([row.status, row.campaign_id], ['partial', '101']);
});

test('a rejected plan (validation) never falls back', async () => {
  const log = world({ mcpFail: { ads_create_ad_set: 'Campaign Schedule Is Too Short' } });
  const r = await call(CREATE);
  assert.equal(r.body.error, 'failed');
  assert.equal(log.graphPosts.filter((p) => /\/(campaigns|adsets|adcreatives|ads)$/.test(p.url)).length, 0);
});

test('a plan with blockers never reaches Meta', async () => {
  const log = world();
  const r = await call({ ...CREATE, dailyBudget: 0 });
  assert.equal(r.body.error, 'blocked');
  assert.equal(log.tools.filter((t) => t.name.startsWith('ads_create_')).length + log.graphPosts.length, 0);
});

// ── activation ───────────────────────────────────────────────────────────────
test('activation without the WhatsApp code is refused and nothing is called', async () => {
  const log = world({ launches: [MCP_ROW()] });
  const r = await call({ action: 'activate', launchId: MCP_ROW().launch_id });
  assert.equal(r.statusCode, 403);
  assert.equal(r.body.error, 'otp_required');
  assert.equal(log.tools.length, 0);
});

test('activation with the code runs ad → ad set → campaign and records it', async () => {
  const log = world({ launches: [MCP_ROW()], otp: '123456' });
  const r = await call({ action: 'activate', launchId: MCP_ROW().launch_id, otpCode: '123456' });
  assert.equal(r.body.ok, true, JSON.stringify(r.body));
  const order = log.tools.filter((t) => t.name === 'ads_activate_entity').map((t) => t.args.entity_type);
  assert.deepEqual(order, ['ad', 'ad_set', 'campaign']);
  assert.equal(log.tools[0].args.ad_account_id, '962613363265198', 'the account the launch was created in');
  assert.equal(log.ledger.get(MCP_ROW().launch_id).status, 'active');
  assert.equal(log.otpDeleted, true, 'the code is single use');
});

test('a paused-only environment refuses activation even with a valid code', async () => {
  process.env.META_PAUSED_ONLY = 'true';
  const log = world({ launches: [MCP_ROW()], otp: '123456' });
  const r = await call({ action: 'activate', launchId: MCP_ROW().launch_id, otpCode: '123456' });
  assert.equal(r.body.error, 'activation_disabled_in_this_environment');
  assert.equal(log.tools.length, 0);
});

test('a non-pilot store cannot activate even with a valid code', async () => {
  const row = MCP_ROW({ store_slug: 'royalfoodsmasale' });
  const log = world({ slug: 'royalfoodsmasale', launches: [row], otp: '123456' });
  const r = await call({ action: 'activate', launchId: row.launch_id, otpCode: '123456' });
  assert.equal(r.body.error, 'writes_disabled');
  assert.equal(log.tools.length, 0);
});

// ── a late first start keeps the whole planned run ───────────────────────────
const LATE = (over = {}) => MCP_ROW({ days: 7, config: { ...MCP_ROW().config, budget: { days: 7, endTime: new Date(Date.now() + 2 * 86400000).toISOString() } }, ...over });
const near = (iso, ms) => Math.abs(Date.parse(iso) - ms) < 10 * 60000;

test('a late first start moves the end date so the planned days run from now (automation)', async () => {
  const log = world({ launches: [LATE()], otp: '123456' });
  const r = await call({ action: 'activate', launchId: LATE().launch_id, otpCode: '123456' });
  assert.equal(r.body.ok, true, JSON.stringify(r.body));
  assert.deepEqual(log.tools.map((t) => `${t.name}:${t.args.entity_type}`),
    ['ads_update_entity:campaign', 'ads_update_entity:ad_set', 'ads_activate_entity:ad', 'ads_activate_entity:ad_set', 'ads_activate_entity:campaign']);
  const stop = JSON.parse(log.tools[0].args.fields).stop_time;
  const end = JSON.parse(log.tools[1].args.fields).end_time;
  assert.equal(stop, end, 'the campaign stops when the ad set ends');
  assert.ok(near(end, Date.now() + 7 * 86400000), end);
  assert.equal(log.audits.find((a) => a.action === 'activate' && a.ok).detail.endTime, end);
});

test('a start soon after creation leaves the dates alone', async () => {
  const fresh = MCP_ROW({ days: 7, config: { ...MCP_ROW().config, budget: { days: 7, endTime: new Date(Date.now() + 7 * 86400000).toISOString() } } });
  const log = world({ launches: [fresh], otp: '123456' });
  const r = await call({ action: 'activate', launchId: fresh.launch_id, otpCode: '123456' });
  assert.equal(r.body.ok, true, JSON.stringify(r.body));
  assert.equal(log.tools.some((t) => t.name === 'ads_update_entity'), false);
});

test('if Meta refuses the new dates, nothing is started', async () => {
  const log = world({ launches: [LATE()], otp: '123456', mcpFail: { ads_update_entity: 'End time is invalid' } });
  const r = await call({ action: 'activate', launchId: LATE().launch_id, otpCode: '123456' });
  assert.deepEqual([r.body.error, r.body.message], ['schedule_failed', 'End time is invalid']);
  assert.equal(log.tools.some((t) => t.name === 'ads_activate_entity'), false);
  assert.equal(log.ledger.get(LATE().launch_id).status, 'created');
});

test('a late first start of a standard launch moves the ad set end before starting', async () => {
  const row = LATE({ engine: 'graph' });
  const log = world({ launches: [row], otp: '123456' });
  const r = await call({ action: 'activate', launchId: row.launch_id, otpCode: '123456' });
  assert.equal(r.body.ok, true, JSON.stringify(r.body));
  assert.ok(log.graphPosts[0].url.endsWith('/202'));
  assert.ok(near(log.graphPosts[0].body.end_time, Date.now() + 7 * 86400000));
  assert.deepEqual(log.graphPosts.slice(1).map((p) => [p.url.split('/').pop(), p.body.status]), [['101', 'ACTIVE'], ['202', 'ACTIVE'], ['404', 'ACTIVE']]);
});

test('refreshedEnd: only when the planned run would be cut short, never earlier', () => {
  const now = Date.parse('2026-09-20T09:00:00Z');
  const plan = (endTime, days = 7) => ({ days, config: { budget: { days, endTime } } });
  assert.equal(refreshedEnd({ config: {} }, now), null, 'no planned days, no change');
  assert.equal(refreshedEnd(plan(new Date(now + 7 * 86400000).toISOString()), now), null, 'a start on time');
  assert.equal(refreshedEnd(plan('2026-09-22T09:02:45Z'), now), new Date(now + 7 * 86400000 + 120000).toISOString());
  assert.equal(refreshedEnd(plan('2026-09-01T00:00:00Z', 1), now), new Date(now + 86400000 + 120000).toISOString(), 'a run already over gets its day back');
});

test('pausing is always allowed and only edits the status', async () => {
  const row = MCP_ROW({ store_slug: 'royalfoodsmasale', status: 'active' });
  const log = world({ slug: 'royalfoodsmasale', launches: [row] });
  const r = await call({ action: 'pause', launchId: row.launch_id });
  assert.equal(r.body.ok, true);
  assert.deepEqual(log.tools.map((t) => t.name), ['ads_update_entity']);
  assert.deepEqual(JSON.parse(log.tools[0].args.fields), { status: 'PAUSED' });
  assert.equal(log.ledger.get(row.launch_id).status, 'paused');
});

test('a Marketing API launch is still paused through the Marketing API', async () => {
  const row = MCP_ROW({ engine: 'graph', status: 'active' });
  const log = world({ launches: [row] });
  const r = await call({ action: 'pause', launchId: row.launch_id });
  assert.equal(r.body.mode, 'standard');
  assert.equal(log.tools.length, 0);
  assert.deepEqual(log.graphPosts.map((p) => [p.url.split('/').pop(), p.body.status]), [['101', 'PAUSED']]);
});

// ── budget + targeting ───────────────────────────────────────────────────────
test('budget changes are checked against the caps before Meta is called', async () => {
  const log = world({ launches: [MCP_ROW()] });
  const r = await call({ action: 'update-budget', launchId: MCP_ROW().launch_id, budgetType: 'daily', amount: 9000 });
  assert.equal(r.body.error, 'over_cap');
  assert.equal(log.tools.length, 0);
});

test('raising the budget of a running campaign needs the WhatsApp code; lowering does not', async () => {
  const running = MCP_ROW({ status: 'active' });
  let log = world({ launches: [running] });
  let r = await call({ action: 'update-budget', launchId: running.launch_id, budgetType: 'daily', amount: 500 });
  assert.equal(r.body.error, 'otp_required');
  assert.equal(log.tools.length, 0);

  log = world({ launches: [MCP_ROW({ status: 'active' })] });
  r = await call({ action: 'update-budget', launchId: running.launch_id, budgetType: 'daily', amount: 200 });
  assert.equal(r.body.ok, true, JSON.stringify(r.body));
  assert.deepEqual(JSON.parse(log.tools.find((t) => t.name === 'ads_update_entity').args.fields), { daily_budget: 20000 });
  assert.equal(log.ledger.get(running.launch_id).daily_budget, 200);

  log = world({ launches: [MCP_ROW({ status: 'active' })], otp: '654321' });
  r = await call({ action: 'update-budget', launchId: running.launch_id, budgetType: 'daily', amount: 500, otpCode: '654321' });
  assert.equal(r.body.ok, true);
});

test('a campaign cannot switch between daily and lifetime budgets', async () => {
  world({ launches: [MCP_ROW()] });
  const r = await call({ action: 'update-budget', launchId: MCP_ROW().launch_id, budgetType: 'lifetime', amount: 2000 });
  assert.equal(r.body.error, 'budget_type_fixed');
});

test('raisesBudget compares like with like', () => {
  const row = { daily_budget: 300, lifetime_minor: 210000 };
  assert.equal(raisesBudget(row, 'daily', 301), true);
  assert.equal(raisesBudget(row, 'daily', 300), false);
  assert.equal(raisesBudget(row, 'lifetime', 2100), false);
  assert.equal(raisesBudget(row, 'lifetime', 2100.01), true);
});

test('targeting is rebuilt by the shared builder and sent to the ad set', async () => {
  const log = world({ launches: [MCP_ROW()] });
  const r = await call({ action: 'update-targeting', launchId: MCP_ROW().launch_id, ageMin: 25, ageMax: 45, gender: 'women', radiusKm: 40, audienceStrategy: 'manual' });
  assert.equal(r.body.ok, true, JSON.stringify(r.body));
  const upd = log.tools.find((t) => t.name === 'ads_update_entity');
  assert.equal(upd.args.entity_type, 'ad_set');
  assert.equal(upd.args.entity_id, '202');
  const { targeting } = JSON.parse(upd.args.fields);
  assert.deepEqual([targeting.age_min, targeting.age_max, targeting.genders[0]], [25, 45, 2]);
  assert.equal(targeting.geo_locations.cities[0].radius, 40);
});

// ── media, errors, listing ───────────────────────────────────────────────────
test('media uploads through automation return a hash to create with', async () => {
  const log = world();
  const r = await call({ action: 'upload-media', slug: 'showme', url: 'https://cdn.example/whey.jpg', type: 'IMAGE' });
  assert.deepEqual([r.body.ok, r.body.imageHash, r.body.mode], [true, 'hash0123456789', 'automated']);
  assert.equal(log.tools.find((t) => t.name === 'ads_creative_upload_media').args.upload_source, 'URL');
});

test('delivery errors come back for a launch', async () => {
  world({ launches: [MCP_ROW()] });
  const r = await call({ action: 'errors', launchId: MCP_ROW().launch_id });
  assert.deepEqual(r.body.errors, [{ entityId: '404', title: 'Ad rejected', message: 'Text policy' }]);
});

test('list shows this store\'s launches without tokens or protocol names', async () => {
  world({ launches: [MCP_ROW(), MCP_ROW({ launch_id: '33333333-3333-3333-3333-333333333333', engine: 'graph' })] });
  const r = await call({ action: 'list', slug: 'showme' });
  assert.equal(r.body.launches.length, 2);
  assert.deepEqual(r.body.launches.map((l) => l.mode).sort(), ['automated', 'standard']);
  const text = JSON.stringify(r.body);
  assert.equal(/mcp|graph|STORE-TOKEN/i.test(text), false);
});

test('publicLaunch reports the lifetime budget in rupees', () => {
  const p = publicLaunch(MCP_ROW({ budget_type: 'lifetime' }));
  assert.deepEqual([p.budgetType, p.lifetimeBudget, p.dailyBudget], ['lifetime', 2100, 300]);
});
