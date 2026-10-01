// PR-D.3: which hosts are PocketLink's own is decided by name and by THIS
// deployment's vercel.app URLs -- never by VERCEL_PROJECT_PRODUCTION_URL.
//
// 2026-10-01: with poketlink.app (13 characters) attached as the pilot's test
// domain, Vercel set the next deployment's VERCEL_PROJECT_PRODUCTION_URL to
// poketlink.app -- the project's shortest production domain -- in place of
// www.seniqify.store. api/_hosts.js trusted that variable, so poketlink.app served
// every PocketLink store (self canonical, indexable) and www.seniqify.store's
// store links became "not connected". Production was rolled back.
//
// Same world as the routing tests: Vercel's compiled route table, the real
// middleware and functions, the real PR-B + PR-B.1 SQL.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SB, ANON, createDb, domainIn, createSupabase, createPipeline, get } from './helpers/routingWorld.mjs';
import { classifyHost, routingMode, routingTestHosts, LEGACY_DEPLOYMENT_HOSTS } from '../api/_hosts.js';
import { TEST_ROBOTS } from '../api/_pages.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
const SHELL = JSON.parse(read('tests/fixtures/render-snapshots.json')).baseHtml;

const BRAND = 'brandshop.test';
// What Vercel sets on a production deployment once BRAND is the shortest attached domain.
const VERCEL_AFTER_ATTACH = Object.freeze({
  VERCEL_URL: 'store-e5cx4jydl-seniqifys-projects.vercel.app',
  VERCEL_BRANCH_URL: 'store-git-main-seniqifys-projects.vercel.app',
  VERCEL_PROJECT_PRODUCTION_URL: BRAND,
});
const BASE_ENV = Object.freeze({ VITE_SUPABASE_URL: SB, VITE_SUPABASE_ANON_KEY: ANON, ...VERCEL_AFTER_ATTACH });

