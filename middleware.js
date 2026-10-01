// Edge routing, before vercel.json and before the filesystem.
//
// Whether a host is routed as a merchant's domain is routingMode() (api/_hosts.js),
// the decision render, sitemap and the og/qr guard use too:
//   'off'     PocketLink hosts, this project's own Vercel URLs, and every custom
//             host not routed: exactly the old behaviour -- only the retired
//             market.pocketlink.store root is 308'd here (vercel.json redirects
//             its other paths), and everything else falls through untouched.
//   'global'  CUSTOM_DOMAINS_ROUTING_ENABLED on: every custom host, as below.
//   'test'    the flag off, the host listed in CUSTOM_DOMAINS_ROUTING_TEST_HOSTS:
//             as below, but never indexed -- every HTML answer says noindex,
//             nofollow; robots.txt allows crawling (so the noindex is seen) but
//             names no sitemap, and /sitemap.xml is 404.
//
// A routed merchant domain (see src/utils/customDomainRoutes.js). The database
// decides which ONE store the domain serves (resolve_store_host: connected
// groups only); the path never chooses a store:
//   generic assets (/assets/*, favicon, logo, version.json)   as they are, no lookup
//   not connected / unknown                     404 "not connected", every path
//   the lookup failed or timed out              503 -- never a store, never PocketLink
//   a non-primary name of the domain            307 to the primary, same path
//   /, /p/{id}, /c/{id}                         that store (api/render)
//   /robots.txt, /sitemap.xml                   that store's own ('test': robots
//                                               without a sitemap; no sitemap)
//   /api/og, /api/qr                            only for that store's slug
//   /api/render, /api/sitemap directly, and any
//   other path to the four functions (/api/og/,
//   /api/og.js, ...)                            404 (render/sitemap: reached only
//                                               through here)
//   PocketLink pages (/manage, /start, /terms, /order/{token}, ...)
//                                               307 to PocketLink (/manage -> this
//                                               store's dashboard)
//   anything else                               404
// Nothing here trusts a request header, query value or path segment to name a
// store. Every answer on a merchant's domain is no-store; every redirect is
// temporary (a domain's store and primary name can change).
import { normalizeHost, routingMode } from './api/_hosts.js';
import { resolverFromEnv } from './api/_resolve.js';
import { responses, TEST_ROBOTS } from './api/_pages.js';
import {
  storeRoute, pocketlinkTarget, isPassThrough, imageEndpointSlug,
} from './src/utils/customDomainRoutes.js';

// Every page path, plus every path to the four API functions that render or
// list store pages -- with the variants Vercel also sends to them (a trailing
// slash, ".js"). Other /api/* routes, /_vercel/* and the hashed /assets/* never
// reach the middleware, so vercel.json never falls back to the SPA for those
// three prefixes: a miss there is a plain 404. (Vercel finds a function by its
// DECODED path but matches this matcher against the raw one, so render, sitemap,
// og and qr each check a merchant's domain again themselves.)
export const config = {
  matcher: ['/((?!assets/|_vercel/|api/).*)', '/api/(render|sitemap|og|qr)(.*)'],
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

// A test domain may be crawled -- a crawler kept out would never see the pages'
// noindex -- but names no sitemap.
function robotsTxt(host, mode) {
  const body = mode === 'test' ? 'User-agent: *\nAllow: /\n' : `User-agent: *\nAllow: /\n\nSitemap: https://${host}/sitemap.xml\n`;
  return new Response(body, {
    status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

async function routeMerchantDomain(req, resolver, mode) {
  const url = new URL(req.url);
  const path = url.pathname;
  // On a merchant's domain the middleware never just lets routing continue:
  // what it allows, it rewrites to the very URL it checked. req.url has its dot
  // segments resolved (WHATWG), but Vercel goes on routing the RAW path -- so
  // /x/../favicon.svg looks like the favicon here, yet left alone it would find
  // no file and fall back to the SPA shell.
  const allow = () => rewrite(url);
  if (isPassThrough(path)) return allow();

  const robots = mode === 'test' ? TEST_ROBOTS : undefined;
  const host = normalizeHost(url.hostname);
  const r = await resolver.resolveHost(host);
  if (r.status === 'error') return responses.unavailable(robots);
  if (r.status !== 'connected') return responses.notConnected(robots);
  if (!r.isPrimary) return responses.redirect(`https://${r.primaryHost}${path}${url.search}`);

  if (path.startsWith('/api/')) {
    // Only the image endpoints, by their exact path, for this store.
    const image = path === '/api/og' || path === '/api/qr';
    return image && imageEndpointSlug(url.searchParams.get('slug')) === r.slug ? allow() : responses.notFound(robots);
  }
  if (path === '/robots.txt') return robotsTxt(host, mode);
  if (path === '/sitemap.xml') return mode === 'test' ? responses.notFound(robots) : rewrite(new URL('/api/sitemap', url));
  if (storeRoute(path)) return rewrite(new URL(`/api/render?path=${encodeURIComponent(path)}`, url));

  const pl = pocketlinkTarget(path, url.search, r.slug);
  if (pl) return responses.redirect(pl);
  return responses.notFound(robots);
}

/**
 * The middleware, given where its database lookups come from. The deployed
 * middleware (default export) uses one resolver per instance, so answers are
 * cached across requests for RESOLVE_CACHE_MS (api/_resolve.js).
 */
export function createMiddleware({ env = process.env, resolverFor = (e) => resolverFromEnv(e) } = {}) {
  let resolver = null;
  return async function middleware(req) {
    const mode = routingMode(normalizeHost(new URL(req.url).hostname), env);
    if (mode === 'off') return legacy(req);
    return routeMerchantDomain(req, (resolver ??= resolverFor(env)), mode);
  };
}

export default createMiddleware();
