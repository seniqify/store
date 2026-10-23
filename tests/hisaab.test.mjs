// Payments → Hisaab (Payments redesign part 2, founder-approved 2026-10-23).
//
// What the shop kept (buildHisaab), each product's share (buildProductProfit),
// the day book, the month's CSV, and the one database change: the shop's own
// expenses and sales goal (supabase/hisaab-*.sql). The SQL runs in PGlite; the
// screens and the bill reader are checked statically.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import {
  buildHisaab, buildProductProfit, buildDayBook, comingUp, expenseOccurrences, goalFor, perHundred,
  fixesFor, hisaabCsv, availableMonths, recentExpenses, daysInMonth, shiftMonth, orderEconomics,
} from '../src/utils/hisaabMetrics.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = (p) => readFileSync(`${ROOT}${p}`, 'utf8').replace(/\r\n/g, '\n');
const code = (p) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

const NOW = Date.parse('2026-10-22T10:00:00+05:30');            // day 22 of October, IST
const at = (day, hour = 12) => new Date(Date.parse(`${day}T${String(hour).padStart(2, '0')}:00:00+05:30`)).toISOString();
const PRODUCTS = [
  { name: 'Garam masala', price: 200, cost: 80 },
  { name: 'Sample pack', price: 99, cost: 45 },
  { name: 'Pickle', price: 150, variants: { options: [{ name: '250g', price: 150, cost: 60 }, { name: '1kg', price: 500, cost: 220 }] } },
  { name: 'No cost thing', price: 100 },
];
let seq = 0;
const order = (day, items, over = {}) => ({
  id: `o${++seq}`, created_at: at(day), status: 'delivered', payment_method: 'cod', customer_name: 'Ganesh',
  total: items.reduce((s, [, q, p]) => s + q * p, 0) + (over.fee || 0),
  items: items.map(([name, qty, price, variant]) => ({ name, qty, price, ...(variant ? { variant } : {}) })),
  paid: true, paid_at: at(day, 18), paid_via: 'cod_delivery', shipping: over.fee || 0,
  ...over,
});
const returned = { paid: false, paid_at: null, status: 'confirmed', awb: 'AWB1', shipment_outcome: 'returned' };
const exp = (over) => ({ id: `e${++seq}`, amount: 100, category: 'other', note: '', paid_with: 'cash',
  repeats_monthly: false, ends_on: null, created_at: at('2026-10-01'), ...over });

function october() {
  return [
    order('2026-10-02', [['Garam masala', 2, 200]], { shipping_cost: 60 }),
    order('2026-10-05', [['Sample pack', 1, 99]], { shipping_cost: 58 }),
    order('2026-10-14', [['Garam masala', 1, 200], ['Sample pack', 1, 99]], { shipping_cost: 70 }),
    order('2026-10-20', [['Garam masala', 1, 200]], { ...returned, shipping_cost: 60 }),
    order('2026-10-21', [['No cost thing', 1, 100]]),                    // no courier charge: flat cost
    order('2026-09-10', [['Garam masala', 3, 200]], { shipping_cost: 60 }),
    order('2026-10-23', [['Garam masala', 1, 200]]),                     // after today (clock skew)
    { id: 'ab', created_at: at('2026-10-10'), status: 'abandoned', total: 999, items: [] },
    { id: 'cx', created_at: at('2026-10-11'), status: 'cancelled', total: 500, items: [{ name: 'Garam masala', qty: 1, price: 500 }] },
    { id: 'np', created_at: at('2026-10-12'), status: 'new', payment_method: 'online', paid: false, total: 300, items: [] },
  ];
}
const RENT = exp({ spent_on: '2026-09-01', amount: 300, category: 'rent', note: 'Shop rent', repeats_monthly: true });
const LATER = exp({ spent_on: '2026-09-28', amount: 100, category: 'salary', note: 'Helper', repeats_monthly: true });
const COSTS = { products: PRODUCTS, packagingCost: 10, deliveryCost: 40 };

