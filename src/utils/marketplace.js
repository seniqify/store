/**
 * Marketplace helpers — pure, read-only transforms over existing store configs.
 * Nothing here writes to the DB or mutates store data.
 */

import { DEFAULT_CATEGORY } from './businessCategories';

/** A store's marketplace category: its chosen sub-category, else a type default. */
export function deriveCategory(config) {
  return config?.category || DEFAULT_CATEGORY[config?.businessType] || 'Other Retail';
}

/**
 * City for the marketplace — the STRUCTURED field only. We deliberately do NOT
 * parse the free-text address here: comma-less addresses ("242 Jodbhavi Peth
 * Solapur") and state-only addresses would otherwise leak into the area filter.
 * Stores without a structured city simply show no location until the owner sets
 * one (now a quick pincode lookup in onboarding/Manage).
 */
export function deriveCity(config) {
  return (config?.city || '').trim();
}

/**
 * Normalize a store config (real DB store or static demo) into a card model.
 * `demo: true` routes the card to the /demo/<slug> preview instead of /<slug>.
 */
const NEW_WINDOW_MS = 14 * 86400000;   // a shop counts as "new" for 14 days

// On the consumer subdomain, store links go straight to the main domain —
// one direct navigation instead of an SPA bounce + redirect hop.
const STORE_ORIGIN =
  typeof window !== 'undefined' && window.location.hostname.startsWith('market.')
    ? 'https://www.pocketlink.store' : '';

export function normalizeBusiness(config, { demo = false } = {}) {
  const slug = config.slug;
  const createdAt = config.created_at ? new Date(config.created_at).getTime() : null;
  return {
    slug,
    href:           STORE_ORIGIN + (demo ? `/demo/${slug}` : `/${slug}`),
    isNew:          !demo && !!createdAt && (Date.now() - createdAt) < NEW_WINDOW_MS,
    name:           config.businessName || config.name || 'Unnamed business',
    category:       deriveCategory(config),
    city:           deriveCity(config),
    state:          config.state || '',
    area:           config.area || '',
    location:       config.address || '',
    tagline:        config.tagline || '',
    logo:           config.logo || null,
    logoEmoji:      config.logoEmoji || '🏪',
    coverImage:     config.coverImage || null,
    whatsappNumber: config.whatsappNumber || '',
    hours:          config.hours || null,   // real open/closed on the card
    primary:        config.theme?.primary || '#0d9488',
    primaryDark:    config.theme?.primaryDark || '#0f766e',
    demo,
  };
}
