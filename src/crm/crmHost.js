// Which host serves the Sales CRM. Used by the edge middleware (every page on
// it is the CRM app) and by the SPA (render only the CRM there). PURE.
export const CRM_HOSTS = Object.freeze(['crm.pocketlink.store']);

export function isCrmHost(hostname) {
  return CRM_HOSTS.includes(String(hostname ?? '').trim().toLowerCase().replace(/\.$/, ''));
}

/** Where the CRM lives from the main site's point of view. */
export const CRM_ORIGIN = 'https://crm.pocketlink.store';
