import { rewrite, next } from '@vercel/edge';

// Root-path host routing. vercel.json rewrites can't do this: Vercel serves the
// static index.html for "/" before rewrites are consulted, so the consumer
// subdomain's root would get the SPA shell instead of the SSR'd marketplace.
// Middleware runs BEFORE the filesystem. Matcher limits it to "/" only — no
// other request pays for this hop.
export const config = { matcher: '/' };

export default function middleware(req) {
  const url = new URL(req.url);
  if (url.hostname.startsWith('market.')) {
    return rewrite(new URL('/api/render?path=/marketplace', req.url));
  }
  return next();
}
