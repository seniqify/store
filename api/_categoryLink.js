// Category links — turning a store category into a URL, and back.
//
// A category's `id` is generated from its label the moment it is created and
// never changes again, because every product references it (`p.category === id`).
// Rename "Products" to "AGARBATTI PACK" and the id stays `products` — so
// /krupaagarbattiwork/c/products is a link nobody can read, pointing at a
// category called something else entirely.
//
// Renaming the id instead would mean rewriting every product that uses it and
// breaking links already printed on a leaflet or sitting in a WhatsApp thread.
//
// So: the id stays the internal key, and the URL carries a readable slug derived
// from the CURRENT label. Resolution accepts either, which means a renamed
// category produces a better link from then on while every old link keeps
// working. Shared by the server renderer and the storefront so they can never
// disagree about what a link means.

/** "AGARBATTI PACK" → "agarbatti-pack". Empty for a label with no letters. */
export function slugifyCategory(label) {
  return String(label ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** The token to put in a link for this category — readable, current, stable. */
export function categoryLinkId(cat) {
  if (!cat) return '';
  return slugifyCategory(cat.label) || String(cat.id ?? '');
}

/**
 * Find the category a URL token refers to, or null.
 *
 * Order matters: an exact id wins, so a link written before a rename still
 * lands on the same category even if some other category's label now slugifies
 * to that word. Then the readable slug, then the older no-separator form that
 * ids were generated with, so links from every era resolve.
 */
export function resolveCategory(categories, token) {
  const t = String(token ?? '').toLowerCase();
  if (!t || t === 'all') return null;
  const list = (Array.isArray(categories) ? categories : []).filter((c) => c && c.id !== 'all');

  return list.find((c) => String(c.id).toLowerCase() === t)
    || list.find((c) => slugifyCategory(c.label) === t)
    || list.find((c) => slugifyCategory(c.label).replace(/-/g, '') === t.replace(/-/g, ''))
    || null;
}
