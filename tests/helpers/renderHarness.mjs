// Shared harness for api/render.js tests: a mocked fetch (base HTML + Supabase
// REST), a fake Vercel req/res, and the matrix of every route render.js serves
// on a PocketLink host. Used by tests/custom-domain-groundwork.test.mjs and by
// the one-off generator that froze tests/fixtures/render-snapshots.json from the
// code as it was BEFORE the custom-domain groundwork.

export const SB_URL = 'https://sb.test';
export const SB_ANON = 'anon-key';

export const STORE = {
  slug: 'krupaagarbattiwork',
  config: {
    businessName: 'Krupa Agarbatti Work',
    tagline: 'Hand-rolled agarbatti from Solapur',
    category: 'Pooja Essentials',
    city: 'Solapur',
    state: 'Maharashtra',
    whatsappNumber: '919876543210',
    businessType: 'product',
    coverImage: 'https://img.example/cover.jpg',
    theme: { primary: '#b45309' },
    cart: { shippingCharge: 40 },
    categories: [
      { id: 'all', label: 'All Products' },
      { id: 'dhoop', label: 'Dhoop Sticks' },
      { id: 'agarbatti', label: 'Agarbatti Packs' },
    ],
    products: [
      { id: 'prod-1', name: 'Mogra Agarbatti', price: 120, category: 'agarbatti', image: 'https://img.example/mogra.jpg' },
      { id: 'prod-2', name: 'Sandal Dhoop', price: 90, category: 'dhoop', description: 'Slow-burning sandal dhoop.' },
      { id: 'prod-3', name: 'Combo Pack', category: 'agarbatti',
        variants: { options: [{ label: 'Small', price: 150 }, { label: 'Large', price: 280 }] } },
    ],
  },
};

const MARKET = [
  { slug: 'krupaagarbattiwork', name: 'Krupa Agarbatti Work', tagline: 'Hand-rolled agarbatti', category: 'Pooja Essentials', city: 'Solapur' },
  { slug: 'royalfoodsmasale', name: 'Royal Foods & Spices', tagline: null, category: 'Grocery', city: 'Solapur' },
  { slug: 'noname', name: null, tagline: null, category: null, city: null },
];

/**
 * A fetch that answers the base-HTML request and the Supabase REST calls
 * render.js makes, and records every URL it was asked for.
 * `supabaseDown` makes every Supabase call throw; `baseDown` makes the base
 * HTML fetch fail.
 */
