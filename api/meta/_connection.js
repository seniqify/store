// The merchant's Meta connection, as the Ads screen needs it. Server-only.
//
// One payload answers: which state is this store in, what may the merchant do,
// what can they choose from (business, Facebook Page, Instagram account, ad
// account), what is currently chosen, and whether Meta has enabled ads
// automation for each ad account.
//
// Guarantees:
//   • tenant isolation — only ad accounts this store granted at consent are ever
//     listed or chosen, even if Meta's automation server knows more accounts
//   • no tokens, and no protocol wording, leave the server: the engine is 'mcp' /
//     'graph' in here but the browser only sees mode 'automated' / 'standard'
//   • a failed eligibility check never blocks the connection; a transient
//     failure keeps the last known snapshot
import { graphGet, normalizeAdAccountId, resolveAdAccount, updateMetaStatus, serviceKey, SB } from './_meta.js';
import { fetchAutomationAccounts, resolveEngine, tokenStatus, merchantWritesAllowed, SCOPES } from './_capabilities.js';
import { accountPixels, trackingStatus } from './_orderTracking.js';

export const SNAPSHOT_MAX_AGE_MS = 6 * 60 * 60 * 1000;

const unknownAccount = (id, name = '') => ({
  id, name, businessId: null, businessName: null, automation: 'unknown', automationNote: null,
  queryable: true, notQueryableReason: null, status: null, currency: null, hasPaymentMethod: false, minDailyBudgetMinor: null,
});

/**
 * Granted ad account ids + an eligibility snapshot → one row per GRANTED account.
 * Snapshot rows for accounts the store did not grant are dropped.
 */
export function mergeAdAccounts(grantedIds = [], snapshot = []) {
  const byId = new Map((Array.isArray(snapshot) ? snapshot : [])
    .map((a) => [normalizeAdAccountId(a?.id), a])
    .filter(([id]) => id));
  const seen = new Set();
  const out = [];
  for (const raw of Array.isArray(grantedIds) ? grantedIds : []) {
    const id = normalizeAdAccountId(raw);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const s = byId.get(id);
    out.push(s ? { ...unknownAccount(id), ...s, id } : unknownAccount(id));
  }
  return out;
}

/** What the browser may see about an ad account. */
export function publicAccount(a) {
  return {
    id: a.id,
    name: a.name || '',
    businessId: a.businessId || null,
    businessName: a.businessName || null,
    automation: a.automation || 'unknown',
    usable: a.queryable !== false,
    unusableReason: a.queryable === false ? (a.notQueryableReason || 'This ad account can’t be used right now.') : null,
    status: a.status || null,
    currency: a.currency || null,
    hasPaymentMethod: a.hasPaymentMethod === true,
  };
}

/** Engine decision → what the browser may see (no engine names). */
export function clientState(decision) {
  return {
    state: decision.state,
    mode: decision.engine === 'mcp' ? 'automated' : decision.engine === 'graph' ? 'standard' : null,
    canRead: decision.canRead,
    canCreate: decision.canCreate,
    automation: decision.automation,
    reason: decision.reason,
  };
}

export function snapshotIsStale(checkedAt, now = Date.now()) {
  const t = Date.parse(checkedAt || '');
  return !Number.isFinite(t) || now - t > SNAPSHOT_MAX_AGE_MS;
}

/**
 * Ask Meta which granted ad accounts are enabled for ads automation, and store
 * the snapshot (best effort). 'unauthorized' (the token has no automation
 * access) marks every account unknown; any other failure keeps `previous`.
 */
export async function refreshEligibility(slug, acct, { previous = [], mcpFetch } = {}) {
  const r = await fetchAutomationAccounts(acct.access_token, mcpFetch ? { fetchImpl: mcpFetch } : {});
  const checkedAt = new Date().toISOString();
  const error = r.ok ? null : (r.error?.code || 'meta_error');
  const snapshot = r.ok || error === 'unauthorized'
    ? mergeAdAccounts(acct.ad_account_ids, r.accounts)
    : mergeAdAccounts(acct.ad_account_ids, previous);
  await updateMetaStatus(slug, { ad_accounts: snapshot, mcp_checked_at: checkedAt, mcp_error: error });
  return { snapshot, checkedAt, error };
}

/** Graph /me/businesses → [{ id, name }]. Empty on any failure. */
export async function liveBusinesses(token) {
  const r = await graphGet('me/businesses', { fields: 'id,name', limit: '50', access_token: token });
  return (Array.isArray(r?.body?.data) ? r.body.data : [])
    .filter((b) => /^\d+$/.test(String(b?.id || '')))
    .map((b) => ({ id: String(b.id), name: b.name || '' }));
}

/** Best-effort audit row. Never throws; a missing table (SQL not applied) is ignored. */
export async function logAdAction(row) {
  try {
    const key = serviceKey();
    if (!key) return false;
    const r = await fetch(`${SB}/rest/v1/meta_ad_actions`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify(row),
    });
    return r.ok;
  } catch {
    return false;
  }
}

