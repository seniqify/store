// Payments → Money (Payments redesign, founder-approved 2026-10-23).
//
// The home screen's numbers (buildMoneyHome), the drill-down lists
// (buildMoneyLists), the returns insights, and the one database change:
// switch_order_to_cod. The SQL runs in PGlite; the screens are checked
// statically.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import {
  buildMoneyHome, buildPaymentsMetrics, comingInBucket, COMING_IN_KEYS, NOT_PAID_RECENT_DAYS,
} from '../src/utils/paymentsMetrics.js';
import { buildMoneyLists } from '../src/utils/paymentsLedger.js';
import { returnsInsights, orderCity } from '../src/utils/returnsInsights.js';
import { classifyOrder, paymentState } from '../src/utils/commerceMetrics.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = (p) => readFileSync(`${ROOT}${p}`, 'utf8').replace(/\r\n/g, '\n');
const code = (p) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
const FIXTURE = JSON.parse(read('tests/fixtures/commerce-royalfoods.json'));
const NOW = Date.parse('2026-09-20T06:30:00Z');
const DAY = 86400000;
let seq = 0;
const row = (over = {}) => ({
  id: `00000000-0000-0000-0000-${String(++seq).padStart(12, '0')}`,
  created_at: new Date(NOW - 2 * DAY).toISOString(),
  status: 'new', payment_method: 'cod', total: 100, paid: false, paid_at: null, paid_via: null,
  payment_ref: null, payment_link_id: null, awb: null, courier: null, shipment_status: null,
  shipment_outcome: null, delivered_at: null, returned_at: null,
  ...over,
});

// ── where the unpaid money is ───────────────────────────────────────────────

test('every unpaid sale lands in exactly one place', () => {
  const cases = [
    [row({ status: 'dispatched' }), 'with_rider'],
    [row({ status: 'new' }), 'not_shipped'],
    [row({ status: 'confirmed' }), 'not_shipped'],
    [row({ awb: 'A1', shipment_status: 'Cancelled' }), 'not_shipped'],          // booking called off
    [row({ awb: 'A2', shipment_status: 'In Transit' }), 'with_courier'],
    [row({ awb: 'A3', shipment_status: 'OFD' }), 'with_courier'],
    [row({ awb: 'A4', shipment_status: 'Not Contactable' }), 'stuck'],
    [row({ payment_link_id: 'plink_1' }), 'to_check'],
    [row({ payment_method: 'online', awb: 'A5', shipment_status: 'In Transit' }), 'to_check'], // Razorpay unconfirmed
    [row({ status: 'delivered', payment_method: 'online', paid: false, payment_ref: 'pay_x' }), 'to_check'],
  ];
  for (const [o, want] of cases) {
    assert.equal(paymentState(o), 'outstanding', JSON.stringify(o));
    assert.equal(comingInBucket(o), want, `${o.status} ${o.awb} ${o.shipment_status} ${o.payment_link_id}`);
  }
});

test('Royal Foods: the places add up to Still to collect, to the paise', () => {
  const h = buildMoneyHome(FIXTURE, { now: NOW, days: 30 });
  const sum = COMING_IN_KEYS.reduce((s, k) => s + Math.round(h.comingIn[k].amount * 100), 0);
  const count = COMING_IN_KEYS.reduce((s, k) => s + h.comingIn[k].count, 0);
  assert.equal(sum, Math.round(h.balances.outstanding.amount * 100));
  assert.equal(count, h.balances.outstanding.count);
  assert.equal(h.balances.outstanding.amount, 28626, 'the Payments gate number is unchanged');
  assert.equal(h.balances.grossSales, 86018);
});

test('and they add up for any mix of orders', () => {
  let s = 11;
  const r = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
  const pick = (xs) => xs[Math.floor(r() * xs.length)];
  const rows = Array.from({ length: 900 }, () => row({
    created_at: new Date(NOW - r() * 120 * DAY).toISOString(),
    status: pick(['new', 'confirmed', 'dispatched', 'delivered', 'cancelled', 'abandoned', null]),
    payment_method: pick(['cod', 'online', 'COD', '']),
    total: Math.round(r() * 900),
    paid: r() < 0.4,
    payment_ref: r() < 0.3 ? 'pay_1' : null,
    payment_link_id: r() < 0.1 ? 'plink' : null,
    awb: r() < 0.5 ? 'AWB' : null,
    shipment_status: pick([null, 'In Transit', 'OFD', 'Delivered', 'RTO Delivered', 'Not Contactable', 'Cancelled', 'Pickup scheduled']),
  }));
  const h = buildMoneyHome(rows, { now: NOW, days: 7 });
  const sum = COMING_IN_KEYS.reduce((t, k) => t + Math.round(h.comingIn[k].amount * 100), 0);
  assert.equal(sum, Math.round(h.balances.outstanding.amount * 100));
  assert.equal(COMING_IN_KEYS.reduce((t, k) => t + h.comingIn[k].count, 0), h.balances.outstanding.count);
  // The period's parts add up to what was sold in it.
  const p = h.period.orders;
  assert.equal(Math.round(p.sold.amount * 100),
    Math.round((p.collected.amount + p.outstanding.amount + p.writtenOff.amount) * 100));
  // Balances and channels are exactly buildPaymentsMetrics'.
  const base = buildPaymentsMetrics(rows, { now: NOW, days: 7 });
  assert.deepEqual(h.balances, base.balances);
  assert.deepEqual(h.channels, base.channels);
  assert.deepEqual(h.period.received, base.period.received);
});

