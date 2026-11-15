// "Buy X Get Y free" sales (founder, 2026-11-15; mockup N75987NB2c5KjCE6aPmf5y).
// Free units become their own ₹0 lines, so the totals, "you save", GST, stock
// and per-product revenue all stay right without knowing the rule.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buyXGetY, calcCartTotals } from '../shared/pricing.mjs';
import { applyCartOffers, applyOffersToProducts, describeDiscount, bestOfferForProduct } from '../src/utils/offers.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const P = [
  { id: 1, name: 'Misal', price: 270, category: 'rm' },
  { id: 2, name: 'Chicken', price: 270, category: 'rm' },
  { id: 3, name: 'Sherwa', price: 240, category: 'rm' },
  { id: 4, name: 'Hamper', price: 599, category: 'gift', stock: 5 },
];
const sale = (over = {}) => ({ id: 's', name: 'BOGO', active: true, discountType: 'bxgy', buy: 1, get: 1, freeMode: 'same', appliesTo: 'products', productIds: ['1', '2'], schedule: { type: 'always' }, ...over });
const line = (id, qty, extra = {}) => ({ ...P.find((p) => p.id === id), qty, ...extra });
const view = (r) => r.lines.map((l) => [l.name, l.qty, l.price, Boolean(l.free)]);

test('the same product: every second one is free, and one alone gets the nudge', () => {
  const one = buyXGetY([line(1, 1)], [sale()], P);
  assert.deepEqual(view(one), [['Misal', 1, 270, false]]);
  assert.deepEqual(one.nudge, { kind: 'same', add: 1, lineId: 1, name: 'Misal', offerName: 'BOGO' });
  const two = buyXGetY([line(1, 2)], [sale()], P);
  assert.deepEqual(view(two), [['Misal', 1, 270, false], ['Misal', 1, 0, true]]);
  assert.equal(two.saving, 270);
  assert.equal(two.nudge, null);
  assert.deepEqual(two.freeByLine, { 1: 1 });
  const free = two.lines.find((l) => l.free);
  assert.equal(free.mrp, 270, 'the free line remembers what it would have cost');
  assert.equal(free.unitPrice, 270);
  // With an MRP, the free pack's saving counts against it, like every other line.
  const withMrp = buyXGetY([{ ...line(1, 2), mrp: 540 }], [sale()], P);
  assert.equal(withMrp.lines.find((l) => l.free).mrp, 540);
  assert.equal(calcCartTotals(withMrp.lines, {}).savings, 270 + 540);
  const three = buyXGetY([line(1, 3)], [sale()], P);
  assert.deepEqual(view(three), [['Misal', 2, 270, false], ['Misal', 1, 0, true]]);
  assert.equal(three.nudge.add, 1, 'three: one more makes a second free one');
  // Buy 2 get 1.
  const b2 = buyXGetY([line(1, 3)], [sale({ buy: 2 })], P);
  assert.deepEqual(view(b2), [['Misal', 2, 270, false], ['Misal', 1, 0, true]]);
});

test('products not in the sale are untouched; sizes count on their own line', () => {
  const r = buyXGetY([line(3, 2), { ...line(1, 2), id: '1::Large', price: 300 }], [sale()], P);
  assert.deepEqual(view(r), [['Sherwa', 2, 240, false], ['Misal', 1, 300, false], ['Misal', 1, 0, true]]);
});

test('a whole category: customers mix, and the cheapest units are free', () => {
  const mix = sale({ appliesTo: 'category', categoryId: 'rm', productIds: [] });
  const r = buyXGetY([line(1, 1), line(3, 1)], [mix], P);
  assert.deepEqual(view(r), [['Misal', 1, 270, false], ['Sherwa', 1, 0, true]]);
  assert.equal(r.saving, 240);
  const odd = buyXGetY([line(1, 2), line(3, 1)], [mix], P);
  assert.equal(odd.saving, 240, 'of three, one pair: the cheapest of all three is free');
  assert.equal(odd.nudge.kind, 'mix');
});

test('a different product: the gift is added at ₹0, capped at its stock, never if sold out', () => {
  const gift = sale({ freeMode: 'other', triggerId: '4', giftId: '2', productIds: [] });
  const r = buyXGetY([line(4, 2)], [gift], P);
  assert.deepEqual(view(r), [['Hamper', 2, 599, false], ['Chicken', 2, 0, true]]);
  assert.equal(r.gifts[0].gift, true);
  assert.equal(r.saving, 540);
  const capped = buyXGetY([line(4, 3)], [gift], P.map((p) => (p.id === 2 ? { ...p, stock: 1 } : p)));
  assert.equal(capped.gifts[0].qty, 1);
  const soldOut = buyXGetY([line(4, 1)], [gift], P.map((p) => (p.id === 2 ? { ...p, inStock: false } : p)));
  assert.equal(soldOut.gifts.length, 0);
  const buy2 = buyXGetY([line(4, 1)], [sale({ freeMode: 'other', triggerId: '4', giftId: '2', buy: 2 })], P);
  assert.equal(buy2.nudge.kind, 'gift');
  assert.equal(buy2.nudge.add, 1);
});

