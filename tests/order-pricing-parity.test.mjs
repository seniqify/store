// The pricing engine, and the promise that the browser and the server compute
// the same money. These are the fixtures both sides are held to.
//
// The engine is pure, so it can be executed here directly — unlike the SQL and
// the Deno function, which are pinned by source tests elsewhere.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  calcCartTotals, priceOrder, resolveLineStrict, variantExtrasOf,
  couponOutcome, couponDiscountValue, isCouponLiveLocal, endOfDayInZone,
  MAX_QTY_PER_LINE,
} from '../shared/pricing.mjs';

const read = (p) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), 'utf8');

// ── a store, as it is actually shaped in production ──────────────────────────
const STORE = {
  cart: {
    taxRate: 0.05, taxInclusive: false, freeShippingAbove: 500,
    shippingCharge: 50, packagingCharge: 10, codCharge: 20,
  },
  products: [
    { id: '101', name: 'Amti Premix', price: 270, mrp: 300, stock: 4 },
    { id: '102', name: 'Masala Oil', price: 180, gstRate: 0.18 },
    { id: '103', name: 'Loose Tea', price: 100, taxInclusive: true },
    { id: '104', name: 'Spice Box', price: 500, inStock: false },
    { id: '105', name: 'Pickle',
      variants: { label: 'Size', options: [
        { name: '250g', price: 120, mrp: 150 },
        { name: '1kg',  price: 400, mrp: 460 },
      ] },
      variantExtras: [
        { label: 'Heat', options: [{ name: 'Mild' }, { name: 'Hot', addPrice: 20 }] },
        { label: 'Pack', options: [{ name: 'Single' }, { name: 'Pack of 3', addPrice: 50 }] },
      ] },
  ],
  coupons: [
    { id: 'c1', code: 'SAVE10', active: true,  discountType: 'percent', discountValue: 10 },
    { id: 'c2', code: 'FLAT50', active: true,  discountType: 'flat',    discountValue: 50, minOrder: 400 },
    { id: 'c3', code: 'OLD',    active: true,  discountType: 'flat',    discountValue: 30, expiresAt: '2026-09-01' },
    { id: 'c4', code: 'OFF',    active: false, discountType: 'flat',    discountValue: 30 },
  ],
};

const line = (productId, qty = 1, variant = null, extras = []) => ({ productId, variant, extras, qty });
const NOW = new Date('2026-09-16T12:00:00Z');

// ── the arithmetic ───────────────────────────────────────────────────────────

test('totals: exclusive GST is added, shipping charged below the threshold', () => {
  const t = calcCartTotals([{ price: 270, qty: 1, gstRate: 0.05 }], STORE.cart, 'cod');
  assert.equal(t.subtotal, 270);
  assert.equal(t.tax, 14);                 // round(270 * 0.05)
  assert.equal(t.shipping, 50);
  assert.equal(t.packaging, 10);
  assert.equal(t.codFee, 20);
  assert.equal(t.total, 270 + 14 + 50 + 10 + 20);
});

test('totals: free shipping applies at exactly the threshold, not below it', () => {
  const at    = calcCartTotals([{ price: 500, qty: 1 }], STORE.cart, 'online');
  const below = calcCartTotals([{ price: 499, qty: 1 }], STORE.cart, 'online');
  assert.equal(at.shipping, 0);
  assert.equal(below.shipping, 50);
});

test('totals: a zero or blank threshold means no free-delivery offer', () => {
  const cfg = { ...STORE.cart, freeShippingAbove: 0 };
  assert.equal(calcCartTotals([{ price: 5000, qty: 1 }], cfg, 'online').shipping, 50);
  const blank = { ...STORE.cart, freeShippingAbove: undefined };
  assert.equal(calcCartTotals([{ price: 5000, qty: 1 }], blank, 'online').shipping, 50);
});

test('totals: inclusive GST is back-calculated, never added on top', () => {
  const t = calcCartTotals([{ price: 100, qty: 1, gstRate: 0.05, taxInclusive: true }], STORE.cart, 'online');
  assert.equal(t.subtotal, 100);
  assert.equal(t.total, 100 + 50 + 10);    // tax already inside the price
  assert.equal(t.tax, 5);                   // 100 - 100/1.05, rounded
});

