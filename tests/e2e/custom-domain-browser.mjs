// PR-D in a real browser: cold loads, client-side navigation, host isolation,
// primary changes, disconnects, resolver failures and routing-off compatibility;
// PR-D.1: a TEST-mode domain (the flag off, the domain listed) next to an
// unlisted one.
//
// Opt-in (needs Google Chrome):   node tests/e2e/custom-domain-browser.mjs
//
// It builds the SPA (with test Supabase settings) into a temporary folder, then
// drives headless Chrome. EVERY request Chrome makes is intercepted over the
// DevTools protocol and answered by tests/helpers/routingWorld.mjs -- Vercel's
// own compiled route table for this repo, the real middleware.js, api/render.js
// and api/sitemap.js over the real PR-B + PR-B.1 SQL in PGlite -- and the SPA's
// own Supabase calls by the same stand-in. All
// real DNS is blackholed, so nothing leaves this machine. (Browser CORS is off:
// the stand-in is not a real Supabase; isolation never relied on CORS.)
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SB, ANON, createDb, domainIn, setPrimary, disconnect, createSupabase, createPipeline,
} from '../helpers/routingWorld.mjs';
import { RESOLVE_CACHE_MS } from '../../api/_resolve.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
  .find((p) => existsSync(p));
const PORT = 9337;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PL = 'https://www.pocketlink.store';

// ── 1. Build the SPA exactly as production does, with test Supabase settings ──
const work = mkdtempSync(join(tmpdir(), 'pl-e2e-'));
const dist = join(work, 'dist');
const build = spawnSync(process.execPath, [join(ROOT, 'node_modules/vite/bin/vite.js'), 'build', '--outDir', dist, '--emptyOutDir'], {
  cwd: ROOT, encoding: 'utf8', env: { ...process.env, VITE_SUPABASE_URL: SB, VITE_SUPABASE_ANON_KEY: ANON },
});
if (build.status !== 0) { console.error(build.stdout, build.stderr); process.exit(1); }
const SHELL = readFileSync(join(dist, 'index.html'), 'utf8');
// Server-only: the test-host list never reaches the browser bundle.
const BUNDLE_HAS_ROUTING_ENV = readdirSync(join(dist, 'assets'))
  .some((f) => readFileSync(join(dist, 'assets', f), 'utf8').includes('CUSTOM_DOMAINS_ROUTING'));

// ── 2. The world: stores, domains, a controllable clock ──────────────────────
const db = await createDb();
await db.query(`insert into public.stores (slug, config) values ('thirdstore', $1)`,
  [JSON.stringify({ slug: 'thirdstore', businessName: 'Third Store', products: [], categories: [] })]);
const brand = await domainIn(db, 'brandshop', 'brandshop.test', 'connected');
await domainIn(db, 'otherstore', 'otherbrand.test', 'connected');
await domainIn(db, 'thirdstore', 'pending.test', 'pending');
let t = 1e12;
const now = () => t;
const supabase = createSupabase(db);
const ENV_ON = { VITE_SUPABASE_URL: SB, VITE_SUPABASE_ANON_KEY: ANON, CUSTOM_DOMAINS_ROUTING_ENABLED: 'true' };
const ENV_OFF = { VITE_SUPABASE_URL: SB, VITE_SUPABASE_ANON_KEY: ANON };
let pipeline = createPipeline({ env: ENV_ON, supabase, shell: SHELL, distDir: dist, now });
const APP_HOSTS = new Set(['brandshop.test', 'www.brandshop.test', 'otherbrand.test', 'www.otherbrand.test',
  'pending.test', 'www.pending.test', 'never-claimed.test', 'fourthbrand.test', 'www.fourthbrand.test',
  'www.pocketlink.store', 'pocketlink.store']);

// ── 3. Chrome, with every request answered here ──────────────────────────────
const profile = join(work, 'profile');
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--no-first-run',
  '--no-default-browser-check', '--disable-extensions', '--disable-background-networking',
  '--disable-web-security', '--host-resolver-rules=MAP * ~NOTFOUND', '--window-size=1280,900', 'about:blank',
], { stdio: 'ignore' });
let target;
for (let i = 0; i < 60 && !target; i++) {
  try { target = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json(); } catch { await sleep(250); }
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let seq = 0;
const pending = new Map();
const pageErrors = [];
const docs = [];          // every top-level document response: { url, status }
const loaded = [];        // every request the page made: { url, type }
const blocked = [];
const send = (method, params = {}) => new Promise((res) => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });

