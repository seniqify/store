// Custom-domain ROUTING test world (PR-D).
//
//   * The REAL PR-B + PR-B.1 schema in PGlite. Domain groups are driven into
//     each status by the real domain functions, so what resolve_store_host and
//     store_primary_host answer for a status is the database's answer.
//   * A Supabase stand-in answering, over that database, exactly what the
//     server (render, sitemap, middleware) and the browser SPA (supabase-js)
//     ask: the two public read RPCs as the anon role, and store reads.
//     It returns real WHATWG Responses, with permissive CORS, so the browser
//     test can use it too.
//   * A pipeline that follows a request the way Vercel would for this repo:
//     the real middleware.js, then vercel.json's redirects, the filesystem and
//     rewrites, then the real api/render.js and api/sitemap.js. It is only the
//     parts this repo's routing depends on -- not Vercel.
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { freshDb, asRole } from './domainDb.mjs';
import { createMiddleware } from '../../middleware.js';
import { createResolver } from '../../api/_resolve.js';
import renderHandler from '../../api/render.js';
import sitemapHandler from '../../api/sitemap.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const VERCEL_JSON = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8'));

export const SB = 'https://sb.test';
export const ANON = 'anon-test-key';

// ── Stores ───────────────────────────────────────────────────────────────────
export const BRAND = {
  slug: 'brandshop',
  config: {
    slug: 'brandshop', businessName: 'Brand Shop', tagline: 'Handmade goods from Pune', category: 'Gifts', city: 'Pune',
    whatsappNumber: '919800000001', businessType: 'product', theme: { primary: '#0d9488' },
    categories: [{ id: 'all', label: 'All Products' }, { id: 'mugs', label: 'Mugs' }, { id: 'lamps', label: 'Lamps' }],
    products: [
      { id: 'p1', name: 'Clay Mug', price: 250, category: 'mugs' },
      { id: 'p2', name: 'Brass Lamp', price: 900, category: 'lamps' },
    ],
  },
};
export const OTHER = {
  slug: 'otherstore',
  config: {
    slug: 'otherstore', businessName: 'Other Store', tagline: 'Someone else entirely', city: 'Nagpur',
    whatsappNumber: '919800000002', businessType: 'product', theme: { primary: '#7c3aed' },
    categories: [{ id: 'all', label: 'All Products' }, { id: 'tea', label: 'Tea' }],
    products: [{ id: 'o1', name: 'Secret Tea', price: 120, category: 'tea' }],
  },
};

// ── The database, and domain groups driven into a status ─────────────────────
export async function createDb() {
  const db = await freshDb({ lease: true });
  for (const s of [BRAND, OTHER]) {
    await db.query('insert into public.stores (slug, config) values ($1, $2)', [s.slug, JSON.stringify(s.config)]);
  }
  return db;
}

const one = async (db, sql, args) => (await db.query(sql, args)).rows[0].r;

/**
 * Drive one domain group (apex + www for a bare domain, or one subdomain) to
 * `status`, through the real PR-B functions (called by the superuser, below the
 * PR-B.1 lease gateways -- this is setup, not the code under test).
 * status: pending | verified | ready | connected | misconfigured | disconnecting | disconnected | expired
 */
