// PR-D.1: routing TEST domains while CUSTOM_DOMAINS_ROUTING_ENABLED stays off.
//
// One routing mode -- 'off' | 'test' | 'global' (routingMode, api/_hosts.js) --
// decides every custom-domain entry point: the middleware, api/render.js,
// api/sitemap.js and the og/qr guard. CUSTOM_DOMAINS_ROUTING_TEST_HOSTS lists
// the exact hostnames routed in 'test' mode; a test domain is routed exactly
// like a 'global' one, but never indexed and never advertised in a sitemap.
// PocketLink's own pages follow 'global' only.
//
// Same world as tests/custom-domain-routing.test.mjs: Vercel's compiled route
// table, the real middleware and functions, the real PR-B + PR-B.1 SQL.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SB, ANON, createDb, domainIn, createSupabase, createPipeline, get, POCKETLINK_IMAGE_CACHE,
} from './helpers/routingWorld.mjs';
import { makeFetch, runHandler, POCKETLINK_CASES } from './helpers/renderHarness.mjs';
import renderHandler from '../api/render.js';
import { createResolver, RESOLVE_CACHE_MS } from '../api/_resolve.js';
import { routingMode, routingTestHosts, normalizeHost } from '../api/_hosts.js';
import { TEST_ROBOTS } from '../api/_pages.js';
import { PL_ORIGIN } from '../src/utils/customDomainRoutes.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
const SHELL = JSON.parse(read('tests/fixtures/render-snapshots.json')).baseHtml;
const MAIN_SITEMAP = JSON.parse(read('tests/fixtures/sitemap-main.json'));

const BASE_ENV = Object.freeze({ VITE_SUPABASE_URL: SB, VITE_SUPABASE_ANON_KEY: ANON });
const BRAND = 'brandshop.test';             // brandshop: apex group (brandshop.test + www.brandshop.test, apex primary)
const OTHER = 'otherbrand.test';            // otherstore: apex group
const SUB = 'shop.example.test';            // thirdshop: a subdomain group (that one name only)
const PENDING = 'pending.test';             // fourthshop: claimed, not connected
const PREVIEW = 'store-git-x-seniqifys-projects.vercel.app';

