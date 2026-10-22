// Abandoned carts, all time (supabase/abandoned-all-time-*.sql).
//
// 2026-10-22, founder: "remove the cap from everywhere - stats, orders and
// abandoned". Orders and Stats already page every order; the Abandoned tab
// listed only the last 30 days, and Customers -> Export took its leads from the
// newest 300 abandoned checkouts. get_store_abandoned_carts_since is the same
// rule as get_store_abandoned_carts over a window the caller picks (NULL = all
// time); the tab's "All time" and the export read it.
//
// The SQL runs here in PGlite; the screens are checked statically.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { buildContactRows } from '../src/utils/exportCustomers.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = (p) => readFileSync(`${ROOT}${p}`, 'utf8').replace(/\r\n/g, '\n');
/** Source with comments stripped — so a test never matches its own prose. */
const code = (p) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
const FORWARD = read('supabase/abandoned-all-time-forward.sql');
const ROLLBACK = read('supabase/abandoned-all-time-ROLLBACK.sql');
const VERIFY = read('supabase/abandoned-all-time-verify.sql');
const THIRTY = read('supabase/abandoned-carts-forward.sql');   // get_store_abandoned_carts, as live
const MD5 = 'c148f70a88bca87773d1b0986556bf4b';
const MD5_30 = 'c25c35db957bfbe7ad90abc9eea938dd';
const FN = 'public.get_store_abandoned_carts_since(text,text,timestamptz)';
const FN_30 = 'public.get_store_abandoned_carts(text,text)';
const DAY = 86400000;
const ago = (days, extraMs = 0) => new Date(Date.now() - days * DAY - extraMs).toISOString();

