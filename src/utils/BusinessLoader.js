/**
 * BusinessLoader
 * ─────────────────────────────────────────────────────────────────────────────
 * Resolves a URL slug → business config object.
 *
 * Resolution order:
 *   1. User-created businesses stored in localStorage (via businessStorage)
 *   2. Static demo configs shipped with the app (src/businesses/)
 *
 * Intentionally framework-agnostic — no React imports, no hooks.
 */

import REGISTRY from '../businesses/index';
import { getStoredBusinesses } from './businessStorage';

/**
 * Look up a business config by its URL slug (case-insensitive).
 * Returns null if no match found in either source.
 */
export function loadBusiness(slug) {
  if (!slug || typeof slug !== 'string') return null;
  const s = slug.toLowerCase();

  // User-created businesses take priority over static configs.
  const stored = getStoredBusinesses();
  return stored[s] ?? REGISTRY[s] ?? null;
}

/**
 * Return ALL business configs: user-created first, then static demos
 * (excluding any static demo whose slug has been overridden by a user store).
 */
export function listBusinesses() {
  const stored      = getStoredBusinesses();
  const storedVals  = Object.values(stored);
  const storedSlugs = new Set(Object.keys(stored));
  const staticVals  = Object.values(REGISTRY).filter(b => !storedSlugs.has(b.slug));
  return [...storedVals, ...staticVals];
}

/**
 * Return all known slugs (user-created + static, deduplicated).
 * Used by the onboarding wizard to avoid duplicate slugs.
 */
export function listSlugs() {
  const stored  = Object.keys(getStoredBusinesses());
  const static_ = Object.keys(REGISTRY);
  return [...new Set([...stored, ...static_])];
}
