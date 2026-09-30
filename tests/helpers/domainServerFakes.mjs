// Deterministic fakes for the custom-domain server tests (PR-C). Nothing here
// touches real DNS, Vercel, WhatsApp or Supabase.
//
//   PostgREST shim  -- the exact REST calls api/domains/_db.js and _auth.js make,
//                      executed against the REAL PR-B schema in PGlite (as the
//                      service_role, or anon for verify_store_pin). So every
//                      outcome, fence, TTL and challenge rule is the database's.
//   Vercel fake     -- the documented contract (see api/domains/_vercel.js).
//   DNS fake        -- resolveTxt with records, NXDOMAIN/ENODATA, errors, hangs.
//   WhatsApp fake   -- records every send.
// All four write to one shared timeline so tests can assert ORDER.
import { asRole } from './domainDb.mjs';
import { parse as parseDomain } from 'tldts';

// Set-returning RPCs: PostgREST answers them with an array of rows.
const SETOF = new Set(['domain_reconcile_lease']);

export const SB = 'https://sb.test';
export const SERVICE_KEY = 'test-service-role-key-not-real';
export const PROJECT_ID = 'prj_PocketLinkTest01';
export const TEAM_ID = 'team_seniqifyTest';
export const VERCEL_TOKEN = 'vercel-test-token-SECRET-1234567890';
export const OTP_SECRET = 'otp-hmac-test-secret-0123456789abcdef0123456789';
export const WA_URL = 'https://wa.test/process/SECRET-TEMPLATE-URL';
export const WA_KEY = 'wa-test-api-key-SECRET';
export const CRON_SECRET = 'cron-test-secret-SECRET';

const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const hangUntilAbort = (signal) => new Promise((_, reject) => {
  const fail = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
  if (signal?.aborted) fail(); else signal?.addEventListener('abort', fail);
});

export function createTimeline() {
  const t = [];
  t.of = (kind) => t.filter((e) => e.kind === kind);
  return t;
}

/** PostgREST over PGlite. `pins` maps slug -> hashed PIN for verify_store_pin. */
export function createPostgrestShim(pg, { timeline, pins = new Map(), serviceKey = SERVICE_KEY, anonKey }) {
  const seenPinCalls = [];
  const plain = (v) => JSON.parse(JSON.stringify(v));
  async function handle(url, init = {}) {
    const u = new URL(url);
    const method = init.method || 'GET';
    const h = init.headers || {};
    const path = u.pathname;

    if (path === '/rest/v1/rpc/verify_store_pin') {
      if (h.apikey !== anonKey) return res(401, { message: 'bad key' });
      const b = JSON.parse(init.body || '{}');
      seenPinCalls.push({ slug: b.p_slug, ip: h['x-forwarded-for'] ?? null });
      timeline?.push({ kind: 'pin', slug: b.p_slug });
      return res(200, pins.get(b.p_slug) === b.p_hashed_pin);
    }
    if (h.apikey !== serviceKey || h.Authorization !== `Bearer ${serviceKey}`) return res(401, { message: 'service key required' });

    if (method === 'POST' && path.startsWith('/rest/v1/rpc/domain_')) {
      const fn = path.slice('/rest/v1/rpc/'.length);
      const args = JSON.parse(init.body || '{}');
      const keys = Object.keys(args);
      const named = keys.map((k, i) => `${k} => $${i + 1}`).join(', ');
      const sql = SETOF.has(fn) ? `select * from public.${fn}(${named})` : `select public.${fn}(${named}) as r`;
      const vals = keys.map((k) => (args[k] !== null && typeof args[k] === 'object' ? JSON.stringify(args[k]) : args[k]));
      try {
        const q = await asRole(pg, 'service_role', sql, vals);
        const out = SETOF.has(fn) ? q.rows : q.rows[0].r;
        timeline?.push({ kind: 'db', fn, host: args.p_hostname ?? null, intent: args.p_intent ?? null,
                         outcome: SETOF.has(fn) ? `rows:${out.length}` : out?.outcome,
                         lease: (SETOF.has(fn) ? out[0]?.lease_token : out?.lease_token) ?? args.p_lease_token ?? null });
        return res(200, plain(out));
      } catch (e) {
        timeline?.push({ kind: 'db_error', fn, code: e.code });
        return res(400, { code: e.code, message: 'error' });
      }
    }
    if (method === 'GET' && path === '/rest/v1/stores') {
      const slug = (u.searchParams.get('slug') || '').replace(/^eq\./, '');
      if (u.searchParams.get('select') !== 'owner_phone:config->>ownerPhone') return res(400, { message: 'unexpected select' });
      const rows = (await asRole(pg, 'service_role',
        `select config->>'ownerPhone' as owner_phone from public.stores where slug = $1 limit 1`, [slug])).rows;
      return res(200, plain(rows));
    }
    if (method === 'GET' && path === '/rest/v1/store_domains') {
      const cols = u.searchParams.get('select');
      const byStore = u.searchParams.get('store_slug');
      const byGroup = u.searchParams.get('group_id');
      const order = u.searchParams.get('order') === 'created_at.desc' ? 'desc' : 'asc';
      const limit = Number(u.searchParams.get('limit') || 100);
      let where, params;
      if (byStore) { where = 'store_slug = $1'; params = [byStore.replace(/^eq\./, '')]; }
      else if (byGroup) { where = 'group_id = any($1::uuid[])'; params = [byGroup.replace(/^in\.\(|\)$/g, '').split(',')]; }
      else return res(400, { message: 'unfiltered read refused by shim' });
      const rows = (await asRole(pg, 'service_role',
        `select ${cols} from public.store_domains where ${where} order by created_at ${order}, kind limit ${limit}`, params)).rows;
      return res(200, plain(rows));
    }
    return res(404, { message: `shim: no route ${method} ${path}` });
  }
  return { handle, seenPinCalls };
}

