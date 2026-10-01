// Custom-domain server integration (PR-C). No real DNS, Vercel, WhatsApp or
// Supabase is touched: every external system is a deterministic fake, and the
// database is the REAL PR-B + PR-B.1 schema running in PGlite behind a
// PostgREST shim (tests/helpers/domainServerFakes.mjs) -- so every refusal,
// fence, TTL, lease and challenge rule asserted here is enforced by the SQL.
// (Real multi-connection locking is tested separately against PostgreSQL:
// tests/custom-domains-lease-pg.test.mjs.)
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { freshDb } from './helpers/domainDb.mjs';
import {
  SB, SERVICE_KEY, PROJECT_ID, TEAM_ID, VERCEL_TOKEN, OTP_SECRET, WA_URL, WA_KEY, CRON_SECRET, ENV_ON,
  createTimeline, createPostgrestShim, createVercelFake, createDnsFake, createWhatsAppFake, routeFetch,
} from './helpers/domainServerFakes.mjs';

import { ANON } from '../api/meta/_meta.js';
import { domainsConfig, missingConfig } from '../api/domains/_config.js';
import { classifyHostname, normalizeHostInput, txtNameForRows, safeVerificationChallenges } from '../api/domains/_parse.js';
import { lookupTxt, proveTxtToken, DNS_TIMEOUT_MS } from '../api/domains/_dns.js';
import { createVercelClient, VERCEL_DELETE_TIMEOUT_MS, VERCEL_TIMEOUT_MS } from '../api/domains/_vercel.js';
import { otpHash, generateOtp, normalizeOwnerPhone, maskPhone } from '../api/domains/_otp.js';
import { releaseRow, attachRow, healthCheck, syncGroup } from '../api/domains/_steps.js';
import { createBudget, MIN_STEP_MS, RECORD_RESERVE_MS } from '../api/domains/_budget.js';
import { createDomainDb } from '../api/domains/_db.js';
import { verifyOwnerPin } from '../api/domains/_auth.js';
import { reconcile, RECONCILE_BUDGET_MS } from '../api/domains/_reconcile.js';
import { handleManage, buildDeps, withBudget, REQUEST_BUDGET_MS } from '../api/domains/manage.js';
import { handleReconcile } from '../api/domains/reconcile.js';

const read = (p) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), 'utf8');
const pg = await freshDb({ lease: true });

// ── world: one set of fakes over the shared database ────────────────────────
let seq = 0;
// The reconciler works on EVERY group in the database, so tests that run it get
// a database of their own (isolated); the rest share one.
// Every store a test creates is listed in CUSTOM_DOMAINS_PILOT_STORES, so the
// domain flow is reachable; the pilot gate itself is tested in
// tests/custom-domains-pilot-stores.test.mjs.
async function world({ env: baseEnv = ENV_ON, isolated = false } = {}) {
  const env = { ...baseEnv };
  const db = isolated ? await freshDb({ lease: true }) : pg;
  const timeline = createTimeline();
  const pins = new Map();
  const shim = createPostgrestShim(db, { timeline, pins, anonKey: ANON });
  const vercel = createVercelFake({ timeline });
  const dns = createDnsFake({ timeline });
  const wa = createWhatsAppFake({ timeline });
  const counter = { n: 0 };
  const fetchImpl = routeFetch({ shim, vercel, whatsapp: wa, counter });
  const cfg = domainsConfig(env);
  const deps = { ...buildDeps(cfg, fetchImpl), dnsOptions: { resolveTxt: dns.resolveTxt, timeoutMs: 150 } };
  return { pg: db, env, timeline, pins, shim, vercel, dns, wa, counter, fetchImpl, cfg, deps };
}
const hashPin = (pin) => crypto.createHash('sha256').update(`snq1_${pin}`).digest('hex');
async function store(w, { ownerPhone = '919876543210', pin = '2580' } = {}) {
  const slug = `st${++seq}`;
  await w.pg.query('insert into public.stores (slug, config) values ($1, $2)',
    [slug, JSON.stringify(ownerPhone === null ? { businessName: slug } : { businessName: slug, ownerPhone })]);
  w.pins.set(slug, hashPin(pin));
  w.env.CUSTOM_DOMAINS_PILOT_STORES = [w.env.CUSTOM_DOMAINS_PILOT_STORES, slug].filter(Boolean).join(',');
  return { slug, hashedPin: hashPin(pin) };
}
const host = (label = 'brand') => `${label}${++seq}.com`;
const JSON_HEADERS = { 'content-type': 'application/json' };
const call = (w, s, action, extra = {}, headers = { 'x-real-ip': '203.0.113.7' }) =>
  handleManage({ method: 'POST', headers: { ...JSON_HEADERS, ...headers },
                 body: { action, slug: s.slug, hashedPin: s.hashedPin, ...extra } },
    { env: w.env, fetchImpl: w.fetchImpl, deps: w.deps });
const api = async (...a) => (await call(...a)).body;
const lastCode = (w) => w.wa.sends.at(-1)?.code;
const rowsOf = async (w, slug) => (await w.pg.query(
  `select hostname, kind, role, status, vercel_state, end_reason from public.store_domains
    where store_slug = $1 and status not in ('disconnected', 'expired') order by kind`, [slug])).rows;
const settle = (w, slug) => w.pg.query(
  `update public.store_domains set vercel_state_at = vercel_state_at - interval '3 minutes'
    where store_slug = $1 and vercel_state_at is not null and status not in ('disconnected', 'expired')`, [slug]);
const expireNow = (w, slug) => w.pg.query(
  `update public.store_domains set expires_at = now() - interval '1 second'
    where store_slug = $1 and status in ('pending', 'verified', 'ready', 'misconfigured')`, [slug]);
const runReconcile = (w, opts) => reconcile(w.deps, opts);
/** Let 120 s pass for the leases: every live lease lapses, and the reconciler may serve a group again. */
const expireLeases = (w) => w.pg.query(
  `update public.store_domain_reconcile
      set lease_until = case when lease_until is null then null else now() - interval '1 second' end,
          last_reconciled_at = last_reconciled_at - interval '121 seconds'`);
/** A lease on a group, as a worker would hold it; returns the token. */
async function leaseOf(w, g) {
  const l = await w.deps.db.groupLease(g.group_id, g.store_slug);
  assert.equal(l.outcome, 'leased', JSON.stringify(l));
  return l.lease_token;
}
const liveLeases = async (w) => (await w.pg.query(
  'select count(*)::int as n from public.store_domain_reconcile where lease_until > now()')).rows[0].n;
async function waitFor(cond, what = 'condition') {
  for (let i = 0; i < 2000 && !cond(); i++) await new Promise((r) => setTimeout(r, 2));
  assert.ok(cond(), `timed out waiting for ${what}`);
}
function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}
/** Make a connected group's hourly health check due. */
const makeHealthDue = (w, slug) => w.pg.query(
  `update public.store_domains set last_checked_at = now() - interval '61 minutes'
    where store_slug = $1 and status in ('connected', 'misconfigured')`, [slug]);

