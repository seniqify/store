// Custom-domain groundwork (PR-A). No custom-domain behaviour is enabled here;
// this makes today's rendering safe to build on:
//
//   * every server-rendered page carries exactly ONE canonical (index.html's
//     static home-page canonical used to sit beside the page's own);
//   * only PocketLink's hosts (and this deployment's own Vercel URLs, named
//     exactly by Vercel's system env vars) can render anything — no other host,
//     not even another project under the team's vercel.app suffix, can choose a
//     store, through its path or through ?path;
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
  makeFetch, runHandler, withVercelEnv, POCKETLINK_CASES, PREVIEW, STORE, STATIC_CANONICAL, canonicals, canonicalHref,
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
  'someone-else.vercel.app', 'store.vercel.app', 'store-9zzzz.vercel.app', 'seniqifys-projects.vercel.app.evil.com',
  // Every project in the team shares its vercel.app suffix, so the suffix alone never grants trust.
  'otherproject-git-main-seniqifys-projects.vercel.app', 'otherproject-seniqifys-projects.vercel.app',
  'otherproject-abc123-seniqifys-projects.vercel.app', 'store-abc123-seniqifys-projects.vercel.app',
  '-seniqifys-projects.vercel.app',
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

test('host normalisation: case, port and trailing dot never change which host it is', () => withVercelEnv({}, () => {
  assert.equal(normalizeHost('WWW.PocketLink.Store:443'), 'www.pocketlink.store');
  assert.equal(normalizeHost('www.pocketlink.store.'), 'www.pocketlink.store');
  assert.equal(normalizeHost(undefined), '');
  assert.equal(isTrustedHost('www.pocketlink.store'), true);
  assert.equal(isTrustedHost('pocketlink.store'), true);
  assert.equal(isTrustedHost('market.pocketlink.store'), true);
  assert.equal(isTrustedHost(''), false);
  assert.equal(isTrustedHost(PREVIEW), false, 'a vercel.app URL is only trusted when Vercel names it');
  for (const h of HOSTILE_HOSTS) assert.equal(isTrustedHost(normalizeHost(h)), false, h);
}));

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

// ═══════════════════════════════════════════════════════════════════════════
// Deployment hosts: only the EXACT URLs Vercel names for this deployment
// ═══════════════════════════════════════════════════════════════════════════

// What Vercel sets on a preview of this project (VERCEL_PROJECT_PRODUCTION_URL
// is the project's production domain, set even on previews).
const DEPLOYMENT_URL = 'store-8f2k1abcd-seniqifys-projects.vercel.app';
const PROJECT_PROD_URL = 'store-seniqifys-projects.vercel.app';
const ALL_OURS = { VERCEL_URL: DEPLOYMENT_URL, VERCEL_BRANCH_URL: PREVIEW, VERCEL_PROJECT_PRODUCTION_URL: PROJECT_PROD_URL };

async function assertServedFromItself(host, env) {
  const out = await render({ host, url: r('/krupaagarbattiwork'), env });
  assert.equal(out.status, 200, host);
  assert.equal(out.seen[0], `https://${host}/index.html`, 'a deployment renders its OWN build');
  assert.equal(canonicalHref(canonicals(out.body)[0]), `https://${host}/krupaagarbattiwork`);
  assert.equal(await withVercelEnv(env, () => isTrustedHost(host)), true);
  assert.equal(await withVercelEnv(env, () => baseHtmlOrigin(host)), `https://${host}`);
}

async function assertNotConnected(host, env) {
  const out = await render({ host, url: r('/krupaagarbattiwork'), env });
  assert.equal(out.status, 404, host);
  assert.deepEqual(out.seen, [], `${host}: nothing is fetched`);
  assert.match(out.body, /not connected to a PocketLink shop/);
  assert.equal(await withVercelEnv(env, () => isTrustedHost(normalizeHost(host))), false, host);
}

test('the exact current VERCEL_URL is trusted (and renders its own build)', async () => {
  await assertServedFromItself(DEPLOYMENT_URL, { VERCEL_URL: DEPLOYMENT_URL });
  // Vercel's value is normalised the same way as the Host header.
  await assertServedFromItself(DEPLOYMENT_URL, { VERCEL_URL: 'Store-8F2K1ABCD-Seniqifys-Projects.vercel.app' });
});

test('the exact VERCEL_BRANCH_URL is trusted (and renders its own build)', async () => {
  await assertServedFromItself(PREVIEW, { VERCEL_BRANCH_URL: PREVIEW });
});

test('VERCEL_PROJECT_PRODUCTION_URL is never trusted: Vercel names the shortest attached domain, which may be a merchant\'s', async () => {
  await assertNotConnected(PROJECT_PROD_URL, { VERCEL_PROJECT_PRODUCTION_URL: PROJECT_PROD_URL });
  // 2026-10-01: attaching poketlink.app made it this project's production URL on the next deployment.
  for (const host of ['poketlink.app', 'brand.com', 'shop.brand.co.in']) {
    await assertNotConnected(host, { VERCEL_PROJECT_PRODUCTION_URL: host });
    await assertNotConnected(host, { ...ALL_OURS, VERCEL_PROJECT_PRODUCTION_URL: host });
  }
});

