// get_store_orders with separate caps (supabase/orders-separate-caps-*.sql),
// executed in PGlite against the live PIN-bypass-closure version it replaces.
//
// 2026-10-03, krupaagarbattiwork: the old function returned the newest 500 rows
// of every kind, so abandoned checkouts pushed real orders older than ~10 days
// out of Manage's Orders, Customers, Delivery and Payments lists.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { DETAILED_ORDER_CAP, ABANDONED_ORDER_CAP } from '../src/utils/ordersView.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = (p) => readFileSync(`${ROOT}${p}`, 'utf8').replace(/\r\n/g, '\n');
const FORWARD = read('supabase/orders-separate-caps-forward.sql');
const ROLLBACK = read('supabase/orders-separate-caps-ROLLBACK.sql');
const VERIFY = read('supabase/orders-separate-caps-verify.sql');
/** The live definition, exactly as applied from the PIN-bypass closure. */
const LIVE = (() => {
  const s = read('supabase/pin-bypass-closure-forward.sql');
  const i = s.indexOf('create or replace function public.get_store_orders(');
  return s.slice(i, s.indexOf('$function$;', i) + '$function$;'.length);
})();
const OLD_MD5 = '8aa6bbfaee3ccfa85e3871bd3d61b8aa';
const NEW_MD5 = '412869d96684c8e66f2981e162005f4e';