const canonicals = (html) => [...html.matchAll(/<link\b[^>]*\brel=["']?canonical["']?[^>]*>/gi)]
  .map((m) => (m[0].match(/href="([^"]*)"/) || [])[1]);
const resolvesOf = (sb, host) => sb.log.filter((e) => e.path.endsWith('/resolve_store_host')
  && JSON.parse(e.body || '{}').p_host === host).length;

async function world({ status, test = false, global = false, extra = {} } = {}) {
  const db = await createDb();
  if (status) await domainIn(db, 'brandshop', BRAND, status);
  const env = {
    ...BASE_ENV, ...extra,
    ...(test ? { CUSTOM_DOMAINS_ROUTING_TEST_HOSTS: `${BRAND},www.${BRAND}` } : {}),
    ...(global ? { CUSTOM_DOMAINS_ROUTING_ENABLED: 'true' } : {}),
  };
  const supabase = createSupabase(db);
  const pipeline = createPipeline({ env, supabase, shell: SHELL });
  return { env, supabase, get: (url) => get(pipeline, url) };
}

const notConnected = (r, robots, what) => {
  assert.equal(r.status, 404, what);
  assert.match(r.text, /not connected to a PocketLink shop/, what);
  assert.doesNotMatch(r.text, /Other Store|Brand Shop/, `${what}: no store content`);
  assert.equal(r.headers['x-robots-tag'], robots, what);
};

// ═══════════════════════════════════════════════════════════════════════════

test('classification: a merchant domain named as VERCEL_PROJECT_PRODUCTION_URL stays a custom host', () => {
  for (const host of [BRAND, 'poketlink.app', 'brand.com', 'shop.brand.co.in']) {
    const env = { ...BASE_ENV, VERCEL_PROJECT_PRODUCTION_URL: host };
    assert.equal(classifyHost(host, env), 'custom', host);
  }
  // This deployment's own vercel.app URLs are still trusted, exactly.
  assert.equal(classifyHost(VERCEL_AFTER_ATTACH.VERCEL_URL, BASE_ENV), 'deployment');
  assert.equal(classifyHost(VERCEL_AFTER_ATTACH.VERCEL_BRANCH_URL, BASE_ENV), 'deployment');
  // www.seniqify.store keeps its old treatment by name, whatever Vercel names.
  assert.deepEqual([...LEGACY_DEPLOYMENT_HOSTS], ['www.seniqify.store']);
  for (const env of [{}, BASE_ENV, { VERCEL_PROJECT_PRODUCTION_URL: 'www.seniqify.store' }]) {
    assert.equal(classifyHost('www.seniqify.store', env), 'deployment');
    assert.equal(classifyHost('seniqify.store', env), 'custom', 'the apex is a Vercel redirect, never served');
  }
  // A listed test domain stays listed and routed in test mode.
  const listed = { ...BASE_ENV, CUSTOM_DOMAINS_ROUTING_TEST_HOSTS: `${BRAND},www.${BRAND}` };
  assert.deepEqual([...routingTestHosts(listed)].sort(), [BRAND, `www.${BRAND}`]);
  assert.equal(routingMode(BRAND, listed), 'test');
});

test('the incident, replayed: a READY test domain named as the production URL serves nothing, not PocketLink', async () => {
  const w = await world({ status: 'ready', test: true });
  for (const path of ['/', '/otherstore', '/brandshop', '/otherstore/p/o1', '/marketplace', '/manage', '/start']) {
    notConnected(await w.get(`https://${BRAND}${path}`), TEST_ROBOTS, path);
  }
  const robots = await w.get(`https://${BRAND}/robots.txt`);
  assert.doesNotMatch(robots.text, /Sitemap:|Disallow: \/onboarding/i, 'not PocketLink\'s robots.txt');
});

test('the incident, replayed: once CONNECTED, the domain serves its one store -- never another, never PocketLink', async () => {
  for (const mode of [{ test: true }, { global: true }]) {
    const w = await world({ status: 'connected', ...mode });
    const home = await w.get(`https://${BRAND}/`);
    assert.equal(home.status, 200, JSON.stringify(mode));
    assert.match(home.text, /Brand Shop/);
    assert.doesNotMatch(home.text, /Other Store/);
    for (const c of canonicals(home.text)) assert.ok(c.startsWith(`https://${BRAND}`), `${JSON.stringify(mode)}: canonical ${c}`);
    const other = await w.get(`https://${BRAND}/otherstore`);
    assert.equal(other.status === 200 && /Other Store/.test(other.text), false, `${JSON.stringify(mode)}: another store is never served`);
  }
});

test('www.seniqify.store serves stores exactly as before -- with the merchant domain attached, and without the variable', async () => {
  for (const extra of [{}, { VERCEL_PROJECT_PRODUCTION_URL: '' }, { VERCEL_PROJECT_PRODUCTION_URL: 'www.seniqify.store' }]) {
    const w = await world({ status: 'ready', test: true, extra });
    const r = await w.get('https://www.seniqify.store/otherstore');
    assert.equal(r.status, 200);
    assert.match(r.text, /Other Store/);
    assert.deepEqual(canonicals(r.text), ['https://www.seniqify.store/otherstore'], 'its own canonical, as before');
    assert.equal(resolvesOf(w.supabase, 'www.seniqify.store'), 0, 'never looked up as a merchant domain');
  }
});

test('PocketLink itself is untouched: www.pocketlink.store renders the store with its PocketLink canonical', async () => {
  const w = await world({ status: 'connected', test: true });
  const r = await w.get('https://www.pocketlink.store/brandshop');
  assert.equal(r.status, 200);
  assert.deepEqual(canonicals(r.text), ['https://www.pocketlink.store/brandshop'], 'test mode never moves PocketLink\'s canonical');
});

test('no code trusts VERCEL_PROJECT_PRODUCTION_URL', () => {
  const files = ['middleware.js'];
  (function walk(dir) {
    for (const f of readdirSync(join(ROOT, dir))) {
      const p = `${dir}/${f}`;
      if (statSync(join(ROOT, p)).isDirectory()) walk(p);
      else if (/\.(js|mjs|ts)$/.test(f)) files.push(p);
    }
  })('api');
  for (const f of files) {
    const code = read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    assert.doesNotMatch(code, /VERCEL_PROJECT_PRODUCTION_URL/, f);
  }
});
