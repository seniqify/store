// Which kind of host the SPA is running on -- decided by the SERVER, never by
// anything the visitor can set (the path, a query value, the hostname alone).
//
// api/render.js writes window.__PL_HOST__ = { slug, base } into the page it
// renders for a merchant's own domain, and only there. With the marker, the SPA
// shows exactly that ONE store, at /, /p/{id} and /c/{id}, and nothing else.
// Without it, the SPA is PocketLink, exactly as before -- on every host.
const SLUG = /^[a-z0-9][a-z0-9-]{0,59}$/;

const POCKETLINK = Object.freeze({ mode: 'pocketlink' });
const INVALID = Object.freeze({ mode: 'invalid' });

/**
 * { mode: 'pocketlink' }                   no marker: PocketLink, as before
 * { mode: 'merchant', slug, base }         a valid marker for THIS hostname
 * { mode: 'invalid' }                      a marker that does not check out:
 *                                          show nothing (never PocketLink's pages,
 *                                          never another store)
 */
export function parseHostMarker(marker, hostname) {
  if (marker === undefined || marker === null) return POCKETLINK;
  const slug = marker?.slug;
  const base = marker?.base;
  if (typeof slug !== 'string' || !SLUG.test(slug) || typeof base !== 'string') return INVALID;
  let u;
  try { u = new URL(base); } catch { return INVALID; }
  if (u.protocol !== 'https:' || u.port !== '' || u.origin !== base
      || u.hostname !== String(hostname ?? '').toLowerCase()) return INVALID;
  return Object.freeze({ mode: 'merchant', slug, base });
}

let current = null;

/** This page's host mode, read once from the server's marker. */
export function hostMode() {
  if (current) return current;
  if (typeof window === 'undefined') return POCKETLINK;
  current = parseHostMarker(window.__PL_HOST__, window.location.hostname);
  return current;
}
