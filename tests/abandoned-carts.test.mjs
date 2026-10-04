// Abandoned carts, one number everywhere (supabase/abandoned-carts-*.sql).
//
// 2026-10-04, krupaagarbattiwork: Home said "406 abandoned carts", the Abandoned
// tab said 50. Home counted every abandoned ROW in 30 days (the checkout records
// one per phone per day, and customers who later ordered stayed in); the tab
// de-duplicated recovered customers from the capped list and cut it to 50.
// Both screens now read get_store_abandoned_carts: one row per customer who
// reached checkout in the last 30 IST days and has not ordered since.
//
// The SQL runs here in PGlite; the screens are checked statically.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import {
  summarizeAbandoned, ABANDONED_WINDOW_DAYS, ABANDONED_PAGE_SIZE,
} from '../src/utils/abandonedCarts.js';
import { dayKeysBetween } from '../src/utils/commerceMetrics.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = (p) => readFileSync(`${ROOT}${p}`, 'utf8').replace(/\r\n/g, '\n');
/** Source with comments stripped — so a test never matches its own prose. */
const code = (p) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
const FORWARD = read('supabase/abandoned-carts-forward.sql');
const ROLLBACK = read('supabase/abandoned-carts-ROLLBACK.sql');
const VERIFY = read('supabase/abandoned-carts-verify.sql');
/** get_store_orders as it is live today, to prove the forward leaves it alone. */
const LIVE_ORDERS = (() => {
  const s = read('supabase/pin-bypass-closure-forward.sql');
  const i = s.indexOf('create or replace function public.get_store_orders(');
  return s.slice(i, s.indexOf('$function$;', i) + '$function$;'.length);
})();
const MD5 = 'c25c35db957bfbe7ad90abc9eea938dd';
const FN = 'public.get_store_abandoned_carts(text,text)';
const TZ = 'Asia/Kolkata';
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
  await db.exec(LIVE_ORDERS);
  if (install) await db.exec(FORWARD);
  return db;
}
async function add(db, { slug = 'shop', status = 'abandoned', phone = '9000000001', name = 'Asha',
                         total = 100, at = ago(0), items = [{ name: 'Agarbatti', qty: 1, price: total }] } = {}) {
  await db.query(`insert into public.orders (store_slug, status, customer_name, customer_phone, destination, notes, items, total, created_at)
    values ($1, $2, $3, $4, 'Solapur', 'note', $5::jsonb, $6, $7)`,
  [slug, status, name, phone, JSON.stringify(items), total, at]);
}
const carts = async (db, slug = 'shop', pin = 'good') =>
  (await db.query('select * from public.get_store_abandoned_carts($1, $2)', [slug, pin])).rows;
const fnState = async (db, sig = FN) => (await db.query(`
  select md5(replace(prosrc, chr(13), '')) as md5, provolatile::text as vol, prosecdef, proconfig,
         pg_get_function_result(oid) as ret, prosrc
    from pg_proc where oid = to_regprocedure($1)`, [sig])).rows[0];
const verifyRows = async (db) => Object.fromEntries((await db.query(VERIFY)).rows.map((r) => [r.grp, r.result]));

// ═══════════════════════════════════════════════════════════════════════════

