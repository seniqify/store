/**
 * Manage → Payments → Hisaab: "is my shop really making money?"
 *
 * The Money tab says where the money is. Hisaab says what the shop KEEPS once
 * everything it costs is paid: product cost, courier, packing, parcels that
 * came back, and the owner's own expenses (rent, ads, salary...). It owns no
 * accounting rules either. Which rows are sales and where their money stands
 * come from commerceMetrics; the per-item cost of goods is variants'
 * unitCostForItem, the same as the Profit block in Stats.
 *
 * Pure, and takes `now` as an argument rather than reading the clock.
 *
 * ── WHAT ONE ORDER COSTS ────────────────────────────────────────────────────
 *
 *   sold        the order's total, buyer's delivery and COD fees included
 *   returns     the whole total, when the parcel came back: that money is
 *               not coming. The goods came back too, so...
 *   productCost ...is counted only on orders that did NOT come back
 *   courier     the courier charge saved at booking (shipping_cost), else the
 *               shop's flat "delivery cost per order" from Settings
 *   packing     the shop's "packing cost per order" from Settings
 *
 *   You kept = sold − returns − productCost − courier − packing − expenses
 *
 * Every sale placed in the month counts, paid or still coming: Hisaab is the
 * month's earnings, the Money tab is the cash. Sales are dated by when the
 * order was placed, the one timestamp every order has.
 *
 * A product with no cost price adds nothing to productCost, which makes You
 * kept read HIGH. That is never hidden: `coverage` says how much of the
 * month's sales had no cost, and the screen says so beside the figure.
 *
 * ── EXPENSES ────────────────────────────────────────────────────────────────
 *
 * Rows from store_expenses (supabase/hisaab-forward.sql). A repeating one
 * counts once a month, on the same day of the month as the first (the last day
 * in a shorter month), from its first month to ends_on's month. In the current
 * month only the expenses dated up to today count: rent due on the 5th is not
 * spent on the 3rd.
 *
 * Money is summed in paise, integers, and turned into rupees on the way out.
 */
import { classifyOrder, paymentState, dayKeyInZone } from './commerceMetrics.js';
import { unitCostForItem, hasAnyCost } from './variants.js';
import { collectedChannel, KIND_LABEL } from './paymentsLedger.js';

/** The merchant's clock. Every day and month on this screen is theirs. */
export const HISAAB_TZ = 'Asia/Kolkata';

/** What an expense was for, in the order the Add expense screen shows them. */
export const EXPENSE_CATEGORIES = Object.freeze([
  { key: 'transport', label: 'Transport' },
  { key: 'packing', label: 'Packing' },
  { key: 'rent', label: 'Rent' },
  { key: 'salary', label: 'Salary' },
  { key: 'ads', label: 'Ads' },
  { key: 'raw_material', label: 'Raw material' },
  { key: 'other', label: 'Other' },
]);
export const CATEGORY_LABEL = Object.freeze(Object.fromEntries(EXPENSE_CATEGORIES.map((c) => [c.key, c.label])));

/** A product thinner than this (kept per ₹100 the buyer pays) is flagged. */
export const THIN_MARGIN = 15;
/** A product needs this many sold in the month before Hisaab calls it out. */
export const INSIGHT_MIN_SOLD = 3;
/** The "Coming up" window on Money in & out, in days after today. */
export const COMING_UP_DAYS = 7;
/** Months the month picker offers, newest first. */
export const MONTHS_BACK = 24;

const paise = (v) => { const n = Number(v); return Number.isFinite(n) ? Math.round(n * 100) : 0; };
const rupees = (p) => p / 100;
const pad = (n) => String(n).padStart(2, '0');
const lower = (v) => String(v ?? '').toLowerCase().trim();
const isDayKey = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s);
const isMonthKey = (s) => /^\d{4}-\d{2}$/.test(s);

// ── months ──────────────────────────────────────────────────────────────────

/** Today in the merchant's clock, 'YYYY-MM-DD' - for the screens, so they
 *  never reach past this file into the model. */
