// Payments → Hisaab → Sales statement (founder-approved mockup 2026-10-24).
//
// Every order between two dates, like a bank statement: buildStatement and
// its Excel file (src/utils/salesStatement.js), the A4 page that is saved as
// PDF (src/utils/statementPdf.js), and the screen's wiring, checked statically.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildHisaab } from '../src/utils/hisaabMetrics.js';
import {
  buildStatement, statementPresets, statementCsv, statementFileName, firstSaleDay, rangeLabel, dateLabel,
  daysBetween, maskPhone, methodLabel,
} from '../src/utils/salesStatement.js';
import { statementHtml } from '../src/utils/statementPdf.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = (p) => readFileSync(`${ROOT}${p}`, 'utf8').replace(/\r\n/g, '\n');
const code = (p) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

const NOW = Date.parse('2026-10-22T10:00:00+05:30');            // day 22 of October, IST
const at = (day, time = '12:00') => new Date(Date.parse(`${day}T${time}:00+05:30`)).toISOString();
const PRODUCTS = [
  { name: 'Garam masala', price: 200, cost: 80 },
  { name: 'Sample pack', price: 99, cost: 45 },
  { name: 'No cost thing', price: 100 },
];
let seq = 0;
const order = (day, items, over = {}) => ({
  id: `00000000-0000-0000-0000-${String(++seq).padStart(12, '0')}`, created_at: at(day, over.time), status: 'delivered',
  payment_method: 'cod', customer_name: 'Ganesh', customer_phone: '9822041421',
  destination: 'Flat 2, Shivaji Nagar, Pune, 411005', pincode: '411005',
  total: items.reduce((s, [, q, p]) => s + q * p, 0) + (over.shipping || 0),
  items: items.map(([name, qty, price]) => ({ name, qty, price })),
  paid: true, paid_at: at(day, '18:00'), paid_via: 'cod_delivery', shipping: 0,
  ...over,
});
const returned = { paid: false, paid_at: null, status: 'confirmed', awb: 'AWB1', shipment_outcome: 'returned' };
const exp = (over) => ({ id: `e${++seq}`, amount: 100, category: 'other', note: '', paid_with: 'cash',
  repeats_monthly: false, ends_on: null, created_at: at('2026-10-01'), ...over });

function october() {
  return [
    order('2026-10-02', [['Garam masala', 2, 200]], { shipping_cost: 60, shipping: 40 }),
    order('2026-10-05', [['Sample pack', 1, 99]], { shipping_cost: 58, payment_method: 'online', paid_via: 'razorpay', customer_phone: '9000000001', customer_name: 'Asha' }),
    order('2026-10-14', [['Garam masala', 1, 200], ['Sample pack', 1, 99]], { shipping_cost: 70, notes: 'Ring the bell · Coupon DIWALI10 (−₹30)' }),
    order('2026-10-20', [['Garam masala', 1, 200]], { ...returned, shipping_cost: 60 }),
    order('2026-10-21', [['No cost thing', 1, 100]], { paid: false, paid_at: null, status: 'new' }),   // no courier charge yet
    order('2026-09-10', [['Garam masala', 3, 200]], { shipping_cost: 60 }),
    { id: 'ab', created_at: at('2026-10-10'), status: 'abandoned', total: 999, items: [] },
    { id: 'cx', created_at: at('2026-10-11'), status: 'cancelled', total: 500, payment_method: 'cod', customer_name: 'Ravi', items: [{ name: 'Garam masala', qty: 1, price: 500 }] },
    { id: 'np', created_at: at('2026-10-12'), status: 'new', payment_method: 'online', paid: false, total: 300, items: [] },
  ];
}
const RENT = exp({ spent_on: '2026-09-01', amount: 300, category: 'rent', note: 'Shop rent', repeats_monthly: true });
const COSTS = { products: PRODUCTS, packagingCost: 10, deliveryCost: 40 };

// ── the orders ───────────────────────────────────────────────────────────────

test('1 Oct to today says what the Hisaab home says for October', () => {
  const orders = october();
  const h = buildHisaab({ orders, expenses: [RENT], goals: [], ...COSTS, now: NOW });
  const st = buildStatement({ orders, expenses: [RENT], ...COSTS, from: '2026-10-01', to: '2026-10-22', now: NOW });
  const t = st.totals;
  assert.equal(t.count, h.sold.count);
  assert.equal(t.sold, h.sold.amount);
  assert.equal(t.returns, h.split.returns);
  assert.equal(t.productCost, h.split.productCost);
  assert.equal(t.courier, h.split.courier);
  assert.equal(t.packing, h.split.packing);
  assert.equal(t.expenses, h.split.expenses);
  assert.equal(t.kept, h.kept);
  assert.equal(t.profit, t.sold - t.returns - t.productCost - t.courier - t.packing);
});