/**
 * The server-side view: engine decision (with 'mcp' / 'graph'), live scopes,
 * accounts with eligibility, the selected account. Routes use this to decide how
 * to execute; buildConnection turns it into the browser payload.
 */
export async function resolveConnection({ slug, acct, refresh = false, mcpFetch } = {}) {
  const connected = Boolean(acct && acct.status === 'connected' && acct.access_token);
  if (!connected) return { connected: false, decision: resolveEngine({ connected: false }), scopes: [], accounts: [], picked: { available: [] } };

  const token = acct.access_token;
  let status = tokenStatus(acct.expires_at);

  // Live grant. A 190 means the token is dead whatever expires_at says.
  const perms = await graphGet('me/permissions', { access_token: token });
  const permError = perms?.body?.error;
  if (permError && (Number(permError.code) === 190 || permError.type === 'OAuthException')) status = 'expired';
  const scopes = Array.isArray(perms?.body?.data)
    ? perms.body.data.filter((p) => p?.status === 'granted').map((p) => p.permission)
    : (Array.isArray(acct.scopes) ? acct.scopes : []);
  if (status !== (acct.token_status || 'valid')) await updateMetaStatus(slug, { token_status: status });

  const expired = status === 'expired';
  let snapshot = Array.isArray(acct.ad_accounts) ? acct.ad_accounts : [];
  let checkedAt = acct.mcp_checked_at || null;
  let eligibilityError = acct.mcp_error || null;
  if (!expired && scopes.includes(SCOPES.mcp) && (refresh || snapshotIsStale(checkedAt))) {
    const r = await refreshEligibility(slug, acct, { previous: snapshot, mcpFetch });
    snapshot = r.snapshot;
    checkedAt = r.checkedAt;
    eligibilityError = r.error;
  }

  const accounts = mergeAdAccounts(acct.ad_account_ids, snapshot);
  const picked = resolveAdAccount(acct);
  const selectedAccount = picked.adAccount ? accounts.find((a) => a.id === picked.adAccount) || null : null;
  const decision = resolveEngine({
    connected: true, scopes, account: selectedAccount,
    mcpReachable: eligibilityError !== 'unauthorized', tokenExpired: expired,
  });
  return { connected: true, decision, scopes, status, expired, accounts, picked, selectedAccount, checkedAt, eligibilityError };
}

/**
 * The connection payload for the Ads screen. May refresh the eligibility
 * snapshot (when stale, or when `refresh`). Never returns a token or engine name.
 */
export async function buildConnection({ slug, acct, config, refresh = false, env = process.env, mcpFetch } = {}) {
  const writesEnabled = merchantWritesAllowed(slug, env);
  const r = await resolveConnection({ slug, acct, refresh, mcpFetch });
  if (!r.connected) {
    return { ...clientState(r.decision), tokenStatus: null, writesEnabled, businesses: [], pages: [], adAccounts: [], selected: {} };
  }

  const meta = config?.meta || {};
  const pages = (Array.isArray(meta.pages) ? meta.pages : []).map((p) => ({
    id: String(p.id), name: p.name || 'Facebook Page', instagram: p.ig?.id ? { id: String(p.ig.id), username: p.ig.username || '' } : null,
  }));

  return {
    ...clientState(r.decision),
    tokenStatus: r.status,
    expiresAt: acct.expires_at || null,
    permissions: { automation: r.scopes.includes(SCOPES.mcp), manage: r.scopes.includes(SCOPES.write), read: r.scopes.includes(SCOPES.read) },
    writesEnabled,
    businesses: r.expired ? [] : await liveBusinesses(acct.access_token),
    pages,
    adAccounts: r.accounts.map(publicAccount),
    eligibilityCheckedAt: r.checkedAt,
    needsAdAccountChoice: r.picked.error === 'ad_account_not_selected',
    // Whether an orders campaign can optimise on this store's orders in the chosen ad account.
    orderTracking: r.picked.adAccount && !r.expired ? trackingStatus(config, await accountPixels(r.picked.adAccount, acct.access_token)) : null,
    selected: {
      businessId: meta.businessId || acct.business_id || null,
      pageId: meta.pageId || null,
      instagramId: meta.igId || null,
      adAccountId: r.picked.adAccount || null,
    },
  };
}

/** The chosen business, only if the token can still see it. */
export function matchBusiness(businesses, businessId) {
  const id = String(businessId || '').replace(/\D/g, '');
  return id ? (businesses || []).find((b) => b.id === id) || null : null;
}

/**
 * The chosen Instagram account, only if it is the one linked to the selected
 * Facebook Page (ads deliver on Instagram through that Page). '' clears it.
 * → { ig } | { clear: true } | { error }
 */
export function matchInstagram(livePages, pageId, igId) {
  const want = String(igId || '').replace(/\D/g, '');
  if (!want) return { clear: true };
  const page = (livePages || []).find((p) => String(p?.id) === String(pageId || ''));
  if (!page) return { error: 'page_not_selected' };
  const ig = page.instagram_business_account || page.instagram || page.ig || null;
  if (!ig?.id || String(ig.id) !== want) return { error: 'ig_not_on_page' };
  return { ig: { id: String(ig.id), username: ig.username || ig.name || '' } };
}