async function answer({ requestId, request, resourceType }) {
  const u = new URL(request.url);
  loaded.push({ url: request.url, type: resourceType });
  try {
    let res;
    if (u.hostname === 'sb.test') {
      const r = await supabase.handle(request.url, { method: request.method, headers: request.headers, body: request.postData });
      res = { status: r.status, headers: Object.fromEntries(r.headers), body: Buffer.from(await r.arrayBuffer()) };
    } else if (APP_HOSTS.has(u.hostname)) {
      res = await pipeline.handle({ method: request.method, url: request.url, headers: request.headers });
    } else {
      blocked.push(request.url);
      await send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' });
      return;
    }
    if (resourceType === 'Document') docs.push({ url: request.url, status: res.status, headers: res.headers });
    await send('Fetch.fulfillRequest', {
      requestId, responseCode: res.status,
      responseHeaders: Object.entries(res.headers).map(([name, value]) => ({ name, value: String(value) })),
      body: res.body.toString('base64'),
    });
  } catch (e) {
    pageErrors.push(`harness: ${request.url}: ${e.message}`);
    await send('Fetch.failRequest', { requestId, errorReason: 'Failed' });
  }
}
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === 'Fetch.requestPaused') answer(m.params);
  if (m.method === 'Runtime.exceptionThrown') pageErrors.push(m.params.exceptionDetails?.exception?.description?.split('\n')[0] || 'exception');
});
await send('Runtime.enable');
await send('Page.enable');
await send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });

const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
async function waitFor(expr, ms = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await ev(expr)) return true; await sleep(150); }
  return false;
}
async function go(url) {
  docs.length = 0;
  await send('Page.navigate', { url });
  await waitFor('document.readyState === "complete"');
  await sleep(300);
}
// innerText honours CSS text-transform, so compare case-insensitively.
const text = (s) => `document.body && document.body.innerText.toLowerCase().includes(${JSON.stringify(s.toLowerCase())})`;
const lastDoc = () => docs.at(-1) || {};
const clickText = (s) => ev(`(() => {
  const all = [...document.querySelectorAll('a,button,[role=button],div,span,h2,h3,h4,p')];
  const want = ${JSON.stringify(s.toLowerCase())};
  const hit = all.filter(e => e.offsetParent !== null && e.innerText && e.innerText.trim().toLowerCase() === want)
                 .sort((a, b) => a.innerText.length - b.innerText.length)[0]
          || all.filter(e => e.offsetParent !== null && e.innerText && e.innerText.toLowerCase().includes(want))
                 .sort((a, b) => a.innerText.length - b.innerText.length)[0];
  if (!hit) return 'not-found';
  const c = hit.closest('a,button,[role=button]') || hit;
  c.scrollIntoView({ block: 'center' }); c.click();
  return c.tagName;
})()`);
const canon = () => ev(`[...document.querySelectorAll('link[rel=canonical]')].map(l => l.href)`);
const otherStoreReads = () => supabase.log.filter((e) => e.path === '/rest/v1/stores' && e.query.includes('otherstore')).length;

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: Boolean(ok), detail }); };

