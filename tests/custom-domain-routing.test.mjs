// PR-D: custom-domain routing and storefront rendering.
//
// Every request goes through the real middleware.js, then vercel.json's
// redirects / filesystem / rewrites, then the real api/render.js and
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
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SB, ANON, BRAND, createDb, domainIn, setPrimary, disconnect, createSupabase, createPipeline, get,
} from './helpers/routingWorld.mjs';
import { makeFetch, runHandler, POCKETLINK_CASES } from './helpers/renderHarness.mjs';
import renderHandler from '../api/render.js';
import { interpretResolve, createResolver, RESOLVE_CACHE_MS } from '../api/_resolve.js';
import { classifyHost, routingEnabled, validHostname, normalizeHost } from '../api/_hosts.js';
import { PL_ORIGIN } from '../src/utils/customDomainRoutes.js';

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

async function world({ env = ENV_ON, status = 'connected', now } = {}) {
  const db = await createDb();
  const g = status ? await domainIn(db, BRAND.slug, DOMAIN, status) : null;
  const supabase = createSupabase(db);
  const pipeline = createPipeline({ env, supabase, shell: SHELL, now });
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
        const { fetchImpl } = makeFetch(SHELL, c.opts);
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
    ['/explore', `${PL_ORIGIN}/explore`], ['/sell', `${PL_ORIGIN}/sell`], ['/checkout/pro', `${PL_ORIGIN}/checkout/pro`],
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
  assert.deepEqual(config.matcher, ['/((?!assets/|_vercel/|api/).*)', '/api/render', '/api/sitemap', '/api/og', '/api/qr']);
  assert.equal(vj.crons, undefined);
});
