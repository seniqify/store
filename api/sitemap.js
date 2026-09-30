// Dynamic sitemap — static pages + demo pages + every live store.
// '/' is the merchant landing (home); '/marketplace' is the consumer marketplace.
//
// On a merchant's own domain (CUSTOM_DOMAINS_ROUTING_ENABLED on), the sitemap
// lists ONLY the store the database says owns that domain, on that domain --
// never another store. With routing off, every host gets PocketLink's, as before.
import { esc } from './_seo.js';
import { categoryLinkId } from './_categoryLink.js';
import { normalizeHost, classifyHost, routingEnabled } from './_hosts.js';
import { createResolver } from './_resolve.js';
import { sendNotConnected, sendUnavailable, sendNotFound, sendRedirect } from './_pages.js';

const ORIGIN  = 'https://www.pocketlink.store';
const STATIC  = ['/', '/marketplace', '/plans', '/start', '/terms', '/privacy'];
const DEMOS   = ['aanyaboutique', 'glowup'];

let defaultResolver = null;
function resolverFor(env) {
  return (defaultResolver ??= createResolver({
    url: env.VITE_SUPABASE_URL, anonKey: env.VITE_SUPABASE_ANON_KEY,
    fetchImpl: (u, init) => globalThis.fetch(u, init),
  }));
}

export default async function handler(req, res, deps = {}) {
  const env = deps.env ?? process.env;
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  const host = normalizeHost(req.headers?.host) || 'www.pocketlink.store';
  if (classifyHost(host, env) === 'custom' && routingEnabled(env)) {
    await merchantSitemap(res, { env, fetchImpl, host, resolver: deps.resolver ?? resolverFor(env) });
    return;
  }

  const SUPABASE_URL  = env.VITE_SUPABASE_URL;
  const SUPABASE_ANON = env.VITE_SUPABASE_ANON_KEY;

  let stores = [];
  try {
    if (SUPABASE_URL && SUPABASE_ANON) {
      const r = await fetchImpl(`${SUPABASE_URL}/rest/v1/stores?select=slug,updated_at`, {
        headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` },
      });
      if (r.ok) stores = await r.json();
    }
  } catch { /* still emit static + demos */ }

  // priority/changefreq: the home page is the most important, the marketplace
  // (fresh listings as stores join) next, then individual stores, then the rest.
  const prio = (p) => (p === '/' ? '1.0' : p === '/marketplace' ? '0.8' : '0.6');
  const freq = (p) => (p === '/' || p === '/marketplace' ? 'daily' : 'weekly');

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

// The one store that owns this merchant domain: its home, categories and
// products, at {domain}/, {domain}/c/{id}, {domain}/p/{id}.
async function merchantSitemap(res, { env, fetchImpl, host, resolver }) {
  const r = await resolver.resolveHost(host);
  if (r.status === 'error') { sendUnavailable(res); return; }
  if (r.status !== 'connected') { sendNotConnected(res); return; }
  if (!r.isPrimary) { sendRedirect(res, `https://${r.primaryHost}/sitemap.xml`); return; }

  let row;
  try {
    const resp = await fetchImpl(
      `${env.VITE_SUPABASE_URL}/rest/v1/stores?slug=eq.${encodeURIComponent(r.slug)}&select=slug,config,updated_at&limit=1`,
      { headers: { apikey: env.VITE_SUPABASE_ANON_KEY, Authorization: `Bearer ${env.VITE_SUPABASE_ANON_KEY}` } },
    );
    if (!resp.ok) throw new Error('store ' + resp.status);
    const rows = await resp.json();
    row = Array.isArray(rows) && rows[0] && rows[0].slug === r.slug ? rows[0] : null;
  } catch {
    sendUnavailable(res);
    return;
  }
  if (!row || !row.config || !row.config.businessName) { sendNotFound(res); return; }

  const base = `https://${host}`;
  const cats = Array.isArray(row.config.categories) ? row.config.categories : [];
  const products = Array.isArray(row.config.products) ? row.config.products : [];
  const locs = [
    base + '/',
    ...cats.filter((c) => c && c.id && c.id !== 'all').map((c) => `${base}/c/${categoryLinkId(c)}`),
    ...products.filter((p) => p && p.id != null && p.id !== '').slice(0, 5000).map((p) => `${base}/p/${p.id}`),
  ];
  const lm = row.updated_at ? `<lastmod>${new Date(row.updated_at).toISOString().slice(0, 10)}</lastmod>` : '';
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${locs.map((loc) => `  <url><loc>${esc(loc)}</loc>${lm}</url>`).join('\n')}
</urlset>`;
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).send(xml);
}
