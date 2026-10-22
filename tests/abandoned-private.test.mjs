// Abandoned carts stay private (supabase/abandoned-private-*.sql).
//
// 2026-10-22, founder: shops copied abandoned customers' numbers out of Manage
// and messaged them by hand, so nobody topped up the wallet. Only PocketLink may
// know an abandoned customer's number; the shop reaches them through the paid
// reminder. Hiding it on screen is not enough - the browser received it - so the
// four PIN-checked functions that handed it over stop doing so.
//
// The SQL runs here in PGlite, starting from the live versions (installed from
// the files that installed them); the screens are checked statically.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { statusMap, reminderFor, cartReminderState, reminderCounts, MANUAL_MAX_AGE_DAYS } from '../src/utils/reminderStatus.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = (p) => readFileSync(`${ROOT}${p}`, 'utf8').replace(/\r\n/g, '\n');
/** Source with comments stripped — so a test never matches its own prose. */
const code = (p) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
const FORWARD = read('supabase/abandoned-private-forward.sql');
const ROLLBACK = read('supabase/abandoned-private-ROLLBACK.sql');
const VERIFY = read('supabase/abandoned-private-verify.sql');
const fnBlock = (src, head) => {
  const i = src.indexOf(head);
  return src.slice(i, src.indexOf('$function$;', src.indexOf('as $function$', i)) + '$function$;'.length);
};
// The live versions, from the files that installed them.
const LIVE = [
  fnBlock(read('supabase/orders-separate-caps-forward.sql'), 'create or replace function public.get_store_orders('),
  read('supabase/abandoned-carts-forward.sql'),
  read('supabase/abandoned-all-time-forward.sql'),
  fnBlock(read('supabase/messages-v2-forward.sql'), 'create or replace function public.cart_reminder_statuses('),
  `grant execute on function public.get_store_orders(text, text) to anon, authenticated, service_role;
   revoke all on function public.cart_reminder_statuses(text, text) from public, anon, authenticated;
   grant execute on function public.cart_reminder_statuses(text, text) to anon, authenticated, service_role;`,
];
const SIGS = {
  orders: 'public.get_store_orders(text,text)',
  carts: 'public.get_store_abandoned_carts(text,text)',
  since: 'public.get_store_abandoned_carts_since(text,text,timestamptz)',
  statuses: 'public.cart_reminder_statuses(text,text)',
};
const md5sIn = (sql) => [...sql.matchAll(/'([0-9a-f]{32})'/g)].map((m) => m[1]);
const DAY = 86400000;
const ago = (days) => new Date(Date.now() - days * DAY).toISOString();

