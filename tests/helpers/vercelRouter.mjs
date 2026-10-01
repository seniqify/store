// Runs a Vercel route table -- the "routes" of .vercel/output/config.json, as
// `vercel build` compiles vercel.json and the middleware matcher (see
// tests/fixtures/vercel-routes.json and scripts/vercel-routes-fixture.mjs) --
// the way Vercel's router answered on production (www.pocketlink.store,
// 2026-09-30, curl --path-as-is):
//
//   * Every route `src` is matched against the RAW path, still percent-encoded,
//     case-sensitively (/%73itemap.xml and /SITEMAP.XML miss the /sitemap.xml
//     rewrite; /%73ell and /SELL miss the /sell redirect). `has` host: exact.
//   * A path with an empty segment is first 308'd to the collapsed path (/x//y).
//   * Vercel's own Web Analytics paths (/_vercel/insights/*) are answered by the
//     platform before any route; any other /_vercel/* path is routed as usual.
//   * Phase null, in order: redirects, header routes (continue), and the
//     middleware route -- so vercel.json's redirects run BEFORE the middleware.
//     The middleware answers, rewrites the path, or lets routing continue.
//   * The filesystem: a function or a static file, looked up by the DECODED
//     path (/api/%6fg and /api/og%2F reach api/og.js), also with one trailing
//     slash (/api/og/, /favicon.svg/). Dot segments are never resolved: the raw
//     path keeps them (/api/./og and /assets/%2e%2e/favicon.svg find nothing).
//   * The middleware, though, gets a WHATWG Request, whose URL has its dot
//     segments resolved: for /x/../favicon.svg it sees /favicon.svg while the
//     router goes on with the raw path.
//   * On a miss: the `miss` routes (/api/og.js -> /api/og), then the routes
//     after { handle: 'filesystem' } in order. A `check` route looks its
//     destination up in the filesystem; a `status` route answers.
//   * Nothing left: the `error` routes -- 404, /404.html if there is one, else
//     Vercel's plain-text NOT_FOUND.
//
// It is only what this repo's routing depends on -- not all of Vercel.

export const VERCEL_NOT_FOUND = 'The page could not be found\n\nNOT_FOUND\n';

function phases(routes) {
  const out = { null: [], filesystem: [], miss: [], error: [] };
  let phase = 'null';
  for (const r of routes) {
    if (r.handle) { phase = r.handle; out[phase] ??= []; continue; }
    (out[phase] ??= []).push(r);
  }
  return out;
}

const hasOk = (route, host) => (route.has || []).every((h) => h.type !== 'host' || h.value === host);
const subst = (template, m) => template.replace(/\$(\d+)/g, (_, i) => m[Number(i)] ?? '');

/** The decoded path, or null when it has a dot segment or cannot be decoded. */
export function decodedPath(raw) {
  let p;
  try { p = decodeURIComponent(raw); } catch { return null; }
  return p.split('/').some((s) => s === '.' || s === '..') ? null : p;
}

/**
 * createRouter({ routes, middleware, isFunction, isFile, middlewareCaseInsensitive })
 *   routes      the compiled route table
 *   middleware  async (Request) -> Response | undefined     (the real middleware.js)
 *   isFunction  (decodedPath) -> boolean                    a serverless/edge function exists there
 *   isFile      (decodedPath) -> boolean                    a static file exists there
 *   middlewareCaseInsensitive  match the middleware route's src ignoring case
 *               (production showed routes are case-sensitive; tests use this
 *               to show nothing depends on it)
 * route({ method, url, headers }) ->
 *   { kind: 'platform' }                                      Vercel answers it (Web Analytics)
 *   { kind: 'middleware', response }                          the middleware answered
 *   { kind: 'redirect', status, location }
 *   { kind: 'function', path, search, rewritten }             call this function (decoded path)
 *   { kind: 'file', path, rewritten }                         serve this static file (decoded path)
 *   { kind: 'status', status }                                a status route (Vercel's own /api 404)
 *   { kind: 'notFound', file }                                the error phase (file: '/404.html' or null)
 * with `headers`: headers the header routes added. `rewritten`: reached through
 * a route after the filesystem check (a vercel.json rewrite, or /api/x.js).
 */