test('with all three set, only VERCEL_URL and VERCEL_BRANCH_URL are trusted', async () => {
  for (const host of [DEPLOYMENT_URL, PREVIEW]) await assertServedFromItself(host, ALL_OURS);
  await assertNotConnected(PROJECT_PROD_URL, ALL_OURS);
});

test('a VERCEL_URL or VERCEL_BRANCH_URL that is not a vercel.app host is not trusted', async () => {
  for (const host of ['brand.com', 'poketlink.app', 'vercel.app.brand.com']) {
    await assertNotConnected(host, { VERCEL_URL: host });
    await assertNotConnected(host, { VERCEL_BRANCH_URL: host });
  }
});

test('each variable trusts only its own host: VERCEL_URL alone does not trust the branch URL, and so on', async () => {
  await assertNotConnected(PREVIEW, { VERCEL_URL: DEPLOYMENT_URL, VERCEL_PROJECT_PRODUCTION_URL: PROJECT_PROD_URL });
  await assertNotConnected(DEPLOYMENT_URL, { VERCEL_BRANCH_URL: PREVIEW, VERCEL_PROJECT_PRODUCTION_URL: PROJECT_PROD_URL });
  await assertNotConnected(PROJECT_PROD_URL, { VERCEL_URL: DEPLOYMENT_URL, VERCEL_BRANCH_URL: PREVIEW });
});

test('another project under the same -seniqifys-projects.vercel.app suffix is NOT trusted', async () => {
  const siblings = [
    'otherproject-git-main-seniqifys-projects.vercel.app',   // another project's branch URL
    'otherproject-seniqifys-projects.vercel.app',            // another project's production URL
    'otherproject-8f2k1abcd-seniqifys-projects.vercel.app',  // another project's deployment URL
    'store-zzzz9999-seniqifys-projects.vercel.app',          // not THIS deployment of this project
    'store-git-other-branch-seniqifys-projects.vercel.app',  // not THIS deployment's branch
    '-seniqifys-projects.vercel.app',
  ];
  for (const env of [{}, ALL_OURS]) {
    for (const host of siblings) await assertNotConnected(host, env);
  }
});

test('near-misses of a trusted Vercel URL are NOT trusted', async () => {
  for (const host of [
    `x${PREVIEW}`, `evil-${PREVIEW}`, `sub.${PREVIEW}`, `${PREVIEW}.evil.com`,
    PREVIEW.replace('.vercel.app', '.vercel.app.evil.com'), PREVIEW.replace('vercel.app', 'vercel.com'),
  ]) await assertNotConnected(host, ALL_OURS);
});

test('arbitrary vercel.app hosts remain rejected, with or without Vercel env', async () => {
  for (const env of [{}, ALL_OURS]) {
    for (const host of ['someone-else.vercel.app', 'store.vercel.app', 'store-9zzzz.vercel.app', 'vercel.app']) {
      await assertNotConnected(host, env);
    }
  }
});

test('every hostile host is still rejected when Vercel names this deployment', async () => {
  for (const host of HOSTILE_HOSTS) {
    for (const url of STORE_URLS) {
      const out = await render({ host, url, env: ALL_OURS });
      assert.equal(out.status, 404, `${host} ${url}`);
      assert.deepEqual(out.seen, []);
    }
  }
});

test('empty VERCEL_* values trust nothing', async () => {
  const empty = { VERCEL_URL: '', VERCEL_BRANCH_URL: '', VERCEL_PROJECT_PRODUCTION_URL: '' };
  assert.equal(await withVercelEnv(empty, () => isTrustedHost('')), false);
  await assertNotConnected(PREVIEW, empty);
});

test('a PocketLink production domain named by VERCEL_PROJECT_PRODUCTION_URL still takes base HTML from www', async () => {
  // In production Vercel sets this to the project's shortest custom domain.
  for (const prod of ['pocketlink.store', 'www.pocketlink.store']) {
    for (const host of ['www.pocketlink.store', 'pocketlink.store', 'market.pocketlink.store']) {
      const out = await render({ host, url: r('/krupaagarbattiwork'), env: { VERCEL_PROJECT_PRODUCTION_URL: prod } });
      assert.equal(out.status, 200);
      assert.equal(out.seen[0], 'https://www.pocketlink.store/index.html', `${host} (prod=${prod})`);
      assert.equal(await withVercelEnv({ VERCEL_PROJECT_PRODUCTION_URL: prod }, () => baseHtmlOrigin(host)), PL_ORIGIN);
    }
  }
});

test('base HTML origin: PocketLink hosts use the main site; only a Vercel-named host uses itself', () => withVercelEnv(ALL_OURS, () => {
  assert.equal(baseHtmlOrigin('www.pocketlink.store'), PL_ORIGIN);
  assert.equal(baseHtmlOrigin('pocketlink.store'), PL_ORIGIN);
  assert.equal(baseHtmlOrigin('market.pocketlink.store'), PL_ORIGIN);
  assert.equal(baseHtmlOrigin(PREVIEW), `https://${PREVIEW}`);
  assert.equal(baseHtmlOrigin('otherproject-git-main-seniqifys-projects.vercel.app'), PL_ORIGIN);
}));

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