test('totals: a mixed-rate, mixed-mode cart sums per line', () => {
  const t = calcCartTotals([
    { price: 270, qty: 1, gstRate: 0.05 },
    { price: 180, qty: 2, gstRate: 0.18 },
    { price: 100, qty: 1, gstRate: 0.05, taxInclusive: true },
  ], STORE.cart, 'online');
  assert.equal(t.subtotal, 270 + 360 + 100);
  assert.equal(t.taxUniformPct, null, 'mixed rates expose no single rate');
  assert.equal(t.taxInclusive, false, 'not every taxed line is inclusive');
});

test('totals: the COD fee applies only to cash on delivery', () => {
  const items = [{ price: 100, qty: 1 }];
  assert.equal(calcCartTotals(items, STORE.cart, 'cod').codFee, 20);
  assert.equal(calcCartTotals(items, STORE.cart, 'online').codFee, 0);
});

test('totals: an empty cart charges nothing at all', () => {
  const t = calcCartTotals([], STORE.cart, 'cod');
  assert.deepEqual([t.subtotal, t.shipping, t.packaging, t.codFee, t.total], [0, 0, 0, 0, 0]);
});

// ── resolution: what the server will and will not accept ─────────────────────

test('a plain product resolves to its catalog price', () => {
  const r = resolveLineStrict(STORE.products[0], { qty: 2 });
  assert.equal(r.ok, true);
  assert.deepEqual([r.line.price, r.line.qty, r.line.name], [270, 2, 'Amti Premix']);
});

test('a priced variant resolves to that option, and extras add on top', () => {
  const p = STORE.products[4];
  const r = resolveLineStrict(p, { variant: '1kg', extras: ['Hot', 'Pack of 3'], qty: 1 });
  assert.equal(r.line.price, 400 + 20 + 50);
  assert.equal(r.line.mrp, 460 + 20 + 50);
  assert.equal(r.line.variant, '1kg, Hot, Pack of 3');
});

test('an unknown variant is refused, never silently repriced to the first option', () => {
  // This is the one place the server deliberately differs from the UI, which
  // falls back to options[0] so a card always renders.
  const r = resolveLineStrict(STORE.products[4], { variant: '5kg', qty: 1 });
  assert.deepEqual([r.ok, r.reason], [false, 'variant_unavailable']);
});

test('an unknown extra option is refused too', () => {
  const r = resolveLineStrict(STORE.products[4], { variant: '250g', extras: ['Nuclear'], qty: 1 });
  assert.deepEqual([r.ok, r.reason], [false, 'variant_unavailable']);
});

test('a group the request says nothing about takes that group first option', () => {
  const r = resolveLineStrict(STORE.products[4], { variant: '250g', extras: [], qty: 1 });
  assert.equal(r.line.price, 120, 'Mild + Single add nothing');
});

test('quantities must be whole numbers inside the allowed range', () => {
  for (const qty of [0, -1, 1.5, MAX_QTY_PER_LINE + 1, 'lots', null]) {
    assert.equal(resolveLineStrict(STORE.products[0], { qty }).ok, false, String(qty));
  }
  assert.equal(resolveLineStrict(STORE.products[0], { qty: MAX_QTY_PER_LINE }).ok, true);
});

test('malformed extras groups are ignored, well-formed ones are kept', () => {
  assert.equal(variantExtrasOf({ variantExtras: [{ label: '', options: [] }, null] }).length, 0);
  assert.equal(variantExtrasOf(STORE.products[4]).length, 2);
});

// ── priceOrder: the whole quote, from config only ────────────────────────────

test('a quote is built entirely from config — prices in the request are ignored', () => {
  const hostile = {
    slug: 's', paymentMethod: 'cod',
    lines: [{ productId: '101', qty: 1, price: 1, total: 1, mrp: 1 }],
  };
  const q = priceOrder(STORE, hostile, NOW);
  assert.equal(q.ok, true);
  assert.equal(q.lines[0].price, 270, 'the catalog price, not the ₹1 the caller sent');
  assert.equal(q.totals.subtotal, 270);
  assert.equal(q.totals.total, 270 + 14 + 50 + 10 + 20);
});

test('a deleted product refuses the whole order', () => {
  const q = priceOrder(STORE, { lines: [line('101'), line('999')], paymentMethod: 'cod' }, NOW);
  assert.deepEqual([q.ok, q.reason, q.productId], [false, 'product_unavailable', '999']);
});