async function world({ live = true } = {}) {
  const db = new PGlite();
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create table public.orders (
      id uuid primary key default gen_random_uuid(), store_slug text not null, status text,
      total numeric, created_at timestamptz not null default now());
    create function public.verify_store_pin(p_slug text, p_hashed_pin text) returns boolean
      language sql volatile as $$ select p_hashed_pin = 'good' $$;`);
  if (live) {
    await db.exec(LIVE);
    await db.exec('grant execute on function public.get_store_orders(text,text) to anon, authenticated');
  }
  return db;
}
/** n rows for a store, `startMin` to `startMin + n - 1` minutes ago. */
async function seed(db, slug, n, status, startMin) {
  await db.query(`insert into public.orders (store_slug, status, total, created_at)
    select $1, $2, 100, now() - make_interval(mins => $3 + g) from generate_series(0, $4 - 1) g`, [slug, status, startMin, n]);
}
const call = async (db, slug, pin = 'good') =>
  (await db.query('select id, store_slug, status, created_at from public.get_store_orders($1, $2)', [slug, pin])).rows;
const fnState = async (db) => (await db.query(`
  select md5(replace(prosrc, chr(13), '')) as md5, provolatile::text as vol, prosecdef, proconfig,
         coalesce(array_to_string(proacl, ','), '') as acl, pg_get_function_result(oid) as ret
    from pg_proc where oid = 'public.get_store_orders(text,text)'::regprocedure`)).rows[0];
const isAbandoned = (s) => String(s ?? '').toLowerCase() === 'abandoned';
const verifyRows = async (db) => Object.fromEntries((await db.query(VERIFY)).rows.map((r) => [r.grp, r.result]));

// ═══════════════════════════════════════════════════════════════════════════

test('the krupaagarbattiwork case: abandoned checkouts no longer push real orders out', async () => {
  const db = await world();
  await seed(db, 'krupa', 305, 'confirmed', 2000);        // 305 real orders, older
  await seed(db, 'krupa', 600, 'abandoned', 1);           // 600 abandoned checkouts, newer
  const before = await call(db, 'krupa');
  assert.equal(before.length, 500);
  assert.equal(before.filter((r) => !isAbandoned(r.status)).length, 0, 'the live version shows NO real order');
  await db.exec(FORWARD);
  const after = await call(db, 'krupa');
  assert.equal(after.filter((r) => !isAbandoned(r.status)).length, 305, 'every real order comes back');
  assert.equal(after.filter((r) => isAbandoned(r.status)).length, ABANDONED_ORDER_CAP);
  await db.close();
});

test('separate caps: the newest 500 real orders and the newest 300 abandoned, newest first, this store only', async () => {
  const db = await world();
  await seed(db, 'shop', 700, 'new', 0);
  await seed(db, 'shop', 400, 'abandoned', 0);
  await seed(db, 'other', 50, 'new', 0);
  await db.exec(FORWARD);
  const rows = await call(db, 'shop');
  const orders = rows.filter((r) => !isAbandoned(r.status));
  const abandoned = rows.filter((r) => isAbandoned(r.status));
  assert.equal(orders.length, DETAILED_ORDER_CAP);
  assert.equal(abandoned.length, ABANDONED_ORDER_CAP);
  assert.ok(rows.every((r) => r.store_slug === 'shop'), 'never another store');
  const times = rows.map((r) => new Date(r.created_at).getTime());
  assert.deepEqual(times, [...times].sort((a, b) => b - a), 'newest first, both kinds together');
  // They are the NEWEST of each kind.
  const newestOrders = (await db.query(`select id from public.orders where store_slug = 'shop' and status = 'new'
    order by created_at desc limit 500`)).rows.map((r) => r.id).sort();
  assert.deepEqual(orders.map((r) => r.id).sort(), newestOrders);
  await db.close();
});

test('the same rule as the app (classifyOrder): abandoned in any case; null and every other status is an order', async () => {
  const db = await world();
  for (const s of ['Abandoned', 'ABANDONED', 'abandoned']) await seed(db, 'shop', 1, s, 0);
  for (const s of [null, 'cancelled', 'new', 'delivered', '']) await seed(db, 'shop', 1, s, 0);
  await db.exec(FORWARD);
  const rows = await call(db, 'shop');
  assert.equal(rows.length, 8);
  assert.equal(rows.filter((r) => isAbandoned(r.status)).length, 3);
  // 500 real orders with odd statuses still count against the ORDER cap, not the abandoned one.
  await seed(db, 'odd', 520, null, 0);
  assert.equal((await call(db, 'odd')).length, 500);
  await db.close();
});

test('a wrong PIN still returns nothing', async () => {
  const db = await world();
  await seed(db, 'shop', 10, 'new', 0);
  await db.exec(FORWARD);
  assert.deepEqual(await call(db, 'shop', 'wrong'), []);
  await db.close();
});

test('forward: applies on the live version, re-runs harmlessly, and keeps every attribute and grant', async () => {
  const db = await world();
  const before = await fnState(db);
  assert.equal(before.md5, OLD_MD5, 'the test starts from the live definition');
  await db.exec(FORWARD);
  await db.exec(FORWARD);
  const after = await fnState(db);
  assert.equal(after.md5, NEW_MD5);
  for (const k of ['vol', 'prosecdef', 'acl', 'ret']) assert.deepEqual(after[k], before[k], k);
  assert.deepEqual(after.proconfig, ['search_path=public, pg_temp']);
  assert.equal(after.vol, 'v');
  assert.equal(after.prosecdef, true);
  // The PIN-bypass rule: the check runs once, before any row -- never inside a WHERE.
  const src = (await db.query(`select prosrc from pg_proc where oid = 'public.get_store_orders(text,text)'::regprocedure`)).rows[0].prosrc;
  assert.match(src, /if not public\.verify_store_pin\(p_slug, p_hashed_pin\) then/);
  assert.doesNotMatch(src, /and (public\.)?verify_store_pin/);
  await db.close();
});

test('forward refuses anything but the reviewed versions, and changes nothing', async () => {
  const other = await world();
  await other.exec(`create or replace function public.get_store_orders(p_slug text, p_hashed_pin text)
    returns setof public.orders language sql as $$ select * from public.orders where false $$`);
  const md5 = (await fnState(other)).md5;
  await assert.rejects(other.exec(FORWARD), /preflight/);
  await other.exec('rollback');                         // the aborted transaction, as the SQL editor ends it
  assert.equal((await fnState(other)).md5, md5, 'untouched');
  await other.close();
  const none = await world({ live: false });
  await assert.rejects(none.exec(FORWARD), /does not exist/);
  await none.close();
});

test('rollback restores the live version exactly; re-runs harmlessly; refuses an unexpected version', async () => {
  const db = await world();
  const live = await fnState(db);
  await db.exec(FORWARD);
  await db.exec(ROLLBACK);
  await db.exec(ROLLBACK);
  assert.deepEqual(await fnState(db), live);
  await seed(db, 'krupa', 5, 'confirmed', 2000);          // older than every abandoned checkout
  await seed(db, 'krupa', 600, 'abandoned', 1);
  assert.equal((await call(db, 'krupa')).filter((r) => !isAbandoned(r.status)).length, 0, 'the old behaviour, exactly');
  await db.exec(`create or replace function public.get_store_orders(p_slug text, p_hashed_pin text)
    returns setof public.orders language sql as $$ select * from public.orders where false $$`);
  await assert.rejects(db.exec(ROLLBACK), /preflight/);
  await db.exec('rollback');
  await db.close();
});

test('verifier: every check PASS after the forward; C1 FAIL before it', async () => {
  const db = await world();
  await seed(db, 'shop', 3, 'new', 0);
  assert.match((await verifyRows(db)).C1, /^FAIL/);
  await db.exec(FORWARD);
  const r = await verifyRows(db);
  for (const k of ['C1', 'C2', 'C3', 'C4']) assert.equal(r[k], 'PASS', `${k}: ${r[k]}`);
  assert.equal(r.I1, '0');
  assert.equal(r.I2, '3 / 0');
  await db.close();
});

test('the app\'s limits are the SQL\'s limits', () => {
  const body = FORWARD.slice(FORWARD.indexOf('create or replace function'));
  assert.match(body, /<> 'abandoned'\s+order by o\.created_at desc\s+limit (\d+)/);
  assert.equal(Number(body.match(/<> 'abandoned'\s+order by o\.created_at desc\s+limit (\d+)/)[1]), DETAILED_ORDER_CAP);
  assert.equal(Number(body.match(/= 'abandoned'\s+order by o\.created_at desc\s+limit (\d+)/)[1]), ABANDONED_ORDER_CAP);
});
