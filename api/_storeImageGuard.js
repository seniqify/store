// The store-image endpoints (/api/og, /api/qr) on a merchant's own domain:
// only for the ONE store the database says owns it, and only on its primary name.
//
// middleware.js checks this first, but it cannot be the only check: Vercel looks
// a function up by its DECODED path, and accepts a trailing slash or ".js", while
// the middleware's matcher sees the raw path -- /api/%6fg, /api/og%2F and
// /api/og.js all reach api/og.js. So each function checks again, itself.
//
// Routing off, or any host that is not a merchant's: no lookup, no change.
import { classifyHost, normalizeHost, routingEnabled } from './_hosts.js';
import { resolverFromEnv } from './_resolve.js';
import { responses } from './_pages.js';

/**
 * guard(req, slug) -> null to go ahead, or the Response to answer instead.
 * `slug` is the store the endpoint was asked for, already normalised by it.
 */
export function createStoreImageGuard({ env = process.env, resolverFor = (e) => resolverFromEnv(e) } = {}) {
  let resolver = null;
  return async function guard(req, slug) {
    if (!routingEnabled(env)) return null;
    // The Host header and the URL's host are the same on Vercel; if either names
    // a merchant's domain, that is the domain.
    const host = [req.headers?.get?.('host'), new URL(req.url).hostname]
      .map(normalizeHost).find((h) => h && classifyHost(h, env) === 'custom');
    if (!host) return null;
    const r = await (resolver ??= resolverFor(env)).resolveHost(host);
    if (r.status === 'error') return responses.unavailable();
    if (r.status !== 'connected') return responses.notConnected();
    return r.isPrimary && slug === r.slug ? null : responses.notFound();
  };
}
