// Meta Ads MCP client + capability resolver. No network: the MCP server is faked
// with an in-memory fetch, so these pin behaviour, not Meta's uptime.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  toolClass, conversationId, parseMcpBody, decodeToolResult, mapMcpError, openMcpSession,
  READ_TOOLS, WRITE_TOOLS, SPEND_TOOLS,
} from '../api/meta/_mcp.js';
import {
  normalizeMcpAccounts, resolveEngine, tokenStatus, merchantWritesAllowed, fetchAutomationAccounts, SCOPES,
} from '../api/meta/_capabilities.js';

// ── fake MCP server ──────────────────────────────────────────────────────────
function fakeMcp({ initStatus = 200, tools = {} } = {}) {
  const calls = [];
  const fetchImpl = async (url, { headers, body }) => {
    const msg = JSON.parse(body);
    calls.push({ headers, msg });
    const reply = (status, obj, sse = true) => ({
      status,
      headers: { get: (h) => (h.toLowerCase() === 'mcp-session-id' ? 'sess-1' : null) },
      text: async () => (obj == null ? '' : sse ? `event: message\ndata: ${JSON.stringify(obj)}\n\n` : JSON.stringify(obj)),
    });
    if (msg.method === 'initialize') {
      return initStatus === 200
        ? reply(200, { jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2025-06-18', serverInfo: { name: 'Meta Ads MCP Server' } } })
        : reply(initStatus, { title: 'This resource is restricted to certain users.' }, false);
    }
    if (msg.method === 'notifications/initialized') return reply(202, null);
    const handler = tools[msg.params?.name];
    if (!handler) return reply(200, { jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'unknown tool' } });
    return reply(200, { jsonrpc: '2.0', id: msg.id, ...handler(msg.params.arguments) });
  };
  return { fetchImpl, calls };
}
const textResult = (obj, isError = false) => ({ result: { content: [{ type: 'text', text: JSON.stringify(obj) }], isError } });

// ── allowlist ────────────────────────────────────────────────────────────────
test('tools are classified by blast radius, and unknown tools are refused', () => {
  assert.equal(toolClass('ads_get_ad_entities'), 'read');
  assert.equal(toolClass('ads_create_campaign'), 'write');
  assert.equal(toolClass('ads_activate_entity'), 'spend');
  assert.equal(toolClass('ads_delete_custom_audience'), null);
  assert.equal(toolClass('ads_boost_ig_post'), null, 'boosting can spend in one call, so it is not allowed');
});

test('no tool is in two classes, and activation is the only spend tool', () => {
  for (const t of READ_TOOLS) assert.ok(!WRITE_TOOLS.has(t) && !SPEND_TOOLS.has(t), t);
  for (const t of WRITE_TOOLS) assert.ok(!SPEND_TOOLS.has(t), t);
  assert.deepEqual([...SPEND_TOOLS], ['ads_activate_entity']);
});

test('create tools are write, never spend; update is write (it can pause)', () => {
  for (const t of ['ads_create_campaign', 'ads_create_ad_set', 'ads_create_creative', 'ads_create_ad', 'ads_update_entity']) {
    assert.equal(toolClass(t), 'write', t);
  }
});

// ── protocol helpers ─────────────────────────────────────────────────────────
test('conversation id is 20 characters of A-Z a-z 0-9', () => {
  const id = conversationId();
  assert.match(id, /^[A-Za-z0-9]{20}$/);
  assert.notEqual(conversationId(), id);
  assert.equal(conversationId(new Uint8Array(20)), 'A'.repeat(20));
});

test('replies parse from plain JSON and from an SSE stream', () => {
  assert.deepEqual(parseMcpBody('{"jsonrpc":"2.0","id":1,"result":{"x":1}}').result, { x: 1 });
  const sse = 'event: message\ndata: {"jsonrpc":"2.0","method":"notifications/progress"}\n\ndata: {"jsonrpc":"2.0","id":2,"result":{"y":2}}\n\n';
  assert.deepEqual(parseMcpBody(sse).result, { y: 2 });
  assert.equal(parseMcpBody(''), null);
  assert.equal(parseMcpBody('data: not json'), null);
});

test('tool results unwrap JSON nested inside strings (ads_get_ad_entities shape)', () => {
  const data = decodeToolResult({ content: [{ type: 'text', text: '{"ad_entities":"[{\\"name\\":\\"PocketLink · Protine Hub\\",\\"status\\":\\"PAUSED\\"}]"}' }] });
  assert.deepEqual(data, { ad_entities: [{ name: 'PocketLink · Protine Hub', status: 'PAUSED' }] });
  assert.deepEqual(decodeToolResult({ content: [{ type: 'text', text: 'plain words' }] }), { text: 'plain words' });
  assert.equal(decodeToolResult(null), null);
});

// ── error mapping ────────────────────────────────────────────────────────────
test('errors map to codes the product can act on', () => {
  assert.equal(mapMcpError({ network: true }).code, 'unreachable');
  assert.equal(mapMcpError({ httpStatus: 401 }).code, 'unauthorized');
  assert.equal(mapMcpError({ httpStatus: 429 }).code, 'rate_limited');
  assert.equal(mapMcpError({ httpStatus: 503 }).code, 'meta_unavailable');
  assert.equal(mapMcpError({ toolError: { message: 'Ads MCP is gradually being rolled out. Please check back at a later date to use Ads MCP with this Ad Account.' } }).code, 'automation_unavailable');
  assert.equal(mapMcpError({ rpcError: { code: -32602, message: 'Ad account not found or you do not have access. Please verify the ad_account_id is correct' } }).code, 'no_access');
  assert.equal(mapMcpError({ rpcError: { code: -32602, message: 'bad field', data: { error_category: 'VALIDATION' } } }).code, 'invalid');
  assert.equal(mapMcpError({ toolError: { error: { code: 190, message: 'Error validating access token' } } }).code, 'reauth');
  assert.equal(mapMcpError({ toolError: { message: 'something odd' } }).code, 'meta_error');
});

// ── session ──────────────────────────────────────────────────────────────────
test('a session sends the token as a bearer header and a conversation id on every call', async () => {
  const { fetchImpl, calls } = fakeMcp({ tools: { ads_get_ad_accounts: () => textResult({ ad_accounts: [] }) } });
  const s = await openMcpSession('TOKEN-123', { fetchImpl });
  assert.ok(!s.error);
  const r = await s.call('ads_get_ad_accounts', { limit: 50 });
  assert.equal(r.ok, true);
  const toolCall = calls.find((c) => c.msg.method === 'tools/call');
  assert.equal(toolCall.headers.Authorization, 'Bearer TOKEN-123');
  assert.equal(toolCall.headers['Mcp-Session-Id'], 'sess-1');
  assert.match(toolCall.msg.params.arguments.client_conversation_id, /^[A-Za-z0-9]{20}$/);
  assert.equal(toolCall.msg.params.arguments.client_conversation_id, s.conversationId);
});

test('a tool outside the allowlist is refused without contacting Meta', async () => {
  const { fetchImpl, calls } = fakeMcp();
  const s = await openMcpSession('T', { fetchImpl });
  const before = calls.length;
  const r = await s.call('ads_delete_custom_audience', { id: '1' });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'tool_not_allowed');
  assert.equal(calls.length, before);
});

