// Server-renders SEO head + crawlable content for store pages and the marketplace,
// then lets the React SPA hydrate on top. Any failure → serve the normal SPA shell.
import { esc, storeSeo, storeBody, marketplaceSeo, marketplaceBody } from './_seo.js';

const RESERVED = new Set([
  'start', 'plans', 'register', 'onboarding', 'checkout', 'terms', 'privacy',
  'demo', 'sitemap.xml', 'robots.txt', 'llms.txt', 'favicon.svg', 'og-image.jpg',
  'icons.svg', 'pocketlink-logo.svg', 'assets', 'api', 'manage',
]);

async function getBaseHtml(host) {
  const r = await fetch(`https://${host}/index.html`, { headers: { 'x-pl-render': '1' } });
  if (!r.ok) throw new Error('base html ' + r.status);
  return await r.text();
}

function injectHead(html, { title, description, url, image, ld }) {
  if (title) html = html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${esc(title)}</title>`);
  const setMeta = (key, val, content) => {
    if (content == null) return;
    const re = new RegExp(`(<meta\\s+${key}="${val}"\\s+content=")[^"]*(")`, 'i');
    if (re.test(html)) html = html.replace(re, `$1${esc(content)}$2`);
  };
  setMeta('name', 'description', description);
  setMeta('property', 'og:title', title);
  setMeta('property', 'og:description', description);
  setMeta('property', 'og:url', url);
  setMeta('property', 'og:image', image);
  setMeta('property', 'og:image:secure_url', image);
  setMeta('name', 'twitter:title', title);
  setMeta('name', 'twitter:description', description);
  setMeta('name', 'twitter:image', image);

  const inject =
    `<link rel="canonical" href="${esc(url)}"/>\n` +
    `<script type="application/ld+json">${JSON.stringify(ld)}</script>\n</head>`;
  return html.replace('</head>', inject);
}

function injectBody(html, bodyHtml) {
  return html.replace(/<div id="root">\s*<\/div>/, `<div id="root">${bodyHtml}</div>`);
}

export default async function handler(req, res) {
  const host   = req.headers.host || 'www.pocketlink.store';
  const origin = `https://${host}`;

  let base;
  try {
    base = await getBaseHtml(host);
  } catch {
    res.setHeader('Location', origin + (req.url || '/'));
    res.status(302).end();
    return;
  }

  try {
    const url  = new URL(req.url, origin);
    const path = (url.searchParams.get('path') || url.pathname || '/').split('?')[0];

    const SUPABASE_URL  = process.env.VITE_SUPABASE_URL;
    const SUPABASE_ANON = process.env.VITE_SUPABASE_ANON_KEY;
    const dbHeaders = { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` };

    // ── Marketplace ──
    if (path === '/marketplace' || path === '/explore') {
      let stores = [];
      try {
        if (SUPABASE_URL && SUPABASE_ANON) {
          const r = await fetch(`${SUPABASE_URL}/rest/v1/stores?select=slug,config`, { headers: dbHeaders });
          if (r.ok) stores = (await r.json()).filter((s) => s.config && s.config.businessName);
        }
      } catch { /* empty marketplace still renders */ }
      const seo = marketplaceSeo(stores, origin);
      let html = injectHead(base, { ...seo, image: `${origin}/og-image.jpg` });
      html = injectBody(html, marketplaceBody(stores, origin));
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=86400');
      res.status(200).send(html);
      return;
    }

    // ── Store page ──
    const slug = path.replace(/^\//, '').replace(/\/$/, '').toLowerCase();
    if (slug && !slug.includes('/') && !RESERVED.has(slug) && SUPABASE_URL && SUPABASE_ANON) {
      let config = null;
      try {
        const r = await fetch(
          `${SUPABASE_URL}/rest/v1/stores?slug=eq.${encodeURIComponent(slug)}&select=slug,config&limit=1`,
          { headers: dbHeaders },
        );
        if (r.ok) { const rows = await r.json(); if (rows[0]) config = rows[0].config; }
      } catch { /* fall through to SPA */ }

      if (config && config.businessName) {
        const seo = storeSeo(config, slug, origin);
        let html = injectHead(base, seo);
        html = injectBody(html, storeBody(config, slug, origin, seo));
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=86400');
        res.status(200).send(html);
        return;
      }
    }

    // ── Fallback: unmodified SPA shell ──
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(200).send(base);
  } catch {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(200).send(base);
  }
}