try {
  // ── Cold load of a merchant domain ─────────────────────────────────────────
  await go('https://brandshop.test/');
  check('cold load /: the owning store renders', await waitFor(text('Clay Mug')) && await ev(text('Brand Shop')), lastDoc().status);
  check('cold load /: exactly one canonical, on the domain', JSON.stringify(await canon()) === JSON.stringify(['https://brandshop.test/']), JSON.stringify(await canon()));
  check('cold load /: SPA in merchant mode for this store', (await ev('window.__PL_HOST__ && window.__PL_HOST__.slug')) === 'brandshop');
  const hrefs = await ev(`[...document.querySelectorAll('a[href]')].map(a => a.getAttribute('href'))`);
  check('no link on the page leads to another store or a slug path', !hrefs.some((h) => /otherstore|^\/brandshop|\/marketplace/.test(h)), JSON.stringify(hrefs));
  check('footer Terms / Privacy / Manage are absolute PocketLink links',
    ['/terms', '/privacy', '/brandshop/manage'].every((p) => hrefs.includes(`${PL}${p}`)), JSON.stringify(hrefs.filter((h) => h.includes('pocketlink'))));

  // ── Client-side navigation (no reloads) ─────────────────────────────────────
  await ev('window.__noReload = 42');
  await clickText('Clay Mug');
  check('client nav: product card -> /p/p1', await waitFor(`location.pathname === '/p/p1'`), await ev('location.pathname'));
  check('client nav: no full reload', (await ev('window.__noReload')) === 42);
  await ev('history.back()');
  check('client nav: back -> /', await waitFor(`location.pathname === '/'`) && (await ev('window.__noReload')) === 42, await ev('location.pathname'));
  await waitFor(text('Mugs'));
  await clickText('Mugs');
  check('client nav: category chip -> /c/mugs', await waitFor(`location.pathname === '/c/mugs'`) && (await ev('window.__noReload')) === 42, await ev('location.pathname'));
  // An in-app route change to another store's path renders nothing of it.
  await ev(`history.pushState({}, '', '/otherstore'); dispatchEvent(new PopStateEvent('popstate'))`);
  check('client nav to /otherstore: this shop\'s "not found", never that store',
    await waitFor(text('Page not found')) && !(await ev(text('Other Store'))) && !(await ev(text('Secret Tea'))));
  await ev(`history.pushState({}, '', '/otherstore/p/o1'); dispatchEvent(new PopStateEvent('popstate'))`);
  check('client nav to /otherstore/p/o1: still nothing of it', await waitFor(text('Page not found')) && !(await ev(text('Secret Tea'))));
  check('the other store was never even fetched', otherStoreReads() === 0, otherStoreReads());

  // ── Cold loads of deep links ────────────────────────────────────────────────
  await go('https://brandshop.test/p/p2');
  check('cold load /p/p2: that product', await waitFor(text('Brass Lamp')) && lastDoc().status === 200);
  check('cold load /p/p2: canonical on the domain', JSON.stringify(await canon()) === JSON.stringify(['https://brandshop.test/p/p2']), JSON.stringify(await canon()));
  await go('https://brandshop.test/c/lamps');
  check('cold load /c/lamps: that category', await waitFor(text('Brass Lamp')) && (await ev('location.pathname')) === '/c/lamps');

  // ── Isolation on cold loads ─────────────────────────────────────────────────
  for (const path of ['/otherstore', '/otherstore/p/o1', '/brandshop', '/index.html', '/api/render?path=/otherstore']) {
    await go(`https://brandshop.test${path}`);
    check(`cold load ${path}: 404, nothing of another store`, lastDoc().status === 404 && !(await ev(text('Other Store'))) && !(await ev(text('Secret Tea'))),
      `${lastDoc().status}`);
  }
  await go('https://otherbrand.test/');
  check('another merchant\'s domain shows ITS store only', await waitFor(text('Secret Tea')) && !(await ev(text('Clay Mug'))));
  check('the two domains never cross', otherStoreReads() >= 1 && (await ev('window.__PL_HOST__.slug')) === 'otherstore');

  // ── Paths the middleware never sees: no way into PocketLink's SPA ───────────
  // (review of 5863649: these reached the unrestricted SPA, which then navigated
  // client-side to a demo store.) Connected, pending and never-claimed domains.
  const readsBefore = otherStoreReads();
  for (const host of ['brandshop.test', 'pending.test', 'never-claimed.test']) {
    for (const path of ['/assets/missing.js', '/_vercel/missing', '/api/missing', '/api/x/manage', '/assets/manage', '/api/_hosts']) {
      await go(`https://${host}${path}`);
      const since = loaded.length;
      check(`${host}${path}: a real 404, not the SPA`,
        lastDoc().status === 404 && (await ev('document.getElementById("root") === null')) && (await ev('window.__PL_HOST__ === undefined')),
        `${lastDoc().status}`);
      for (const to of ['/demo/aanyaboutique', '/otherstore', '/otherstore/p/o1', '/']) {
        await ev(`history.pushState({}, '', '${to}'); dispatchEvent(new PopStateEvent('popstate'))`);
      }
      await sleep(500);
      const scripts = loaded.slice(since).filter((r) => r.type === 'Script' || r.url.includes('/assets/'));
      check(`${host}${path}: no client-side way to another store afterwards`,
        !(await ev(text('Secret Tea'))) && !(await ev(text('Aanya'))) && !(await ev(text('Other Store'))) &&
        (await ev('document.getElementById("root") === null')) && scripts.length === 0, JSON.stringify(scripts.map((r) => r.url)));
    }
  }
  check('nothing of another store was fetched by any of it', otherStoreReads() === readsBefore, `${readsBefore} -> ${otherStoreReads()}`);

  // ── PocketLink pages from a merchant domain ─────────────────────────────────
  await go('https://brandshop.test/manage');
  check('/manage -> this store\'s PocketLink dashboard', await waitFor(`location.href === '${PL}/brandshop/manage'`), await ev('location.href'));
  await go('https://brandshop.test/terms');
  check('/terms -> PocketLink', await waitFor(`location.href === '${PL}/terms'`), await ev('location.href'));
  await go('https://brandshop.test/');
  await waitFor(text('Clay Mug'));
  await ev(`[...document.querySelectorAll('a')].find(a => a.getAttribute('href') === '${PL}/brandshop/manage').click()`);
  check('footer Manage click -> PocketLink dashboard', await waitFor(`location.href === '${PL}/brandshop/manage'`), await ev('location.href'));

  // ── Not connected ───────────────────────────────────────────────────────────
  for (const url of ['https://pending.test/', 'https://pending.test/p/p1', 'https://www.pending.test/']) {
    await go(url);
    check(`${url}: not connected`, lastDoc().status === 404 && await ev(text('not connected to a PocketLink shop')), lastDoc().status);
  }

  // ── Primary change ──────────────────────────────────────────────────────────
  await go('https://www.brandshop.test/c/mugs?ref=x');
  check('redirect name -> primary, same path and query', await waitFor(`location.href === 'https://brandshop.test/c/mugs?ref=x'`), await ev('location.href'));
  await setPrimary(db, brand, 'www.brandshop.test');
  t += RESOLVE_CACHE_MS + 1;
  await go('https://brandshop.test/c/mugs');
  check('after a primary change: old name -> new primary', await waitFor(`location.href === 'https://www.brandshop.test/c/mugs'`), await ev('location.href'));
  check('after a primary change: renders, canonical on the new primary',
    await waitFor(text('Clay Mug')) && JSON.stringify(await canon()) === JSON.stringify(['https://www.brandshop.test/c/mugs']), JSON.stringify(await canon()));

  // ── Disconnect ──────────────────────────────────────────────────────────────
  await disconnect(db, brand);
  t += RESOLVE_CACHE_MS + 1;
  await go('https://www.brandshop.test/');
  check('after a disconnect: not connected', lastDoc().status === 404 && await ev(text('not connected')), lastDoc().status);

  // ── Resolver failure ────────────────────────────────────────────────────────
  supabase.knobs.resolver = 'http500';
  t += RESOLVE_CACHE_MS + 1;
  await go('https://otherbrand.test/');
  check('resolver failing: 503, no store, not the PocketLink app',
    lastDoc().status === 503 && await ev(text('could not load just now')) && !(await ev(text('Secret Tea'))), lastDoc().status);
  await go(PL + '/otherstore');
  check('PocketLink store page while the canonical-domain lookup fails: 503, no canonical at all, not the store',
    lastDoc().status === 503 && (await canon()).length === 0 && !(await ev(text('Secret Tea'))), lastDoc().status + ' ' + JSON.stringify(await canon()));
  supabase.knobs.resolver = 'ok';

  // ── PocketLink host, routing on ─────────────────────────────────────────────
  await go(`${PL}/otherstore`);
  check('PocketLink host: store still served there', await waitFor(text('Secret Tea')) && lastDoc().status === 200);
  check('PocketLink host: canonical on its connected domain', JSON.stringify(await canon()) === JSON.stringify(['https://otherbrand.test/']), JSON.stringify(await canon()));
  check('PocketLink host: SPA in PocketLink mode', (await ev('window.__PL_HOST__ === undefined')) === true);
  await clickText('Secret Tea');
  check('PocketLink host: client nav keeps /{slug}/p/{id}', await waitFor(`location.pathname === '/otherstore/p/o1'`), await ev('location.pathname'));

  // ── Routing OFF: exactly today's behaviour ──────────────────────────────────
  pipeline = createPipeline({ env: ENV_OFF, supabase, shell: SHELL, distDir: dist, now });
  const lookups = supabase.log.filter((e) => e.path.includes('resolve_store_host')).length;
  await go('https://otherbrand.test/');
  check('routing off: a connected domain\'s root is the plain PocketLink shell, not a store',
    lastDoc().status === 200 && (await ev('window.__PL_HOST__ === undefined')) && !(await ev(text('Secret Tea'))));
  await go('https://otherbrand.test/otherstore');
  check('routing off: store paths on a non-PocketLink host are "not connected", as today', lastDoc().status === 404);
  await go(`${PL}/otherstore`);
  check('routing off: PocketLink store page, canonical on PocketLink',
    await waitFor(text('Secret Tea')) && JSON.stringify(await canon()) === JSON.stringify([`${PL}/otherstore`]), JSON.stringify(await canon()));
  check('routing off: no merchant-domain lookup at all', supabase.log.filter((e) => e.path.includes('resolve_store_host')).length === lookups);

  // ── TEST mode: the flag off, ONE connected domain listed ────────────────────
  check('server-only: the browser bundle never names the routing settings', !BUNDLE_HAS_ROUTING_ENV);
  await db.query(`insert into public.stores (slug, config) values ('fourthstore', $1)`, [JSON.stringify({
    slug: 'fourthstore', businessName: 'Fourth Store', theme: { primary: '#0d9488' },
    categories: [{ id: 'all', label: 'All Products' }], products: [{ id: 'f1', name: 'Fourth Thing', price: 5, category: 'all' }] })]);
  await domainIn(db, 'fourthstore', 'fourthbrand.test', 'connected');
  pipeline = createPipeline({ env: { ...ENV_OFF, CUSTOM_DOMAINS_ROUTING_TEST_HOSTS: 'otherbrand.test' }, supabase, shell: SHELL, distDir: dist, now });
  t += RESOLVE_CACHE_MS + 1;
  const testFrom = supabase.log.length;
  await go('https://otherbrand.test/');
  check('TEST mode: the listed connected domain renders its store, in merchant mode',
    await waitFor(text('Secret Tea')) && (await ev('window.__PL_HOST__ && window.__PL_HOST__.slug')) === 'otherstore', lastDoc().status);
  const metas = await ev(`[...document.querySelectorAll('meta[name=robots]')].map(m => m.content).join('|')`);
  check('TEST mode: noindex, nofollow -- the header and the page\'s one robots meta',
    lastDoc().headers?.['x-robots-tag'] === 'noindex, nofollow' && metas === 'noindex, nofollow', `${lastDoc().headers?.['x-robots-tag']} / ${metas}`);
  await ev('window.__noReload2 = 7');
  await clickText('Secret Tea');
  check('TEST mode: client navigation to a product, no reload',
    await waitFor(`location.pathname === '/p/o1'`) && (await ev('window.__noReload2')) === 7, await ev('location.pathname'));
  const robotsTxt = await ev(`fetch('/robots.txt').then(r => r.text())`);
  check('TEST mode: robots.txt lets crawlers in, names no sitemap', /Allow: \//.test(robotsTxt) && !/Disallow|Sitemap/i.test(robotsTxt), JSON.stringify(robotsTxt));
  check('TEST mode: no sitemap', (await ev(`fetch('/sitemap.xml').then(r => r.status)`)) === 404);
  await go('https://fourthbrand.test/');
  check('TEST mode: an unlisted connected domain does not enter merchant mode',
    lastDoc().status === 200 && (await ev('window.__PL_HOST__ === undefined')) && !(await ev(text('Fourth Thing'))), lastDoc().status);
  await go('https://www.otherbrand.test/');
  check('TEST mode: the unlisted www name of the listed domain is not routed either', (await ev('window.__PL_HOST__ === undefined')) && lastDoc().status === 200);
  const unlistedLookups = supabase.log.slice(testFrom)
    .filter((e) => e.path.endsWith('/resolve_store_host') && /fourthbrand|www\.otherbrand/.test(e.body || '')).length;
  check('TEST mode: unlisted hosts were never looked up', unlistedLookups === 0, unlistedLookups);
} finally {
  ws.close();
  chrome.kill();
  await sleep(500);
  try { rmSync(work, { recursive: true, force: true }); } catch { /* chrome may still hold the profile briefly */ }
}

const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : `  [${r.detail}]`}`);
console.log(`\n${results.length - failed.length}/${results.length} passed; outside requests blocked: ${blocked.length}` +
  (blocked.length ? ` (${[...new Set(blocked.map((u) => new URL(u).host))].join(', ')})` : ''));
if (pageErrors.length) console.log('page errors:', [...new Set(pageErrors)].slice(0, 10));
process.exit(failed.length ? 1 : 0);
