// Ads dashboard reporting: Marketing API numbers first, automation figures only as
// a fallback, dead tokens recorded, and no protocol names in the payload.
import test from 'node:test';
import assert from 'node:assert/strict';
import adsHandler, { shape, shapeFromAutomation } from '../api/meta/ads.js';
import { shapeMcpMetrics } from '../api/meta/_mcpAds.js';

const realFetch = globalThis.fetch;
test.beforeEach(() => { process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key-for-tests'; });
test.afterEach(() => { globalThis.fetch = realFetch; delete process.env.SUPABASE_SERVICE_ROLE_KEY; });

function world({ scopes = ['ads_mcp_management', 'ads_management', 'ads_read'], automation = 'available', graphError = null, expiresAt = null }) {
  const log = { mcpTools: [], patches: [] };
  const acct = {
    store_slug: 'showme', status: 'connected', access_token: 'STORE-TOKEN',
    expires_at: expiresAt || new Date(Date.now() + 30 * 86400000).toISOString(),
    ad_account_ids: ['act_962613363265198'], selected_ad_account_id: 'act_962613363265198', scopes,
    ad_accounts: [{ id: 'act_962613363265198', name: 'PocketLink', automation, queryable: true, status: 'ACTIVE', currency: 'INR' }],
  };
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    const method = (init.method || 'GET').toUpperCase();
    const reply = (b, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'sess' }, json: async () => b, text: async () => (b == null ? '' : JSON.stringify(b)) });
    if (u.startsWith('https://mcp.facebook.com')) {
      const msg = JSON.parse(init.body);
      if (msg.method === 'initialize') return reply({ jsonrpc: '2.0', id: msg.id, result: {} });
      if (msg.method === 'notifications/initialized') return reply(null, 202);
      log.mcpTools.push(msg.params);
      const level = msg.params.arguments.level;
      const rows = level === 'ad_account'
        ? [{ id: '962613363265198', amount_spent: '₹450.00 INR', impressions: '12,000', reach: '9,100', clicks: '310', ctr: '2.58%', cpc: '₹1.45 INR', cpm: '₹37.50 INR', results: { indicator: 'actions:link_click', value: '120' }, purchase_roas: null }]
        : [{ id: '101', name: 'Whey', status: 'ACTIVE', objective: 'OUTCOME_TRAFFIC', amount_spent: '₹450.00 INR', results: { indicator: 'actions:link_click', value: '120' }, cost_per_result: { value: '₹3.75 INR' } }];
      return reply({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: JSON.stringify({ ad_entities: rows }) }] } });
    }
    if (u.includes('/rpc/verify_store_pin')) return reply(true);
    if (u.includes('/rest/v1/store_meta_accounts')) {
      if (method === 'PATCH') { log.patches.push(JSON.parse(init.body)); return reply(null, 204); }
      return reply([acct]);
    }
    if (u.includes('/rest/v1/')) return reply([]);
    if (u.startsWith('https://graph.facebook.com')) {
      if (graphError) return reply({ error: graphError }, 400);
      if (u.includes('/insights')) return reply({ data: [{ campaign_id: '101', spend: '450', impressions: '12000', reach: '9100', clicks: '310', ctr: '2.58', cpc: '1.45', cpm: '37.5', inline_link_clicks: '120', purchase_roas: [{ action_type: 'omni_purchase', value: '3.25' }] }] });
      if (u.includes('/campaigns')) return reply({ data: [{ id: '101', name: 'Whey', status: 'ACTIVE', objective: 'OUTCOME_TRAFFIC' }] });
      return reply({ currency: 'INR', name: 'PocketLink', timezone_name: 'Asia/Kolkata', account_status: 1 });
    }
    return reply({});
  };
  return log;
}

async function report(body = {}) {
  const r = { statusCode: 200, body: null };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  await adsHandler({ method: 'POST', body: { slug: 'showme', hashedPin: 'h', range: '7d', ...body } }, r);
  return r;
}

test('ROAS comes from Meta\'s purchase_roas, and is null when there is none', () => {
  assert.equal(shape({ spend: '100', purchase_roas: [{ action_type: 'omni_purchase', value: '3.25' }] }).roas, 3.25);
  assert.equal(shape({ spend: '100' }).roas, null);
  assert.equal(shape({ spend: '100', action_values: [{ action_type: 'purchase', value: '250' }] }).roas, 2.5, 'revenue ÷ spend when Meta has no ROAS row');
});

test('automation figures map onto the dashboard shape', () => {
  const m = shapeFromAutomation(shapeMcpMetrics({ amount_spent: '₹450.00 INR', impressions: '12,000', results: { indicator: 'actions:link_click', value: '120' }, cost_per_result: { value: '₹3.75 INR' } }));
  assert.deepEqual([m.spend, m.impressions, m.results, m.linkClicks, m.resultLabel, m.costPerResult], [450, 12000, 120, 120, 'link clicks', 3.75]);
  assert.equal(shapeFromAutomation(shapeMcpMetrics({ amount_spent: '₹0.00 INR', results: { value: 'Not available' } })).resultLabel, null);
});

test('normal reporting uses the Marketing API and reports the store\'s mode', async () => {
  const log = world({});
  const r = await report();
  assert.equal(r.body.error, undefined, JSON.stringify(r.body));
  assert.deepEqual([r.body.source, r.body.mode, r.body.automation], ['meta', 'automated', 'available']);
  assert.equal(r.body.totals.roas, 3.25);
  assert.equal(r.body.totals.spend, 450);
  assert.equal(log.mcpTools.length, 0, 'no automation call when the Marketing API answers');
});

test('a Marketing API failure on an automation-enabled account falls back to automation figures', async () => {
  const log = world({ graphError: { code: 200, message: 'Permissions error' } });
  const r = await report();
  assert.equal(r.body.error, undefined, JSON.stringify(r.body));
  assert.equal(r.body.source, 'automation');
  assert.equal(r.body.totals.spend, 450);
  assert.equal(r.body.campaigns[0].costPerResult, 3.75);
  assert.equal(log.mcpTools.every((t) => t.name === 'ads_get_ad_entities'), true, 'reads only');
  assert.equal(/mcp|STORE-TOKEN/i.test(JSON.stringify(r.body)), false);
});

test('a Marketing API failure without automation is shown as an error, never as zeros', async () => {
  const log = world({ scopes: ['ads_management', 'ads_read'], graphError: { code: 200, message: 'Permissions error' } });
  const r = await report();
  assert.equal(r.body.error, 'meta_error');
  assert.equal(r.body.mode, 'standard');
  assert.equal(log.mcpTools.length, 0);
});

test('a dead token is recorded as expired and the merchant is asked to reconnect', async () => {
  const log = world({ graphError: { code: 190, type: 'OAuthException', message: 'Error validating access token' } });
  const r = await report();
  assert.equal(r.body.error, 'reauth');
  assert.deepEqual(log.patches.map((p) => p.token_status), ['expired']);
});

test('a token past its expiry date asks to reconnect without calling Meta', async () => {
  const log = world({ expiresAt: new Date(Date.now() - 1000).toISOString() });
  let graphCalls = 0;
  const inner = globalThis.fetch;
  globalThis.fetch = async (url, init) => { if (String(url).startsWith('https://graph.facebook.com')) graphCalls += 1; return inner(url, init); };
  const r = await report();
  assert.equal(r.body.error, 'reauth');
  assert.equal(graphCalls, 0);
  assert.equal(log.mcpTools.length, 0);
});