export async function domainIn(db, slug, host, status) {
  const kind = host.split('.').length > 2 ? 'subdomain' : 'apex';
  const c = await one(db, `select public.domain_claim($1, $2, $3) as r`, [slug, host, kind]);
  if (c.outcome !== 'claimed') throw new Error(`claim ${host}: ${JSON.stringify(c)}`);
  const g = { slug, host, groupId: c.group_id, token: c.txt_token,
              hosts: kind === 'apex' ? [host, `www.${host}`] : [host] };
  if (status === 'pending') return g;
  if (status === 'expired') {
    await db.query(`update public.store_domains set expires_at = now() - interval '1 second' where group_id = $1`, [g.groupId]);
    await db.query('select public.domain_expire_stale(10)');
    return g;
  }
  await one(db, 'select public.domain_mark_verified($1, $2, $3) as r', [g.groupId, slug, g.token]);
  if (status === 'verified') return g;
  for (const h of g.hosts) {
    await db.query(`select public.domain_vercel_intent($1, $2, $3, 'add')`, [g.groupId, slug, h]);
    await db.query('select public.domain_vercel_observe($1, $2, $3, true, true, false)', [g.groupId, slug, h]);
  }
  await one(db, 'select public.domain_mark_ready($1, $2) as r', [g.groupId, slug]);
  if (status === 'ready') return g;
  const hash = 'e'.repeat(64);
  const ch = await one(db, `select public.domain_challenge_create($1, $2, 'activate', $3, $4) as r`, [slug, g.groupId, host, hash]);
  const a = await one(db, 'select public.domain_activate($1, $2, $3, $4, $5) as r', [g.groupId, slug, g.token, ch.challenge_id, hash]);
  if (a.outcome !== 'connected') throw new Error(`activate ${host}: ${JSON.stringify(a)}`);
  if (status === 'connected') return g;
  if (status === 'misconfigured') {
    await one(db, 'select public.domain_health_update($1, $2, false) as r', [g.groupId, slug]);
    await one(db, 'select public.domain_health_update($1, $2, false) as r', [g.groupId, slug]);
    return g;
  }
  await one(db, `select public.domain_begin_disconnect($1, $2, 'admin') as r`, [g.groupId, slug]);
  if (status === 'disconnecting') return g;
  for (const h of g.hosts) {
    await db.query('select public.domain_vercel_observe($1, $2, $3, false, null, null)', [g.groupId, slug, h]);
  }
  await db.query(`update public.store_domains set vercel_state_at = now() - interval '3 minutes' where group_id = $1`, [g.groupId]);
  const f = await one(db, 'select public.domain_finish_disconnect($1, $2) as r', [g.groupId, slug]);
  if (f.outcome !== 'disconnected') throw new Error(`finish ${host}: ${JSON.stringify(f)}`);
  return g;   // disconnected
}

/** Make `newPrimary` (the other name of an apex/www group) the primary. */
export async function setPrimary(db, g, newPrimary) {
  const hash = 'f'.repeat(64);
  const ch = await one(db, `select public.domain_challenge_create($1, $2, 'set_primary', $3, $4) as r`, [g.slug, g.groupId, newPrimary, hash]);
  const r = await one(db, 'select public.domain_set_primary($1, $2, $3, $4, $5) as r', [g.groupId, g.slug, newPrimary, ch.challenge_id, hash]);
  if (r.outcome !== 'ok') throw new Error(`set_primary: ${JSON.stringify(r)}`);
}

/** Disconnect a connected group right through to 'disconnected'. */
export async function disconnect(db, g) {
  await one(db, `select public.domain_begin_disconnect($1, $2, 'admin') as r`, [g.groupId, g.slug]);
  for (const h of g.hosts) {
    await db.query('select public.domain_vercel_observe($1, $2, $3, false, null, null)', [g.groupId, g.slug, h]);
  }
  await db.query(`update public.store_domains set vercel_state_at = now() - interval '3 minutes' where group_id = $1`, [g.groupId]);
  await one(db, 'select public.domain_finish_disconnect($1, $2) as r', [g.groupId, g.slug]);
}

// ── The Supabase stand-in ────────────────────────────────────────────────────
const CORS = {
  'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS', 'Access-Control-Expose-Headers': '*',
};
const jsonResponse = (status, body, extra = {}) => new Response(body === undefined ? null : JSON.stringify(body),
  { status, headers: { 'Content-Type': 'application/json', ...CORS, ...extra } });

/**
 * fetch-compatible handler for https://sb.test. knobs:
 *   resolver: 'ok' | 'down' (network error) | 'http500' | 'malformed' | 'hang'
 *   storesDown: store reads fail
 * `log` records every request: { method, path, query, body }.
 */