/** Vercel's project-domain API for ONE project, in memory. */
export function createVercelFake({ timeline, projectId = PROJECT_ID, token = VERCEL_TOKEN, teamId = TEAM_ID } = {}) {
  const project = new Map();                     // host -> { verified, misconfigured }
  const foreign = new Set();                     // held by another project / account
  const knobs = {
    verifyOnAdd: true,                           // a fresh domain verifies at once
    misconfigured: new Map(),                    // host -> true | false | null (missing field)
    verification: new Map(),                     // host -> raw verification[] override (e.g. hostile)
    hang: new Set(),                             // `${METHOD} ${kind}:${host}` -> never answers
    hangOnce: new Set(),
    status: new Map(),                           // `${METHOD} ${kind}:${host}` -> forced HTTP status
  };
  const calls = [];

  async function handle(url, init = {}) {
    const u = new URL(url);
    const method = init.method || 'GET';
    if (init.headers?.Authorization !== `Bearer ${token}`) return res(403, { error: { code: 'forbidden' } });
    if (teamId && u.searchParams.get('teamId') !== teamId) return res(403, { error: { code: 'team' } });
    const p = u.pathname;
    let m;
    let kind, host;
    if ((m = p.match(/^\/v10\/projects\/([^/]+)\/domains$/)) && method === 'POST') { kind = 'add'; host = JSON.parse(init.body).name; }
    else if ((m = p.match(/^\/v9\/projects\/([^/]+)\/domains\/([^/]+)\/verify$/)) && method === 'POST') { kind = 'verify'; host = decodeURIComponent(m[2]); }
    else if ((m = p.match(/^\/v9\/projects\/([^/]+)\/domains\/([^/]+)$/)) && method === 'GET') { kind = 'inspect'; host = decodeURIComponent(m[2]); }
    else if ((m = p.match(/^\/v9\/projects\/([^/]+)\/domains\/([^/]+)$/)) && method === 'DELETE') { kind = 'remove'; host = decodeURIComponent(m[2]); }
    else if ((m = p.match(/^\/v6\/domains\/([^/]+)\/config$/)) && method === 'GET') { kind = 'config'; host = decodeURIComponent(m[1]); }
    else return res(404, { error: { code: 'not_found' } });
    if (kind !== 'config' && decodeURIComponent(m[1]) !== projectId) return res(404, { error: { code: 'project' } });
    if (kind === 'config' && u.searchParams.get('projectIdOrName') !== projectId) return res(400, { error: { code: 'project' } });

    calls.push({ method, kind, host });
    timeline?.push({ kind: 'vercel', op: kind, host });
    const key = `${method} ${kind}:${host}`;
    if (knobs.hangOnce.has(key)) { knobs.hangOnce.delete(key); return hangUntilAbort(init.signal); }
    if (knobs.hang.has(key)) return hangUntilAbort(init.signal);
    if (knobs.status.has(key)) return res(knobs.status.get(key), { error: { code: 'forced' } });

    const apexOf = (h) => parseDomain(h, { allowPrivateDomains: false }).domain || h;
    const body = (h) => ({
      name: h, apexName: apexOf(h), projectId, verified: project.get(h).verified,
      verification: project.get(h).verified ? [] : (knobs.verification.get(h)
        ?? [{ type: 'TXT', domain: `_vercel.${apexOf(h)}`, value: `vc-domain-verify=${h},9f8e7d6c5b4a`, reason: 'pending_domain_verification' }]),
    });
    switch (kind) {
      case 'add':
        if (foreign.has(host)) return res(409, { error: { code: 'domain_already_in_use' } });
        if (project.has(host)) return res(400, { error: { code: 'domain_already_exists' } });
        project.set(host, { verified: knobs.verifyOnAdd });
        return res(200, body(host));
      case 'inspect':
        return project.has(host) ? res(200, body(host)) : res(404, { error: { code: 'not_found' } });
      case 'verify':
        if (!project.has(host)) return res(400, { error: { code: 'not_assigned' } });
        return project.get(host).verified ? res(200, body(host)) : res(400, { error: { code: 'verification_failed' } });
      case 'config': {
        const mis = knobs.misconfigured.has(host) ? knobs.misconfigured.get(host) : true;
        const out = { configuredBy: mis === false ? 'CNAME' : null, acceptedChallenges: ['http-01'],
                      recommendedCNAME: [{ rank: 1, value: 'cname.vercel-dns.com.' }],
                      recommendedIPv4: [{ rank: 1, value: ['76.76.21.21'] }] };
        if (mis !== null) out.misconfigured = mis;
        return res(200, out);
      }
      case 'remove':
        if (!project.has(host)) return res(404, { error: { code: 'not_found' } });
        project.delete(host);
        return res(200, {});
    }
    return res(500, {});
  }
  return {
    handle, project, foreign, knobs, calls,
    /** The merchant pointed DNS correctly at Vercel. */
    dnsReady: (...hosts) => hosts.forEach((h) => knobs.misconfigured.set(h, false)),
    mutations: () => calls.filter((c) => c.kind === 'add' || c.kind === 'remove' || c.kind === 'verify'),
  };
}