test('online payments that never went through are counted apart, and split by age', () => {
  const rows = [
    row({ payment_method: 'online', created_at: new Date(NOW - 1 * DAY).toISOString(), total: 299 }),
    row({ payment_method: 'online', created_at: new Date(NOW - (NOT_PAID_RECENT_DAYS + 1) * DAY).toISOString(), total: 418 }),
    row({ total: 500 }),
  ];
  assert.equal(classifyOrder(rows[0]), 'payment_incomplete');
  const h = buildMoneyHome(rows, { now: NOW, days: 30 });
  assert.deepEqual(h.notPaid, {
    all: { count: 2, amount: 717 }, recent: { count: 1, amount: 299 }, older: { count: 1, amount: 418 },
  });
  assert.equal(h.balances.grossSales, 500, 'never in sales');
  assert.equal(h.balances.outstanding.amount, 500, 'and never in Coming in');
  const lists = buildMoneyLists(rows, { now: NOW });
  assert.deepEqual([lists.notPaid.recent.length, lists.notPaid.older.length], [1, 1]);
});

test('the period counts orders by when they were placed, so no payment date is needed', () => {
  const rows = [
    row({ created_at: new Date(NOW - 1 * DAY).toISOString(), paid: true, paid_at: null, total: 200 }),  // undated payment
    row({ created_at: new Date(NOW - 1 * DAY).toISOString(), total: 150 }),
    row({ created_at: new Date(NOW - 40 * DAY).toISOString(), paid: true, paid_at: new Date(NOW - DAY).toISOString(), total: 90 }),
  ];
  const h = buildMoneyHome(rows, { now: NOW, days: 7 });
  assert.deepEqual(h.period.orders.sold, { count: 2, amount: 350 });
  assert.deepEqual(h.period.orders.collected, { count: 1, amount: 200 }, 'collected though undated');
  assert.deepEqual(h.period.orders.outstanding, { count: 1, amount: 150 });
  assert.deepEqual(h.period.received, { count: 1, amount: 90 }, 'money received stays the paid_at flow');
});

test('returns by the month the order was placed, and the share of parcels sent', () => {
  const h = buildMoneyHome(FIXTURE, { now: NOW, days: 30 });
  assert.equal(h.returns.months.length, 4);
  assert.deepEqual(h.returns.months.map((m) => m.key), ['2026-06', '2026-07', '2026-08', '2026-09']);
  assert.deepEqual(h.returns.months.map((m) => [m.count, m.amount]), [[0, 0], [0, 0], [16, 7029], [12, 4920]]);
  const inMonths = h.returns.months.reduce((t, m) => t + m.count, 0);
  assert.ok(inMonths <= h.balances.writtenOff.count);
  assert.ok(h.returns.shipped >= h.balances.writtenOff.count);
  assert.equal(h.returns.rate, h.balances.writtenOff.count / h.returns.shipped);
});

// ── the lists ───────────────────────────────────────────────────────────────

test('the lists hold the same orders the home screen counts, oldest waiting first', () => {
  const h = buildMoneyHome(FIXTURE, { now: NOW, days: 30 });
  const l = buildMoneyLists(FIXTURE, { now: NOW });
  for (const k of COMING_IN_KEYS) {
    assert.equal(l.comingIn[k].length, h.comingIn[k].count, k);
    const t = l.comingIn[k].map((x) => Date.parse(x.order.created_at));
    assert.deepEqual(t, [...t].sort((a, b) => a - b), `${k} oldest first`);
  }
  assert.equal(l.returns.length, h.balances.writtenOff.count);
  assert.ok(l.comingIn.not_shipped.every((x) => typeof x.ageDays === 'number' && x.ageDays >= 0));
});

// ── returns insights ────────────────────────────────────────────────────────