test('the krupaagarbattiwork case: one row per customer, not one per visit, and ordered customers drop out', async () => {
  const db = await world();
  // 12 abandoned rows -- what Home used to call "12 abandoned carts".
  for (let d = 5; d >= 1; d--) await add(db, { phone: '9000000001', name: 'Ravi', total: 100 + d, at: ago(d) });
  await add(db, { phone: '9000000002', total: 200, at: ago(3) });
  await add(db, { phone: '9000000003', total: 300, at: ago(4) });
  await add(db, { phone: '9000000004', total: 400, at: ago(6) });
  // Came twice, then ordered: recovered.
  await add(db, { phone: '9000000005', total: 500, at: ago(3) });
  await add(db, { phone: '9000000005', total: 500, at: ago(2) });
  await add(db, { phone: '9000000005', status: 'confirmed', total: 500, at: ago(1) });
  // Abandoned, ordered, then abandoned AGAIN: still to win back, from the latest cart.
  await add(db, { phone: '9000000006', total: 600, at: ago(10) });
  await add(db, { phone: '9000000006', status: 'delivered', total: 600, at: ago(8) });
  await add(db, { phone: '9000000006', total: 650, at: ago(2) });

  const rows = await carts(db);
  assert.deepEqual(rows.map((r) => r.customer_phone),
    ['9000000001', '9000000006', '9000000002', '9000000003', '9000000004'], 'five customers, newest attempt first');
  const ravi = rows[0];
  assert.equal(ravi.attempts, 5, 'five visits are one customer who tried five times');
  assert.equal(Number(ravi.total), 101, "the cart is the customer's LATEST one");
  assert.equal(rows[1].attempts, 2);
  assert.equal(Number(rows[1].total), 650);

  const sum = summarizeAbandoned(rows);
  assert.equal(sum.count, 5, 'Home and the tab both show 5 -- not 12, not a capped slice');
  assert.equal(sum.value, 101 + 650 + 200 + 300 + 400);
  assert.equal(sum.attempts, 10);
  await db.close();
});

test('recovery: an order at or after the latest attempt recovers; one before it does not', async () => {
  const db = await world();
  const t = ago(2);
  await add(db, { phone: '9111111111', at: t });
  await add(db, { phone: '9111111111', status: 'new', at: t });                                  // same instant
  await add(db, { phone: '9222222222', at: t });
  await add(db, { phone: '9222222222', status: 'new', at: new Date(Date.parse(t) - 1000).toISOString() });
  assert.deepEqual((await carts(db)).map((r) => r.customer_phone), ['9222222222']);
  await db.close();
});

test("the app's rule for an order: anything not abandoned, in any case -- cancelled and null included", async () => {
  const db = await world();
  // Abandoned in any case is still a cart...
  await add(db, { phone: '9000000011', status: 'Abandoned', at: ago(3) });
  await add(db, { phone: '9000000011', status: 'ABANDONED', at: ago(2) });
  // ...and any other status after it, even cancelled or null, means they did order.
  await add(db, { phone: '9000000012', at: ago(3) });
  await add(db, { phone: '9000000012', status: 'cancelled', at: ago(2) });
  await add(db, { phone: '9000000013', at: ago(3) });
  await add(db, { phone: '9000000013', status: null, at: ago(2) });
  const rows = await carts(db);
  assert.deepEqual(rows.map((r) => [r.customer_phone, r.attempts]), [['9000000011', 2]]);
  await db.close();
});

test('the window is 30 merchant civil days ending today: from 00:00 IST 29 days ago', async () => {
  const db = await world();
  // The first day of the window, computed independently of the SQL.
  const firstKey = dayKeysBetween(Date.now() - (ABANDONED_WINDOW_DAYS - 1) * DAY, Date.now(), TZ)
    .slice(-ABANDONED_WINDOW_DAYS)[0];
  const start = Date.parse(`${firstKey}T00:00:00+05:30`);
  await add(db, { phone: '9000000021', at: new Date(start).toISOString() });           // first instant: in
  await add(db, { phone: '9000000022', at: new Date(start - 1000).toISOString() });    // 23:59:59 the day before: out
  await add(db, { phone: '9000000023', at: ago(0) });                                  // today: in
  // An old attempt does not count toward attempts, or bring the customer back.
  await add(db, { phone: '9000000023', at: new Date(start - 5 * DAY).toISOString() });
  const rows = await carts(db);
  assert.deepEqual(rows.map((r) => r.customer_phone).sort(), ['9000000021', '9000000023']);
  assert.equal(rows.find((r) => r.customer_phone === '9000000023').attempts, 1);
  assert.equal(ABANDONED_WINDOW_DAYS, 30);
  assert.match(FORWARD, /date_trunc\('day', now\(\) at time zone 'Asia\/Kolkata'\) - interval '29 days'\) at time zone 'Asia\/Kolkata'/,
    'the SQL window is the same 30 days the screens say');
  await db.close();
});

