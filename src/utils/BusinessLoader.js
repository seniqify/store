/**
 * BusinessLoader
 * ─────────────────────────────────────────────────────────────────────────────
 * Resolution order:
 *   1. Local cache (localStorage) — instant load for recently created stores
 *   2. Supabase DB — the source of truth for all user-created stores
 *   3. Static demo configs (src/businesses/) — hardcoded demo stores
 */

import REGISTRY from '../businesses/index';
import { getCachedBusinesses, cacheStore } from './businessStorage';
import { fetchStore } from './storeService';

/**
 * Async: load a store by slug.
 * Returns config object or null.
 */
export async function loadBusiness(slug) {
  if (!slug || typeof slug !== 'string') return null;
  const s = slug.toLowerCase();

  // 1. Check local cache first (instant)
  const cache = getCachedBusinesses();
  if (cache[s]) return cache[s];

  // 2. Check static demo configs (instant)
  if (REGISTRY[s]) return REGISTRY[s];

  // 3. Fetch from Supabase
  const dbConfig = await fetchStore(s);
  if (dbConfig) {
    cacheStore(dbConfig); // cache for next time
    return dbConfig;
  }

  return null;
}

/**
 * Sync: returns only static demo stores (for landing page previews).
 * Does not include user-created DB stores.
 */
export function listBusinesses() {
  return Object.values(REGISTRY);
}

/**
 * Return slugs from static configs + local cache.
 * Used by onboarding to avoid duplicate slugs.
 */
export function listSlugs() {
  const cached  = Object.keys(getCachedBusinesses());
  const static_ = Object.keys(REGISTRY);
  return [...new Set([...cached, ...static_])];
}