// ── what the shop kept ──────────────────────────────────────────────────────

test('You kept = sold − returns − product cost − courier − packing − expenses', () => {
  const h = buildHisaab({ orders: october(), expenses: [RENT, LATER], goals: [], ...COSTS, now: NOW });
  assert.equal(h.month, '2026-10');
  assert.equal(h.cutoffDay, 22);
  assert.deepEqual(h.sold, { count: 5, amount: 1098 }, 'sales only: no abandoned, cancelled, unpaid online or tomorrow');
  assert.equal(h.split.returns, 200, 'the whole total of the parcel that came back');
  assert.equal(h.split.productCost, 330, 'product cost only on orders that did not come back');
  assert.equal(h.split.courier, 60 + 58 + 70 + 60 + 40, 'the booked charge, else the flat cost');
  assert.equal(h.split.packing, 50);
  assert.equal(h.split.expenses, 300, "this month's rent; the helper is due on the 28th");
  assert.equal(h.kept, 1098 - 200 - 330 - 288 - 50 - 300);
  assert.equal(h.split.kept, 0, 'a loss is not a slice of the bar');
  assert.deepEqual(h.coverage.unknownProducts, ['No cost thing']);
  assert.equal(h.coverage.unknownValue, 100);
  assert.equal(h.expenses.byCategory[0].key, 'rent');
});

test('the ₹100 split adds up to exactly 100 when the month made money', () => {
  const orders = [order('2026-10-03', [['Garam masala', 3, 200]], { shipping_cost: 37 }),
    order('2026-10-04', [['Sample pack', 7, 99]], { shipping_cost: 41 })];
  const h = buildHisaab({ orders, expenses: [exp({ spent_on: '2026-10-02', amount: 77 })], goals: [], ...COSTS, now: NOW });
  assert.ok(h.kept > 0);
  assert.equal(Object.values(h.per100).reduce((s, v) => s + v, 0), 100);
  for (let i = 0; i < 200; i++) {
    const parts = { a: Math.random() * 90, b: Math.random() * 90, c: Math.random() * 90 };
    const sold = Object.values(parts).reduce((s, v) => s + v, 0);
    assert.equal(Object.values(perHundred(parts, sold)).reduce((s, v) => s + v, 0), 100);
  }
  assert.deepEqual(perHundred({ a: 1 }, 0), { a: 0 });
});

test('break-even: the day the month has stayed in profit from', () => {
  const orders = [
    order('2026-10-03', [['Garam masala', 1, 200]], { shipping_cost: 20 }),     // keeps 200-80-20-10 = 90
    order('2026-10-09', [['Garam masala', 2, 200]], { shipping_cost: 20 }),     // keeps 210: total 300
  ];
  const rent = exp({ spent_on: '2026-10-01', amount: 250, category: 'rent' });
  const h = buildHisaab({ orders, expenses: [rent], goals: [], ...COSTS, now: NOW });
  assert.deepEqual(h.breakEven, { hasExpenses: true, inProfit: true, day: '2026-10-09', short: 0, expenses: 250 });
  const ads = exp({ spent_on: '2026-10-15', amount: 100, category: 'ads' });     // back below on the 15th
  const h2 = buildHisaab({ orders, expenses: [rent, ads], goals: [], ...COSTS, now: NOW });
  assert.equal(h2.breakEven.inProfit, false);
  assert.equal(h2.breakEven.short, 50);
  assert.equal(buildHisaab({ orders, expenses: [], goals: [], ...COSTS, now: NOW }).breakEven.hasExpenses, false);
});

