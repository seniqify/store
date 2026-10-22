// Reading every row of a set-returning RPC (src/utils/rpcPages.js).
//
// 2026-10-22, krupaagarbattiwork: Stats said 429 orders, the database 964. The
// Supabase API returns at most 1,000 rows per request (PostgREST max-rows) and
// does not say when it cuts; get_store_order_facts returns newest first with
// abandoned checkouts in it, and her newest 1,000 rows were mostly abandoned.
// Home, Payments and Delivery read the same feed.
//
// The fake below behaves like PostgREST: ORDER BY + OFFSET/LIMIT, the limit
// clamped to max-rows, and an exact count only when asked for. The paging was
// also checked against the live API on the showme store (page size 10).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readAllRpcRows, readAllRowsOrEmpty, newestFirst, RPC_PAGE_SIZE } from '../src/utils/rpcPages.js';
import { buildStatsMetrics } from '../src/utils/statsMetrics.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const code = (p) => readFileSync(`${ROOT}${p}`, 'utf8').replace(/\r\n/g, '\n')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const NOW = Date.parse('2026-10-22T06:30:00Z');
const DAY = 86400000;
let seq = 0;
const row = (over = {}) => ({
  id: `00000000-0000-0000-0000-${String(++seq).padStart(12, '0')}`,
  created_at: new Date(NOW - DAY).toISOString(),
  status: 'new', payment_method: 'cod', total: 300, paid: false, paid_at: null, paid_via: null,
  payment_ref: null, payment_link_id: null, awb: null, courier: null, shipment_status: null,
  shipment_outcome: null, delivered_at: null, returned_at: null,
  ...over,
});

const cmp = (order) => (a, b) => {
  for (const [col, asc] of order) {
    const x = a[col], y = b[col];
    if (x === y) continue;
    return (x < y ? -1 : 1) * (asc ? 1 : -1);
  }
  return 0;
};

/** PostgREST in miniature, over a live array (so a test can change it mid-read). */
function api(rows, { maxRows = 1000, countSupported = true, failPage = -1, beforePage } = {}) {
  const log = [];
  const call = (withCount) => {
    const q = { order: [] };
    const b = {
      order(col, { ascending }) { q.order.push([col, ascending]); return b; },
      async range(from, to) {
        const page = log.length;
        beforePage?.(page, rows);
        log.push({ from, to, withCount, order: [...q.order] });
        if (page === failPage) return { data: null, error: { message: 'boom' }, count: null };
        // The function's own order (newest first) when the caller sets none.
        const sorted = [...rows].sort(cmp(q.order.length ? q.order : [['created_at', false], ['id', false]]));
        const limit = Math.min(to - from + 1, maxRows);
        return { data: sorted.slice(from, from + limit), error: null,
                 count: withCount && countSupported ? rows.length : null };
      },
    };
    return b;
  };
  /** One plain call, the way the app read it before: newest first, max-rows. */
  call.plain = () => [...rows].sort(cmp([['created_at', false], ['id', false]])).slice(0, maxRows);
  call.log = log;
  return call;
}

/** A store like Krupa: 1,009 orders since July, and 1,200 abandoned checkouts in the last 25 days. */
function krupa() {
  const rows = [];
  for (let i = 0; i < 1009; i++) {
    const kind = i % 1009 < 31 ? 'cancelled' : i < 45 ? 'unpaid' : 'sale';
    rows.push(row({
      created_at: new Date(NOW - (i / 1009) * 108 * DAY).toISOString(),
      status: kind === 'cancelled' ? 'cancelled' : 'new',
      payment_method: kind === 'unpaid' ? 'online' : 'cod',
    }));
  }
  for (let i = 0; i < 1200; i++) {
    rows.push(row({ status: 'abandoned', created_at: new Date(NOW - (i / 1200) * 25 * DAY).toISOString() }));
  }
  return rows;
}

// ═══════════════════════════════════════════════════════════════════════════

test('the Krupa case: one call stops at 1,000 rows and Stats undercounts; paged, every order counts', async () => {
  const rows = krupa();
  const call = api(rows);
  const before = buildStatsMetrics(call.plain(), { now: NOW });
  assert.ok(before.orders < 964, `one call counted ${before.orders} orders`);

  const { data, error } = await readAllRpcRows(call);
  assert.equal(error, null);
  assert.equal(data.length, rows.length, 'all 2,209 rows');
  const after = buildStatsMetrics(data, { now: NOW });
  assert.equal(after.orders, 964, 'every order the store sold');
  assert.equal(call.log.length, 3, '1,000 + 1,000 + 209');
  assert.deepEqual(call.log.map((p) => p.withCount), [true, false, false], 'the total is counted once');
  assert.deepEqual(call.log[0].order, [['created_at', true], ['id', true]], 'oldest first, ties by id');
});