export function createSupabase(db) {
  const log = [];
  const knobs = { resolver: 'ok', storesDown: false };
  async function handle(input, init = {}) {
    const url = new URL(String(input));
    const method = (init.method || 'GET').toUpperCase();
    const bodyText = typeof init.body === 'string' ? init.body : '';
    log.push({ method, path: url.pathname, query: url.search, body: bodyText });
    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    const accept = new Headers(init.headers || {}).get('accept') || '';

    if (url.pathname === '/rest/v1/rpc/resolve_store_host' || url.pathname === '/rest/v1/rpc/store_primary_host') {
      if (knobs.resolver === 'down') throw new TypeError('fetch failed');
      if (knobs.resolver === 'http500') return jsonResponse(500, { message: 'boom' });
      if (knobs.resolver === 'malformed') return jsonResponse(200, { store_slug: 'otherstore' });
      if (knobs.resolver === 'hang') {
        return new Promise((_, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
      }
      const args = JSON.parse(bodyText || '{}');
      if (url.pathname.endsWith('/resolve_store_host')) {
        const rows = (await asRole(db, 'anon', 'select * from public.resolve_store_host($1)', [args.p_host ?? null])).rows;
        return jsonResponse(200, rows);
      }
      const r = (await asRole(db, 'anon', 'select public.store_primary_host($1) as r', [args.p_slug ?? null])).rows[0].r;
      return jsonResponse(200, r);
    }

    if (url.pathname === '/rest/v1/stores' && method === 'GET') {
      if (knobs.storesDown) throw new TypeError('fetch failed');
      const slugFilter = (url.searchParams.get('slug') || '').replace(/^eq\./, '');
      const rows = (await db.query(
        slugFilter ? 'select slug, config from public.stores where slug = $1' : 'select slug, config from public.stores',
        slugFilter ? [slugFilter] : [])).rows.map((r) => ({ ...r, updated_at: '2026-09-01T00:00:00Z' }));
      const select = (url.searchParams.get('select') || '*').split(',');
      const shaped = rows.map((r) => (select.includes('*') ? r
        : Object.fromEntries(select.filter((k) => k in r).map((k) => [k, r[k]]))));
      if (accept.includes('vnd.pgrst.object')) {
        return shaped.length === 1 ? jsonResponse(200, shaped[0]) : jsonResponse(406, { code: 'PGRST116', message: 'no rows' });
      }
      return jsonResponse(200, shaped);
    }
    if (method === 'GET') return jsonResponse(200, accept.includes('vnd.pgrst.object') ? null : []);
    if (url.pathname.startsWith('/rest/v1/rpc/')) return jsonResponse(200, null);
    return jsonResponse(201, undefined);
  }
  return { handle, log, knobs };
}

// ── The pipeline ─────────────────────────────────────────────────────────────
function compile(source) {
  const names = [];
  const body = source
    .replace(/\/:([A-Za-z]+)\*/g, (_, n) => { names.push(n); return '(?:/(.*))?'; })
    .replace(/:([A-Za-z]+)/g, (_, n) => { names.push(n); return '([^/]+)'; });
  return { re: new RegExp(`^${body}/?$`), names };
}
function matchRoute(source, pathname) {
  const { re, names } = compile(source);
  const m = re.exec(pathname);
  if (!m) return null;
  return Object.fromEntries(names.map((n, i) => [n, m[i + 1] ?? '']));
}
function substitute(dest, params) {
  return dest.replace(/:([A-Za-z]+)\*?/g, (_, n) => params[n] ?? '');
}
const hostOk = (rule, host) => !rule.has || rule.has.every((h) => h.type !== 'host' || h.value === host);

const FUNCTIONS = new Set(['/api/render', '/api/sitemap', '/api/og', '/api/qr']);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
                '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.txt': 'text/plain', '.woff2': 'font/woff2' };

async function fromWebResponse(r) {
  return { status: r.status, headers: Object.fromEntries([...r.headers].map(([k, v]) => [k.toLowerCase(), v])),
           body: Buffer.from(await r.arrayBuffer()) };
}

/**
 * A request pipeline for this repo. Options:
 *   env        the deployment's environment (routing flag, Supabase public key...)
 *   supabase   createSupabase(db)
 *   shell      the SPA shell the render function carries (its build's index.html)
 *   distDir    a built dist folder to serve static files from (browser test);
 *              otherwise a tiny virtual filesystem (shell + a few generic files)
 *   now        clock for the resolvers' caches (both the middleware's and the functions')
 * handle({ method, url, headers }) -> { status, headers, body: Buffer, via }
 */
export function createPipeline({ env, supabase, shell, distDir = null, now = () => Date.now() }) {
  const fetchImpl = (u, init) => supabase.handle(u, init);
  const mwResolver = createResolver({ url: SB, anonKey: ANON, fetchImpl, now });
  const fnResolver = createResolver({ url: SB, anonKey: ANON, fetchImpl, now });
  const middleware = createMiddleware({ env, resolverFor: () => mwResolver });
  const virtualFiles = {
    '/index.html': shell, '/favicon.svg': '<svg/>', '/version.json': '{"v":"test"}',
    '/assets/app.js': 'console.log(1)', '/robots.txt': 'User-agent: *\nAllow: /\n', '/llms.txt': '# PocketLink',
  };

  function staticFile(pathname) {
    const p = pathname === '/' ? '/index.html' : pathname;
    if (distDir) {
      const f = join(distDir, decodeURIComponent(p));
      if (f.startsWith(distDir) && existsSync(f) && statSync(f).isFile()) {
        return { body: readFileSync(f), type: TYPES[extname(f)] || 'application/octet-stream' };
      }
      return null;
    }
    return p in virtualFiles ? { body: Buffer.from(virtualFiles[p]), type: TYPES[extname(p)] || 'text/plain' } : null;
  }

  async function invoke(pathWithQuery, host, method) {
    const u = new URL(pathWithQuery, `https://${host}`);
    const deps = { env, fetchImpl, shell, resolver: fnResolver };
    const out = { status: 200, headers: {}, body: Buffer.alloc(0) };
    const res = {
      setHeader: (k, v) => { out.headers[k.toLowerCase()] = String(v); },
      status: (c) => { out.status = c; return res; },
      send: (b) => { out.body = Buffer.from(String(b)); return res; },
      end: (b) => { if (b !== undefined) out.body = Buffer.from(String(b)); return res; },
    };
    const req = { method, headers: { host }, url: u.pathname + u.search };
    if (u.pathname === '/api/render') await renderHandler(req, res, deps);
    else if (u.pathname === '/api/sitemap') await sitemapHandler(req, res, deps);
    else if (u.pathname === '/api/og' || u.pathname === '/api/qr') {
      out.headers['content-type'] = 'text/plain';
      out.body = Buffer.from(`image-stub:${u.pathname}:${u.searchParams.get('slug') || ''}`);
    } else {
      return { status: 404, headers: {}, body: Buffer.from('no such function'), via: 'function' };
    }
    return { ...out, via: 'function' };
  }

  async function handle({ method = 'GET', url, headers = {} }) {
    const u = new URL(url);
    const host = u.host;
    // 1. Edge middleware (only on paths its matcher covers).
    const covered = !/^\/(assets|_vercel|api)\//.test(u.pathname) || ['/api/render', '/api/sitemap', '/api/og', '/api/qr'].includes(u.pathname);
    if (covered) {
      const mw = await middleware(new Request(u, { method, headers }));
      if (mw) {
        const rw = mw.headers.get('x-middleware-rewrite');
        if (rw) {
          const t = new URL(rw);
          return invoke(t.pathname + t.search, host, method);
        }
        return { ...(await fromWebResponse(mw)), via: 'middleware' };
      }
    }
    // 2. vercel.json redirects.
    for (const r of VERCEL_JSON.redirects || []) {
      const params = hostOk(r, host) ? matchRoute(r.source, u.pathname) : null;
      if (params) {
        const dest = substitute(r.destination, params);
        return { status: r.permanent ? 308 : 307, headers: { location: new URL(dest, u).toString() }, body: Buffer.alloc(0), via: 'redirect' };
      }
    }
    // 3. The filesystem: functions, then static files.
    if (FUNCTIONS.has(u.pathname)) return invoke(u.pathname + u.search, host, method);
    const file = staticFile(u.pathname);
    if (file) return { status: 200, headers: { 'content-type': file.type }, body: file.body, via: 'static' };
    // 4. vercel.json rewrites.
    for (const r of VERCEL_JSON.rewrites || []) {
      const params = matchRoute(r.source, u.pathname);
      if (!params) continue;
      const dest = substitute(r.destination, params);
      if (dest.startsWith('/api/')) return invoke(dest, host, method);
      const f = staticFile(dest.split('?')[0]);
      if (f) return { status: 200, headers: { 'content-type': f.type }, body: f.body, via: 'rewrite' };
    }
    return { status: 404, headers: {}, body: Buffer.from('not found'), via: 'none' };
  }

  return { handle, mwResolver, fnResolver };
}

/** Convenience: GET a URL through the pipeline, body as text. */
export async function get(pipeline, url, headers = {}) {
  const r = await pipeline.handle({ url, headers });
  return { ...r, text: r.body.toString('utf8') };
}
