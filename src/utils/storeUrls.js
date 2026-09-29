// Storefront URLs, built in one place.
//
// Today every store lives at pocketlink.store/{slug}:
//   /{slug}                 the store
//   /{slug}/p/{productId}   one product
//   /{slug}/c/{categoryId}  one category (categoryLinkId from api/_categoryLink.js)
//   /{slug}/manage          the owner's dashboard (always on PocketLink)
//
// Custom merchant domains will later serve the same pages at the domain root
// (brand.com/, brand.com/p/{id}, ...). Every storefront link goes through here so
// that switch happens in one file. Nothing here knows about custom domains yet:
// the output is exactly the strings these call sites built by hand before.
//
// api/_seo.js builds the same shapes on the server from an explicit storeBase;
// tests/custom-domain-groundwork.test.mjs pins the two together.

/**
 * Path to a store, a product in it, or a category of it.
 * A product wins over a category. A key counts as given unless it is
 * `undefined`, so any value renders exactly as a template string would.
 */
export function storePath(slug, { productId, categoryId } = {}) {
  if (productId !== undefined) return `/${slug}/p/${productId}`;
  if (categoryId !== undefined) return `/${slug}/c/${categoryId}`;
  return `/${slug}`;
}

/** Absolute URL of a store page on `origin` (no trailing slash), e.g. https://www.pocketlink.store. */
export function storeUrl(origin, slug, opts) {
  return `${origin}${storePath(slug, opts)}`;
}

/** Path to the owner's dashboard. The dashboard only ever lives on PocketLink. */
export function managePath(slug) {
  return `/${slug}/manage`;
}
