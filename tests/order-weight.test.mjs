// Courier booking takes the parcel weight from the products' packed weights
// (2026-11-13, founder: "the weight decides the pricing"). Couriers charge by
// weight, so a guessed 500 g on every parcel over- or under-charges.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { orderWeight, lineUnitWeight, weightBreakdown, DEFAULT_PARCEL_G } from '../src/utils/orderWeight.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

const PRODUCTS = [
  { id: 1, name: 'Kanda Lasun Masala', weight: 550 },
  { id: 2, name: 'Garam Masala', weight: 250, variants: { label: 'Size', options: [{ name: 'Small', weight: 120 }, { name: 'Big', weight: 1050 }, { name: 'No weight' }] } },
  { id: 3, name: 'Gift Box' },
];

test('every line weighed: exact sum, plus the box once', () => {
  const w = orderWeight([{ productId: 1, name: 'Kanda Lasun Masala', qty: 3 }, { productId: 2, name: 'Garam Masala', qty: 1 }], PRODUCTS, { boxG: 50 });
  assert.equal(w.grams, 3 * 550 + 250 + 50);
  assert.equal(w.weighed, true);
  assert.equal(w.partial, false);
  assert.equal(weightBreakdown(w), '3 × 550 g + 250 g + box 50 g');
});

test('a size has its own weight; without one it falls back to the product', () => {
  assert.equal(lineUnitWeight({ productId: 2, variant: 'Small' }, PRODUCTS), 120);
  assert.equal(lineUnitWeight({ productId: 2, size: 'Big' }, PRODUCTS), 1050);
  assert.equal(lineUnitWeight({ productId: 2, variant: 'No weight' }, PRODUCTS), 250);
  // Matched by name when an old order has no product id.
  assert.equal(lineUnitWeight({ name: 'Kanda Lasun Masala' }, PRODUCTS), 550);
  assert.equal(lineUnitWeight({ productId: 99, name: 'Gone' }, PRODUCTS), 0);
});

test('some lines unweighed: the known part plus the box, and the rest named', () => {
  const w = orderWeight([{ productId: 1, name: 'Kanda Lasun Masala', qty: 2 }, { productId: 3, name: 'Gift Box', qty: 1 }], PRODUCTS, { boxG: 40 });
  assert.equal(w.grams, 1100 + 40);
  assert.equal(w.partial, true);
  assert.deepEqual(w.missing, ['Gift Box']);
});

test('nothing weighed: the old 500 g default, so existing shops see no change', () => {
  const w = orderWeight([{ productId: 3, name: 'Gift Box', qty: 4 }], PRODUCTS, { boxG: 100 });
  assert.equal(w.grams, DEFAULT_PARCEL_G);
  assert.equal(DEFAULT_PARCEL_G, 500);
  assert.equal(w.weighed, false);
  assert.equal(orderWeight([], PRODUCTS).grams, 500);
  assert.equal(orderWeight(null, null).grams, 500);
});

test('bad numbers never count: zero, negative or text weights are "not weighed"', () => {
  const bad = [{ id: 1, name: 'A', weight: 0 }, { id: 2, name: 'B', weight: -5 }, { id: 3, name: 'C', weight: 'abc' }];
  const w = orderWeight([{ productId: 1, qty: 1 }, { productId: 2, qty: 1 }, { productId: 3, qty: 1 }], bad);
  assert.equal(w.grams, 500);
  assert.equal(orderWeight([{ productId: 1, name: 'Kanda Lasun Masala', qty: 'x' }], PRODUCTS).grams, 550, 'a bad qty counts as 1');
});

test('the booking starts from the products, shows the working, and stays editable', () => {
  const modal = read('src/components/manage/ShipBookModal.jsx');
  assert.match(modal, /const \[fromProducts\] = useState\(\(\) => orderWeight\(o\.items, products, \{ boxG \}\)\);/);
  assert.match(modal, /weight: {2}fromProducts\.grams,/);
  assert.match(modal, /From your products: \{weightBreakdown\(fromProducts\)\}/);
  assert.match(modal, /onChange=\{\(e\) => set\('weight'/, 'the seller can still change it');
  const tab = read('src/components/manage/OrdersTab.jsx');
  assert.equal((tab.match(/boxG=\{store\.boxWeightG\}/g) || []).length, 2, 'both booking buttons pass the weights');
  assert.match(tab, /couriers=\{couriers\} riders=\{riders\} riderHref=\{riderHref\} products=\{products\} boxG=\{boxG\}/);
  const manage = read('src/pages/ManageStore.jsx');
  assert.match(manage, /boxWeightG: config\.delivery\?\.boxWeightG,/);
});

test('the product editor saves a packed weight for the product and for each size', () => {
  const manage = read('src/pages/ManageStore.jsx');
  assert.match(manage, /id="product-weight"/);
  assert.match(manage, /const weight = form\.weight === '' \|\| form\.weight == null \|\| !\(Number\(form\.weight\) > 0\) \? undefined : Math\.round\(Number\(form\.weight\)\);/);
  assert.equal((manage.match(/^\s+weight,$/gm) || []).length, 2, 'saved on edit and on add');
  assert.match(manage, /weight: \(o\.weight === '' \|\| o\.weight == null \|\| !\(Number\(o\.weight\) > 0\)\) \? undefined : Math\.round\(Number\(o\.weight\)\),/);
  assert.match(manage, /aria-label="Packed weight in grams"/);
  assert.match(manage, /id="box-weight"/);
});
