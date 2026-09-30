// Server-renders SEO head + crawlable content for store pages and the marketplace,
// then lets the React SPA hydrate on top. Any failure after the base HTML is in
// hand → serve the normal SPA shell. A host that is not PocketLink's gets a
// neutral 404; a base HTML that cannot be had gets a 503 (never a redirect).
//
// A merchant's own domain (CUSTOM_DOMAINS_ROUTING_ENABLED on; see
// middleware.js): the database alone decides which ONE store it renders. The
// path -- or ?path -- only chooses that store's home, product or category page.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { esc, storeSeo, storeBody, marketplaceSeo, marketplaceBody } from './_seo.js';
import { resolveCategory } from './_categoryLink.js';
import { PL_ORIGIN, PL_HOSTS, normalizeHost, classifyHost, routingEnabled } from './_hosts.js';
import { createResolver } from './_resolve.js';
import { sendNotConnected, sendUnavailable, sendNotFound, sendRedirect } from './_pages.js';
import { storeRoute } from '../src/utils/customDomainRoutes.js';

export { PL_ORIGIN, normalizeHost };

const RESERVED = new Set([
  'start', 'plans', 'register', 'onboarding', 'checkout', 'terms', 'privacy',
  'sell', 'marketplace', 'explore', 'hub',
  'demo', 'sitemap.xml', 'robots.txt', 'llms.txt', 'favicon.svg', 'og-image.jpg',
  'icons.svg', 'pocketlink-logo.svg', 'assets', 'api', 'manage',
]);

// ── Which hosts this renderer serves ─────────────────────────────────────────
// PocketLink's own hosts and EXACTLY this project's own Vercel URLs render as
// PocketLink (api/_hosts.js). Any other host renders nothing -- unless custom-
// domain routing is on and the database says it is a merchant's connected domain.

/** May this host be served as PocketLink? */
export function isTrustedHost(host) {
  const kind = classifyHost(host, process.env);
  return kind === 'pocketlink' || kind === 'deployment';
}

/**
 * Where the SPA's base HTML is fetched from when this function does not carry
 * its own build's (see ownShell). Never the raw request host: a PocketLink host
 * always uses the main site, and one of this project's Vercel URLs uses itself
 * so a preview renders its OWN build. Anything else falls back to the main site.
 */
export function baseHtmlOrigin(host) {
  if (PL_HOSTS.has(host)) return PL_ORIGIN;
  return classifyHost(host, process.env) === 'deployment' ? `https://${host}` : PL_ORIGIN;
}

/**
 * The SPA shell for this response. When it is this build's own (bundled), the
 * response says so -- X-PL-Shell: own -- so a smoke check can see a page was
 * assembled from the build that serves its JavaScript. (A fetched shell adds
 * no header: responses stay exactly as they were before.)
 */
async function loadShell(res, env, deps, fetchOrigin, fetchImpl) {
  const own = deps.shell ?? ownShell(env);
  if (own) { res.setHeader('X-PL-Shell', 'own'); return own; }
  return getBaseHtml(fetchOrigin, fetchImpl);
}

async function getBaseHtml(origin, fetchImpl) {
  const r = await fetchImpl(`${origin}/index.html`, { headers: { 'x-pl-render': '1' } });
  if (!r.ok) throw new Error('base html ' + r.status);
  return await r.text();
}

// This deployment's own SPA shell: dist/index.html, bundled into this function
// by vercel.json (includeFiles). On Vercel it is always used, so the HTML comes
// from the very build whose /assets/* the browser loads next -- on a preview, on
// production and on a merchant's domain alike -- with no network fetch for it
// and no Deployment Protection in the way. Off Vercel (local tests), or if the
// file were missing, the shell is fetched as before (baseHtmlOrigin).
let ownShellCache;
function ownShell(env) {
  if (!env.VERCEL) return null;
  if (ownShellCache === undefined) {
    try { ownShellCache = readFileSync(join(process.cwd(), 'dist', 'index.html'), 'utf8'); } catch { ownShellCache = null; }
  }
  return ownShellCache;
}

// The database lookups (PR-B's public RPCs), shared by every request this
// instance serves; answers are cached briefly (api/_resolve.js).
let defaultResolver = null;
function resolverFor(env) {
  return (defaultResolver ??= createResolver({
    url: env.VITE_SUPABASE_URL, anonKey: env.VITE_SUPABASE_ANON_KEY,
    fetchImpl: (u, init) => globalThis.fetch(u, init),
  }));
}

