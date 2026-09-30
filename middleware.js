// Edge routing, before vercel.json and before the filesystem.
//
// PocketLink hosts, this project's own Vercel URLs, and EVERY host while
// CUSTOM_DOMAINS_ROUTING_ENABLED is off: exactly the old behaviour -- only the
// retired market.pocketlink.store root is 308'd here (vercel.json redirects its
// other paths), and everything else falls through untouched.
//
// A merchant's own domain, with routing on (see api/_hosts.js,
// src/utils/customDomainRoutes.js). The database decides which ONE store the
// domain serves (resolve_store_host: connected groups only); the path never
// chooses a store:
//   generic assets (/assets/*, favicon, logo, version.json)   untouched
//   not connected / unknown                     404 "not connected", every path
//   the lookup failed or timed out              503 -- never a store, never PocketLink
//   a non-primary name of the domain            307 to the primary, same path
//   /, /p/{id}, /c/{id}                         that store (api/render)
//   /robots.txt, /sitemap.xml                   that store's own
//   /api/og, /api/qr                            only for that store's slug
//   /api/render, /api/sitemap directly          404 (reached only through here)
//   PocketLink pages (/manage, /start, /terms, /order/{token}, ...)
//                                               307 to PocketLink (/manage -> this
//                                               store's dashboard)
//   anything else                               404
// Nothing here trusts a request header, query value or path segment to name a
// store. Every answer on a merchant's domain is no-store; every redirect is
// temporary (a domain's store and primary name can change).
import { classifyHost, normalizeHost, routingEnabled } from './api/_hosts.js';
import { resolverFromEnv } from './api/_resolve.js';
import { responses } from './api/_pages.js';
import {
  storeRoute, pocketlinkTarget, isPassThrough, imageEndpointSlug,
} from './src/utils/customDomainRoutes.js';

// Every page path, plus the four API routes that render or list store pages.
// Other /api/* routes and the hashed /assets/* never reach the middleware.
export const config = {
  matcher: ['/((?!assets/|_vercel/|api/).*)', '/api/render', '/api/sitemap', '/api/og', '/api/qr'],
};


/** The old middleware, unchanged: the retired market.* root goes to the main site. */
function legacy(req) {
  const { hostname, pathname } = new URL(req.url);
  if (pathname === '/' && hostname.startsWith('market.')) {
    return Response.redirect('https://www.pocketlink.store/', 308);
  }
  return undefined;
}

const rewrite = (target) => new Response(null, { headers: { 'x-middleware-rewrite': String(target) } });

function robotsTxt(host) {
  return new Response(`User-agent: *\nAllow: /\n\nSitemap: https://${host}/sitemap.xml\n`, {
    status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

async function routeMerchantDomain(req, resolver) {
  const url = new URL(req.url);
  const path = url.pathname;
  if (isPassThrough(path)) return undefined;

  const host = normalizeHost(url.hostname);
  const r = await resolver.resolveHost(host);
  if (r.status === 'error') return responses.unavailable();
  if (r.status !== 'connected') return responses.notConnected();
  if (!r.isPrimary) return responses.redirect(`https://${r.primaryHost}${path}${url.search}`);

  if (path === '/api/render' || path === '/api/sitemap') return responses.notFound();
  if (path === '/api/og' || path === '/api/qr') {
    return imageEndpointSlug(url.searchParams.get('slug')) === r.slug ? undefined : responses.notFound();
  }
  if (path === '/robots.txt') return robotsTxt(host);
  if (path === '/sitemap.xml') return rewrite(new URL('/api/sitemap', url));
  if (storeRoute(path)) return rewrite(new URL(`/api/render?path=${encodeURIComponent(path)}`, url));

  const pl = pocketlinkTarget(path, url.search, r.slug);
  if (pl) return responses.redirect(pl);
  return responses.notFound();
}

/**
 * The middleware, given where its database lookups come from. The deployed
 * middleware (default export) uses one resolver per instance, so answers are
 * cached across requests for RESOLVE_CACHE_MS (api/_resolve.js).
 */
export function createMiddleware({ env = process.env, resolverFor = (e) => resolverFromEnv(e) } = {}) {
  let resolver = null;
  return async function middleware(req) {
    const host = normalizeHost(new URL(req.url).hostname);
    if (!routingEnabled(env) || classifyHost(host, env) !== 'custom') return legacy(req);
    return routeMerchantDomain(req, (resolver ??= resolverFor(env)));
  };
}

export default createMiddleware();