test('From and To are both included, in the merchant’s day; a To after today is today', () => {
  const late = order('2026-10-15', [['Sample pack', 1, 99]], { time: '23:30' });
  const next = order('2026-10-16', [['Sample pack', 1, 99]], { time: '00:10' });
  const first = order('2026-10-01', [['Sample pack', 1, 99]], { time: '00:05' });
  const st = buildStatement({ orders: [late, next, first], ...COSTS, from: '2026-10-01', to: '2026-10-15', now: NOW });
  assert.deepEqual(st.rows.map((r) => r.id), [first.id, late.id], 'oldest first');
  assert.equal(st.days, 15);
  const ahead = buildStatement({ orders: [], from: '2026-10-01', to: '2026-12-31', now: NOW });
  assert.equal(ahead.to, '2026-10-22');
  assert.equal(ahead.includesToday, true);
  assert.equal(buildStatement({ orders: [late], from: '2026-10-20', to: '2026-10-02', now: NOW }).ok, false, 'From after To');
  assert.equal(buildStatement({ orders: [late], from: '', to: '2026-10-02', now: NOW }).rows.length, 0);
});

test('cancelled orders are listed apart; abandoned and unpaid online checkouts are left out', () => {
  const st = buildStatement({ orders: october(), ...COSTS, from: '2026-10-01', to: '2026-10-22', now: NOW });
  assert.equal(st.rows.length, 5);
  assert.deepEqual(st.cancelled.map((r) => [r.id, r.name, r.total]), [['cx', 'Ravi', 500]]);
  assert.ok(!st.rows.some((r) => r.id === 'ab' || r.id === 'np'));
  assert.equal(st.totals.cancelledCount, 1);
});

test('each order: where its money stands, what it cost, what it left', () => {
  const st = buildStatement({ orders: october(), ...COSTS, from: '2026-10-01', to: '2026-10-22', now: NOW });
  const [cod, online, coupon, back, fresh] = st.rows;
  assert.deepEqual(st.rows.map((r) => r.state), ['collected', 'paid', 'collected', 'came_back', 'not_sent']);
  assert.equal(cod.deliveryCharged, 40);
  assert.equal(cod.courier, 60);
  assert.equal(cod.productCost, 160);
  assert.equal(cod.profit, 440 - 160 - 60 - 10);
  assert.equal(online.methodLabel, 'Online (Razorpay)');
  assert.deepEqual(coupon.coupon, { code: 'DIWALI10', off: 30 });
  assert.equal(back.productCost, 0, 'the goods came back');
  assert.equal(back.profit, -(60 + 10), 'the courier and packing are lost');
  assert.equal(fresh.courierGuess, true, 'no charge saved: the Settings cost stands in');
  assert.equal(fresh.courier, 40);
  assert.equal(fresh.costMissing, true);
  assert.equal(cod.place, 'Pune');
  const typed = buildStatement({ orders: [order('2026-10-03', [['Sample pack', 1, 99]], { destination: 'B-12, Ghatkopar, Mumbai - 400093' })],
    from: '2026-10-01', to: '2026-10-22', now: NOW });
  assert.equal(typed.rows[0].place, 'Mumbai', 'the pincode prints once, beside the place');
  assert.equal(cod.pincode, '411005');
  assert.match(cod.no, /^[0-9A-F]{6}$/);
  assert.equal(st.totals.couponCount, 1);
  assert.equal(st.totals.coupons, 30);
});

test('money received, not paid yet, and how customers paid', () => {
  const onWay = order('2026-10-18', [['Sample pack', 1, 99]], { paid: false, paid_at: null, status: 'dispatched', awb: 'AWB9' });
  const upi = order('2026-10-19', [['Sample pack', 1, 99]], { payment_method: 'upi', paid: false, paid_at: null, status: 'confirmed' });
  const st = buildStatement({ orders: [...october(), onWay, upi], ...COSTS, from: '2026-10-01', to: '2026-10-22', now: NOW });
  const t = st.totals;
  assert.equal(st.rows.find((r) => r.id === onWay.id).state, 'on_way');
  assert.equal(st.rows.find((r) => r.id === upi.id).state, 'not_paid');
  assert.equal(t.received, 440 + 99 + 299);
  assert.equal(t.unpaid, 100 + 99 + 99);
  assert.equal(t.received + t.unpaid + t.returns, t.sold);
  const cod = st.methods.find((m) => m.label === 'Cash on delivery');
  assert.equal(cod.count, 5);
  assert.equal(cod.cameBack, 200);
  assert.equal(methodLabel('QR'), 'QR code');
});