test('the goal carries on from the month it was set; 0 clears it', () => {
  const goals = [{ month: '2026-08-01', amount: 2000 }, { month: '2026-11-01', amount: 9000 }];
  assert.equal(goalFor(goals, '2026-10'), 2000);
  assert.equal(goalFor(goals, '2026-07'), null);
  assert.equal(goalFor([...goals, { month: '2026-10-01', amount: 0 }], '2026-10'), null);
  const h = buildHisaab({ orders: october(), expenses: [], goals, ...COSTS, now: NOW });
  assert.deepEqual(h.goal, { amount: 2000, progress: 1098 / 2000, reached: false, left: 902, daysLeft: 9, perDay: 101 });
  const past = buildHisaab({ orders: october(), expenses: [], goals, ...COSTS, now: NOW, month: '2026-09' });
  assert.equal(past.goal.daysLeft, 0);
  assert.equal(past.goal.perDay, null);
  assert.equal(past.cutoffDay, 30, 'a past month counts every day');
});

test('compared with the same days of the month before', () => {
  const h = buildHisaab({ orders: october(), expenses: [RENT], goals: [], ...COSTS, now: NOW });
  assert.equal(h.compare.month, '2026-09');
  assert.equal(h.compare.toDay, 22);
  assert.deepEqual(h.compare.sold, { now: 1098, was: 600, change: 83 });
  assert.equal(h.compare.kept.was, 600 - 240 - 60 - 10 - 300);
  assert.equal(h.compare.kept.change, null, 'no percentage against a loss');
  assert.deepEqual(h.compare.returnsPer100, { now: 18, was: 0 });
  // 31 March against February: the shorter month is compared whole.
  const mar = buildHisaab({ orders: [], expenses: [], goals: [], ...COSTS, now: Date.parse('2026-03-31T10:00:00+05:30') });
  assert.equal(mar.compare.toDay, 28);
});

test('repeating expenses: same day each month, the last day in a short month, until stopped', () => {
  const e = exp({ spent_on: '2026-01-31', amount: 50, repeats_monthly: true });
  assert.deepEqual(expenseOccurrences([e], '2026-02').map((x) => x.key), ['2026-02-28']);
  assert.deepEqual(expenseOccurrences([e], '2026-01').map((x) => x.key), ['2026-01-31']);
  assert.deepEqual(expenseOccurrences([e], '2025-12'), []);
  const stopped = { ...e, ends_on: '2026-03-01' };
  assert.equal(expenseOccurrences([stopped], '2026-03').length, 1);
  assert.equal(expenseOccurrences([stopped], '2026-04').length, 0);
  assert.equal(expenseOccurrences([exp({ spent_on: '2026-02-10' })], '2026-03').length, 0, 'a one-off counts once');
  assert.equal(expenseOccurrences([exp({ spent_on: 'garbage' }), exp({ spent_on: '2026-03-01', amount: 0 })], '2026-03').length, 0);
  assert.equal(expenseOccurrences([exp({ spent_on: '2026-03-01', amount: 12.34 })], '2026-03')[0].amount, 1234, 'paise');
});

test('each order: product cost by the picked option, and none on a parcel that came back', () => {
  const byName = new Map(PRODUCTS.map((p) => [p.name, p]));
  const o = order('2026-10-02', [['Pickle', 2, 500, '1kg'], ['Pickle', 1, 150, '250g']], { shipping_cost: 90 });
  const e = orderEconomics(o, { byName, packagingCost: 10, deliveryCost: 40 });
  assert.equal(e.productCost, (2 * 220 + 60) * 100);
  assert.equal(e.courier, 9000);
  assert.equal(e.contribution, (1150 - 500 - 90 - 10) * 100);
  const back = orderEconomics({ ...o, ...returned }, { byName, packagingCost: 10, deliveryCost: 40 });
  assert.equal(back.productCost, 0);
  assert.equal(back.contribution, -(90 + 10) * 100, 'a return still cost the courier and the packing');
});

// ── products ────────────────────────────────────────────────────────────────