test('a server cap below the page size cannot end the read early', async () => {
  const rows = krupa();
  const { data, error } = await readAllRpcRows(api(rows, { maxRows: 300 }));
  assert.equal(error, null);
  assert.equal(data.length, rows.length);
  assert.equal(new Set(data.map((r) => r.id)).size, rows.length, 'no row twice');
});

test('without a count it reads until an empty page', async () => {
  const rows = krupa();
  const call = api(rows, { countSupported: false });
  const { data, error } = await readAllRpcRows(call);
  assert.equal(error, null);
  assert.equal(data.length, rows.length);
  assert.equal(call.log.at(-1).from, rows.length, 'the last request found nothing');
});

test('a failed page fails the whole read: never a short total', async () => {
  for (const failPage of [0, 1, 2]) {
    const { data, error } = await readAllRpcRows(api(krupa(), { failPage }));
    assert.equal(data, null, `page ${failPage}`);
    assert.equal(error?.message, 'boom', 'the server error itself, not a guess from the count');
  }
  const thrown = await readAllRpcRows(() => ({ order() { return this; }, range: async () => { throw new Error('offline'); } }));
  assert.equal(thrown.data, null);
  assert.match(String(thrown.error?.message), /offline/);
});

test('fewer rows than the database counted is a failure, not an answer', async () => {
  const rows = krupa();
  // A row disappears between the count and the last page: everything after it
  // moves up one place and one row is never read.
  const call = api(rows, { beforePage: (page, live) => { if (page === 1) live.splice(0, 1); } });
  const { data, error } = await readAllRpcRows(call);
  assert.equal(data, null);
  assert.match(String(error?.message), /read \d+ of 2209 rows/);
});

test('an order placed during the read neither duplicates nor shifts what is counted', async () => {
  const rows = krupa();
  const before = new Set(rows.map((r) => r.id));
  const fresh = row({ created_at: new Date(NOW).toISOString() });
  const call = api(rows, { beforePage: (page, live) => { if (page === 1) live.push(fresh); } });
  const { data, error } = await readAllRpcRows(call);
  assert.equal(error, null);
  const ids = data.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length, 'no row twice');
  for (const id of before) assert.ok(ids.includes(id), 'every row that existed is there');
  // Oldest first, so the new order lands on the last page and is simply counted too.
  assert.deepEqual(ids.filter((id) => !before.has(id)), [fresh.id]);
});

test('a small store is one request; an empty one or a wrong PIN is an empty list', async () => {
  const small = Array.from({ length: 33 }, () => row());
  const call = api(small);
  assert.equal((await readAllRpcRows(call)).data.length, 33);
  assert.equal(call.log.length, 1);
  const none = await readAllRpcRows(api([]));
  assert.deepEqual(none, { data: [], error: null });
  assert.equal(RPC_PAGE_SIZE, 1000);
});

test('newestFirst restores the order the functions return', () => {
  const a = row({ created_at: '2026-10-01T00:00:00Z', id: 'a' });
  const b = row({ created_at: '2026-10-02T00:00:00Z', id: 'b' });
  const c = row({ created_at: '2026-10-02T00:00:00Z', id: 'c' });
  assert.deepEqual(newestFirst([a, b, c]).map((r) => r.id), ['c', 'b', 'a']);
});

// ── the app ─────────────────────────────────────────────────────────────────

