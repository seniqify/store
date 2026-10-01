// PR-D: custom-domain routing and storefront rendering.
//
// Every request goes through VERCEL'S OWN compiled route table for this repo
// (tests/fixtures/vercel-routes.json, from `vercel build`), run the way Vercel's
// router answered on production (tests/helpers/vercelRouter.mjs) -- the real
// middleware.js at its real place in it -- then the real api/render.js and
// api/sitemap.js (tests/helpers/routingWorld.mjs). Which store a domain serves
// comes from the REAL PR-B + PR-B.1 SQL in PGlite: each domain status is reached
// through the real domain functions, and resolve_store_host / store_primary_host
// answer as the anon role, as on production.
//
// Browser behaviour (cold loads, client-side navigation) is covered by
// tests/e2e/custom-domain-browser.mjs; the SPA's pure pieces by
// tests/custom-domain-spa.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  SB, ANON, BRAND, createDb, domainIn, setPrimary, disconnect, createSupabase, createPipeline, get, VERCEL_ROUTES,
  POCKETLINK_IMAGE_CACHE,
} from './helpers/routingWorld.mjs';
import { VERCEL_NOT_FOUND } from './helpers/vercelRouter.mjs';
import { makeFetch, runHandler, POCKETLINK_CASES } from './helpers/renderHarness.mjs';
import renderHandler from '../api/render.js';
import { interpretResolve, createResolver, RESOLVE_CACHE_MS, RESOLVE_MISS_CACHE_MS } from '../api/_resolve.js';
import { classifyHost, routingEnabled, validHostname, normalizeHost } from '../api/_hosts.js';
import { PL_ORIGIN, PASS_THROUGH_FILES } from '../src/utils/customDomainRoutes.js';

const read = (p) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), 'utf8').replace(/\r\n/g, '\n');
const SHELL = JSON.parse(read('tests/fixtures/render-snapshots.json')).baseHtml;

const ENV_OFF = Object.freeze({ VITE_SUPABASE_URL: SB, VITE_SUPABASE_ANON_KEY: ANON });
const ENV_ON = Object.freeze({ ...ENV_OFF, CUSTOM_DOMAINS_ROUTING_ENABLED: 'true' });
const DOMAIN = 'brandshop.test';
const WWW_DOMAIN = `www.${DOMAIN}`;