test('per product: the parts of one sold add up, and costs split by item value', () => {
  const rows = buildProductProfit({ orders: october(), ...COSTS, now: NOW });
  const gm = rows.find((p) => p.name === 'Garam masala');
  assert.equal(gm.units, 4);
  assert.equal(gm.orders, 3);
  assert.equal(gm.returnedUnits, 1);
  assert.deepEqual(gm.each, { buyerPays: 200, productCost: 60, courier: 42, packing: 7, returns: 50, kept: 41 });
  for (const p of rows) {
    const e = p.each;
    assert.equal(e.buyerPays - e.productCost - e.courier - e.packing - e.returns, e.kept, p.name);
  }
  assert.equal(rows[rows.length - 1].name, 'No cost thing', 'unknown cost is listed last');
  assert.equal(rows[rows.length - 1].costKnown, false);
});

test('a product that loses money gets a price that fixes it, and a bundling tip', () => {
  const orders = Array.from({ length: 4 }, (_, i) => order(`2026-10-0${i + 1}`, [['Sample pack', 1, 99]], { shipping_cost: 70 }));
  const h = buildHisaab({ orders, expenses: [], goals: [], ...COSTS, now: NOW });
  const sp = h.products.find((p) => p.name === 'Sample pack');
  assert.equal(sp.each.kept, 99 - 45 - 70 - 10);
  const [price, bundle] = fixesFor(sp);
  assert.equal(price.kind, 'price');
  assert.equal(price.price % 10, 9, 'a price ending in 9');
  assert.ok(price.keeps > 0, 'the suggested price makes money');
  assert.equal(bundle.kind, 'bundle');
  assert.equal(h.insights[0].kind, 'losing');
  assert.equal(h.insights[0].product, 'Sample pack');
  assert.deepEqual(fixesFor(h.products.find((p) => p.each.kept >= 0)), []);
});

// ── money in & out ──────────────────────────────────────────────────────────

test('the day book: money in by payment date, money out by expense and order day', () => {
  const days = buildDayBook({ orders: october(), expenses: [RENT], ...COSTS, now: NOW });
  assert.equal(days[0].key, '2026-10-21', 'newest day first, nothing after today');
  const d21 = days[0];
  assert.equal(d21.in, 100);
  assert.equal(d21.out, 40 + 10);
  assert.equal(d21.net, 50);
  assert.deepEqual(d21.entries.map((x) => x.kind), ['in', 'counted', 'counted']);
  const d1 = days.find((d) => d.key === '2026-10-01');
  assert.equal(d1.out, 300);
  assert.equal(d1.entries[0].label, 'Shop rent');
  const d20 = days.find((d) => d.key === '2026-10-20');
  assert.equal(d20.in, 0, 'a return pays nothing');
  assert.ok(!days.some((d) => d.key < '2026-10-01'), 'one month only');
});

test('coming up: repeating expenses due in the next 7 days, across the month end', () => {
  const late = exp({ spent_on: '2026-09-02', repeats_monthly: true, note: 'Wifi' });
  const now = Date.parse('2026-10-29T10:00:00+05:30');
  const up = comingUp({ expenses: [RENT, late, exp({ spent_on: '2026-10-30' })], now });
  assert.deepEqual(up.map((x) => [x.key, x.label]), [['2026-11-01', 'Shop rent'], ['2026-11-02', 'Wifi']]);
});

test('months offered, and expenses to add again', () => {
  assert.deepEqual(availableMonths({ orders: october(), expenses: [exp({ spent_on: '2026-07-04' })], now: NOW }),
    ['2026-10', '2026-09', '2026-08', '2026-07']);
  assert.equal(daysInMonth('2028-02'), 29);
  assert.equal(shiftMonth('2026-01', -1), '2025-12');
  const a = exp({ note: 'Tape', amount: 250, created_at: at('2026-10-05') });
  const r = recentExpenses([a, { ...a, id: 'x', created_at: at('2026-10-06') }, exp({ note: 'Rent', created_at: at('2026-10-01') })]);
  assert.deepEqual(r.map((e) => e.note), ['Tape', 'Rent'], 'one of each, newest first');
});

