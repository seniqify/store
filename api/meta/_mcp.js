// Meta Ads MCP client — server-only. The underscore keeps this file out of
// Vercel's route table (same convention as _meta.js).
//
// Speaks MCP's streamable-HTTP transport to Meta's hosted ads server
// (https://mcp.facebook.com/ads) with the store's own access token. PocketLink
// calls it as an execution and reporting layer; merchants never see it named.
//
// Rules the rest of the integration relies on:
//   • Only allowlisted tools can be called, grouped by blast radius:
//       READ  — never changes anything
//       WRITE — creates PAUSED objects or edits existing ones
//       SPEND — starts delivery; the caller must pass allowSpend: true, which
//               only the confirmed-activation path does
//   • Errors come back as a small set of codes (mapMcpError). Callers branch on
//     the code; merchant-facing words live in the UI.
//   • The access token is never logged, returned or put in an error message.
import crypto from 'node:crypto';

export const MCP_URL = process.env.META_MCP_URL || 'https://mcp.facebook.com/ads';
export const MCP_PROTOCOL = '2025-06-18';

export const READ_TOOLS = new Set([
  'ads_get_ad_accounts',
  'ads_catalog_get_businesses',
  'ads_get_user_pages',
  'ads_get_ad_account_pages',
  'ads_get_pages_for_business',
  'ads_get_ig_accounts',
  'ads_get_ad_entities',
  'ads_get_errors',
  'ads_get_ad_preview',
  'ads_get_field_context',
  'ads_get_creatives',
  'ads_get_ad_images',
]);

export const WRITE_TOOLS = new Set([
  'ads_creative_upload_media',
  'ads_create_campaign',
  'ads_create_ad_set',
  'ads_create_creative',
  'ads_create_ad',
  'ads_update_entity',
]);

export const SPEND_TOOLS = new Set(['ads_activate_entity']);

/** 'read' | 'write' | 'spend' | null (not allowed). */
export function toolClass(name) {
  if (READ_TOOLS.has(name)) return 'read';
  if (WRITE_TOOLS.has(name)) return 'write';
  if (SPEND_TOOLS.has(name)) return 'spend';
  return null;
}

// Meta asks for a 20-character [A-Za-z0-9] id on every tool call, shared by the
// calls of one conversation, so one PocketLink request = one conversation.
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
export function conversationId(bytes = crypto.randomBytes(20)) {
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
}

/** A JSON-RPC reply from either a plain JSON body or an SSE stream (last reply wins). */
export function parseMcpBody(text) {
  const raw = String(text ?? '').trim();
  if (!raw) return null;
  if (raw.startsWith('{')) {
    try { return JSON.parse(raw); } catch { return null; }
  }
  let reply = null;
  for (const line of raw.split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue;
    try {
      const msg = JSON.parse(line.slice(5).trim());
      if (msg && (msg.result !== undefined || msg.error !== undefined)) reply = msg;
    } catch { /* keep-alive or partial line */ }
  }
  return reply;
}

// Meta's tools return JSON as text, and some fields inside are themselves JSON
// strings (ads_get_ad_entities → {"ad_entities":"[…]"}). Unwrap those so callers
// get plain objects. Depth-limited: a string that merely looks like JSON stays.
function unwrapJsonStrings(value, depth = 0) {
  if (depth > 4) return value;
  if (typeof value === 'string') {
    const s = value.trim();
    const looksJson = (s.startsWith('[') && s.endsWith(']')) || (s.startsWith('{') && s.endsWith('}'));
    if (!looksJson) return value;
    try { return unwrapJsonStrings(JSON.parse(s), depth + 1); } catch { return value; }
  }
  if (Array.isArray(value)) return value.map((v) => unwrapJsonStrings(v, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, unwrapJsonStrings(v, depth + 1)]));
  }
  return value;
}

/** Tool result → plain data. Prefers structuredContent; falls back to the text parts. */
export function decodeToolResult(result) {
  if (!result) return null;
  if (result.structuredContent && typeof result.structuredContent === 'object') {
    return unwrapJsonStrings(result.structuredContent);
  }
  const text = (Array.isArray(result.content) ? result.content : [])
    .map((c) => (typeof c?.text === 'string' ? c.text : ''))
    .join('');
  if (!text) return null;
  try { return unwrapJsonStrings(JSON.parse(text)); } catch { return { text }; }
}

function errorText(source) {
  if (!source) return '';
  if (typeof source === 'string') return source;
  // Meta's tools report failures as { error_category, error_message, error_subcode }.
  return String(source.error_message || source.message || source.error?.message || source.error_user_msg || source.detail || source.text || '');
}

/**
 * Map any failure to { code, message }. `message` is Meta's own wording, for logs
 * and the audit table — never shown to merchants as-is.
 *
 *   unreachable            network failure or timeout (a WRITE may still have landed)
 *   unauthorized           401 — token lacks MCP access (e.g. no ads_mcp_management)
 *   forbidden              403
 *   rate_limited           429 or Meta throttling
 *   meta_unavailable       5xx
 *   automation_unavailable ad account not enabled for Meta's ads automation yet
 *   no_access              ad account/object not found or not shared with this user
 *   reauth                 token expired or revoked
 *   invalid                Meta rejected the input
 *   meta_error             anything else
 */
