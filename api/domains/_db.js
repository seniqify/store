// Service-role database access for custom domains -- server-only.
//
// Writes go ONLY through the PR-B RPCs (domain_*), which enforce every rule in
// the database: first-proof-wins, the Vercel fences, the ready gate, step-up
// challenges, TTLs. This module never writes a domain table directly (the
// service role has no write privilege on them anyway). Reads use the SELECT
// that PR-B grants service_role on store_domains, plus the store's config for
// the authoritative owner phone.
//
// Fails CLOSED: any non-2xx or network failure throws DomainDbError, which the
// callers turn into a refusal, never into a guessed success.
//
// With a budget (_budget.js), each call's timeout is capped at the time left
// before the HARD deadline (recording results may use the reserve), and no
// call starts with less than MIN_DB_MS left.
import { MIN_DB_MS } from './_budget.js';

export class DomainDbError extends Error {
  constructor(code) {
    super(code);
    this.name = 'DomainDbError';
    this.code = code;
  }
}

export const GROUP_COLUMNS = [
  'group_id', 'store_slug', 'hostname', 'kind', 'role', 'status', 'end_reason', 'txt_token',
  'vercel_state', 'vercel_state_at', 'expires_at', 'consecutive_health_failures',
  'last_checked_at', 'last_error', 'created_at', 'verified_at', 'activated_at', 'ended_at',
].join(',');

export const OPEN_STATUSES = ['pending', 'verified', 'ready', 'connected', 'misconfigured', 'disconnecting'];

/** Rows -> groups ({ group_id, store_slug, status, ..., rows: [...] }), newest first. */
export function groupRows(rows) {
  const byId = new Map();
  for (const r of rows || []) {
    if (!byId.has(r.group_id)) {
      byId.set(r.group_id, {
        group_id: r.group_id, store_slug: r.store_slug, status: r.status, end_reason: r.end_reason,
        txt_token: r.txt_token, expires_at: r.expires_at, created_at: r.created_at,
        consecutive_health_failures: r.consecutive_health_failures, last_checked_at: r.last_checked_at,
        verified_at: r.verified_at, activated_at: r.activated_at, ended_at: r.ended_at, rows: [],
      });
    }
    byId.get(r.group_id).rows.push({
      hostname: r.hostname, kind: r.kind, role: r.role, vercel_state: r.vercel_state,
      vercel_state_at: r.vercel_state_at, last_error: r.last_error,
    });
  }
  const groups = [...byId.values()];
  for (const g of groups) {
    g.rows.sort((a, b) => (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0));   // apex, subdomain, www
    g.primary = g.rows.find((r) => r.role === 'primary')?.hostname ?? null;
  }
  return groups.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
}

