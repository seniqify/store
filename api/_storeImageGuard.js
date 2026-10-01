// The store-image endpoints (/api/og, /api/qr) on a merchant's own domain:
// when it is routed (routingMode 'global' or 'test', api/_hosts.js -- the same
// decision as the middleware, render and sitemap), only for the ONE store the
// database says owns it and only on its primary name; and on EVERY custom host,
// routed or not, never stored by a browser or CDN.
//
// middleware.js checks this first, but it cannot be the only check: Vercel looks
// a function up by its DECODED path, and accepts a trailing slash or ".js", while
// the middleware's matcher sees the raw path -- /api/%6fg, /api/og%2F and
// /api/og.js all reach api/og.js. So each function checks again, itself.
//
// No caching: a CDN copy is served without running this check at all, so an
// image cached while one store owned the domain would still be served after the
// domain passed to another. That holds on any host that is not PocketLink's or
// this project's own, whatever the routing mode: a copy cached while a host is
// not routed would outlive routing it. PocketLink's own hosts keep their caching.
//
// A host that is not routed, or not a merchant's at all: no lookup.
import { classifyHost, normalizeHost, routingMode } from './_hosts.js';
import { resolverFromEnv } from './_resolve.js';
import { responses, TEST_ROBOTS } from './_pages.js';

/**
 * guard(req, slug) -> { refused, merchantHost }
 *   refused       a Response to answer with instead (404 / 503, no-store), or null
 *   merchantHost  the request is on a merchant's (custom) host: send the image
 *                 through noStore()
 * `slug` is the store the endpoint was asked for, already normalised by it.
 */
export function createStoreImageGuard({ env = process.env, resolverFor = (e) => resolverFromEnv(e) } = {}) {
  let resolver = null;
  return async function guard(req, slug) {
    // The Host header and the URL's host are the same on Vercel; if either names
    // a merchant's domain, that is the domain.
    const host = [req.headers?.get?.('host'), new URL(req.url).hostname]
      .map(normalizeHost).find((h) => h && classifyHost(h, env) === 'custom');
    if (!host) return { refused: null, merchantHost: false };
    const mode = routingMode(host, env);
    if (mode === 'off') return { refused: null, merchantHost: true };
    const robots = mode === 'test' ? TEST_ROBOTS : undefined;
    const r = await (resolver ??= resolverFor(env)).resolveHost(host);
    if (r.status === 'error') return { refused: responses.unavailable(robots), merchantHost: true };
    if (r.status !== 'connected') return { refused: responses.notConnected(robots), merchantHost: true };
    const ok = r.isPrimary && slug === r.slug;
    return { refused: ok ? null : responses.notFound(robots), merchantHost: true };
  };
}

/** The same response, with every caching header replaced by no-store. */
export function noStore(res) {
  const headers = new Headers(res.headers);
  headers.set('Cache-Control', 'no-store');
  headers.delete('CDN-Cache-Control');
  headers.delete('Vercel-CDN-Cache-Control');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}