async function world() {
  const db = new PGlite();
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin;
    create table public.orders (
      id uuid primary key default gen_random_uuid(), store_slug text not null, status text,
      customer_name text, customer_phone text, destination text, notes text, items jsonb,
      total numeric, payment_method text, created_at timestamptz not null default now());
    create table public.cart_reminders (
      id uuid primary key default gen_random_uuid(), store_slug text, phone text, abandoned_order_id uuid,
      status text, source text, sent_at timestamptz, clicked_at timestamptz, ordered_at timestamptz,
      created_at timestamptz not null default now());
    create function public.verify_store_pin(p_slug text, p_hashed_pin text) returns boolean
      language sql volatile as $$ select p_hashed_pin = 'good' $$;`);
  for (const sql of LIVE) await db.exec(sql);
  return db;
}
async function add(db, { slug = 'shop', status = 'abandoned', phone = '9000000001', name = 'Asha',
                         total = 100, at = ago(1), destination = 'Navi Peth, Solapur - 413001' } = {}) {
  return (await db.query(`insert into public.orders (store_slug, status, customer_name, customer_phone, destination, items, total, created_at)
    values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8) returning id`,
  [slug, status, name, phone, destination, JSON.stringify([{ name: 'Agarbatti', qty: 1, price: total }]), total, at])).rows[0].id;
}
async function remind(db, { slug = 'shop', phone, cart, at = ago(0.5) }) {
  await db.query(`insert into public.cart_reminders (store_slug, phone, abandoned_order_id, status, source, sent_at, created_at)
    values ($1, $2, $3, 'sent', 'manual', $4, $4)`, [slug, phone, cart, at]);
}
/** What the shop's browser receives from all four functions. */
async function shopSees(db, slug = 'shop', pin = 'good') {
  const q = async (sql) => (await db.query(sql, [slug, pin])).rows;
  return {
    orders: await q('select * from public.get_store_orders($1, $2)'),
    carts: await q('select * from public.get_store_abandoned_carts($1, $2)'),
    since: await q('select * from public.get_store_abandoned_carts_since($1, $2, null)'),
    statuses: (await q('select public.cart_reminder_statuses($1, $2) as s'))[0].s,
  };
}
const fnMd5 = async (db, sig) => (await db.query(
  `select md5(replace(prosrc, chr(13), '')) as m from pg_proc where oid = to_regprocedure($1)`, [sig])).rows[0]?.m;
const verifyRows = async (db) => Object.fromEntries((await db.query(VERIFY)).rows.map((r) => [r.grp, r.result]));

async function busyShop(db) {
  const ids = {};
  ids.asha1 = await add(db, { phone: '9000000001', name: 'Asha', at: ago(3) });
  ids.asha2 = await add(db, { phone: '9000000001', name: 'Asha', at: ago(1) });           // her latest cart
  ids.ravi = await add(db, { phone: '9000000002', name: 'Ravi', at: ago(45) });           // all time only
  ids.meenaCart = await add(db, { phone: '9000000003', name: 'Meena', at: ago(4) });
  ids.meenaOrder = await add(db, { phone: '9000000003', name: 'Meena', status: 'new', at: ago(2) });   // a buyer now
  ids.buyer = await add(db, { phone: '9000000004', name: 'Kiran', status: 'delivered', at: ago(5) });
  await remind(db, { phone: '9000000001', cart: ids.asha1, at: ago(2) });                 // reminded on an older cart
  await remind(db, { phone: '9000000003', cart: ids.meenaCart, at: ago(3) });
  return ids;
}

// ═══════════════════════════════════════════════════════════════════════════

test('before: the shop received abandoned customers’ numbers four ways (the live functions)', async () => {
  const db = await world();
  await busyShop(db);
  const seen = JSON.stringify(await shopSees(db));
  for (const n of ['9000000001', '9000000002']) assert.ok(seen.includes(n), `${n} reached the browser`);
  await db.close();
});

test('after: no abandoned customer’s number or address reaches the shop, from any of the four', async () => {
  const db = await world();
  await busyShop(db);
  await db.exec(FORWARD);
  const seen = await shopSees(db);
  const all = JSON.stringify(seen);
  for (const n of ['9000000001', '9000000002']) assert.ok(!all.includes(n), `${n} never sent`);
  assert.ok(!all.includes('"phone"'), 'reminder statuses carry no phone key');
  // Buyers still come with their number: the shop needs it to deliver.
  assert.deepEqual(seen.orders.map((o) => o.customer_phone).sort(), ['9000000003', '9000000004']);
  assert.ok(seen.orders.every((o) => o.status !== 'abandoned'), 'no abandoned row in the orders feed');
  assert.ok(seen.carts.every((c) => c.customer_phone === null));
  assert.ok(seen.since.every((c) => c.customer_phone === null && c.destination === null));
  await db.close();
});

test('everything else is exactly what the live functions returned', async () => {
  const db = await world();
  await busyShop(db);
  for (let i = 0; i < 40; i++) {
    await add(db, { phone: String(9100000000 + (i % 15)), status: i % 4 ? 'abandoned' : 'new', at: ago((i * 7) % 80) });
  }
  const before = await shopSees(db);
  await db.exec(FORWARD);
  const after = await shopSees(db);
  const strip = (rows, ...cols) => rows.map((r) => { const c = { ...r }; for (const k of cols) delete c[k]; return c; });
  assert.deepEqual(after.orders, before.orders.filter((o) => o.status !== 'abandoned'), 'the real orders, same order');
  assert.deepEqual(strip(after.carts, 'customer_phone'), strip(before.carts, 'customer_phone'));
  assert.deepEqual(strip(after.since, 'customer_phone', 'destination'), strip(before.since, 'customer_phone', 'destination'));
  assert.equal(after.statuses.length, before.statuses.length);
  assert.deepEqual(strip(after.statuses, 'cart_id'), strip(before.statuses, 'phone'));
  await db.close();
});

test('get_store_orders still returns the newest 500 real orders, and no abandoned row', async () => {
  const db = await world();
  await db.query(`insert into public.orders (store_slug, status, customer_phone, total, created_at)
    select 'shop', case when g % 3 = 0 then 'abandoned' else 'new' end, '9' || lpad(g::text, 9, '0'), 10,
           now() - (g || ' minutes')::interval from generate_series(1, 1200) g`);
  await db.exec(FORWARD);
  const rows = (await db.query(`select * from public.get_store_orders('shop', 'good')`)).rows;
  assert.equal(rows.length, 500);
  assert.ok(rows.every((o) => o.status === 'new'));
  const t = rows.map((o) => Date.parse(o.created_at));
  assert.deepEqual(t, [...t].sort((a, b) => b - a), 'newest first');
  await db.close();
});

test('reminder statuses point at the customer’s latest cart - the id the cart lists show', async () => {
  const db = await world();
  const ids = await busyShop(db);
  await db.exec(FORWARD);
  const { carts, since, statuses } = await shopSees(db);
  const asha = statuses.find((s) => s.cart_id === ids.asha2);
  assert.ok(asha, 'reminded on an older cart, shown on her latest one');
  assert.equal(asha.status, 'sent');
  assert.ok(carts.some((c) => c.id === ids.asha2) && since.some((c) => c.id === ids.asha2));
  // Meena ordered after her reminder: her status still exists, her cart is no longer listed.
  assert.ok(statuses.some((s) => s.cart_id === ids.meenaCart));
  assert.ok(!carts.some((c) => c.id === ids.meenaCart));
  // And the app joins them by that id.
  const m = statusMap(statuses);
  assert.equal(reminderFor(m, carts.find((c) => c.id === ids.asha2))?.status, 'sent');
  await db.close();
});

test('a wrong PIN still gets nothing, and another shop’s rows never appear', async () => {
  const db = await world();
  await busyShop(db);
  await add(db, { slug: 'other', phone: '9555555555' });
  await db.exec(FORWARD);
  const bad = await shopSees(db, 'shop', 'bad');
  assert.deepEqual([bad.orders, bad.carts, bad.since, bad.statuses], [[], [], [], null]);
  assert.ok(!JSON.stringify(await shopSees(db)).includes('9555555555'));
  await db.close();
});

test('forward: preflight refuses an unexpected version, re-runs harmlessly, touches only the four', async () => {
  const db = await world();
  await db.exec(FORWARD);
  await db.exec(FORWARD);                                   // a re-run
  const after = {};
  for (const [k, sig] of Object.entries(SIGS)) after[k] = await fnMd5(db, sig);
  const pinned = md5sIn(FORWARD);
  for (const m of Object.values(after)) assert.ok(pinned.includes(m), `forward pins ${m}`);
  const ddl = FORWARD.replace(/--.*$/gm, '');
  assert.equal((ddl.match(/create or replace function/gi) || []).length, 4);
  assert.doesNotMatch(ddl, /\b(create|alter|drop) (table|trigger|policy|index)\b|\b(insert|update|delete) |\b(grant|revoke)\b/i);
  await db.close();

  const other = await world();
  await other.exec(`create or replace function public.cart_reminder_statuses(p_slug text, p_hashed_pin text)
    returns jsonb language sql as $$ select '[]'::jsonb $$`);
  await assert.rejects(other.exec(FORWARD), /preflight: public\.cart_reminder_statuses\(text,text\) is not the reviewed version/);
  await other.exec('rollback');
  assert.equal(await fnMd5(other, SIGS.orders), '412869d96684c8e66f2981e162005f4e', 'nothing changed');
  await other.close();
});

test('rollback restores the live versions byte for byte, re-runs harmlessly, and refuses a stranger', async () => {
  const db = await world();
  const live = {};
  for (const [k, sig] of Object.entries(SIGS)) live[k] = await fnMd5(db, sig);
  assert.equal(live.orders, '412869d96684c8e66f2981e162005f4e');
  assert.equal(live.carts, 'c25c35db957bfbe7ad90abc9eea938dd');
  assert.equal(live.since, 'c148f70a88bca87773d1b0986556bf4b');
  await busyShop(db);
  const before = JSON.stringify(await shopSees(db));
  await db.exec(FORWARD);
  await db.exec(ROLLBACK);
  for (const [k, sig] of Object.entries(SIGS)) assert.equal(await fnMd5(db, sig), live[k], k);
  assert.equal(JSON.stringify(await shopSees(db)), before, 'the shop sees exactly what it saw before');
  await db.exec(ROLLBACK);                                  // already undone: harmless
  await db.exec(`create or replace function public.get_store_orders(p_slug text, p_hashed_pin text)
    returns setof public.orders language sql as $$ select * from public.orders where false $$`);
  await assert.rejects(db.exec(ROLLBACK), /REFUSED - public\.get_store_orders\(text,text\) is not the version this undo expects/);
  await db.close();
});

test('verifier: every P row passes after the forward; after the undo P1 fails', async () => {
  const db = await world();
  await busyShop(db);
  await db.exec(FORWARD);
  const v = await verifyRows(db);
  for (const c of ['P1', 'P2', 'P3', 'P4']) assert.equal(v[c], 'PASS', c);
  assert.equal(v.I1, '4', 'Asha twice, Ravi, Meena’s cart');
  assert.equal(v.I2, '2');
  await db.exec(ROLLBACK);
  assert.match((await verifyRows(db)).P1, /^FAIL - /);
  await db.close();
});

// ── the screens ─────────────────────────────────────────────────────────────

test('reminder state joins by cart id, and still by phone against the old database', () => {
  const now = Date.parse('2026-10-22T07:00:00Z');
  const cart = { id: 'c1', customer_phone: null, created_at: '2026-10-21T07:00:00Z' };
  const r = { cart_id: 'c1', status: 'sent', sent_at: '2026-10-22T04:00:00Z', next_at: '2026-10-29T04:00:00Z' };
  const m = statusMap([r, { cart_id: null, phone: null, status: 'sent' }]);
  assert.equal(reminderFor(m, cart), r);
  assert.equal(reminderFor(m, { id: 'c2', customer_phone: null }), undefined, 'a NULL phone never matches anything');
  const old = statusMap([{ phone: '9000000001', status: 'sent' }]);
  assert.equal(reminderFor(old, { id: 'x', customer_phone: '9000000001' })?.status, 'sent');
  assert.deepEqual(reminderCounts([cart, { id: 'c2', created_at: cart.created_at }], m, now), { all: 2, reminded: 1, notReminded: 1 });
  const tooOld = cartReminderState({ id: 'c3', created_at: '2026-10-01T00:00:00Z' }, undefined, now);
  assert.equal(tooOld.canSend, false);
  assert.equal(tooOld.note, `Older than ${MANUAL_MAX_AGE_DAYS} days — too late for a reminder`);
  assert.doesNotMatch(tooOld.note, /WhatsApp/, 'no longer sends the shop off to message them itself');
});

test('the Abandoned tab shows no number and no WhatsApp link, and says why', () => {
  const tab = code('src/components/manage/AbandonedTab.jsx');
  assert.ok(!/customer_phone/.test(tab), 'never reads the number');
  assert.ok(!/wa\.me/.test(tab), 'no WhatsApp link to the customer');
  assert.ok(!/MessageCircle/.test(tab));
  assert.match(tab, /Numbers stay private — PocketLink sends the reminder for you\./);
  assert.match(tab, /cartReminderState\(o, reminderFor\(byCart, o\), now\)/);
  assert.match(tab, /Send reminder · ₹1\.50/, 'the paid reminder is the way to reach them');
  assert.doesNotMatch(tab, /name, number and cart/);
});

test('no other screen gets abandoned rows from the orders feed either', () => {
  // get_store_orders no longer sends them; nothing should be asking for them by
  // another route that still carries a number.
  const svc = code('src/utils/orderService.js');
  assert.match(svc, /rpc\('get_store_abandoned_carts_since'|'get_store_abandoned_carts_since'/);
  const exp = code('src/utils/exportCustomers.js');
  assert.ok(!/attempts|groupAbandoned|Abandoned cart/.test(exp), 'the CSV has no abandoned-cart customers');
  assert.match(exp, /'Name', 'Phone', 'Type', 'Orders',\s+'Total spent \(INR\)'/);
});