test('returns insights: courier charges, unconfirmed COD buyers, top cities', () => {
  const returns = [
    { order: row({ shipping_cost: 62, destination: 'Flat 4, Navi Peth, Solapur - 413001', customer_confirmed_at: null }), amount: 300 },
    { order: row({ shipping_cost: 58.5, destination: 'B-12, kothrud, pune, 411038', customer_confirmed_at: '2026-09-01T00:00:00Z' }), amount: 300 },
    { order: row({ shipping_cost: null, destination: 'Lane 3, Pune - 411001' }), amount: 300 },
    { order: row({ payment_method: 'online', paid: false, destination: 'Pickup from shop' }), amount: 300 },
  ];
  assert.deepEqual(returnsInsights(returns), {
    courierCharges: 120.5, chargedParcels: 2, cod: 3, unconfirmed: 2,
    cities: [{ city: 'Pune', count: 2 }, { city: 'Solapur', count: 1 }],
  });
  assert.deepEqual(returnsInsights([]), { courierCharges: 0, chargedParcels: 0, cod: 0, unconfirmed: 0, cities: [] });
});

test('orderCity reads an address exactly as the database order_city() does', async () => {
  const sql = read('supabase/order-tracking.sql');
  const i = sql.indexOf('create or replace function public.order_city(');
  const fn = sql.slice(i, sql.indexOf('$$;', sql.indexOf('as $$', i)) + 3);
  const db = new PGlite();
  await db.exec(fn);
  const inputs = [
    'Flat 4, Sai Residency, Navi Peth, Solapur - 413001', 'B-12, kothrud, pune, 411038', 'Solapur',
    'one long address typed in a single field 413001', '123456', '', null, 'A, B, Navi Mumbai - 400703',
    'House 9, Pandharpur Road, Mangalwedha Taluka Solapur District - 413305', 'X, 12345', 'Kolhapur 416001',
  ];
  for (const d of inputs) {
    const want = (await db.query('select public.order_city($1) as c', [d])).rows[0].c;
    const got = orderCity(d);
    // The database returns 'Pickup from shop' for a pickup; the returns view drops it.
    if (want === 'Pickup from shop') { assert.equal(got, null); continue; }
    assert.equal(got?.toLowerCase() ?? null, want?.toLowerCase() ?? null, JSON.stringify(d));
  }
  await db.close();
});

// ── switch_order_to_cod ─────────────────────────────────────────────────────

const FWD = read('supabase/switch-to-cod-forward.sql');
const RB = read('supabase/switch-to-cod-ROLLBACK.sql');
const VER = read('supabase/switch-to-cod-verify.sql');
const MD5 = '0f958608466f4468a9320862e5b4a0d6';

