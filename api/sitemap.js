// Dynamic sitemap — static marketing pages + demo pages + every live store.
const ORIGIN  = 'https://www.pocketlink.store';
const MARKET  = 'https://market.pocketlink.store/';   // consumer marketplace home
const STATIC  = ['/', '/plans', '/start', '/terms', '/privacy'];
const DEMOS   = ['aanyaboutique', 'spiceroute', 'glowup', 'coralcourtyard'];

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

  const urls = [
    ...STATIC.map((p) => ({ loc: ORIGIN + p })),
    { loc: MARKET },
    ...DEMOS.map((s) => ({ loc: `${ORIGIN}/demo/${s}` })),
    ...stores
      .filter((s) => s && s.slug)
      .map((s) => ({ loc: `${ORIGIN}/${s.slug}`, lastmod: s.updated_at })),
  ];

  const body = urls.map((u) => {
    const lm = u.lastmod ? `<lastmod>${new Date(u.lastmod).toISOString().slice(0, 10)}</lastmod>` : '';
    return `  <url><loc>${u.loc}</loc>${lm}</url>`;
  }).join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${body}
</urlset>`;

  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
  res.status(200).send(xml);
}
