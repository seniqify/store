// Which kind of host a request came in on -- the ONE classification used by the
// edge middleware, api/render.js and api/sitemap.js. Pure; runs on the edge and
// in Node.
//
//   pocketlink  www.pocketlink.store, pocketlink.store, market.pocketlink.store
//   deployment  EXACTLY one of this project's own Vercel URLs, from Vercel's
//               system variables (set by Vercel, never by the request):
//                 VERCEL_URL, VERCEL_BRANCH_URL, VERCEL_PROJECT_PRODUCTION_URL
//               A host is never trusted for merely ending in the team's
//               vercel.app suffix -- every project in the team shares it.
//   custom      anything else. With CUSTOM_DOMAINS_ROUTING_ENABLED off, exactly
//               today's handling (no store renders there). With it on, the
//               database decides (api/_resolve.js): a connected merchant domain
//               serves its ONE store; anything else serves nothing.
import { PL_ORIGIN } from '../src/utils/customDomainRoutes.js';

export { PL_ORIGIN };

export const PL_HOSTS = new Set(['www.pocketlink.store', 'pocketlink.store', 'market.pocketlink.store']);

/** A Host header as a bare hostname: lowercase, no port, no trailing dot. */
export function normalizeHost(raw) {
  return String(raw ?? '').trim().toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '');
}

const LABEL = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?';
const HOSTNAME = new RegExp(`^(?=.{1,253}$)${LABEL}(?:\\.${LABEL})+$`);

/** A syntactically valid DNS hostname (ASCII / punycode, at least two labels, not an IPv4 literal). */
export function validHostname(host) {
  return typeof host === 'string' && HOSTNAME.test(host) && !/^\d+(\.\d+){3}$/.test(host);
}

/** This deployment's own Vercel URLs, normalised; empty values trust nothing. */
function deploymentHosts(env) {
  return [env.VERCEL_URL, env.VERCEL_BRANCH_URL, env.VERCEL_PROJECT_PRODUCTION_URL]
    .filter((v) => Boolean(v))
    .map(normalizeHost);
}

/** 'pocketlink' | 'deployment' | 'custom' for an already-normalised host. */
export function classifyHost(host, env = process.env) {
  if (PL_HOSTS.has(host)) return 'pocketlink';
  if (host && deploymentHosts(env).includes(host)) return 'deployment';
  return 'custom';
}

/** Custom-domain ROUTING is on only when CUSTOM_DOMAINS_ROUTING_ENABLED is exactly "true" (trimmed, any case). */
export function routingEnabled(env = process.env) {
  return String(env.CUSTOM_DOMAINS_ROUTING_ENABLED ?? '').trim().toLowerCase() === 'true';
}
