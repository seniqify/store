// PR-D.2: the pilot-store gate on the merchant domain API.
//
// CUSTOM_DOMAINS_PILOT_STORES lists the exact store slugs that may use
// POST /api/domains/manage while CUSTOM_DOMAINS_ENABLED is on. Any other store
// gets { outcome: 'feature_disabled' } -- the flag-off answer -- for every action,
// before its PIN is checked and before any database, DNS, Vercel or WhatsApp call.
//
// Same fakes and the same real PR-B + PR-B.1 schema (PGlite) as
// tests/custom-domains-server.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { freshDb } from './helpers/domainDb.mjs';
import {
  ENV_ON, createTimeline, createPostgrestShim, createVercelFake, createDnsFake, createWhatsAppFake, routeFetch,
} from './helpers/domainServerFakes.mjs';
import { ANON } from '../api/meta/_meta.js';
import { domainsConfig } from '../api/domains/_config.js';
import { handleManage, buildDeps } from '../api/domains/manage.js';
import { pilotStores, isPilotStore } from '../api/domains/_auth.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const pg = await freshDb({ lease: true });
const PIN = crypto.createHash('sha256').update('snq1_2580').digest('hex');
const STORES = ['showme', 'showme2', 'myshowme', 'otherstore'];
for (const slug of STORES) {
  await pg.query('insert into public.stores (slug, config) values ($1, $2)', [slug, JSON.stringify({ businessName: slug, ownerPhone: '919876543210' })]);
}
const ACTIONS = {
  status: {},
  claim: { hostname: 'pilot-brand.com' },
  verify: {},
  refresh: {},
  request_otp: { otpAction: 'activate' },
  activate: { challengeId: '00000000-0000-0000-0000-000000000000', code: '123456' },
  set_primary: { hostname: 'www.pilot-brand.com', challengeId: '00000000-0000-0000-0000-000000000000', code: '123456' },
  disconnect: {},
};

function world({ list, enabled = true } = {}) {
  const env = { ...ENV_ON, ...(enabled ? {} : { CUSTOM_DOMAINS_ENABLED: '' }), ...(list === undefined ? {} : { CUSTOM_DOMAINS_PILOT_STORES: list }) };
  const timeline = createTimeline();
  const shim = createPostgrestShim(pg, { timeline, pins: new Map(STORES.map((s) => [s, PIN])), anonKey: ANON });
  const vercel = createVercelFake({ timeline });
  const dns = createDnsFake({ timeline });
  const wa = createWhatsAppFake({ timeline });
  const counter = { n: 0 };
  const fetchImpl = routeFetch({ shim, vercel, whatsapp: wa, counter });
  const deps = { ...buildDeps(domainsConfig(env), fetchImpl), dnsOptions: { resolveTxt: dns.resolveTxt, timeoutMs: 150 } };
  const call = (slug, action, { hashedPin = PIN, extra = ACTIONS[action] } = {}) => handleManage(
    { method: 'POST', headers: { 'content-type': 'application/json', 'x-real-ip': '203.0.113.7' }, body: { action, slug, hashedPin, ...extra } },
    { env, fetchImpl, deps });
  return { env, shim, dns, wa, counter, call };
}

const domainRows = async () => {
  const counts = {};
  for (const t of ['store_domains', 'store_domain_challenges', 'store_domain_events', 'store_domain_reconcile']) {
    counts[t] = Number((await pg.query(`select count(*)::int as n from public.${t}`)).rows[0].n);
  }
  return counts;
};

/** A refusal that touched nothing: no PIN check, no database, Vercel, WhatsApp or DNS call. */
async function assertRefusedUntouched(w, slug, what) {
  const before = await domainRows();
  for (const action of Object.keys(ACTIONS)) {
    const r = await w.call(slug, action);
    assert.deepEqual([r.status, r.body], [200, { outcome: 'feature_disabled' }], `${what}: ${action}`);
  }
  assert.equal(w.counter.n, 0, `${what}: no outbound call at all (PIN check, database, Vercel, WhatsApp)`);
  assert.equal(w.shim.seenPinCalls.length, 0, `${what}: PIN never checked`);
  assert.equal(w.dns.lookups.length, 0, `${what}: no DNS lookup`);
  assert.equal(w.wa.sends.length, 0, `${what}: no OTP sent`);
  assert.deepEqual(await domainRows(), before, `${what}: no domain row written`);
}

test('flag off: feature_disabled, unchanged -- even for a listed store', async () => {
  const w = world({ enabled: false, list: 'showme' });
  await assertRefusedUntouched(w, 'showme', 'flag off');
});

test('flag on, list unset, empty or blank: every store is refused, for every action, touching nothing', async () => {
  for (const list of [undefined, '', '   ', ',', ' , , ']) {
    for (const slug of ['showme', 'otherstore']) {
      await assertRefusedUntouched(world({ list }), slug, `list ${JSON.stringify(list)}, ${slug}`);
    }
  }
});