test("the month's file: sales, expenses, summary; Excel-safe", () => {
  const orders = [...october(), order('2026-10-06', [['Garam masala', 1, 200]], { customer_name: '=HYPERLINK("x")' })];
  const h = buildHisaab({ orders, expenses: [RENT], goals: [], ...COSTS, now: NOW });
  const csv = hisaabCsv({ hisaab: h, orders, expenses: [RENT] });
  assert.ok(csv.startsWith('﻿Date,Type,Details'));
  assert.ok(csv.includes('\r\n'));
  assert.equal(csv.split('\r\n').filter((l) => l.includes(',Sale,')).length, 6);
  assert.ok(csv.includes('2026-10-01,Expense,Rent: Shop rent,Cash,Every month,-300.00'));
  assert.ok(csv.includes(`,Summary,You kept,,,${h.kept.toFixed(2)}`));
  assert.ok(csv.includes(`"Order from =HYPERLINK(""x"")"`), 'not a formula: it starts with text');
  assert.ok(!/,=/.test(csv));
});

test('Hisaab owns no clock and no accounting rule of its own', () => {
  const src = code('src/utils/hisaabMetrics.js');
  assert.ok(!src.includes('Date.now'), 'now is supplied');
  assert.match(src, /from '\.\/commerceMetrics\.js'/);
  assert.match(src, /classifyOrder\(o\) !== 'sale'/);
  assert.match(src, /paymentState\(o\) === 'written_off'/);
  assert.match(src, /unitCostForItem\(/, 'the same cost of goods as Stats');
  assert.ok(!/status === 'cancelled'|isPaymentIncomplete/.test(src));
});

// ── the database ────────────────────────────────────────────────────────────

const FWD = read('supabase/hisaab-forward.sql');
const VER = read('supabase/hisaab-verify.sql');
const RB = read('supabase/hisaab-ROLLBACK.sql');
const PIN = 'a'.repeat(64);

async function world({ install = true } = {}) {
  const db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin;
    create table public.stores (slug text primary key, pin text);
    insert into public.stores values ('shop', '${PIN}'), ('other', '${PIN}');
    create function public.verify_store_pin(p_slug text, p_hashed_pin text) returns boolean
      language sql as $$ select exists (select 1 from public.stores s where s.slug = p_slug and s.pin = p_hashed_pin) $$;`);
  if (install) await db.exec(FWD);
  return db;
}
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
const one = async (db, sql, params) => Object.values((await db.query(sql, params)).rows[0])[0];
const add = (db, { slug = 'shop', pin = PIN, day = today(), amount = 250, category = 'packing', note = ' Tape and boxes ', paid = 'cash', repeats = false } = {}) =>
  one(db, 'select public.add_store_expense($1, $2, $3::date, $4, $5, $6, $7, $8)', [slug, pin, day, amount, category, note, paid, repeats]);
const book = (db, slug = 'shop', pin = PIN) => one(db, 'select public.get_store_hisaab($1, $2)', [slug, pin]);

test('expenses: added, read back, deleted only by their own shop; a wrong PIN changes nothing', async () => {
  const db = await world();
  const id = await add(db, {});
  assert.match(String(id), /^[0-9a-f-]{36}$/);
  const b = await book(db);
  assert.equal(b.expenses.length, 1);
  assert.equal(b.expenses[0].note, 'Tape and boxes', 'trimmed');
  assert.equal(Number(b.expenses[0].amount), 250);
  assert.deepEqual(await book(db, 'shop', 'b'.repeat(64)), { expenses: [], goals: [] }, 'wrong PIN: an empty book');
  assert.deepEqual((await book(db, 'other')).expenses, [], "another shop's book is its own");

  assert.equal(await add(db, { pin: 'b'.repeat(64) }), null);
  assert.equal(await one(db, 'select public.delete_store_expense($1, $2, $3)', ['other', PIN, id]), false, 'not their expense');
  assert.equal(await one(db, 'select public.delete_store_expense($1, $2, $3)', ['shop', 'b'.repeat(64), id]), false);
  assert.equal((await book(db)).expenses.length, 1);
  assert.equal(await one(db, 'select public.delete_store_expense($1, $2, $3)', ['shop', PIN, id]), true);
  assert.equal((await book(db)).expenses.length, 0);
  await db.close();
});

test('add_store_expense refuses bad input instead of raising', async () => {
  const db = await world();
  const tomorrow = new Date(Date.parse(`${today()}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);
  for (const [why, over] of [
    ['tomorrow', { day: tomorrow }], ['before 2020', { day: '2019-12-31' }], ['zero', { amount: 0 }],
    ['negative', { amount: -5 }], ['too big', { amount: 10000001 }], ['category', { category: 'fun' }],
    ['paid with', { paid: 'card' }],
  ]) assert.equal(await add(db, over), null, why);
  assert.equal((await book(db)).expenses.length, 0);
  const long = await add(db, { note: 'x'.repeat(200), amount: 12.345 });
  const e = (await book(db)).expenses.find((x) => x.id === long);
  assert.equal(e.note.length, 80);
  assert.equal(Number(e.amount), 12.35);
  await db.close();
});

