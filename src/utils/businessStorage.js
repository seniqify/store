/**
 * businessStorage
 * ─────────────────────────────────────────────────────────────────────────────
 * Thin localStorage wrapper for user-created business configs.
 * All data is stored under a single versioned key so future migrations
 * can read the old format and transform it.
 */

const STORAGE_KEY = 'seniqify_v1';

/** Return all user-created businesses as { slug: config } */
export function getStoredBusinesses() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/** Persist (or overwrite) a single business config. */
export function saveBusiness(config) {
  const all = getStoredBusinesses();
  all[config.slug] = { ...config, _source: 'user' };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
}

/** Remove a stored business by slug. */
export function deleteStoredBusiness(slug) {
  const all = getStoredBusinesses();
  delete all[slug];
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
}

/** Return just the slugs of user-created businesses. */
export function getStoredSlugs() {
  return Object.keys(getStoredBusinesses());
}