test('the payment filter: cash on delivery, or everything paid ahead', () => {
  const base = { orders: october(), ...COSTS, from: '2026-10-01', to: '2026-10-22', now: NOW };
  assert.deepEqual(buildStatement({ ...base, pay: 'prepaid' }).rows.map((r) => r.method), ['online']);
  assert.ok(buildStatement({ ...base, pay: 'cod' }).rows.every((r) => r.method === 'cod'));
  assert.equal(buildStatement({ ...base, pay: 'cod' }).cancelled.length, 1);
});

test('customers who bought before the From date are counted as coming back', () => {
  const st = buildStatement({ orders: october(), ...COSTS, from: '2026-10-01', to: '2026-10-22', now: NOW });
  assert.equal(st.totals.customers, 2);
  assert.equal(st.totals.returning, 1, 'Ganesh bought in September; Asha is new');
  assert.equal(firstSaleDay(october()), '2026-09-10');
});

test('products sold leave out the parcels that came back', () => {
  const st = buildStatement({ orders: october(), ...COSTS, from: '2026-10-01', to: '2026-10-22', now: NOW });
  const masala = st.products.find((p) => p.name === 'Garam masala');
  assert.equal(masala.qty, 3);
  assert.equal(masala.sales, 600);
  assert.equal(masala.cost, 240);
  assert.equal(st.products.find((p) => p.name === 'No cost thing').cost, null);
});

test('shop expenses in the dates, a repeating one on its day each month', () => {
  const st = buildStatement({ orders: [], expenses: [RENT, exp({ spent_on: '2026-10-09', amount: 50, category: 'ads', note: 'Instagram' })],
    from: '2026-09-15', to: '2026-10-22', now: NOW });
  assert.deepEqual(st.expenses.map((x) => [x.day, x.label, x.amount]),
    [['2026-10-01', 'Rent: Shop rent', 300], ['2026-10-09', 'Ads: Instagram', 50]]);
  assert.equal(st.totals.kept, -350);
});

// ── picking the dates ────────────────────────────────────────────────────────

test('quick picks for today, across a year end too', () => {
  const pick = (today) => Object.fromEntries(statementPresets(today).map((p) => [p.id, [p.label, p.from, p.to]]));
  assert.deepEqual(pick('2026-10-24'), {
    month: ['This month', '2026-10-01', '2026-10-24'],
    half: ['1–15 Oct', '2026-10-01', '2026-10-15'],
    last: ['Last month', '2026-09-01', '2026-09-30'],
    week: ['Last 7 days', '2026-10-18', '2026-10-24'],
    quarter: ['Jul–Sep quarter', '2026-07-01', '2026-09-30'],
    fy: ['Since 1 April', '2026-04-01', '2026-10-24'],
  });
  const jan = pick('2026-01-09');
  assert.deepEqual(jan.half, ['16–31 Dec', '2025-12-16', '2025-12-31']);
  assert.deepEqual(jan.quarter, ['Oct–Dec quarter', '2025-10-01', '2025-12-31']);
  assert.deepEqual(jan.fy, ['Since 1 April', '2025-04-01', '2026-01-09']);
  assert.deepEqual(pick('2026-03-02').last, ['Last month', '2026-02-01', '2026-02-28']);
  assert.deepEqual(statementPresets('nope'), []);
});

test('dates read the way people say them', () => {
  assert.equal(dateLabel('2026-10-01'), '1 Oct 2026');
  assert.equal(rangeLabel('2026-10-01', '2026-10-15'), '1 Oct – 15 Oct 2026');
  assert.equal(rangeLabel('2025-12-28', '2026-01-03'), '28 Dec 2025 – 3 Jan 2026');
  assert.equal(rangeLabel('2026-10-15', '2026-10-15'), '15 Oct 2026');
  assert.equal(daysBetween('2026-02-01', '2026-03-01'), 29);
});

// ── the Excel file and the PDF ───────────────────────────────────────────────

test('the Excel file: one row an order, the same choices as the PDF, formula-safe', () => {
  const orders = [...october(), order('2026-10-06', [['Sample pack', 1, 99]], { customer_name: '=HYPERLINK("x")' })];
  const st = buildStatement({ orders, expenses: [RENT], ...COSTS, from: '2026-10-01', to: '2026-10-22', now: NOW });
  const csv = statementCsv(st);
  assert.ok(csv.startsWith('﻿Date,Time,Order,Customer,Phone'));
  assert.ok(csv.includes('\r\n'));
  assert.ok(csv.includes('Profit (Rs)'));
  assert.ok(csv.includes('98••• ••421') && !csv.includes('9822041421'), 'phones hidden unless asked');
  assert.ok(statementCsv(st, { showPhones: true }).includes('9822041421'));
  assert.ok(csv.includes(`"'=HYPERLINK(""x"")"`), 'not a formula');
  assert.ok(csv.includes('Cancelled orders, not counted above'));
  const plain = statementCsv(st, { showCosts: false, withExpenses: true });
  assert.ok(!/Profit|Product cost|Courier paid|You kept/.test(plain), 'no costs when they are hidden');
  assert.ok(statementCsv(st, { withExpenses: true }).includes(`You kept after shop expenses,${st.totals.kept.toFixed(2)}`));
  assert.equal(statementFileName('Aaji’s Kitchen!', '2026-10-01', '2026-10-15'), 'aaji-s-kitchen-sales-2026-10-01-to-2026-10-15');
  assert.equal(maskPhone('12'), '');
});

