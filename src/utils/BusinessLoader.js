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
 * Always fetch the latest config from Supabase (the source of truth) and
 * refresh the local cache. Returns the fresh config, or null if not found.
 * The Supabase client is imported on demand so it stays out of the entry chunk.
 */
export async function refreshBusiness(slug) {
  if (!slug || typeof slug !== 'string') return null;
  const s = slug.toLowerCase();
  const { fetchStore } = await import('./storeService');
  const fresh = await fetchStore(s);
  if (fresh) cacheStore(fresh);
  return fresh || null;
}

/**
 * Async: load a store by slug. Stale-while-revalidate:
 *   • If a cached copy exists, return it immediately for an instant paint, then
 *     revalidate against the DB in the background and call `onFresh(config)` if
 *     the DB version differs (so owner edits show up without a hard refresh).
 *   • If nothing is cached, wait for the DB.
 * Only resolves real user-created stores (cache + Supabase DB).
 * Returns config object or null.
 */
export async function loadBusiness(slug, { onFresh } = {}) {
  if (!slug || typeof slug !== 'string') return null;
  const s = slug.toLowerCase();

  const cached = getCachedBusinesses()[s] || null;
  if (cached) {
    refreshBusiness(s)
      .then((fresh) => {
        if (fresh && typeof onFresh === 'function' && JSON.stringify(fresh) !== JSON.stringify(cached)) {
          onFresh(fresh);
        }
      })
      .catch(() => { /* offline / transient — keep showing the cached copy */ });
    return cached;
  }

  return refreshBusiness(s);
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