export function createRouter({ routes, middleware, isFunction, isFile, middlewareCaseInsensitive = false }) {
  const P = phases(routes);

  function fsLookup(pathname) {
    const d = decodedPath(pathname);
    if (d === null) return null;
    for (const p of d.length > 1 && d.endsWith('/') ? [d, d.slice(0, -1)] : [d]) {
      if (isFunction(p)) return { kind: 'function', path: p };
      const f = p === '/' ? '/index.html' : p;
      if (!f.endsWith('/') && isFile(f)) return { kind: 'file', path: f };
    }
    return null;
  }

  // A destination: its path looked up in the filesystem, its query ahead of the request's.
  function destination(dest, m, search) {
    const u = new URL(subst(dest, m), 'https://x');
    const q = new URLSearchParams(u.search);
    for (const [k, v] of new URLSearchParams(search)) q.append(k, v);
    const s = q.toString();
    return { pathname: u.pathname, search: s ? `?${s}` : '' };
  }

  return async function route({ method = 'GET', url, headers = {} }) {
    // The raw path, exactly as sent: new URL() would resolve its dot segments.
    const [, origin, host, rawPath, rawSearch] = /^(https?:\/\/([^/?#]+))([^?#]*)(\?[^#]*)?/.exec(url);
    const raw = rawPath || '/';
    let search = rawSearch || '';
    const added = {};

    if (/\/\/+/.test(raw)) return { kind: 'redirect', status: 308, location: raw.replace(/\/\/+/g, '/') + search, headers: added };
    if (/^\/_vercel\/(insights|speed-insights)\//.test(raw)) return { kind: 'platform', headers: added };

    let path = raw;
    for (const r of P.null) {
      if (!r.src) continue;
      const m = new RegExp(r.src, r.middlewarePath && middlewareCaseInsensitive ? 'i' : '').exec(path);
      if (!m || !hasOk(r, host)) continue;
      if (r.middlewarePath) {
        const res = await middleware(new Request(`${origin}${path}${search}`, { method, headers }));
        if (res === undefined) continue;
        const rw = res.headers.get('x-middleware-rewrite');
        if (!rw) return { kind: 'middleware', response: res, headers: added };
        const t = new URL(rw);
        path = t.pathname; search = t.search;
        continue;
      }
      if (r.status >= 300 && r.status < 400 && r.headers?.Location) {
        return { kind: 'redirect', status: r.status, location: subst(r.headers.Location, m), headers: added };
      }
      if (r.headers) Object.assign(added, Object.fromEntries(Object.entries(r.headers).map(([k, v]) => [k.toLowerCase(), v])));
      if (!r.continue) break;
    }

    const hit = fsLookup(path);
    if (hit) return { ...hit, search, rewritten: false, headers: added };

    for (const r of P.miss) {
      const m = new RegExp(r.src).exec(path);
      if (!m) continue;
      const d = destination(r.dest, m, search);
      const again = r.check ? fsLookup(d.pathname) : null;
      if (again) return { ...again, search: d.search, rewritten: true, headers: added };
    }

    for (const r of P.filesystem) {
      const m = new RegExp(r.src).exec(path);
      if (!m || !hasOk(r, host)) continue;
      if (r.status && !r.dest) return { kind: 'status', status: r.status, headers: added };
      if (!r.dest) continue;
      const d = destination(r.dest, m, search);
      const found = fsLookup(d.pathname);
      if (found) return { ...found, search: d.search, rewritten: true, headers: added };
      if (!r.check) break;
    }

    for (const r of P.error) {
      if (r.src && !new RegExp(r.src).test(path)) continue;
      return { kind: 'notFound', file: r.dest && isFile(r.dest) ? r.dest : null, headers: added };
    }
    return { kind: 'notFound', file: null, headers: added };
  };
}