async function world({ install = true } = {}) {
  const db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin;
    create table public.orders (id uuid primary key default gen_random_uuid(), store_slug text, status text,
      payment_method text, paid boolean, payment_ref text, paid_at timestamptz, total numeric);
    create function public.verify_store_pin(p_slug text, p_hashed_pin text) returns boolean
      language sql volatile as $$ select p_hashed_pin = 'good' $$;`);
  if (install) await db.exec(FWD);
  return db;
}
const add = async (db, o) => (await db.query(`insert into public.orders (store_slug, status, payment_method, paid, payment_ref, total)
  values ($1, $2, $3, $4, $5, 299) returning id`, [o.slug ?? 'shop', o.status ?? 'new', o.pm ?? 'online', o.paid ?? false, o.ref ?? null])).rows[0].id;
const sw = async (db, id, { slug = 'shop', pin = 'good' } = {}) =>
  (await db.query('select public.switch_order_to_cod($1, $2, $3) as ok', [slug, pin, id])).rows[0].ok;
const pm = async (db, id) => (await db.query('select payment_method, paid, payment_ref, status from public.orders where id = $1', [id])).rows[0];

test('switch_order_to_cod changes only an unpaid online order of this shop', async () => {
  const db = await world();
  const ok = await add(db, {});
  assert.equal(await sw(db, ok), true);
  assert.deepEqual(await pm(db, ok), { payment_method: 'cod', paid: false, payment_ref: null, status: 'new' }, 'nothing else touched');
  assert.equal(await sw(db, ok), false, 'already cash on delivery');

  const refused = {
    paid: await add(db, { paid: true }),
    withRef: await add(db, { ref: 'pay_123' }),
    cancelled: await add(db, { status: 'cancelled' }),
    abandoned: await add(db, { status: 'Abandoned' }),
    cod: await add(db, { pm: 'cod' }),
    other: await add(db, { slug: 'other' }),
  };
  for (const [why, id] of Object.entries(refused)) {
    const before = await pm(db, id);
    assert.equal(await sw(db, id), false, why);
    assert.deepEqual(await pm(db, id), before, `${why}: unchanged`);
  }
  const shipped = await add(db, { status: 'dispatched' });
  assert.equal(await sw(db, shipped), true, 'a shipped order the buyer never paid for can switch too');
  const wrongPin = await add(db, {});
  assert.equal(await sw(db, wrongPin, { pin: 'bad' }), false);
  assert.equal((await pm(db, wrongPin)).payment_method, 'online');
  await db.close();
});

test('switch-to-cod forward: pinned, PIN first, PUBLIC revoked, re-runs, refuses a stranger; verify and rollback', async () => {
  const db = await world();
  await db.exec(FWD);                                         // a re-run
  const fn = (await db.query(`select md5(replace(prosrc, chr(13), '')) m, prosecdef, proconfig,
    has_function_privilege('anon', oid, 'EXECUTE') anon
    from pg_proc where proname = 'switch_order_to_cod'`)).rows[0];
  assert.equal(fn.m, MD5);
  assert.equal(fn.prosecdef, true);
  assert.deepEqual(fn.proconfig, ['search_path=public, pg_temp']);
  assert.equal(fn.anon, true);
  assert.ok(FWD.includes(`'${MD5}'`) && VER.includes(`'${MD5}'`));
  const v = Object.fromEntries((await db.query(VER)).rows.map((r) => [r.grp, r.result]));
  for (const k of ['S1', 'S2', 'S3', 'S4']) assert.equal(v[k], 'PASS', k);
  await db.exec(RB);
  assert.match(Object.fromEntries((await db.query(VER)).rows.map((r) => [r.grp, r.result])).S1, /^FAIL - function missing/);
  await db.exec(RB);                                          // nothing to drop: harmless
  await db.close();

  const other = await world({ install: false });
  await other.exec(`create function public.switch_order_to_cod(p_slug text, p_hashed_pin text, p_order_id uuid)
    returns boolean language sql as $$ select true $$`);
  await assert.rejects(other.exec(FWD), /preflight: a different switch_order_to_cod/);
  await other.close();
});

// ── the screens ─────────────────────────────────────────────────────────────

test('the Payments tab drives the four Money screens and every action', () => {
  const tab = code('src/components/manage/PaymentsTab.jsx');
  for (const c of ['<MoneyHome', '<ComingIn', '<NotPaidOnline', '<LostToReturns']) assert.ok(tab.includes(c), c);
  assert.match(tab, /buildMoneyLists\(orders \|\| \[\], \{ now: loadedAt \}\)/);
  assert.match(tab, /returnsInsights\(money\.returns\)/);
  // Money follows status, as everywhere: delivered COD is recorded paid by the database.
  assert.match(tab, /await setOrderStatus\(slug, pin, o\.id, 'delivered'\)/);
  assert.match(tab, /await setOrderStatus\(slug, pin, o\.id, 'cancelled'\)/);
  assert.ok(!/setOrderPaid|Mark collected|markCollected/.test(tab), 'no manual collection');
  assert.match(tab, /await switchOrderToCod\(slug, pin, o\.id\)/);
  assert.match(tab, /only after the buyer agrees on WhatsApp/);
  assert.match(tab, /window\.confirm\(`Mark \$\{list\.length\} orders delivered\?/);
  assert.match(tab, /window\.confirm\(msg\)/, 'cancelling always asks');
  assert.match(code('src/pages/ManageStore.jsx'), /<PaymentsTab[\s\S]*?onGoTab=\{setTab\}/);
});

test('the home screen opens each list, and the lists use the same places', () => {
  const home = code('src/components/manage/payments/MoneyHome.jsx');
  for (const k of ['with_rider', 'not_shipped', 'stuck', 'to_check', 'with_courier']) {
    assert.match(home, new RegExp(`onOpen\\('coming', '${k}'\\)`), k);
  }
  assert.match(home, /onOpen\('returns'\)/);
  assert.match(home, /onOpen\('notpaid'\)/);
  assert.match(home, /not money owed, kept out of your sales/);
  const coming = code('src/components/manage/payments/ComingIn.jsx');
  assert.match(coming, /COMING_IN_KEYS\.filter/);
  assert.match(coming, /onMarkDelivered\(ticked\.map\(\(r\) => r\.order\)\)/);
  assert.match(coming, /onGoTab\?\.\('delivery'\)/);
  const notPaid = code('src/components/manage/payments/NotPaidOnline.jsx');
  assert.match(notPaid, /onSwitchToCod\(o\)/);
  assert.match(notPaid, /onCancel\(rows\.map\(\(r\) => r\.order\)\)/);
});
