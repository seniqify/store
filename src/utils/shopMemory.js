/**
 * shopMemory — the marketplace's no-login comeback loop, kept on the device.
 * Customers never sign in, so favourites / recently-viewed / visit counts all
 * live in localStorage. Note localStorage is per-origin: recents recorded here
 * (market.pocketlink.store) capture shops tapped FROM the marketplace, which is
 * exactly the "continue where you left off" list a returning visitor expects.
 * Every call is try/caught — private mode or blocked storage degrades to noops.
 */

const FAV_KEY    = 'pocketlink_fav_shops';     // string[] of slugs
const RECENT_KEY = 'pocketlink_recent_shops';  // [{slug,name,logo,logoEmoji,category,primary,ts}]
const VISIT_KEY  = 'pocketlink_mkt_visits';    // number of distinct marketplace sessions
const RECENT_MAX = 12;

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}

function write(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* noop */ }
}

// ── Favourites ──────────────────────────────────────────────────────────────
export function getFavs() {
  const v = read(FAV_KEY, []);
  return Array.isArray(v) ? v : [];
}

/** Toggle a slug; returns the next favourites array. */
export function toggleFav(slug) {
  const favs = getFavs();
  const next = favs.includes(slug) ? favs.filter((s) => s !== slug) : [slug, ...favs];
  write(FAV_KEY, next);
  return next;
}

// ── Recently viewed ─────────────────────────────────────────────────────────
export function getRecents() {
  const v = read(RECENT_KEY, []);
  return Array.isArray(v) ? v.filter((r) => r && r.slug && r.name) : [];
}

/** Record a shop visit (deduped, newest first, capped). */
export function addRecent(snap) {
  if (!snap?.slug || !snap?.name) return;
  const entry = {
    slug: snap.slug, name: snap.name,
    logo: snap.logo || null, logoEmoji: snap.logoEmoji || '🏪',
    category: snap.category || '', primary: snap.primary || '#0d9488',
    ts: Date.now(),
  };
  const next = [entry, ...getRecents().filter((r) => r.slug !== snap.slug)].slice(0, RECENT_MAX);
  write(RECENT_KEY, next);
}

// ── Visit counter (once per browser session) ────────────────────────────────
/** Bump on marketplace load; returns the total visit count. */
export function bumpMarketplaceVisit() {
  try {
    let n = Number(localStorage.getItem(VISIT_KEY)) || 0;
    if (!sessionStorage.getItem('pl_mkt_session')) {
      sessionStorage.setItem('pl_mkt_session', '1');
      n += 1;
      localStorage.setItem(VISIT_KEY, String(n));
    }
    return n;
  } catch { return 1; }
}
