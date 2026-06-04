/**
 * Marketplace helpers — pure, read-only transforms over existing store configs.
 * Nothing here writes to the DB or mutates store data.
 */

// Canonical filter categories shown as pills on the marketplace.
// A store maps to one of these via an explicit `config.category` (preferred)
// or, failing that, a coarse mapping from its `businessType`.
export const CATEGORIES = ['Food', 'Clothing', 'Services', 'Beauty', 'Grocery', 'Electronics', 'Stay', 'Other'];

const TYPE_TO_CATEGORY = {
  restaurant: 'Food',
  service:    'Services',
  hotel:      'Stay',
  product:    'Other',
};

/** Best-effort category for a store: explicit field first, else by businessType. */
export function deriveCategory(config) {
  const explicit = config?.category;
  if (explicit && CATEGORIES.includes(explicit)) return explicit;
  return TYPE_TO_CATEGORY[config?.businessType] ?? 'Other';
}

/** Best-effort city/area from an explicit `config.city` or the free-text address. */
export function deriveCity(config) {
  if (config?.city) return String(config.city).trim();
  const addr = config?.address || '';
  if (!addr) return '';
  const parts = addr.split(',').map((s) => s.trim()).filter(Boolean);
  if (!parts.length) return '';
  // The last comma-part is usually "City — 400050" / "City 400050"; strip the rest.
  let last = parts[parts.length - 1].replace(/[-–—].*$/, '').replace(/\d{4,6}/g, '').trim();
  if (!last && parts.length > 1) {
    last = parts[parts.length - 2].replace(/\d{4,6}/g, '').trim();
  }
  return last;
}

/**
 * Normalize a store config (real DB store or static demo) into a card model.
 * `demo: true` routes the card to the /demo/<slug> preview instead of /<slug>.
 */
export function normalizeBusiness(config, { demo = false } = {}) {
  const slug = config.slug;
  return {
    slug,
    href:           demo ? `/demo/${slug}` : `/${slug}`,
    name:           config.businessName || config.name || 'Unnamed business',
    category:       deriveCategory(config),
    city:           deriveCity(config),
    location:       config.address || '',
    tagline:        config.tagline || '',
    logo:           config.logo || null,
    logoEmoji:      config.logoEmoji || '🏪',
    coverImage:     config.coverImage || null,
    whatsappNumber: config.whatsappNumber || '',
    primary:        config.theme?.primary || '#0d9488',
    primaryDark:    config.theme?.primaryDark || '#0f766e',
    demo,
  };
}
