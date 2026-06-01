/**
 * BusinessLoader
 * ─────────────────────────────────────────────────────────────────────────────
 * Resolution order:
 *   1. Local cache (localStorage) — instant load for recently created stores
 *   2. Supabase DB — source of truth for all user-created stores
 *
 * NOTE: Static demo configs are intentionally NOT resolved as routes.
 * They are used only for landing page visual previews via listBusinesses().
 */

import REGISTRY from '../businesses/index';
import { getCachedBusinesses, cacheStore } from './businessStorage';
// NOTE: storeService (and the Supabase client it pulls in, ~120 KB) is imported
// dynamically inside loadBusiness() so it stays OUT of the entry chunk. The
// landing page and demo routes never hit the DB, so they never download it.

/**
 * Async: load a store by slug.
 * Only resolves real user-created stores (cache + Supabase DB).
 * Returns config object or null.
 */
export async function loadBusiness(slug) {
  if (!slug || typeof slug !== 'string') return null;
  const s = slug.toLowerCase();

  // 1. Check local cache first (instant, avoids DB round-trip)
  const cache = getCachedBusinesses();
  if (cache[s]) return cache[s];

  // 2. Fetch from Supabase (source of truth) — loaded on demand so the
  //    Supabase client isn't bundled into the entry chunk.
  const { fetchStore } = await import('./storeService');
  const dbConfig = await fetchStore(s);
  if (dbConfig) {
    cacheStore(dbConfig); // cache for next time
    return dbConfig;
  }

  return null;
}

/**
 * Sync: returns static demo store configs for landing page previews only.
 * These are NOT accessible as real store routes.
 */
export function listBusinesses() {
  return Object.values(REGISTRY);
}

/**
 * Return taken slugs from local cache only.
 * Used by onboarding — DB uniqueness is verified separately in handlePublish.
 */
export function listSlugs() {
  return Object.keys(getCachedBusinesses());
}