export function todayKey(now, timeZone = HISAAB_TZ) {
  return dayKeyInZone(now, timeZone);
}

/** Does this detailed list hold any sale? fetchOrders answers [] when it
 *  fails, so an empty list beside sales on record means it did not load. */
export function hasSales(orders) {
  return (Array.isArray(orders) ? orders : []).some((o) => classifyOrder(o) === 'sale');
}

export function daysInMonth(month) {
  if (!isMonthKey(month)) return 0;
  return new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
}

export function shiftMonth(month, by) {
  if (!isMonthKey(month)) return null;
  const i = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1 + by;
  return `${Math.floor(i / 12)}-${pad((i % 12) + 1)}`;
}

/** 'October', or 'October 2025' when it is not this year. */
export function monthLabel(month, currentMonth) {
  if (!isMonthKey(month)) return '';
  const name = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 15))
    .toLocaleDateString('en-IN', { month: 'long', timeZone: 'UTC' });
  return currentMonth && month.slice(0, 4) !== currentMonth.slice(0, 4) ? `${name} ${month.slice(0, 4)}` : name;
}

/** '14 Oct' for a day key. */
export function dayLabel(key) {
  if (!isDayKey(key)) return '';
  return new Date(`${key}T12:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

/** The months the picker offers: this one back to the first with any record. */
export function availableMonths({ orders = [], expenses = [], now, timeZone = HISAAB_TZ }) {
  const today = dayKeyInZone(now, timeZone);
  if (!today) return [];
  const current = today.slice(0, 7);
  let first = current;
  for (const o of orders) {
    const k = dayKeyInZone(Date.parse(o?.created_at), timeZone);
    if (k && k.slice(0, 7) < first) first = k.slice(0, 7);
  }
  for (const e of expenses) {
    const k = String(e?.spent_on ?? '').slice(0, 7);
    if (isMonthKey(k) && k < first) first = k;
  }
  const out = [];
  for (let m = current; m >= first && out.length < MONTHS_BACK; m = shiftMonth(m, -1)) out.push(m);
  return out;
}

// ── expenses ────────────────────────────────────────────────────────────────

/**
 * Each time an expense counts in `month`: [{ expense, key, amount }] with the
 * amount in paise. A one-off counts in its own month; a repeating one in every
 * month from its first to ends_on's.
 */
export function expenseOccurrences(expenses, month) {
  const out = [];
  if (!isMonthKey(month)) return out;
  for (const e of Array.isArray(expenses) ? expenses : []) {
    const start = String(e?.spent_on ?? '').slice(0, 10);
    const amount = paise(e?.amount);
    if (!isDayKey(start) || amount <= 0) continue;
    const startMonth = start.slice(0, 7);
    if (!e.repeats_monthly) {
      if (startMonth === month) out.push({ expense: e, key: start, amount });
      continue;
    }
    const endMonth = String(e.ends_on ?? '').slice(0, 7);
    if (month < startMonth || (isMonthKey(endMonth) && month > endMonth)) continue;
    const day = month === startMonth ? Number(start.slice(8, 10))
      : Math.min(Number(start.slice(8, 10)), daysInMonth(month));
    out.push({ expense: e, key: `${month}-${pad(day)}`, amount });
  }
  return out.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/** The goal that applies in `month`: the latest set at or before it. 0 = none. */
export function goalFor(goals, month) {
  let best = null;
  for (const g of Array.isArray(goals) ? goals : []) {
    const m = String(g?.month ?? '').slice(0, 7);
    if (!isMonthKey(m) || m > month) continue;
    if (!best || m > best.m) best = { m, amount: paise(g.amount) };
  }
  return best && best.amount > 0 ? rupees(best.amount) : null;
}

// ── one order ───────────────────────────────────────────────────────────────

function productsByName(products) {
  const map = new Map();
  for (const p of Array.isArray(products) ? products : []) if (p && p.name) map.set(p.name, p);
  return map;
}

/**
 * What one sale earned and cost, in paise, with its items' share of each.
 * Item shares are by the item's value in the order, so a combo and a sample
 * pack in one parcel split its courier charge fairly.
 */
export function orderEconomics(o, { byName, packagingCost = 0, deliveryCost = 0 }) {
  const total = paise(o?.total);
  const returned = paymentState(o) === 'written_off';
  const charge = Number(o?.shipping_cost);
  const courier = Number.isFinite(charge) && charge > 0 ? paise(charge)
    : Number(deliveryCost) > 0 ? paise(deliveryCost) : 0;
  const packing = Number(packagingCost) > 0 ? paise(packagingCost) : 0;

  const lines = [];
  for (const it of Array.isArray(o?.items) ? o.items : []) {
    const qty = Number(it?.qty) || 0;
    if (qty <= 0) continue;
    const value = Math.round(paise(it?.price) * qty);
    const unit = unitCostForItem(byName.get(it?.name), it);
    lines.push({ name: String(it?.name || 'Item'), qty, value, cost: unit == null ? null : Math.round(paise(unit) * qty) });
  }
  const itemsValue = lines.reduce((s, l) => s + l.value, 0);

  let productCost = 0;
  let unknownValue = 0;
  const unknownNames = [];
  if (!returned) {
    for (const l of lines) {
      if (l.cost == null) { unknownValue += l.value; unknownNames.push(l.name); } else productCost += l.cost;
    }
  }
  return {
    total, returned, courier, packing, productCost, unknownValue, unknownNames, lines, itemsValue,
    // What this order added to the month before the shop's own expenses.
    contribution: total - (returned ? total : 0) - productCost - courier - packing,
  };
}

// ── one month ───────────────────────────────────────────────────────────────

function emptyBook() {
  return { soldCount: 0, sold: 0, returns: 0, returnedCount: 0, productCost: 0, courier: 0, packing: 0, expenses: 0,
    unknownValue: 0, unknownNames: new Set(), costedValue: 0, deliveryCharged: 0, courierCount: 0 };
}

/**
 * The month's sales and costs, days 1..cutoffDay. Also the running total
 * per day, for the break-even day.
 */
function monthBook({ orders, expenses, month, cutoffDay, ctx, timeZone }) {
  const book = emptyBook();
  const days = daysInMonth(month);
  const perDay = new Array(days + 1).fill(0);      // index = day of month
  for (const o of orders) {
    if (classifyOrder(o) !== 'sale') continue;
    const key = dayKeyInZone(Date.parse(o?.created_at), timeZone);
    if (!key || key.slice(0, 7) !== month) continue;
    const day = Number(key.slice(8, 10));
    if (day > cutoffDay) continue;
    const e = orderEconomics(o, ctx);
    book.soldCount += 1;
    book.sold += e.total;
    if (e.returned) { book.returns += e.total; book.returnedCount += 1; }
    book.productCost += e.productCost;
    book.courier += e.courier;
    if (e.courier > 0) book.courierCount += 1;
    book.packing += e.packing;
    book.unknownValue += e.unknownValue;
    for (const n of e.unknownNames) book.unknownNames.add(n);
    if (!e.returned) book.costedValue += e.itemsValue - e.unknownValue;
    book.deliveryCharged += paise(o?.shipping) + paise(o?.cod_fee);
    perDay[day] += e.contribution;
  }
  const occurrences = expenseOccurrences(expenses, month).filter((x) => Number(x.key.slice(8, 10)) <= cutoffDay);
  for (const x of occurrences) {
    book.expenses += x.amount;
    perDay[Number(x.key.slice(8, 10))] -= x.amount;
  }
  book.kept = book.sold - book.returns - book.productCost - book.courier - book.packing - book.expenses;
  return { book, perDay, occurrences };
}

/** Whole rupees per ₹100 sold for each part, adding up to exactly 100. */
export function perHundred(parts, sold) {
  const keys = Object.keys(parts);
  if (!(sold > 0)) return Object.fromEntries(keys.map((k) => [k, 0]));
  const raw = keys.map((k) => ({ k, v: Math.max(0, parts[k]) / sold * 100 }));
  const sum = raw.reduce((s, r) => s + r.v, 0);
  // Only a split that fills the ₹100 is forced to add up to it; a month that
  // lost money has costs above ₹100 and shows them as they are.
  if (Math.abs(sum - 100) > 0.5) return Object.fromEntries(raw.map((r) => [r.k, Math.round(r.v)]));
  const floor = raw.map((r) => ({ ...r, f: Math.floor(r.v), rem: r.v - Math.floor(r.v) }));
  let left = 100 - floor.reduce((s, r) => s + r.f, 0);
  for (const r of [...floor].sort((a, b) => b.rem - a.rem)) { if (left <= 0) break; r.f += 1; left -= 1; }
  return Object.fromEntries(floor.map((r) => [r.k, r.f]));
}

const pctChange = (now, was) => (was > 0 ? Math.round(((now - was) / was) * 100) : null);

/**
 * Everything the Hisaab home screen shows for one month.
 *
 * @param {object} p
 * @param {Array}  p.orders     detailed rows (fetchOrders) - items are needed
 * @param {Array}  p.expenses   store_expenses rows
 * @param {Array}  p.goals      store_sales_goals rows
 * @param {Array}  p.products   config.products, for cost prices
 * @param {number} p.packagingCost  Settings: packing cost per order
 * @param {number} p.deliveryCost   Settings: delivery cost per order (fallback)
 * @param {number} p.now        epoch ms; the only clock reading, supplied
 * @param {string} [p.month]    'YYYY-MM'; defaults to the current month
 */
export function buildHisaab({
  orders = [], expenses = [], goals = [], products = [],
  packagingCost = 0, deliveryCost = 0, now, month, timeZone = HISAAB_TZ,
} = {}) {
  const rows = Array.isArray(orders) ? orders : [];
  const today = dayKeyInZone(now, timeZone);
  const current = today ? today.slice(0, 7) : null;
  const m = isMonthKey(month) ? month : current;
  const days = daysInMonth(m);
  const isCurrent = m === current;
  const cutoffDay = isCurrent ? Number(today.slice(8, 10)) : days;
  const ctx = { byName: productsByName(products), packagingCost, deliveryCost };

  const { book, perDay } = monthBook({ orders: rows, expenses, month: m, cutoffDay, ctx, timeZone });

  // Same days of the month before: 1-22 Sep against 1-22 Oct.
  const prev = shiftMonth(m, -1);
  const prevCut = Math.min(cutoffDay, daysInMonth(prev));
  const { book: was } = monthBook({ orders: rows, expenses, month: prev, cutoffDay: prevCut, ctx, timeZone });

  const parts = {
    productCost: book.productCost, returns: book.returns, courier: book.courier,
    expenses: book.expenses, packing: book.packing, kept: Math.max(0, book.kept),
  };
  const per100 = perHundred(parts, book.sold);

  // Break-even: the day from which the month has stayed in profit.
  let running = 0;
  let lastBelow = 0;
  for (let d = 1; d <= cutoffDay; d++) {
    running += perDay[d];
    if (running < 0) lastBelow = d;
  }
  const inProfit = running >= 0 && book.sold > 0;
  const breakEven = {
    hasExpenses: book.expenses > 0,
    inProfit,
    day: inProfit && lastBelow < cutoffDay ? `${m}-${pad(lastBelow + 1)}` : null,
    short: inProfit ? 0 : rupees(-running),
    expenses: rupees(book.expenses),
  };

  const goalAmount = goalFor(goals, m);
  const soldRs = rupees(book.sold);
  const daysLeft = isCurrent ? days - cutoffDay : 0;
  const goal = goalAmount == null ? null : {
    amount: goalAmount,
    progress: goalAmount > 0 ? soldRs / goalAmount : 0,
    reached: soldRs >= goalAmount,
    left: Math.max(0, goalAmount - soldRs),
    daysLeft,
    perDay: daysLeft > 0 ? Math.ceil(Math.max(0, goalAmount - soldRs) / daysLeft) : null,
  };

  const returnsPer100 = book.sold > 0 ? Math.round((book.returns / book.sold) * 100) : null;
  const wasReturnsPer100 = was.sold > 0 ? Math.round((was.returns / was.sold) * 100) : null;
  const compare = {
    month: prev,
    toDay: prevCut,
    wholeMonth: !isCurrent,
    sold: { now: soldRs, was: rupees(was.sold), change: pctChange(book.sold, was.sold) },
    kept: { now: rupees(book.kept), was: rupees(was.kept), change: was.kept > 0 ? pctChange(book.kept, was.kept) : null },
    returnsPer100: { now: returnsPer100, was: wasReturnsPer100 },
    hasData: was.soldCount > 0,
  };

  const byCategory = new Map();
  for (const x of expenseOccurrences(expenses, m)) {
    if (Number(x.key.slice(8, 10)) > cutoffDay) continue;
    const k = x.expense.category in CATEGORY_LABEL ? x.expense.category : 'other';
    byCategory.set(k, (byCategory.get(k) || 0) + x.amount);
  }

  const productRows = buildProductProfit({ orders: rows, products, packagingCost, deliveryCost, now, month: m, timeZone });
  const costed = (Array.isArray(products) ? products : []).filter((p) => p && p.name && hasAnyCost(p)).length;

  return {
    month: m,
    today,
    isCurrent,
    cutoffDay,
    daysInMonth: days,
    sold: { count: book.soldCount, amount: soldRs },
    returnedCount: book.returnedCount,
    split: Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, rupees(v)])),
    per100,
    kept: rupees(book.kept),
    coverage: {
      unknownValue: rupees(book.unknownValue),
      unknownProducts: [...book.unknownNames].sort(),
      anyCost: costed > 0,
      // Share of the goods sold (not returned) that had a cost price.
      share: book.costedValue + book.unknownValue > 0
        ? book.costedValue / (book.costedValue + book.unknownValue) : 1,
    },
    expenses: {
      total: rupees(book.expenses),
      byCategory: EXPENSE_CATEGORIES.filter((c) => byCategory.has(c.key))
        .map((c) => ({ key: c.key, label: c.label, amount: rupees(byCategory.get(c.key)) })),
    },
    delivery: { charged: rupees(book.deliveryCharged), spent: rupees(book.courier), orders: book.courierCount },
    breakEven,
    goal,
    compare,
    products: productRows,
    insights: buildInsights({ products: productRows, compare, delivery: { charged: book.deliveryCharged, spent: book.courier, orders: book.courierCount } }),
  };
}

// ── products ────────────────────────────────────────────────────────────────

/**
 * What each product earned the shop in the month, after its share of every
 * cost (product cost, courier, packing, returns). Products with no cost price
 * are listed apart (`costKnown: false`): their profit cannot be told.
 *
 * Per one sold, the parts add up exactly:
 *   buyerPays − productCost − courier − packing − returns = kept
 */
export function buildProductProfit({
  orders = [], products = [], packagingCost = 0, deliveryCost = 0, now, month, timeZone = HISAAB_TZ,
} = {}) {
  const today = dayKeyInZone(now, timeZone);
  const m = isMonthKey(month) ? month : today ? today.slice(0, 7) : null;
  const cutoffDay = today && m === today.slice(0, 7) ? Number(today.slice(8, 10)) : daysInMonth(m);
  const ctx = { byName: productsByName(products), packagingCost, deliveryCost };
  const acc = new Map();

  for (const o of Array.isArray(orders) ? orders : []) {
    if (classifyOrder(o) !== 'sale') continue;
    const key = dayKeyInZone(Date.parse(o?.created_at), timeZone);
    if (!key || key.slice(0, 7) !== m || Number(key.slice(8, 10)) > cutoffDay) continue;
    const e = orderEconomics(o, ctx);
    if (e.itemsValue <= 0) continue;
    const seen = new Set();
    for (const l of e.lines) {
      const share = l.value / e.itemsValue;
      const r = acc.get(l.name) || { name: l.name, units: 0, orders: 0, returnedUnits: 0, buyerPays: 0,
        productCost: 0, courier: 0, packing: 0, returns: 0, costKnown: true, singleOrders: 0, price: 0 };
      r.units += l.qty;
      r.price += l.value;
      if (!seen.has(l.name)) { r.orders += 1; seen.add(l.name); if (e.lines.length === 1) r.singleOrders += 1; }
      r.buyerPays += share * e.total;
      r.courier += share * e.courier;
      r.packing += share * e.packing;
      if (e.returned) { r.returns += share * e.total; r.returnedUnits += l.qty; } else if (l.cost == null) r.costKnown = false;
      else r.productCost += l.cost;
      acc.set(l.name, r);
    }
  }

  return [...acc.values()].map((r) => {
    // Whole rupees per one sold, and `kept` is the parts' own difference, so
    // the breakdown on screen adds up to the rupee.
    const per = (v) => Math.round(v / r.units / 100);
    const kept = r.buyerPays - r.productCost - r.courier - r.packing - r.returns;
    const paysEach = per(r.buyerPays);
    const each = {
      buyerPays: paysEach, productCost: per(r.productCost), courier: per(r.courier),
      packing: per(r.packing), returns: per(r.returns),
    };
    const keptEach = each.buyerPays - each.productCost - each.courier - each.packing - each.returns;
    return {
      name: r.name,
      units: r.units,
      orders: r.orders,
      singleOrders: r.singleOrders,
      returnedUnits: r.returnedUnits,
      costKnown: r.costKnown,
      price: r.price / r.units / 100,
      each: { ...each, kept: keptEach },
      month: { kept: Math.round(kept) / 100, buyerPays: Math.round(r.buyerPays) / 100 },
      margin: paysEach > 0 ? Math.round((keptEach / paysEach) * 100) : 0,
    };
  }).sort((a, b) => (a.costKnown === b.costKnown ? b.each.kept - a.each.kept : a.costKnown ? -1 : 1));
}

/**
 * Ways to stop a product losing money, priced from its own numbers. Each says
 * what the shop would keep on one sold. Nothing here changes a price: the
 * screen opens Products for that.
 */
export function fixesFor(p) {
  if (!p || !p.costKnown || p.each.kept >= 0 || p.units <= 0) return [];
  const out = [];
  const backShare = p.returnedUnits / p.units;           // a returned one pays nothing
  const lift = (1 - backShare) || 1;
  // A price ending in 9, at least ₹10 above where it stops losing money.
  const need = p.price + (-p.each.kept) / lift + 10;
  const price = Math.ceil((need + 1) / 10) * 10 - 1;
  out.push({ kind: 'price', price, keeps: Math.round(p.each.kept + (price - p.price) * lift) });
  if (p.each.courier > -p.each.kept && p.singleOrders > 0) {
    out.push({ kind: 'bundle', saves: Math.round(p.each.courier) });
  }
  return out;
}

// ── worth knowing ───────────────────────────────────────────────────────────

function buildInsights({ products, compare, delivery }) {
  const out = [];
  const losing = products.filter((p) => p.costKnown && p.units >= INSIGHT_MIN_SOLD && p.each.kept < 0)
    .sort((a, b) => a.month.kept - b.month.kept)[0];
  if (losing) {
    out.push({ kind: 'losing', tone: 'bad', product: losing.name,
      title: `${losing.name} loses ${fmt(-losing.each.kept)} on every one sold`,
      sub: `${losing.units} sold this month. See why, and what would fix it.` });
  }
  const r = compare.returnsPer100;
  if (compare.hasData && r.now != null && r.was != null && Math.abs(r.now - r.was) >= 2) {
    const better = r.now < r.was;
    out.push({ kind: 'returns', tone: better ? 'good' : 'bad',
      title: better ? 'Fewer parcels are coming back' : 'More parcels are coming back',
      sub: `Returns are ${fmt(r.now)} of every ₹100 sold, ${better ? 'down' : 'up'} from ${fmt(r.was)}.` });
  }
  const gap = delivery.spent - delivery.charged;
  if (delivery.orders >= INSIGHT_MIN_SOLD && gap >= 2000 * delivery.orders) {
    out.push({ kind: 'delivery', tone: 'bad',
      title: `Delivery costs you ${fmt(rupees(gap))} more than buyers pay for it`,
      sub: 'A small delivery fee, or free delivery only above an order value, would cover it.' });
  }
  return out.slice(0, 3);
}

const fmt = (n) => `₹${Math.round(Number(n) || 0).toLocaleString('en-IN')}`;

// ── money in & out ──────────────────────────────────────────────────────────

/**
 * The day book: every rupee in and out, day by day, newest day first.
 *
 *   in   payments received, dated by paid_at (a payment with no recorded date
 *        is in no day - the Money tab says how many)
 *   out  the shop's expenses, and the courier and packing costs Hisaab counts
 *        for orders placed that day
 */
export function buildDayBook({
  orders = [], expenses = [], products = [], packagingCost = 0, deliveryCost = 0,
  now, month, timeZone = HISAAB_TZ,
} = {}) {
  const today = dayKeyInZone(now, timeZone);
  const m = isMonthKey(month) ? month : today ? today.slice(0, 7) : null;
  const lastKey = today && m === today.slice(0, 7) ? today : `${m}-${pad(daysInMonth(m))}`;
  const ctx = { byName: productsByName(products), packagingCost, deliveryCost };
  const days = new Map();
  const dayOf = (key) => {
    if (!days.has(key)) days.set(key, { key, in: 0, out: 0, entries: [], courier: { count: 0, amount: 0 }, packing: { count: 0, amount: 0 } });
    return days.get(key);
  };
  const inMonth = (key) => key && key.slice(0, 7) === m && key <= lastKey;

  for (const o of Array.isArray(orders) ? orders : []) {
    if (classifyOrder(o) !== 'sale') continue;
    if (paymentState(o) === 'collected' && o?.paid_at) {
      const t = Date.parse(o.paid_at);
      const key = dayKeyInZone(t, timeZone);
      if (inMonth(key)) {
        const d = dayOf(key);
        const amount = paise(o.total);
        d.in += amount;
        d.entries.push({ kind: 'in', at: t, amount: rupees(amount), label: KIND_LABEL[collectedChannel(o)] || 'Paid',
          who: o.customer_name || 'Customer', orderId: o.id });
      }
    }
    const placed = dayKeyInZone(Date.parse(o?.created_at), timeZone);
    if (inMonth(placed)) {
      const e = orderEconomics(o, ctx);
      const d = dayOf(placed);
      if (e.courier > 0) { d.courier.count += 1; d.courier.amount += e.courier; d.out += e.courier; }
      if (e.packing > 0) { d.packing.count += 1; d.packing.amount += e.packing; d.out += e.packing; }
    }
  }
  for (const x of expenseOccurrences(expenses, m)) {
    if (!inMonth(x.key)) continue;
    const d = dayOf(x.key);
    d.out += x.amount;
    d.entries.push({ kind: 'expense', amount: rupees(x.amount), expense: x.expense,
      label: x.expense.note || CATEGORY_LABEL[x.expense.category] || 'Expense' });
  }

  return [...days.values()].sort((a, b) => (a.key < b.key ? 1 : -1)).map((d) => {
    const counted = [];
    if (d.courier.count) counted.push({ kind: 'counted', label: `Courier and delivery, ${d.courier.count} ${d.courier.count === 1 ? 'order' : 'orders'}`, amount: rupees(d.courier.amount) });
    if (d.packing.count) counted.push({ kind: 'counted', label: `Packing, ${d.packing.count} ${d.packing.count === 1 ? 'order' : 'orders'}`, amount: rupees(d.packing.amount) });
    const ins = d.entries.filter((x) => x.kind === 'in').sort((a, b) => b.at - a.at);
    const outs = d.entries.filter((x) => x.kind === 'expense');
    return { key: d.key, in: rupees(d.in), out: rupees(d.out), net: rupees(d.in - d.out), entries: [...ins, ...outs, ...counted] };
  });
}

/** Repeating expenses due after today, within COMING_UP_DAYS. */
export function comingUp({ expenses = [], now, timeZone = HISAAB_TZ, days = COMING_UP_DAYS } = {}) {
  const today = dayKeyInZone(now, timeZone);
  if (!today) return [];
  const last = dayKeyInZone(now + days * 86400000, timeZone);
  const months = [today.slice(0, 7), shiftMonth(today.slice(0, 7), 1)];
  const out = [];
  for (const month of months) {
    for (const x of expenseOccurrences(expenses.filter((e) => e?.repeats_monthly), month)) {
      if (x.key > today && x.key <= last) out.push({ key: x.key, amount: rupees(x.amount), expense: x.expense,
        label: x.expense.note || CATEGORY_LABEL[x.expense.category] || 'Expense' });
    }
  }
  return out.sort((a, b) => (a.key < b.key ? -1 : 1));
}

/** "Or add again": the last few different expenses, newest first. */
export function recentExpenses(expenses = [], n = 3) {
  const out = [];
  const seen = new Set();
  const sorted = [...(Array.isArray(expenses) ? expenses : [])]
    .sort((a, b) => String(b?.created_at ?? '').localeCompare(String(a?.created_at ?? '')));
  for (const e of sorted) {
    const k = `${e.category}|${lower(e.note)}|${paise(e.amount)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(e);
    if (out.length >= n) break;
  }
  return out;
}

// ── the month's file for the CA ─────────────────────────────────────────────

// A cell a spreadsheet will not run as a formula.
function cell(v) {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const STATE_WORD = { collected: 'Paid', outstanding: 'Not paid yet', written_off: 'Returned' };

/** The month as one CSV: every sale, every expense, then the summary. */
export function hisaabCsv({ hisaab, orders = [], expenses = [], timeZone = HISAAB_TZ }) {
  const m = hisaab.month;
  const lines = [['Date', 'Type', 'Details', 'Payment', 'Status', 'Amount (Rs)'].join(',')];
  const sales = (Array.isArray(orders) ? orders : [])
    .filter((o) => classifyOrder(o) === 'sale')
    .map((o) => ({ o, key: dayKeyInZone(Date.parse(o?.created_at), timeZone) }))
    .filter(({ key }) => key && key.slice(0, 7) === m && Number(key.slice(8, 10)) <= hisaab.cutoffDay)
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  for (const { o, key } of sales) {
    lines.push([key, 'Sale', `Order from ${o.customer_name || 'Customer'}`,
      lower(o.payment_method) === 'online' ? 'Online' : 'Cash on delivery',
      STATE_WORD[paymentState(o)] || '', rupees(paise(o.total)).toFixed(2)].map(cell).join(','));
  }
  for (const x of expenseOccurrences(expenses, m)) {
    if (Number(x.key.slice(8, 10)) > hisaab.cutoffDay) continue;
    const e = x.expense;
    lines.push([x.key, 'Expense', [CATEGORY_LABEL[e.category] || 'Other', e.note].filter(Boolean).join(': '),
      e.paid_with === 'bank' ? 'UPI / bank' : 'Cash', e.repeats_monthly ? 'Every month' : '',
      (-rupees(x.amount)).toFixed(2)].map(cell).join(','));
  }
  const s = hisaab.split;
  lines.push('');
  for (const [label, v] of [['Sold', hisaab.sold.amount], ['Parcels that came back', -s.returns],
    ['Product cost', -s.productCost], ['Courier and delivery', -s.courier], ['Packing', -s.packing],
    ['Expenses', -s.expenses], ['You kept', hisaab.kept]]) {
    lines.push(['', 'Summary', label, '', '', Number(v).toFixed(2)].map(cell).join(','));
  }
  // A byte-order mark and CRLF, as contactsToCsv does, so Excel reads names right.
  return '﻿' + lines.join('\r\n');
}
