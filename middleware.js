import { rewrite } from '@vercel/edge';

// The site root is the SSR-rendered marketplace. A vercel.json rewrite can't do
// this: Vercel serves the static index.html for "/" before rewrites are
// consulted, so the root would get the SPA shell instead of crawlable,
// prerendered marketplace HTML. Middleware runs BEFORE the filesystem. Matcher
// limits it to "/" only — no other request pays for this hop.
//
// The retired market.pocketlink.store subdomain is 301'd to the main domain by
// vercel.json (redirects run before middleware), so it never reaches here.
export const config = { matcher: '/' };

export default function middleware(req) {
  return rewrite(new URL('/api/render?path=/', req.url));
}
