// Custom merchant domains: which paths a merchant's own domain serves, and
// where every other path goes.
//
// Pure -- no I/O, no window, no environment -- and shared by the edge
// middleware and api/render.js on the server and by the SPA in the browser, so
// the two can never disagree about a path.
//
// On a merchant's domain (brand.com) the ONLY storefront pages are those of the
// ONE store that owns the domain -- the store is never read from the path:
//   /                 the store
//   /p/{productId}    one of its products
//   /c/{categoryId}   one of its categories
// PocketLink's own pages never render there: each has an explicit PocketLink
// address (pocketlinkTarget). Every other path is "not found" for that store.

export const PL_ORIGIN = 'https://www.pocketlink.store';

/** '/', '/p/{id}', '/c/{id}' (one optional trailing slash) -> the store page it is, else null. */
export function storeRoute(pathname) {
  const p = String(pathname ?? '');
  if (p === '/') return { kind: 'home' };
  const m = /^\/(p|c)\/([^/]{1,200})\/?$/.exec(p);
  if (!m) return null;
  return m[1] === 'p' ? { kind: 'product', id: m[2] } : { kind: 'category', id: m[2] };
}

// PocketLink pages, by exact path, that keep their path on www.pocketlink.store.
const PL_EXACT = new Set([
  '/start', '/plans', '/onboarding', '/terms', '/privacy', '/data-deletion',
  '/hub', '/console', '/marketplace', '/explore', '/sell',
]);
// PocketLink pages with one path segment after a fixed prefix: checkout, the
// transactional token links (order / confirm / review) and the demo stores.
const PL_ONE_SEGMENT = /^\/(checkout|confirm|order|review|demo)\/[^/]{1,200}\/?$/;

/**
 * Where a PocketLink-only path on a merchant's domain goes, or null if the path
 * is not a PocketLink page (then it is "not found" there).
 *   /manage, /{slug}/manage  -> THIS store's dashboard on PocketLink
 *   the PocketLink pages     -> the same path (and query) on PocketLink
 * `slug` is the store that owns the domain -- from the database, never the path.
 * Another store's /{other}/manage is NOT mapped: a merchant's domain never
 * leads to another store.
 */
export function pocketlinkTarget(pathname, search, slug) {
  const p = String(pathname ?? '');
  const q = typeof search === 'string' && search.startsWith('?') ? search : '';
  const trimmed = p.length > 1 ? p.replace(/\/$/, '') : p;
  if (trimmed === '/manage' || (slug && trimmed === `/${slug}/manage`)) {
    return slug ? `${PL_ORIGIN}/${slug}/manage${q}` : null;
  }
  if (PL_EXACT.has(trimmed) || PL_ONE_SEGMENT.test(p)) return `${PL_ORIGIN}${trimmed}${q}`;
  return null;
}

// Files the merchant's domain may serve as-is: generic, build-level assets that
// show no store. (/assets/* -- the hashed JS and CSS -- is excluded from the
// middleware entirely.) Nothing else is exempt: every other path is routed.
export const PASS_THROUGH_FILES = new Set([
  '/favicon.svg', '/icons.svg', '/pocketlink-logo.svg', '/pocketlink-wordmark.png',
  '/pocketlink-wordmark.svg', '/og-image.jpg', '/version.json',
]);

/** A generic asset path the merchant's domain serves untouched. */
export function isPassThrough(pathname) {
  const p = String(pathname ?? '');
  return p.startsWith('/assets/') || p.startsWith('/_vercel/') || PASS_THROUGH_FILES.has(p);
}

/** The slug a store-image endpoint (/api/og, /api/qr) will use: their own normalisation. */
export function imageEndpointSlug(raw) {
  return String(raw ?? '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 60);
}
