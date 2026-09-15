// The Ads screen's connection payload. Graph and Supabase are stubbed at
// globalThis.fetch; Meta's automation server is a fake passed in. No network.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mergeAdAccounts, publicAccount, snapshotIsStale, refreshEligibility, buildConnection,
  matchBusiness, matchInstagram, SNAPSHOT_MAX_AGE_MS,
} from '../api/meta/_connection.js';

const realFetch = globalThis.fetch;
test.afterEach(() => { globalThis.fetch = realFetch; });

// Graph + Supabase stub: records every call; answers by URL.
function stubGraph({ permissions = ['ads_mcp_management', 'ads_management', 'ads_read', 'business_management'], permissionError = null, businesses = [{ id: '2046280469453502', name: 'Seniqify' }] } = {}) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    calls.push({ url: u, method: (init.method || 'GET').toUpperCase(), body: init.body ? JSON.parse(init.body) : null });
    const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });
    if (u.includes('/me/permissions')) return permissionError ? json({ error: permissionError }, 400) : json({ data: permissions.map((p) => ({ permission: p, status: 'granted' })) });
    if (u.includes('/me/businesses')) return json({ data: businesses });
    if (u.includes('/rest/v1/')) return json({}, 204);
    return json({ data: [] });
  };
  return calls;
}

// Fake automation server answering ads_get_ad_accounts.
function mcpServer({ status = 200, accounts = [] } = {}) {
  let listed = 0;
  const fetchImpl = async (url, { body }) => {
    const msg = JSON.parse(body);
    const reply = (s, obj) => ({ status: s, headers: { get: () => 'sess' }, text: async () => (obj ? `data: ${JSON.stringify(obj)}\n\n` : '') });
    if (msg.method === 'initialize') return status === 200 ? reply(200, { jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2025-06-18' } }) : reply(status, null);
    if (msg.method === 'notifications/initialized') return reply(202, null);
    listed += 1;
    return reply(200, { jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: JSON.stringify({ ad_accounts: accounts }) }] } });
  };
  return { fetchImpl, listed: () => listed };
}

const LIVE_ACCOUNTS = [
  { ad_account_id: '962613363265198', ad_account_name: 'PocketLink', business_id: '2046280469453502', business_name: 'Seniqify', is_ads_mcp_enabled: true, account_status: 'ACTIVE', is_queryable: true, currency: 'INR' },
  { ad_account_id: '1485125029900166', ad_account_name: 'Shri Samarth Jewellers', is_ads_mcp_enabled: false, account_status: 'ACTIVE', is_queryable: true, currency: 'USD', is_ads_mcp_disabled_reason: 'Ads MCP is gradually being rolled out.' },
  { ad_account_id: '26443868945229654', ad_account_name: 'Shobha IVF', is_ads_mcp_enabled: true, account_status: 'CLOSED', is_queryable: false, not_queryable_reason: 'Unknown error' },
];

const ACCT = (over = {}) => ({
  store_slug: 'showme', status: 'connected', access_token: 'TOKEN', expires_at: new Date(Date.now() + 40 * 86400000).toISOString(),
  ad_account_ids: ['act_962613363265198'], selected_ad_account_id: 'act_962613363265198', scopes: ['ads_read'],
  ad_accounts: [], mcp_checked_at: null, mcp_error: null, token_status: 'valid', business_id: '2046280469453502', ...over,
});
const CONFIG = { meta: { connected: true, businessId: '2046280469453502', pageId: '1124874604040958', igId: null, pages: [{ id: '1124874604040958', name: 'PocketLink', ig: null }] } };

// ── merging + public shape ───────────────────────────────────────────────────
test('only granted ad accounts are listed, even if Meta knows more', () => {
  const merged = mergeAdAccounts(['act_962613363265198', '962613363265198', 'junk'], [
    { id: 'act_962613363265198', name: 'PocketLink', automation: 'available', queryable: true },
    { id: 'act_1485125029900166', name: 'Someone else', automation: 'available', queryable: true },
  ]);
  assert.deepEqual(merged.map((a) => a.id), ['act_962613363265198']);
  assert.equal(merged[0].automation, 'available');
});

test('a granted account missing from the snapshot is listed as unknown, not dropped', () => {
  const [a] = mergeAdAccounts(['act_5'], []);
  assert.deepEqual([a.id, a.automation, a.queryable], ['act_5', 'unknown', true]);
});

test('the browser never sees Meta\'s automation wording or tokens', () => {
  const p = publicAccount({ id: 'act_1', name: 'X', automation: 'unavailable', automationNote: 'Ads MCP is gradually being rolled out.', queryable: true, access_token: 'SECRET' });
  const text = JSON.stringify(p);
  assert.equal(/MCP/i.test(text), false);
  assert.equal(text.includes('SECRET'), false);
  assert.equal(p.automation, 'unavailable');
});

