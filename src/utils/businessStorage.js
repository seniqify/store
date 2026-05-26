/**
 * businessStorage — now saves to Supabase DB.
 * localStorage is kept as a fast local cache only.
 */
import { createStore } from './storeService';

const CACHE_KEY = 'pocketlink_v1';

/** Save to DB (primary) + localStorage (cache). */
export async function saveBusiness(config, pin = '1234', ownerPhone = null) {
  // Save to Supabase
  await createStore(config, pin, ownerPhone);
  // Also cache locally so the page loads instantly right after creation
  const cache = getCachedBusinesses();
  cache[config.slug] = config;
  localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
}

/** Return locally cached businesses (for instant load after creation). */
export function getCachedBusinesses() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/** Cache a config locally (used after fetching from DB). */
export function cacheStore(config) {
  const cache = getCachedBusinesses();
  cache[config.slug] = config;
  localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
}

/** Remove a specific store from local cache (e.g. after deletion). */
export function clearCachedStore(slug) {
  const cache = getCachedBusinesses();
  delete cache[slug];
  localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
}

/** Return just the slugs stored in local cache. */
export function getStoredSlugs() {
  return Object.keys(getCachedBusinesses());
}

// Keep old export name working
export { getCachedBusinesses as getStoredBusinesses };