/** claim -> TXT published -> verify -> DNS pointed -> refresh (ready). */
async function readyDomain(w, s, h = host()) {
  const c = await api(w, s, 'claim', { hostname: h });
  assert.equal(c.outcome, 'claimed', JSON.stringify(c));
  w.dns.publish(c.domain.txt.name, c.domain.txt.value);
  const v = await api(w, s, 'verify');
  assert.equal(v.outcome, 'verified', JSON.stringify(v));
  w.vercel.dnsReady(...c.domain.hostnames.map((x) => x.hostname));
  const r = await api(w, s, 'refresh');
  assert.equal(r.domain.status, 'ready', JSON.stringify(r));
  return { host: h, claim: c, txt: c.domain.txt };
}
async function connectedDomain(w, s, h) {
  const d = await readyDomain(w, s, h);
  const o = await api(w, s, 'request_otp', { otpAction: 'activate' });
  assert.equal(o.outcome, 'otp_sent', JSON.stringify(o));
  const a = await api(w, s, 'activate', { challengeId: o.challenge_id, code: lastCode(w) });
  assert.equal(a.outcome, 'connected', JSON.stringify(a));
  return d;
}
async function captureLogs(fn) {
  const lines = [];
  const orig = { log: console.log, error: console.error, warn: console.warn, info: console.info };
  for (const k of Object.keys(orig)) console[k] = (...a) => lines.push(a.map(String).join(' '));
  try { await fn(); } finally { Object.assign(console, orig); }
  return lines.join('\n');
}
/** Every Vercel add/DELETE must be IMMEDIATELY preceded by an 'ok' intent for the same host. */
function assertFenced(timeline) {
  timeline.forEach((e, i) => {
    if (e.kind !== 'vercel' || (e.op !== 'add' && e.op !== 'remove')) return;
    const prev = timeline[i - 1];
    assert.ok(prev && prev.kind === 'db' && prev.fn === 'domain_leased_vercel_intent', `${e.op} ${e.host} not preceded by an intent`);
    assert.equal(prev.host, e.host);
    assert.equal(prev.intent, e.op === 'add' ? 'add' : 'remove');
    assert.equal(prev.outcome, 'ok');
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Domain parsing (public-suffix aware)
// ═══════════════════════════════════════════════════════════════════════════

test('parser: the public suffix list decides apex / www / subdomain -- never the number of dots', () => {
  const cases = [
    ['brand.com',          'apex',      'brand.com',       ['brand.com', 'www.brand.com'],       '_pocketlink.brand.com'],
    ['brand.co.in',        'apex',      'brand.co.in',     ['brand.co.in', 'www.brand.co.in'],   '_pocketlink.brand.co.in'],
    ['brand.co.uk',        'apex',      'brand.co.uk',     ['brand.co.uk', 'www.brand.co.uk'],   '_pocketlink.brand.co.uk'],
    ['www.brand.com',      'www',       'brand.com',       ['brand.com', 'www.brand.com'],       '_pocketlink.brand.com'],
    ['www.brand.co.in',    'www',       'brand.co.in',     ['brand.co.in', 'www.brand.co.in'],   '_pocketlink.brand.co.in'],
    ['shop.brand.com',     'subdomain', 'brand.com',       ['shop.brand.com'],                   '_pocketlink.shop.brand.com'],
    ['shop.brand.co.uk',   'subdomain', 'brand.co.uk',     ['shop.brand.co.uk'],                 '_pocketlink.shop.brand.co.uk'],
    ['a.b.brand.com',      'subdomain', 'brand.com',       ['a.b.brand.com'],                    '_pocketlink.a.b.brand.com'],
  ];
  for (const [input, kind, registrable, hostnames, txt] of cases) {
    const c = classifyHostname(input);
    assert.deepEqual([c.kind, c.registrable, c.hostnames, c.txtName], [kind, registrable, hostnames, txt], input);
  }
  // Three labels each -- one is an apex, one is a subdomain.
  assert.equal(classifyHostname('brand.co.in').kind, 'apex');
  assert.equal(classifyHostname('shop.brand.com').kind, 'subdomain');
});

test('parser: IDN becomes punycode; junk, IPs, ports, paths and unknown suffixes are refused', () => {
  const idn = classifyHostname('пример.рф');
  assert.deepEqual([idn.kind, idn.host, idn.txtName], ['apex', 'xn--e1afmkfd.xn--p1ai', '_pocketlink.xn--e1afmkfd.xn--p1ai']);
  assert.equal(classifyHostname('www.xn--80ak6aa92e.com').kind, 'www');
  assert.equal(normalizeHostInput('  HTTPS://Brand.COM/ '), 'brand.com');
  assert.equal(normalizeHostInput('brand.com.'), 'brand.com');
  for (const bad of ['', '1.2.3.4', 'brand.com:443', 'brand.com/shop', 'user@brand.com', 'br and.com', 'bad_host.com', '-brand.com', 'localhost']) {
    assert.equal(classifyHostname(bad).ok, false, bad);
  }
  assert.equal(classifyHostname('brand.notarealtld').reason, 'unknown_suffix');
  assert.equal(txtNameForRows([{ hostname: 'brand.com', kind: 'apex' }, { hostname: 'www.brand.com', kind: 'www' }]), '_pocketlink.brand.com');
  assert.equal(txtNameForRows([{ hostname: 'shop.brand.com', kind: 'subdomain' }]), '_pocketlink.shop.brand.com');
});

// ═══════════════════════════════════════════════════════════════════════════
// DNS TXT ownership
// ═══════════════════════════════════════════════════════════════════════════

test('DNS: only an exact whole-record match proves ownership; every failure is a non-pass', async () => {
  const dns = createDnsFake();
  const token = 'a'.repeat(32);
  const prove = (name, t = token) => proveTxtToken(name, t, { resolveTxt: dns.resolveTxt, timeoutMs: 100 });

  dns.publish('_pocketlink.ok.com', token);
  assert.deepEqual(await prove('_pocketlink.ok.com'), { proved: true, token });

  dns.publish('_pocketlink.multi.com', 'v=spf1 -all', 'google-site-verification=x', token);
  assert.equal((await prove('_pocketlink.multi.com')).proved, true, 'one of several TXT records');

  dns.records.set('_pocketlink.chunk.com', [['aaaaaaaaaaaaaaaa', 'aaaaaaaaaaaaaaaa']]);
  assert.equal((await prove('_pocketlink.chunk.com')).proved, true, 'multi-string TXT is joined');

  dns.publish('_pocketlink.wrong.com', 'b'.repeat(32), `${token} `, `prefix-${token}`, token.toUpperCase());
  assert.deepEqual(await prove('_pocketlink.wrong.com'), { proved: false, status: 'token_mismatch' });

  assert.deepEqual(await prove('_pocketlink.missing.com'), { proved: false, status: 'nxdomain' });
  dns.records.set('_pocketlink.nodata.com', { error: 'ENODATA' });
  assert.deepEqual(await prove('_pocketlink.nodata.com'), { proved: false, status: 'no_txt' });
  dns.records.set('_pocketlink.slow.com', { hang: true });
  assert.deepEqual(await prove('_pocketlink.slow.com'), { proved: false, status: 'timeout' });
  dns.records.set('_pocketlink.broken.com', { error: 'ESERVFAIL' });
  assert.deepEqual(await prove('_pocketlink.broken.com'), { proved: false, status: 'error' });
  assert.deepEqual(await prove('_pocketlink.ok.com', 'not-a-token'), { proved: false, status: 'bad_request' });
  assert.ok(DNS_TIMEOUT_MS <= 10000);
  assert.deepEqual(await lookupTxt('_pocketlink.chunk.com', { resolveTxt: dns.resolveTxt }), { status: 'found', values: [token] });
});

test('DNS: the TXT record lives at _pocketlink.<registrable> for apex/www and _pocketlink.<host> for a subdomain', async () => {
  const w = await world();
  const sApex = await store(w);
  const cApex = await api(w, sApex, 'claim', { hostname: `www.${host('loc')}` });
  assert.equal(cApex.domain.txt.name, `_pocketlink.${cApex.domain.hostnames.find((x) => x.kind === 'apex').hostname}`);

  const sSub = await store(w);
  const sub = `shop.${host('loc')}`;
  const cSub = await api(w, sSub, 'claim', { hostname: sub });
  assert.equal(cSub.domain.txt.name, `_pocketlink.${sub}`);

  // Published at the wrong place -> not proved.
  w.dns.publish(`_pocketlink.${sub.slice(5)}`, cSub.domain.txt.value);
  assert.equal((await api(w, sSub, 'verify')).outcome, 'txt_not_found');
  w.dns.publish(`_pocketlink.${sub}`, cSub.domain.txt.value);
  assert.equal((await api(w, sSub, 'verify')).outcome, 'verified');
});

test('verification requires a live TXT lookup; timeout, NXDOMAIN and a wrong value never verify', async () => {
  const w = await world();
  const s = await store(w);
  const c = await api(w, s, 'claim', { hostname: host('live') });
  const name = c.domain.txt.name;
  for (const [setup, status] of [
    [() => w.dns.unpublish(name), 'nxdomain'],
    [() => w.dns.records.set(name, { hang: true }), 'timeout'],
    [() => w.dns.records.set(name, { error: 'EREFUSED' }), 'error'],
    [() => w.dns.publish(name, 'f'.repeat(32)), 'token_mismatch'],
  ]) {
    setup();
    const v = await api(w, s, 'verify');
    assert.deepEqual([v.outcome, v.dns], ['txt_not_found', status]);
    assert.deepEqual((await rowsOf(w, s.slug)).map((r) => r.status), ['pending', 'pending']);
  }
  const lookupsBefore = w.dns.lookups.length;
  w.dns.publish(name, c.domain.txt.value);
  assert.equal((await api(w, s, 'verify')).outcome, 'verified');
  assert.equal(w.dns.lookups.length, lookupsBefore + 1, 'a fresh lookup, not a remembered answer');
});

// ═══════════════════════════════════════════════════════════════════════════
// The Vercel client contract
// ═══════════════════════════════════════════════════════════════════════════

test('Vercel client: project-scoped calls, teamId, raw facts, and no token in any result', async () => {
  const fake = createVercelFake();
  const v = createVercelClient({ token: VERCEL_TOKEN, projectId: PROJECT_ID, teamId: TEAM_ID, fetchImpl: fake.handle });
  const h = host('vc');
  assert.deepEqual(await v.inspect(h), { attached: false });
  assert.deepEqual(await v.add(h), { result: 'attached', verified: true, verification: [] });
  assert.deepEqual(await v.add(h), { result: 'already_attached', verified: true, verification: [] }, 'same project: idempotent (Vercel 400)');
  assert.deepEqual(await v.inspect(h), { attached: true, verified: true, verification: [] });
  fake.knobs.misconfigured.set(h, true);
  assert.equal((await v.facts(h)).misconfigured, true);
  fake.knobs.misconfigured.set(h, null);                      // field missing in the response
  assert.equal((await v.facts(h)).misconfigured, null);
  fake.knobs.misconfigured.set(h, false);
  const f = await v.facts(h);
  assert.deepEqual([f.attached, f.verified, f.misconfigured], [true, true, false]);
  assert.deepEqual(f.recommended, { cname: 'cname.vercel-dns.com.', ipv4: ['76.76.21.21'] });

  const other = host('vc');
  fake.foreign.add(other);
  assert.deepEqual(await v.add(other), { result: 'conflict', reason: 'vercel_conflict' });
  assert.equal(fake.project.has(other), false);

  assert.deepEqual(await v.remove(h), { result: 'removed' });
  assert.deepEqual(await v.remove(h), { result: 'absent' }, 'DELETE 404 = already absent = success');

  for (const c of fake.calls) assert.ok(c.host);
  const everything = JSON.stringify([await v.inspect(h), await v.add(other), await v.remove(h)]);
  assert.equal(everything.includes(VERCEL_TOKEN), false);
});

test('Vercel client: timeouts are unknown (never success), and DELETE is bounded far inside the 2-minute fence', async () => {
  assert.ok(VERCEL_DELETE_TIMEOUT_MS <= 30000 && VERCEL_DELETE_TIMEOUT_MS >= 15000);
  assert.ok(VERCEL_DELETE_TIMEOUT_MS < 120000 / 4, 'a quarter of the fence at most');
  assert.ok(VERCEL_TIMEOUT_MS <= 15000);
  const fake = createVercelFake();
  const v = createVercelClient({ token: VERCEL_TOKEN, projectId: PROJECT_ID, teamId: TEAM_ID, fetchImpl: fake.handle,
                                 timeoutMs: 40, deleteTimeoutMs: 60 });
  const h = host('slow');
  fake.project.set(h, { verified: true });
  fake.knobs.hang.add(`DELETE remove:${h}`);
  const t0 = Date.now();
  assert.deepEqual(await v.remove(h), { result: 'unknown', reason: 'vercel_timeout' });
  assert.ok(Date.now() - t0 < 1000, 'the DELETE was abandoned at its own timeout');
  fake.knobs.hang.add(`GET inspect:${h}`);
  assert.deepEqual(await v.inspect(h), { unknown: true, reason: 'vercel_timeout' });
  fake.knobs.status.set(`GET config:${h}`, 500);
  fake.knobs.hang.delete(`GET inspect:${h}`);
  assert.deepEqual(await v.facts(h), { unknown: true, reason: 'vercel_http_500' });
  const unconfigured = createVercelClient({ token: '', projectId: PROJECT_ID, fetchImpl: () => assert.fail('no call') });
  assert.equal(unconfigured.configured, false);
  assert.deepEqual(await unconfigured.remove(h), { result: 'unknown', reason: 'vercel_unconfigured' });
});

// ═══════════════════════════════════════════════════════════════════════════
// Add fencing, ready gate
// ═══════════════════════════════════════════════════════════════════════════

test('add: every Vercel attach is immediately preceded by an ok add intent; nothing unverified is ever attached', async () => {
  const w = await world();
  const s = await store(w);
  const c = await api(w, s, 'claim', { hostname: host('fence') });
  assert.equal((await api(w, s, 'refresh')).outcome, 'not_verified');
  assert.equal(w.vercel.calls.length, 0, 'a pending (unproven) claim never reaches Vercel');
  w.dns.publish(c.domain.txt.name, c.domain.txt.value);
  await api(w, s, 'verify');
  assert.equal(w.vercel.calls.filter((x) => x.kind === 'add').length, 2);
  assertFenced(w.timeline);
});

test('ready gate: attached-but-unverified and verified-but-misconfigured are not ready; BOTH apex and www must be configured', async () => {
  const w = await world();
  const s = await store(w);
  const h = host('gate');
  w.vercel.knobs.verifyOnAdd = false;
  const c = await api(w, s, 'claim', { hostname: h });
  w.dns.publish(c.domain.txt.name, c.domain.txt.value);
  await api(w, s, 'verify');
  w.vercel.dnsReady(h, `www.${h}`);
  let r = await api(w, s, 'refresh');
  assert.equal(r.domain.status, 'verified');
  assert.deepEqual(r.domain.hostnames.map((x) => x.vercel), ['attached_unverified', 'attached_unverified']);

  for (const x of [h, `www.${h}`]) w.vercel.project.get(x).verified = true;
  w.vercel.knobs.misconfigured.set(`www.${h}`, true);
  r = await api(w, s, 'refresh');
  assert.equal(r.domain.status, 'verified', 'www still misconfigured');
  assert.deepEqual(r.domain.hostnames.map((x) => x.vercel), ['configured', 'attached_misconfigured']);
  assert.deepEqual(r.dns_records.map((x) => x.type), ['A', 'CNAME']);

  w.vercel.knobs.misconfigured.set(`www.${h}`, null);           // Vercel omitted the field
  assert.equal((await api(w, s, 'refresh')).domain.status, 'verified', 'unknown is never configured');

  w.vercel.dnsReady(`www.${h}`);
  r = await api(w, s, 'refresh');
  assert.equal(r.domain.status, 'ready');
  assert.deepEqual(r.domain.hostnames.map((x) => x.vercel), ['configured', 'configured']);
});

test('add conflict: a hostname held by another Vercel project fails safely and is never taken or removed', async () => {
  const w = await world({ isolated: true });
  const s = await store(w);
  const h = host('taken');
  w.vercel.foreign.add(`www.${h}`);
  const c = await api(w, s, 'claim', { hostname: h });
  w.dns.publish(c.domain.txt.name, c.domain.txt.value);
  await api(w, s, 'verify');
  w.vercel.dnsReady(h);
  const r = await api(w, s, 'refresh');
  assert.equal(r.domain.status, 'verified', 'never ready while www is held elsewhere');
  const www = (await rowsOf(w, s.slug)).find((x) => x.kind === 'www');
  assert.equal(www.vercel_state, 'removed', 'recorded as absent from THIS project');
  assert.equal(w.vercel.calls.filter((x) => x.kind === 'remove').length, 0);
  assert.equal(w.vercel.foreign.has(`www.${h}`), true);
  // Backoff: the next reconcile does not hammer Vercel with the same add.
  const adds = w.vercel.calls.filter((x) => x.kind === 'add' && x.host === `www.${h}`).length;
  await runReconcile(w);
  assert.equal(w.vercel.calls.filter((x) => x.kind === 'add' && x.host === `www.${h}`).length, adds);
});

test('add: already attached to THIS project is success (idempotent), not an error', async () => {
  const w = await world();
  const s = await store(w);
  const h = host('idem');
  w.vercel.project.set(h, { verified: true });                 // e.g. an earlier attempt succeeded
  const c = await api(w, s, 'claim', { hostname: h });
  w.dns.publish(c.domain.txt.name, c.domain.txt.value);
  w.vercel.dnsReady(h, `www.${h}`);
  await api(w, s, 'verify');
  assert.equal((await api(w, s, 'refresh')).domain.status, 'ready');
  assertFenced(w.timeline);
});

// ═══════════════════════════════════════════════════════════════════════════
// OTP step-up
// ═══════════════════════════════════════════════════════════════════════════

test('OTP goes to the OWNER phone from the store record; a browser-supplied phone is ignored', async () => {
  const w = await world();
  const s = await store(w, { ownerPhone: '919812345678' });
  await readyDomain(w, s);
  const o = await api(w, s, 'request_otp', { otpAction: 'activate', phone: '919000000001', ownerPhone: '919000000002' });
  assert.equal(o.outcome, 'otp_sent');
  assert.equal(w.wa.sends.length, 1);
  assert.equal(w.wa.sends[0].receiver, '919812345678');
  assert.equal(o.sent_to, maskPhone('919812345678'));
  assert.equal(JSON.stringify(o).includes('919812345678'), false, 'the full number is not echoed');
  assert.deepEqual([w.wa.sends[0].url, w.wa.sends[0].minutes, w.wa.sends[0].auth], [WA_URL, '10', `Bearer ${WA_KEY}`]);
  assert.match(w.wa.sends[0].code, /^\d{6}$/);
});

test('OTP: a store without an owner phone gets no code and no challenge', async () => {
  const w = await world();
  const s = await store(w, { ownerPhone: null });
  await readyDomain(w, s);
  assert.equal((await api(w, s, 'request_otp', { otpAction: 'activate' })).outcome, 'owner_phone_missing');
  assert.equal(w.wa.sends.length, 0);
  const n = (await w.pg.query('select count(*)::int as n from public.store_domain_challenges where store_slug = $1', [s.slug])).rows[0].n;
  assert.equal(n, 0);
  assert.equal(normalizeOwnerPhone('+91 98123 45678'), '919812345678');
  assert.equal(normalizeOwnerPhone('9812345678'), '919812345678');
  for (const bad of ['', '12345', '14155550123', '910000000000']) assert.equal(normalizeOwnerPhone(bad), null, bad);
});

test('OTP: only the HMAC is stored; the code appears nowhere in the database or the logs', async () => {
  const w = await world();
  const s = await store(w);
  let code, o;
  const logs = await captureLogs(async () => {
    const d = await readyDomain(w, s);
    o = await api(w, s, 'request_otp', { otpAction: 'activate' });
    code = lastCode(w);
    await api(w, s, 'activate', { challengeId: o.challenge_id, code: '000000' });
    await api(w, s, 'activate', { challengeId: o.challenge_id, code });
    assert.ok(d);
  });
  const ch = (await w.pg.query('select * from public.store_domain_challenges where id = $1', [o.challenge_id])).rows[0];
  const primary = (await rowsOf(w, s.slug)).find((r) => r.role === 'primary').hostname;
  const expected = otpHash(OTP_SECRET, { slug: s.slug, action: 'activate', target: primary, code });
  assert.equal(ch.code_hash, expected);
  assert.notEqual(ch.code_hash, code);
  const everything = JSON.stringify([
    (await w.pg.query('select * from public.store_domain_challenges')).rows,
    (await w.pg.query('select * from public.store_domain_events')).rows,
    (await w.pg.query('select * from public.store_domains')).rows,
  ]);
  assert.equal(everything.includes(`"${code}"`), false);
  for (const secret of [code, expected, OTP_SECRET, VERCEL_TOKEN, SERVICE_KEY, WA_KEY, WA_URL]) {
    assert.equal(logs.includes(secret), false, 'a secret reached the logs');
  }
});

test('OTP: purpose binding, wrong code, expiry, max attempts, single use and the hourly limit are all enforced', async () => {
  const w = await world();
  const s = await store(w);
  const d = await connectedDomain(w, s);

  // A disconnect code cannot set the primary.
  const dis = await api(w, s, 'request_otp', { otpAction: 'disconnect' });
  const disCode = lastCode(w);
  assert.equal((await api(w, s, 'set_primary', { hostname: `www.${d.host}`, challengeId: dis.challenge_id, code: disCode })).outcome,
    'challenge_purpose_mismatch');

  // Wrong code, then locked after five.
  const sp = await api(w, s, 'request_otp', { otpAction: 'set_primary', hostname: `www.${d.host}` });
  const spCode = lastCode(w);
  const wrong = String((Number(spCode) + 1) % 1000000).padStart(6, '1');
  for (let i = 0; i < 4; i++) {
    assert.equal((await api(w, s, 'set_primary', { hostname: `www.${d.host}`, challengeId: sp.challenge_id, code: wrong })).outcome,
      'challenge_wrong_code');
  }
  assert.equal((await api(w, s, 'set_primary', { hostname: `www.${d.host}`, challengeId: sp.challenge_id, code: wrong })).outcome, 'challenge_locked');
  assert.equal((await api(w, s, 'set_primary', { hostname: `www.${d.host}`, challengeId: sp.challenge_id, code: spCode })).outcome, 'challenge_locked');

  // Expiry.
  const sp2 = await api(w, s, 'request_otp', { otpAction: 'set_primary', hostname: `www.${d.host}` });
  const sp2Code = lastCode(w);
  await w.pg.query(`update public.store_domain_challenges set created_at = created_at - interval '11 minutes',
                  expires_at = expires_at - interval '11 minutes' where id = $1`, [sp2.challenge_id]);
  assert.equal((await api(w, s, 'set_primary', { hostname: `www.${d.host}`, challengeId: sp2.challenge_id, code: sp2Code })).outcome,
    'challenge_expired');

  // The hourly limit: five codes per store (activate, disconnect, three set_primary).
  const sp3 = await api(w, s, 'request_otp', { otpAction: 'set_primary', hostname: `www.${d.host}` });
  assert.equal(sp3.outcome, 'otp_sent', 'the fifth code this hour');
  const sends = w.wa.sends.length;
  assert.equal((await api(w, s, 'request_otp', { otpAction: 'set_primary', hostname: `www.${d.host}` })).outcome, 'rate_limited');
  assert.equal(w.wa.sends.length, sends, 'a refused request sends nothing');
  // Single use (in a new hour).
  await w.pg.query(`update public.store_domain_challenges set created_at = created_at - interval '61 minutes',
                  expires_at = expires_at - interval '61 minutes' where store_slug = $1`, [s.slug]);
  const sp4 = await api(w, s, 'request_otp', { otpAction: 'set_primary', hostname: `www.${d.host}` });
  const sp4Code = lastCode(w);
  assert.equal((await api(w, s, 'set_primary', { hostname: `www.${d.host}`, challengeId: sp4.challenge_id, code: sp4Code })).outcome, 'ok');
  const back = await api(w, s, 'request_otp', { otpAction: 'set_primary', hostname: d.host });
  assert.equal((await api(w, s, 'set_primary', { hostname: d.host, challengeId: back.challenge_id, code: lastCode(w) })).outcome, 'ok');
  assert.equal((await api(w, s, 'set_primary', { hostname: `www.${d.host}`, challengeId: sp4.challenge_id, code: sp4Code })).outcome,
    'challenge_used');
  assert.equal(generateOtp(() => 123456), '123456');
});

// ═══════════════════════════════════════════════════════════════════════════
// Activation
// ═══════════════════════════════════════════════════════════════════════════

test('activation: a FRESH TXT lookup is mandatory -- old verification is not enough -- and a failed check spends no code', async () => {
  const w = await world();
  const s = await store(w);
  const d = await readyDomain(w, s);
  const o = await api(w, s, 'request_otp', { otpAction: 'activate' });
  const code = lastCode(w);
  w.dns.unpublish(d.txt.name);                                  // removed after verification
  const lookups = w.dns.lookups.length;
  const a = await api(w, s, 'activate', { challengeId: o.challenge_id, code });
  assert.deepEqual([a.outcome, a.dns], ['txt_not_found', 'nxdomain']);
  assert.equal(w.dns.lookups.length, lookups + 1, 'looked up again at activation');
  const ch = (await w.pg.query('select attempts, consumed_at from public.store_domain_challenges where id = $1', [o.challenge_id])).rows[0];
  assert.deepEqual(ch, { attempts: 0, consumed_at: null }, 'the code was not spent');

  w.dns.publish(d.txt.name, 'f'.repeat(32));
  assert.equal((await api(w, s, 'activate', { challengeId: o.challenge_id, code })).outcome, 'txt_not_found');
  w.dns.publish(d.txt.name, d.txt.value);
  assert.equal((await api(w, s, 'activate', { challengeId: o.challenge_id, code })).outcome, 'connected');
  assert.equal(w.timeline.filter((e) => e.kind === 'db' && e.fn === 'domain_leased_activate').length, 1,
    'domain_activate was only called once the TXT proof was fresh');
});

test('activation: Vercel must report every hostname configured at activation time; a regression spends no code', async () => {
  const w = await world();
  const s = await store(w);
  const d = await readyDomain(w, s);
  const o = await api(w, s, 'request_otp', { otpAction: 'activate' });
  const code = lastCode(w);
  w.vercel.knobs.misconfigured.set(`www.${d.host}`, true);       // DNS broke after "ready"
  const a = await api(w, s, 'activate', { challengeId: o.challenge_id, code });
  assert.equal(a.outcome, 'vercel_not_ready');
  assert.equal(a.domain.status, 'verified', 'demoted by the database');
  w.vercel.knobs.hang.add(`GET inspect:${d.host}`);
  const w2deps = { ...w.deps, vercel: createVercelClient({ token: VERCEL_TOKEN, projectId: PROJECT_ID, teamId: TEAM_ID, fetchImpl: w.fetchImpl, timeoutMs: 40 }) };
  const unknown = await handleManage({ method: 'POST', headers: JSON_HEADERS, body: { action: 'activate', slug: s.slug, hashedPin: s.hashedPin, challengeId: o.challenge_id, code } },
    { env: w.env, fetchImpl: w.fetchImpl, deps: w2deps });
  assert.equal(unknown.body.outcome, 'vercel_unavailable', 'an unanswered Vercel call is never a pass');
  w.vercel.knobs.hang.delete(`GET inspect:${d.host}`);
  const ch = (await w.pg.query('select attempts, consumed_at from public.store_domain_challenges where id = $1', [o.challenge_id])).rows[0];
  assert.deepEqual(ch, { attempts: 0, consumed_at: null });
  w.vercel.dnsReady(`www.${d.host}`);
  assert.equal((await api(w, s, 'activate', { challengeId: o.challenge_id, code })).outcome, 'connected',
    'activation re-checks Vercel, re-marks ready, then connects');
});

test('after connection the TXT record need not stay published; health checks never look at it', async () => {
  const w = await world({ isolated: true });
  const s = await store(w);
  const d = await connectedDomain(w, s);
  w.dns.unpublish(d.txt.name);
  const lookups = w.dns.lookups.length;
  await makeHealthDue(w, s.slug);
  const r = await runReconcile(w);
  assert.deepEqual([r.health, r.health_no_verdict], [1, 0]);
  assert.equal(w.dns.lookups.length, lookups, 'no DNS lookup in a health check');
  assert.deepEqual((await rowsOf(w, s.slug)).map((x) => x.status), ['connected', 'connected']);
  assert.equal((await api(w, s, 'status')).domain.txt, null, 'no TXT instructions once connected');
});

// ═══════════════════════════════════════════════════════════════════════════
// Disconnect, DELETE fencing, reconciler
// ═══════════════════════════════════════════════════════════════════════════

test('disconnect: every DELETE is fenced by a fresh remove intent; ownership is kept until the release settles', async () => {
  const w = await world({ isolated: true });
  const [a, b] = [await store(w), await store(w)];
  const d = await connectedDomain(w, a);
  const o = await api(w, a, 'request_otp', { otpAction: 'disconnect' });
  const r = await api(w, a, 'disconnect', { challengeId: o.challenge_id, code: lastCode(w) });
  assert.equal(r.outcome, 'disconnecting', 'Vercel removal done, release still settling');
  assert.ok(r.retry_after_seconds > 0);
  assert.equal(w.vercel.project.has(d.host), false);
  assertFenced(w.timeline);

  assert.equal((await api(w, b, 'claim', { hostname: d.host })).outcome, 'hostname_releasing', 'still exclusive');
  const again = await runReconcile(w);
  assert.deepEqual([again.cleanup, again.cleanup_finished], [1, 0], 'still inside the 2-minute fence');
  await settle(w, a.slug);
  await expireLeases(w);
  const fin = await runReconcile(w);
  assert.equal(fin.cleanup_finished, 1);
  assert.equal((await api(w, a, 'status')).domain, null);
  assert.equal((await api(w, b, 'claim', { hostname: d.host })).outcome, 'claimed', 'released only now');
});

test('DELETE retry: a timed-out DELETE is retried only under a NEW remove intent; 404 counts as absent', async () => {
  const w = await world({ isolated: true });
  const s = await store(w);
  const d = await connectedDomain(w, s);
  w.deps = { ...w.deps, vercel: createVercelClient({ token: VERCEL_TOKEN, projectId: PROJECT_ID, teamId: TEAM_ID,
                                                     fetchImpl: w.fetchImpl, deleteTimeoutMs: 50 }) };
  w.vercel.knobs.hangOnce.add(`DELETE remove:${d.host}`);
  const o = await api(w, s, 'request_otp', { otpAction: 'disconnect' });
  await api(w, s, 'disconnect', { challengeId: o.challenge_id, code: lastCode(w) });
  const apex = () => w.timeline.filter((e) => e.host === d.host);
  assert.equal(apex().filter((e) => e.kind === 'vercel' && e.op === 'remove').length, 1);
  assert.equal((await rowsOf(w, s.slug)).find((x) => x.hostname === d.host).vercel_state, 'removing');

  // Meanwhile the DELETE did land at Vercel after all: the retry now gets 404.
  w.vercel.project.delete(d.host);
  await runReconcile(w);
  const intents = apex().filter((e) => e.kind === 'db' && e.fn === 'domain_leased_vercel_intent' && e.intent === 'remove');
  const deletes = apex().filter((e) => e.kind === 'vercel' && e.op === 'remove');
  assert.equal(intents.length, 2, 'a second, fresh authorisation');
  assert.equal(deletes.length, 2);
  assertFenced(w.timeline);
  assert.equal((await rowsOf(w, s.slug)).find((x) => x.hostname === d.host).vercel_state, 'removed', '404 = absent');
});

test('a stale worker cannot delete after the group has ended', async () => {
  const w = await world({ isolated: true });
  const s = await store(w);
  const d = await connectedDomain(w, s);
  const staleGroup = (await w.deps.db.groupsForStore(s.slug))[0];          // read while connected...
  const staleLease = await leaseOf(w, staleGroup);                          // ...and leased; then it stalls
  await w.deps.db.leaseRelease(staleGroup.group_id, s.slug, staleLease);   // (its lease ends meanwhile)
  const o = await api(w, s, 'request_otp', { otpAction: 'disconnect' });
  await api(w, s, 'disconnect', { challengeId: o.challenge_id, code: lastCode(w) });
  await settle(w, s.slug);
  await runReconcile(w);                                                   // ended
  // A new store now owns the name on Vercel.
  const b = await store(w);
  await connectedDomain(w, b, d.host);
  const deletesBefore = w.vercel.calls.filter((x) => x.kind === 'remove').length;
  // The stale worker still thinks the old group is connected and on Vercel, and still has its token.
  const r = await releaseRow({ ...w.deps, lease: staleLease }, staleGroup, staleGroup.rows.find((x) => x.hostname === d.host));
  assert.deepEqual(r, { host: d.host, refused: 'lease_lost' });
  assert.equal((await w.deps.db.groupLease(staleGroup.group_id, s.slug)).outcome, 'group_ended', 'and no new lease');
  await assert.rejects(releaseRow(w.deps, staleGroup, staleGroup.rows[0]), { code: 'lease_required' });
  assert.equal(w.vercel.calls.filter((x) => x.kind === 'remove').length, deletesBefore, 'no DELETE was sent');
  assert.equal(w.vercel.project.has(d.host), true, "the new owner's domain is untouched");
});

test('a stale worker cannot attach: no Vercel add unless the lease and the add intent are both ok right now', async () => {
  const w = await world();
  const snapshot = async (s) => {
    const c = await api(w, s, 'claim', { hostname: host('stale-add') });
    const g = (await w.deps.db.groupsForStore(s.slug))[0];
    assert.equal((await w.deps.db.markVerified(g.group_id, s.slug, c.domain.txt.value)).outcome, 'verified');
    return (await w.deps.db.groupsForStore(s.slug))[0];            // verified, nothing on Vercel yet
  };
  // Expired by TTL while the worker held its lease: PR-B's own fence refuses.
  const s1 = await store(w);
  const g1 = await snapshot(s1);
  const l1 = await leaseOf(w, g1);
  await expireNow(w, s1.slug);
  assert.deepEqual(await attachRow({ ...w.deps, lease: l1 }, g1, g1.rows[0]), { host: g1.rows[0].hostname, refused: 'expired' });
  // Ended by an admin after the worker's lease had gone: the old token is refused.
  const s2 = await store(w);
  const g2 = await snapshot(s2);
  const l2 = await leaseOf(w, g2);
  await w.deps.db.leaseRelease(g2.group_id, s2.slug, l2);
  const admin = await leaseOf(w, g2);
  assert.equal((await w.deps.db.beginDisconnect(admin, g2.group_id, s2.slug, 'admin')).outcome, 'disconnected');
  assert.deepEqual(await attachRow({ ...w.deps, lease: l2 }, g2, g2.rows[0]), { host: g2.rows[0].hostname, refused: 'lease_lost' });
  // And with no lease at all, nothing is even sent to the database.
  await assert.rejects(attachRow(w.deps, g2, g2.rows[0]), { code: 'lease_required' });
  assert.equal(w.vercel.calls.filter((x) => x.kind === 'add').length, 0, 'no POST was sent');
});

test('reconciler: idempotent -- a second pass over a converged state changes nothing on Vercel', async () => {
  const w = await world({ isolated: true });
  const s = await store(w);
  const c = await api(w, s, 'claim', { hostname: host('idem') });
  w.dns.publish(c.domain.txt.name, c.domain.txt.value);
  w.vercel.knobs.hangOnce.add(`POST add:www.${c.domain.primary_host}`);
  w.deps = { ...w.deps, vercel: createVercelClient({ token: VERCEL_TOKEN, projectId: PROJECT_ID, teamId: TEAM_ID,
                                                     fetchImpl: w.fetchImpl, timeoutMs: 50 }) };
  await api(w, s, 'verify');                               // www's POST hangs -> stays 'adding'
  assert.equal((await rowsOf(w, s.slug)).find((x) => x.kind === 'www').vercel_state, 'adding');
  w.vercel.dnsReady(c.domain.primary_host, `www.${c.domain.primary_host}`);
  const r1 = await runReconcile(w);                        // stale 'adding' retried under a new intent
  assert.equal(r1.marked_ready, 1);
  assertFenced(w.timeline);
  const muts = w.vercel.mutations().filter((x) => x.kind !== 'verify').length;
  await expireLeases(w);
  const r2 = await runReconcile(w);
  assert.equal(r2.sync, 1, 'the ready group was examined again');
  assert.equal(w.vercel.mutations().filter((x) => x.kind !== 'verify').length, muts, 'no add/delete on a converged group');
  assert.equal(r2.errors, 0);
});

test('reconciler: a TTL cleanup group keeps its names until Vercel removal is confirmed and settled', async () => {
  const w = await world({ isolated: true });
  const [a, b] = [await store(w), await store(w)];
  const d = await readyDomain(w, a);
  await expireNow(w, a.slug);
  const r1 = await runReconcile(w);
  assert.ok(r1.expired >= 1);
  assert.deepEqual((await rowsOf(w, a.slug)).map((x) => [x.status, x.end_reason]),
    [['disconnecting', 'verify_ttl'], ['disconnecting', 'verify_ttl']]);
  assert.equal(w.vercel.project.has(d.host), false, 'removed from Vercel in the same pass');
  assert.equal((await api(w, b, 'claim', { hostname: d.host })).outcome, 'hostname_releasing');
  await settle(w, a.slug);
  await expireLeases(w);
  await runReconcile(w);
  const ended = (await w.pg.query('select distinct status, end_reason from public.store_domains where store_slug = $1', [a.slug])).rows;
  assert.deepEqual(ended, [{ status: 'expired', end_reason: 'verify_ttl' }]);
  assert.equal((await api(w, b, 'claim', { hostname: d.host })).outcome, 'claimed');
  assertFenced(w.timeline);
});

// ═══════════════════════════════════════════════════════════════════════════
// Health checks
// ═══════════════════════════════════════════════════════════════════════════

test('health: one failure tolerated, two consecutive -> misconfigured, success resets; recovery needs every hostname configured', async () => {
  const w = await world({ isolated: true });
  const s = await store(w);
  const d = await connectedDomain(w, s);
  const g = async () => (await w.deps.db.groupsForStore(s.slug))[0];
  /** One due, leased, authorised check -- as the reconciler would do an hour later. */
  const check = async (deps = w.deps) => {
    await makeHealthDue(w, s.slug);
    await expireLeases(w);
    const [lease] = await w.deps.db.reconcileLease(1);
    assert.equal(lease.work, 'health');
    return healthCheck({ ...deps, lease: lease.lease_token }, await g());
  };
  w.vercel.knobs.misconfigured.set(`www.${d.host}`, true);
  assert.deepEqual(await check(), { verdict: false, outcome: 'connected', failures: 1 });
  assert.deepEqual(await check(), { verdict: false, outcome: 'misconfigured', failures: 2 });
  w.vercel.knobs.misconfigured.set(d.host, null);             // apex fact now unknown
  w.vercel.dnsReady(`www.${d.host}`);
  assert.equal((await check()).verdict, false, 'a null fact is never healthy');
  assert.deepEqual((await rowsOf(w, s.slug)).map((x) => x.status), ['misconfigured', 'misconfigured']);
  w.vercel.dnsReady(d.host);
  assert.deepEqual(await check(), { verdict: true, outcome: 'connected', failures: 0 });

  // A transport failure is no verdict at all -- not counted either way.
  const slow = { ...w.deps, vercel: createVercelClient({ token: VERCEL_TOKEN, projectId: PROJECT_ID, teamId: TEAM_ID,
                                                         fetchImpl: w.fetchImpl, timeoutMs: 40 }) };
  w.vercel.knobs.hang.add(`GET config:${d.host}`);
  assert.deepEqual(await check(slow), { verdict: null, reason: 'vercel_timeout' });
  const row = (await w.pg.query('select consecutive_health_failures as f from public.store_domains where store_slug = $1 limit 1', [s.slug])).rows[0];
  assert.equal(row.f, 0);
});

test('health results are tied to the lease that authorised them: duplicates and stale results are refused', async () => {
  const w = await world({ isolated: true });
  const s = await store(w);
  const d = await connectedDomain(w, s);
  const g = async () => (await w.deps.db.groupsForStore(s.slug))[0];
  const under = (l) => ({ ...w.deps, lease: l.lease_token });
  const failures = async () => (await w.pg.query(
    'select consecutive_health_failures as f from public.store_domains where store_slug = $1 limit 1', [s.slug])).rows[0].f;
  await makeHealthDue(w, s.slug);
  const [first] = await w.deps.db.reconcileLease(1);
  w.vercel.knobs.misconfigured.set(d.host, true);
  assert.deepEqual(await healthCheck(under(first), await g()), { verdict: false, outcome: 'connected', failures: 1 });
  // The same authorisation again (a retried or duplicated result): refused, not counted twice.
  assert.equal((await healthCheck(under(first), await g())).outcome, 'stale_check');
  assert.equal(await failures(), 1);
  // No lease, or a made-up one: refused.
  assert.deepEqual(await healthCheck(w.deps, await g()), { verdict: null, reason: 'no_lease' });
  const gid = (await g()).group_id;
  assert.equal((await w.deps.db.healthUpdate(crypto.randomUUID(), gid, s.slug, true)).outcome, 'lease_lost');
  // A merchant lease authorises no health result.
  await w.deps.db.leaseRelease(gid, s.slug, first.lease_token);
  const m = await leaseOf(w, await g());
  assert.equal((await w.deps.db.healthUpdate(m, gid, s.slug, true)).outcome, 'stale_check');
  await w.deps.db.leaseRelease(gid, s.slug, m);
  assert.equal(await failures(), 1);
  // Two leases an hour apart: a delayed result from the older can never overwrite the newer --
  // not the verdict, and not even its observations.
  await makeHealthDue(w, s.slug);
  await expireLeases(w);
  const [older] = await w.deps.db.reconcileLease(1);
  await makeHealthDue(w, s.slug);
  await expireLeases(w);
  const [newer] = await w.deps.db.reconcileLease(1);
  assert.notEqual(older.lease_token, newer.lease_token);
  assert.deepEqual(await healthCheck(under(newer), await g()), { verdict: false, outcome: 'misconfigured', failures: 2 });
  w.vercel.dnsReady(d.host);
  assert.deepEqual(await healthCheck(under(older), await g()), { verdict: null, reason: 'lease_lost' }, 'the delayed success is refused');
  assert.deepEqual((await rowsOf(w, s.slug)).map((x) => [x.status, x.vercel_state]),
    [['misconfigured', 'attached_misconfigured'], ['misconfigured', 'configured']]);
});

test('health: the reconciler checks a connected group at most hourly', async () => {
  const w = await world({ isolated: true });
  const s = await store(w);
  await connectedDomain(w, s);
  await makeHealthDue(w, s.slug);
  const r1 = await runReconcile(w);
  assert.equal(r1.health, 1);
  await expireLeases(w);
  const r2 = await runReconcile(w);
  assert.equal(r2.health, 0, 'checked moments ago: not due, not even leased');
  assert.equal(r2.complete, true);
});

// ═══════════════════════════════════════════════════════════════════════════
// Review round 3: 409, verification challenges, budgets, fairness, config
// ═══════════════════════════════════════════════════════════════════════════

test('409 is not proof of absence: a domain already on THIS project is observed, not recorded absent', async () => {
  const w = await world();
  const s = await store(w);
  const h = host('c409');
  w.vercel.foreign.add(`www.${h}`);                          // Vercel answers 409 on add...
  w.vercel.project.set(`www.${h}`, { verified: true });      // ...yet the name IS on our project
  const c = await api(w, s, 'claim', { hostname: h });
  w.dns.publish(c.domain.txt.name, c.domain.txt.value);
  await api(w, s, 'verify');
  const www = (await rowsOf(w, s.slug)).find((x) => x.kind === 'www');
  assert.equal(www.vercel_state, 'attached_misconfigured', 'the real facts were recorded, not "removed"');
  const last = (await w.pg.query('select last_error from public.store_domains where hostname = $1', [`www.${h}`])).rows[0];
  assert.equal(last.last_error, null);
  assertFenced(w.timeline);
});

test('409 with an uncertain inspection writes nothing: the row keeps its add intent and its ownership', async () => {
  const w = await world();
  const s = await store(w);
  const h = host('c409u');
  w.vercel.foreign.add(`www.${h}`);
  w.vercel.knobs.hang.add(`GET inspect:www.${h}`);
  w.deps = { ...w.deps, vercel: createVercelClient({ token: VERCEL_TOKEN, projectId: PROJECT_ID, teamId: TEAM_ID,
                                                     fetchImpl: w.fetchImpl, timeoutMs: 40 }) };
  const c = await api(w, s, 'claim', { hostname: h });
  w.dns.publish(c.domain.txt.name, c.domain.txt.value);
  await api(w, s, 'verify');
  const www = (await rowsOf(w, s.slug)).find((x) => x.kind === 'www');
  assert.equal(www.vercel_state, 'adding', 'no observation was guessed');
  const addAt = w.timeline.findIndex((e) => e.kind === 'vercel' && e.op === 'add' && e.host === `www.${h}`);
  const after = w.timeline.slice(addAt + 1)
    .filter((e) => e.kind === 'db' && e.fn === 'domain_leased_vercel_observe' && e.host === `www.${h}`);
  assert.deepEqual(after, []);
  assert.deepEqual((await rowsOf(w, s.slug)).map((x) => x.status), ['verified', 'verified'], 'still exclusive');
});

test('Vercel verification challenges are returned to the owner -- validated, and only for unverified hostnames', async () => {
  const w = await world();
  const s = await store(w);
  const h = host('vch');
  w.vercel.knobs.verifyOnAdd = false;
  const c = await api(w, s, 'claim', { hostname: h });
  w.dns.publish(c.domain.txt.name, c.domain.txt.value);
  const v = await api(w, s, 'verify');
  assert.deepEqual(v.vercel_verification, [
    { host: h, type: 'TXT', name: `_vercel.${h}`, value: `vc-domain-verify=${h},9f8e7d6c5b4a` },
    { host: `www.${h}`, type: 'TXT', name: `_vercel.${h}`, value: `vc-domain-verify=www.${h},9f8e7d6c5b4a` },
  ]);
  // Hostile or malformed entries from the API never reach the merchant.
  // (Only the first five entries are ever examined -- a bound, not a bug.)
  w.vercel.knobs.verification.set(`www.${h}`, [
    { type: 'CNAME', domain: `_vercel.${h}`, value: 'x' },
    { type: 'TXT', domain: '_vercel.attacker.com', value: 'vc-domain-verify=steal' },
    { type: 'TXT', domain: `_VERCEL.${h}.`, value: 'vc-domain-verify=ok', reason: 'internal detail' },
    { type: 'TXT', domain: `_vercel.${h}`, value: 'has "quotes"' },
    { type: 'TXT', domain: `_vercel.${h}`, value: 'has space' },
    { type: 'TXT', domain: `bad_label.${h}`, value: 'v' },
  ]);
  const r = await api(w, s, 'refresh');
  assert.deepEqual(r.vercel_verification.filter((x) => x.host === `www.${h}`),
    [{ host: `www.${h}`, type: 'TXT', name: `_vercel.${h}`, value: 'vc-domain-verify=ok' }]);
  assert.equal(JSON.stringify(r).includes('internal detail'), false);
  const st = await api(w, s, 'status');
  assert.deepEqual(st.vercel_verification, r.vercel_verification, 'status reads the same challenges live');
  // Once Vercel verifies, there is nothing left to show.
  for (const x of [h, `www.${h}`]) w.vercel.project.get(x).verified = true;
  w.vercel.dnsReady(h, `www.${h}`);
  const done = await api(w, s, 'refresh');
  assert.deepEqual(done.vercel_verification, []);
  assert.equal(done.domain.status, 'ready');
  assert.equal((await api(w, s, 'status')).vercel_verification, undefined);
});

test('safeVerificationChallenges: TXT only, inside the merchant domain, printable, deduplicated, at most three', () => {
  const ok = (v) => ({ type: 'TXT', domain: '_vercel.brand.co.in', value: v });
  assert.deepEqual(safeVerificationChallenges([ok('a'), ok('a'), ok('b'), ok('c'), ok('d')], 'www.brand.co.in').map((x) => x.value),
    ['a', 'b', 'c']);
  assert.deepEqual(safeVerificationChallenges([{ ...ok('a'), domain: '_vercel.co.in' }], 'brand.co.in'), [],
    'a public suffix is not the merchant domain');
  assert.deepEqual(safeVerificationChallenges([{ ...ok('a'), domain: '_vercel.otherbrand.co.in' }], 'brand.co.in'), []);
  assert.deepEqual(safeVerificationChallenges('nope', 'brand.com'), []);
  assert.deepEqual(safeVerificationChallenges([ok('x')], 'not a host'), []);
});

test('config: merchant API and reconciler apply the SAME Vercel validation (a project NAME is refused by both)', async () => {
  const env = { ...ENV_ON, DOMAINS_VERCEL_PROJECT_ID: 'store' };
  const w = await world({ env });
  assert.equal(w.deps.vercel.configured, false, 'buildDeps makes the client inert');
  const s = await store(w);
  const c = await api(w, s, 'claim', { hostname: host('cfg') });
  w.dns.publish(c.domain.txt.name, c.domain.txt.value);
  assert.equal((await api(w, s, 'verify')).outcome, 'verified');
  assert.equal((await api(w, s, 'refresh')).outcome, 'not_configured');
  const r = await handleReconcile({ method: 'POST', headers: { authorization: `Bearer ${CRON_SECRET}` } },
    { env, fetchImpl: w.fetchImpl });
  assert.deepEqual([r.status, r.body.outcome], [503, 'not_configured']);
  assert.equal(w.vercel.calls.length, 0, 'no Vercel call from either path');
});

test('the endpoint requires a JSON body (so any cross-origin browser call needs a preflight that fails)', async () => {
  const w = await world();
  const body = JSON.stringify({ action: 'status', slug: 'x', hashedPin: 'a'.repeat(64) });
  for (const req of [
    { method: 'POST', headers: {}, body: { action: 'status' } },
    { method: 'POST', headers: { 'content-type': 'text/plain' }, body },
    { method: 'POST', headers: { 'content-type': 'application/json' }, body },   // an unparsed string
  ]) {
    const r = await handleManage(req, { env: w.env, fetchImpl: w.fetchImpl });
    assert.deepEqual([r.status, r.body], [415, { outcome: 'json_required' }]);
  }
  assert.equal(w.counter.n, 0);
  const src = read('api/domains/manage.js');
  assert.doesNotMatch(src, /same-origin only/i);
  assert.match(src, /Any HTTP client can reach this endpoint/);
});

test('budget: two deadlines; Vercel, DNS and database calls are capped, and none starts without time for it', async () => {
  let t = 0;
  const b = createBudget({ totalMs: 20000, reserveMs: RECORD_RESERVE_MS, now: () => t });
  assert.deepEqual([b.actionLeft(), b.recordLeft()], [12000, 20000]);
  assert.equal(b.until(15000).hard, 15000);
  assert.equal(b.until(99999).hard, 20000, 'a lease can only shorten a budget');

  const calls = { n: 0 };
  const counting = async () => { calls.n++; return { ok: true, status: 200, json: async () => ({}) }; };
  t = 11000;                                                // 1 s left for external work
  const v = createVercelClient({ token: 't', projectId: PROJECT_ID, fetchImpl: counting }).withBudget(b);
  assert.deepEqual(await v.inspect('brand.com'), { unknown: true, reason: 'budget_exhausted' });
  const dns = await proveTxtToken('_pocketlink.brand.com', 'a'.repeat(32), { resolveTxt: counting, budget: b });
  assert.equal(dns.status, 'budget_exhausted');
  const db = createDomainDb({ url: SB, serviceKey: 'k', fetchImpl: counting }).withBudget(b);
  await db.rpc('domain_expire_stale', { p_limit: 1 });      // recording is still allowed in the reserve
  assert.equal(calls.n, 1);
  t = 19800;                                                // 200 ms before the hard stop
  await assert.rejects(db.rpc('domain_expire_stale', { p_limit: 1 }), { code: 'budget_exhausted' });
  assert.equal(calls.n, 1, 'nothing was sent without time to finish');
  assert.ok(RECONCILE_BUDGET_MS < 60000 && REQUEST_BUDGET_MS < 60000, 'inside maxDuration');
});

test('budget: a step that could not finish is not started -- no intent is taken for it', async () => {
  const w = await world();
  const s = await store(w);
  const c = await api(w, s, 'claim', { hostname: host('bud') });
  const g0 = (await w.deps.db.groupsForStore(s.slug))[0];
  await w.deps.db.markVerified(g0.group_id, s.slug, c.domain.txt.value);   // verified; nothing on Vercel yet
  let t = 0;
  const clocked = async (url, init) => {
    if (init?.method === 'POST' && new URL(url).pathname.endsWith('/domains')) t += 9000;
    return w.fetchImpl(url, init);
  };
  const deps = withBudget(buildDeps(w.cfg, clocked), createBudget({ totalMs: 20000, reserveMs: 8000, now: () => t }));
  const g = (await w.deps.db.groupsForStore(s.slug))[0];
  const r = await syncGroup({ ...deps, lease: await leaseOf(w, g) }, g, { attach: true });
  assert.equal(r.results[0].vercel_state, 'attached_misconfigured', 'first host: added, then observed and recorded');
  assert.deepEqual(r.results[1], { host: g.rows[1].hostname, deferred: true });
  const intents = w.timeline.filter((e) => e.kind === 'db' && e.fn === 'domain_leased_vercel_intent').map((e) => e.host);
  assert.deepEqual(intents, [g.rows[0].hostname], 'no intent for the deferred host');
  assert.ok(MIN_STEP_MS >= 3000);
});

test('fairness: one queue across cleanup, health and sync; every group is served, including after a crash', async () => {
  const w = await world({ isolated: true });
  // One group of each kind of work.
  const sSync = await store(w);
  const cs = await api(w, sSync, 'claim', { hostname: host('fsync') });
  w.dns.publish(cs.domain.txt.name, cs.domain.txt.value);
  await api(w, sSync, 'verify');                                            // verified; DNS never pointed
  const sClean = await store(w);
  await connectedDomain(w, sClean);
  const gc = (await w.deps.db.groupsForStore(sClean.slug))[0];
  const lc = await leaseOf(w, gc);
  await w.deps.db.beginDisconnect(lc, gc.group_id, sClean.slug, 'admin');   // cleanup: Vercel still holds it
  await w.deps.db.leaseRelease(gc.group_id, sClean.slug, lc);
  const sHealth = await store(w);
  await connectedDomain(w, sHealth);
  await makeHealthDue(w, sHealth.slug);

  // A clock that makes each Vercel call cost 6 s: one group per pass.
  let t = 1e12;
  const clocked = async (url, init) => {
    if (new URL(url).hostname === 'api.vercel.com') t += 6000;
    return w.fetchImpl(url, init);
  };
  const deps = { ...buildDeps(w.cfg, clocked), dnsOptions: w.deps.dnsOptions };
  const pass = () => reconcile(deps, { now: () => t, budgetMs: 20000, reserveMs: 8000 });
  const served = async () => (await w.pg.query(
    `select d.store_slug from public.store_domain_reconcile r join public.store_domains d
       on d.group_id = r.group_id and d.role = 'primary' order by r.last_reconciled_at desc nulls last limit 1`)).rows[0].store_slug;

  const order = [];
  for (let i = 0; i < 3; i++) {
    const r = await pass();
    assert.equal(r.leased, 1, `pass ${i + 1} took exactly one group`);
    order.push(await served());
  }
  assert.deepEqual([...order].sort(), [sSync.slug, sClean.slug, sHealth.slug].sort(), 'every kind of work was served');
  const idle = await pass();
  assert.deepEqual([idle.leased, idle.complete], [0, true], 'all three served moments ago: nothing else is eligible');

  // Crash: a worker leases a group and dies. Others carry on; once the lease
  // lapses the crashed group is served again in turn.
  await expireLeases(w);
  await makeHealthDue(w, sHealth.slug);
  const [crashed] = await w.deps.db.reconcileLease(1);                       // the oldest-served group
  assert.equal(crashed.store_slug, order[0]);
  const r1 = await pass();
  assert.equal(r1.leased, 1);
  assert.notEqual(await served(), crashed.store_slug, 'a held lease is never double-served');
  const seen = new Set();
  for (let i = 0; i < 3; i++) {
    await expireLeases(w);
    await makeHealthDue(w, sHealth.slug);
    await pass();
    seen.add(await served());
  }
  assert.ok(seen.has(crashed.store_slug), 'the crashed group was served again within N passes');
});

// ═══════════════════════════════════════════════════════════════════════════
// Review round 4: merchant requests and the reconciler share ONE group lease
// ═══════════════════════════════════════════════════════════════════════════

const callWith = (w, deps, s, action, extra = {}) =>
  handleManage({ method: 'POST', headers: { ...JSON_HEADERS, 'x-real-ip': '203.0.113.7' },
                 body: { action, slug: s.slug, hashedPin: s.hashedPin, ...extra } },
    { env: w.env, fetchImpl: w.fetchImpl, deps });

/**
 * A ready subdomain (one hostname) with an activation code requested -- which
 * Vercel has since dropped: the database still says 'configured'. The next
 * look at Vercel, by anyone, answers "absent".
 */
async function readySubdomainGoneFromVercel(w, s) {
  const h = `shop.${host('race')}`;
  const d = await readyDomain(w, s, h);
  assert.equal(d.claim.domain.hostnames.length, 1, 'a subdomain group has one hostname');
  const o = await api(w, s, 'request_otp', { otpAction: 'activate' });
  assert.equal(o.outcome, 'otp_sent');
  w.vercel.project.delete(h);
  return { h, challengeId: o.challenge_id, code: lastCode(w) };
}

/** Merchant deps whose Vercel read of `h` is answered NOW but delivered only when the gate opens. */
function delayedRead(w, h) {
  const gate = deferred();
  const state = { held: false };
  const fetchImpl = async (url, init = {}) => {
    const res = await w.fetchImpl(url, init);                       // Vercel's answer as of now
    const u = new URL(url);
    if (!state.held && u.hostname === 'api.vercel.com' && (init.method || 'GET') === 'GET'
        && u.pathname.endsWith(`/domains/${encodeURIComponent(h)}`)) {
      state.held = true;
      await gate.promise;                                           // ...delivered late
    }
    return res;
  };
  return { deps: { ...buildDeps(w.cfg, fetchImpl), dnsOptions: w.deps.dnsOptions }, gate, state };
}

test('merchant vs reconciler: while a merchant request holds the group, the reconciler leaves it alone', async () => {
  const w = await world({ isolated: true });
  const s = await store(w);
  const { h, challengeId, code } = await readySubdomainGoneFromVercel(w, s);
  const m = delayedRead(w, h);
  const activation = callWith(w, m.deps, s, 'activate', { challengeId, code });
  await waitFor(() => m.state.held, 'the merchant read of Vercel');

  // Vercel told the merchant request "absent"; that answer is still in flight. The reconciler runs.
  const r = await runReconcile(w);
  assert.deepEqual([r.leased, r.complete], [0, true], 'the group is held: not leased, not touched');
  assert.equal(w.vercel.project.has(h), false, 'nothing attached behind the merchant request');

  m.gate.resolve();
  assert.equal((await activation).body.outcome, 'vercel_not_ready');
  assert.equal((await rowsOf(w, s.slug))[0].vercel_state, 'removed', 'the answer was still the truth: recorded');
  assert.equal(await liveLeases(w), 0, 'the merchant request gave the group back');

  // Now the reconciler attaches -- and what it records stands.
  const r2 = await runReconcile(w);
  assert.deepEqual([r2.leased, r2.marked_ready], [1, 1]);
  assert.deepEqual((await rowsOf(w, s.slug)).map((x) => [x.status, x.vercel_state]), [['ready', 'configured']]);
  assert.equal(w.vercel.project.has(h), true);
  assert.equal(await liveLeases(w), 0, 'the reconciler gave it back too');
  assertFenced(w.timeline);
});

test('the reviewed race: a merchant answer delayed past its lease is refused, and the name is never freed while Vercel holds it', async () => {
  const w = await world({ isolated: true });
  const [s, other] = [await store(w), await store(w)];
  const { h, challengeId, code } = await readySubdomainGoneFromVercel(w, s);
  const m = delayedRead(w, h);
  const activation = callWith(w, m.deps, s, 'activate', { challengeId, code });
  await waitFor(() => m.state.held, 'the merchant read of Vercel');

  // The merchant's "absent" is delayed past its lease. The reconciler takes the group: it sees
  // the name gone, attaches it again, and records it configured.
  await expireLeases(w);
  await runReconcile(w);
  await expireLeases(w);
  const r = await runReconcile(w);
  assert.deepEqual([r.leased, r.marked_ready], [1, 1]);
  assert.equal(w.vercel.project.has(h), true);

  // The delayed "absent" arrives: refused by the database, nothing written, no code spent.
  m.gate.resolve();
  assert.equal((await activation).body.outcome, 'busy');
  const refused = w.timeline.filter((e) => e.kind === 'db' && e.fn === 'domain_leased_vercel_observe'
    && e.host === h && e.outcome === 'lease_lost');
  assert.equal(refused.length, 1, 'the stale observation reached the database and was refused there');
  assert.deepEqual((await rowsOf(w, s.slug)).map((x) => [x.status, x.vercel_state]), [['ready', 'configured']]);
  assert.deepEqual((await w.pg.query('select attempts, consumed_at from public.store_domain_challenges where id = $1',
    [challengeId])).rows[0], { attempts: 0, consumed_at: null });

  // Then the TTL and the 2-minute fence pass. The database knows Vercel holds the name, so it
  // does not free it: cleanup first.
  await expireNow(w, s.slug);
  await settle(w, s.slug);
  await expireLeases(w);
  const r2 = await runReconcile(w);
  assert.ok(r2.expired >= 1);
  assert.deepEqual((await rowsOf(w, s.slug)).map((x) => [x.status, x.end_reason]), [['disconnecting', 'verify_ttl']]);
  assert.equal((await api(w, other, 'claim', { hostname: h })).outcome, 'hostname_releasing', 'still exclusive');
  assert.equal(w.vercel.project.has(h), false, 'removed from Vercel by the cleanup');
  // Freed only once the removal has settled.
  await settle(w, s.slug);
  await expireLeases(w);
  await runReconcile(w);
  assert.equal((await api(w, other, 'claim', { hostname: h })).outcome, 'claimed');
  assertFenced(w.timeline);
});

test('busy spends no code: while the reconciler holds the group, activate / refresh / disconnect change nothing', async () => {
  const w = await world({ isolated: true });
  const s = await store(w);
  await readyDomain(w, s);
  const act = await api(w, s, 'request_otp', { otpAction: 'activate' });
  const actCode = lastCode(w);
  const dis = await api(w, s, 'request_otp', { otpAction: 'disconnect' });
  const disCode = lastCode(w);
  const [held] = await w.deps.db.reconcileLease(1);                 // the reconciler is working on it
  assert.equal(held.store_slug, s.slug);
  const vercelCalls = w.vercel.calls.length;
  const dnsLookups = w.dns.lookups.length;

  const a = await api(w, s, 'activate', { challengeId: act.challenge_id, code: actCode });
  assert.equal(a.outcome, 'busy');
  assert.ok(a.retry_after_seconds > 0 && a.retry_after_seconds <= 120, String(a.retry_after_seconds));
  assert.equal((await api(w, s, 'refresh')).outcome, 'busy');
  assert.equal((await api(w, s, 'disconnect', { challengeId: dis.challenge_id, code: disCode })).outcome, 'busy');
  assert.equal(w.vercel.calls.length, vercelCalls, 'no Vercel call');
  assert.equal(w.dns.lookups.length, dnsLookups, 'no DNS lookup');
  const codes = (await w.pg.query(
    'select attempts, consumed_at from public.store_domain_challenges where id = any($1::uuid[])',
    [[act.challenge_id, dis.challenge_id]])).rows;
  assert.deepEqual(codes, [{ attempts: 0, consumed_at: null }, { attempts: 0, consumed_at: null }], 'no code checked, none spent');
  assert.deepEqual((await rowsOf(w, s.slug)).map((x) => x.status), ['ready', 'ready']);

  // The reconciler finishes and gives the group back: the same code now works.
  await w.deps.db.leaseRelease(held.group_id, held.store_slug, held.lease_token);
  assert.equal((await api(w, s, 'activate', { challengeId: act.challenge_id, code: actCode })).outcome, 'connected');
  assert.equal(await liveLeases(w), 0);
});

// ═══════════════════════════════════════════════════════════════════════════
// Review round 4: timeouts cover the response body
// ═══════════════════════════════════════════════════════════════════════════

/** A local server that sends headers and a first chunk at once, then never finishes the body. */
async function stallingServer() {
  const http = await import('node:http');
  const seen = { opened: 0, closed: 0 };
  const server = http.createServer((req, res) => {
    seen.opened++;
    res.on('close', () => { seen.closed++; });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.write('{"outcome":');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return {
    url: `http://127.0.0.1:${server.address().port}`, seen,
    close: async () => { server.closeAllConnections(); await new Promise((r) => server.close(r)); },
  };
}
const hangGuard = (ms) => new Promise((_, reject) =>
  setTimeout(() => reject(new Error('still waiting: the body escaped the deadline')), ms));

test('database timeouts cover the response body: headers at once, then a stalled body, is cut off inside the budget', async () => {
  const srv = await stallingServer();
  try {
    // Real fetch, real socket; 1.2 s of budget left.
    const db = createDomainDb({ url: srv.url, serviceKey: 'k' }).withBudget(createBudget({ totalMs: 1200, reserveMs: 1000 }));
    let t0 = Date.now();
    await assert.rejects(Promise.race([db.rpc('domain_expire_stale', { p_limit: 1 }), hangGuard(6000)]), { code: 'db_timeout' });
    let took = Date.now() - t0;
    assert.ok(took >= 1000 && took < 2500, `aborted after ${took} ms`);
    await waitFor(() => srv.seen.opened === 1 && srv.seen.closed === 1, 'the server to see the request aborted');
    // Without a budget, the per-call timeout bounds it the same way.
    t0 = Date.now();
    await assert.rejects(Promise.race([createDomainDb({ url: srv.url, serviceKey: 'k', timeoutMs: 300 }).groupsForStore('x'),
      hangGuard(6000)]), { code: 'db_timeout' });
    took = Date.now() - t0;
    assert.ok(took >= 250 && took < 1500, `aborted after ${took} ms`);
  } finally {
    await srv.close();
  }
  // Whatever the fetch implementation -- even one that ignores the abort signal entirely.
  const stubborn = async () => ({ ok: true, status: 200, json: () => new Promise(() => {}) });
  const t0 = Date.now();
  await assert.rejects(Promise.race([
    createDomainDb({ url: SB, serviceKey: 'k', fetchImpl: stubborn, timeoutMs: 200 }).rpc('domain_expire_stale', {}),
    hangGuard(6000)]), { code: 'db_timeout' });
  assert.ok(Date.now() - t0 < 1500);
});

test('Vercel and PIN-check timeouts cover the response body too: a stalled body is unknown / a refusal, in time', async () => {
  const srv = await stallingServer();
  const toLocal = (u, init) => fetch(String(u).replace(/^https:\/\/api\.vercel\.com/, srv.url), init);
  try {
    const v = createVercelClient({ token: 't', projectId: PROJECT_ID, fetchImpl: toLocal })
      .withBudget(createBudget({ totalMs: 2000, reserveMs: 0 }));
    let t0 = Date.now();
    assert.deepEqual(await Promise.race([v.inspect('brand.com'), hangGuard(6000)]), { unknown: true, reason: 'vercel_timeout' });
    assert.ok(Date.now() - t0 < 3000);
    const d = createVercelClient({ token: 't', projectId: PROJECT_ID, fetchImpl: toLocal, deleteTimeoutMs: 300 });
    assert.deepEqual(await Promise.race([d.remove('brand.com'), hangGuard(6000)]),
      { result: 'unknown', reason: 'vercel_timeout' }, 'a DELETE whose answer never completes is not "removed"');
    t0 = Date.now();
    assert.equal(await Promise.race([
      verifyOwnerPin({ supabaseUrl: srv.url, fetchImpl: fetch, timeoutMs: 300 }, 'st', 'a'.repeat(64), null),
      hangGuard(6000)]), false);
    assert.ok(Date.now() - t0 < 1500);
    await waitFor(() => srv.seen.opened === 3 && srv.seen.closed === 3, 'every stalled request to be aborted');
  } finally {
    await srv.close();
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Feature flag, endpoints, authentication, security
// ═══════════════════════════════════════════════════════════════════════════

test('flag OFF: every merchant action is feature_disabled with zero external calls (not even the PIN check)', async () => {
  const off = await world({ env: { ...ENV_ON, CUSTOM_DOMAINS_ENABLED: 'false' } });
  const s = { slug: 'anything', hashedPin: 'a'.repeat(64) };
  for (const action of ['status', 'claim', 'verify', 'refresh', 'request_otp', 'activate', 'set_primary', 'disconnect']) {
    const r = await call(off, s, action, { hostname: 'brand.com' });
    assert.deepEqual([r.status, r.body], [200, { outcome: 'feature_disabled' }], action);
  }
  for (const v of [undefined, '', 'TRUE ', '1', 'yes', 'on']) {
    assert.equal(domainsConfig({ ...ENV_ON, CUSTOM_DOMAINS_ENABLED: v }).enabled, v === 'TRUE ', String(v));
  }
  assert.equal(off.counter.n, 0);
});

test('flag OFF: the reconciler makes no Vercel call and no database call', async () => {
  const w = await world({ env: { ...ENV_ON, CUSTOM_DOMAINS_ENABLED: 'false' } });
  const r = await handleReconcile({ method: 'POST', headers: { authorization: `Bearer ${CRON_SECRET}` } },
    { env: w.env, fetchImpl: w.fetchImpl });
  assert.deepEqual(r, { status: 200, body: { outcome: 'feature_disabled' } });
  assert.equal(w.counter.n, 0);
  assert.deepEqual(await reconcile({ config: w.cfg, db: null, vercel: null }), { outcome: 'feature_disabled' });
});

test('reconcile endpoint: requires the cron secret', async () => {
  const w = await world({ isolated: true });
  for (const auth of [undefined, '', 'Bearer wrong', `bearer ${CRON_SECRET}`, CRON_SECRET]) {
    const r = await handleReconcile({ method: 'GET', headers: auth === undefined ? {} : { authorization: auth } },
      { env: w.env, fetchImpl: w.fetchImpl });
    assert.equal(r.status, 401, String(auth));
  }
  const none = await handleReconcile({ method: 'GET', headers: { authorization: 'Bearer ' } },
    { env: { ...ENV_ON, CRON_SECRET: '' }, fetchImpl: w.fetchImpl });
  assert.equal(none.status, 401, 'no secret configured = nobody');
  assert.equal(w.counter.n, 0);
  const ok = await handleReconcile({ method: 'GET', headers: { authorization: `Bearer ${CRON_SECRET}` } },
    { env: w.env, fetchImpl: w.fetchImpl, deps: w.deps });
  assert.equal(ok.body.outcome, 'ok');
});

test('authentication: the PIN is verified with the caller IP; a wrong PIN or another store is refused', async () => {
  const w = await world();
  const a = await store(w);
  const r = await call(w, { ...a, hashedPin: hashPin('9999') }, 'status');
  assert.deepEqual([r.status, r.body], [403, { outcome: 'unauthorized' }]);
  assert.deepEqual(w.shim.seenPinCalls.at(-1), { slug: a.slug, ip: '203.0.113.7' });
  const b = await store(w, { pin: '1111' });
  assert.equal((await call(w, { slug: b.slug, hashedPin: a.hashedPin }, 'status')).status, 403, "A's PIN does not open B");
  assert.equal((await call(w, a, 'status', {}, { 'x-forwarded-for': 'not-an-ip, 10.0.0.1' })).status, 200);
  assert.equal(w.shim.seenPinCalls.at(-1).ip, null, 'a malformed address is not forwarded');
  assert.equal((await handleManage({ method: 'GET', headers: {}, body: {} }, { env: w.env, fetchImpl: w.fetchImpl })).status, 405);
  assert.equal((await call(w, { slug: a.slug, hashedPin: 'short' }, 'status')).status, 400);
});

test('Store A can never operate Store B: the group is always derived from the authenticated slug', async () => {
  const w = await world();
  const [a, b] = [await store(w), await store(w)];
  const bDom = await connectedDomain(w, b);
  const bGroupId = (await w.deps.db.groupsForStore(b.slug))[0].group_id;
  // A has no domain; everything aimed at B's group or hostnames lands on A's (empty) state.
  assert.equal((await api(w, a, 'status', { groupId: bGroupId })).domain, null);
  assert.equal((await api(w, a, 'verify', { groupId: bGroupId })).outcome, 'no_domain');
  assert.equal((await api(w, a, 'request_otp', { otpAction: 'disconnect', groupId: bGroupId })).outcome, 'no_domain');
  assert.equal((await api(w, a, 'disconnect', { groupId: bGroupId })).outcome, 'no_domain');
  assert.equal((await api(w, a, 'claim', { hostname: bDom.host })).outcome, 'hostname_in_use');
  // A with its own domain cannot point set_primary at B's hostname.
  const da = await connectedDomain(w, a);
  assert.ok(da);
  const sp = await api(w, a, 'request_otp', { otpAction: 'set_primary', hostname: `www.${bDom.host}` });
  assert.equal(sp.outcome, 'target_not_in_group');
  assert.deepEqual((await rowsOf(w, b.slug)).map((x) => x.status), ['connected', 'connected']);
  assert.equal(w.wa.sends.every((x) => x.receiver === '919876543210'), true);
});

test('responses expose no internal ids, hashes, tokens or secrets', async () => {
  const w = await world();
  const s = await store(w);
  const out = [];
  const logs = await captureLogs(async () => {
    const d = await readyDomain(w, s);
    out.push(d.claim, await api(w, s, 'status'), await api(w, s, 'refresh'));
    const o = await api(w, s, 'request_otp', { otpAction: 'activate' });
    out.push(o, await api(w, s, 'activate', { challengeId: o.challenge_id, code: lastCode(w) }));
  });
  const text = JSON.stringify(out);
  const gid = (await w.deps.db.groupsForStore(s.slug))[0].group_id;
  const hashes = (await w.pg.query('select code_hash from public.store_domain_challenges where store_slug = $1', [s.slug])).rows;
  const leases = w.timeline.filter((e) => e.kind === 'db' && e.lease).map((e) => e.lease);
  assert.ok(leases.length >= 2, 'the flows above did take leases');
  for (const secret of [gid, VERCEL_TOKEN, SERVICE_KEY, OTP_SECRET, WA_KEY, WA_URL, ...hashes.map((h) => h.code_hash), ...leases]) {
    assert.equal(text.includes(secret), false);
    assert.equal(logs.includes(secret), false);
  }
});

test('config: server-only names, never VITE_*; missing configuration is reported by NAME only', () => {
  const cfg = domainsConfig({});
  assert.equal(cfg.enabled, false);
  assert.deepEqual(missingConfig(cfg, 'vercel'), ['DOMAINS_VERCEL_TOKEN', 'DOMAINS_VERCEL_PROJECT_ID']);
  assert.deepEqual(missingConfig(domainsConfig({ DOMAINS_OTP_HMAC_SECRET: 'short' }), 'otp'),
    ['SENIQIFY_TEMPLATE_URL', 'DOMAINS_OTP_HMAC_SECRET (too short)']);
  assert.deepEqual(missingConfig(domainsConfig({ DOMAINS_VERCEL_TOKEN: 't', DOMAINS_VERCEL_PROJECT_ID: 'store' }), 'vercel'),
    ['DOMAINS_VERCEL_PROJECT_ID (must be the prj_ id)']);
});

test('static: no VITE_ config, no CORS, no client import, no direct domain-table write, no new migration', () => {
  const dir = fileURLToPath(new URL('../api/domains/', import.meta.url));
  const files = readdirSync(dir).filter((f) => f.endsWith('.js'));
  assert.deepEqual(files.sort(), ['_auth.js', '_budget.js', '_config.js', '_db.js', '_dns.js', '_http.js', '_otp.js', '_parse.js',
    '_reconcile.js', '_service.js', '_steps.js', '_vercel.js', 'manage.js', 'reconcile.js']);
  for (const f of files) {
    const src = read(`api/domains/${f}`).split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    assert.doesNotMatch(src, /VITE_/, f);
    assert.doesNotMatch(src, /Access-Control-Allow/i, f);
  }
  // Domain tables are only ever READ over REST; the one POST is the RPC call.
  const dbSrc = read('api/domains/_db.js');
  assert.doesNotMatch(dbSrc, /'(PATCH|PUT|DELETE)'/);
  assert.equal(dbSrc.match(/method: 'POST'/g).length, 1);
  assert.match(dbSrc, /const rpc = \(fn, args\) => request\(`\/rest\/v1\/rpc\/\$\{fn\}`, \{ method: 'POST'/);
  // The browser bundle never sees any of it.
  const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(`${d}/${e.name}`) : [`${d}/${e.name}`]);
  for (const f of walk(fileURLToPath(new URL('../src', import.meta.url)))) {
    const src = readFileSync(f, 'utf8');
    assert.doesNotMatch(src, /api\/domains|DOMAINS_VERCEL|DOMAINS_OTP|CUSTOM_DOMAINS_ENABLED|SUPABASE_SERVICE_ROLE|store_domain/, f);
  }
  // No schedule is installed, and PR-B's migration files are untouched.
  const vj = JSON.parse(read('vercel.json'));
  assert.equal(vj.crons, undefined);
  const sha = (p) => crypto.createHash('sha256').update(read(p).replace(/\r\n/g, '\n')).digest('hex').slice(0, 16);
  assert.equal(sha('supabase/custom-domains-forward.sql'), '83f56942b4ae0508');
  assert.equal(sha('supabase/custom-domains-verify.sql'), 'e5b4abf8c261c686');
});

test('shim sanity: domain reads go through service_role REST exactly as in production', async () => {
  const w = await world();
  const s = await store(w);
  await readyDomain(w, s);
  const bad = await w.shim.handle(`${SB}/rest/v1/store_domains?store_slug=eq.${s.slug}&select=hostname`,
    { method: 'GET', headers: { apikey: ANON, Authorization: `Bearer ${ANON}` } });
  assert.equal(bad.status, 401, 'the shim refuses anything but the service key');
});
