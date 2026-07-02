// Dynamic sitemap — static pages + demo pages + every live store.
// '/' is now the consumer marketplace home; '/sell' is the merchant landing.
const ORIGIN  = 'https://www.pocketlink.store';
const STATIC  = ['/', '/sell', '/plans', '/start', '/terms', '/privacy'];
const DEMOS   = ['aanyaboutique', 'glowup'];

export default async function handler(req, res) {
  const SUPABASE_URL  = process.env.VITE_SUPABASE_URL;
  const SUPABASE_ANON = process.env.VITE_SUPABASE_ANON_KEY;

  let stores = [];
  try {
    if (SUPABASE_URL && SUPABASE_ANON) {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/stores?select=slug,updated_at`, {
        headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` },
      });
      if (r.ok) stores = await r.json();
    }
  } catch { /* still emit static + demos */ }

  // priority/changefreq: the marketplace root is the most important page, the
  // merchant landing next, then individual stores, then the rest.
  const prio = (p) => (p === '/' ? '1.0' : p === '/sell' ? '0.9' : '0.6');
  const freq = (p) => (p === '/' ? 'daily' : 'weekly');

  const urls = [
    ...STATIC.map((p) => ({ loc: ORIGIN + p, priority: prio(p), changefreq: freq(p) })),
    ...DEMOS.map((s) => ({ loc: `${ORIGIN}/demo/${s}`, priority: '0.4', changefreq: 'monthly' })),
    ...stores
      .filter((s) => s && s.slug)
      .map((s) => ({ loc: `${ORIGIN}/${s.slug}`, lastmod: s.updated_at, priority: '0.8', changefreq: 'weekly' })),
  ];

  const body = urls.map((u) => {
    const lm = u.lastmod ? `<lastmod>${new Date(u.lastmod).toISOString().slice(0, 10)}</lastmod>` : '';
    const cf = u.changefreq ? `<changefreq>${u.changefreq}</changefreq>` : '';
    const pr = u.priority ? `<priority>${u.priority}</priority>` : '';
    return `  <url><loc>${u.loc}</loc>${lm}${cf}${pr}</url>`;
  }).join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${body}
</urlset>`;

  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
  res.status(200).send(xml);
}
