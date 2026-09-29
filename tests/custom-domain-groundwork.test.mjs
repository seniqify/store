// Custom-domain groundwork (PR-A). No custom-domain behaviour is enabled here;
// this makes today's rendering safe to build on:
//
//   * every server-rendered page carries exactly ONE canonical (index.html's
//     static home-page canonical used to sit beside the page's own);
//   * only PocketLink's hosts (and this project's Vercel deployment URLs) can
//     render anything — no other host can choose a store, through its path or
//     through ?path;
//   * the SPA's base HTML always comes from a trusted origin, never from the raw
//     request host, and a failed fetch never redirects to itself;
//   * _seo.js takes an explicit storeBase; src/utils/storeUrls.js builds the
//     storefront paths; the two agree.
//
// Regression: tests/fixtures/render-snapshots.json was generated from main
// 09ae139's render.js BEFORE this change, for every route below, with only the
// duplicate static canonical removed. Every response must match it exactly.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import handler, { PL_ORIGIN, normalizeHost, isTrustedHost, baseHtmlOrigin } from '../api/render.js';
import { storeSeo, storeBody } from '../api/_seo.js';
import { categoryLinkId } from '../api/_categoryLink.js';
import { storePath, storeUrl, managePath } from '../src/utils/storeUrls.js';
import {
  makeFetch, runHandler, POCKETLINK_CASES, STORE, STATIC_CANONICAL, canonicals, canonicalHref,
} from './helpers/renderHarness.mjs';

const read = (p) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), 'utf8').replace(/\r\n/g, '\n');
const SNAP = JSON.parse(read('tests/fixtures/render-snapshots.json'));
const REAL_INDEX = read('index.html');
const sha = (s) => createHash('sha256').update(s).digest('hex');
const render = (c, base = SNAP.baseHtml, opts = c.opts) => {
  const { fetchImpl, seen } = makeFetch(base, opts);
  return runHandler(handler, c, fetchImpl).then((out) => ({ ...out, seen }));
};
const byName = Object.fromEntries(POCKETLINK_CASES.map((c) => [c.name, c]));
const r = (path) => `/api/render?path=${path}`;

// ═══════════════════════════════════════════════════════════════════════════
// Regression: every PocketLink route is byte-identical to before, minus the
// duplicate canonical
// ═══════════════════════════════════════════════════════════════════════════

test('the snapshot covers every PocketLink case', () => {
  assert.deepEqual(Object.keys(SNAP.cases).sort(), POCKETLINK_CASES.map((c) => c.name).sort());
  assert.ok(SNAP.baseHtml.includes(STATIC_CANONICAL), 'the frozen base HTML carries the static canonical');
});