test('the PDF page: what a customer typed is text, never markup', () => {
  const evil = order('2026-10-07', [['<b>Sweets</b>', 1, 99]], {
    customer_name: '<img src=x onerror=alert(1)>', destination: '"><script>alert(2)</script>', notes: '',
  });
  const st = buildStatement({ orders: [evil], ...COSTS, from: '2026-10-01', to: '2026-10-22', now: NOW });
  const html = statementHtml(st, {
    store: { businessName: '<i>Shop</i>', theme: { primary: 'red;}</style><script>alert(3)</script>' }, logo: 'javascript:alert(4)' },
    slug: 'shop', madeAt: '22 Oct 2026, 10:00 am',
  });
  assert.ok(!html.includes('<img src=x'));
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('<b>Sweets</b>') && html.includes('&lt;b&gt;Sweets&lt;/b&gt;'));
  assert.ok(!html.includes('<i>Shop</i>'));
  assert.ok(!html.includes('javascript:'), 'only an https logo is drawn');
  assert.match(html, /border-bottom:2px solid #0d9488/, 'a colour that is not a colour falls back');
  assert.match(html, /<title>i-shop-i-sales-2026-10-01-to-2026-10-22<\/title>/, 'the title is the PDF’s file name');
});

test('the PDF page: costs, phones and expenses only when asked', () => {
  const st = buildStatement({ orders: october(), expenses: [RENT], ...COSTS, from: '2026-10-01', to: '2026-10-22', now: NOW });
  const store = { businessName: 'Ganesh Masale', gst: '27ABCDE1234F1Z5', theme: { primary: '#7c3aed' } };
  const full = statementHtml(st, { store, slug: 'ganesh', withExpenses: true, madeAt: '22 Oct 2026, 10:00 am' });
  assert.match(full, /Where the money went/);
  assert.match(full, /Courier<br>paid/);
  assert.match(full, /You kept after shop expenses/);
  assert.match(full, /GSTIN 27ABCDE1234F1Z5/);
  assert.match(full, /98••• ••421/);
  assert.ok(!full.includes('9822041421'));
  assert.match(full, /Came back and cancelled/);
  assert.match(full, /@page\{size:A4/);
  assert.match(full, /onclick="window\.print\(\)">Save as PDF/);
  const plain = statementHtml(st, { store, showCosts: false, showPhones: true, withExpenses: true });
  assert.ok(!/Where the money went|Courier<br>paid|Profit|You kept/.test(plain));
  assert.match(plain, /9822041421/);
  const empty = statementHtml(buildStatement({ orders: [], from: '2026-10-01', to: '2026-10-02', now: NOW }), { store });
  assert.match(empty, /No orders between these dates/);
});

// ── the screen ───────────────────────────────────────────────────────────────

test('Hisaab opens the statement; it owns no accounting rule and no clock', () => {
  const tab = code('src/components/manage/hisaab/HisaabTab.jsx');
  assert.match(tab, /view\.name === 'statement' \?[\s\S]*?<SalesStatement orders=\{orders \|\| \[\]\} expenses=\{expenses\} bookOk=\{book\.ok\}/);
  assert.match(code('src/components/manage/hisaab/HisaabHome.jsx'), /onOpen\('statement'\)[\s\S]*?Sales statement/);
  assert.match(code('src/components/manage/PaymentsTab.jsx'), /<HisaabTab[\s\S]*?store=\{store\}/);
  assert.match(code('src/pages/ManageStore.jsx'), /<PaymentsTab[\s\S]*?store=\{\{ businessName: config\.businessName/);
  const screen = code('src/components/manage/hisaab/SalesStatement.jsx');
  assert.ok(!/utils\/commerceMetrics/.test(screen), 'the screen goes through the statement');
  assert.match(screen, /openStatement\(st,/);
  assert.match(screen, /role="switch"/);
  assert.match(screen, /if \(sheet === 'from'\) \{[\s\S]*?setSheet\('to'\)/, 'From moves on to To');
  const util = code('src/utils/salesStatement.js');
  assert.ok(!util.includes('Date.now'), 'now is supplied');
  assert.match(util, /orderEconomics\(o, ctx\)/, 'the same costs as Hisaab');
  assert.match(util, /classifyOrder\(o\)/);
  assert.match(util, /paymentState\(o\)/);
  assert.ok(!/status === 'cancelled'|isPaymentIncomplete/.test(util));
});
