// Every order, not just the newest 500 (supabase/orders-history-*.sql and
// src/utils/orderPages.js), executed in PGlite against the live get_store_orders.
//
// 2026-10-22: merchants past 500 orders could not open their older ones in
// Manage. get_store_orders still returns the newest 500 real orders; the app now
// pages back through get_store_orders_before until the store's first order.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { readAllOrders } from '../src/utils/orderPages.js';
import { DETAILED_ORDER_CAP, ABANDONED_ORDER_CAP } from '../src/utils/ordersView.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = (p) => readFileSync(`${ROOT}${p}`, 'utf8').replace(/\r\n/g, '\n');
const FORWARD = read('supabase/orders-history-forward.sql');
const ROLLBACK = read('supabase/orders-history-ROLLBACK.sql');
const VERIFY = read('supabase/orders-history-verify.sql');
const CAPS_FORWARD = read('supabase/orders-separate-caps-forward.sql');
/** get_store_orders as the PIN-bypass closure applied it; the separate-caps forward runs on top. */
const PIN_CLOSURE = (() => {
  const s = read('supabase/pin-bypass-closure-forward.sql');
  const i = s.indexOf('create or replace function public.get_store_orders(');
  return s.slice(i, s.indexOf('$function$;', i) + '$function$;'.length);
})();
const CAPS_MD5 = '412869d96684c8e66f2981e162005f4e';