for (const c of POCKETLINK_CASES) {
  test(`regression (${c.name}): status, headers and body match the pre-change output exactly`, async () => {
    const want = SNAP.cases[c.name];
    const out = await render(c);
    assert.equal(out.status, want.status);
    assert.deepEqual(out.headers, want.headers);
    if (want.body !== undefined) assert.equal(out.body, want.body);
    assert.equal(out.body.length, want.bodyLength);
    assert.equal(sha(out.body), want.bodySha256);
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Exactly one canonical, with the value it always had
// ═══════════════════════════════════════════════════════════════════════════

const EXPECTED_CANONICAL = {
  'store':                    `${PL_ORIGIN}/krupaagarbattiwork`,
  'store, trailing slash':    `${PL_ORIGIN}/krupaagarbattiwork`,
  'store, mixed-case path':   `${PL_ORIGIN}/krupaagarbattiwork`,
  'store, direct pathname':   `${PL_ORIGIN}/krupaagarbattiwork`,
  'product':                  `${PL_ORIGIN}/krupaagarbattiwork/p/prod-2`,
  'product, variants':        `${PL_ORIGIN}/krupaagarbattiwork/p/prod-3`,
  'product, unknown id':      `${PL_ORIGIN}/krupaagarbattiwork`,
  'category by label slug':   `${PL_ORIGIN}/krupaagarbattiwork/c/dhoop-sticks`,
  'category by id':           `${PL_ORIGIN}/krupaagarbattiwork/c/agarbatti-packs`,
  'category, unknown':        `${PL_ORIGIN}/krupaagarbattiwork`,
  'marketplace':              `${PL_ORIGIN}/marketplace`,
  'explore':                  `${PL_ORIGIN}/marketplace`,
  'unknown store':            `${PL_ORIGIN}/`,      // unmodified SPA shell: index.html's own
  'store without a name':     `${PL_ORIGIN}/`,
  'reserved path':            `${PL_ORIGIN}/`,
  'manage path':              `${PL_ORIGIN}/`,
  'deep unknown path':        `${PL_ORIGIN}/`,
  'root':                     `${PL_ORIGIN}/`,
  'supabase down':            `${PL_ORIGIN}/`,
  'no host header':           `${PL_ORIGIN}/krupaagarbattiwork`,
  'apex host':                'https://pocketlink.store/krupaagarbattiwork',
  'market host, marketplace': 'https://market.pocketlink.store/marketplace',
  'preview deployment':       'https://store-git-custom-domains-seniqifys-projects.vercel.app/krupaagarbattiwork/p/prod-1',
};

test('every case has an expected canonical', () => {
  assert.deepEqual(Object.keys(EXPECTED_CANONICAL).sort(), POCKETLINK_CASES.map((c) => c.name).sort());
});

for (const base of [['the frozen base HTML', null], ['the REAL index.html', REAL_INDEX]]) {
  for (const c of POCKETLINK_CASES) {
    test(`exactly one canonical (${c.name}, ${base[0]}), with the value it always had`, async () => {
      const out = await render(c, base[1] ?? SNAP.baseHtml);
      const tags = canonicals(out.body);
      assert.equal(tags.length, 1, tags.join(' | '));
      assert.equal(canonicalHref(tags[0]), EXPECTED_CANONICAL[c.name]);
      // og:url always agrees with the canonical.
      const og = (out.body.match(/<meta\s+property="og:url"\s+content="([^"]*)"/) || [])[1];
      assert.equal(og, EXPECTED_CANONICAL[c.name]);
    });
  }
}

test('the store pages that used to carry two canonicals were the server-rendered ones', () => {
  const two = Object.entries(SNAP.cases).filter(([, v]) => v.oldCanonicalCount === 2).map(([k]) => k).sort();
  assert.deepEqual(two, [
    'apex host', 'category by id', 'category by label slug', 'category, unknown', 'explore',
    'market host, marketplace', 'marketplace', 'no host header', 'preview deployment', 'product',
    'product, unknown id', 'product, variants', 'store', 'store, direct pathname',
    'store, mixed-case path', 'store, trailing slash',
  ]);
});

test('a canonical in any attribute order or quoting is replaced, not duplicated', async () => {
  const odd = SNAP.baseHtml.replace(STATIC_CANONICAL,
    `<link href='https://www.pocketlink.store/' rel=canonical>\n<link rel="canonical" href="https://x.example/"/>`);
  const out = await render(byName.product, odd);
  const tags = canonicals(out.body);
  assert.equal(tags.length, 1);
  assert.equal(canonicalHref(tags[0]), `${PL_ORIGIN}/krupaagarbattiwork/p/prod-2`);
});

// ═══════════════════════════════════════════════════════════════════════════
// Hosts: nothing but PocketLink can render a store
// ═══════════════════════════════════════════════════════════════════════════

const HOSTILE_HOSTS = [
  'brand.com', 'shop.brand.com', 'BRAND.COM:443', 'brand.com.',
  'pocketlink.store.evil.com', 'evilpocketlink.store', 'www.pocketlink.store.attacker.net', 'xpocketlink.store',
  'someone-else.vercel.app', 'store.vercel.app', 'seniqifys-projects.vercel.app.evil.com',
  'localhost', '127.0.0.1', '[::1]',
];
const STORE_URLS = [
  r('/krupaagarbattiwork'), r('/krupaagarbattiwork/p/prod-1'), r('/krupaagarbattiwork/c/dhoop-sticks'),
  '/krupaagarbattiwork', r('/marketplace'), r('/'),
];

for (const host of HOSTILE_HOSTS) {
  test(`a non-PocketLink host (${host}) can never render a store, whatever the path or ?path`, async () => {
    for (const url of STORE_URLS) {
      const out = await render({ host, url });
      assert.equal(out.status, 404, `${host} ${url}`);
      assert.deepEqual(out.seen, [], 'nothing is fetched: no base HTML, no store lookup');
      assert.equal(out.body.includes('Krupa'), false);
      assert.equal(out.body.includes('__PL_CONFIG__'), false);
      assert.equal(out.body.includes('application/ld+json'), false);
      assert.match(out.body, /not connected to a PocketLink shop/);
      assert.equal(out.headers['cache-control'], 'no-store');
      assert.equal(out.headers['x-robots-tag'], 'noindex');
    }
  });
}

test('host normalisation: case, port and trailing dot never change which host it is', () => {
  assert.equal(normalizeHost('WWW.PocketLink.Store:443'), 'www.pocketlink.store');
  assert.equal(normalizeHost('www.pocketlink.store.'), 'www.pocketlink.store');
  assert.equal(normalizeHost(undefined), '');
  assert.equal(isTrustedHost('www.pocketlink.store'), true);
  assert.equal(isTrustedHost('pocketlink.store'), true);
  assert.equal(isTrustedHost('market.pocketlink.store'), true);
  assert.equal(isTrustedHost('store-abc123-seniqifys-projects.vercel.app'), true);
  for (const h of HOSTILE_HOSTS) assert.equal(isTrustedHost(normalizeHost(h)), false, h);
});

test('a PocketLink host written with odd case and a port is still served, canonical on the clean host', async () => {
  const out = await render({ host: 'WWW.POCKETLINK.STORE:443', url: r('/krupaagarbattiwork') });
  assert.equal(out.status, 200);
  assert.equal(canonicalHref(canonicals(out.body)[0]), `${PL_ORIGIN}/krupaagarbattiwork`);
});

// ═══════════════════════════════════════════════════════════════════════════
// Base HTML: always from a trusted origin, and a failure never redirects
// ═══════════════════════════════════════════════════════════════════════════

test('base HTML is fetched from www.pocketlink.store for every PocketLink host', async () => {
  for (const host of ['www.pocketlink.store', 'pocketlink.store', 'market.pocketlink.store', 'WWW.POCKETLINK.STORE:443', undefined]) {
    const out = await render({ host, url: r('/krupaagarbattiwork') });
    assert.equal(out.seen[0], 'https://www.pocketlink.store/index.html', String(host));
    assert.equal(out.seen.filter((u) => u.endsWith('/index.html')).length, 1);
  }
});

test("a deployment URL renders its OWN build: base HTML from that deployment, never another host", async () => {
  const preview = 'store-git-custom-domains-seniqifys-projects.vercel.app';
  const out = await render({ host: preview, url: r('/krupaagarbattiwork') });
  assert.equal(out.seen[0], `https://${preview}/index.html`);
  assert.equal(baseHtmlOrigin(preview), `https://${preview}`);
  assert.equal(baseHtmlOrigin('www.pocketlink.store'), PL_ORIGIN);
  assert.equal(baseHtmlOrigin('pocketlink.store'), PL_ORIGIN);
});

test('VERCEL_URL / VERCEL_BRANCH_URL (set by Vercel, not the client) are trusted deployment hosts', async () => {
  const prev = { u: process.env.VERCEL_URL, b: process.env.VERCEL_BRANCH_URL };
  process.env.VERCEL_URL = 'store-8f2k1.vercel.app';
  process.env.VERCEL_BRANCH_URL = 'store-git-main-other.vercel.app';
  try {
    for (const host of ['store-8f2k1.vercel.app', 'store-git-main-other.vercel.app']) {
      const out = await render({ host, url: r('/krupaagarbattiwork') });
      assert.equal(out.status, 200);
      assert.equal(out.seen[0], `https://${host}/index.html`);
    }
    const other = await render({ host: 'store-9zzzz.vercel.app', url: r('/krupaagarbattiwork') });
    assert.equal(other.status, 404, 'a different vercel.app host is still not ours');
  } finally {
    if (prev.u === undefined) delete process.env.VERCEL_URL; else process.env.VERCEL_URL = prev.u;
    if (prev.b === undefined) delete process.env.VERCEL_BRANCH_URL; else process.env.VERCEL_BRANCH_URL = prev.b;
  }
});

test('a failed base-HTML fetch answers 503 — no redirect to itself, nothing cached', async () => {
  for (const url of [r('/krupaagarbattiwork'), r('/marketplace'), r('/start')]) {
    const out = await render({ host: 'www.pocketlink.store', url }, SNAP.baseHtml, { baseDown: true });
    assert.equal(out.status, 503);
    assert.equal(out.headers.location, undefined, 'no Location header: nothing to loop on');
    assert.equal(out.headers['cache-control'], 'no-store');
    assert.equal(out.headers['retry-after'], '5');
    assert.equal(out.body.includes('Krupa'), false);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// _seo.js: explicit storeBase
// ═══════════════════════════════════════════════════════════════════════════

const CFG = STORE.config;
const SLUG = STORE.slug;
const DHOOP = CFG.categories[1];
const ITEM = CFG.products[1];

test('storeSeo with no storeBase is identical to passing {origin}/{slug} explicitly', () => {
  for (const [section, item] of [[null, null], [DHOOP, null], [null, ITEM]]) {
    const implicit = storeSeo(CFG, SLUG, PL_ORIGIN, { avg: 4.3, count: 3 }, section, item);
    const explicit = storeSeo(CFG, SLUG, PL_ORIGIN, { avg: 4.3, count: 3 }, section, item, { storeBase: `${PL_ORIGIN}/${SLUG}` });
    assert.deepEqual(implicit, explicit);
  }
});

test('storeSeo URLs are exactly what src/utils/storeUrls.js builds', () => {
  assert.equal(storeSeo(CFG, SLUG, PL_ORIGIN).url, storeUrl(PL_ORIGIN, SLUG));
  assert.equal(storeSeo(CFG, SLUG, PL_ORIGIN, null, DHOOP).url, storeUrl(PL_ORIGIN, SLUG, { categoryId: categoryLinkId(DHOOP) }));
  assert.equal(storeSeo(CFG, SLUG, PL_ORIGIN, null, null, ITEM).url, storeUrl(PL_ORIGIN, SLUG, { productId: ITEM.id }));
});

test('an explicit storeBase moves the STORE urls only; site urls stay on the serving origin', () => {
  const seo = storeSeo({ ...CFG, coverImage: null }, SLUG, PL_ORIGIN, null, null, ITEM, { storeBase: 'https://brand.com' });
  assert.equal(seo.url, 'https://brand.com/p/prod-2');
  const [business, , breadcrumb] = [seo.ld['@graph'][0], null, seo.ld['@graph'].at(-1)];
  assert.equal(business.url, 'https://brand.com/p/prod-2');
  assert.equal(business['@id'], 'https://brand.com/p/prod-2#business');
  assert.equal(breadcrumb.itemListElement[0].item, `${PL_ORIGIN}/marketplace`, 'the marketplace stays on PocketLink');
  assert.equal(breadcrumb.itemListElement[1].item, 'https://brand.com', 'the store crumb is the store base');
  assert.match(seo.image, /^https:\/\/www\.pocketlink\.store\/api\/og\?slug=krupaagarbattiwork/, 'the og card is served by PocketLink');
  const cat = storeSeo(CFG, SLUG, PL_ORIGIN, null, DHOOP, null, { storeBase: 'https://brand.com' });
  assert.equal(cat.url, 'https://brand.com/c/dhoop-sticks');
  // No WhatsApp number: the crawlable body links to the store base.
  const noWa = { ...CFG, whatsappNumber: '' };
  const body = storeBody(noWa, SLUG, PL_ORIGIN, storeSeo(noWa, SLUG, PL_ORIGIN, null, null, null, { storeBase: 'https://brand.com' }));
  assert.match(body, /<a href="https:\/\/brand\.com">Order on WhatsApp<\/a>/);
  assert.match(body, /href="https:\/\/www\.pocketlink\.store\/marketplace"/);
});

// ═══════════════════════════════════════════════════════════════════════════
// src/utils/storeUrls.js
// ═══════════════════════════════════════════════════════════════════════════

test('storePath / storeUrl / managePath build exactly the strings the call sites used to', () => {
  const slugs = ['krupaagarbattiwork', 'royalfoodsmasale', 'a-b-c'];
  const ids = ['prod-2', 17, 'x_y', '', 0, 'UPPER'];
  for (const s of slugs) {
    assert.equal(storePath(s), `/${s}`);
    assert.equal(managePath(s), `/${s}/manage`);
    assert.equal(storeUrl(PL_ORIGIN, s), `${PL_ORIGIN}/${s}`);
    for (const id of ids) {
      assert.equal(storePath(s, { productId: id }), `/${s}/p/${id}`);
      assert.equal(storePath(s, { categoryId: id }), `/${s}/c/${id}`);
      assert.equal(storeUrl(PL_ORIGIN, s, { productId: id }), `${PL_ORIGIN}/${s}/p/${id}`);
    }
  }
});

test('storePath: a product wins over a category; only undefined means "not given"', () => {
  assert.equal(storePath('s', { productId: 'p1', categoryId: 'c1' }), '/s/p/p1');
  assert.equal(storePath('s', { productId: undefined, categoryId: 'c1' }), '/s/c/c1');
  assert.equal(storePath('s', {}), '/s');
  assert.equal(storePath('s', { categoryId: '' }), '/s/c/', 'an empty id renders as the old template did');
  assert.equal(storePath('s', { productId: null }), '/s/p/null', 'null renders as the old template did');
});

test('the storefront no longer builds slug paths by hand in the files this PR moved to storeUrls', () => {
  const HAND_BUILT = /[`'"]\/\$\{(?:config\.slug|store\.slug|slug|businessSlug)\}/;
  for (const [file, helper] of [
    ['src/pages/Home.jsx', 'storePath'],
    ['src/components/layout/Footer.jsx', 'managePath'],
    ['src/pages/OrderTracking.jsx', 'storePath'],
  ]) {
    const src = read(file);
    assert.equal(HAND_BUILT.test(src), false, `${file} still builds a /\${slug} path by hand`);
    assert.match(src, new RegExp(`import \\{[^}]*\\b${helper}\\b[^}]*\\} from '(\\.\\./)+utils/storeUrls'`), `${file} imports ${helper}`);
  }
});
