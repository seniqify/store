// PR-D, the browser side: how the SPA decides it is on a merchant's domain, the
// URLs it builds there, and the one route table both server and browser share.
// Pure functions plus static checks of the components that use them; the real
// browser run is tests/e2e/custom-domain-browser.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseHostMarker, hostMode } from '../src/utils/hostMode.js';
import { storePath, storeUrl, managePath, pocketlinkPath, isAbsoluteUrl } from '../src/utils/storeUrls.js';
import {
  storeRoute, pocketlinkTarget, isPassThrough, imageEndpointSlug, PL_ORIGIN,
} from '../src/utils/customDomainRoutes.js';

const read = (p) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), 'utf8').replace(/\r\n/g, '\n');
const PL = { mode: 'pocketlink' };
const M = parseHostMarker({ slug: 'brandshop', base: 'https://brandshop.test' }, 'brandshop.test');

test('host marker: only the server\'s marker, for THIS hostname, puts the SPA in merchant mode', () => {
  assert.deepEqual(M, { mode: 'merchant', slug: 'brandshop', base: 'https://brandshop.test' });
  assert.deepEqual(parseHostMarker(undefined, 'brandshop.test'), PL, 'no marker: PocketLink, as before');
  assert.deepEqual(parseHostMarker(null, 'www.pocketlink.store'), PL);
  for (const [marker, host] of [
    [{ slug: 'Brand Shop', base: 'https://brandshop.test' }, 'brandshop.test'],
    [{ slug: 'brandshop', base: 'http://brandshop.test' }, 'brandshop.test'],
    [{ slug: 'brandshop', base: 'https://brandshop.test/' }, 'brandshop.test'],
    [{ slug: 'brandshop', base: 'https://brandshop.test/x' }, 'brandshop.test'],
    [{ slug: 'brandshop', base: 'https://brandshop.test:8443' }, 'brandshop.test'],
    [{ slug: 'brandshop', base: 'https://other.test' }, 'brandshop.test'],
    [{ slug: 'brandshop' }, 'brandshop.test'], ['brandshop', 'brandshop.test'], [{}, 'brandshop.test'],
  ]) {
    assert.deepEqual(parseHostMarker(marker, host), { mode: 'invalid' }, JSON.stringify(marker));
  }
  assert.deepEqual(hostMode(), PL, 'outside a browser: PocketLink');
});

test('storeUrls on PocketLink: exactly the strings they always built', () => {
  assert.equal(storePath('krupa', {}, PL), '/krupa');
  assert.equal(storePath('krupa', { productId: 2 }, PL), '/krupa/p/2');
  assert.equal(storePath('krupa', { categoryId: 'dhoop' }, PL), '/krupa/c/dhoop');
  assert.equal(storePath('krupa', { productId: 1, categoryId: 'x' }, PL), '/krupa/p/1');
  assert.equal(managePath('krupa', PL), '/krupa/manage');
  assert.equal(pocketlinkPath('/terms', PL), '/terms');
  assert.equal(storeUrl('https://www.pocketlink.store', 'krupa', { productId: 'x' }), 'https://www.pocketlink.store/krupa/p/x');
  assert.equal(storePath('krupa'), '/krupa', 'default mode outside a browser');
});

test('storeUrls on a merchant domain: the domain\'s store at its root; anything else is PocketLink\'s absolute URL', () => {
  assert.equal(storePath('brandshop', {}, M), '/');
  assert.equal(storePath('brandshop', { productId: 'p1' }, M), '/p/p1');
  assert.equal(storePath('brandshop', { categoryId: 'mugs' }, M), '/c/mugs');
  assert.equal(storePath('otherstore', {}, M), `${PL_ORIGIN}/otherstore`, 'another store is never a path on this domain');
  assert.equal(storePath('otherstore', { productId: 'o1' }, M), `${PL_ORIGIN}/otherstore/p/o1`);
  assert.equal(managePath('brandshop', M), `${PL_ORIGIN}/brandshop/manage`);
  assert.equal(pocketlinkPath('/terms', M), `${PL_ORIGIN}/terms`);
  assert.equal(isAbsoluteUrl(`${PL_ORIGIN}/terms`), true);
  assert.equal(isAbsoluteUrl('/terms'), false);
});

test('the shared route table: only /, /p/{id}, /c/{id} are storefront paths', () => {
  assert.deepEqual(storeRoute('/'), { kind: 'home' });
  assert.deepEqual(storeRoute('/p/abc'), { kind: 'product', id: 'abc' });
  assert.deepEqual(storeRoute('/p/abc/'), { kind: 'product', id: 'abc' });
  assert.deepEqual(storeRoute('/c/mugs'), { kind: 'category', id: 'mugs' });
  for (const p of ['', '/p', '/p/', '/c', '/c/', '/x/y', '/p/a/b', '/brandshop', '/brandshop/p/1', '//p/1', '/P/1', '/p//', `/p/${'x'.repeat(201)}`]) {
    assert.equal(storeRoute(p), null, p);
  }
});

