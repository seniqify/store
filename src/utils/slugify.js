/**
 * slugify — converts a business name into a clean URL slug.
 * uniqueSlug — resolves collisions by appending a counter.
 */

// These paths are used by the app itself and cannot be claimed as store slugs.
const RESERVED = new Set([
  'onboarding', 'landing', 'admin', 'api', 'login', 'dashboard',
  'demo', 'terms', 'privacy', 'manage', 'store', 'app', 'help',
]);

export function slugify(name) {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/\s+/g, '')        // collapse spaces
      .replace(/[^a-z0-9]/g, '')  // strip non-alphanumeric
      .slice(0, 24) || 'store'
  );
}

export function uniqueSlug(name, existingSlugs = []) {
  const taken = new Set([...existingSlugs, ...RESERVED]);
  const base   = slugify(name);

  if (!taken.has(base)) return base;

  let i = 2;
  while (taken.has(`${base}${i}`)) i++;
  return `${base}${i}`;
}