/** resolveTxt fake: records map name -> string[][] | { error } | { hang: true }. */
export function createDnsFake({ timeline } = {}) {
  const records = new Map();
  const lookups = [];
  const resolveTxt = (name) => {
    lookups.push(name);
    timeline?.push({ kind: 'dns', name });
    const r = records.get(name);
    if (!r) return Promise.reject(Object.assign(new Error('nx'), { code: 'ENOTFOUND' }));
    if (r.hang) return new Promise(() => {});
    if (r.error) return Promise.reject(Object.assign(new Error(r.error), { code: r.error }));
    return Promise.resolve(r);
  };
  return {
    records, lookups, resolveTxt,
    publish: (name, ...values) => records.set(name, values.map((v) => (Array.isArray(v) ? v : [v]))),
    unpublish: (name) => records.delete(name),
  };
}

export function createWhatsAppFake({ timeline } = {}) {
  const sends = [];
  let mode = 'ok';
  async function handle(url, init = {}) {
    const b = JSON.parse(init.body || '{}');
    sends.push({ url, receiver: b.receiver, code: b.values?.['1'], minutes: b.values?.['2'], auth: init.headers?.Authorization });
    timeline?.push({ kind: 'whatsapp', receiver: b.receiver });
    if (mode === 'fail') return res(500, {});
    return res(200, { status: 'queued' });
  }
  return { handle, sends, setMode: (m) => { mode = m; } };
}

/** One fetch for everything the server code calls. Unknown hosts throw. */
export function routeFetch({ shim, vercel, whatsapp, counter }) {
  return async (url, init = {}) => {
    if (counter) counter.n++;
    const u = new URL(url);
    if (u.origin === SB) return shim.handle(url, init);
    if (u.hostname === 'api.vercel.com') return vercel.handle(url, init);
    if (url === WA_URL) return whatsapp.handle(url, init);
    throw new Error(`unexpected external call: ${u.origin}`);
  };
}

export const ENV_ON = Object.freeze({
  CUSTOM_DOMAINS_ENABLED: 'true',
  SUPABASE_URL: SB,
  SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
  DOMAINS_VERCEL_TOKEN: VERCEL_TOKEN,
  DOMAINS_VERCEL_PROJECT_ID: PROJECT_ID,
  DOMAINS_VERCEL_TEAM_ID: TEAM_ID,
  DOMAINS_OTP_HMAC_SECRET: OTP_SECRET,
  SENIQIFY_TEMPLATE_URL: WA_URL,
  SENIQIFY_API_KEY: WA_KEY,
  CRON_SECRET,
});
