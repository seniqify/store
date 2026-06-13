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

// What humans see until React mounts: a branded splash instead of the raw
// crawlable text (which flashed as unstyled "SEO text" before hydration).
// The crawlable content stays in the DOM for bots, visually hidden.
function splash({ logoHtml, name, color }) {
  return `<div style="min-height:100dvh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;background:#f8fafc;font-family:system-ui,-apple-system,sans-serif">
${logoHtml}
<div style="font-weight:800;font-size:20px;color:#111827">${name}</div>
<div style="width:22px;height:22px;border:3px solid #e5e7eb;border-top-color:${color};border-radius:50%;animation:plspin .8s linear infinite"></div>
<style>@keyframes plspin{to{transform:rotate(360deg)}}</style>
</div>`;
}

function hiddenForBots(crawlHtml) {
  return `<div style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)">${crawlHtml}</div>`;
}

function storeSplash(config) {
  const primary = config.theme?.primary || '#0d9488';
  const dark    = config.theme?.primaryDark || primary;
  const logoHtml = typeof config.logo === 'string' && config.logo.startsWith('http')
    ? `<img src="${esc(config.logo)}" alt="" style="width:72px;height:72px;border-radius:20px;object-fit:cover;box-shadow:0 10px 30px rgba(0,0,0,.15)"/>`
    : `<div style="width:72px;height:72px;border-radius:20px;display:flex;align-items:center;justify-content:center;font-size:34px;background:linear-gradient(135deg,${primary},${dark});box-shadow:0 10px 30px rgba(0,0,0,.15)">${config.logoEmoji || '🏪'}</div>`;
  return splash({ logoHtml, name: esc(config.businessName || 'Loading…'), color: primary });
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

    // ── Marketplace (path on the main domain, or the root of market.*) ──
    if (path === '/marketplace' || path === '/explore' || (host.startsWith('market.') && path === '/')) {
      // Store pages always live on the main domain, whichever host serves the
      // marketplace — links must not point at market.*/slug.
      const storeOrigin = 'https://www.pocketlink.store';
      let stores = [];
      try {
        if (SUPABASE_URL && SUPABASE_ANON) {
          // Slim selection: the listing only needs name + tagline per store —
          // never pull full configs (products) for the whole table.
          const r = await fetch(
            `${SUPABASE_URL}/rest/v1/stores?select=slug,name:config->>businessName,tagline:config->>tagline&limit=200`,
            { headers: dbHeaders },
          );
          if (r.ok) {
            stores = (await r.json())
              .filter((s) => s.name)
              .map((s) => ({ slug: s.slug, config: { businessName: s.name, tagline: s.tagline } }));
          }
        }
      } catch { /* empty marketplace still renders */ }
      const seo = marketplaceSeo(stores, origin, storeOrigin);
      let html = injectHead(base, { ...seo, image: `${origin}/og-image.jpg` });
      const mpSplash = splash({
        logoHtml: '<div style="width:72px;height:72px;border-radius:20px;display:flex;align-items:center;justify-content:center;font-size:34px;background:linear-gradient(135deg,#0d9488,#064e3b);box-shadow:0 10px 30px rgba(0,0,0,.15)">🛍️</div>',
        name: 'PocketLink Market', color: '#0d9488',
      });
      html = injectBody(html, mpSplash + hiddenForBots(marketplaceBody(stores, storeOrigin)));
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
        // Hand the already-fetched config to the SPA so it hydrates instantly —
        // no second DB fetch, no "Loading page…" screen. (Escape </script>.)
        const cfgJson = JSON.stringify({ slug, config }).replace(/</g, '\\u003c');
        html = html.replace('</head>', `<script>window.__PL_CONFIG__=${cfgJson}</script>\n</head>`);
        html = injectBody(html, storeSplash(config) + hiddenForBots(storeBody(config, slug, origin, seo)));
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        // Short edge cache so owner edits surface in the link preview quickly on
        // re-scrape. The SPA also revalidates client-side, so humans never wait.
        res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=600');
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