test('an unusable account says why, in Meta\'s account words', () => {
  const p = publicAccount({ id: 'act_1', queryable: false, notQueryableReason: 'Your ad account was disabled' });
  assert.deepEqual([p.usable, p.unusableReason], [false, 'Your ad account was disabled']);
});

test('the eligibility snapshot is refreshed after six hours', () => {
  const now = Date.parse('2026-09-15T12:00:00Z');
  assert.equal(snapshotIsStale(null, now), true);
  assert.equal(snapshotIsStale('2026-09-15T08:00:00Z', now), false);
  assert.equal(snapshotIsStale(new Date(now - SNAPSHOT_MAX_AGE_MS - 1).toISOString(), now), true);
});

// ── refresh ──────────────────────────────────────────────────────────────────
test('refresh stores a snapshot of granted accounts only', async () => {
  const calls = stubGraph();
  const mcp = mcpServer({ accounts: LIVE_ACCOUNTS });
  const r = await refreshEligibility('showme', ACCT(), { mcpFetch: mcp.fetchImpl });
  assert.equal(r.error, null);
  assert.deepEqual(r.snapshot.map((a) => [a.id, a.automation]), [['act_962613363265198', 'available']]);
  const patch = calls.find((c) => c.method === 'PATCH' && c.url.includes('store_meta_accounts'));
  assert.deepEqual(patch.body.ad_accounts.map((a) => a.id), ['act_962613363265198']);
  assert.equal(patch.body.mcp_error, null);
  assert.equal(JSON.stringify(patch.body).includes('TOKEN'), false, 'the snapshot never contains the token');
});

test('a transient failure keeps the last known snapshot', async () => {
  stubGraph();
  const failing = async () => { throw new Error('socket hang up'); };
  const previous = [{ id: 'act_962613363265198', automation: 'available', queryable: true }];
  const r = await refreshEligibility('showme', ACCT(), { previous, mcpFetch: failing });
  assert.equal(r.error, 'unreachable');
  assert.equal(r.snapshot[0].automation, 'available');
});

test('a token without automation access marks accounts unknown', async () => {
  stubGraph();
  const previous = [{ id: 'act_962613363265198', automation: 'available', queryable: true }];
  const r = await refreshEligibility('showme', ACCT(), { previous, mcpFetch: mcpServer({ status: 401 }).fetchImpl });
  assert.equal(r.error, 'unauthorized');
  assert.equal(r.snapshot[0].automation, 'unknown');
});

// ── the three states ─────────────────────────────────────────────────────────
test('STATE 3: no connection → connect, and no Meta call at all', async () => {
  const calls = stubGraph();
  const c = await buildConnection({ slug: 'showme', acct: null, config: {} });
  assert.equal(c.state, 'not_connected');
  assert.equal(calls.length, 0);
  const revoked = await buildConnection({ slug: 'showme', acct: ACCT({ status: 'revoked', access_token: null }), config: {} });
  assert.equal(revoked.state, 'not_connected');
});

test('STATE 1: automation granted and the account enabled → full, via MCP', async () => {
  stubGraph();
  const mcp = mcpServer({ accounts: LIVE_ACCOUNTS });
  const c = await buildConnection({ slug: 'showme', acct: ACCT(), config: CONFIG, mcpFetch: mcp.fetchImpl, env: {} });
  assert.deepEqual([c.state, c.mode, c.canCreate, c.automation], ['full', 'automated', true, 'available']);
  assert.equal('engine' in c, false, 'engine names stay on the server');
  assert.equal(mcp.listed(), 1, 'stale snapshot was refreshed once');
  assert.equal(c.writesEnabled, true, 'showme is the default pilot store');
  assert.deepEqual(c.businesses, [{ id: '2046280469453502', name: 'Seniqify' }]);
  assert.equal(c.selected.adAccountId, 'act_962613363265198');
  assert.equal(c.pages[0].name, 'PocketLink');
  assert.equal(JSON.stringify(c).includes('TOKEN'), false);
  assert.equal(/MCP/i.test(JSON.stringify(c)), false);
});

test('STATE 2: account not enabled → limited, fallback engine, onboarding not failed', async () => {
  stubGraph();
  const acct = ACCT({ ad_account_ids: ['act_1485125029900166'], selected_ad_account_id: 'act_1485125029900166' });
  const c = await buildConnection({ slug: 'jewellers', acct, config: CONFIG, mcpFetch: mcpServer({ accounts: LIVE_ACCOUNTS }).fetchImpl, env: {} });
  assert.deepEqual([c.state, c.mode, c.automation, c.reason], ['limited', 'standard', 'unavailable', 'automation_unavailable']);
  assert.equal(c.canCreate, true, 'the Marketing API can still create');
  assert.equal(c.writesEnabled, false, 'not a pilot store');
});