test('a repeating expense stops after a month; a one-off cannot be stopped', async () => {
  const db = await world();
  const rent = await add(db, { day: '2026-09-01', category: 'rent', repeats: true });
  const once = await add(db, { day: '2026-09-01' });
  const stop = (id, month) => one(db, 'select public.stop_store_expense($1, $2, $3, $4::date)', ['shop', PIN, id, month]);
  assert.equal(await stop(rent, '2026-08-15'), false, 'not before it started');
  assert.equal(await stop(once, '2026-10-01'), false);
  assert.equal(await stop(rent, '2026-10-20'), true);
  assert.equal((await book(db)).expenses.find((x) => x.id === rent).ends_on, '2026-10-01', 'kept as the month');
  await db.close();
});

test('the sales goal: one per month, updated in place, 0 allowed', async () => {
  const db = await world();
  const set = (month, amount, pin = PIN) => one(db, 'select public.set_store_sales_goal($1, $2, $3::date, $4)', ['shop', pin, month, amount]);
  assert.equal(await set('2026-10-17', 50000), true);
  assert.equal(await set('2026-10-01', 60000), true);
  assert.equal(await set('2026-11-01', 0), true);
  assert.equal(await set('2026-11-01', -1), false);
  assert.equal(await set('2026-12-01', 1, 'b'.repeat(64)), false);
  assert.deepEqual((await book(db)).goals.map((g) => [g.month, Number(g.amount)]), [['2026-10-01', 60000], ['2026-11-01', 0]]);
  await db.close();
});

test('the browser cannot reach the tables directly', async () => {
  const db = await world();
  await add(db, {});
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`set role ${role}`);
    await assert.rejects(db.query('select * from public.store_expenses'), /permission denied/);
    await assert.rejects(db.query(`insert into public.store_sales_goals values ('shop', '2026-10-01', 1)`), /permission denied/);
    assert.equal((await book(db)).expenses.length, 1, `${role} goes through the function`);
    await db.exec('reset role');
  }
  await db.close();
});

