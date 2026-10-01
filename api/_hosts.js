// Which kind of host a request came in on, and how it is routed -- the ONE
// classification and the ONE routing decision used by the edge middleware,
// api/render.js, api/sitemap.js and the og/qr guard. Pure; runs on the edge
// and in Node.
//
//   pocketlink  www.pocketlink.store, pocketlink.store, market.pocketlink.store
//   deployment  EXACTLY this deployment's own vercel.app URLs, from Vercel's
//               system variables (set by Vercel, never by the request):
//                 VERCEL_URL, VERCEL_BRANCH_URL
//               plus www.seniqify.store, listed by name (LEGACY_DEPLOYMENT_HOSTS).
//               A host is never trusted for merely ending in the team's
//               vercel.app suffix -- every project in the team shares it.
//               VERCEL_PROJECT_PRODUCTION_URL is NOT trusted: Vercel sets it to
//               the project's SHORTEST production domain, so attaching a short
//               merchant domain (poketlink.app, 2026-10-01) made the next
//               deployment serve every PocketLink store on that domain.
//   custom      anything else. Routed as a merchant's domain only as
//               routingMode() says: then the database decides (api/_resolve.js) --
//               a connected merchant domain serves its ONE store, anything else
//               serves nothing. Not routed: exactly the handling with routing off
//               (no store renders there).
import { PL_ORIGIN } from '../src/utils/customDomainRoutes.js';

export { PL_ORIGIN };

export const PL_HOSTS = new Set(['www.pocketlink.store', 'pocketlink.store', 'market.pocketlink.store']);

/** A hostname trimmed, lowercased and without one trailing dot -- for request hosts and listed hosts alike. */
export function normalizeHostname(raw) {
  return String(raw ?? '').trim().toLowerCase().replace(/\.$/, '');
}

/** A Host header as a bare hostname: lowercase, no port, no trailing dot. */
export function normalizeHost(raw) {
  return normalizeHostname(String(raw ?? '').trim().replace(/:\d+$/, ''));
}

const LABEL = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?';
const HOSTNAME = new RegExp(`^(?=.{1,253}$)${LABEL}(?:\\.${LABEL})+$`);

/** A syntactically valid DNS hostname (ASCII / punycode, at least two labels, not an IPv4 literal). */
export function validHostname(host) {
  return typeof host === 'string' && HOSTNAME.test(host) && !/^\d+(\.\d+){3}$/.test(host);
}

/**
 * The project's former production URL. It was trusted only because Vercel named
 * it in VERCEL_PROJECT_PRODUCTION_URL; listed by name so it is served exactly as
 * before (the Seniqify host cleanup is deferred, not decided here).
 */
export const LEGACY_DEPLOYMENT_HOSTS = new Set(['www.seniqify.store']);

/** This deployment's own vercel.app URLs, normalised; empty or non-vercel.app values trust nothing. */
function deploymentHosts(env) {
  return [env.VERCEL_URL, env.VERCEL_BRANCH_URL]
    .filter((v) => Boolean(v))
    .map(normalizeHost)
    .filter((h) => h.endsWith('.vercel.app'));
}

/** 'pocketlink' | 'deployment' | 'custom' for an already-normalised host. */
export function classifyHost(host, env = process.env) {
  if (PL_HOSTS.has(host)) return 'pocketlink';
  if (LEGACY_DEPLOYMENT_HOSTS.has(host)) return 'deployment';
  if (host && deploymentHosts(env).includes(host)) return 'deployment';
  return 'custom';
}

/** Custom-domain ROUTING is on only when CUSTOM_DOMAINS_ROUTING_ENABLED is exactly "true" (trimmed, any case). */
export function routingEnabled(env = process.env) {
  return String(env.CUSTOM_DOMAINS_ROUTING_ENABLED ?? '').trim().toLowerCase() === 'true';
}

/**
 * CUSTOM_DOMAINS_ROUTING_TEST_HOSTS (server-only: no VITE_ prefix, so never in
 * the browser bundle): a comma-separated list of the exact hostnames routed in
 * TEST mode while CUSTOM_DOMAINS_ROUTING_ENABLED is off. Each entry is
 * normalised like a request host (normalizeHostname) and must then be a valid
 * hostname as it stands -- a port, scheme, path, space or wildcard makes it
 * invalid -- and a custom host: PocketLink's own hosts and this project's own
 * Vercel URLs are never listed. Invalid entries are ignored, one by one.
 * Nothing is inferred: brand.test does not list www.brand.test, nor the other
 * way round, and no entry covers its subdomains.
 */
export function routingTestHosts(env = process.env) {
  const hosts = new Set();
  for (const raw of String(env.CUSTOM_DOMAINS_ROUTING_TEST_HOSTS ?? '').split(',')) {
    const host = normalizeHostname(raw);
    if (validHostname(host) && classifyHost(host, env) === 'custom') hosts.add(host);
  }
  return hosts;
}

/**
 * How a request host is routed as a merchant's domain -- the ONE decision used
 * by every custom-domain entry point (middleware, api/render.js, api/sitemap.js,
 * the og/qr guard); `host` must already be normalised (normalizeHost):
 *   'global'  CUSTOM_DOMAINS_ROUTING_ENABLED is on: every custom host is routed,
 *             with merchant-domain SEO; the test list is irrelevant
 *   'test'    the flag is off and this exact host is listed in
 *             CUSTOM_DOMAINS_ROUTING_TEST_HOSTS: routed, but never indexed
 *   'off'     anything else, and every PocketLink or deployment host: not routed,
 *             and no lookup is made for it
 * PocketLink's own pages -- a store's canonical pointing at its domain, the
 * sitemap leaving such stores out -- follow routingEnabled(), i.e. 'global', only.
 */
export function routingMode(host, env = process.env) {
  if (classifyHost(host, env) !== 'custom') return 'off';
  if (routingEnabled(env)) return 'global';
  return routingTestHosts(env).has(host) ? 'test' : 'off';
}
