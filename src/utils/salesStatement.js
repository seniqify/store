/**
 * Payments → Hisaab → Sales statement (founder-approved mockup 2026-10-24):
 * every order between two dates, like a bank statement, to keep, to send to
 * a partner or to hand to the CA.
 *
 * It owns no accounting rule. Which rows are sales and where their money
 * stands come from commerceMetrics; what each order cost (product, courier,
 * packing) and what it left the shop come from Hisaab's orderEconomics. So a
 * statement for 1 Oct to today says what the Hisaab home says for October.
 *
 *   the orders      every sale placed from `from` to `to`, both days
 *                   included, in the merchant's clock, paid or not. A parcel
 *                   that came back stays in, as Hisaab counts it
 *   listed apart    cancelled orders: not sales, shown so nothing goes missing
 *   left out        abandoned checkouts, and online checkouts never paid
 *
 * Pure, and takes `now` as an argument rather than reading the clock.
 * Money is summed in paise, integers, and turned into rupees on the way out.
 */
import { classifyOrder, paymentState, shipmentState, isShippedOrDelivered, dayKeyInZone } from './commerceMetrics.js';
import {
  orderEconomics, productsByName, expenseOccurrences, daysInMonth, shiftMonth, CATEGORY_LABEL, HISAAB_TZ,
} from './hisaabMetrics.js';

const paise = (v) => { const n = Number(v); return Number.isFinite(n) ? Math.round(n * 100) : 0; };
const rupees = (p) => p / 100;
const pad = (n) => String(n).padStart(2, '0');
const lower = (v) => String(v ?? '').toLowerCase().trim();
const isDayKey = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
// The short order number the delivery slip prints: the id's last 6 characters.
const orderNo = (id) => { const s = String(id ?? '').replace(/-/g, ''); return (s.slice(-6) || s).toUpperCase(); };
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The payment-mode filter, in the order the screen shows it. */
export const PAY_FILTERS = Object.freeze([
  { key: 'all', label: 'All' },
  { key: 'cod', label: 'Cash on delivery' },
  { key: 'prepaid', label: 'Online & UPI' },
]);

const METHOD_LABEL = { cod: 'Cash on delivery', online: 'Online (Razorpay)', upi: 'UPI', qr: 'QR code', bank: 'Bank transfer' };
export function methodLabel(method) {
  return METHOD_LABEL[lower(method)] || 'Other';
}

/** Where one order's money stands, in the words the statement prints. */
export const STATE_LABEL = Object.freeze({
  paid: 'Paid',
  collected: 'Collected',
  came_back: 'Came back',
  on_way: 'On the way',
  not_sent: 'Not sent yet',
  not_paid: 'Not paid yet',
});

// ── days ────────────────────────────────────────────────────────────────────

