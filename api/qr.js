// Per-store QR code (PNG) for the public store URL.
// Used as the image header in the WhatsApp store-registration welcome message,
// and reusable anywhere a stable QR URL is handy. Proxies the QR generator and
// caches on the CDN so the transactional send has a fast, reliable image URL.
const SITE = 'https://www.pocketlink.store';

export default async function handler(req, res) {
  const raw  = (req.query && req.query.slug) || '';
  const slug = String(raw).toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 60);
  if (!slug) { res.status(400).send('missing slug'); return; }

  const target = `${SITE}/${slug}`;
  const src = `https://api.qrserver.com/v1/create-qr-code/?size=600x600&margin=12&qzone=1&color=111827&data=${encodeURIComponent(target)}`;

  try {
    const r = await fetch(src);
    if (!r.ok) throw new Error('qr ' + r.status);
    const buf = Buffer.from(await r.arrayBuffer());
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400');
    res.status(200).send(buf);
  } catch {
    // If the generator is unreachable, redirect to it so the QR still resolves.
    res.setHeader('Location', src);
    res.status(302).end();
  }
}