async function world({ install = true } = {}) {
  const db = new PGlite();
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin;
    create table public.orders (
      id uuid primary key default gen_random_uuid(), store_slug text not null, status text,
      customer_name text, customer_phone text, destination text, notes text, items jsonb,
      total numeric, created_at timestamptz not null default now());
    create function public.verify_store_pin(p_slug text, p_hashed_pin text) returns boolean
      language sql volatile as $$ select p_hashed_pin = 'good' $$;`);
  await db.exec(THIRTY);
  if (install) await db.exec(FORWARD);
  return db;
}
async function add(db, { slug = 'shop', status = 'abandoned', phone = '9000000001', name = 'Asha',
                         total = 100, at = ago(0), destination = 'Solapur',
                         items = [{ name: 'Agarbatti', qty: 1, price: total }] } = {}) {
  await db.query(`insert into public.orders (store_slug, status, customer_name, customer_phone, destination, notes, items, total, created_at)
    values ($1, $2, $3, $4, $5, 'note', $6::jsonb, $7, $8)`,
  [slug, status, name, phone, destination, JSON.stringify(items), total, at]);
}
const since = async (db, { slug = 'shop', pin = 'good', from = null } = {}) =>
  (await db.query('select * from public.get_store_abandoned_carts_since($1, $2, $3)', [slug, pin, from])).rows;
const thirty = async (db, slug = 'shop') =>
  (await db.query('select * from public.get_store_abandoned_carts($1, $2)', [slug, 'good'])).rows;
const fnState = async (db, sig = FN) => (await db.query(`
  select md5(replace(prosrc, chr(13), '')) as md5, provolatile::text as vol, prosecdef, proconfig,
         pg_get_function_result(oid) as ret, prosrc
    from pg_proc where oid = to_regprocedure($1)`, [sig])).rows[0];
const verifyRows = async (db) => Object.fromEntries((await db.query(VERIFY)).rows.map((r) => [r.grp, r.result]));
/** 00:00 IST 29 days ago -- get_store_abandoned_carts' own window start. */
const thirtyStart = async (db) => (await db.query(`select ((date_trunc('day', now() at time zone 'Asia/Kolkata')
  - interval '29 days') at time zone 'Asia/Kolkata') as t`)).rows[0].t;

// ═══════════════════════════════════════════════════════════════════════════

test('all time: a customer from 3 months ago is listed, where the 30-day feed stops', async () => {
  const db = await world();
  await add(db, { phone: '9000000001', name: 'Ravi', total: 150, at: ago(90) });
  await add(db, { phone: '9000000002', name: 'Meena', total: 250, at: ago(45) });
  await add(db, { phone: '9000000003', name: 'Asha', total: 350, at: ago(2) });
  assert.deepEqual((await thirty(db)).map((r) => r.customer_phone), ['9000000003']);
  const all = await since(db);
  assert.deepEqual(all.map((r) => r.customer_phone), ['9000000003', '9000000002', '9000000001'], 'newest first');
  assert.deepEqual(all.map((r) => Number(r.total)), [350, 250, 150]);
  await db.close();
});

test('the same rule: one row per customer, their latest cart, attempts over the window, ordered customers drop out', async () => {
  const db = await world();
  // Tried on four days across two months: one card, the latest cart, 4 attempts.
  for (const d of [70, 40, 10, 3]) await add(db, { phone: '9000000001', total: 100 + d, at: ago(d) });
  // Left a cart, then ordered: recovered, gone.
  await add(db, { phone: '9000000002', at: ago(60) });
  await add(db, { phone: '9000000002', status: 'new', at: ago(50) });
  // Ordered long ago, then left a cart: still to win back.
  await add(db, { phone: '9000000003', status: 'delivered', at: ago(80) });
  await add(db, { phone: '9000000003', total: 333, at: ago(35) });
  // Any status but abandoned is an order -- cancelled and NULL included, as everywhere.
  await add(db, { phone: '9000000004', at: ago(40) });
  await add(db, { phone: '9000000004', status: null, at: ago(39) });
  await add(db, { phone: '9000000005', at: ago(40) });
  await add(db, { phone: '9000000005', status: 'CANCELLED', at: ago(39) });
  // The edges of "since": an order an hour BEFORE the latest cart recovers
  // nothing; one at the very same instant does.
  await add(db, { phone: '9000000006', status: 'new', at: ago(30, 3600000) });
  await add(db, { phone: '9000000006', total: 66, at: ago(30) });
  const same = ago(25);
  await add(db, { phone: '9000000007', at: same });
  await add(db, { phone: '9000000007', status: 'new', at: same });
  const all = await since(db);
  assert.deepEqual(all.map((r) => r.customer_phone), ['9000000001', '9000000006', '9000000003']);
  assert.equal(all[0].attempts, 4);
  assert.equal(Number(all[0].total), 103, 'the latest cart');
  assert.equal(all[1].attempts, 1);
  await db.close();
});

test('with the 30-day boundary it returns exactly get_store_abandoned_carts', async () => {
  const db = await world();
  // 60 customers, random visits over 90 days, some ordering in between.
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  for (let c = 0; c < 60; c++) {
    const phone = String(9100000000 + c);
    const visits = 1 + Math.floor(rnd() * 5);
    for (let v = 0; v < visits; v++) {
      const status = rnd() < 0.2 ? 'new' : 'abandoned';
      await add(db, { phone, status, total: Math.round(rnd() * 900), at: ago(rnd() * 90) });
    }
  }
  // Right on the boundary, and one millisecond before it.
  const start = await thirtyStart(db);
  await add(db, { phone: '9200000001', at: new Date(start).toISOString() });
  await add(db, { phone: '9200000002', at: new Date(new Date(start).getTime() - 1).toISOString() });

  const strip = (rows) => rows.map(({ destination, ...r }) => ({ ...r, total: Number(r.total) }));
  const want = strip(await thirty(db));
  const got = strip(await since(db, { from: start }));
  assert.ok(want.length > 10, 'the sample covers the window');
  assert.deepEqual(got, want);
  assert.ok(want.some((r) => r.customer_phone === '9200000001'), 'the boundary instant is inside');
  assert.ok(!want.some((r) => r.customer_phone === '9200000002'), 'a millisecond before it is not');
  // And all time is a superset of it.
  const allPhones = new Set((await since(db)).map((r) => r.customer_phone));
  for (const r of want) assert.ok(allPhones.has(r.customer_phone), r.customer_phone);
  await db.close();
});

test('this store only, a phone number required, and a wrong PIN returns nothing', async () => {
  const db = await world();
  await add(db, { slug: 'shop', phone: '9000000001', at: ago(100) });
  await add(db, { slug: 'other', phone: '9000000002', at: ago(100) });
  await add(db, { slug: 'other', phone: '9000000001', status: 'new', at: ago(1) });   // another shop's order
  await add(db, { slug: 'shop', phone: '', at: ago(5) });
  await add(db, { slug: 'shop', phone: null, at: ago(5) });
  assert.deepEqual((await since(db)).map((r) => r.customer_phone), ['9000000001']);
  assert.deepEqual(await since(db, { pin: 'bad' }), []);
  assert.deepEqual(await since(db, { slug: 'nope' }), []);
  await db.close();
});

test('no row limit: 1,200 customers are 1,200 rows', async () => {
  const db = await world();
  await db.query(`insert into public.orders (store_slug, status, customer_phone, items, total, created_at)
    select 'shop', 'abandoned', (9300000000 + g)::text, '[]'::jsonb, 10, now() - (g || ' hours')::interval
      from generate_series(1, 1200) g`);
  assert.equal((await since(db)).length, 1200);
  await db.close();
});

test('it returns the 8 declared columns: the 30-day ones plus destination, no notes or tokens', async () => {
  const db = await world();
  await add(db, { destination: 'Navi Peth, Solapur - 413001', at: ago(40) });
  const [row] = await since(db);
  assert.deepEqual(Object.keys(row),
    ['id', 'created_at', 'customer_name', 'customer_phone', 'items', 'total', 'attempts', 'destination']);
  assert.equal(row.destination, 'Navi Peth, Solapur - 413001');
  await db.close();
});

test('forward: definer, pinned search_path, PIN check before any row, PUBLIC revoked, re-runs harmlessly', async () => {
  const db = await world();
  await db.exec(FORWARD);
  const s = await fnState(db);
  assert.equal(s.md5, MD5);
  assert.equal(s.vol, 'v');
  assert.equal(s.prosecdef, true);
  assert.deepEqual(s.proconfig, ['search_path=public, pg_temp']);
  assert.match(s.prosrc, /if not public\.verify_store_pin\(p_slug, p_hashed_pin\) then\s+return;/);
  assert.doesNotMatch(s.prosrc, /and (public\.)?verify_store_pin/);
  assert.doesNotMatch(s.prosrc, /\blimit\b/i, 'no row limit');
  const acl = (await db.query(`
    select coalesce(bool_or(x.grantee = 0), false) as pub,
           has_function_privilege('anon', $1, 'EXECUTE') as anon,
           has_function_privilege('authenticated', $1, 'EXECUTE') as auth
      from pg_proc p left join lateral aclexplode(p.proacl) x on true
     where p.oid = to_regprocedure($1)`, [FN])).rows[0];
  assert.deepEqual(acl, { pub: false, anon: true, auth: true });
  await db.close();
});

test('forward changes nothing that exists: the 30-day function keeps its md5', async () => {
  const db = await world({ install: false });
  assert.equal((await fnState(db, FN_30)).md5, MD5_30);
  await db.exec(FORWARD);
  assert.equal((await fnState(db, FN_30)).md5, MD5_30, 'get_store_abandoned_carts untouched');
  const ddl = FORWARD.replace(/--.*$/gm, '');
  assert.equal((ddl.match(/create or replace function/gi) || []).length, 1, 'one function, and only this one');
  assert.match(ddl, /create or replace function public\.get_store_abandoned_carts_since\(/);
  assert.doesNotMatch(ddl, /\b(create|alter|drop) (table|trigger|policy|index)\b|\b(insert|update|delete) /i);
  await db.close();
});

test('forward refuses a different function of the same name, a missing PIN check or column, and changes nothing', async () => {
  const other = await world({ install: false });
  await other.exec(`create function public.get_store_abandoned_carts_since(p_slug text, p_hashed_pin text, p_since timestamptz)
    returns setof public.orders language sql as $$ select * from public.orders $$`);
  const md5 = (await fnState(other)).md5;
  await assert.rejects(other.exec(FORWARD), /preflight: a different get_store_abandoned_carts_since/);
  await other.exec('rollback');                         // the aborted transaction, as the SQL editor ends it
  assert.equal((await fnState(other)).md5, md5, 'untouched');
  await other.close();

  const nopin = await world({ install: false });
  await nopin.exec('drop function public.verify_store_pin(text, text) cascade');
  await assert.rejects(nopin.exec(FORWARD), /preflight: public\.verify_store_pin/);
  await nopin.exec('rollback');
  assert.equal(await fnState(nopin), undefined);
  await nopin.close();

  const nocol = await world({ install: false });
  await nocol.exec('alter table public.orders drop column destination');
  await assert.rejects(nocol.exec(FORWARD), /preflight: public\.orders is missing a column/);
  await nocol.exec('rollback');
  assert.equal(await fnState(nocol), undefined);
  await nocol.close();
});

test('rollback drops only it, re-runs harmlessly, and refuses while a database function calls it', async () => {
  const db = await world();
  await db.exec(ROLLBACK);
  assert.equal(await fnState(db), undefined);
  assert.equal((await fnState(db, FN_30)).md5, MD5_30, 'the 30-day function stays');
  await db.exec(ROLLBACK);                              // nothing to drop: a notice, not an error
  await db.exec(FORWARD);
  await db.exec(`create function public.uses_it() returns int language plpgsql as $$
    begin perform * from public.get_store_abandoned_carts_since('x', 'y', null); return 1; end $$`);
  await assert.rejects(db.exec(ROLLBACK), /REFUSED - these functions call get_store_abandoned_carts_since: public\.uses_it/);
  await db.exec('rollback');
  assert.equal((await fnState(db)).md5, MD5, 'still installed');
  await db.close();
});

test('verifier: every A row passes after the forward; after the undo A1 fails and A5 still passes', async () => {
  const db = await world();
  await add(db, { slug: 'krupaagarbattiwork', phone: '9000000041', at: ago(60) });
  await add(db, { slug: 'krupaagarbattiwork', phone: '9000000041', at: ago(50) });
  await add(db, { slug: 'krupaagarbattiwork', phone: '9000000042', at: ago(2) });
  await add(db, { slug: 'krupaagarbattiwork', phone: '9000000043', at: ago(40) });
  await add(db, { slug: 'krupaagarbattiwork', phone: '9000000043', status: 'new', at: ago(39) });
  const v = await verifyRows(db);
  for (const c of ['A1', 'A2', 'A3', 'A4', 'A5']) assert.equal(v[c], 'PASS', c);
  assert.equal(v.I1, 'krupaagarbattiwork: 2 / 1');
  assert.equal(v.I2, '2 / 1', 'all time / last 30 days');
  // The verifier's restated rule agrees with the functions themselves.
  assert.equal((await since(db, { slug: 'krupaagarbattiwork' })).length, 2);
  assert.equal((await thirty(db, 'krupaagarbattiwork')).length, 1);
  assert.ok(VERIFY.includes(`'${MD5}'`) && FORWARD.includes(`'${MD5}'`), 'forward and verifier pin the same md5');
  await db.exec(ROLLBACK);
  const after = await verifyRows(db);
  assert.match(after.A1, /^FAIL - function missing/);
  assert.equal(after.A5, 'PASS');
  await db.close();
});

// ── the CSV export ──────────────────────────────────────────────────────────

test('export: buyers only - abandoned-cart customers are never in the CSV (abandoned-private, 2026-10-22)', () => {
  const orders = [
    { id: 'o1', status: 'delivered', customer_name: 'Ravi', customer_phone: '9000000001',
      total: 500, items: [{ name: 'Dhoop', qty: 1, price: 500 }], created_at: ago(200), paid: true },
    // Abandoned rows handed in by mistake are ignored, whatever their case.
    { id: 'a1', status: 'abandoned', customer_name: 'Meena', customer_phone: '9000000002', items: [], created_at: ago(2) },
    { id: 'a2', status: 'ABANDONED', customer_name: 'Asha', customer_phone: '9000000003', items: [], created_at: ago(1) },
  ];
  const rows = buildContactRows(orders);
  assert.deepEqual(rows.map((r) => [r.phone, r.type, r.orders]), [['919000000001', 'Customer', 1]]);
  assert.ok(!('abandoned' in rows[0]), 'no abandoned-cart count either');
});

// ── the screens ─────────────────────────────────────────────────────────────

test('fetchAbandonedCarts: all time reads the new function with no window; the default is unchanged', () => {
  const svc = code('src/utils/orderService.js');
  assert.match(svc, /export async function fetchAbandonedCarts\(slug, pin, \{ allTime = false \} = \{\}\)/);
  assert.match(svc, /\['get_store_abandoned_carts_since', \{ p_slug: slug, p_hashed_pin: hashed, p_since: null \}\]/);
  assert.match(svc, /: \['get_store_abandoned_carts', \{ p_slug: slug, p_hashed_pin: hashed \}\]/);
  // Read page by page: the API stops at 1,000 rows a request (rpc-pages.test.mjs).
  assert.match(svc, /readAllRpcRows\(\(withCount\) =>\s+supabase\.rpc\(fn, args, withCount \? \{ count: 'exact' \} : undefined\)\)/);
  // Home still reads the 30 days, so its number equals the tab's default.
  assert.match(code('src/components/manage/OverviewTab.jsx'), /fetchAbandonedCarts\(slug, pin\)/);
});

test('the Abandoned tab: opens on the 30 days, "All time" is one tap, read once, and a failure is a retry card', () => {
  const tab = code('src/components/manage/AbandonedTab.jsx');
  assert.match(tab, /const RANGES = \[\['30d', `Last \$\{ABANDONED_WINDOW_DAYS\} days`\], \['all', 'All time'\]\];/);
  assert.match(tab, /const \[range, setRange\] = useState\('30d'\);/);
  assert.match(tab, /if \(range !== 'all' \|\| allResult\) return undefined;/, 'read the first time it is opened');
  assert.match(tab, /fetchAbandonedCarts\(slug, pin, \{ allTime: true \}\)/);
  assert.match(tab, /RANGES\.map\(/, 'both chips are rendered');
  assert.match(tab, /const filtered = filter === 'all' \? listed : listed\.filter\(/, 'the cards are the chosen window');
  assert.match(tab, /const counts = reminderCounts\(listed, byCart, now\);/);
  assert.match(tab, /Older abandoned carts unavailable/);
  assert.match(tab, /onClick=\{\(\) => setAllResult\(null\)\}/, 'Try again re-reads all time');
  // Reminders stay on the 30-day list the server sends to.
  assert.match(tab, /\{rows\.length > 0 && \(\s*<RecoveryCard[^>]*sample=\{rows\[0\]\}/);
  assert.ok(!/\.slice\(0,\s*\d+\)/.test(tab), 'no literal cut-off');
});

test('Customers -> Export reads the orders only, never the abandoned carts', () => {
  const tab = code('src/components/manage/CustomersTab.jsx');
  assert.match(tab, /const rows = buildContactRows\(await fetchOrders\(slug, pin\)\);/);
  assert.ok(!/fetchAbandonedCarts/.test(tab), 'abandoned-cart customers are PocketLink\u2019s to reach');
  assert.ok(!/includeAbandoned: true/.test(tab));
});