test('hisaab forward: pinned, re-runs, verify all PASS; refuses a stranger; rollback keeps typed-in rows', async () => {
  const db = await world();
  await db.exec(FWD);                                                    // a re-run
  const md5s = (await db.query(`select p.oid::regprocedure::text sig, md5(replace(prosrc, chr(13), '')) m
    from pg_proc p where proname in ('get_store_hisaab','add_store_expense','delete_store_expense','stop_store_expense','set_store_sales_goal')`)).rows;
  assert.equal(md5s.length, 5);
  for (const { m } of md5s) assert.ok(FWD.includes(`'${m}'`) && VER.includes(`'${m}'`), `pinned ${m}`);
  const v = Object.fromEntries((await db.query(VER)).rows.map((r) => [r.grp, r.result]));
  for (const k of ['H1', 'H2', 'H3', 'H4', 'H5', 'H6']) assert.equal(v[k], 'PASS', `${k}: ${v[k]}`);

  await add(db, {});
  await db.exec(RB);
  assert.ok((await db.query(`select to_regclass('public.store_expenses') t`)).rows[0].t, 'a table with rows is kept');
  assert.equal((await db.query(`select to_regclass('public.store_sales_goals') t`)).rows[0].t, null, 'an empty one goes');
  assert.match(Object.fromEntries((await db.query(VER)).rows.map((r) => [r.grp, r.result])).H1, /^FAIL/);
  await db.exec(RB);                                                     // harmless again
  await db.exec(FWD);                                                    // and back, over the kept table
  assert.equal((await book(db)).expenses.length, 1, 'the kept rows are there again');
  await db.close();

  const other = await world({ install: false });
  await other.exec(`create function public.get_store_hisaab(p_slug text, p_hashed_pin text) returns jsonb language sql as $$ select '{}'::jsonb $$`);
  await assert.rejects(other.exec(FWD), /preflight: a different public\.get_store_hisaab/);
  await other.close();
  const odd = await world({ install: false });
  await odd.exec('create table public.store_expenses (id int)');
  await assert.rejects(odd.exec(FWD), /preflight: a different public\.store_expenses/);
  await odd.close();
});

// ── the screens and the bill reader ─────────────────────────────────────────

test('Payments has a Money | Hisaab switch, and Hisaab gets the orders and costs', () => {
  const tab = code('src/components/manage/PaymentsTab.jsx');
  assert.match(tab, /\[\['money', 'Money'\], \['hisaab', 'Hisaab'\]\]/);
  assert.match(tab, /<HisaabTab[\s\S]*?orders=\{orders\}[\s\S]*?products=\{products\} packagingCost=\{packagingCost\} deliveryCost=\{deliveryCost\}/);
  assert.match(tab, /salesMissing \?/, 'an empty order list with sales on record is a failed load');
  const manage = code('src/pages/ManageStore.jsx');
  assert.match(manage, /<PaymentsTab[\s\S]*?products=\{config\.products\} packagingCost=\{config\.cart\?\.packagingCost\}[\s\S]*?deliveryCost=\{config\.cart\?\.deliveryCost\}/);
  const h = code('src/components/manage/hisaab/HisaabTab.jsx');
  for (const c of ['<HisaabHome', '<ProductProfit', '<MoneyInOut', '<AddExpense']) assert.ok(h.includes(c), c);
  assert.match(h, /window\.confirm\(msg\)/, 'deleting asks');
  for (const f of ['HisaabTab', 'HisaabHome', 'ProductProfit', 'MoneyInOut', 'AddExpense']) {
    assert.ok(!/utils\/commerceMetrics/.test(code(`src/components/manage/hisaab/${f}.jsx`)), `${f} goes through hisaabMetrics`);
  }
  assert.ok(!/utils\/commerceMetrics/.test(tab), 'and so does Payments');
  const home = code('src/components/manage/hisaab/HisaabHome.jsx');
  assert.match(home, /noCosts \|\| !bookOk \|\| sold <= 0 \?/, 'no You kept without costs or without the book');
  assert.match(home, /so you really kept less/);
});

test('the bill reader checks the PIN and the plan before the model, and stores nothing', () => {
  const src = code('api/bill-read.js');
  const pin = src.indexOf('verifyOwnerPin(');
  const plan = src.indexOf('if (!isPaid(config))');
  const model = src.indexOf('anthropic.beta.messages.create');
  assert.ok(pin > 0 && plan > pin && model > plan, 'PIN, then plan, then the model');
  assert.match(src, /const MODEL = 'claude-opus-5-5'/);
  assert.match(src, /fallbacks: 'default'/);
  assert.match(src, /format: \{ type: 'json_schema', schema: SCHEMA \}/);
  assert.match(src, /stop_reason === 'refusal'/);
  assert.ok(!/supabase|storage|insert|upload/i.test(src.replace(/supabaseUrl/g, '')), 'no storage');
  assert.match(read('vercel.json'), /"api\/bill-read\.js": \{ "maxDuration": 60 \}/);
});
