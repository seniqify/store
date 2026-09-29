// The ONE server-side Vercel domain client. Nothing else in PocketLink talks to
// the Vercel API about domains.
//
// Contract (Vercel REST API, checked against the official reference 2026-09-29):
//   GET    /v9/projects/{project}/domains/{domain}          project domain: projectId, verified
//                                                          404 -> not in this project
//   POST   /v10/projects/{project}/domains  {name}          add. 400 if it is ALREADY on this
//                                                          project; 409 if another project /
//                                                          account holds it
//   POST   /v9/projects/{project}/domains/{domain}/verify   re-check Vercel's own verification;
//                                                          400 = challenge not satisfied
//   GET    /v6/domains/{domain}/config?projectIdOrName=     misconfigured (DNS + TLS issuable)
//   DELETE /v9/projects/{project}/domains/{domain}          remove; 404 -> already absent
//   ?teamId=<team> on every call when the project belongs to a team.
//
// Every path is scoped to THIS project, so nothing here can touch a domain on
// another project. Results are raw FACTS (attached / verified / misconfigured)
// or "unknown"; this client never decides a derived state -- the database does
// (domain_vercel_observe). Errors are reduced to short fixed codes; the token
// never appears in a result, an error or a log.

const API = 'https://api.vercel.com';

export const VERCEL_TIMEOUT_MS = 15000;
// Far below the database's 2-minute release fence (store_domain_vercel_clear):
// a DELETE that has not finished inside this window is abandoned, and the next
// attempt must obtain a NEW remove intent first.
export const VERCEL_DELETE_TIMEOUT_MS = 20000;

const reasonOf = (r) =>
  r.timedOut ? 'vercel_timeout' : r.status ? `vercel_http_${r.status}` : 'vercel_network';

export function createVercelClient({
  token, projectId, teamId = '', fetchImpl = globalThis.fetch,
  timeoutMs = VERCEL_TIMEOUT_MS, deleteTimeoutMs = VERCEL_DELETE_TIMEOUT_MS,
}) {
  const configured = Boolean(token && projectId);

  async function call(method, path, { body, query = {}, timeout = timeoutMs } = {}) {
    if (!configured) return { ok: false, status: 0, unconfigured: true, json: null };
    const url = new URL(API + path);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    if (teamId) url.searchParams.set('teamId', teamId);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      const r = await fetchImpl(url.toString(), {
        method,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: ctrl.signal,
      });
      let json = null;
      try { json = await r.json(); } catch { json = null; }
      return { ok: r.ok, status: r.status, json };
    } catch (e) {
      return { ok: false, status: 0, timedOut: e?.name === 'AbortError', json: null };
    } finally {
      clearTimeout(timer);
    }
  }

  const P = () => `/v9/projects/${encodeURIComponent(projectId)}/domains`;
  const D = (host) => `${P()}/${encodeURIComponent(host)}`;
  const boolOrNull = (v) => (v === true ? true : v === false ? false : null);

  return {
    configured,

    /** Is `host` attached to THIS project, and is it verified by Vercel? */
    async inspect(host) {
      const r = await call('GET', D(host));
      if (r.unconfigured) return { unknown: true, reason: 'vercel_unconfigured' };
      if (r.status === 404) return { attached: false };
      if (r.ok && r.json && r.json.projectId === projectId && r.json.name === host) {
        return { attached: true, verified: boolOrNull(r.json.verified) };
      }
      if (r.ok) return { unknown: true, reason: 'vercel_unexpected_response' };
      return { unknown: true, reason: reasonOf(r) };
    },

    /**
     * Attach `host` to THIS project. Idempotent:
     *   attached          newly attached (verified per Vercel)
     *   already_attached  it was already on THIS project (Vercel answers 400)
     *   conflict          another project or account holds it (409) -- never taken
     *   rejected          any other refusal
     *   unknown           no answer in time; the caller must not assume anything
     */
    async add(host) {
      const r = await call('POST', `/v10/projects/${encodeURIComponent(projectId)}/domains`, { body: { name: host } });
      if (r.unconfigured) return { result: 'unknown', reason: 'vercel_unconfigured' };
      if (r.ok && r.json && r.json.projectId === projectId) {
        return { result: 'attached', verified: boolOrNull(r.json.verified) };
      }
      if (r.status === 409) return { result: 'conflict', reason: 'vercel_conflict' };
      if (r.status === 400) {
        const seen = await this.inspect(host);
        if (seen.attached === true) return { result: 'already_attached', verified: seen.verified };
        return { result: 'rejected', reason: 'vercel_http_400' };
      }
      if (r.ok) return { result: 'unknown', reason: 'vercel_unexpected_response' };
      if (r.status === 0) return { result: 'unknown', reason: reasonOf(r) };
      return { result: 'rejected', reason: reasonOf(r) };
    },

    /** Ask Vercel to re-check its own verification challenge for `host`. */
    async verify(host) {
      const r = await call('POST', `${D(host)}/verify`);
      if (r.unconfigured) return { unknown: true, reason: 'vercel_unconfigured' };
      if (r.ok && r.json) return { verified: boolOrNull(r.json.verified) };
      if (r.status === 400) return { verified: false };
      return { unknown: true, reason: reasonOf(r) };
    },

    /** DNS / TLS readiness: misconfigured = false means Vercel can serve it. */
    async config(host) {
      const r = await call('GET', `/v6/domains/${encodeURIComponent(host)}/config`,
        { query: { projectIdOrName: projectId } });
      if (r.unconfigured) return { unknown: true, reason: 'vercel_unconfigured' };
      if (!r.ok || !r.json) return { unknown: true, reason: r.ok ? 'vercel_unexpected_response' : reasonOf(r) };
      const rank1 = (list) => (Array.isArray(list) ? list.find((x) => x?.rank === 1)?.value ?? null : null);
      return {
        misconfigured: boolOrNull(r.json.misconfigured),
        recommended: { cname: rank1(r.json.recommendedCNAME), ipv4: rank1(r.json.recommendedIPv4) },
      };
    },

    /**
     * Remove `host` from THIS project. The caller MUST have just obtained an
     * 'ok' from domain_vercel_intent(..., 'remove') for this exact attempt.
     *   removed | absent (404: already gone -- a success) | failed | unknown
     */
    async remove(host) {
      const r = await call('DELETE', D(host), { timeout: deleteTimeoutMs });
      if (r.unconfigured) return { result: 'unknown', reason: 'vercel_unconfigured' };
      if (r.ok) return { result: 'removed' };
      if (r.status === 404) return { result: 'absent' };
      if (r.status === 0) return { result: 'unknown', reason: reasonOf(r) };
      return { result: 'failed', reason: reasonOf(r) };
    },

    /**
     * The three raw facts for one hostname, or { unknown }. A transport failure
     * on any required call is "unknown" -- and nothing is written from it.
     */
    async facts(host, { recheckVerification = true } = {}) {
      const seen = await this.inspect(host);
      if (seen.unknown) return seen;
      if (!seen.attached) return { attached: false, verified: null, misconfigured: null };
      let verified = seen.verified;
      if (verified !== true && recheckVerification) {
        const v = await this.verify(host);
        if (!v.unknown) verified = v.verified;
      }
      const cfg = await this.config(host);
      if (cfg.unknown) return cfg;
      return { attached: true, verified, misconfigured: cfg.misconfigured, recommended: cfg.recommended };
    },
  };
}