test('one sale per line, and nothing for a ₹0 line or no sale', () => {
  const r = buyXGetY([line(1, 2)], [sale(), sale({ id: 't', name: 'Second' })], P);
  assert.equal(r.lines.filter((l) => l.free).length, 1);
  assert.equal(r.lines.find((l) => l.free).offerName, 'BOGO');
  assert.deepEqual(buyXGetY([line(1, 2)], [], P).lines, [line(1, 2)]);
});

test('the totals: free units cost nothing, and they show in "you save"', () => {
  const r = buyXGetY([line(1, 2)], [sale()], P);
  const t = calcCartTotals(r.lines, { shippingCharge: 40 });
  assert.equal(t.subtotal, 270);
  assert.equal(t.savings, 270);
  assert.equal(t.total, 310);
  const gst = calcCartTotals(r.lines, { taxRate: 0.05 });
  assert.equal(gst.tax, Math.round(270 * 0.05), 'no GST on the free unit');
});

test('the shop: a running sale labels products and never changes a price; % sales still work', () => {
  const pct = { id: 'p', name: 'Diwali', active: true, discountType: 'percent', discountValue: 10, appliesTo: 'all' };
  const out = applyOffersToProducts(P, [sale(), pct]);
  assert.equal(out[0].price, 243, '10% still applies');
  assert.equal(out[0]._bxgy.label, 'BUY 1 GET 1');
  assert.equal(out[0]._bxgy.text, 'Add 2, pay for 1');
  assert.equal(out[2]._bxgy, undefined);
  assert.equal(bestOfferForProduct(P[0], [sale()]), null, 'never a price');
  const off = applyOffersToProducts(P, [sale({ active: false })]);
  assert.equal(off[0]._bxgy, undefined, 'a switched-off sale shows nothing');
  const gift = applyOffersToProducts(P, [sale({ freeMode: 'other', triggerId: '4', giftId: '2' })]);
  assert.deepEqual(gift[3]._bxgy, { label: 'FREE GIFT', text: '+ Chicken free' });
  assert.equal(describeDiscount(sale()), 'Buy 1 Get 1');
  assert.equal(describeDiscount(sale({ freeMode: 'other' })), 'Buy 1, get 1 free');
  assert.equal(applyCartOffers([line(1, 2)], [sale({ schedule: { type: 'range', start: '2020-01-01', end: '2020-01-02' } })], P).saving, 0, 'not running: no free units');
});

test('the shop page uses the priced cart for totals, checkout and the order; the drawer keeps the customer’s lines', () => {
  const home = read('src/pages/Home.jsx');
  assert.match(home, /const deal       = applyCartOffers\(cart, offers, saleProducts\);/);
  assert.match(home, /calcCartTotals\(pricedCart, config\.cart\)/);
  assert.match(home, /<CustomerDetailsForm [^>]*cart=\{pricedCart\}/);
  assert.match(home, /<CartSidebar\n\s+cart=\{cart\}\n\s+deal=\{deal\}/);
  const side = read('src/components/cart/CartSidebar.jsx');
  assert.match(side, /cart=\{deal \? deal\.lines : cart\}/);
  assert.match(side, /free=\{deal\?\.freeByLine\?\.\[item\.id\] \|\| 0\}/);
  assert.match(read('src/components/cart/CartItem.jsx'), /const unitSubtotal = item\.price \* \(item\.qty - free\);/);
});

test('the saved order, WhatsApp, the order card and the slip all say free', () => {
  const svc = read('src/utils/orderService.js');
  assert.equal((svc.match(/\.\.\.\(i\.free \? \{ free: true, offer: i\.offerName \|\| null \} : \{\}\)/g) || []).length, 2);
  assert.match(read('src/utils/generateWhatsAppMessage.js'), /x\$\{item\.qty\} FREE 🎁/);
  assert.match(read('src/utils/deliverySlip.js'), /it\.free \? 'FREE' : esc\(formatINR\(rate \* qty\)\)/);
  const orders = read('src/components/manage/OrdersTab.jsx');
  assert.equal((orders.match(/it\.free \? <b className="text-orange-700">FREE<\/b>/g) || []).length, 2);
});

test('Offers: "Buy & get free" is a third kind of sale, saved with its own fields', () => {
  const tab = read('src/components/manage/OffersTab.jsx');
  assert.match(tab, /\{ value: 'bxgy', label: 'Buy & get free' \}/);
  assert.match(tab, /discountType: 'bxgy',\n\s+discountValue: 0,\n\s+buy: Number\(saleForm\.buy\) \|\| 1,/);
  assert.match(tab, /function saleWhere\(/);
  assert.match(tab, /function Stepper\(/);
});