export function addDays(key, n) {
  if (!isDayKey(key)) return null;
  const d = new Date(`${key}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Days from `from` to `to`, both included. */
export function daysBetween(from, to) {
  if (!isDayKey(from) || !isDayKey(to)) return 0;
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86400000) + 1;
}

const lastDay = (month) => `${month}-${pad(daysInMonth(month))}`;
const dayMonth = (key) => `${Number(key.slice(8, 10))} ${MON[Number(key.slice(5, 7)) - 1]}`;

/** '1 Oct 2026' for a day key. */
export function dateLabel(key) {
  return isDayKey(key) ? `${dayMonth(key)} ${key.slice(0, 4)}` : '';
}

/** '1 Oct – 15 Oct 2026', '28 Dec 2025 – 3 Jan 2026', or '15 Oct 2026'. */
export function rangeLabel(from, to) {
  if (!isDayKey(from) || !isDayKey(to)) return '';
  if (from === to) return dateLabel(from);
  return from.slice(0, 4) === to.slice(0, 4) ? `${dayMonth(from)} – ${dateLabel(to)}` : `${dateLabel(from)} – ${dateLabel(to)}`;
}

/** The quick picks under From and To, for the merchant's today. */
export function statementPresets(today) {
  if (!isDayKey(today)) return [];
  const month = today.slice(0, 7);
  const prev = shiftMonth(month, -1);
  const m = Number(month.slice(5, 7));
  // Half a month: 1-15 once it is over, else the second half of last month.
  const half = Number(today.slice(8, 10)) >= 16
    ? { from: `${month}-01`, to: `${month}-15` }
    : { from: `${prev}-16`, to: lastDay(prev) };
  // The last whole quarter. Calendar quarters are the financial year's too:
  // Apr-Jun, Jul-Sep, Oct-Dec, Jan-Mar.
  const thisQuarter = `${month.slice(0, 4)}-${pad(Math.floor((m - 1) / 3) * 3 + 1)}`;
  const q = shiftMonth(thisQuarter, -3);
  const qEnd = shiftMonth(q, 2);
  const fyFrom = `${m >= 4 ? month.slice(0, 4) : Number(month.slice(0, 4)) - 1}-04-01`;
  return [
    { id: 'month', label: 'This month', from: `${month}-01`, to: today },
    { id: 'half', label: `${Number(half.from.slice(8))}–${Number(half.to.slice(8))} ${MON[Number(half.from.slice(5, 7)) - 1]}`, ...half },
    { id: 'last', label: 'Last month', from: `${prev}-01`, to: lastDay(prev) },
    { id: 'week', label: 'Last 7 days', from: addDays(today, -6), to: today },
    { id: 'quarter', label: `${MON[Number(q.slice(5, 7)) - 1]}–${MON[Number(qEnd.slice(5, 7)) - 1]} quarter`, from: `${q}-01`, to: lastDay(qEnd) },
    { id: 'fy', label: 'Since 1 April', from: fyFrom, to: today },
  ];
}

/** The first day the shop made a sale, or null: where the calendar starts. */
export function firstSaleDay(orders, timeZone = HISAAB_TZ) {
  let first = null;
  for (const o of Array.isArray(orders) ? orders : []) {
    if (classifyOrder(o) !== 'sale') continue;
    const key = dayKeyInZone(Date.parse(o?.created_at), timeZone);
    if (key && (!first || key < first)) first = key;
  }
  return first;
}

// ── one order ───────────────────────────────────────────────────────────────

const clock = (ms, timeZone) => new Intl.DateTimeFormat('en-IN', {
  timeZone, hour: 'numeric', minute: '2-digit', hour12: true,
}).format(new Date(ms)).replace(/\s?([ap])\.?m\.?$/i, (x, a) => ` ${a.toLowerCase()}m`);

// The coupon line the checkout writes into notes: "Coupon DIWALI10 (−₹62)".
const COUPON_RE = /Coupon (\S+) \([−-]₹(\d+(?:\.\d+)?)\)/;

/** The place on the address: its last part, without the pincode, which
 *  prints beside it ("Mumbai - 400093" reads Mumbai). */
function placeOf(destination) {
  const parts = String(destination ?? '').split(/\s*,\s*|\n/)
    .map((p) => p.replace(/\b\d{6}\b/g, '').replace(/^[\s\-–]+|[\s\-–]+$/g, '')).filter(Boolean);
  return parts[parts.length - 1] || '';
}

function rowState(o) {
  const state = paymentState(o);
  const cod = lower(o?.payment_method) === 'cod';
  if (state === 'written_off') return 'came_back';
  if (state === 'collected') return cod ? 'collected' : 'paid';
  if (cod && !isShippedOrDelivered(o)) return 'not_sent';
  if (cod && shipmentState(o) !== 'delivered') return 'on_way';
  return 'not_paid';
}

function baseRow(o, key, ms, timeZone) {
  const coupon = String(o?.notes ?? '').match(COUPON_RE);
  return {
    id: o?.id ?? null,
    no: orderNo(o?.id),
    day: key,
    time: clock(ms, timeZone),
    at: ms,
    name: String(o?.customer_name || '').trim() || 'Customer',
    phone: String(o?.customer_phone ?? '').replace(/\D/g, '').slice(-10),
    place: placeOf(o?.destination),
    pincode: String(o?.pincode ?? '').replace(/\D/g, '').slice(0, 6),
    items: (Array.isArray(o?.items) ? o.items : [])
      .filter((it) => Number(it?.qty) > 0)
      .map((it) => ({ name: String(it?.name || 'Item'), variant: String(it?.variant || it?.size || ''), qty: Number(it.qty) })),
    coupon: coupon ? { code: coupon[1], off: Number(coupon[2]) } : null,
    method: lower(o?.payment_method),
    methodLabel: methodLabel(o?.payment_method),
    total: paise(o?.total),
  };
}

/** Who bought: the phone, or the name when there is none. */
const whoOf = (o) => String(o?.customer_phone ?? '').replace(/\D/g, '').slice(-10) || lower(o?.customer_name);

// ── the statement ───────────────────────────────────────────────────────────

/**
 * Every order from `from` to `to` (day keys, both included; a `to` after
 * today is read as today), with the totals the statement prints.
 *
 * pay: 'all' | 'cod' | 'prepaid' (everything that is not cash on delivery).
 */
export function buildStatement({
  orders = [], expenses = [], products = [], packagingCost = 0, deliveryCost = 0,
  from, to, pay = 'all', now, timeZone = HISAAB_TZ,
} = {}) {
  const all = Array.isArray(orders) ? orders : [];
  const today = dayKeyInZone(now, timeZone);
  const end = isDayKey(to) && today && to > today ? today : to;
  const ok = isDayKey(from) && isDayKey(end) && from <= end;
  const ctx = { byName: productsByName(products), packagingCost, deliveryCost };

  // A customer is coming back when their first sale was before `from`.
  const firstBuy = new Map();
  for (const o of all) {
    if (classifyOrder(o) !== 'sale') continue;
    const key = dayKeyInZone(Date.parse(o?.created_at), timeZone);
    const who = whoOf(o);
    if (key && who && !(firstBuy.get(who) <= key)) firstBuy.set(who, key);
  }

  const sales = [];
  const cancelled = [];
  for (const o of ok ? all : []) {
    const ms = Date.parse(o?.created_at);
    const key = dayKeyInZone(ms, timeZone);
    if (!key || key < from || key > end) continue;
    const cod = lower(o?.payment_method) === 'cod';
    if ((pay === 'cod' && !cod) || (pay === 'prepaid' && cod)) continue;
    const kind = classifyOrder(o);
    if (kind === 'cancelled' && paise(o?.total) > 0) cancelled.push(baseRow(o, key, ms, timeZone));
    if (kind !== 'sale') continue;
    const e = orderEconomics(o, ctx);
    const charge = Number(o?.shipping_cost);
    sales.push({
      ...baseRow(o, key, ms, timeZone),
      who: whoOf(o),
      state: rowState(o),
      deliveryCharged: paise(o?.shipping) + paise(o?.cod_fee),
      courier: e.courier,
      // No courier charge saved: the flat delivery cost from Settings stands in.
      courierGuess: e.courier > 0 && !(Number.isFinite(charge) && charge > 0),
      productCost: e.productCost,
      costMissing: e.unknownValue > 0,
      packing: e.packing,
      profit: e.contribution,
      lines: e.lines,
    });
  }
  const byTime = (a, b) => a.at - b.at;
  sales.sort(byTime);
  cancelled.sort(byTime);

  const sum = (rows, f) => rows.reduce((s, r) => s + f(r), 0);
  const cameBack = sales.filter((r) => r.state === 'came_back');
  const received = sales.filter((r) => r.state === 'paid' || r.state === 'collected');
  const unpaid = sales.filter((r) => r.state === 'on_way' || r.state === 'not_sent' || r.state === 'not_paid');

  const methods = new Map();
  for (const r of sales) {
    const m = methods.get(r.methodLabel) || { label: r.methodLabel, count: 0, amount: 0, received: 0, unpaid: 0, cameBack: 0 };
    m.count += 1;
    m.amount += r.total;
    if (r.state === 'paid' || r.state === 'collected') m.received += r.total;
    else if (r.state === 'came_back') m.cameBack += r.total;
    else m.unpaid += r.total;
    methods.set(r.methodLabel, m);
  }

  const products_ = new Map();
  for (const r of sales) {
    if (r.state === 'came_back') continue;
    for (const l of r.lines) {
      const p = products_.get(l.name) || { name: l.name, qty: 0, sales: 0, cost: 0, costKnown: true };
      p.qty += l.qty;
      p.sales += l.value;
      if (l.cost == null) p.costKnown = false; else p.cost += l.cost;
      products_.set(l.name, p);
    }
  }

  const spent = [];
  if (ok) {
    for (let m = from.slice(0, 7); m <= end.slice(0, 7); m = shiftMonth(m, 1)) {
      for (const x of expenseOccurrences(expenses, m)) {
        if (x.key < from || x.key > end) continue;
        const e = x.expense;
        spent.push({ day: x.key, label: [CATEGORY_LABEL[e.category] || 'Other', e.note].filter(Boolean).join(': '), amount: x.amount });
      }
    }
  }

  const profit = sum(sales, (r) => r.profit);
  const expenseTotal = sum(spent, (x) => x.amount);
  const buyers = new Set(sales.map((r) => r.who).filter(Boolean));
  const R = rupees;
  const out = (r) => ({
    ...r, total: R(r.total), deliveryCharged: R(r.deliveryCharged), courier: R(r.courier),
    productCost: R(r.productCost), packing: R(r.packing), profit: R(r.profit), lines: undefined, who: undefined,
  });

  return {
    ok,
    from,
    to: end,
    today,
    days: ok ? daysBetween(from, end) : 0,
    pay,
    includesToday: ok && end === today,
    rows: sales.map(out),
    cancelled: cancelled.map((r) => ({ ...r, total: R(r.total) })),
    totals: {
      count: sales.length,
      sold: R(sum(sales, (r) => r.total)),
      returns: R(sum(cameBack, (r) => r.total)),
      returnedCount: cameBack.length,
      received: R(sum(received, (r) => r.total)),
      receivedCount: received.length,
      unpaid: R(sum(unpaid, (r) => r.total)),
      unpaidCount: unpaid.length,
      deliveryCharged: R(sum(sales, (r) => r.deliveryCharged)),
      courier: R(sum(sales, (r) => r.courier)),
      courierGuessCount: sales.filter((r) => r.courierGuess).length,
      productCost: R(sum(sales, (r) => r.productCost)),
      packing: R(sum(sales, (r) => r.packing)),
      profit: R(profit),
      costMissingCount: sales.filter((r) => r.costMissing).length,
      coupons: R(sum(sales, (r) => paise(r.coupon?.off))),
      couponCount: sales.filter((r) => r.coupon).length,
      expenses: R(expenseTotal),
      kept: R(profit - expenseTotal),
      customers: buyers.size,
      returning: [...buyers].filter((w) => firstBuy.get(w) < from).length,
      cancelledCount: cancelled.length,
    },
    methods: [...methods.values()].sort((a, b) => b.amount - a.amount)
      .map((m) => ({ ...m, amount: R(m.amount), received: R(m.received), unpaid: R(m.unpaid), cameBack: R(m.cameBack) })),
    products: [...products_.values()].sort((a, b) => b.sales - a.sales)
      .map((p) => ({ name: p.name, qty: p.qty, sales: R(p.sales), cost: p.costKnown ? R(p.cost) : null })),
    expenses: spent.map((x) => ({ ...x, amount: R(x.amount) })),
  };
}

// ── what it is called and how it is shared ─────────────────────────────────

/** '98••• ••421': enough to tell two customers apart, not enough to call. */
export function maskPhone(phone) {
  const p = String(phone ?? '').replace(/\D/g, '');
  return p.length >= 10 ? `${p.slice(0, 2)}••• ••${p.slice(-3)}` : '';
}

/** 'krupa-agarbatti-sales-2026-10-01-to-2026-10-15', without the extension. */
export function statementFileName(shop, from, to) {
  const name = String(shop ?? '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return `${name || 'shop'}-sales-${from}-to-${to}`;
}

function cell(v) {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const itemsText = (r) => r.items.map((it) => `${it.name}${it.variant ? ` (${it.variant})` : ''} x ${it.qty}`).join('; ');

/** The same orders, one row each, for Excel. Same choices as the PDF. */
export function statementCsv(st, { showCosts = true, showPhones = false, withExpenses = false } = {}) {
  const money = (n) => Number(n).toFixed(2);
  const head = ['Date', 'Time', 'Order', 'Customer', 'Phone', 'Place', 'Pincode', 'What they ordered', 'Coupon',
    'Payment', 'Status', 'Order value (Rs)', 'Delivery charged (Rs)'];
  if (showCosts) head.push('Courier paid (Rs)', 'Product cost (Rs)', 'Packing (Rs)', 'Profit (Rs)');
  const lines = [head.join(',')];
  const phone = (p) => (showPhones ? p : maskPhone(p));
  for (const r of st.rows) {
    const row = [r.day, r.time, `#${r.no}`, r.name, phone(r.phone), r.place, r.pincode, itemsText(r),
      r.coupon ? `${r.coupon.code} -${r.coupon.off}` : '', r.methodLabel, STATE_LABEL[r.state], money(r.total), money(r.deliveryCharged)];
    if (showCosts) row.push(money(r.courier), r.costMissing ? '' : money(r.productCost), money(r.packing), money(r.profit));
    lines.push(row.map(cell).join(','));
  }
  if (st.cancelled.length) {
    lines.push('', cell('Cancelled orders, not counted above'));
    for (const r of st.cancelled) {
      lines.push([r.day, r.time, `#${r.no}`, r.name, phone(r.phone), r.place, r.pincode, itemsText(r), '',
        r.methodLabel, 'Cancelled', money(r.total)].map(cell).join(','));
    }
  }
  const t = st.totals;
  const summary = [['Orders', t.count], ['Sales', money(t.sold)], ['Money received', money(t.received)],
    ['Not paid yet', money(t.unpaid)], ['Parcels that came back', money(t.returns)], ['Delivery charged to customers', money(t.deliveryCharged)]];
  if (showCosts) {
    summary.push(['Product cost', money(-t.productCost)], ['Courier and delivery you paid', money(-t.courier)],
      ['Packing', money(-t.packing)], ['Profit on these orders', money(t.profit)]);
    if (withExpenses) summary.push(['Shop expenses', money(-t.expenses)], ['You kept after shop expenses', money(t.kept)]);
  }
  lines.push('', [cell('Summary'), cell(rangeLabel(st.from, st.to))].join(','));
  for (const [label, v] of summary) lines.push([cell(label), cell(v)].join(','));
  // A byte-order mark and CRLF, as hisaabCsv does, so Excel reads names right.
  return '﻿' + lines.join('\r\n');
}