const hostMarker = (html) => {
  const m = html.match(/window\.__PL_HOST__=(\{[^<]*?\})<\/script>/);
  return m ? JSON.parse(m[1]) : null;
};
const robotsMetas = (html) => [...html.matchAll(/<meta\s+name=["']robots["'][^>]*>/gi)].map((m) => (m[0].match(/content="([^"]*)"/) || [])[1]);
const canonicals = (html) => [...html.matchAll(/<link\b[^>]*\brel=["']?canonical["']?[^>]*>/gi)]
  .map((m) => (m[0].match(/href="([^"]*)"/) || [])[1]);
const resolvesOf = (sb, host) => sb.log.filter((e) => e.path.endsWith('/resolve_store_host') && JSON.parse(e.body || '{}').p_host === host).length;
const resolves = (sb) => sb.log.filter((e) => e.path.endsWith('/resolve_store_host')).length;
const primaryLookups = (sb) => sb.log.filter((e) => e.path.endsWith('/store_primary_host')).length;

async function world({ list, global = false, env: extra = {} } = {}) {
  const db = await createDb();
  for (const [slug, name] of [['thirdshop', 'Third Shop'], ['fourthshop', 'Fourth Shop']]) {
    await db.query('insert into public.stores (slug, config) values ($1, $2)', [slug, JSON.stringify({
      slug, businessName: name, theme: { primary: '#0d9488' }, categories: [{ id: 'all', label: 'All Products' }],
      products: [{ id: 't1', name: `${name} Item`, price: 10, category: 'all' }],
    })]);
  }
  await domainIn(db, 'brandshop', BRAND, 'connected');
  await domainIn(db, 'otherstore', OTHER, 'connected');
  await domainIn(db, 'thirdshop', SUB, 'connected');
  await domainIn(db, 'fourthshop', PENDING, 'pending');
  const env = {
    ...BASE_ENV, ...extra,
    ...(list === undefined ? {} : { CUSTOM_DOMAINS_ROUTING_TEST_HOSTS: list }),
    ...(global ? { CUSTOM_DOMAINS_ROUTING_ENABLED: 'true' } : {}),
  };
  const supabase = createSupabase(db);
  const pipeline = createPipeline({ env, supabase, shell: SHELL });
  const directRender = async (host, url) => {
    const out = { status: 200, headers: {}, body: '' };
    const res = { setHeader: (k, v) => { out.headers[k.toLowerCase()] = String(v); }, status: (c) => { out.status = c; return res; },
                  send: (b) => { out.body = String(b); return res; } };
    await renderHandler({ headers: { host }, url }, res, { env, fetchImpl: supabase.handle, shell: SHELL,
      resolver: createResolver({ url: SB, anonKey: ANON, fetchImpl: supabase.handle }) });
    return { ...out, text: out.body };
  };
  return { db, env, supabase, pipeline, directRender, get: (url) => get(pipeline, url) };
}

// ═══════════════════════════════════════════════════════════════════════════
// The routing mode, and the test list's exact-hostname rules
// ═══════════════════════════════════════════════════════════════════════════

test('routingMode: off by default; global with the flag (list irrelevant); test only for an exactly listed custom host', () => {
  const hosts = [BRAND, `www.${BRAND}`, OTHER, SUB, 'example.test', `x.${SUB}`, 'www.pocketlink.store', 'pocketlink.store'];
  for (const list of [undefined, '', '   ', ',', ' , , ', '\n']) {
    const env = { ...BASE_ENV, ...(list === undefined ? {} : { CUSTOM_DOMAINS_ROUTING_TEST_HOSTS: list }) };
    for (const h of hosts) assert.equal(routingMode(h, env), 'off', `${JSON.stringify(list)} ${h}`);
    assert.equal(routingTestHosts(env).size, 0);
  }
  const listed = { ...BASE_ENV, CUSTOM_DOMAINS_ROUTING_TEST_HOSTS: BRAND };
  assert.deepEqual(hosts.map((h) => routingMode(h, listed)), ['test', 'off', 'off', 'off', 'off', 'off', 'off', 'off']);
  for (const list of [undefined, '', BRAND, '*', 'garbage, ,']) {
    const g = { ...BASE_ENV, CUSTOM_DOMAINS_ROUTING_ENABLED: 'true', ...(list === undefined ? {} : { CUSTOM_DOMAINS_ROUTING_TEST_HOSTS: list }) };
    assert.deepEqual(hosts.map((h) => routingMode(h, g)), ['global', 'global', 'global', 'global', 'global', 'global', 'off', 'off'], `global, list ${list}`);
  }
});

test('test list: exact normalised hostnames only -- nothing inferred, anything malformed or trusted ignored', () => {
  const env = (list, extra = {}) => ({ ...BASE_ENV, ...extra, CUSTOM_DOMAINS_ROUTING_TEST_HOSTS: list });
  const cases = [
    [BRAND, [BRAND]],                                     // apex only: www NOT implied
    [`www.${BRAND}`, [`www.${BRAND}`]],                    // www only: apex NOT implied
    [SUB, [SUB]],                                         // a subdomain: its parent and children NOT implied
    ['BrandShop.TEST', [BRAND]],                          // case
    [`${BRAND}.`, [BRAND]],                               // one trailing dot
    [`  ${BRAND}  ,  `, [BRAND]],                         // whitespace, empty entries
    [`${BRAND}, www.${BRAND}`, [BRAND, `www.${BRAND}`]],   // both names: listed separately
    // malformed: ignored
    ['brand shop.test', []], [`${BRAND}:443`, []], [`https://${BRAND}`, []], [`${BRAND}/x`, []], ['brandshop', []],
    ['1.2.3.4', []], ['-bad.test', []], ['brandshop..test', []], [`${BRAND}..`, []], ['xn--', []],
    // wildcard-looking: ignored, never a pattern
    [`*.${BRAND}`, []], ['*', []], [`.${BRAND}`, []], [`*${BRAND}`, []], ['%2a.brandshop.test', []],
    // PocketLink's own hosts and this project's own Vercel hosts: ignored
    ['www.pocketlink.store, pocketlink.store, market.pocketlink.store', []],
    // mixed: only the valid custom entry survives
    [`${BRAND}, *.example.test, ${OTHER}:443, www.pocketlink.store`, [BRAND]],
  ];
  for (const [list, expected] of cases) {
    assert.deepEqual([...routingTestHosts(env(list))].sort(), [...expected].sort(), JSON.stringify(list));
  }
  for (const v of ['VERCEL_URL', 'VERCEL_BRANCH_URL', 'VERCEL_PROJECT_PRODUCTION_URL']) {
    const e = env(`${PREVIEW}, ${BRAND}`, { [v]: PREVIEW });
    assert.deepEqual([...routingTestHosts(e)], [BRAND], v);
    assert.equal(routingMode(PREVIEW, e), 'off', `${v}: still this project's own host`);
  }
  // Request hosts are normalised the same way before the exact match.
  const e = env(BRAND);
  for (const raw of ['BrandShop.Test', `${BRAND}.`, `${BRAND}:443`, ` ${BRAND} `]) assert.equal(routingMode(normalizeHost(raw), e), 'test', raw);
  for (const raw of [`www.${BRAND}`, `x.${BRAND}`, `${BRAND}x`, `brandshop.test.x`]) assert.equal(routingMode(normalizeHost(raw), e), 'off', raw);
});

// ═══════════════════════════════════════════════════════════════════════════
// Off by default: zero routing, zero lookups
// ═══════════════════════════════════════════════════════════════════════════

test('global off and the list unset, empty or blank: no routing on any host, and no lookup at all', async () => {
  const paths = ['/', '/p/p1', '/c/mugs', '/brandshop', '/robots.txt', '/sitemap.xml', '/api/og?slug=brandshop',
                 '/api/qr?slug=otherstore', '/api/%72ender?path=/', '/api/%73itemap', '/manage'];
  for (const list of [undefined, '', '   ', ',', ' , , ']) {
    const w = await world({ list });
    for (const h of [BRAND, `www.${BRAND}`, OTHER, SUB, PENDING, 'www.pocketlink.store']) {
      for (const p of paths) await w.get(`https://${h}${p}`);
    }
    assert.equal(resolves(w.supabase), 0, `${JSON.stringify(list)}: no resolve_store_host`);
    assert.equal(primaryLookups(w.supabase), 0, `${JSON.stringify(list)}: no store_primary_host`);
    const root = await w.get(`https://${BRAND}/`);
    assert.deepEqual([root.status, root.via, hostMarker(root.text)], [200, 'static', null], 'the plain shell, as with routing off');
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Listed vs unlisted connected domains
// ═══════════════════════════════════════════════════════════════════════════

test('two connected domains, one listed: the listed one routes; the unlisted one does not, and is never resolved', async () => {
  const w = await world({ list: BRAND });
  for (const [path, title] of [['/', null], ['/p/p1', /Clay Mug/], ['/c/mugs', /Mugs/]]) {
    const r = await w.get(`https://${BRAND}${path}`);
    assert.deepEqual([r.status, r.via], [200, 'function'], path);
    assert.deepEqual(hostMarker(r.text), { slug: 'brandshop', base: `https://${BRAND}` }, path);
    assert.equal(r.headers['x-robots-tag'], TEST_ROBOTS, path);
    if (title) assert.match(r.text, title);
  }
  assert.equal((await w.get(`https://${BRAND}/otherstore`)).status, 404, 'still only its own store');

  // The unlisted connected domain: exactly as with routing off.
  const root = await w.get(`https://${OTHER}/`);
  assert.deepEqual([root.status, root.via, hostMarker(root.text)], [200, 'static', null]);
  const storePath = await w.get(`https://${OTHER}/otherstore`);
  assert.equal(storePath.status, 404);
  assert.match(storePath.text, /not connected to a PocketLink shop/);
  const deep = await w.get(`https://${OTHER}/p/o1`);
  assert.deepEqual([deep.status, deep.via, hostMarker(deep.text)], [200, 'rewrite', null], 'the SPA catch-all, as with routing off');
  for (const h of [OTHER, `www.${OTHER}`, SUB, PENDING]) assert.equal(resolvesOf(w.supabase, h), 0, `${h} never resolved`);
  assert.ok(resolvesOf(w.supabase, BRAND) > 0);
});

test('exact names over HTTP: apex only, www only, a subdomain only -- each routes just the name listed', async () => {
  const routedAt = async (w, host) => {
    const r = await w.get(`https://${host}/`);
    if (r.status === 200 && r.via === 'static') return 'off';
    return r.status === 307 ? `307 ${r.headers.location}` : `${r.status} ${hostMarker(r.text)?.slug ?? '-'}`;
  };
  const all = [BRAND, `www.${BRAND}`, SUB, 'example.test', `x.${SUB}`, OTHER];
  const expect = {
    [BRAND]: { [BRAND]: '200 brandshop' },
    [`www.${BRAND}`]: { [`www.${BRAND}`]: `307 https://${BRAND}/` },     // routed; its primary (the apex) is not listed
    [SUB]: { [SUB]: '200 thirdshop' },
    [`${BRAND}, www.${BRAND}`]: { [BRAND]: '200 brandshop', [`www.${BRAND}`]: `307 https://${BRAND}/` },
  };
  for (const [list, routed] of Object.entries(expect)) {
    const w = await world({ list });
    for (const h of all) assert.equal(await routedAt(w, h), routed[h] ?? 'off', `list "${list}": ${h}`);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// One decision at every entry point -- no split brain
// ═══════════════════════════════════════════════════════════════════════════

test('the SAME mode at every entry point: middleware, direct and encoded render, robots, sitemap, og, qr', async () => {
  const probes = {
    'middleware page': async (w, h) => { const r = await w.get(`https://${h}/`); return hostMarker(r.text) ? 'routed' : r.via === 'static' ? 'off' : `? ${r.status}`; },
    'direct render': async (w, h) => { const r = await w.directRender(h, '/api/render?path=/'); return hostMarker(r.text) ? 'routed' : /not connected/.test(r.text) ? 'off' : `? ${r.status}`; },
    'encoded render route': async (w, h) => { const r = await w.get(`https://${h}/api/%72ender?path=/`); return hostMarker(r.text) ? 'routed' : /not connected/.test(r.text) ? 'off' : `? ${r.status}`; },
    'robots': async (w, h) => { const r = await w.get(`https://${h}/robots.txt`); return r.via === 'middleware' ? 'routed' : r.via === 'static' ? 'off' : `? ${r.via}`; },
    'sitemap': async (w, h) => { const r = await w.get(`https://${h}/sitemap.xml`); return r.text.includes(PL_ORIGIN) ? 'off' : 'routed'; },
    'encoded sitemap': async (w, h) => { const r = await w.get(`https://${h}/api/%73itemap`); return r.text.includes(PL_ORIGIN) ? 'off' : 'routed'; },
    // Another store's image: refused only where the domain is routed.
    'og': async (w, h, other) => { const r = await w.get(`https://${h}/api/og?slug=${other}`); return r.status === 404 ? 'routed' : r.status === 200 ? 'off' : `? ${r.status}`; },
    'qr': async (w, h, other) => { const r = await w.get(`https://${h}/api/qr?slug=${other}`); return r.status === 404 ? 'routed' : r.status === 200 ? 'off' : `? ${r.status}`; },
  };
  for (const [label, opts] of [['test list', { list: BRAND }], ['global', { global: true, list: BRAND }], ['off', {}]]) {
    const w = await world(opts);
    for (const [host, other] of [[BRAND, 'otherstore'], [OTHER, 'brandshop']]) {
      const mode = routingMode(host, w.env);
      const want = mode === 'off' ? 'off' : 'routed';
      const seen = {};
      for (const [name, probe] of Object.entries(probes)) seen[name] = await probe(w, host, other);
      assert.deepEqual(seen, Object.fromEntries(Object.keys(probes).map((k) => [k, want])), `${label}: ${host} is '${mode}' everywhere`);
    }
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST mode SEO: never indexed, crawlable, no sitemap
// ═══════════════════════════════════════════════════════════════════════════

test('TEST mode: every HTML answer is noindex, nofollow -- header and page; nothing PocketLink-wide on it', async () => {
  const w = await world({ list: `${BRAND}, ${PENDING}, fresh.test` });
  for (const path of ['/', '/p/p1', '/c/mugs']) {
    const r = await w.get(`https://${BRAND}${path}`);
    assert.equal(r.status, 200, path);
    assert.equal(r.headers['x-robots-tag'], 'noindex, nofollow', `${path}: header`);
    assert.deepEqual(robotsMetas(r.text), ['noindex, nofollow'], `${path}: exactly one robots meta, the shell's "index, follow" replaced`);
    assert.equal(r.headers['cache-control'], 'no-store', path);
    assert.doesNotMatch(r.text, /SearchAction|"@type":"(Organization|WebSite)"|href="[^"]*marketplace/, `${path}: no PocketLink discovery`);
  }
  const answers = [
    ['not found', await w.get(`https://${BRAND}/otherstore`), 404],
    ['index.html', await w.get(`https://${BRAND}/index.html`), 404],
    ['encoded render, not a store page', await w.get(`https://${BRAND}/api/%72ender?path=/otherstore`), 404],
    ['og for another store', await w.get(`https://${BRAND}/api/og?slug=otherstore`), 404],
    ['encoded qr for another store', await w.get(`https://${BRAND}/api/%71r?slug=otherstore`), 404],
    ['listed, not connected', await w.get(`https://${PENDING}/`), 404],
    ['listed, not connected (encoded render)', await w.get(`https://${PENDING}/api/%72ender?path=/`), 404],
  ];
  for (const [what, r, status] of answers) {
    assert.equal(r.status, status, what);
    assert.equal(r.headers['x-robots-tag'], 'noindex, nofollow', `${what}: header`);
    assert.match(r.text, /<meta name="robots" content="noindex"/, `${what}: the page says noindex too`);
  }
  w.supabase.knobs.resolver = 'http500';
  const failed = await w.get('https://fresh.test/p/x');               // listed, never looked up before
  assert.deepEqual([failed.status, failed.headers['x-robots-tag']], [503, 'noindex, nofollow'], 'lookup failure: 503, noindex');
  w.supabase.knobs.resolver = 'ok';
  // This store's own image: served, never cached.
  const img = await w.get(`https://${BRAND}/api/og?slug=brandshop`);
  assert.deepEqual([img.status, img.headers['cache-control']], [200, 'no-store']);
});

test('TEST mode: robots.txt lets crawlers read the pages but names no sitemap; the sitemap is not served', async () => {
  const w = await world({ list: BRAND });
  const robots = await w.get(`https://${BRAND}/robots.txt`);
  assert.deepEqual([robots.status, robots.via, robots.headers['cache-control']], [200, 'middleware', 'no-store']);
  assert.equal(robots.text, 'User-agent: *\nAllow: /\n');
  assert.doesNotMatch(robots.text, /Disallow/i, 'crawling is not blocked: the noindex must be readable');
  assert.doesNotMatch(robots.text, /Sitemap/i, 'no sitemap advertised');
  // Each layer refuses on its own: the middleware answers /sitemap.xml itself (it
  // never hands a test domain to the sitemap function), and the function -- reached
  // directly by a path the matcher cannot see -- refuses too.
  for (const [path, layer] of [['/sitemap.xml', 'middleware'], ['/api/%73itemap', 'function']]) {
    const sm = await w.get(`https://${BRAND}${path}`);
    assert.deepEqual([sm.status, sm.headers['cache-control'], sm.headers['x-robots-tag']], [404, 'no-store', 'noindex, nofollow'], path);
    assert.equal(sm.via, layer, `${path}: answered by the ${layer}`);
    assert.doesNotMatch(sm.text, /<loc>|brandshop\.test\/(p|c)\//, `${path}: no test URL advertised`);
  }
  // In GLOBAL mode the same domain keeps PR-D's merchant-domain SEO.
  const g = await world({ global: true, list: BRAND });
  const page = await g.get(`https://${BRAND}/`);
  assert.equal(page.headers['x-robots-tag'], undefined);
  assert.deepEqual(robotsMetas(page.text), ['index, follow, max-image-preview:large']);
  assert.match((await g.get(`https://${BRAND}/robots.txt`)).text, new RegExp(`Sitemap: https://${BRAND.replace('.', '\\.')}/sitemap\\.xml`));
  const sm = await g.get(`https://${BRAND}/sitemap.xml`);
  assert.equal(sm.status, 200);
  assert.match(sm.text, /<loc>https:\/\/brandshop\.test\/p\/p1<\/loc>/);
});

// ═══════════════════════════════════════════════════════════════════════════
// PocketLink, with global off and a populated list: exactly as global off
// ═══════════════════════════════════════════════════════════════════════════

test('PocketLink with global off and a populated list: byte-identical pages, the same sitemap, no canonical lookups', async () => {
  const LIST = `${BRAND}, www.${BRAND}, krupaagarbattiwork.test, ${OTHER}`;
  for (const c of POCKETLINK_CASES) {
    const outs = [];
    for (const list of [undefined, LIST]) {
      const prev = process.env.CUSTOM_DOMAINS_ROUTING_TEST_HOSTS;
      if (list === undefined) delete process.env.CUSTOM_DOMAINS_ROUTING_TEST_HOSTS; else process.env.CUSTOM_DOMAINS_ROUTING_TEST_HOSTS = list;
      try {
        const { fetchImpl, seen } = makeFetch(SHELL, c.opts);
        outs.push(await runHandler(renderHandler, c, fetchImpl));
        assert.equal(seen.filter((u) => u.includes('store_primary_host')).length, 0, `${c.name}: no canonical-domain lookup`);
      } finally {
        if (prev === undefined) delete process.env.CUSTOM_DOMAINS_ROUTING_TEST_HOSTS; else process.env.CUSTOM_DOMAINS_ROUTING_TEST_HOSTS = prev;
      }
    }
    assert.deepEqual([outs[1].status, outs[1].body, outs[1].headers['cache-control']], [outs[0].status, outs[0].body, outs[0].headers['cache-control']], c.name);
  }

  const w = await world({ list: LIST });                  // brandshop IS connected to a listed domain
  const plain = await world({});                          // the same world, no list: plain global-off output
  const sm = await w.get('https://www.pocketlink.store/sitemap.xml');
  const expected = await plain.get('https://www.pocketlink.store/sitemap.xml');
  assert.deepEqual([sm.status, sm.text, sm.headers['cache-control']], [expected.status, expected.text, expected.headers['cache-control']], 'the sitemap: as global off');
  assert.equal(sm.headers['cache-control'], MAIN_SITEMAP.cacheControl);
  assert.ok(sm.text.includes(`<loc>${PL_ORIGIN}/brandshop</loc>`), 'the listed domain\'s store stays in PocketLink\'s sitemap');
  const store = await w.get('https://www.pocketlink.store/brandshop/p/p1');
  assert.deepEqual(canonicals(store.text), [`${PL_ORIGIN}/brandshop/p/p1`], 'canonical stays on PocketLink');
  assert.equal(hostMarker(store.text), null);
  assert.equal((await w.get('https://www.pocketlink.store/api/og?slug=brandshop')).headers['cache-control'], POCKETLINK_IMAGE_CACHE);
  assert.equal(primaryLookups(w.supabase), 0, 'no store_primary_host lookup from PocketLink pages');
  assert.equal(resolvesOf(w.supabase, 'www.pocketlink.store'), 0);
});

test('GLOBAL on: the list is irrelevant -- every connected custom domain routes, with merchant-domain SEO', async () => {
  for (const list of [undefined, BRAND, `*.example.test, ${OTHER}`]) {
    const w = await world({ global: true, list });
    for (const [host, slug] of [[BRAND, 'brandshop'], [OTHER, 'otherstore'], [SUB, 'thirdshop']]) {
      const r = await w.get(`https://${host}/`);
      assert.deepEqual([r.status, hostMarker(r.text)?.slug, r.headers['x-robots-tag']], [200, slug, undefined], `${list}: ${host}`);
    }
    const pl = await w.get('https://www.pocketlink.store/brandshop');
    assert.deepEqual(canonicals(pl.text), [`https://${BRAND}`], 'global: PocketLink canonical points at the domain, as in PR-D');
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// The real og/qr modules, in TEST mode
// ═══════════════════════════════════════════════════════════════════════════

test('the real api/og.js and api/qr.js: a listed domain is guarded; an unlisted one is not looked up; both never cache', async () => {
  const db = await createDb();
  await domainIn(db, 'brandshop', 'imgbrand.test', 'connected');
  await domainIn(db, 'otherstore', 'imgother.test', 'connected');
  const sb = createSupabase(db);
  const saved = { ...process.env };
  const realFetch = globalThis.fetch;
  const FONT = readFileSync(join(ROOT, 'node_modules/@vercel/og/dist/Geist-Regular.ttf'));
  const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
  const PROD_DB = 'https://uoyqbexemoheipwrtkcz.supabase.co';
  Object.assign(process.env, { VITE_SUPABASE_URL: SB, VITE_SUPABASE_ANON_KEY: ANON, CUSTOM_DOMAINS_ROUTING_TEST_HOSTS: 'imgbrand.test' });
  delete process.env.CUSTOM_DOMAINS_ROUTING_ENABLED;
  // Every request either module makes is answered here; nothing reaches the network.
  globalThis.fetch = async (u, init) => {
    const s = String(u);
    if (s.startsWith('data:')) return realFetch(u, init);                  // @vercel/og's own wasm
    if (s.startsWith(SB)) return sb.handle(u, init);
    if (s.startsWith(PROD_DB)) return sb.handle(SB + s.slice(PROD_DB.length), init);
    if (s.startsWith('https://api.qrserver.com/') || s.endsWith('.png')) return new Response(PNG_1X1, { headers: { 'Content-Type': 'image/png' } });
    if (/\.(woff2?|ttf)$/.test(s)) return new Response(FONT);
    return new Response('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36"/>', { headers: { 'Content-Type': 'image/svg+xml' } });
  };
  try {
    const { default: og } = await import('../api/og.js');
    const { default: qr } = await import('../api/qr.js');
    for (const [name, handler] of [['og', og], ['qr', qr]]) {
      const refused = await handler(new Request(`https://imgbrand.test/api/${name}?slug=otherstore`));
      assert.deepEqual([refused.status, refused.headers.get('cache-control'), refused.headers.get('x-robots-tag')], [404, 'no-store', TEST_ROBOTS], `listed ${name}`);
      for (const url of [`https://www.imgbrand.test/api/${name}?slug=brandshop`, `https://imgother.test/api/${name}?slug=brandshop`]) {
        const r = await handler(new Request(url));
        assert.deepEqual([r.status, r.headers.get('cache-control')], [200, 'no-store'], `unlisted, so not routed -- yet never cached: ${url}`);
        try { await r.body?.cancel(); } catch { /* fine */ }
      }
      const own = await handler(new Request(`https://imgbrand.test/api/${name}?slug=brandshop`));
      assert.deepEqual([own.status, own.headers.get('cache-control')], [200, 'no-store'], `listed, its own store: ${name}`);
      try { await own.body?.cancel(); } catch { /* fine */ }
    }
    assert.equal(resolvesOf(sb, 'imgbrand.test') > 0, true);
    assert.equal(resolvesOf(sb, 'www.imgbrand.test') + resolvesOf(sb, 'imgother.test'), 0, 'unlisted hosts are never resolved');
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
    globalThis.fetch = realFetch;
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// One helper, one parser, server-only
// ═══════════════════════════════════════════════════════════════════════════

test('every custom-domain entry point uses routingMode(); only api/_hosts.js reads the list; the browser never sees it', () => {
  const sources = {};
  const walk = (dir) => {
    for (const f of readdirSync(join(ROOT, dir))) {
      const rel = `${dir}/${f}`;
      if (statSync(join(ROOT, rel)).isDirectory()) walk(rel);
      else if (/\.(m?js|jsx)$/.test(f)) sources[rel] = read(rel);
    }
  };
  walk('api'); walk('src');
  sources['middleware.js'] = read('middleware.js');
  const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  for (const f of ['middleware.js', 'api/render.js', 'api/sitemap.js', 'api/_storeImageGuard.js']) {
    assert.match(code(sources[f]), /\broutingMode\(/, `${f} decides with routingMode()`);
  }
  for (const f of ['api/og.js', 'api/qr.js']) assert.match(code(sources[f]), /createStoreImageGuard\(\)/, `${f} uses the shared guard`);
  const readers = Object.entries(sources).filter(([, s]) => code(s).includes('CUSTOM_DOMAINS_ROUTING_TEST_HOSTS')).map(([f]) => f);
  assert.deepEqual(readers, ['api/_hosts.js'], 'one parser');
  const globalOnly = Object.entries(sources).filter(([f, s]) => f !== 'api/_hosts.js' && /\broutingEnabled\(/.test(code(s))).map(([f]) => f).sort();
  assert.deepEqual(globalOnly, ['api/render.js', 'api/sitemap.js'], 'routingEnabled() only for PocketLink-side behaviour');
  assert.equal(Object.keys(sources).filter((f) => f.startsWith('src/') && sources[f].includes('CUSTOM_DOMAINS_ROUTING')).length, 0, 'not in browser code');
  assert.doesNotMatch(read('vite.config.js'), /envPrefix/, 'Vite exposes only VITE_ variables');
});