test('the totals feed and the abandoned-cart feed are read page by page', () => {
  const svc = code('src/utils/orderService.js');
  assert.match(svc, /import \{ readAllRpcRows, newestFirst \} from '\.\/rpcPages\.js';/);
  assert.match(svc, /readAllRpcRows\(\(withCount\) =>\s+supabase\.rpc\('get_store_order_facts', \{ p_slug: slug, p_hashed_pin: hashed \},\s+withCount \? \{ count: 'exact' \} : undefined\)\)/);
  assert.match(svc, /readAllRpcRows\(\(withCount\) =>\s+supabase\.rpc\(fn, args, withCount \? \{ count: 'exact' \} : undefined\)\)/);
  // No other single, unpaged read of either feed.
  assert.equal((svc.match(/rpc\('get_store_order_facts'/g) || []).length, 1);
  assert.ok(!/await supabase\.rpc\('get_store_abandoned_carts/.test(svc));
});

// ── parallel pages, other keys, and the founder screens ─────────────────────

test('after the first page the rest are read a few at a time, and kept in order', async () => {
  const rows = Array.from({ length: 12500 }, (_, i) => row({ created_at: new Date(NOW - (12500 - i) * 60000).toISOString() }));
  let inFlight = 0, peak = 0;
  const base = api(rows);
  const call = (withCount) => {
    const b = base(withCount);
    const range = b.range;
    b.range = async (from, to) => {
      inFlight++; peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 2));
      try { return await range(from, to); } finally { inFlight--; }
    };
    return b;
  };
  const { data, error } = await readAllRpcRows(call);
  assert.equal(error, null);
  assert.equal(data.length, 12500, 'a week of views across every store - the Hub asked for 10,000 and got 1,000');
  assert.deepEqual(data.map((r) => r.id), rows.map((r) => r.id), 'oldest first, nothing out of place');
  assert.ok(peak > 1 && peak <= 4, `pages in flight at once: ${peak}`);
});

test('rows keyed by another column (stores by slug) are each kept once', async () => {
  const stores = Array.from({ length: 2300 }, (_, i) => ({
    slug: `shop-${String(i).padStart(4, '0')}`, created_at: new Date(NOW - (2300 - i) * DAY).toISOString(),
  }));
  // A store backdated mid-read shifts every later row one place: the row at a
  // page boundary comes back twice, and only its slug can tell.
  const call = api(stores, { beforePage: (page, live) => {
    if (page === 1) live.push({ slug: 'shop-early', created_at: new Date(NOW - 9999 * DAY).toISOString() });
  } });
  const { data, error } = await readAllRpcRows(call, { order: [['created_at', true], ['slug', true]], key: 'slug' });
  assert.equal(error, null);
  assert.equal(data.length, 2300, 'nothing twice');
  assert.equal(new Set(data.map((s) => s.slug)).size, 2300);
});

test('readAllRowsOrEmpty: every row, or [] when a page fails - as those screens did before', async () => {
  assert.equal((await readAllRowsOrEmpty(api(krupa()))).length, 2209);
  assert.deepEqual(await readAllRowsOrEmpty(api(krupa(), { failPage: 1 })), []);
  assert.deepEqual(await readAllRowsOrEmpty(() => { throw new Error('no client'); }), []);
});

test('the Console and Sales Hub read every row: no .limit(), every list paged, newest first where it was', () => {
  for (const f of ['src/utils/consoleService.js', 'src/utils/hubService.js']) {
    const src = code(f);
    assert.ok(!/\.limit\(/.test(src), `${f}: no .limit() - the API clamps it to 1,000 anyway`);
    assert.match(src, /import \{ readAllRowsOrEmpty, newestFirst \} from '\.\/rpcPages\.js';/);
  }
  const con = code('src/utils/consoleService.js');
  const hub = code('src/utils/hubService.js');
  const paged = (src, fn) => new RegExp(String.raw`export async function ${fn}\([^)]*\) \{\s+return (newestFirst\(await )?readAllRowsOrEmpty\(\(withCount\) => supabase`).test(src);
  for (const fn of ['fetchStoresConsole', 'fetchConsoleOrders']) assert.ok(paged(con, fn), fn);
  for (const fn of ['listLeads', 'fetchStoresLite', 'fetchRecentOrders', 'fetchViewsSince']) assert.ok(paged(hub, fn), fn);
  for (const [src, fn] of [[con, 'fetchConsoleOrders'], [hub, 'listLeads'], [hub, 'fetchRecentOrders']]) {
    assert.match(src, new RegExp(String.raw`export async function ${fn}\([^)]*\) \{\s+return newestFirst\(`), `${fn} stays newest first`);
  }
  assert.equal((con + hub).match(/withCount \? \{ count: 'exact' \} : undefined/g).length, 6, 'each of the 6 lists asks for its total');
  assert.match(hub, /\.select\('id, store_slug, viewed_on'/, 'views carry their id, so a row is never counted twice');
  // Stores have no id column: they page by created_at + slug and dedupe by slug.
  const storeOpts = /\{ order: \[\['created_at', true\], \['slug', true\]\], key: 'slug' \}\);/g;
  assert.equal((con.match(storeOpts) || []).length, 1, 'Console stores');
  assert.equal((hub.match(storeOpts) || []).length, 1, 'Hub stores');
});