test('list=showme: showme reaches the existing PIN-authenticated flow, for every action', async () => {
  const w = world({ list: 'showme' });
  const bad = await w.call('showme', 'status', { hashedPin: 'f'.repeat(64) });
  assert.deepEqual([bad.status, bad.body.outcome], [403, 'unauthorized'], 'a wrong PIN is refused by the PIN check, as before');
  for (const action of Object.keys(ACTIONS)) {
    const r = await w.call('showme', action);
    assert.notEqual(r.body.outcome, 'feature_disabled', `${action} reached the domain flow`);
    assert.notEqual(r.status, 403, `${action}: the correct PIN passed`);
  }
  assert.ok(w.shim.seenPinCalls.every((c) => c.slug === 'showme') && w.shim.seenPinCalls.length >= 9);
  const claimed = (await pg.query(`select count(*)::int as n from public.store_domains where store_slug = 'showme'`)).rows[0].n;
  assert.ok(claimed > 0, 'the existing flow really ran (claim wrote its rows)');
});

test('another valid store with the correct PIN: feature_disabled for every action, touching nothing', async () => {
  for (const slug of ['otherstore', 'showme2', 'myshowme']) {
    await assertRefusedUntouched(world({ list: 'showme' }), slug, `list showme, ${slug}`);
  }
});

test('exact slugs: trimmed and lowercased; anything cleanSlug would change is ignored; no prefix, suffix or wildcard', async () => {
  const cases = [
    ['showme', ['showme']], ['SHOWME', ['showme']], ['  showme  ', ['showme']], [' ShowMe , otherstore ', ['showme', 'otherstore']],
    ['showme2', ['showme2']], ['myshowme', ['myshowme']],
    ['*', []], ['*showme', []], ['show*', []], ['showme*', []], ['show me', []], ['.showme', []], ['showme.', []],
    ['show_me', []], ['showme/x', []], ['%73howme', []], ['s'.repeat(61), []],
    ['*, showme', ['showme']],
  ];
  for (const [list, expected] of cases) {
    assert.deepEqual([...pilotStores({ CUSTOM_DOMAINS_PILOT_STORES: list })].sort(), [...expected].sort(), JSON.stringify(list));
  }
  for (const [slug, list, ok] of [
    ['showme', 'showme', true], ['showme2', 'showme', false], ['myshowme', 'showme', false],
    ['showme', 'showme2', false], ['showme', 'myshowme', false], ['showme', 'show', false], ['', 'showme', false],
  ]) {
    assert.equal(isPilotStore(slug, { CUSTOM_DOMAINS_PILOT_STORES: list }), ok, `${slug} in "${list}"`);
  }
  // Through the endpoint: normalised list entries and the request's own (existing) slug cleaning.
  for (const list of ['SHOWME', '  showme  ', 'otherstore,showme']) {
    const r = await world({ list }).call('showme', 'status');
    assert.notEqual(r.body.outcome, 'feature_disabled', `list ${JSON.stringify(list)}`);
  }
  assert.notEqual((await world({ list: 'showme' }).call('SHOWME', 'status')).body.outcome, 'feature_disabled', 'the request slug is cleaned as before');
  for (const list of ['*', 'show*', '*showme', 'showme2', 'myshowme']) {
    await assertRefusedUntouched(world({ list }), 'showme', `list ${JSON.stringify(list)}`);
  }
});

test('one gate in one place, server-only: never in browser code', () => {
  const manage = read('api/domains/manage.js');
  assert.equal((manage.match(/isPilotStore\(/g) || []).length, 1, 'exactly one gate, in handleManage, before every action');
  assert.ok(manage.indexOf('isPilotStore(slug, env)') < manage.indexOf('verifyOwnerPin({'), 'before the PIN check');
  assert.ok(manage.indexOf('isPilotStore(slug, env)') < manage.indexOf('createDomainService('), 'before any domain work');
  const sources = [];
  const walk = (dir) => {
    for (const f of readdirSync(join(ROOT, dir))) {
      const rel = `${dir}/${f}`;
      if (statSync(join(ROOT, rel)).isDirectory()) walk(rel);
      else if (/\.(m?js|jsx)$/.test(f)) sources.push(rel);
    }
  };
  walk('api'); walk('src');
  const code = (f) => read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const readers = sources.filter((f) => code(f).includes('CUSTOM_DOMAINS_PILOT_STORES'));
  assert.deepEqual(readers, ['api/domains/_auth.js'], 'one parser');
  assert.equal(sources.filter((f) => f.startsWith('src/') && read(f).includes('CUSTOM_DOMAINS_PILOT')).length, 0, 'not in browser code');
});
