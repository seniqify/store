// What can this store do with Meta ads, and through which engine? Server-only.
//
// Three merchant states (merchant-facing words live in the UI, never here):
//   not_connected — no usable Meta connection               → "Connect Meta"
//   full          — ads_mcp_management granted AND Meta has
//                   enabled the selected ad account          → engine 'mcp'
//   limited       — connected, but automation is off or not
//                   granted for this account                 → engine 'graph'
//                   (Marketing API) if permissions allow,
//                   otherwise reporting only or nothing
//   reconnect     — the token expired or was revoked
//
// Eligibility can differ account by account, so it is always resolved for the
// ad account the store actually advertises from.
import { openMcpSession } from './_mcp.js';

export const SCOPES = Object.freeze({
  mcp: 'ads_mcp_management',
  write: 'ads_management',
  read: 'ads_read',
});

// Days before expiry at which Manage starts asking the merchant to reconnect.
export const EXPIRY_WARNING_DAYS = 7;

/** ads_get_ad_accounts payload → one normalised row per ad account. */
export function normalizeMcpAccounts(payload) {
  const rows = Array.isArray(payload?.ad_accounts) ? payload.ad_accounts
    : Array.isArray(payload) ? payload : [];
  return rows.map((a) => {
    const digits = String(a?.ad_account_id ?? a?.id ?? '').trim().replace(/^(?:act_)+/i, '');
    if (!/^\d+$/.test(digits)) return null;
    const minBudget = Number(a?.min_daily_budget_cents);
    return {
      id: `act_${digits}`,
      name: String(a?.ad_account_name || a?.name || ''),
      businessId: a?.business_id ? String(a.business_id) : null,
      businessName: a?.business_name || null,
      // Exactly Meta's flag: true → available, false → unavailable, absent → unknown.
      automation: a?.is_ads_mcp_enabled === true ? 'available'
        : a?.is_ads_mcp_enabled === false ? 'unavailable' : 'unknown',
      automationNote: a?.is_ads_mcp_disabled_reason || null,
      queryable: a?.is_queryable !== false,
      notQueryableReason: a?.not_queryable_reason || null,
      status: a?.account_status || null,
      currency: a?.currency || null,
      hasPaymentMethod: a?.has_payment_method === true,
      minDailyBudgetMinor: Number.isFinite(minBudget) ? minBudget : null,
    };
  }).filter(Boolean);
}

/** 'valid' | 'expiring' | 'expired' — from the stored expiry. No expiry → 'valid'. */
export function tokenStatus(expiresAt, now = Date.now()) {
  if (!expiresAt) return 'valid';
  const t = Date.parse(expiresAt);
  if (!Number.isFinite(t)) return 'valid';
  if (t <= now) return 'expired';
  if (t - now <= EXPIRY_WARNING_DAYS * 86400000) return 'expiring';
  return 'valid';
}

/**
 * Decide the engine and permissions for one store + ad account.
 *   connected     — a stored, non-revoked connection with a token
 *   scopes        — permissions Meta granted (live check preferred)
 *   account       — normalised row for the selected ad account, or null
 *   mcpReachable  — false after the MCP server refused this token (401)
 *   tokenExpired  — true when the token is past expiry or Meta said reauth
 */
export function resolveEngine({ connected = false, scopes = [], account = null, mcpReachable = true, tokenExpired = false } = {}) {
  const none = { engine: null, canRead: false, canCreate: false };
  if (!connected) return { state: 'not_connected', ...none, automation: 'unknown', reason: 'connect' };
  if (tokenExpired) return { state: 'reconnect', ...none, automation: account?.automation || 'unknown', reason: 'reauth' };

  const granted = new Set(Array.isArray(scopes) ? scopes : []);
  const hasMcpScope = granted.has(SCOPES.mcp);
  const automation = hasMcpScope ? (account?.automation || 'unknown') : 'unknown';

  // A disabled or closed account can't be read or advertised from by any engine.
  if (account && account.queryable === false) {
    return { state: 'limited', ...none, automation, reason: 'account_unavailable' };
  }

  if (hasMcpScope && automation === 'available' && mcpReachable !== false) {
    return { state: 'full', engine: 'mcp', canRead: true, canCreate: true, automation, reason: null };
  }

  const canCreate = granted.has(SCOPES.write);
  const canRead = canCreate || granted.has(SCOPES.read);
  let reason = 'automation_unknown';
  if (!canRead) reason = 'missing_permissions';
  else if (hasMcpScope && automation === 'unavailable') reason = 'automation_unavailable';
  else if (!hasMcpScope) reason = 'automation_not_granted';
  else if (mcpReachable === false) reason = 'automation_refused';
  return { state: 'limited', engine: canRead ? 'graph' : null, canRead, canCreate, automation, reason };
}

/**
 * Merchant production writes (create / activate / edits) stay OFF until Meta's
 * approval is confirmed. Until then only pilot stores may write.
 *   META_ADS_MERCHANT_WRITES=on      → every store
 *   META_ADS_PILOT_SLUGS=a,b         → just these (default: showme)
 */
export function merchantWritesAllowed(slug, env = process.env) {
  if (String(env.META_ADS_MERCHANT_WRITES || '').trim().toLowerCase() === 'on') return true;
  const pilots = String(env.META_ADS_PILOT_SLUGS ?? 'showme')
    .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  return pilots.includes(String(slug || '').trim().toLowerCase());
}

/**
 * Ask Meta which ad accounts this token can use and whether each is enabled for
 * ads automation. Read-only.
 * → { ok: true, accounts }  or  { ok: false, error: { code, message }, accounts: [] }
 * error.code 'unauthorized' means the token has no MCP access (e.g. the app or
 * login did not grant ads_mcp_management) — not that Meta is down.
 */
export async function fetchAutomationAccounts(token, opts = {}) {
  const session = await openMcpSession(token, opts);
  if (session.error) return { ok: false, error: session.error, accounts: [] };
  const accounts = [];
  let cursor;
  for (let page = 0; page < 5; page++) {
    const r = await session.call('ads_get_ad_accounts', cursor ? { cursor, limit: 50 } : { limit: 50 });
    if (!r.ok) return { ok: false, error: r.error, accounts };
    accounts.push(...normalizeMcpAccounts(r.data));
    cursor = r.data?.next_cursor || r.data?.pagination?.next_cursor || null;
    if (!cursor) break;
  }
  return { ok: true, accounts };
}
