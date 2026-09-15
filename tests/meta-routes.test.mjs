// Route-level tests: the real Vercel handlers, with Supabase, Graph and Meta's
// automation server all faked at globalThis.fetch. No network, no Meta objects.
import test from 'node:test';
import assert from 'node:assert/strict';
import previewHandler from '../api/meta/campaign-preview.js';
import callbackHandler from '../api/meta/callback.js';
import { signState } from '../api/meta/_meta.js';

const realFetch = globalThis.fetch;
const ENV_KEYS = ['META_ALLOWED_SLUGS', 'META_OAUTH_STATE_SECRET', 'META_APP_SECRET', 'SUPABASE_SERVICE_ROLE_KEY', 'META_ADS_PILOT_SLUGS'];
test.afterEach(() => {
  globalThis.fetch = realFetch;
  for (const k of ENV_KEYS) delete process.env[k];
});

function mockRes() {
  const r = { statusCode: 200, body: null, headers: {} };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.setHeader = (k, v) => { r.headers[k] = v; };
  r.end = () => r;
  return r;
}

const PL = { ad_account_id: '962613363265198', ad_account_name: 'PocketLink', business_id: '2046280469453502', business_name: 'Seniqify', is_ads_mcp_enabled: true, account_status: 'ACTIVE', is_queryable: true, currency: 'INR' };
const ALL_SCOPES = ['ads_mcp_management', 'ads_management', 'ads_read', 'business_management', 'pages_show_list'];

function world({
  pinOk = true, acct = null, config = { meta: {} }, businesses = [], pages = [], permissions = ALL_SCOPES,
  mcpStatus = 200, mcpAccounts = [PL], oauth = { access_token: 'LONG-TOKEN', expires_in: 5184000 },
  adAccounts = [{ id: 'act_962613363265198' }], upsertOk = true,
} = {}) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    const method = (init.method || 'GET').toUpperCase();
    calls.push({ url: u, method, body: init.body ? (() => { try { return JSON.parse(init.body); } catch { return init.body; } })() : null });
    const reply = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'sess' }, json: async () => body, text: async () => (body == null ? '' : JSON.stringify(body)) });

    if (u.startsWith('https://mcp.facebook.com')) {
      const msg = JSON.parse(init.body);
      if (msg.method === 'initialize') return mcpStatus === 200 ? reply({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2025-06-18' } }) : reply({ title: 'restricted' }, mcpStatus);
      if (msg.method === 'notifications/initialized') return reply(null, 202);
      return reply({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: JSON.stringify({ ad_accounts: mcpAccounts }) }] } });
    }
    if (u.includes('/rpc/verify_store_pin')) return reply(pinOk);
    if (u.includes('/rest/v1/store_meta_accounts')) {
      if (method === 'GET') return reply(acct ? [acct] : []);
      if (method === 'POST') return reply(null, upsertOk ? 201 : 400);
      return reply(null, 204);
    }
    if (u.includes('/rest/v1/stores')) return method === 'GET' ? reply([{ config }]) : reply(null, 204);
    if (u.includes('/rest/v1/')) return reply(null, 201);
    if (u.includes('/oauth/access_token')) return reply(oauth);
    if (u.includes('/me/permissions')) return reply({ data: permissions.map((p) => ({ permission: p, status: 'granted' })) });
    if (u.includes('/me/businesses')) return reply({ data: businesses });
    if (u.includes('/me/adaccounts')) return reply({ data: adAccounts });
    if (u.includes('/me/accounts')) return reply({ data: pages });
    return reply({ data: [] });
  };
  return calls;
}

const post = async (body) => { const res = mockRes(); await previewHandler({ method: 'POST', body }, res); return res; };
const ACCT = (over = {}) => ({
  store_slug: 'showme', status: 'connected', access_token: 'STORED-TOKEN', expires_at: new Date(Date.now() + 40 * 86400000).toISOString(),
  ad_account_ids: ['act_962613363265198'], selected_ad_account_id: 'act_962613363265198', scopes: ALL_SCOPES,
  ad_accounts: [], mcp_checked_at: null, token_status: 'valid', ...over,
});
const PAGES_LIVE = [
  { id: '1124874604040958', name: 'PocketLink', instagram_business_account: { id: '17841400000000001', username: 'pocketlink' } },
];
const CONFIG = { meta: { connected: true, pageId: '1124874604040958', pages: [{ id: '1124874604040958', name: 'PocketLink', ig: null }] } };

// ── preview route ────────────────────────────────────────────────────────────
test('a wrong PIN is refused before any Meta call', async () => {
  const calls = world({ pinOk: false, acct: ACCT() });
  const res = await post({ slug: 'showme', hashedPin: 'x', action: 'connection' });
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error, 'pin');
  assert.equal(calls.some((c) => c.url.includes('graph.facebook.com') || c.url.includes('mcp.facebook.com')), false);
});

test('connection answers for a store that never connected', async () => {
  world({ acct: null });
  const res = await post({ slug: 'royalfoodsmasale', hashedPin: 'x', action: 'connection' });
  assert.equal(res.body.state, 'not_connected');
  assert.equal(res.body.mode, null);
});

test('connection for an enabled account → automated, with no token or protocol name in the payload', async () => {
  world({ acct: ACCT(), config: CONFIG, businesses: [{ id: '2046280469453502', name: 'Seniqify' }] });
  const res = await post({ slug: 'showme', hashedPin: 'x', action: 'connection' });
  assert.deepEqual([res.body.state, res.body.mode, res.body.canCreate], ['full', 'automated', true]);
  const text = JSON.stringify(res.body);
  assert.equal(text.includes('STORED-TOKEN'), false);
  assert.equal(/mcp/i.test(text), false);
});