export function mapMcpError({ httpStatus = 0, rpcError = null, toolError = null, network = false } = {}) {
  if (network) return { code: 'unreachable', message: 'Could not reach Meta.' };
  const msg = errorText(rpcError) || errorText(toolError);
  if (httpStatus === 401) return { code: 'unauthorized', message: msg || 'Meta refused this connection for ads automation.' };
  if (httpStatus === 403) return { code: 'forbidden', message: msg || 'Meta refused this request.' };
  if (httpStatus === 429) return { code: 'rate_limited', message: msg || 'Meta is rate limiting requests.' };
  if (httpStatus >= 500) return { code: 'meta_unavailable', message: msg || 'Meta is temporarily unavailable.' };

  const data = rpcError?.data || toolError?.error || toolError || {};
  if (/gradually being rolled out|not (yet )?enabled for ads mcp|is_ads_mcp_enabled/i.test(msg)) {
    return { code: 'automation_unavailable', message: msg };
  }
  if (Number(data?.code) === 190 || /access token|session has expired|has been invalidated|OAuthException/i.test(msg)) {
    return { code: 'reauth', message: msg };
  }
  if (/not found or you do not have access|do not have (permission|access)/i.test(msg)) {
    return { code: 'no_access', message: msg };
  }
  if (/rate limit|too many calls|request limit reached/i.test(msg) || [4, 17, 32, 613].includes(Number(data?.code))) {
    return { code: 'rate_limited', message: msg };
  }
  if (rpcError?.code === -32602 || /VALIDATION/i.test(msg) || data?.error_category === 'VALIDATION') {
    return { code: 'invalid', message: msg };
  }
  return { code: 'meta_error', message: msg || 'Meta returned an error.' };
}

/**
 * Open an MCP session for one PocketLink request.
 * → { call(name, args, opts), conversationId }  or  { error: { code, message } }
 *
 * call() resolves to { ok: true, data } or { ok: false, error, data? }. It never
 * throws. A WRITE that ends in 'unreachable' may still have succeeded on Meta's
 * side — callers must read back before retrying a create.
 */
export async function openMcpSession(token, { fetchImpl = fetch, timeoutMs = 20000, url = MCP_URL } = {}) {
  if (!token) return { error: { code: 'reauth', message: 'No access token.' } };
  let sessionId = null;
  let nextId = 0;
  const conv = conversationId();

  async function post(payload, expectReply = true) {
    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${token}`,
      'MCP-Protocol-Version': MCP_PROTOCOL,
    };
    if (sessionId) headers['Mcp-Session-Id'] = sessionId;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const r = await fetchImpl(url, { method: 'POST', headers, body: JSON.stringify(payload), signal: ctrl.signal });
      sessionId = r.headers?.get?.('mcp-session-id') || sessionId;
      if (!expectReply) return { httpStatus: r.status };
      return { httpStatus: r.status, body: parseMcpBody(await r.text()) };
    } catch {
      return { network: true };
    } finally {
      clearTimeout(timer);
    }
  }

  const init = await post({
    jsonrpc: '2.0', id: ++nextId, method: 'initialize',
    params: { protocolVersion: MCP_PROTOCOL, capabilities: {}, clientInfo: { name: 'pocketlink', version: '1' } },
  });
  if (init.network) return { error: mapMcpError({ network: true }) };
  if (init.httpStatus !== 200 || !init.body?.result) {
    return { error: mapMcpError({ httpStatus: init.httpStatus === 200 ? 0 : init.httpStatus, rpcError: init.body?.error }) };
  }
  await post({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }, false);

  async function call(name, args = {}, { allowSpend = false, request = '' } = {}) {
    const kind = toolClass(name);
    if (!kind) return { ok: false, error: { code: 'tool_not_allowed', message: String(name) } };
    if (kind === 'spend' && allowSpend !== true) {
      return { ok: false, error: { code: 'spend_not_confirmed', message: String(name) } };
    }
    const argumentsWithTrace = { ...args, client_conversation_id: conv };
    if (request) argumentsWithTrace.advertiser_request = String(request).slice(0, 500);

    const res = await post({ jsonrpc: '2.0', id: ++nextId, method: 'tools/call', params: { name, arguments: argumentsWithTrace } });
    if (res.network) return { ok: false, error: mapMcpError({ network: true }) };
    if (res.httpStatus !== 200) return { ok: false, error: mapMcpError({ httpStatus: res.httpStatus, rpcError: res.body?.error }) };
    if (!res.body) return { ok: false, error: { code: 'meta_error', message: 'Empty reply from Meta.' } };
    if (res.body.error) return { ok: false, error: mapMcpError({ rpcError: res.body.error }) };
    const data = decodeToolResult(res.body.result);
    if (res.body.result?.isError) return { ok: false, error: mapMcpError({ toolError: data }), data };
    return { ok: true, data };
  }

  return { call, conversationId: conv };
}