test('a product marked out of stock refuses the whole order', () => {
  const q = priceOrder(STORE, { lines: [line('104')], paymentMethod: 'cod' }, NOW);
  assert.deepEqual([q.ok, q.reason], [false, 'product_unavailable']);
});

test('an empty or oversized cart is refused', () => {
  assert.equal(priceOrder(STORE, { lines: [] }, NOW).reason, 'no_items');
  const many = Array.from({ length: 51 }, () => line('101'));
  assert.equal(priceOrder(STORE, { lines: many }, NOW).reason, 'too_many_lines');
});

// ── coupons, server-side ─────────────────────────────────────────────────────

test('a live percent coupon discounts the subtotal', () => {
  const q = priceOrder(STORE, { lines: [line('101')], paymentMethod: 'online', couponCode: 'save10' }, NOW);
  assert.deepEqual([q.coupon.applied, q.coupon.discount], [true, 27]);
  assert.equal(q.totals.discount, 27);
  assert.equal(q.totals.total, 270 + 14 + 50 + 10 - 27);
});

test('a coupon below its minimum is refused, and the order still goes through', () => {
  const q = priceOrder(STORE, { lines: [line('101')], paymentMethod: 'online', couponCode: 'FLAT50' }, NOW);
  assert.deepEqual([q.ok, q.coupon.applied, q.coupon.reason], [true, false, 'below_min_order']);
  assert.equal(q.totals.discount, 0);
});

test('expired, inactive and unknown coupons are each refused with their reason', () => {
  const at = (code) => priceOrder(STORE, { lines: [line('101')], couponCode: code }, NOW).coupon;
  assert.equal(at('OLD').reason, 'expired');
  assert.equal(at('OFF').reason, 'inactive');
  assert.equal(at('NOPE').reason, 'not_found');
  assert.equal(at(null).reason, 'none');
});

test('coupon expiry is pinned to a zone, not to whoever is asking', () => {
  // 2026-09-01 in IST ends at 18:29:59.999Z on the same date.
  const end = endOfDayInZone('2026-09-01');
  assert.equal(end.toISOString(), '2026-09-01T18:29:59.999Z');
  const live = new Date('2026-09-01T18:00:00Z');
  const dead = new Date('2026-09-01T19:00:00Z');
  assert.equal(couponOutcome(STORE.coupons, 'OLD', 1000, live).applied, true);
  assert.equal(couponOutcome(STORE.coupons, 'OLD', 1000, dead).reason, 'expired');
});

test('the discount never exceeds the subtotal and never goes negative', () => {
  assert.equal(couponDiscountValue({ discountType: 'flat', discountValue: 99999 }, 100), 100);
  assert.equal(couponDiscountValue({ discountType: 'flat', discountValue: -5 }, 100), 0);
});

// ── the browser keeps its historical behaviour ───────────────────────────────

test('the storefront still uses the browser-local expiry rule, unchanged', () => {
  const offers = read('src/utils/offers.js');
  assert.match(offers, /isCouponLiveLocal\(c, now\)/);
  assert.equal(typeof isCouponLiveLocal, 'function');
  // Same shape as before the refactor: active flag first, then the date.
  assert.equal(isCouponLiveLocal({ active: false }), false);
  assert.equal(isCouponLiveLocal({ active: true }), true);
});

test('the client modules now delegate to the shared engine', () => {
  assert.match(read('src/utils/currency.js'), /from '\.\.\/\.\.\/shared\/pricing\.mjs'/);
  assert.match(read('src/utils/currency.js'), /return sharedCalcCartTotals\(items, cartConfig, paymentMethod\);/);
  assert.match(read('src/utils/variants.js'), /export \{ variantExtrasOf, resolveSelection \};/);
  assert.match(read('src/utils/offers.js'), /couponDiscountValue\(coupon, subtotal\)/);
});

test('the shared engine imports nothing — it must run in the browser and in Deno', () => {
  const src = read('shared/pricing.mjs');
  assert.equal(/^import\s/m.test(src), false, 'no imports at all');
  assert.equal(/require\(/.test(src), false);
  // Strip comments: they name Deno and the browser precisely because the code must not.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.equal(/\b(document|window|Deno|process|localStorage)\b/.test(code), false,
    'no runtime-specific globals');
});