// Every canonical <link>, whatever its attribute order or quoting.
const CANONICAL_TAG = /<link\b[^>]*\brel=["']?canonical["']?[^>]*>/gi;

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

  // Exactly ONE canonical: drop the base page's own (index.html points at the
  // home page) before adding this page's.
  html = html.replace(CANONICAL_TAG, '');
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

export default async function handler(req, res, deps = {}) {
  const env = deps.env ?? process.env;
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  const host = normalizeHost(req.headers.host) || 'www.pocketlink.store';
  const kind = classifyHost(host, env);
  const routing = routingEnabled(env);
  if (kind === 'custom') {
    // Not a PocketLink host. Routing off: never render a store, whatever the path
    // or ?path says -- exactly as before. Routing on: a merchant's domain.
    if (!routing) { sendNotConnected(res); return; }
    await renderMerchantDomain(req, res, { env, fetchImpl, host, deps });
    return;
  }
  const origin = `https://${host}`;

  let base;
  try {
    base = await loadShell(res, env, deps, baseHtmlOrigin(host), fetchImpl);
  } catch {
    sendUnavailable(res);
    return;
  }

  try {
    const url  = new URL(req.url, origin);
    const path = (url.searchParams.get('path') || url.pathname || '/').split('?')[0];

    const SUPABASE_URL  = env.VITE_SUPABASE_URL;
    const SUPABASE_ANON = env.VITE_SUPABASE_ANON_KEY;
    const dbHeaders = { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` };

    // ── Marketplace — lives at /marketplace (and the /explore alias). The
    //    root is the static merchant landing page, served unmodified below. ──
    if (path === '/marketplace' || path === '/explore') {
      // Store pages always live on the main domain, whichever host serves the
      // marketplace — links must not point at market.*/slug.
      const storeOrigin = 'https://www.pocketlink.store';
      let stores = [];
      try {
        if (SUPABASE_URL && SUPABASE_ANON) {
          // Slim selection: the listing only needs name + tagline per store —
          // never pull full configs (products) for the whole table.
          const r = await fetchImpl(
            `${SUPABASE_URL}/rest/v1/stores?select=slug,name:config->>businessName,tagline:config->>tagline,category:config->>category,city:config->>city&limit=200`,
            { headers: dbHeaders },
          );
          if (r.ok) {
            stores = (await r.json())
              .filter((s) => s.name)
              .map((s) => ({ slug: s.slug, config: { businessName: s.name, tagline: s.tagline, category: s.category, city: s.city } }));
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

    // ── Store page, and category links ──
    // /{slug} and /{slug}/c/{categoryId} render the same store page; the second
    // form previews as that category. Previously only single-segment paths got
    // here, so every deeper link fell through to the generic SPA shell and
    // shared with no preview at all — fatal for a link whose entire purpose is
    // being pasted into WhatsApp or an Instagram bio.
    const clean = path.replace(/^\//, '').replace(/\/$/, '').toLowerCase();
    const seg = clean.split('/');
    const slug = seg[0];
    const deep = seg.length === 3 && Boolean(seg[2]);
    const categoryId = deep && seg[1] === 'c' ? seg[2] : null;
    const productId  = deep && seg[1] === 'p' ? seg[2] : null;

    if (slug && (seg.length === 1 || categoryId || productId) && !RESERVED.has(slug) && SUPABASE_URL && SUPABASE_ANON) {
      let config = null;
      try {
        const r = await fetchImpl(
          `${SUPABASE_URL}/rest/v1/stores?slug=eq.${encodeURIComponent(slug)}&select=slug,config&limit=1`,
          { headers: dbHeaders },
        );
        if (r.ok) { const rows = await r.json(); if (rows[0]) config = rows[0].config; }
      } catch { /* fall through to SPA */ }

      if (config && config.businessName) {
        // Published verified-review aggregate → star rich result (best-effort, never blocks).
        let rating = null;
        try {
          const rr = await fetchImpl(
            `${SUPABASE_URL}/rest/v1/product_reviews?store_slug=eq.${encodeURIComponent(slug)}&status=eq.published&select=rating`,
            { headers: dbHeaders },
          );
          if (rr.ok) {
            const rows = await rr.json();
            if (Array.isArray(rows) && rows.length) {
              const sum = rows.reduce((s, x) => s + (Number(x.rating) || 0), 0);
              rating = { avg: Math.round((sum / rows.length) * 10) / 10, count: rows.length };
            }
          }
        } catch { /* no rating → no aggregateRating; page still renders */ }

        // An unknown or deleted category id previews as the whole shop rather
        // than as a broken page — a link on a leaflet outlives the category it
        // pointed at, and the SPA falls back the same way.
        // Accepts either the readable slug of the current label or the original
        // id, so links survive a category being renamed.
        const section = categoryId ? resolveCategory(config.categories, categoryId) : null;
        // Product ids are compared as strings and case-insensitively, because
        // the path was lowercased above and ids are not guaranteed to be.
        const item = productId
          ? (config.products || []).find((p) => p && String(p.id).toLowerCase() === productId) || null
          : null;
        // Where this store lives: {origin}/{slug}, or -- with routing on -- its
        // connected merchant domain, which then carries the canonical (the page is
        // still served here: no redirect, so PocketLink always works as a fallback).
        const domain = routing ? await (deps.resolver ?? resolverFor(env)).primaryHostFor(slug) : null;
        const storeBase = domain ? `https://${domain}` : `${origin}/${slug}`;
        const seo = storeSeo(config, slug, origin, rating, section, item, { storeBase });
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

// The SPA shell describes PocketLink's own home page. On a merchant's domain
// none of that is true: drop PocketLink's structured data (Organization,
// WebSite and its marketplace search box) and keywords, and name the store --
// not PocketLink -- as the site in the link-preview tags.
const LD_JSON = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi;
function merchantShell(html, name) {
  const set = (key, val, content) => {
    const re = new RegExp(`(<meta\\s+${key}="${val}"\\s+content=")[^"]*(")`, 'i');
    return (h) => h.replace(re, `$1${esc(content)}$2`);
  };
  let out = html.replace(LD_JSON, '').replace(/<meta\s+name="keywords"[^>]*>\s*/i, '');
  for (const f of [set('property', 'og:site_name', name), set('property', 'og:image:alt', name), set('name', 'twitter:image:alt', name)]) {
    out = f(out);
  }
  return out;
}

// ── A merchant's own domain ──────────────────────────────────────────────────
// The store comes ONLY from the database (resolve_store_host); nothing in the
// request names it. Only that store's /, /p/{id} and /c/{id} render; the page's
// canonical, og:url and JSON-LD are on the merchant's domain, with no PocketLink
// Marketplace breadcrumb or link. Every answer is no-store.
async function renderMerchantDomain(req, res, { env, fetchImpl, host, deps }) {
  const r = await (deps.resolver ?? resolverFor(env)).resolveHost(host);
  if (r.status === 'error') { sendUnavailable(res); return; }
  if (r.status !== 'connected') { sendNotConnected(res); return; }

  const url = new URL(req.url, `https://${host}`);
  const path = (url.searchParams.get('path') || url.pathname || '/').split('?')[0];
  const route = storeRoute(path);
  if (!r.isPrimary) { sendRedirect(res, `https://${r.primaryHost}${route ? path : '/'}`); return; }
  if (!route) { sendNotFound(res); return; }

  let base;
  try {
    base = await loadShell(res, env, deps, PL_ORIGIN, fetchImpl);
  } catch {
    sendUnavailable(res);
    return;
  }

  const SUPABASE_URL  = env.VITE_SUPABASE_URL;
  const SUPABASE_ANON = env.VITE_SUPABASE_ANON_KEY;
  const dbHeaders = { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` };
  const slug = r.slug;

  let config;
  try {
    const resp = await fetchImpl(
      `${SUPABASE_URL}/rest/v1/stores?slug=eq.${encodeURIComponent(slug)}&select=slug,config&limit=1`,
      { headers: dbHeaders },
    );
    if (!resp.ok) throw new Error('store ' + resp.status);
    const rows = await resp.json();
    config = Array.isArray(rows) && rows[0] && rows[0].slug === slug ? rows[0].config : null;
  } catch {
    sendUnavailable(res);   // never an unrendered shell on a merchant's domain
    return;
  }
  if (!config || !config.businessName) { sendNotFound(res); return; }

  let rating = null;
  try {
    const rr = await fetchImpl(
      `${SUPABASE_URL}/rest/v1/product_reviews?store_slug=eq.${encodeURIComponent(slug)}&status=eq.published&select=rating`,
      { headers: dbHeaders },
    );
    if (rr.ok) {
      const rows = await rr.json();
      if (Array.isArray(rows) && rows.length) {
        const sum = rows.reduce((t, x) => t + (Number(x.rating) || 0), 0);
        rating = { avg: Math.round((sum / rows.length) * 10) / 10, count: rows.length };
      }
    }
  } catch { /* no rating */ }

  const id = route.kind === 'home' ? null : route.id.toLowerCase();
  const section = route.kind === 'category' ? resolveCategory(config.categories, id) : null;
  const item = route.kind === 'product'
    ? (config.products || []).find((p) => p && String(p.id).toLowerCase() === id) || null
    : null;

  const origin = `https://${host}`;
  const seo = storeSeo(config, slug, origin, rating, section, item, { storeBase: origin, marketplace: false });
  let html = injectHead(merchantShell(base, config.businessName), seo);
  const cfgJson = JSON.stringify({ slug, config }).replace(/</g, '\\u003c');
  const hostJson = JSON.stringify({ slug, base: origin }).replace(/</g, '\\u003c');
  // __PL_HOST__ puts the SPA in merchant-domain mode for exactly this store.
  html = html.replace('</head>', `<script>window.__PL_CONFIG__=${cfgJson};window.__PL_HOST__=${hostJson}</script>\n</head>`);
  html = injectBody(html, storeSplash(config) + hiddenForBots(storeBody(config, slug, origin, seo)));
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).send(html);
}
