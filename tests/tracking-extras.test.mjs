// The order tracking page's selling section (src/utils/trackingExtras.js and its
// wiring in src/pages/OrderTracking.jsx): the shop's offer, more of its
// products, and a real "Order again". The WhatsApp utility messages stay pure
// order updates; their buttons land here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pickShopOffer, suggestProducts, reorderLines } from '../src/utils/trackingExtras.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const NOW = new Date('2026-10-08T10:00:00+05:30');   // a Wednesday
const sales = (map) => ({ get: (name) => (name in map ? { sold: map[name] } : undefined) });

// ── the offer ───────────────────────────────────────────────────────────────

test('offer: a live sale first, the one ending soonest', () => {
  const cfg = {
    offers: [
      { id: 'a', name: 'Navratri', active: true, discountType: 'percent', discountValue: 10, schedule: { type: 'always' } },
      { id: 'b', name: 'Diwali', active: true, discountType: 'percent', discountValue: 20, schedule: { type: 'range', start: '2026-10-01', end: '2026-10-31' } },
      { id: 'c', name: 'Off', active: false, discountType: 'flat', discountValue: 50, schedule: { type: 'always' } },
    ],
    coupons: [{ code: 'NEXT10', discountType: 'percent', discountValue: 10, active: true, showOnOrderPage: true }],
  };
  const o = pickShopOffer(cfg, NOW);
  assert.equal(o.kind, 'sale');
  assert.equal(o.title, 'Diwali · 20% off');
  assert.equal(o.code, null, 'a sale needs no code');
  assert.match(o.note, /^Ends 31 Oct$/);
  // An always-on sale alone: no end date.
  assert.deepEqual(pickShopOffer({ offers: [cfg.offers[0]] }, NOW), { kind: 'sale', label: 'Sale on now', title: 'Navratri · 10% off', code: null, note: '' });
});

test('offer: a coupon ONLY when the shop chose to show it on order pages', () => {
  const coupon = { code: 'DIWALI20', discountType: 'percent', discountValue: 20, minOrder: 299, expiresAt: '2026-10-31', active: true };
  assert.equal(pickShopOffer({ coupons: [coupon] }, NOW), null, 'private by default');
  assert.equal(pickShopOffer({ coupons: [{ ...coupon, showOnOrderPage: 'yes' }] }, NOW), null, 'only a real true');
  const o = pickShopOffer({ coupons: [{ ...coupon, code: 'STAFF50' }, { ...coupon, showOnOrderPage: true }] }, NOW);
  assert.deepEqual(o, { kind: 'coupon', label: 'For your next order', title: '20% off', code: 'DIWALI20', note: 'Valid till 31 Oct · on orders above ₹299' });
  assert.equal(pickShopOffer({ coupons: [{ ...coupon, showOnOrderPage: true, active: false }] }, NOW), null, 'switched off');
  assert.equal(pickShopOffer({ coupons: [{ ...coupon, showOnOrderPage: true, expiresAt: '2026-10-01' }] }, NOW), null, 'expired');
  assert.equal(pickShopOffer({ coupons: [{ ...coupon, showOnOrderPage: true, discountType: 'flat', discountValue: 50, minOrder: '', expiresAt: '' }] }, NOW).title, '₹50 off');
  assert.equal(pickShopOffer({}, NOW), null);
  assert.equal(pickShopOffer(null, NOW), null);
});

// ── more from the shop ──────────────────────────────────────────────────────

const PRODUCTS = [
  { id: 'p1', name: 'Amti Premix', price: 270 },
  { id: 'p2', name: 'Goda Masala', price: 380, image: 'goda.jpg' },
  { id: 'p3', name: 'Malvani Masala', price: 160 },
  { id: 'p4', name: 'Kanda Lasun', price: 90, inStock: false },
  { id: 'p5', name: 'Kala Masala', price: 120, stock: 0 },
  { id: 'p6', name: 'Chilli Powder', price: 0 },
  { id: 'p7', name: 'Sizes', price: null, variants: { label: 'Size', options: [{ name: '100g', price: 60, image: 's.jpg' }, { name: '500g', price: 250 }] } },
  { id: 'p8', name: 'Turmeric', price: 70 },
  { id: 'p9', name: 'Hing', price: 55 },
];

test('suggestions: in stock, priced, not in this order, best sellers first, at most 4', () => {
  const got = suggestProducts({ products: PRODUCTS }, [{ productId: 'p1', name: 'Amti Premix', qty: 1 }],
    sales({ 'Malvani Masala': 120, Hing: 30, Turmeric: 30 }), { now: NOW });
  assert.deepEqual(got.map((p) => p.id), ['p3', 'p8', 'p9', 'p2'], 'sold desc, ties keep catalogue order');
  for (const p of got) assert.ok(!['p1', 'p4', 'p5', 'p6'].includes(p.id));
  assert.equal(got[0].sold, 120);
  const all = suggestProducts({ products: PRODUCTS }, [], sales({}), { now: NOW, max: 99 }).map((p) => p.id);
  assert.deepEqual(all, ['p1', 'p2', 'p3', 'p7', 'p8', 'p9'], 'out of stock (p4 switched off, p5 at 0) and unpriced (p6) never shown');
  // Matched by name too (old orders may carry no productId).
  assert.ok(!suggestProducts({ products: PRODUCTS }, [{ name: 'goda masala ' }], sales({}), { now: NOW }).some((p) => p.id === 'p2'));
  assert.deepEqual(suggestProducts({}, [], sales({}), { now: NOW }), []);
});