test('this store only, a phone number required, and another store\'s order recovers nothing', async () => {
  const db = await world();
  await add(db, { slug: 'other', phone: '9000000031', at: ago(1) });
  await add(db, { phone: '9000000032', at: ago(2) });
  await add(db, { slug: 'other', phone: '9000000032', status: 'new', at: ago(1) });
  await add(db, { phone: '', at: ago(1) });
  await add(db, { phone: null, at: ago(1) });
  assert.deepEqual((await carts(db)).map((r) => r.customer_phone), ['9000000032']);
  await db.close();
});

test('a wrong PIN returns nothing', async () => {
  const db = await world();
  await add(db, { at: ago(1) });
  assert.deepEqual(await carts(db, 'shop', 'wrong'), []);
  await db.close();
});

test('no row limit: 700 customers are 700 rows', async () => {
  const db = await world();
  await db.query(`insert into public.orders (store_slug, status, customer_phone, items, total, created_at)
    select 'shop', 'abandoned', (9000000000 + g)::text, '[]'::jsonb, 10, now() - make_interval(mins => g)
      from generate_series(1, 700) g`);
  assert.equal((await carts(db)).length, 700);
  assert.doesNotMatch(FORWARD.slice(FORWARD.indexOf('create or replace function')), /\blimit\b/i);
  await db.close();
});

test('it returns the 7 declared columns and nothing else: no address, notes or tokens', async () => {
  const db = await world();
  await add(db, { at: ago(1) });
  const [row] = await carts(db);
  assert.deepEqual(Object.keys(row), ['id', 'created_at', 'customer_name', 'customer_phone', 'items', 'total', 'attempts']);
  assert.deepEqual(row.items, [{ name: 'Agarbatti', qty: 1, price: 100 }], 'items arrive as the array the tab maps');
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
  const acl = (await db.query(`
    select coalesce(bool_or(x.grantee = 0), false) as pub,
           has_function_privilege('anon', $1, 'EXECUTE') as anon,
           has_function_privilege('authenticated', $1, 'EXECUTE') as auth
      from pg_proc p left join lateral aclexplode(p.proacl) x on true
     where p.oid = to_regprocedure($1)`, [FN])).rows[0];
  assert.deepEqual(acl, { pub: false, anon: true, auth: true });
  await db.close();
});

