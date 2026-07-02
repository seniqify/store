import { rewrite } from '@vercel/edge';

// Runs only for "/" (matcher below). Two jobs, both of which vercel.json can't
// reliably do for the root path:
//   1. Retired market.pocketlink.store → 301 to the main domain. (vercel.json's
//      "/:p*" host-redirect matches every path EXCEPT the bare root, so the root
//      must be handled here. Non-root market paths are still 308'd by vercel.json.)
//   2. Main-domain root → the SSR-rendered marketplace. A vercel.json rewrite
//      can't do this: Vercel serves the static index.html for "/" before rewrites
//      are consulted, so crawlers would get the SPA shell. Middleware runs BEFORE
//      the filesystem.
export const config = { matcher: '/' };

export default function middleware(req) {
  const { hostname } = new URL(req.url);
  if (hostname.startsWith('market.')) {
    return Response.redirect('https://www.pocketlink.store/', 308);
  }
  return rewrite(new URL('/api/render?path=/', req.url));
}
