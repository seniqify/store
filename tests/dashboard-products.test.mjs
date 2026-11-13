// Products (Manage → Products), redesigned 2026-11-13 to the approved prototype:
// a photo grid at full width with search + Add product on top, category tabs with
// counts, and per card: discount badge, Sold out overlay, price and MRP, stock and
// units sold, the in-stock switch, edit and delete. Every old action is kept.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const MANAGE = read('src/pages/ManageStore.jsx');
const PRODUCTS = MANAGE.slice(MANAGE.indexOf('function ManageProducts('), MANAGE.indexOf('// ── Categories Tab'));

test('a photo grid at full width, categories below with a link to them', () => {
  assert.match(PRODUCTS, /grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4/);
  assert.match(MANAGE, /const WIDE_TABS = new Set\(\['home', 'orders', 'products'\]\);/);
  assert.match(MANAGE, /\) : tab === 'products' \? \(/);
  assert.match(MANAGE, /<div id="manage-categories"/);
  assert.match(PRODUCTS, /getElementById\('manage-categories'\)/);
  assert.match(PRODUCTS, /role="tablist" aria-label="Categories"/);
});

test('every old product action is still on the card', () => {
  for (const call of ['openEdit(p)', 'toggleStock(p.id)', 'removeProduct(p.id)', "moveProduct(p.id, 'up')", "moveProduct(p.id, 'down')", 'openAdd']) {
    assert.ok(PRODUCTS.includes(call), call);
  }
  // Reordering still only on the full, unfiltered list.
  assert.match(PRODUCTS, /const canReorder = !query && catFilter === 'all';/);
  assert.match(PRODUCTS, /\{canReorder && products\.length > 1 && \(/);
});

test('stock reads the same two sources as before, and sold counts are real sales', () => {
  assert.match(PRODUCTS, /const out = p\.inStock === false \|\| \(tracked && left <= 0\);/);
  assert.match(PRODUCTS, /const low = !out && tracked && left <= LOW_STOCK;/);
  assert.match(PRODUCTS, /fetchProductSales\(config\.slug\)/);
  assert.match(PRODUCTS, /const sold = sales\?\.get\(p\.name\)\?\.sold \|\| 0;/);
  // The discount badge only when MRP is really higher than the price.
  assert.match(PRODUCTS, /Number\(p\.mrp\) > Number\(p\.price\) && Number\(p\.price\) > 0/);
});

test('Save changes stays in view at the bottom while editing a long grid', () => {
  assert.match(PRODUCTS, /\{\(dirty \|\| saveStatus === 'saved'\) && \(\n\s*<div className="sticky bottom-24 lg:bottom-4/);
  assert.match(PRODUCTS, /<SaveBar/);
});