const canonicals = (html) => [...html.matchAll(/<link\b[^>]*\brel=["']?canonical["']?[^>]*>/gi)]
  .map((m) => (m[0].match(/href="([^"]*)"/) || [])[1]);
const ogUrl = (html) => (html.match(/<meta\s+property="og:url"\s+content="([^"]*)"/) || [])[1];
const hostMarker = (html) => {
  const m = html.match(/window\.__PL_HOST__=(\{[^<]*?\})<\/script>/);
  return m ? JSON.parse(m[1]) : null;
};
const OTHER_STORE_TEXT = ['Other Store', 'Secret Tea', 'otherstore'];
const assertNoOtherStore = (r, what) => {
  for (const t of OTHER_STORE_TEXT) assert.equal(r.text.includes(t), false, `${what}: must not reveal "${t}"`);
};
const resolverCalls = (sb) => sb.log.filter((e) => e.path.startsWith('/rest/v1/rpc/resolve_store_host')).length;
const storeReadsFor = (sb, slug) => sb.log.filter((e) => e.path === '/rest/v1/stores' && e.query.includes(`slug=eq.${slug}`)).length;

async function world({ env = ENV_ON, status = 'connected', now, shell = SHELL, files, middlewareCaseInsensitive } = {}) {
  const db = await createDb();
  const g = status ? await domainIn(db, BRAND.slug, DOMAIN, status) : null;
  const supabase = createSupabase(db);
  const pipeline = createPipeline({ env, supabase, shell, now, files, middlewareCaseInsensitive });
  return { db, g, supabase, pipeline, get: (path, headers) => get(pipeline, path.startsWith('http') ? path : `https://${DOMAIN}${path}`, headers) };
}

// ═══════════════════════════════════════════════════════════════════════════
// Routing OFF: inert -- exactly today's behaviour, and no lookup at all
// ═══════════════════════════════════════════════════════════════════════════

test('routing off: no database lookup on ANY host or path, and a connected merchant domain still serves no store', async () => {
  const w = await world({ env: ENV_OFF });
  const hosts = ['www.pocketlink.store', 'pocketlink.store', 'market.pocketlink.store', DOMAIN, WWW_DOMAIN, 'unknown.test'];
  const paths = ['/', '/brandshop', '/brandshop/p/p1', '/p/p1', '/c/mugs', '/manage', '/start', '/robots.txt', '/sitemap.xml', '/index.html'];
  for (const h of hosts) for (const p of paths) await w.get(`https://${h}${p}`);
  assert.equal(resolverCalls(w.supabase), 0, 'no resolve_store_host call');
  assert.equal(w.supabase.log.filter((e) => e.path.includes('store_primary_host')).length, 0, 'no store_primary_host call');
  // Today's behaviour on a non-PocketLink host: store paths 404 "not connected", the root is the static shell.
  const store = await w.get('/brandshop');
  assert.equal(store.status, 404);
  assert.match(store.text, /not connected to a PocketLink shop/);
  const root = await w.get('/');
  assert.deepEqual([root.status, root.via], [200, 'static']);
  assert.equal(root.text, SHELL);
  const p = await w.get('/p/p1');
  assert.deepEqual([p.status, p.via], [200, 'rewrite'], 'the SPA catch-all, as today');
  assert.equal(hostMarker(p.text), null);
});

test('routing off: the flag is exactly "true" (trimmed, any case); anything else is off', () => {
  for (const [v, on] of [[undefined, false], ['', false], ['1', false], ['yes', false], ['true ', true], ['TRUE', true], ['false', false], ['on', false]]) {
    assert.equal(routingEnabled({ CUSTOM_DOMAINS_ROUTING_ENABLED: v }), on, String(v));
  }
  assert.equal(routingEnabled({ CUSTOM_DOMAINS_ENABLED: 'true' }), false, 'the management flag does not turn routing on');
});

test('routing on changes NOTHING on PocketLink pages of stores without a domain: every render case byte-identical to routing off', async () => {
  for (const c of POCKETLINK_CASES) {
    const outs = [];
    for (const flag of [undefined, 'true']) {
      const prev = process.env.CUSTOM_DOMAINS_ROUTING_ENABLED;
      if (flag === undefined) delete process.env.CUSTOM_DOMAINS_ROUTING_ENABLED; else process.env.CUSTOM_DOMAINS_ROUTING_ENABLED = flag;
      try {
        // A store without a domain: store_primary_host answers null.
        const { fetchImpl: base } = makeFetch(SHELL, c.opts);
        const fetchImpl = async (u, init) => (String(u).endsWith('/rest/v1/rpc/store_primary_host')
          ? { ok: true, status: 200, json: async () => null, text: async () => 'null' } : base(u, init));
        outs.push(await runHandler(renderHandler, c, fetchImpl));
      } finally {
        if (prev === undefined) delete process.env.CUSTOM_DOMAINS_ROUTING_ENABLED; else process.env.CUSTOM_DOMAINS_ROUTING_ENABLED = prev;
      }
    }
    assert.equal(outs[1].status, outs[0].status, c.name);
    assert.equal(outs[1].body, outs[0].body, c.name);
    assert.equal(outs[1].headers['cache-control'], outs[0].headers['cache-control'], c.name);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// A connected merchant domain serves ONLY its own store
// ═══════════════════════════════════════════════════════════════════════════

test('connected domain: /, /p/{id} and /c/{id} render the OWNING store, canonical on the domain, no-store', async () => {
  const w = await world();
  const cases = [
    ['/', `https://${DOMAIN}`],
    ['/p/p1', `https://${DOMAIN}/p/p1`],
    ['/p/P1/', `https://${DOMAIN}/p/p1`],
    ['/c/mugs', `https://${DOMAIN}/c/mugs`],
  ];
  for (const [path, canonical] of cases) {
    const r = await w.get(path);
    assert.deepEqual([r.status, r.via], [200, 'function'], path);
    assert.deepEqual(canonicals(r.text), [canonical], `${path}: exactly one canonical, on the merchant domain`);
    assert.equal(ogUrl(r.text), canonical, path);
    assert.deepEqual(hostMarker(r.text), { slug: 'brandshop', base: `https://${DOMAIN}` }, path);
    assert.match(r.text, /window\.__PL_CONFIG__=\{"slug":"brandshop"/, path);
    assert.match(r.text, /Brand Shop/, path);
    assert.equal(r.headers['cache-control'], 'no-store', path);
    assert.equal(r.text.includes('PocketLink Marketplace'), false, `${path}: no marketplace breadcrumb`);
    assert.doesNotMatch(r.text, /href="[^"]*marketplace|pocketlink\.store\/marketplace|SearchAction/, `${path}: no marketplace link or search box`);
    assert.doesNotMatch(r.text, /"@type":"(Organization|WebSite)"/, `${path}: none of PocketLink's own structured data`);
    assert.match(r.text, /<meta property="og:site_name"\s+content="Brand Shop"/, `${path}: the store names the site`);
    assertNoOtherStore(r, path);
  }
  const product = await w.get('/p/p1');
  assert.match(product.text, /<title>Clay Mug — Brand Shop/);
  const cat = await w.get('/c/mugs');
  assert.match(cat.text, /<title>Mugs — Brand Shop/);
  assert.equal(storeReadsFor(w.supabase, 'otherstore'), 0, 'the other store was never even read');
});

test('host isolation: no path, query, header or direct endpoint on a merchant domain reveals another store', async () => {
  const w = await world();
  const attempts = [
    ['/otherstore', 404], ['/otherstore/', 404], ['/otherstore/p/o1', 404], ['/otherstore/c/tea', 404],
    ['/brandshop', 404], ['/brandshop/p/p1', 404],
    ['/api/render?path=/otherstore', 404], ['/api/render?path=/p/o1', 404], ['/api/render', 404],
    ['/api/sitemap', 404], ['/index.html', 404], ['/llms.txt', 404],
    ['/p', 404], ['/c/', 404], ['/p/o1/extra', 404], ['/demo', 404],
    ['/?slug=otherstore', 200], ['/?path=/otherstore', 200], ['/p/o1', 200],
  ];
  for (const [path, status] of attempts) {
    const r = await w.get(path, { 'x-forwarded-host': 'otherstore.test', 'x-pl-slug': 'otherstore', 'x-pl-host': 'otherstore' });
    assert.equal(r.status, status, path);
    assertNoOtherStore(r, path);
    if (status === 200) assert.deepEqual(hostMarker(r.text), { slug: 'brandshop', base: `https://${DOMAIN}` }, path);
  }
  // An id that exists only in another store is just this store's page -- not that product.
  const foreign = await w.get('/p/o1');
  assert.deepEqual(canonicals(foreign.text), [`https://${DOMAIN}`]);
  assert.equal(storeReadsFor(w.supabase, 'otherstore'), 0, 'the other store was never read');
});

test('store-image endpoints on a merchant domain draw only that domain\'s store', async () => {
  const w = await world();
  for (const [path, ok] of [
    ['/api/og?slug=brandshop', true], ['/api/qr?slug=brandshop', true], ['/api/og?slug=Brand-Shop!', false],
    ['/api/og?slug=otherstore', false], ['/api/qr?slug=OTHERSTORE', false], ['/api/og', false], ['/api/qr?slug=', false],
  ]) {
    const r = await w.get(path);
    assert.equal(r.status, ok ? 200 : 404, path);
    assert.equal(r.headers['cache-control'], 'no-store', `${path}: never cached on a merchant domain`);
    if (ok) assert.equal(r.via, 'function', path);
  }
});

test('PocketLink-only paths: explicit temporary redirects -- /manage to THIS store\'s dashboard -- and nothing else', async () => {
  const w = await world();
  const mapped = [
    ['/manage', `${PL_ORIGIN}/brandshop/manage`], ['/manage/', `${PL_ORIGIN}/brandshop/manage`],
    ['/brandshop/manage', `${PL_ORIGIN}/brandshop/manage`], ['/manage?tab=orders', `${PL_ORIGIN}/brandshop/manage?tab=orders`],
    ['/start', `${PL_ORIGIN}/start`], ['/plans', `${PL_ORIGIN}/plans`], ['/onboarding', `${PL_ORIGIN}/onboarding`],
    ['/terms?x=1', `${PL_ORIGIN}/terms?x=1`], ['/privacy', `${PL_ORIGIN}/privacy`], ['/data-deletion', `${PL_ORIGIN}/data-deletion`],
    ['/hub', `${PL_ORIGIN}/hub`], ['/console', `${PL_ORIGIN}/console`], ['/marketplace?q=tea', `${PL_ORIGIN}/marketplace?q=tea`],
    ['/explore', `${PL_ORIGIN}/explore`], ['/checkout/pro', `${PL_ORIGIN}/checkout/pro`],
    ['/order/tok-123', `${PL_ORIGIN}/order/tok-123`], ['/confirm/tok-9', `${PL_ORIGIN}/confirm/tok-9`],
    ['/review/tok-7', `${PL_ORIGIN}/review/tok-7`], ['/demo/glowup', `${PL_ORIGIN}/demo/glowup`],
  ];
  for (const [path, location] of mapped) {
    const r = await w.get(path);
    assert.deepEqual([r.status, r.headers.location, r.headers['cache-control']], [307, location, 'no-store'], path);
  }
  for (const path of ['/otherstore/manage', '/start/x', '/order', '/order/a/b', '/checkout']) {
    const r = await w.get(path);
    assert.equal(r.status, 404, path);
  }
  // Vercel runs vercel.json's redirects BEFORE the middleware (the compiled route
  // table puts them first): /sell stays on this domain, at its home -- this store.
  const sell = await w.get('/sell');
  assert.deepEqual([sell.status, sell.headers.location], [308, '/']);
});

test('robots.txt and sitemap.xml on a merchant domain: that store only, on that domain', async () => {
  const w = await world();
  const robots = await w.get('/robots.txt');
  assert.deepEqual([robots.status, robots.headers['cache-control']], [200, 'no-store']);
  assert.match(robots.text, new RegExp(`Sitemap: https://${DOMAIN.replace('.', '\\.')}/sitemap\\.xml`));
  assert.equal(robots.text.includes('pocketlink'), false);
  const sm = await w.get('/sitemap.xml');
  assert.deepEqual([sm.status, sm.headers['cache-control']], [200, 'no-store']);
  const locs = [...sm.text.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  assert.deepEqual(locs, [`https://${DOMAIN}/`, `https://${DOMAIN}/c/mugs`, `https://${DOMAIN}/c/lamps`, `https://${DOMAIN}/p/p1`, `https://${DOMAIN}/p/p2`]);
  assertNoOtherStore(sm, 'sitemap');
  assert.equal(sm.text.includes('pocketlink'), false);
});

test('generic assets pass through a merchant domain untouched -- without even a lookup', async () => {
  const w = await world();
  for (const path of ['/favicon.svg', '/version.json', '/assets/app.js']) {
    const r = await w.get(path);
    assert.deepEqual([r.status, r.via], [200, 'static'], path);
  }
  assert.equal(resolverCalls(w.supabase), 0);
});

// ═══════════════════════════════════════════════════════════════════════════
// Not connected: nothing, on every path
// ═══════════════════════════════════════════════════════════════════════════

test('every status other than connected -- and a never-claimed host -- serves NOTHING, on every path', async () => {
  for (const status of ['pending', 'verified', 'ready', 'misconfigured', 'disconnecting', 'disconnected', 'expired', null]) {
    const w = await world({ status });
    for (const host of [DOMAIN, WWW_DOMAIN]) {
      for (const path of ['/', '/p/p1', '/c/mugs', '/otherstore', '/manage', '/start', '/robots.txt', '/sitemap.xml', '/api/og?slug=brandshop']) {
        const r = await w.get(`https://${host}${path}`);
        assert.equal(r.status, 404, `${status} ${host}${path}`);
        assert.match(r.text, /not connected to a PocketLink shop/, `${status} ${host}${path}`);
        assert.deepEqual([r.headers['cache-control'], r.headers['x-robots-tag']], ['no-store', 'noindex']);
        assert.equal(r.text.includes('Brand Shop'), false);
      }
    }
    assert.equal(storeReadsFor(w.supabase, 'brandshop'), 0, `${status}: no store read at all`);
  }
});

test('render and sitemap refuse on their own too (defence in depth): a host the database does not connect gets nothing', async () => {
  const w = await world({ status: 'ready' });
  const sb = w.supabase;
  const call = async (handler, url) => {
    const out = { status: 200, headers: {}, body: '' };
    const res = { setHeader: (k, v) => { out.headers[k.toLowerCase()] = String(v); }, status: (c) => { out.status = c; return res; },
                  send: (b) => { out.body = String(b); return res; } };
    await handler({ headers: { host: DOMAIN }, url }, res, { env: ENV_ON, fetchImpl: sb.handle, shell: SHELL,
      resolver: createResolver({ url: SB, anonKey: ANON, fetchImpl: sb.handle }) });
    return out;
  };
  const r = await call(renderHandler, '/api/render?path=/');
  assert.equal(r.status, 404);
  const { default: sitemap } = await import('../api/sitemap.js');
  assert.equal((await call(sitemap, '/api/sitemap')).status, 404);
});

// ═══════════════════════════════════════════════════════════════════════════
// Primary changes, disconnects, cache bounds
// ═══════════════════════════════════════════════════════════════════════════

test('primary vs redirect name: temporary redirect to the primary, same path and query; flips when the primary changes', async () => {
  let t = 1_000_000;
  const w = await world({ now: () => t });
  const r = await w.get(`https://${WWW_DOMAIN}/p/p1?ref=wa`);
  assert.deepEqual([r.status, r.headers.location, r.headers['cache-control']], [307, `https://${DOMAIN}/p/p1?ref=wa`, 'no-store']);
  assert.equal((await w.get(`https://${WWW_DOMAIN}/robots.txt`)).headers.location, `https://${DOMAIN}/robots.txt`);

  await setPrimary(w.db, w.g, WWW_DOMAIN);
  t += RESOLVE_CACHE_MS + 1;                                   // the cache window passes
  const old = await w.get(`https://${DOMAIN}/c/mugs`);
  assert.deepEqual([old.status, old.headers.location], [307, `https://${WWW_DOMAIN}/c/mugs`]);
  const now = await w.get(`https://${WWW_DOMAIN}/`);
  assert.equal(now.status, 200);
  assert.deepEqual(canonicals(now.text), [`https://${WWW_DOMAIN}`]);
  assert.deepEqual(hostMarker(now.text), { slug: 'brandshop', base: `https://${WWW_DOMAIN}` });
});

test('disconnect: the domain stops serving the store once the lookup cache window passes (bounded staleness)', async () => {
  let t = 5_000_000;
  const w = await world({ now: () => t });
  assert.equal((await w.get('/')).status, 200);
  await disconnect(w.db, w.g);
  t += RESOLVE_CACHE_MS + 1;
  for (const path of ['/', '/p/p1', '/robots.txt', '/manage']) {
    const r = await w.get(path);
    assert.equal(r.status, 404, path);
    assert.match(r.text, /not connected/, path);
  }
});

test('the lookup cache holds for at most RESOLVE_CACHE_MS, and never caches a failure', async () => {
  let t = 0;
  const w = await world({ now: () => t });
  await w.get('/');
  const n1 = resolverCalls(w.supabase);
  t += RESOLVE_CACHE_MS - 1;
  await w.get('/p/p1');
  assert.equal(resolverCalls(w.supabase), n1, 'within the window: cached (middleware and function each keep their own)');
  t += 2;
  await w.get('/');
  assert.ok(resolverCalls(w.supabase) > n1, 'after the window: asked again');
  assert.ok(RESOLVE_CACHE_MS <= 30000);

  for (const failure of ['http500', 'malformed', 'down']) {
    const f = await world();
    f.supabase.knobs.resolver = failure;
    assert.equal((await f.get('/')).status, 503, failure);
    f.supabase.knobs.resolver = 'ok';
    assert.equal((await f.get('/')).status, 200, `${failure}: the failure was not cached`);
  }
});

test('render refuses on its own on a CONNECTED domain too: only /, /p/{id}, /c/{id} of that store, whatever reaches it', async () => {
  const w = await world();
  const sb = w.supabase;
  const direct = async (url, host = DOMAIN) => {
    const out = { status: 200, headers: {}, body: '' };
    const res = { setHeader: (k, v) => { out.headers[k.toLowerCase()] = String(v); }, status: (c) => { out.status = c; return res; },
                  send: (b) => { out.body = String(b); return res; } };
    await renderHandler({ headers: { host }, url }, res, { env: ENV_ON, fetchImpl: sb.handle, shell: SHELL,
      resolver: createResolver({ url: SB, anonKey: ANON, fetchImpl: sb.handle }) });
    return out;
  };
  // As if the middleware were bypassed: the renderer's own guard still holds.
  for (const url of ['/api/render?path=/otherstore', '/api/render?path=/otherstore/p/o1', '/api/render?path=/brandshop',
                     '/api/render?path=/start', '/api/render?path=/p/o1/x', '/otherstore', '/api/render?path=//evil.test']) {
    const r = await direct(url);
    assert.equal(r.status, 404, url);
    for (const t of OTHER_STORE_TEXT) assert.equal(r.body.includes(t), false, `${url}: ${t}`);
  }
  const ok = await direct('/api/render?path=/c/lamps');
  assert.equal(ok.status, 200);
  assert.deepEqual(canonicals(ok.body), [`https://${DOMAIN}/c/lamps`]);
  const www = await direct('/api/render?path=/p/p1', WWW_DOMAIN);
  assert.deepEqual([www.status, www.headers.location], [307, `https://${DOMAIN}/p/p1`], 'a redirect name, even directly');
  assert.equal(storeReadsFor(sb, 'otherstore'), 0);
});

// ═══════════════════════════════════════════════════════════════════════════
// Failures: closed -- never a store, never PocketLink's pages
// ═══════════════════════════════════════════════════════════════════════════

test('resolver down, 5xx, malformed or timing out: 503 on every path -- never a store, never the PocketLink app', async () => {
  for (const mode of ['down', 'http500', 'malformed', 'hang']) {
    const w = await world();
    w.supabase.knobs.resolver = mode;
    const paths = mode === 'hang' ? ['/'] : ['/', '/p/p1', '/manage', '/robots.txt', '/sitemap.xml', '/otherstore'];
    for (const path of paths) {
      const t0 = Date.now();
      const r = await w.get(path);
      assert.equal(r.status, 503, `${mode} ${path}`);
      assert.deepEqual([r.headers['cache-control'], r.headers['retry-after']], ['no-store', '5']);
      assert.equal(r.text.includes('Brand Shop'), false);
      assert.equal(r.text.includes('<div id="root">'), false, 'not the SPA shell');
      if (mode === 'hang') assert.ok(Date.now() - t0 < 4000, 'bounded by the lookup timeout');
    }
    assert.equal(storeReadsFor(w.supabase, 'brandshop'), 0, mode);
  }
});

test('the store itself cannot be read (after the lookup succeeded): 503, never an unrendered shell', async () => {
  const w = await world();
  w.supabase.knobs.storesDown = true;
  const r = await w.get('/');
  assert.equal(r.status, 503);
  assert.equal(r.text.includes('<div id="root">'), false);
});

// ═══════════════════════════════════════════════════════════════════════════
// Validation: hosts and resolver answers
// ═══════════════════════════════════════════════════════════════════════════

test('host validation: malformed hosts are "not connected" without any lookup', async () => {
  const w = await world();
  for (const host of ['brand_shop.test', '1.2.3.4', 'localhost', `${'a'.repeat(64)}.test`, '-bad.test', 'bad-.test']) {
    assert.equal(validHostname(host), false, host);
  }
  const r = await get(w.pipeline, 'https://1.2.3.4/');
  assert.equal(r.status, 404);
  assert.equal(resolverCalls(w.supabase), 0, 'nothing invalid is ever sent to the database');
  assert.equal(normalizeHost('BrandShop.TEST.:443'), 'brandshop.test');
});

test('resolver answers are validated: anything but one well-formed row (or none) is an error, never a store', () => {
  const host = DOMAIN;
  assert.deepEqual(interpretResolve([], host), { status: 'none' });
  assert.deepEqual(interpretResolve([{ store_slug: 'brandshop', primary_host: DOMAIN }], host),
    { status: 'connected', slug: 'brandshop', primaryHost: DOMAIN, isPrimary: true });
  assert.equal(interpretResolve([{ store_slug: 'brandshop', primary_host: WWW_DOMAIN }], host).isPrimary, false);
  for (const bad of [
    null, {}, 'brandshop', [{}, {}], [{ store_slug: 'brandshop', primary_host: DOMAIN }, { store_slug: 'x', primary_host: DOMAIN }],
    [{ store_slug: 'Brand Shop', primary_host: DOMAIN }], [{ store_slug: '../x', primary_host: DOMAIN }],
    [{ store_slug: 'brandshop', primary_host: 'BrandShop.test' }], [{ store_slug: 'brandshop', primary_host: 'evil.test/x' }],
    [{ store_slug: 'brandshop', primary_host: 'https://evil.test' }], [{ store_slug: 'brandshop' }], [{ primary_host: DOMAIN }],
  ]) {
    assert.equal(interpretResolve(bad, host).status, 'error', JSON.stringify(bad));
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// PocketLink hosts with routing on
// ═══════════════════════════════════════════════════════════════════════════

test('PocketLink host, routing on: a store with a connected domain is still served there, canonical on its domain', async () => {
  const w = await world();
  const r = await w.get('https://www.pocketlink.store/brandshop');
  assert.equal(r.status, 200, 'served on PocketLink -- no redirect, the fallback always works');
  assert.deepEqual(canonicals(r.text), [`https://${DOMAIN}`]);
  assert.equal(ogUrl(r.text), `https://${DOMAIN}`);
  assert.equal(hostMarker(r.text), null, 'PocketLink mode in the browser');
  const p = await w.get('https://www.pocketlink.store/brandshop/p/p2');
  assert.deepEqual(canonicals(p.text), [`https://${DOMAIN}/p/p2`]);
  const other = await w.get('https://www.pocketlink.store/otherstore');
  assert.deepEqual(canonicals(other.text), [`${PL_ORIGIN}/otherstore`], 'no domain: PocketLink canonical');

  const off = await world({ env: ENV_OFF });
  const o = await off.get('https://www.pocketlink.store/brandshop');
  assert.deepEqual(canonicals(o.text), [`${PL_ORIGIN}/brandshop`], 'routing off: PocketLink canonical, as today');
  assert.equal(off.supabase.log.filter((e) => e.path.includes('store_primary_host')).length, 0);
});

test('PocketLink and deployment hosts are never looked up as merchant domains, and keep every PocketLink route', async () => {
  const env = { ...ENV_ON, VERCEL_BRANCH_URL: 'store-git-x-seniqifys-projects.vercel.app', VERCEL_PROJECT_PRODUCTION_URL: 'www.seniqify.store' };
  const w = await world({ env });
  assert.equal(classifyHost('www.seniqify.store', env), 'deployment', 'Seniqify host: unchanged (cleanup deferred)');
  for (const h of ['www.pocketlink.store', 'pocketlink.store', 'store-git-x-seniqifys-projects.vercel.app', 'www.seniqify.store']) {
    const store = await w.get(`https://${h}/otherstore`);
    assert.equal(store.status, 200, h);
    assert.match(store.text, /Other Store/, h);
    assert.equal((await w.get(`https://${h}/start`)).via, 'rewrite', h);
  }
  assert.equal(resolverCalls(w.supabase), 0);
  const market = await w.get('https://market.pocketlink.store/');
  assert.deepEqual([market.status, market.headers.location], [308, 'https://www.pocketlink.store/']);
  const sell = await w.get('https://www.pocketlink.store/sell');
  assert.equal(sell.status, 308);
});

// ═══════════════════════════════════════════════════════════════════════════
// The shell comes from the matching build
// ═══════════════════════════════════════════════════════════════════════════

test('on Vercel, render uses its OWN build\'s index.html (bundled) -- no network fetch of a shell, on any host', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pl-shell-'));
  mkdirSync(join(dir, 'dist'));
  const own = SHELL.replace('</head>', '<meta name="build" content="THIS-BUILD"/></head>');
  writeFileSync(join(dir, 'dist', 'index.html'), own);
  const cwd = process.cwd();
  process.chdir(dir);
  try {
    const db = await createDb();
    await domainIn(db, BRAND.slug, DOMAIN, 'connected');
    const sb = createSupabase(db);
    const seen = [];
    const fetchImpl = (u, init) => { seen.push(String(u)); return sb.handle(u, init); };
    const env = { ...ENV_ON, VERCEL: '1', VERCEL_BRANCH_URL: 'store-git-y-seniqifys-projects.vercel.app' };
    for (const host of [DOMAIN, 'www.pocketlink.store', 'store-git-y-seniqifys-projects.vercel.app']) {
      const out = { status: 200, headers: {}, body: '' };
      const res = { setHeader: (k, v) => { out.headers[k] = v; }, status: (c) => { out.status = c; return res; }, send: (b) => { out.body = String(b); return res; } };
      await renderHandler({ headers: { host }, url: host === DOMAIN ? '/api/render?path=/' : '/api/render?path=/brandshop' }, res,
        { env, fetchImpl, resolver: createResolver({ url: SB, anonKey: ANON, fetchImpl }) });
      assert.equal(out.status, 200, host);
      assert.match(out.body, /content="THIS-BUILD"/, `${host}: this build's shell`);
      assert.equal(out.headers['X-PL-Shell'], 'own', `${host}: reported`);
    }
    assert.equal(seen.filter((u) => u.endsWith('/index.html')).length, 0, 'no shell fetched over the network');
  } finally {
    process.chdir(cwd);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('vercel.json bundles the build\'s index.html into the render function; middleware matcher covers the protected endpoints', async () => {
  const vj = JSON.parse(read('vercel.json'));
  assert.equal(vj.functions['api/render.js'].includeFiles, 'dist/index.html');
  const { config } = await import('../middleware.js');
  assert.deepEqual(config.matcher, ['/((?!assets/|_vercel/|api/).*)', '/api/(render|sitemap|og|qr)(.*)']);
  assert.equal(vj.crons, undefined);
});

// ═══════════════════════════════════════════════════════════════════════════
// Nothing on a merchant domain falls back to the unrestricted SPA shell
// (review of 5863649: /assets/missing.js, /_vercel/missing and /api/missing
// reached PocketLink's SPA without the merchant marker)
// ═══════════════════════════════════════════════════════════════════════════

const SHELL_BYTES = Buffer.from(SHELL);
/** The static index.html: the SPA in PocketLink mode, with no merchant marker. */
const isPlainShell = (r) => r.body.equals(SHELL_BYTES);

test('the route table under test is Vercel\'s own, compiled from THIS vercel.json and middleware matcher', async () => {
  const vj = JSON.parse(read('vercel.json'));
  const { config } = await import('../middleware.js');
  assert.deepEqual(VERCEL_ROUTES.from, { redirects: vj.redirects, rewrites: vj.rewrites, headers: vj.headers, matcher: config.matcher },
    'stale: run node scripts/vercel-routes-fixture.mjs');
  const kind = (r) => (r.handle ? r.handle : r.middlewarePath ? 'middleware'
    : r.status >= 300 && r.status < 400 ? 'redirect' : r.dest ? 'rewrite' : r.status ? 'status' : 'headers');
  const kinds = VERCEL_ROUTES.routes.map(kind);
  assert.ok(kinds.lastIndexOf('redirect') < kinds.indexOf('middleware') && kinds.indexOf('middleware') < kinds.indexOf('filesystem'),
    'Vercel runs vercel.json\'s redirects, then the middleware, then the filesystem');
  // Every rewrite to the SPA shell stays clear of the three prefixes the middleware never sees, in any case.
  const toShell = VERCEL_ROUTES.routes.filter((r) => r.dest?.startsWith('/index.html'));
  assert.ok(toShell.length >= 8);
  for (const r of toShell) {
    for (const p of ['/api/x', '/api/manage', '/api/x/manage', '/assets/x.js', '/assets/manage', '/assets/a/b/c',
                     '/_vercel/x', '/_vercel/manage', '/API/x', '/Assets/x/y', '/_VERCEL/x', '/aPi/manage']) {
      assert.equal(new RegExp(r.src).test(p), false, `${r.src} must not match ${p}`);
    }
  }
});

test('missing assets, unknown API paths and unknown /_vercel paths: a real 404, never the SPA -- connected, unconnected and PocketLink hosts', async () => {
  const paths = ['/assets/missing.js', '/assets/missing.css', '/assets/x/y/z.js', '/assets/manage', '/assets/', '/Assets/missing.js',
                 '/_vercel/missing', '/_vercel/x/y', '/_vercel/manage', '/api/missing', '/api/missing/deeper', '/api/x/manage',
                 '/api/manage', '/api/_hosts', '/api/_resolve', '/api/domains/missing', '/api/og.js/', '/api/og/x', '/api/ogx', '/API/og'];
  for (const status of ['connected', 'ready', 'disconnected', null]) {
    const w = await world({ status });
    for (const host of [DOMAIN, 'never-claimed.test', 'www.pocketlink.store']) {
      for (const path of paths) {
        const r = await w.get(`https://${host}${path}`);
        const what = `${status} ${host}${path}`;
        assert.equal(r.status, 404, what);
        assert.equal(isPlainShell(r), false, `${what}: not the SPA`);
        assert.equal(r.text.includes('<div id="root">'), false, what);
        assert.equal(hostMarker(r.text), null, what);
        // Under the three prefixes the middleware never sees, it is Vercel's own 404.
        if (/^\/(assets|_vercel|api)\//.test(path) && !/^\/api\/(og|qr|render|sitemap)/.test(path)) {
          assert.deepEqual([r.via, r.text], ['vercel', VERCEL_NOT_FOUND], what);
        }
      }
    }
  }
});

test('real assets, the analytics script and working APIs still answer on a merchant domain', async () => {
  const w = await world();
  for (const [path, via] of [['/assets/app.js', 'static'], ['/favicon.svg', 'static'], ['/version.json', 'static'],
                             ['/_vercel/insights/script.js', 'platform'], ['/api/pincode?pin=411001', 'function'],
                             ['/api/pincode/', 'function'], ['/api/pincode.js', 'function']]) {
    const r = await w.get(path);
    assert.deepEqual([r.status, r.via], [200, via], path);
  }
  assert.equal((await w.get('/version.json')).headers['cache-control'], 'no-store, max-age=0, must-revalidate', 'vercel.json header kept');
});

test('a generic file missing from a build is a 404 on a merchant domain, never the SPA fallback', async () => {
  // Each pass-through file is one path segment, so if it is missing vercel.json's
  // /:slug rewrite -- the renderer, which refuses -- answers, not the SPA fallback.
  for (const f of PASS_THROUGH_FILES) assert.match(f, /^\/[^/]+$/, f);
  const w = await world({ files: { '/version.json': null, '/favicon.svg': null } });
  for (const path of [...PASS_THROUGH_FILES].filter((f) => !['/version.json', '/favicon.svg'].includes(f)).concat(['/version.json', '/favicon.svg'])) {
    const r = await w.get(path);
    assert.equal(r.status, 404, path);
    assert.equal(isPlainShell(r), false, path);
  }
});

test('dot segments: the middleware sees a normalised URL but Vercel routes the raw path -- what it lets through is exactly what it checked', async () => {
  for (const status of ['connected', null]) {
    const w = await world({ status });
    const files = [['/x/../favicon.svg', '<svg/>'], ['/x/%2e%2e/favicon.svg', '<svg/>'], ['/x/%2E%2E/version.json', '{"v":"test"}'],
                   ['/p/../version.json', '{"v":"test"}'], ['/x/../assets/app.js', 'console.log(1)'], ['/./favicon.svg', '<svg/>']];
    for (const [path, body] of files) {
      const r = await w.get(`https://${DOMAIN}${path}`);
      assert.deepEqual([r.status, r.text], [200, body], `${status} ${path}: the file itself`);
    }
    for (const path of ['/x/./favicon.svg', '/x/../index.html', '/x/%2e%2e/index.html', '/p/p1/../../otherstore', '/x/../api/og?slug=otherstore',
                        '/x/../api/render?path=/otherstore', '/x/../assets/missing.js', '/a/b/../../_vercel/missing']) {
      const r = await w.get(`https://${DOMAIN}${path}`);
      assert.equal(r.status, 404, `${status} ${path}`);
      assert.equal(isPlainShell(r), false, `${status} ${path}`);
      assertNoOtherStore(r, path);
    }
    // This store's own image, by a dot-segment path: the image -- what the middleware checked -- not the shell.
    const img = await w.get(`https://${DOMAIN}/x/../api/og?slug=brandshop`);
    assert.equal(img.status, status ? 200 : 404, `${status}: own image`);
    if (status) assert.equal(img.text, 'image-stub:/api/og:brandshop');
    assert.equal(isPlainShell(img), false);
  }
});

test('the four functions, reached by paths the middleware matcher never sees (decoded names, %2F), refuse on their own', async () => {
  const w = await world();
  for (const [path, status] of [
    ['/api/%6fg?slug=otherstore', 404], ['/api/%71r?slug=otherstore', 404], ['/api/og%2F?slug=otherstore', 404],
    ['/api/og/?slug=otherstore', 404], ['/api/og.js?slug=otherstore', 404], ['/api/qr.js?slug=otherstore', 404],
    ['/api/%6fg?slug=brandshop', 200], ['/api/og.js?slug=brandshop', 404],
    ['/api/render/?path=/', 404], ['/api/render.js?path=/', 404], ['/api/sitemap/', 404], ['/api/sitemap.js', 404],
    ['/api/%72ender?path=/otherstore', 404], ['/api/%72ender?path=/otherstore/p/o1', 404], ['/api/%72ender?path=/brandshop', 404],
  ]) {
    const r = await w.get(path);
    assert.equal(r.status, status, path);
    assertNoOtherStore(r, path);
  }
  // Even a decoded renderer path shows only THIS store (the renderer re-resolves the host).
  const own = await w.get('/api/%72ender?path=/');
  assert.equal(own.status, 200);
  assert.deepEqual(hostMarker(own.text), { slug: 'brandshop', base: `https://${DOMAIN}` });
  const sm = await w.get('/api/%73itemap');
  assert.equal(sm.status, 200);
  assertNoOtherStore(sm, 'decoded sitemap');
  assert.equal(storeReadsFor(w.supabase, 'otherstore'), 0);

  const ready = await world({ status: 'ready' });
  for (const path of ['/api/%6fg?slug=brandshop', '/api/%71r?slug=brandshop', '/api/%72ender?path=/', '/api/%73itemap']) {
    const r = await ready.get(path);
    assert.equal(r.status, 404, `ready ${path}`);
    assert.match(r.text, /not connected/, path);
  }
});

test('api/og.js and api/qr.js check a merchant domain themselves -- the real modules, before any store read', async () => {
  const db = await createDb();
  await domainIn(db, BRAND.slug, DOMAIN, 'connected');
  await domainIn(db, 'otherstore', 'ready.test', 'ready');
  const sb = createSupabase(db);
  const saved = { ...process.env };
  const realFetch = globalThis.fetch;
  const outside = [];
  Object.assign(process.env, { CUSTOM_DOMAINS_ROUTING_ENABLED: 'true', VITE_SUPABASE_URL: SB, VITE_SUPABASE_ANON_KEY: ANON });
  globalThis.fetch = (u, init) => {
    const s = String(u);
    if (s.startsWith(SB)) return sb.handle(u, init);
    if (s.startsWith('data:')) return realFetch(u, init);          // @vercel/og's own wasm
    outside.push(s);
    return Promise.reject(new TypeError('blocked'));
  };
  try {
    const { default: og } = await import('../api/og.js');
    const { default: qr } = await import('../api/qr.js');
    for (const [name, handler] of [['og', og], ['qr', qr]]) {
      for (const [url, status] of [
        [`https://${DOMAIN}/api/${name}?slug=otherstore`, 404], [`https://${DOMAIN}/api/${name}?slug=OtherStore!`, 404],
        [`https://${DOMAIN}/api/${name}`, 404], [`https://${WWW_DOMAIN}/api/${name}?slug=brandshop`, 404],
        ['https://ready.test/api/' + name + '?slug=otherstore', 404], ['https://never-claimed.test/api/' + name + '?slug=otherstore', 404],
      ]) {
        const r = await handler(new Request(url));
        assert.equal(r.status, status, url);
        assert.equal(r.headers.get('cache-control'), 'no-store', url);
      }
    }
    sb.knobs.resolver = 'down';
    assert.equal((await og(new Request('https://fresh.test/api/og?slug=otherstore'))).status, 503, 'lookup failed: 503');
    assert.deepEqual(outside, [], 'no request left for the real store database or anywhere else');
    assert.equal(storeReadsFor(sb, 'otherstore'), 0);
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
    globalThis.fetch = realFetch;
  }
});

test('sweep: thousands of raw paths -- any case, percent-encoded, dot segments -- never serve a merchant domain the plain SPA', async () => {
  const SEG = ['', 'api', 'assets', '_vercel', 'API', 'Assets', 'x', 'manage', 'p', 'c', 'og', 'render', '%61ssets', '..', '%2e%2e', 'index.html'];
  const paths = new Set();
  const walk = (prefix, depth) => {
    if (!depth) return;
    for (const s of SEG) { const p = `${prefix}/${s}`; paths.add(p); paths.add(`${p}/`); walk(p, depth - 1); }
  };
  walk('', 3);
  for (const middlewareCaseInsensitive of [false, true]) {
    for (const status of ['connected', null]) {
      const w = await world({ status, middlewareCaseInsensitive });
      const bad = [];
      for (const path of paths) {
        const r = await w.get(`https://${DOMAIN}${path}`);
        if (r.status >= 300 && r.status < 400) continue;
        if (isPlainShell(r) || r.text.includes('Other Store')) bad.push(`${r.status} ${path}`);
        else if (/text\/html/.test(r.headers['content-type'] || '') && r.status === 200
                 && JSON.stringify(hostMarker(r.text)) !== JSON.stringify({ slug: 'brandshop', base: `https://${DOMAIN}` })) bad.push(`marker ${path}`);
      }
      assert.deepEqual(bad, [], `status ${status}, case-insensitive middleware ${middlewareCaseInsensitive}: ${paths.size} paths`);
    }
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// PocketLink's own sitemap: stores whose canonical is on their domain are left out
// ═══════════════════════════════════════════════════════════════════════════

const MAIN_SITEMAP = JSON.parse(read('tests/fixtures/sitemap-main.json'));
const withoutStore = (xml, slug) => xml.split('\n').filter((l) => !l.includes(`<loc>${PL_ORIGIN}/${slug}</loc>`)).join('\n');
const primaryCalls = (sb) => sb.log.filter((e) => e.path.endsWith('/store_primary_host')).length;

test('PocketLink sitemap, routing off: byte for byte what main served, and no domain lookup at all', async () => {
  const w = await world({ env: ENV_OFF });
  for (const host of ['www.pocketlink.store', 'pocketlink.store']) {
    const r = await w.get(`https://${host}/sitemap.xml`);
    assert.deepEqual([r.status, r.headers['cache-control'], r.headers['content-type']],
      [MAIN_SITEMAP.status, MAIN_SITEMAP.cacheControl, MAIN_SITEMAP.contentType], host);
    assert.equal(r.text, MAIN_SITEMAP.xml, host);
  }
  assert.equal(primaryCalls(w.supabase), 0);
});

test('PocketLink sitemap, routing on: a store is listed exactly when its canonical is on PocketLink', async () => {
  const on = await world();
  const r = await on.get('https://www.pocketlink.store/sitemap.xml');
  assert.equal(r.status, 200);
  assert.equal(r.text, withoutStore(MAIN_SITEMAP.xml, 'brandshop'), 'brandshop (connected) left out; everything else as on main');
  assert.equal(r.headers['cache-control'], 's-maxage=600', 'membership can change: ten minutes, no stale-while-revalidate');
  assert.ok(r.text.includes(`<loc>${PL_ORIGIN}/otherstore</loc>`));

  // Every other status, and after a disconnect: listed -- and in each case in step with the page's own canonical.
  for (const status of ['pending', 'verified', 'ready', 'misconfigured', 'disconnecting', 'disconnected', 'expired']) {
    const w = await world({ status });
    const listed = (await w.get('https://www.pocketlink.store/sitemap.xml')).text.includes(`<loc>${PL_ORIGIN}/brandshop</loc>`);
    const canonical = canonicals((await w.get('https://www.pocketlink.store/brandshop')).text)[0];
    assert.equal(listed, canonical === `${PL_ORIGIN}/brandshop`, `${status}: listed iff PocketLink is the canonical (${canonical})`);
    if (listed) assert.equal((await w.get('https://www.pocketlink.store/sitemap.xml')).text, MAIN_SITEMAP.xml, status);
  }
  await disconnect(on.db, on.g);
  assert.equal((await on.get('https://www.pocketlink.store/sitemap.xml')).text, MAIN_SITEMAP.xml, 'disconnected: listed again at once');

  // A deployment host (preview) with routing on filters the same way.
  const env = { ...ENV_ON, VERCEL_BRANCH_URL: 'store-git-x-seniqifys-projects.vercel.app' };
  const dep = await world({ env });
  assert.equal((await dep.get('https://store-git-x-seniqifys-projects.vercel.app/sitemap.xml')).text, withoutStore(MAIN_SITEMAP.xml, 'brandshop'));
});

test('PocketLink sitemap, routing on: any failed lookup is a 503, never cached, never a guess -- and not remembered', async () => {
  for (const mode of ['down', 'http500', 'malformed', 'badhost', 'hang']) {
    const w = await world();
    w.supabase.knobs.resolver = mode;
    const t0 = Date.now();
    const r = await w.get('https://www.pocketlink.store/sitemap.xml');
    assert.equal(r.status, 503, mode);
    assert.deepEqual([r.headers['cache-control'], r.headers['retry-after']], ['no-store', '5'], mode);
    assert.equal(r.text.includes('<urlset'), false, mode);
    assert.ok(Date.now() - t0 < 4000, `${mode}: bounded by the lookup timeout`);
    w.supabase.knobs.resolver = 'ok';
    assert.equal((await w.get('https://www.pocketlink.store/sitemap.xml')).text, withoutStore(MAIN_SITEMAP.xml, 'brandshop'), `${mode}: recovered`);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// A merchant domain's HTML only ever comes from this build's own shell
// ═══════════════════════════════════════════════════════════════════════════

test('merchant domain without its bundled shell: 503, never another deployment\'s HTML; PocketLink hosts fetch as before', async () => {
  const db = await createDb();
  await domainIn(db, BRAND.slug, DOMAIN, 'connected');
  const sb = createSupabase(db);
  const seen = [];
  const fetchImpl = (u, init) => {
    seen.push(String(u));
    if (String(u) === `${PL_ORIGIN}/index.html`) return Promise.resolve(new Response(SHELL, { status: 200 }));
    return sb.handle(u, init);
  };
  const direct = async (host, url, env) => {
    const out = { status: 200, headers: {}, body: '' };
    const res = { setHeader: (k, v) => { out.headers[k.toLowerCase()] = String(v); }, status: (c) => { out.status = c; return res; },
                  send: (b) => { out.body = String(b); return res; } };
    await renderHandler({ headers: { host }, url }, res, { env, fetchImpl, resolver: createResolver({ url: SB, anonKey: ANON, fetchImpl }) });
    return out;
  };
  // No shell of its own (off Vercel: nothing bundled): the merchant page is 503.
  const m = await direct(DOMAIN, '/api/render?path=/p/p1', ENV_ON);
  assert.deepEqual([m.status, m.headers['cache-control'], m.headers['retry-after']], [503, 'no-store', '5']);
  assert.equal(m.headers['x-pl-shell'], undefined);
  assert.equal(seen.filter((u) => u.endsWith('/index.html')).length, 0, 'no shell fetched from anywhere');
  assert.equal(storeReadsFor(sb, 'brandshop'), 0, 'nothing read for a page it will not serve');
  // PocketLink hosts: exactly as before -- the main site's shell is fetched.
  for (const env of [ENV_ON, ENV_OFF]) {
    const pl = await direct('www.pocketlink.store', '/api/render?path=/brandshop', env);
    assert.equal(pl.status, 200);
    assert.ok(seen.includes(`${PL_ORIGIN}/index.html`));
  }
  // Routing off, merchant host: "not connected", as before.
  assert.equal((await direct(DOMAIN, '/api/render?path=/', ENV_OFF)).status, 404);

  // On Vercel, with dist/index.html missing from the function: 503 too (a fresh process, so no cached shell).
  const dir = mkdtempSync(join(tmpdir(), 'pl-noshell-'));
  try {
    const script = `
      const { default: render } = await import(${JSON.stringify(pathToFileURL(fileURLToPath(new URL('../api/render.js', import.meta.url))).href)});
      const fetched = [];
      const out = { status: 0, headers: {} };
      const res = { setHeader: (k, v) => { out.headers[k.toLowerCase()] = v; }, status: (c) => { out.status = c; return res; }, send: () => res };
      await render({ headers: { host: 'brandshop.test' }, url: '/api/render?path=/' }, res, {
        env: { VERCEL: '1', CUSTOM_DOMAINS_ROUTING_ENABLED: 'true', VITE_SUPABASE_URL: 'https://sb.test', VITE_SUPABASE_ANON_KEY: 'k' },
        fetchImpl: async (u) => { fetched.push(String(u)); throw new Error('no network'); },
        resolver: { resolveHost: async () => ({ status: 'connected', slug: 'brandshop', primaryHost: 'brandshop.test', isPrimary: true }) },
      });
      const first = { status: out.status, shell: out.headers['x-pl-shell'] ?? null };
      // The file turns up (a failed read is not remembered): the next render uses it.
      const { mkdirSync, writeFileSync } = await import('node:fs');
      mkdirSync('dist');
      writeFileSync('dist/index.html', '<!doctype html><html><head><title>t</title></head><body><div id="root"></div></body></html>');
      out.headers = {};
      await render({ headers: { host: 'brandshop.test' }, url: '/api/render?path=/' }, res, {
        env: { VERCEL: '1', CUSTOM_DOMAINS_ROUTING_ENABLED: 'true', VITE_SUPABASE_URL: 'https://sb.test', VITE_SUPABASE_ANON_KEY: 'k' },
        fetchImpl: async (u) => { fetched.push(String(u)); return new Response('[]', { status: 200 }); },
        resolver: { resolveHost: async () => ({ status: 'connected', slug: 'brandshop', primaryHost: 'brandshop.test', isPrimary: true }) },
      });
      console.log(JSON.stringify({ first, second: out.headers['x-pl-shell'] ?? null, shells: fetched.filter((u) => u.endsWith('/index.html')) }));`;
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], { cwd: dir, encoding: 'utf8' });
    assert.equal(child.status, 0, child.stderr);
    assert.deepEqual(JSON.parse(child.stdout.trim().split('\n').at(-1)),
      { first: { status: 503, shell: null }, second: 'own', shells: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Re-review of 7f60d6c: a failed canonical-domain lookup is never read as
// "no domain"; images on a merchant domain are never cached
// ═══════════════════════════════════════════════════════════════════════════

test('PocketLink store page, routing on: a failed canonical-domain lookup is a 503 (no-store) -- never a PocketLink canonical -- and the next good request recovers', async () => {
  for (const mode of ['hang', 'http500', 'malformed', 'badhost', 'down']) {
    const w = await world();                                   // brandshop is connected to brandshop.test
    w.supabase.knobs.resolver = mode;
    const paths = mode === 'hang' ? ['/brandshop'] : ['/brandshop', '/brandshop/p/p1', '/brandshop/c/mugs', '/otherstore', '/otherstore/p/o1'];
    for (const path of paths) {
      const t0 = Date.now();
      const r = await w.get(`https://www.pocketlink.store${path}`);
      const what = `${mode} ${path}`;
      assert.equal(r.status, 503, what);
      assert.deepEqual([r.headers['cache-control'], r.headers['retry-after']], ['no-store', '5'], `${what}: never cached`);
      assert.deepEqual(canonicals(r.text), [], `${what}: no canonical at all`);
      assert.equal(ogUrl(r.text), undefined, what);
      assert.equal(r.text.includes(`${PL_ORIGIN}${path}`), false, `${what}: no PocketLink URL for the store`);
      assert.equal(r.text.includes('__PL_CONFIG__'), false, what);
      if (mode === 'hang') assert.ok(Date.now() - t0 < 4000, `${what}: bounded by the lookup timeout`);
    }
    w.supabase.knobs.resolver = 'ok';
    const a = await w.get('https://www.pocketlink.store/brandshop');
    assert.deepEqual([a.status, canonicals(a.text)], [200, [`https://${DOMAIN}`]], `${mode}: recovered, canonical on the domain`);
    const b = await w.get('https://www.pocketlink.store/otherstore/p/o1');
    assert.deepEqual([b.status, canonicals(b.text)], [200, [`${PL_ORIGIN}/otherstore/p/o1`]], `${mode}: recovered, no domain`);
  }
  // A deployment (preview) host is the same.
  const env = { ...ENV_ON, VERCEL_BRANCH_URL: 'store-git-x-seniqifys-projects.vercel.app' };
  const dep = await world({ env });
  dep.supabase.knobs.resolver = 'http500';
  const d = await dep.get('https://store-git-x-seniqifys-projects.vercel.app/brandshop');
  assert.deepEqual([d.status, d.headers['cache-control'], canonicals(d.text)], [503, 'no-store', []]);
  // Pages that name no store's canonical do not depend on the lookup.
  const mp = await dep.get('https://store-git-x-seniqifys-projects.vercel.app/marketplace');
  assert.equal(mp.status, 200);
  // Routing off: no lookup at all, so its failure changes nothing.
  const off = await world({ env: ENV_OFF });
  off.supabase.knobs.resolver = 'down';
  const o = await off.get('https://www.pocketlink.store/brandshop');
  assert.deepEqual([o.status, canonicals(o.text)], [200, [`${PL_ORIGIN}/brandshop`]]);
  assert.equal(primaryCalls(off.supabase), 0);
});

const IMG_NAMES = [['og', '%6fg'], ['qr', '%71r']];   // each endpoint, and its name percent-encoded (the matcher cannot see it)

test('transfer through the full routing: A\'s images stop and B\'s start when the domain changes hands; every image on it is no-store', async () => {
  let t = 1e9;
  const w = await world({ now: () => t });                   // A = brandshop owns brandshop.test
  const img = (host, name, slug) => w.get(`https://${host}/api/${name}?slug=${slug}`);
  const noStoreEverywhere = (r, what) => assert.equal(r.headers['cache-control'], 'no-store', `${what}: no-store`);
  for (const [name, encoded] of IMG_NAMES) {
    const a = await img(DOMAIN, name, 'brandshop');
    assert.deepEqual([a.status, a.text], [200, `image-stub:/api/${name}:brandshop`], `A owns it: ${name}`);
    noStoreEverywhere(a, `A ${name}`);
    noStoreEverywhere(await img(DOMAIN, name, 'otherstore'), `${name} for another store`);
    // The non-primary name: the middleware sends it to the primary; past the matcher, the function refuses.
    const www = await img(WWW_DOMAIN, name, 'brandshop');
    assert.deepEqual([www.status, www.headers.location], [307, `https://${DOMAIN}/api/${name}?slug=brandshop`]);
    noStoreEverywhere(www, `www ${name}`);
    const wwwFn = await img(WWW_DOMAIN, encoded, 'brandshop');
    assert.equal(wwwFn.status, 404, `www ${encoded}`);
    noStoreEverywhere(wwwFn, `www ${encoded}`);
    // PocketLink's own host keeps its caching.
    const pl = await img('www.pocketlink.store', name, 'brandshop');
    assert.deepEqual([pl.status, pl.headers['cache-control']], [200, POCKETLINK_IMAGE_CACHE], `PocketLink ${name}`);
  }

  // A disconnects; B = otherstore claims and connects the same domain.
  await disconnect(w.db, w.g);
  await domainIn(w.db, 'otherstore', DOMAIN, 'connected');
  t += RESOLVE_CACHE_MS + 1;
  for (const [name, encoded] of IMG_NAMES) {
    for (const path of [name, encoded]) {
      const a = await img(DOMAIN, path, 'brandshop');
      assert.equal(a.status, 404, `after transfer, A's ${path}`);
      assert.equal(a.text.includes('image-stub'), false);
      noStoreEverywhere(a, `A ${path}`);
      const b = await img(DOMAIN, path, 'otherstore');
      assert.deepEqual([b.status, b.text], [200, `image-stub:/api/${name}:otherstore`], `after transfer, B's ${path}`);
      noStoreEverywhere(b, `B ${path}`);
    }
    noStoreEverywhere(await img(WWW_DOMAIN, name, 'otherstore'), `www after transfer ${name}`);
  }

  // Routing off: a merchant's host still never caches an image (a copy would outlive turning routing on).
  const off = await world({ env: ENV_OFF });
  const o = await off.get(`https://${DOMAIN}/api/og?slug=brandshop`);
  assert.deepEqual([o.status, o.headers['cache-control']], [200, 'no-store']);
  assert.equal((await off.get('https://www.pocketlink.store/api/og?slug=brandshop')).headers['cache-control'], POCKETLINK_IMAGE_CACHE);
  assert.equal(resolverCalls(off.supabase), 0, 'routing off: still no lookup');
});

test('transfer, the REAL api/og.js and api/qr.js: images rendered on a merchant domain are no-store; A\'s stop and B\'s start when it changes hands', async () => {
  const HOST = 'transfer.test';
  const db = await createDb();
  const a = await domainIn(db, BRAND.slug, HOST, 'connected');
  const sb = createSupabase(db);
  const saved = { ...process.env };
  const realFetch = globalThis.fetch;
  const realNow = Date.now;
  let offset = 0;
  const FONT = readFileSync(fileURLToPath(new URL('../node_modules/@vercel/og/dist/Geist-Regular.ttf', import.meta.url)));
  const WORDMARK = readFileSync(fileURLToPath(new URL('../public/pocketlink-wordmark.png', import.meta.url)));
  const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
  const PROD_DB = 'https://uoyqbexemoheipwrtkcz.supabase.co';
  const answeredHere = [];
  Object.assign(process.env, { CUSTOM_DOMAINS_ROUTING_ENABLED: 'true', VITE_SUPABASE_URL: SB, VITE_SUPABASE_ANON_KEY: ANON });
  // Every request either module makes is answered here; nothing reaches the network.
  globalThis.fetch = async (u, init) => {
    const s = String(u);
    if (s.startsWith('data:')) return realFetch(u, init);                  // @vercel/og's own wasm
    if (s.startsWith(SB)) return sb.handle(u, init);
    answeredHere.push(s);
    if (s.startsWith(PROD_DB)) return sb.handle(SB + s.slice(PROD_DB.length), init);   // the store read, from the test database
    if (s.startsWith('https://api.qrserver.com/')) return new Response(PNG_1X1, { headers: { 'Content-Type': 'image/png' } });
    if (s.endsWith('/pocketlink-wordmark.png')) return new Response(WORDMARK, { headers: { 'Content-Type': 'image/png' } });
    if (/\.(woff2?|ttf)$/.test(s)) return new Response(FONT);
    return new Response('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36"/>', { headers: { 'Content-Type': 'image/svg+xml' } });
  };
  Date.now = () => realNow() + offset;
  const call = async (handler, url) => {
    const r = await handler(new Request(url));
    const out = { status: r.status, cache: r.headers.get('cache-control'), type: r.headers.get('content-type') };
    try { await r.body?.cancel(); } catch { /* fine */ }
    return out;
  };
  try {
    const { default: og } = await import('../api/og.js');
    const { default: qr } = await import('../api/qr.js');
    const image = (r, what) => {
      assert.equal(r.status, 200, what);
      assert.match(r.type, /^image\/png/, what);
    };
    for (const [name, handler] of [['og', og], ['qr', qr]]) {
      // PocketLink's own host: the rendered image, cached as before (the card, not the plain-QR fallback).
      const pl = await call(handler, `https://www.pocketlink.store/api/${name}?slug=brandshop`);
      image(pl, `PocketLink ${name}`);
      assert.match(pl.cache, /public/, `PocketLink ${name}: caching unchanged`);
      // A owns the domain: the same rendered image, no-store.
      const own = await call(handler, `https://${HOST}/api/${name}?slug=brandshop`);
      image(own, `A ${name}`);
      assert.equal(own.cache, 'no-store', `A ${name} on its domain: no-store, nothing else`);
      for (const url of [`https://${HOST}/api/${name}?slug=otherstore`, `https://www.${HOST}/api/${name}?slug=brandshop`]) {
        const r = await call(handler, url);
        assert.deepEqual([r.status, r.cache], [404, 'no-store'], url);
      }
    }
    // The domain changes hands: A disconnects, B claims and connects it.
    await disconnect(db, a);
    await domainIn(db, 'otherstore', HOST, 'connected');
    offset += RESOLVE_CACHE_MS + 1;
    for (const [name, handler] of [['og', og], ['qr', qr]]) {
      const old = await call(handler, `https://${HOST}/api/${name}?slug=brandshop`);
      assert.deepEqual([old.status, old.cache], [404, 'no-store'], `after transfer: A's ${name}`);
      const now = await call(handler, `https://${HOST}/api/${name}?slug=otherstore`);
      image(now, `after transfer: B's ${name}`);
      assert.equal(now.cache, 'no-store', `after transfer: B's ${name}`);
      const www = await call(handler, `https://www.${HOST}/api/${name}?slug=otherstore`);
      assert.deepEqual([www.status, www.cache], [404, 'no-store'], `non-primary name: ${name}`);
    }
    assert.ok(answeredHere.some((u) => u.startsWith(PROD_DB)), 'the modules read the store -- from the test database');
  } finally {
    Date.now = realNow;
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
    globalThis.fetch = realFetch;
  }
});

test('the resolver remembers "not connected" for RESOLVE_MISS_CACHE_MS only, and a connected answer for RESOLVE_CACHE_MS', async () => {
  assert.ok(RESOLVE_MISS_CACHE_MS <= 10000 && RESOLVE_MISS_CACHE_MS < RESOLVE_CACHE_MS);
  let t = 1e9;
  const t0 = t;
  const w = await world({ now: () => t });
  assert.equal((await w.get('/')).status, 200, 'brandshop.test: connected, remembered from t0');
  const NEW = 'newbrand.test';
  assert.equal((await w.get(`https://${NEW}/`)).status, 404, 'not connected yet');
  await domainIn(w.db, 'otherstore', NEW, 'connected');
  t += RESOLVE_MISS_CACHE_MS - 1;
  assert.equal((await w.get(`https://${NEW}/`)).status, 404, 'within the miss window: the cached "none"');
  t += 2;
  const r = await w.get(`https://${NEW}/`);
  assert.equal(r.status, 200, 'after the miss window: connected');
  assert.deepEqual(hostMarker(r.text), { slug: 'otherstore', base: `https://${NEW}` });
  // ... while a connected answer is kept for the full window (bounded staleness after a disconnect).
  await disconnect(w.db, w.g);
  assert.ok(t - t0 > RESOLVE_MISS_CACHE_MS && t - t0 < RESOLVE_CACHE_MS);
  assert.equal((await w.get('/')).status, 200, 'brandshop.test: the connected answer still held');
  t = t0 + RESOLVE_CACHE_MS + 1;
  assert.equal((await w.get('/')).status, 404, 'brandshop.test: after the window, not connected');
});