test('activation is refused unless the caller explicitly allows spend', async () => {
  let activated = 0;
  const { fetchImpl } = fakeMcp({ tools: { ads_activate_entity: () => { activated += 1; return textResult({ success: true }); } } });
  const s = await openMcpSession('T', { fetchImpl });
  const refused = await s.call('ads_activate_entity', { entity_id: '1', entity_type: 'campaign', ad_account_id: '9' });
  assert.equal(refused.error.code, 'spend_not_confirmed');
  assert.equal(activated, 0);
  const truthyButNotTrue = await s.call('ads_activate_entity', { entity_id: '1' }, { allowSpend: 'yes' });
  assert.equal(truthyButNotTrue.error.code, 'spend_not_confirmed');
  assert.equal(activated, 0);
  const allowed = await s.call('ads_activate_entity', { entity_id: '1', entity_type: 'campaign', ad_account_id: '9' }, { allowSpend: true });
  assert.equal(allowed.ok, true);
  assert.equal(activated, 1);
});

test('a 401 at initialize (token without MCP access) is reported, not thrown', async () => {
  const { fetchImpl } = fakeMcp({ initStatus: 401 });
  const s = await openMcpSession('T', { fetchImpl });
  assert.equal(s.error.code, 'unauthorized');
});

test('no token means reconnect, and nothing is sent', async () => {
  let sent = 0;
  const s = await openMcpSession('', { fetchImpl: async () => { sent += 1; } });
  assert.equal(s.error.code, 'reauth');
  assert.equal(sent, 0);
});