export function makeFetch(baseHtml, { supabaseDown = false, baseDown = false } = {}) {
  const seen = [];
  const json = (v) => ({ ok: true, status: 200, json: async () => v, text: async () => JSON.stringify(v) });
  const fetchImpl = async (input) => {
    const url = String(input);
    seen.push(url);
    if (url.endsWith('/index.html')) {
      if (baseDown) return { ok: false, status: 502, text: async () => 'bad gateway' };
      return { ok: true, status: 200, text: async () => baseHtml };
    }
    if (url.startsWith(SB_URL)) {
      if (supabaseDown) throw new Error('supabase unreachable');
      const u = new URL(url);
      if (u.pathname === '/rest/v1/stores' && u.searchParams.get('slug')) {
        const slug = u.searchParams.get('slug').replace(/^eq\./, '');
        if (slug === STORE.slug) return json([{ slug: STORE.slug, config: STORE.config }]);
        if (slug === 'nonamestore') return json([{ slug: 'nonamestore', config: { tagline: 'no name yet' } }]);
        return json([]);
      }
      if (u.pathname === '/rest/v1/stores') return json(MARKET);
      if (u.pathname === '/rest/v1/product_reviews') return json([{ rating: 5 }, { rating: 4 }, { rating: 4 }]);
      return json([]);
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  return { fetchImpl, seen };
}

/** Vercel's system variables naming this project's own URLs (see api/render.js). */
export const VERCEL_HOST_VARS = ['VERCEL_URL', 'VERCEL_BRANCH_URL', 'VERCEL_PROJECT_PRODUCTION_URL'];

/**
 * Run fn with the VERCEL_* host variables set to EXACTLY `env` — any not named
 * are unset — then restore them. Keeps every test independent of the machine
 * (or Vercel build) the suite runs on.
 */
export async function withVercelEnv(env, fn) {
  const prev = Object.fromEntries(VERCEL_HOST_VARS.map((k) => [k, process.env[k]]));
  for (const k of VERCEL_HOST_VARS) {
    if (env?.[k] === undefined) delete process.env[k]; else process.env[k] = env[k];
  }
  try {
    return await fn();
  } finally {
    for (const k of VERCEL_HOST_VARS) {
      if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k];
    }
  }
}

/** Run render.js's handler for one request; returns { status, headers, body }. */
export async function runHandler(handler, { host, url, env }, fetchImpl) {
  const prevFetch = globalThis.fetch;
  const prevEnv = { url: process.env.VITE_SUPABASE_URL, anon: process.env.VITE_SUPABASE_ANON_KEY };
  process.env.VITE_SUPABASE_URL = SB_URL;
  process.env.VITE_SUPABASE_ANON_KEY = SB_ANON;
  globalThis.fetch = fetchImpl;
  const out = { status: 200, headers: {}, body: '' };
  const res = {
    setHeader: (k, v) => { out.headers[k.toLowerCase()] = String(v); },
    status: (c) => { out.status = c; return res; },
    send: (b) => { out.body = String(b); return res; },
    end: (b) => { if (b !== undefined) out.body = String(b); return res; },
  };
  try {
    await withVercelEnv(env, () => handler({ headers: host === undefined ? {} : { host }, url }, res));
  } finally {
    globalThis.fetch = prevFetch;
    process.env.VITE_SUPABASE_URL = prevEnv.url;
    process.env.VITE_SUPABASE_ANON_KEY = prevEnv.anon;
  }
  return out;
}

const WWW = 'www.pocketlink.store';
// This branch's preview URL. Vercel names it in VERCEL_BRANCH_URL on that deployment.
export const PREVIEW = 'store-git-custom-domains-seniqifys-projects.vercel.app';
const r = (path) => `/api/render?path=${path}`;

/** Every route render.js serves on a PocketLink host (name → request + fetch options). */
export const POCKETLINK_CASES = [
  { name: 'store',                     host: WWW, url: r('/krupaagarbattiwork') },
  { name: 'store, trailing slash',     host: WWW, url: r('/krupaagarbattiwork/') },
  { name: 'store, mixed-case path',    host: WWW, url: r('/KrupaAgarbattiWork') },
  { name: 'store, direct pathname',    host: WWW, url: '/krupaagarbattiwork' },
  { name: 'product',                   host: WWW, url: r('/krupaagarbattiwork/p/prod-2') },
  { name: 'product, variants',         host: WWW, url: r('/krupaagarbattiwork/p/prod-3') },
  { name: 'product, unknown id',       host: WWW, url: r('/krupaagarbattiwork/p/nope') },
  { name: 'category by label slug',    host: WWW, url: r('/krupaagarbattiwork/c/dhoop-sticks') },
  { name: 'category by id',            host: WWW, url: r('/krupaagarbattiwork/c/agarbatti') },
  { name: 'category, unknown',         host: WWW, url: r('/krupaagarbattiwork/c/nope') },
  { name: 'marketplace',               host: WWW, url: r('/marketplace') },
  { name: 'explore',                   host: WWW, url: r('/explore') },
  { name: 'unknown store',             host: WWW, url: r('/nosuchstore') },
  { name: 'store without a name',      host: WWW, url: r('/nonamestore') },
  { name: 'reserved path',             host: WWW, url: r('/start') },
  { name: 'manage path',               host: WWW, url: r('/krupaagarbattiwork/manage') },
  { name: 'deep unknown path',         host: WWW, url: r('/krupaagarbattiwork/x/y') },
  { name: 'root',                      host: WWW, url: r('/') },
  { name: 'supabase down',             host: WWW, url: r('/krupaagarbattiwork'), opts: { supabaseDown: true } },
  { name: 'no host header',            host: undefined, url: r('/krupaagarbattiwork') },
  { name: 'apex host',                 host: 'pocketlink.store', url: r('/krupaagarbattiwork') },
  { name: 'market host, marketplace',  host: 'market.pocketlink.store', url: r('/marketplace') },
  { name: 'preview deployment',        host: PREVIEW, url: r('/krupaagarbattiwork/p/prod-1'),
    env: { VERCEL_BRANCH_URL: PREVIEW } },
];

/** The static canonical index.html ships with (the duplicate this PR removes). */
export const STATIC_CANONICAL = '<link rel="canonical" href="https://www.pocketlink.store/" />';

export const canonicals = (html) => [...html.matchAll(/<link\b[^>]*\brel=["']?canonical["']?[^>]*>/gi)].map((m) => m[0]);
export const canonicalHref = (tag) => (tag.match(/href="([^"]*)"/) || [])[1];