test('suggestions: a product with choices shows its first option and opens its page', () => {
  const got = suggestProducts({ products: PRODUCTS }, [], sales({ Sizes: 999 }), { now: NOW });
  assert.deepEqual(got[0], { id: 'p7', name: 'Sizes', price: 60, mrp: null, image: 's.jpg', sold: 999, hasOptions: true });
  assert.equal(got.find((p) => p.id === 'p2').hasOptions, false);
});

test('suggestions: today\'s sale price, with the old price struck', () => {
  const offers = [{ id: 's', name: 'Sale', active: true, discountType: 'percent', discountValue: 10, appliesTo: 'all', schedule: { type: 'always' } }];
  const got = suggestProducts({ products: [{ id: 'p2', name: 'Goda Masala', price: 380 }], offers }, [], sales({}), { now: NOW });
  assert.equal(got[0].price, 342);
  assert.equal(got[0].mrp, 380);
});

// ── order again ─────────────────────────────────────────────────────────────

test('order again: the same lines in the shape the cart restore expects', () => {
  assert.deepEqual(reorderLines([
    { productId: 'p1', name: 'Amti', qty: 2, price: 270 },
    { productId: 'p7', name: 'Sizes', qty: '1', variant: '500g' },
    { name: 'no id', qty: 1 },
    { productId: 'p3', qty: 0 },
  ]), [
    { productId: 'p1', qty: 2 },
    { productId: 'p7', qty: 1, variant: '500g' },
    { productId: 'p3', qty: 1 },
  ]);
  assert.deepEqual(reorderLines(null), []);
  // Orders saved before items carried a productId: matched by exact name, else skipped.
  assert.deepEqual(reorderLines([{ name: " goda masala", qty: 2 }, { name: "Gone product", qty: 1 }], PRODUCTS),
    [{ productId: "p2", qty: 2 }]);
});

// ── wiring ──────────────────────────────────────────────────────────────────

test('the tracking page: tracking first, then the offer and products; Order again refills the cart', () => {
  const page = read('src/pages/OrderTracking.jsx');
  const ready = page.slice(page.indexOf('// ── Ready'));
  const at = (s) => { const i = ready.indexOf(s); assert.ok(i > -1, s); return i; };
  assert.ok(at('Progress') < at('<ShopOffer') && at('Your order') < at('<ShopOffer'), 'selling comes after the tracking');
  assert.ok(at('<ShopOffer') < at('<MoreFromShop'));
  assert.match(ready, /\{!cancelled && extras\?\.offer && store\.slug && \(/, 'never on a cancelled order');
  assert.match(page, /pickShopOffer\(cfg\)/);
  assert.match(page, /suggestProducts\(cfg, orderItems, sales\)/);
  // Order again and + Add go through the cart restore, like the cart-reminder link.
  assert.match(page, /reorder: reorderLines\(orderItems, cfg\.products\)/, 'older orders matched by name');
  assert.match(page, /saveRestoreIntent\(shopSlug, reorder\);\s*go\(storePath\(shopSlug\)\);/);
  assert.match(page, /if \(p\.hasOptions\) \{ go\(storePath\(shopSlug, \{ productId: p\.id \}\)\); return; \}/);
  assert.match(page, /saveRestoreIntent\(shopSlug, \[\{ productId: p\.id, qty: 1 \}\]\);/);
  assert.ok(!/<Package size=\{15\} \/> Order again/.test(page), 'the old Order again that only opened the shop is gone');
  // The extras load after the order and can never break it.
  assert.match(page, /fetchStore\(shopSlug\)\.catch\(\(\) => null\)/);
});

test('the Confirm link gets its own "Thank you" moment; the Track link (read-only) does not', () => {
  const page = read('src/pages/OrderTracking.jsx');
  // Only the /confirm route sets it, from what the confirm RPC answered.
  assert.match(page, /if \(isConfirmRoute\) \{\s*try \{\s*const \{ data: c \} = await supabase\.rpc\('confirm_order_by_token'/);
  assert.match(page, /if \(c\?\.ok\) confirmed = c\.already \? 'already' : 'now';/);
  assert.match(page, /setJustConfirmed\(confirmed\);/);
  assert.equal((page.match(/setJustConfirmed\(/g) || []).length, 2, '/confirm on arrival, and the on-page Confirm button');
  assert.match(page, /\{justConfirmed && !cancelled && \(/);
  assert.match(page, /Thank you! Your order is confirmed\./);
  const ready = page.slice(page.indexOf('// ── Ready'));
  assert.ok(ready.indexOf('Thank you! Your order is confirmed.') < ready.indexOf('{/* Status hero */}'), 'at the top');
});

test('Offers tab: a coupon is shown on order pages only when the shop ticks it', () => {
  const tab = read('src/components/manage/OffersTab.jsx');
  assert.match(tab, /showOnOrderPage: false,/, 'off for new coupons');
  assert.match(tab, /showOnOrderPage: couponForm\.showOnOrderPage === true,/, 'saved as a real boolean');
  assert.match(tab, /Show on customers’ order pages/);
});
