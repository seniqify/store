// Storefront URLs, built in one place.
//
// On PocketLink every store lives at pocketlink.store/{slug}:
//   /{slug}                 the store
//   /{slug}/p/{productId}   one product
//   /{slug}/c/{categoryId}  one category (categoryLinkId from api/_categoryLink.js)
//   /{slug}/manage          the owner's dashboard (always on PocketLink)
//
// On a merchant's own domain (hostMode() === 'merchant', set by the server) the
// store that owns the domain lives at its root -- /, /p/{id}, /c/{id} -- and
// anything that is not that store's storefront (its dashboard, PocketLink's own
// pages, any other store) is an absolute https://www.pocketlink.store URL, so a
// merchant's domain never renders it. On PocketLink hosts the output is exactly
// what it always was.
//
// api/_seo.js builds the same shapes on the server from an explicit storeBase;
// tests/custom-domain-groundwork.test.mjs pins the two together.
import { hostMode } from './hostMode.js';
import { PL_ORIGIN } from './customDomainRoutes.js';

function tail({ productId, categoryId } = {}) {
  if (productId !== undefined) return `/p/${productId}`;
  if (categoryId !== undefined) return `/c/${categoryId}`;
  return '';
}

/**
 * Path to a store, a product in it, or a category of it.
 * A product wins over a category. A key counts as given unless it is
 * `undefined`, so any value renders exactly as a template string would.
 * On a merchant's domain: that store's root-relative path, or -- for any other
 * store -- its absolute PocketLink URL.
 */
export function storePath(slug, opts = {}, mode = hostMode()) {
  if (mode.mode === 'merchant') {
    return slug === mode.slug ? (tail(opts) || '/') : `${PL_ORIGIN}/${slug}${tail(opts)}`;
  }
  return `/${slug}${tail(opts)}`;
}

/** Absolute URL of a store page on `origin` (no trailing slash), e.g. https://www.pocketlink.store. */
export function storeUrl(origin, slug, opts) {
  return `${origin}/${slug}${tail(opts)}`;
}

/**
 * The link an owner shares for their store, a product or a category: on their
 * own domain while it is live (`domain`, from the domain API's status), else on
 * PocketLink (`origin`, today's behaviour). Order tracking, confirm and review
 * links never use this -- they always stay on PocketLink.
 */
export function publicStoreUrl(slug, opts = {}, domain = null, origin = PL_ORIGIN) {
  if (domain) return `https://${domain}${tail(opts)}`;
  return storeUrl(origin, slug, opts);
}

/** Path to the owner's dashboard. The dashboard only ever lives on PocketLink. */
export function managePath(slug, mode = hostMode()) {
  return mode.mode === 'merchant' ? `${PL_ORIGIN}/${slug}/manage` : `/${slug}/manage`;
}

/** A PocketLink page (/terms, /privacy, ...): on a merchant's domain, its absolute PocketLink URL. */
export function pocketlinkPath(path, mode = hostMode()) {
  return mode.mode === 'merchant' ? `${PL_ORIGIN}${path}` : path;
}

/** True for a full URL (another origin), which must be an <a href>, never a router <Link>. */
export function isAbsoluteUrl(path) {
  return /^https?:\/\//i.test(String(path ?? ''));
}