test('the old preview action still says not_connected for an unconnected store', async () => {
  world({ acct: null });
  const res = await post({ slug: 'showme', hashedPin: 'x' });
  assert.equal(res.body.error, 'not_connected');
});

test('select-business rejects a business the token cannot see, and saves one it can', async () => {
  let calls = world({ acct: ACCT(), config: CONFIG, businesses: [{ id: '2046280469453502', name: 'Seniqify' }] });
  let res = await post({ slug: 'showme', hashedPin: 'x', action: 'select-business', businessId: '999999' });
  assert.equal(res.body.error, 'not_granted');
  assert.equal(calls.some((c) => c.method === 'PATCH' && c.url.includes('/rest/v1/stores')), false);

  calls = world({ acct: ACCT(), config: CONFIG, businesses: [{ id: '2046280469453502', name: 'Seniqify' }] });
  res = await post({ slug: 'showme', hashedPin: 'x', action: 'select-business', businessId: '2046280469453502' });
  assert.deepEqual([res.body.ok, res.body.businessName], [true, 'Seniqify']);
  const saved = calls.find((c) => c.method === 'PATCH' && c.url.includes('/rest/v1/stores'));
  assert.equal(saved.body.config.meta.businessId, '2046280469453502');
  assert.equal(saved.body.config.meta.pageId, '1124874604040958', 'other selections are kept');
});

test('select-instagram only accepts the account linked to the selected Page', async () => {
  let calls = world({ acct: ACCT(), config: CONFIG, pages: PAGES_LIVE });
  let res = await post({ slug: 'showme', hashedPin: 'x', action: 'select-instagram', igId: '17841499999999999' });
  assert.equal(res.body.error, 'ig_not_on_page');
  assert.equal(calls.some((c) => c.method === 'PATCH' && c.url.includes('/rest/v1/stores')), false);

  calls = world({ acct: ACCT(), config: CONFIG, pages: PAGES_LIVE });
  res = await post({ slug: 'showme', hashedPin: 'x', action: 'select-instagram', igId: '17841400000000001' });
  assert.deepEqual(res.body.instagram, { id: '17841400000000001', username: 'pocketlink' });

  calls = world({ acct: ACCT(), config: CONFIG, pages: PAGES_LIVE });
  res = await post({ slug: 'showme', hashedPin: 'x', action: 'select-instagram', igId: '' });
  assert.equal(res.body.instagram, null, 'empty id = Facebook only');
  assert.equal(calls.some((c) => c.url.includes('/me/accounts')), false, 'clearing needs no Meta call');
});

test('a preview deployment cannot write selections for other stores', async () => {
  process.env.META_ALLOWED_SLUGS = 'showme';
  const calls = world({ acct: ACCT({ store_slug: 'royalfoodsmasale' }), config: CONFIG, businesses: [{ id: '1', name: 'X' }] });
  for (const action of ['select-business', 'select-instagram', 'select-page', 'select-ad-account']) {
    const res = await post({ slug: 'royalfoodsmasale', hashedPin: 'x', action, businessId: '1', igId: '1', pageId: '1', adAccountId: '1' });
    assert.equal(res.statusCode, 403, action);
    assert.equal(res.body.error, 'not_allowed_in_this_environment', action);
  }
  assert.equal(calls.some((c) => c.method === 'PATCH'), false);
});

// ── callback ─────────────────────────────────────────────────────────────────
function callbackEnv() {
  process.env.META_OAUTH_STATE_SECRET = 'state-secret-for-tests';
  process.env.META_APP_SECRET = 'app-secret-for-tests';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key-for-tests';
}
const callback = async (slug) => {
  const res = mockRes();
  await callbackHandler({ query: { code: 'CODE', state: signState(slug) } }, res);
  return res;
};

test('callback: eligibility is checked and stored separately from the connection', async () => {
  callbackEnv();
  const calls = world({ config: { meta: {} } });
  const res = await callback('showme');
  assert.equal(res.statusCode, 302);
  assert.match(res.headers.Location, /meta=connected/);
  const upsert = calls.find((c) => c.method === 'POST' && c.url.includes('/rest/v1/store_meta_accounts'));
  assert.equal('ad_accounts' in upsert.body, false, 'the core save does not depend on the new columns');
  const snapshot = calls.find((c) => c.method === 'PATCH' && c.url.includes('store_meta_accounts') && c.body?.ad_accounts);
  assert.deepEqual(snapshot.body.ad_accounts.map((a) => [a.id, a.automation]), [['act_962613363265198', 'available']]);
  assert.ok(calls.some((c) => c.method === 'PATCH' && c.body?.token_status === 'valid'));
});

test('callback: automation server down → still connected', async () => {
  callbackEnv();
  world({ config: { meta: {} }, mcpStatus: 503 });
  const res = await callback('showme');
  assert.match(res.headers.Location, /meta=connected/);
});

test('callback: without the automation permission the automation server is not called', async () => {
  callbackEnv();
  const calls = world({ config: { meta: {} }, permissions: ['ads_management', 'ads_read', 'business_management'] });
  const res = await callback('showme');
  assert.match(res.headers.Location, /meta=connected/);
  assert.equal(calls.some((c) => c.url.startsWith('https://mcp.facebook.com')), false);
});

test('callback: if the connection itself cannot be saved, the merchant is told', async () => {
  callbackEnv();
  const calls = world({ config: { meta: {} }, upsertOk: false });
  const res = await callback('showme');
  assert.match(res.headers.Location, /meta=error&reason=store/);
  assert.equal(calls.some((c) => c.url.startsWith('https://mcp.facebook.com')), false, 'nothing else runs after a failed save');
});