async function world({ forward = true } = {}) {
  const db = new PGlite();
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin;
    create table public.orders (
      id uuid primary key default gen_random_uuid(), store_slug text not null, status text,
      total numeric, created_at timestamptz not null default now());
    create function public.verify_store_pin(p_slug text, p_hashed_pin text) returns boolean
      language sql volatile as $$ select p_hashed_pin = 'good' $$;`);
  await db.exec(PIN_CLOSURE);
  await db.exec('grant execute on function public.get_store_orders(text,text) to anon, authenticated');
  await db.exec(CAPS_FORWARD);
  if (forward) await db.exec(FORWARD);
  return db;
}
/** n rows for a store, `startMin` to `startMin + n - 1` minutes ago. */
async function seed(db, slug, n, status, startMin) {
  await db.query(`insert into public.orders (store_slug, status, total, created_at)
    select $1, $2, 100, now() - make_interval(mins => $3 + g) from generate_series(0, $4 - 1) g`, [slug, status, startMin, n]);
}

/** supabase.rpc over PGlite: named args in, { data, error } out. Counts calls. */
function rpcFor(db, { failOlderAfter = Infinity } = {}) {
  const calls = { get_store_orders: 0, get_store_orders_before: 0 };
  const rpc = async (fn, args) => {
    calls[fn] = (calls[fn] || 0) + 1;
    if (fn === 'get_store_orders_before' && calls[fn] > failOlderAfter) {
      return { data: null, error: { message: 'network' } };
    }
    try {
      // PostgREST hands timestamps over as text with full microseconds; the
      // cursor goes back exactly as it came, so keep that precision here.
      const sql = fn === 'get_store_orders'
        ? `select o.*, o.created_at::text as at_text from public.get_store_orders($1, $2) o`
        : `select o.*, o.created_at::text as at_text from public.get_store_orders_before($1, $2, $3, $4) o`;
      const params = fn === 'get_store_orders'
        ? [args.p_slug, args.p_hashed_pin]
        : [args.p_slug, args.p_hashed_pin, args.p_before_at, args.p_before_id];
      const { rows } = await db.query(sql, params);
      return { data: rows.map(({ at_text, ...r }) => ({ ...r, created_at: at_text })), error: null };
    } catch (e) {
      return { data: null, error: { message: e.message } };
    }
  };
  return { rpc, calls };
}
const isAbandoned = (s) => String(s ?? '').toLowerCase() === 'abandoned';
const ids = (rows) => rows.map((r) => r.id);
const verifyRows = async (db) => Object.fromEntries((await db.query(VERIFY)).rows.map((r) => [r.grp, r.result]));

// ═══════════════════════════════════════════════════════════════════════════

test('a store past 500 orders gets every one of them, once each', async () => {
  const db = await world();
  await seed(db, 'shop', 1234, 'confirmed', 0);
  await seed(db, 'shop', 400, 'abandoned', 0);
  await seed(db, 'other', 700, 'confirmed', 0);
  const { rpc, calls } = rpcFor(db);
  const rows = await readAllOrders(rpc, 'shop', 'good');
  const real = rows.filter((r) => !isAbandoned(r.status));
  assert.equal(real.length, 1234, 'every real order');
  assert.equal(rows.filter((r) => isAbandoned(r.status)).length, ABANDONED_ORDER_CAP, 'abandoned stay capped');
  assert.equal(new Set(ids(rows)).size, rows.length, 'no order twice');
  assert.ok(rows.every((r) => r.store_slug === 'shop'), 'never another store');
  assert.equal(rows.partial, undefined, 'complete');
  // 500 from get_store_orders, then 500, 234 (inclusive first step adds one duplicate).
  assert.equal(calls.get_store_orders, 1);
  assert.equal(calls.get_store_orders_before, 2);
  // Real orders come back newest first.
  const t = real.map((r) => Date.parse(r.created_at));
  assert.ok(t.every((v, i) => i === 0 || t[i - 1] >= v), 'newest first');
  await db.close();
});

test('a small store makes one request, exactly as before', async () => {
  const db = await world();
  await seed(db, 'shop', 120, 'new', 0);
  const { rpc, calls } = rpcFor(db);
  const rows = await readAllOrders(rpc, 'shop', 'good');
  assert.equal(rows.length, 120);
  assert.equal(calls.get_store_orders_before, 0, 'no paging under 500');
  await db.close();
});

test('exactly 500 orders: one short check for older ones, nothing duplicated', async () => {
  const db = await world();
  await seed(db, 'shop', DETAILED_ORDER_CAP, 'new', 0);
  const { rpc, calls } = rpcFor(db);
  const rows = await readAllOrders(rpc, 'shop', 'good');
  assert.equal(rows.length, DETAILED_ORDER_CAP);
  assert.equal(new Set(ids(rows)).size, DETAILED_ORDER_CAP);
  assert.equal(calls.get_store_orders_before, 1);
  await db.close();
});

test('orders sharing a timestamp across a page boundary are never skipped', async () => {
  const db = await world();
  await seed(db, 'shop', 480, 'new', 0);
  // 60 orders at ONE instant straddle the first page boundary, then 600 more
  // older ones put a second boundary on another shared instant. The instant
  // carries real microseconds (PGlite's clock alone has only milliseconds).
  const T = `date_trunc('milliseconds', now() - interval '1000 minutes') + interval '456 microseconds'`;
  await db.query(`insert into public.orders (store_slug, status, total, created_at)
    select 'shop', 'new', 100, ${T} from generate_series(1, 60)`);
  // And neighbours a few microseconds either side of it, which a cursor rounded
  // to milliseconds would drop.
  await db.query(`insert into public.orders (store_slug, status, total, created_at)
    select 'shop', 'new', 100, ${T} + make_interval(secs => g / 1000000.0)
      from generate_series(-3, 3) g where g <> 0`);
  await db.query(`insert into public.orders (store_slug, status, total, created_at)
    select 'shop', 'new', 100, now() - interval '2000 minutes' from generate_series(1, 600)`);
  const { rpc } = rpcFor(db);
  const rows = await readAllOrders(rpc, 'shop', 'good');
  assert.equal(rows.length, 1146);
  assert.equal(new Set(ids(rows)).size, 1146);
  assert.equal(rows.partial, undefined);
  await db.close();
});

test('a wrong PIN reads nothing, old or new', async () => {
  const db = await world();
  await seed(db, 'shop', 900, 'new', 0);
  const { rpc } = rpcFor(db);
  assert.deepEqual(await readAllOrders(rpc, 'shop', 'bad'), []);
  const older = await db.query(`select * from public.get_store_orders_before('shop', 'bad', now(), null)`);
  assert.equal(older.rows.length, 0, 'the paging function is PIN-gated too');
  await db.close();
});

test('a failed older page keeps the newest orders and says the list is partial', async () => {
  const db = await world();
  await seed(db, 'shop', 1700, 'new', 0);
  const { rpc } = rpcFor(db, { failOlderAfter: 1 });
  const rows = await readAllOrders(rpc, 'shop', 'good');
  assert.equal(rows.partial, true);
  assert.equal(rows.length, 999, 'the first page and the one older page that loaded');
  await db.close();
});

test('the database not having the paging function yet: newest 500, marked partial', async () => {
  const db = await world({ forward: false });
  await seed(db, 'shop', 800, 'new', 0);
  const { rpc } = rpcFor(db);
  const rows = await readAllOrders(rpc, 'shop', 'good');
  assert.equal(rows.length, DETAILED_ORDER_CAP);
  assert.equal(rows.partial, true);
  await db.close();
});

test('a failed first page is null, not an empty store', async () => {
  const rows = await readAllOrders(async () => ({ data: null, error: { message: 'x' } }), 'shop', 'good');
  assert.equal(rows, null);
});

test('the silent poll re-reads only the newest page and keeps the older orders', async () => {
  const db = await world();
  await seed(db, 'shop', 1100, 'new', 5);
  const full = rpcFor(db);
  const before = await readAllOrders(full.rpc, 'shop', 'good');
  assert.equal(before.length, 1100);
  await seed(db, 'shop', 3, 'new', 0);           // three new orders arrive
  const quick = rpcFor(db);
  const after = await readAllOrders(quick.rpc, 'shop', 'good', { reuse: before });
  assert.equal(quick.calls.get_store_orders_before, 0, 'no paging on the poll');
  assert.equal(after.length, 1103, 'the new ones on top, every older one kept');
  assert.equal(new Set(ids(after)).size, 1103);
  // A partial previous read is not trusted: the poll pages again.
  const partial = Object.assign([...before], { partial: true });
  const again = rpcFor(db);
  assert.equal((await readAllOrders(again.rpc, 'shop', 'good', { reuse: partial })).length, 1103);
  assert.ok(again.calls.get_store_orders_before > 0);
  await db.close();
});

// ── The migration itself ────────────────────────────────────────────────────

test('the forward adds one function and leaves get_store_orders alone', async () => {
  const db = await world({ forward: false });
  const md5 = async () => (await db.query(`select md5(replace(prosrc, chr(13), '')) as m from pg_proc
    where oid = 'public.get_store_orders(text,text)'::regprocedure`)).rows[0].m;
  assert.equal(await md5(), CAPS_MD5);
  await db.exec(FORWARD);
  await db.exec(FORWARD);                         // idempotent
  assert.equal(await md5(), CAPS_MD5, 'get_store_orders untouched');
  const v = await verifyRows(db);
  for (const k of ['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'H7']) assert.equal(v[k], 'PASS', `${k}: ${v[k]}`);
  await db.close();
});

test('the PIN check runs once, before any row, as every PIN-gated function does', () => {
  const body = FORWARD.slice(FORWARD.indexOf('as $function$'), FORWARD.indexOf('$function$;'));
  assert.match(body, /if not public\.verify_store_pin\(p_slug, p_hashed_pin\) then\s+return;/);
  assert.equal(/and\s+public\.verify_store_pin/i.test(body), false);
  assert.match(FORWARD, /\bvolatile\b/);
  assert.match(FORWARD, /security definer/);
  assert.match(FORWARD, /set search_path = public, pg_temp/);
  assert.match(FORWARD, /revoke all on function public\.get_store_orders_before\(text, text, timestamptz, uuid\) from public;/);
  assert.match(body, new RegExp(`limit ${DETAILED_ORDER_CAP}\\b`), 'pages are the same size as the first');
});

test('the rollback removes the function and nothing else', async () => {
  const db = await world();
  await db.exec(ROLLBACK);
  await db.exec(ROLLBACK);                        // idempotent
  assert.equal((await db.query(`select to_regprocedure('public.get_store_orders_before(text,text,timestamptz,uuid)') as f`)).rows[0].f, null);
  assert.ok((await db.query(`select to_regprocedure('public.get_store_orders(text,text)') as f`)).rows[0].f);
  await db.close();
});

test('the app reads through the pager', () => {
  const svc = read('src/utils/orderService.js');
  assert.match(svc, /readAllOrders\(\(fn, args\) => supabase\.rpc\(fn, args\), slug, hashed, \{ reuse \}\)/);
  assert.match(svc, /if \(rows\.partial\) out\.partial = true;/, 'partial survives the abandoned filter');
});