test('the shared route table: explicit PocketLink mappings -- /manage is THIS store\'s dashboard, another store\'s is not mapped', () => {
  assert.equal(pocketlinkTarget('/manage', '', 'brandshop'), `${PL_ORIGIN}/brandshop/manage`);
  assert.equal(pocketlinkTarget('/brandshop/manage', '?a=1', 'brandshop'), `${PL_ORIGIN}/brandshop/manage?a=1`);
  assert.equal(pocketlinkTarget('/otherstore/manage', '', 'brandshop'), null);
  assert.equal(pocketlinkTarget('/manage', '', ''), null, 'no store, no dashboard');
  for (const p of ['/start', '/plans', '/onboarding', '/terms', '/privacy', '/data-deletion', '/hub', '/console',
                   '/marketplace', '/explore', '/sell', '/checkout/pro', '/order/t1', '/confirm/t1', '/review/t1', '/demo/glowup']) {
    assert.equal(pocketlinkTarget(p, '?q=1', 'brandshop'), `${PL_ORIGIN}${p}?q=1`, p);
    assert.equal(pocketlinkTarget(`${p}/`, '', 'brandshop'), `${PL_ORIGIN}${p}`, `${p}/`);
  }
  for (const p of ['/', '/p/1', '/start/x', '/order', '/order/a/b', '/api/render', '/index.html', '/brandshop', '/otherstore', '/x']) {
    assert.equal(pocketlinkTarget(p, '', 'brandshop'), null, p);
  }
  assert.equal(pocketlinkTarget('/terms', 'javascript:x', 'brandshop'), `${PL_ORIGIN}/terms`, 'only a real query string is kept');
});

test('generic assets and store-image slugs', () => {
  for (const p of ['/assets/index-abc.js', '/_vercel/insights/script.js', '/favicon.svg', '/version.json', '/og-image.jpg']) assert.equal(isPassThrough(p), true, p);
  for (const p of ['/', '/index.html', '/llms.txt', '/robots.txt', '/sitemap.xml', '/api/render', '/assets', '/p/1']) assert.equal(isPassThrough(p), false, p);
  assert.equal(imageEndpointSlug('BrandShop'), 'brandshop');
  assert.equal(imageEndpointSlug('brand shop!'), 'brandshop');
  assert.equal(imageEndpointSlug(null), '');
});

test('App.jsx: a merchant domain renders ONLY the server-named store at /, /p/:productId, /c/:categoryId', () => {
  const src = read('src/App.jsx');
  const block = src.slice(src.indexOf('function MerchantRoutes'), src.indexOf('// A marker that does not check out'));
  const paths = [...block.matchAll(/<Route path="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(paths, ['/', '/p/:productId', '/c/:categoryId', '*']);
  assert.match(block, /<BusinessShell slug=\{slug\} \/>/, 'the store is the server-named one, never a URL param');
  assert.match(src, /const businessSlug = slug \?\? params\.businessSlug;/);
  assert.match(src, /HOST\.mode === 'merchant' \? \(\s*<MerchantRoutes slug=\{HOST\.slug\} \/>/, 'checked before every PocketLink route');
  assert.match(src, /if \(notFound\) return slug \? <StoreNotFound \/> : <NotFound slug=\{businessSlug\} \/>;/);
});

test('merchant-domain pages show no other shop: StoreNotFound, Footer and the search\'s marketplace link', () => {
  const code = (f) => read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const nf = code('src/pages/StoreNotFound.jsx');
  assert.doesNotMatch(nf, /listBusinesses|demo|marketplace|\/start|NotFound'/i);
  assert.deepEqual([...nf.matchAll(/to="([^"]*)"/g)].map((m) => m[1]), ['/'], 'the only way out is this shop\'s home');
  const footer = read('src/components/layout/Footer.jsx');
  assert.match(footer, /<SiteLink to=\{pocketlinkPath\('\/terms'\)\}/);
  assert.match(footer, /<SiteLink to=\{pocketlinkPath\('\/privacy'\)\}/);
  assert.match(footer, /<SiteLink to=\{managePath\(slug\)\}/);
  assert.doesNotMatch(footer, /<Link to="\/(terms|privacy)"/);
  const search = read('src/components/store/StoreSearchBar.jsx');
  assert.match(search, /referrals && hostMode\(\)\.mode !== 'merchant' && \(/);
  // The server marks a merchant page only in render.js, and the browser reads it only in hostMode.js.
  const users = ['src/App.jsx', 'src/utils/storeUrls.js', 'src/utils/hostMode.js', 'src/components/store/StoreSearchBar.jsx']
    .filter((f) => code(f).includes('__PL_HOST__'));
  assert.deepEqual(users, ['src/utils/hostMode.js']);
  assert.match(read('api/render.js'), /window\.__PL_HOST__=\$\{hostJson\}/);
});