test('a network failure during a call is "unreachable", never an exception', async () => {
  let n = 0;
  const base = fakeMcp().fetchImpl;
  const fetchImpl = async (url, init) => { n += 1; if (n > 2) throw new Error('socket hang up'); return base(url, init); };
  const s = await openMcpSession('T', { fetchImpl });
  const r = await s.call('ads_get_ad_entities', { ad_account_id: '1' });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'unreachable');
});

test('a tool-level error (isError) is mapped and keeps Meta\'s data for the audit log', async () => {
  const { fetchImpl } = fakeMcp({ tools: { ads_create_ad_set: () => textResult({ message: 'Invalid targeting spec', error_category: 'VALIDATION' }, true) } });
  const s = await openMcpSession('T', { fetchImpl });
  const r = await s.call('ads_create_ad_set', {});
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'invalid');
  assert.equal(r.data.message, 'Invalid targeting spec');
});

test('the token never appears in an error', async () => {
  const { fetchImpl } = fakeMcp({ initStatus: 401 });
  const s = await openMcpSession('SECRET-TOKEN-XYZ', { fetchImpl });
  assert.equal(JSON.stringify(s).includes('SECRET-TOKEN-XYZ'), false);
});

// ── eligibility ──────────────────────────────────────────────────────────────
// Shapes copied from Meta's live ads_get_ad_accounts reply (2026-09-15).
const LIVE = {
  ad_accounts: [
    { ad_account_id: '962613363265198', ad_account_name: 'PocketLink', business_id: '2046280469453502', business_name: 'Seniqify', is_ads_mcp_enabled: true, account_status: 'ACTIVE', is_queryable: true, has_payment_method: true, currency: 'INR', min_daily_budget_cents: 9491, is_ads_mcp_disabled_reason: null, not_queryable_reason: null },
    { ad_account_id: '1485125029900166', ad_account_name: 'Shri Samarth Jewellers (Read-Only)', business_id: '', business_name: '', is_ads_mcp_enabled: false, account_status: 'ACTIVE', is_queryable: true, has_payment_method: false, currency: 'USD', min_daily_budget_cents: 100, is_ads_mcp_disabled_reason: 'Ads MCP is gradually being rolled out. Please check back at a later date to use Ads MCP with this Ad Account.', not_queryable_reason: null },
    { ad_account_id: '26443868945229654', ad_account_name: 'Shobha IVF', business_id: '2196064100927504', business_name: 'Shobha IVF', is_ads_mcp_enabled: true, account_status: 'CLOSED', is_queryable: false, has_payment_method: false, currency: 'INR', min_daily_budget_cents: 9491, not_queryable_reason: 'Unknown error' },
  ],
};

test('ad accounts normalise with Meta\'s eligibility flag kept exactly', () => {
  const [pl, jewel, closed] = normalizeMcpAccounts(LIVE);
  assert.equal(pl.id, 'act_962613363265198');
  assert.equal(pl.automation, 'available');
  assert.equal(pl.minDailyBudgetMinor, 9491);
  assert.equal(jewel.automation, 'unavailable');
  assert.match(jewel.automationNote, /gradually being rolled out/);
  assert.equal(jewel.businessId, null, 'an empty business id is no business');
  assert.equal(closed.queryable, false);
  assert.equal(normalizeMcpAccounts({ ad_accounts: [{ ad_account_id: 'act_act_12' }, { ad_account_id: 'junk' }, {}] }).map((a) => a.id).join(), 'act_12');
  assert.equal(normalizeMcpAccounts({ ad_accounts: [{ ad_account_id: '5' }] })[0].automation, 'unknown');
});

test('fetchAutomationAccounts pages through Meta and reports a missing MCP grant as unauthorized', async () => {
  let page = 0;
  const { fetchImpl } = fakeMcp({
    tools: {
      ads_get_ad_accounts: (args) => {
        page += 1;
        return page === 1
          ? textResult({ ad_accounts: LIVE.ad_accounts.slice(0, 2), next_cursor: 'c2' })
          : (assert.equal(args.cursor, 'c2'), textResult({ ad_accounts: LIVE.ad_accounts.slice(2), next_cursor: null }));
      },
    },
  });
  const ok = await fetchAutomationAccounts('T', { fetchImpl });
  assert.equal(ok.ok, true);
  assert.equal(ok.accounts.length, 3);

  const refused = await fetchAutomationAccounts('T', { fetchImpl: fakeMcp({ initStatus: 401 }).fetchImpl });
  assert.equal(refused.ok, false);
  assert.equal(refused.error.code, 'unauthorized');
});

