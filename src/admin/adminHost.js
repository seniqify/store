// Which host serves PocketLink Admin. Used by the edge middleware (every page
// on it is the Admin app) and by the SPA (render only Admin there). PURE.
export const ADMIN_HOSTS = Object.freeze(['admin.pocketlink.store']);

export function isAdminHost(hostname) {
  return ADMIN_HOSTS.includes(String(hostname ?? '').trim().toLowerCase().replace(/\.$/, ''));
}

export const ADMIN_ORIGIN = 'https://admin.pocketlink.store';