test('forward changes nothing that exists', async () => {
  const db = await world({ install: false });
  const before = await fnState(db, 'public.get_store_orders(text,text)');
  await db.exec(FORWARD);
  assert.equal((await fnState(db, 'public.get_store_orders(text,text)')).md5, before.md5, 'get_store_orders untouched');
  const ddl = FORWARD.replace(/--.*$/gm, '');
  assert.equal((ddl.match(/create or replace function/gi) || []).length, 1, 'one function, and only this one');
  assert.match(ddl, /create or replace function public\.get_store_abandoned_carts\(/);
  assert.doesNotMatch(ddl, /\b(create|alter|drop) (table|trigger|policy|index)\b|\b(insert|update|delete) /i);
  await db.close();
});

test('forward refuses a different function of the same name, or a missing PIN check, and changes nothing', async () => {
  const other = await world({ install: false });
  await other.exec(`create function public.get_store_abandoned_carts(p_slug text, p_hashed_pin text)
    returns table (id uuid, created_at timestamptz, customer_name text, customer_phone text, items jsonb, total numeric, attempts integer)
    language sql as $$ select null::uuid, null::timestamptz, null, null, null::jsonb, null::numeric, null::integer where false $$`);
  const md5 = (await fnState(other)).md5;
  await assert.rejects(other.exec(FORWARD), /preflight: a different get_store_abandoned_carts/);
  await other.exec('rollback');                         // the aborted transaction, as the SQL editor ends it
  assert.equal((await fnState(other)).md5, md5, 'untouched');
  await other.close();

  const nopin = await world({ install: false });
  await nopin.exec('drop function public.verify_store_pin(text, text) cascade');
  await assert.rejects(nopin.exec(FORWARD), /preflight: public\.verify_store_pin/);
  await nopin.exec('rollback');
  assert.equal(await fnState(nopin), undefined);
  await nopin.close();
});

test('rollback drops it, re-runs harmlessly, and refuses while a database function calls it', async () => {
  const db = await world();
  await db.exec(ROLLBACK);
  assert.equal(await fnState(db), undefined);
  await db.exec(ROLLBACK);                              // nothing to drop: a notice, not an error
  await db.exec(FORWARD);
  await db.exec(`create function public.uses_it() returns int language plpgsql as $$
    begin perform * from public.get_store_abandoned_carts('x', 'y'); return 1; end $$`);
  await assert.rejects(db.exec(ROLLBACK), /REFUSED - these functions call get_store_abandoned_carts: public\.uses_it/);
  await db.exec('rollback');
  assert.equal((await fnState(db)).md5, MD5, 'still installed');
  await db.close();
});

test('verifier: every C row passes after the forward, and C1 fails without it', async () => {
  const db = await world();
  for (let d = 3; d >= 1; d--) await add(db, { slug: 'krupaagarbattiwork', phone: '9000000041', at: ago(d) });
  await add(db, { slug: 'krupaagarbattiwork', phone: '9000000042', at: ago(2) });
  await add(db, { slug: 'krupaagarbattiwork', phone: '9000000042', status: 'new', at: ago(1) });
  const v = await verifyRows(db);
  for (const c of ['C1', 'C2', 'C3', 'C4']) assert.equal(v[c], 'PASS', c);
  assert.equal(v.I1, 'krupaagarbattiwork: 4 / 2 / 1');
  assert.equal(v.I2, '4 / 2 / 1', 'checkouts / customers / still to win back');
  // The verifier's restated rule agrees with the function itself.
  assert.equal((await carts(db, 'krupaagarbattiwork')).length, 1);
  await db.exec(ROLLBACK);
  assert.match((await verifyRows(db)).C1, /^FAIL - function missing/);
  await db.close();
});

// ── the shared summary ──────────────────────────────────────────────────────

test('summarizeAbandoned: rupee-exact, at least one attempt each, and safe on junk', () => {
  assert.deepEqual(summarizeAbandoned([{ total: 0.1 }, { total: '0.2' }, { total: 'x', attempts: 3 }]),
    { count: 3, value: 0.3, attempts: 5 });
  assert.deepEqual(summarizeAbandoned([{ total: 10, attempts: 0 }, { total: 5, attempts: null }]),
    { count: 2, value: 15, attempts: 2 });
  for (const junk of [null, undefined, 'x', {}]) {
    assert.deepEqual(summarizeAbandoned(junk), { count: 0, value: 0, attempts: 0 });
  }
});

// ── the screens ─────────────────────────────────────────────────────────────

test('Home and the Abandoned tab read the same feed and the same summary', () => {
  const home = code('src/components/manage/OverviewTab.jsx');
  const tab = code('src/components/manage/AbandonedTab.jsx');
  for (const [name, src] of [['Home', home], ['Abandoned tab', tab]]) {
    assert.match(src, /fetchAbandonedCarts\(slug, pin\)/, `${name} reads get_store_abandoned_carts`);
    assert.match(src, /summarizeAbandoned\(/, `${name} counts through the shared summary`);
  }
  assert.match(home, /title: `\$\{carts\.count\} abandoned/, 'Home shows the summary count');
  assert.match(tab, /\{sum\.count\}<\/span>/, 'the tab header shows the same count');
});

test('the Abandoned tab has no hidden cap: a page size with "Show more", and no capped list', () => {
  const tab = code('src/components/manage/AbandonedTab.jsx');
  assert.ok(!/fetchOrders\b/.test(tab), 'it no longer reads the capped get_store_orders list');
  assert.ok(!/\.slice\(0,\s*\d+\)/.test(tab), 'no literal cut-off such as .slice(0, 50)');
  assert.match(tab, /filtered\.slice\(0, visible\)/, 'the (filtered) list pages; nothing cuts it');
  assert.match(tab, /setVisible\(\(v\) => v \+ ABANDONED_PAGE_SIZE\)/);
  assert.match(tab, /Showing \{shown\.length\} of \{filtered\.length\} customers/);
  assert.equal(ABANDONED_PAGE_SIZE, 50);
  // A failed read is a retry card, never an empty "nothing abandoned".
  assert.match(tab, /if \(!result\.ok\) \{/);
  assert.match(tab, /onClick=\{load\}/);
});