// ── engine resolution: the three merchant states ─────────────────────────────
const [PL, JEWEL, CLOSED] = normalizeMcpAccounts(LIVE);
const ALL = [SCOPES.mcp, SCOPES.write, SCOPES.read, 'business_management', 'pages_show_list'];

test('STATE 3: not connected → connect, nothing allowed', () => {
  const r = resolveEngine({ connected: false });
  assert.equal(r.state, 'not_connected');
  assert.equal(r.engine, null);
  assert.equal(r.canCreate, false);
});

test('STATE 1: MCP granted + account enabled → full automation through MCP', () => {
  const r = resolveEngine({ connected: true, scopes: ALL, account: PL });
  assert.deepEqual([r.state, r.engine, r.canCreate, r.automation], ['full', 'mcp', true, 'available']);
});

test('STATE 2: account not enabled → limited, falls back to the Marketing API, onboarding still succeeds', () => {
  const r = resolveEngine({ connected: true, scopes: ALL, account: JEWEL });
  assert.deepEqual([r.state, r.engine, r.canCreate, r.automation, r.reason], ['limited', 'graph', true, 'unavailable', 'automation_unavailable']);
});

test('STATE 2 without write permission → reports only', () => {
  const r = resolveEngine({ connected: true, scopes: [SCOPES.mcp, SCOPES.read], account: JEWEL });
  assert.deepEqual([r.state, r.engine, r.canRead, r.canCreate], ['limited', 'graph', true, false]);
});

test('the MCP permission missing (today\'s connections) → fallback, eligibility unknown', () => {
  const r = resolveEngine({ connected: true, scopes: [SCOPES.write, SCOPES.read], account: PL });
  assert.deepEqual([r.state, r.engine, r.automation, r.reason], ['limited', 'graph', 'unknown', 'automation_not_granted']);
});

test('MCP refused the token at runtime → fallback even if the account is enabled', () => {
  const r = resolveEngine({ connected: true, scopes: ALL, account: PL, mcpReachable: false });
  assert.deepEqual([r.state, r.engine, r.reason], ['limited', 'graph', 'automation_refused']);
});

test('a closed or disabled ad account cannot be used by any engine', () => {
  const r = resolveEngine({ connected: true, scopes: ALL, account: CLOSED });
  assert.deepEqual([r.engine, r.canRead, r.canCreate, r.reason], [null, false, false, 'account_unavailable']);
});

test('an expired token asks to reconnect before anything else', () => {
  const r = resolveEngine({ connected: true, scopes: ALL, account: PL, tokenExpired: true });
  assert.deepEqual([r.state, r.engine, r.reason], ['reconnect', null, 'reauth']);
});

test('no permissions at all → nothing, and says so', () => {
  const r = resolveEngine({ connected: true, scopes: ['public_profile'], account: null });
  assert.deepEqual([r.engine, r.canRead, r.reason], [null, false, 'missing_permissions']);
});

// ── token expiry + merchant write gate ───────────────────────────────────────
test('token status warns a week before expiry', () => {
  const now = Date.parse('2026-09-15T00:00:00Z');
  assert.equal(tokenStatus(null, now), 'valid');
  assert.equal(tokenStatus('2026-11-10T06:16:43Z', now), 'valid');
  assert.equal(tokenStatus('2026-09-20T00:00:00Z', now), 'expiring');
  assert.equal(tokenStatus('2026-09-14T23:59:59Z', now), 'expired');
  assert.equal(tokenStatus('not a date', now), 'valid');
});

test('merchant writes are off by default except for the pilot store', () => {
  assert.equal(merchantWritesAllowed('showme', {}), true);
  assert.equal(merchantWritesAllowed('royalfoodsmasale', {}), false);
  assert.equal(merchantWritesAllowed('Sankalp', { META_ADS_PILOT_SLUGS: 'sankalp, showme' }), true);
  assert.equal(merchantWritesAllowed('showme', { META_ADS_PILOT_SLUGS: '' }), false, 'an empty pilot list means nobody');
  assert.equal(merchantWritesAllowed('anyone', { META_ADS_MERCHANT_WRITES: 'ON' }), true);
  assert.equal(merchantWritesAllowed('anyone', { META_ADS_MERCHANT_WRITES: 'yes' }), false, 'only the exact word on switches it on');
});
