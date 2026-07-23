// Runs only for "/" (matcher below), handling what vercel.json's "/:p*"
// host-redirect can't: it matches every path EXCEPT the bare root, so the
// retired market.pocketlink.store subdomain needs its root 308'd here.
// Non-root market.* paths are still handled by vercel.json.
//
// The root itself is the static merchant landing page (no per-request data,
// so no SSR needed here) — falls through to the filesystem untouched.
export const config = { matcher: '/' };

export default function middleware(req) {
  const { hostname } = new URL(req.url);
  if (hostname.startsWith('market.')) {
    return Response.redirect('https://www.pocketlink.store/', 308);
  }
}