test('today\'s connections (no automation permission) → limited, and the automation server is not called', async () => {
  stubGraph({ permissions: ['ads_management', 'ads_read', 'business_management'] });
  const mcp = mcpServer({ accounts: LIVE_ACCOUNTS });
  const c = await buildConnection({ slug: 'showme', acct: ACCT(), config: CONFIG, mcpFetch: mcp.fetchImpl, env: {} });
  assert.deepEqual([c.state, c.mode, c.reason], ['limited', 'standard', 'automation_not_granted']);
  assert.equal(mcp.listed(), 0);
  assert.equal(c.permissions.automation, false);
});

test('a fresh snapshot is used without asking Meta again', async () => {
  stubGraph();
  const mcp = mcpServer({ accounts: LIVE_ACCOUNTS });
  const acct = ACCT({ ad_accounts: [{ id: 'act_962613363265198', automation: 'available', queryable: true }], mcp_checked_at: new Date().toISOString() });
  const c = await buildConnection({ slug: 'showme', acct, config: CONFIG, mcpFetch: mcp.fetchImpl, env: {} });
  assert.equal(c.state, 'full');
  assert.equal(mcp.listed(), 0);
  await buildConnection({ slug: 'showme', acct, config: CONFIG, mcpFetch: mcp.fetchImpl, env: {}, refresh: true });
  assert.equal(mcp.listed(), 1, 'an explicit refresh does ask');
});

test('an expired token → reconnect, stored as expired, no assets fetched', async () => {
  const calls = stubGraph({ permissionError: { code: 190, type: 'OAuthException', message: 'Error validating access token' } });
  const c = await buildConnection({ slug: 'showme', acct: ACCT(), config: CONFIG, mcpFetch: mcpServer().fetchImpl, env: {} });
  assert.deepEqual([c.state, c.tokenStatus], ['reconnect', 'expired']);
  assert.deepEqual(c.businesses, []);
  assert.equal(calls.some((x) => x.url.includes('/me/businesses')), false);
  const patch = calls.find((x) => x.method === 'PATCH');
  assert.equal(patch.body.token_status, 'expired');
});

test('a token expiring within a week is flagged but still works', async () => {
  stubGraph();
  const acct = ACCT({ expires_at: new Date(Date.now() + 3 * 86400000).toISOString(), ad_accounts: [{ id: 'act_962613363265198', automation: 'available', queryable: true }], mcp_checked_at: new Date().toISOString() });
  const c = await buildConnection({ slug: 'showme', acct, config: CONFIG, env: {} });
  assert.deepEqual([c.state, c.tokenStatus], ['full', 'expiring']);
});

test('several accounts and none chosen → ask the merchant to choose', async () => {
  stubGraph({ permissions: ['ads_read'] });
  const acct = ACCT({ ad_account_ids: ['act_1', 'act_2'], selected_ad_account_id: null });
  const c = await buildConnection({ slug: 'showme', acct, config: CONFIG, env: {} });
  assert.equal(c.needsAdAccountChoice, true);
  assert.equal(c.selected.adAccountId, null);
});

// ── selection validators ─────────────────────────────────────────────────────
test('a business can only be chosen if the token still sees it', () => {
  const live = [{ id: '2046280469453502', name: 'Seniqify' }];
  assert.deepEqual(matchBusiness(live, '2046280469453502'), live[0]);
  assert.equal(matchBusiness(live, '999'), null);
  assert.equal(matchBusiness(live, ''), null);
});

test('Instagram must be the account linked to the selected Page', () => {
  const pages = [
    { id: '1124874604040958', name: 'PocketLink', instagram_business_account: { id: '17841400000000001', username: 'pocketlink' } },
    { id: '899097566625218', name: 'Seniqify', instagram_business_account: { id: '17841400000000002', username: 'seniqify' } },
  ];
  assert.deepEqual(matchInstagram(pages, '1124874604040958', '17841400000000001'), { ig: { id: '17841400000000001', username: 'pocketlink' } });
  assert.equal(matchInstagram(pages, '1124874604040958', '17841400000000002').error, 'ig_not_on_page');
  assert.equal(matchInstagram(pages, '', '17841400000000001').error, 'page_not_selected');
  assert.deepEqual(matchInstagram(pages, '1124874604040958', ''), { clear: true });
});
