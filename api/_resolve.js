// Merchant domain -> store, decided by the database alone.
//
//   resolve_store_host(host)  -> [{ store_slug, primary_host }] for a CONNECTED
//                                group only; [] for anything else (pending,
//                                verified, ready, misconfigured, disconnecting,
//                                ended, never claimed)
//   store_primary_host(slug)  -> the store's connected primary hostname, or null
// Both are PR-B's public read RPCs, called with the public (anon) key.
//
// Nothing from the request is trusted but the host, and that is validated before
// it is sent. Every answer is validated too: a malformed answer is an ERROR, and
// an error is never cached and never guessed into a store -- callers fail closed
// (503), they do not fall through to another store or to PocketLink's pages.
//
// Answers are cached per instance: "connected" for RESOLVE_CACHE_MS, so a
// disconnected or re-pointed domain stops routing within that window; "none" for
// the shorter RESOLVE_MISS_CACHE_MS, so a newly connected one starts sooner.
// store_primary_host answers are not cached, and a failure there is an error
// too -- never read as "no domain" (api/render.js, api/sitemap.js).
// Runs on the edge (middleware) and in Node (render, sitemap).
import { fetchJsonWithin } from './domains/_http.js';
import { normalizeHost, validHostname } from './_hosts.js';

export const RESOLVE_TIMEOUT_MS = 1500;
export const RESOLVE_CACHE_MS = 30000;
export const RESOLVE_MISS_CACHE_MS = 10000;
const CACHE_MAX = 500;
const SLUG = /^[a-z0-9][a-z0-9-]{0,59}$/;

const error = (reason) => ({ status: 'error', reason });

/** One resolver answer -> { status: 'connected', slug, primaryHost, isPrimary } | { status: 'none' } | error. */
export function interpretResolve(json, host) {
  if (!Array.isArray(json)) return error('malformed');
  if (json.length === 0) return { status: 'none' };
  if (json.length !== 1) return error('malformed');
  const slug = json[0]?.store_slug;
  const primary = json[0]?.primary_host;
  if (typeof slug !== 'string' || !SLUG.test(slug)) return error('malformed');
  if (typeof primary !== 'string' || normalizeHost(primary) !== primary || !validHostname(primary)) return error('malformed');
  return { status: 'connected', slug, primaryHost: primary, isPrimary: primary === host };
}

export function createResolver({
  url, anonKey, fetchImpl = globalThis.fetch,
  timeoutMs = RESOLVE_TIMEOUT_MS, cacheMs = RESOLVE_CACHE_MS, missCacheMs = RESOLVE_MISS_CACHE_MS,
  now = () => Date.now(),
} = {}) {
  const cache = new Map();
  const headers = () => ({ apikey: anonKey, Authorization: `Bearer ${anonKey}`, 'Content-Type': 'application/json' });
  const rpc = (fn, args) => fetchJsonWithin(fetchImpl, `${url}/rest/v1/rpc/${fn}`,
    { method: 'POST', headers: headers(), body: JSON.stringify(args) }, timeoutMs);

  /**
   * A store's connected primary domain: { status: 'ok', host } (host is null
   * when it has none) or an error. A slug no domain could belong to is ok/null.
   */
  async function lookupPrimaryHost(slug) {
    if (typeof slug !== 'string' || !SLUG.test(slug)) return { status: 'ok', host: null };
    if (!url || !anonKey) return error('unconfigured');
    const r = await rpc('store_primary_host', { p_slug: slug });
    if (r.timedOut) return error('timeout');
    if (!r.ok || r.badBody) return error(r.status ? `http_${r.status}` : 'unreachable');
    if (r.json === null) return { status: 'ok', host: null };
    const host = r.json;
    if (typeof host !== 'string' || normalizeHost(host) !== host || !validHostname(host)) return error('malformed');
    return { status: 'ok', host };
  }

  return {
    /** Which store a merchant domain serves. `host` must already be normalised. */
    async resolveHost(host) {
      if (!validHostname(host)) return { status: 'none' };
      const hit = cache.get(host);
      if (hit && now() - hit.at < (hit.value.status === 'connected' ? cacheMs : missCacheMs)) return hit.value;
      if (!url || !anonKey) return error('unconfigured');
      const r = await rpc('resolve_store_host', { p_host: host });
      if (r.timedOut) return error('timeout');
      if (!r.ok || r.badBody) return error(r.status ? `http_${r.status}` : 'unreachable');
      const value = interpretResolve(r.json, host);
      if (value.status !== 'error') {
        cache.set(host, { at: now(), value });
        if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
      }
      return value;
    },

    lookupPrimaryHost,

    /** Forget cached answers (tests). */
    clear: () => cache.clear(),
  };
}

/** The resolver for this runtime: PR-B's public RPCs with the public key the site already uses. */
export function resolverFromEnv(env = process.env, opts = {}) {
  return createResolver({
    url: env.VITE_SUPABASE_URL, anonKey: env.VITE_SUPABASE_ANON_KEY,
    fetchImpl: (u, init) => globalThis.fetch(u, init), ...opts,
  });
}