export function createDomainDb(opts) {
  const { url, serviceKey, fetchImpl = globalThis.fetch, timeoutMs = 10000, budget = null } = opts;
  const headers = () => ({
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
  });

  async function request(path, init = {}) {
    if (!serviceKey) throw new DomainDbError('db_unconfigured');
    let limit = timeoutMs;
    if (budget) {
      const left = budget.recordLeft();
      if (left < MIN_DB_MS) throw new DomainDbError('budget_exhausted');
      limit = Math.min(limit, left);
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), limit);
    let r;
    try {
      r = await fetchImpl(`${url}${path}`, { ...init, headers: headers(), signal: ctrl.signal });
    } catch {
      throw new DomainDbError('db_unreachable');
    } finally {
      clearTimeout(timer);
    }
    if (!r.ok) throw new DomainDbError(`db_http_${r.status}`);
    try {
      return await r.json();
    } catch {
      throw new DomainDbError('db_bad_response');
    }
  }

  const rpc = (fn, args) => request(`/rest/v1/rpc/${fn}`, { method: 'POST', body: JSON.stringify(args) });
  const enc = encodeURIComponent;

  return {
    rpc,

    /** The same client, bound to an execution budget. */
    withBudget: (b) => createDomainDb({ ...opts, budget: b }),

    /** Only the owner phone, from the store record -- never from a request. */
    async storeOwnerPhone(slug) {
      const rows = await request(
        `/rest/v1/stores?slug=eq.${enc(slug)}&select=owner_phone:config->>ownerPhone&limit=1`);
      return Array.isArray(rows) && rows[0] ? rows[0].owner_phone ?? null : null;
    },

    async groupsForStore(slug) {
      const rows = await request(
        `/rest/v1/store_domains?store_slug=eq.${enc(slug)}&select=${GROUP_COLUMNS}&order=created_at.desc&limit=40`);
      return groupRows(rows);
    },

    /** Complete groups (every row of each) by id -- never split by a row limit. */
    async groupsByIds(ids) {
      const clean = ids.filter((id) => /^[0-9a-f-]{36}$/.test(String(id)));
      if (!clean.length) return [];
      const rows = await request(
        `/rest/v1/store_domains?group_id=in.(${clean.join(',')})&select=${GROUP_COLUMNS}&order=created_at.asc`);
      return groupRows(rows);
    },

    /**
     * Lease the next group(s) fairly (PR-B.1 domain_reconcile_lease): whole
     * groups, disjoint across overlapping workers, least-recently-served first.
     * The database caps the batch at 5 and fixes the lease at 120 s.
     */
    reconcileLease: (limit = 1) => rpc('domain_reconcile_lease', { p_limit: limit }),

    // ── PR-B RPCs (every write) ─────────────────────────────────────────────
    claim: (slug, host, kind) =>
      rpc('domain_claim', { p_store_slug: slug, p_hostname: host, p_kind: kind }),
    markVerified: (groupId, slug, provedToken) =>
      rpc('domain_mark_verified', { p_group_id: groupId, p_store_slug: slug, p_proved_token: provedToken }),
    vercelIntent: (groupId, slug, host, intent) =>
      rpc('domain_vercel_intent', { p_group_id: groupId, p_store_slug: slug, p_hostname: host, p_intent: intent }),
    vercelObserve: (groupId, slug, host, facts, error = null) =>
      rpc('domain_vercel_observe', {
        p_group_id: groupId, p_store_slug: slug, p_hostname: host,
        p_attached: facts.attached, p_verified: facts.verified ?? null,
        p_misconfigured: facts.misconfigured ?? null, p_error: error,
      }),
    markReady: (groupId, slug) =>
      rpc('domain_mark_ready', { p_group_id: groupId, p_store_slug: slug }),
    challengeCreate: (slug, groupId, action, target, codeHash) =>
      rpc('domain_challenge_create', {
        p_store_slug: slug, p_group_id: groupId, p_action: action,
        p_target_hostname: target, p_code_hash: codeHash,
      }),
    activate: (groupId, slug, provedToken, challengeId, codeHash) =>
      rpc('domain_activate', {
        p_group_id: groupId, p_store_slug: slug, p_proved_token: provedToken,
        p_challenge_id: challengeId, p_code_hash: codeHash,
      }),
    setPrimary: (groupId, slug, host, challengeId, codeHash) =>
      rpc('domain_set_primary', {
        p_group_id: groupId, p_store_slug: slug, p_hostname: host,
        p_challenge_id: challengeId, p_code_hash: codeHash,
      }),
    beginDisconnect: (groupId, slug, actor, challengeId = null, codeHash = null) =>
      rpc('domain_begin_disconnect', {
        p_group_id: groupId, p_store_slug: slug, p_actor: actor,
        p_challenge_id: challengeId, p_code_hash: codeHash,
      }),
    finishDisconnect: (groupId, slug) =>
      rpc('domain_finish_disconnect', { p_group_id: groupId, p_store_slug: slug }),
    expireStale: (limit = 200) =>
      rpc('domain_expire_stale', { p_limit: limit }),
    /** Only with the health token of the lease that authorised this check. */
    healthUpdate: (groupId, slug, checkToken, ok, error = null) =>
      rpc('domain_health_update', {
        p_group_id: groupId, p_store_slug: slug, p_check_token: checkToken, p_ok: ok, p_error: error,
      }),
    eventAppend: (groupId, slug, event, actor, detail = {}) =>
      rpc('domain_event_append', {
        p_group_id: groupId, p_store_slug: slug, p_event: event, p_actor: actor, p_detail: detail,
      }),
  };
}
