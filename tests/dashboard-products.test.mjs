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
  assert.match(MANAGE, /const WIDE_TABS = new Set\(\[[^\]]*'products'/);
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

test('Delivery on a computer: the work on the left, couriers and customer updates on the right', () => {
  assert.match(MANAGE, /const WIDE_TABS = new Set\(\[[^\]]*'delivery'/);
  assert.match(MANAGE, /\) : tab === 'delivery' \? \(/);
  assert.match(MANAGE, /wide=\{isDesktop\}\n\s*\/>\n\s*<\/div>\n\s*\) : tab === 'products'/);
  // The couriers card is a summary; connecting stays in Settings, the one place.
  assert.match(MANAGE, /function CouriersSummary\(/);
  assert.match(MANAGE, /onSettings=\{\(\) => setView\('settings'\)\}/);
  assert.match(MANAGE, /<ShipUpdates slug=\{slug\}/);
  // Ship keeps full order cards (each with Book courier): the column is too narrow for list + detail.
  assert.match(MANAGE, /mode="ship"[\s\S]{0,260}store=\{orderStore\} rto=\{rto\} \/>/);
});

test('the product editor is the approved mockup: a page on a computer, rows on a phone', () => {
  // Computer: a full page with the product in the middle and the rest on the side.
  assert.match(PRODUCTS, /if \(!isDesk\) \{/);
  assert.match(PRODUCTS, /grid grid-cols-\[minmax\(0,1fr\)_340px\] gap-5 items-start/);
  for (const t of ['>Status<', '>Organise<', '>Unit &amp; GST<', '>How buyers see it<', '>Delivery<']) assert.ok(PRODUCTS.includes(t), t);
  // Phone: short rows, each opening its own page, and a sticky Save.
  for (const k of ["['desc',", "['sizes',", "['org',", "['cost',", "['weight',", "['tax',"]) assert.ok(PRODUCTS.includes(k), k);
  assert.match(PRODUCTS, /onClick=\{\(\) => setSub\(k\)\}/);
  assert.match(PRODUCTS, /\{sub \? 'Done' : saveLabel\}/);
  assert.ok(!/animate-pl-slide-in-right|items-end lg:items-center/.test(PRODUCTS), 'no drawer, no pop-up any more');
});

test('the save bar appears only when something changed; leaving asks first', () => {
  assert.match(PRODUCTS, /const dirty_ = drawerOpen && baseline !== null && JSON\.stringify\(form\) !== JSON\.stringify\(baseline\);/);
  assert.match(PRODUCTS, /function tryClose\(\) \{ if \(dirty_\) setCloseAsk\(true\); else resetForm\(\); \}/);
  assert.match(PRODUCTS, /setForm\(next\);\n\s*setBaseline\(next\);/, 'opening a product remembers how it was');
  assert.match(PRODUCTS, /\{dirty_ \? \(closeAsk \? 'Save your changes first\?' : 'Unsaved changes'\)/);
  // Discard puts it back (or leaves, when asked on the way out).
  assert.match(PRODUCTS, /if \(closeAsk\) \{ resetForm\(\); return; \}\n\s*setForm\(baseline \|\| EMPTY_PROD\);/);
});

test('every option is still in the editor, with stock, availability, weight, label and food type', () => {
  // Stock: a switch, and a counter with +10 / +25 only when it is on.
  assert.match(PRODUCTS, /setForm\(p => \(\{ \.\.\.p, stock: tracked \? '' : 0 \}\)\)/);
  assert.match(PRODUCTS, /\[10, 25\]\.map\(k =>/);
  assert.equal((PRODUCTS.match(/aria-label="Stock"/g) || []).length, 1, 'one stock box');
  assert.match(PRODUCTS, /inStock: form\.inStock !== false,/);
  assert.match(PRODUCTS, /inStock:     product\.inStock !== false,/);
  // Label on the photo (product.badge, already shown by the shop page) and food type.
  assert.match(PRODUCTS, /badge: form\.badge\?\.trim\(\) \|\| null,/);
  assert.match(PRODUCTS, /badge:       form\.badge\?\.trim\(\) \|\| null,/);
  assert.equal((PRODUCTS.match(/foodType: +form\.foodType \|\| undefined,/g) || []).length, 2, 'saved on edit and on add');
  // The rest, unchanged: AI fill, gallery, variants + more option types, unit / GST, details, preview.
  for (const piece of ['autoFill', 'onAddMany=', 'title="Variants"', 'title="More option types"', "'Rate type' : 'Sold by'", 'form.attributes.map((a, i)', '<ProductCard product={previewProduct} />']) {
    assert.ok(PRODUCTS.includes(piece), piece);
  }
  // Delete asks once more; Make a copy starts a new product from this one.
  assert.match(PRODUCTS, /onClick=\{\(\) => setConfirmDelete\(true\)\}/);
  assert.match(PRODUCTS, /onClick=\{\(\) => removeProduct\(editingId, true\)\}/);
  assert.match(PRODUCTS, /function copyProduct\(\) \{\n\s*setEditingId\(null\);/);
});

test('the shop page shows the food mark next to the name and in the product page', () => {
  const card = read('src/components/product/ProductCard.jsx');
  const detail = read('src/components/product/ProductDetail.jsx');
  assert.match(card, /\{product\.foodType && <FoodMark type=\{product\.foodType\} className="mr-1\.5" \/>\}/);
  assert.match(detail, /<FoodMark type=\{product\.foodType\} \/>/);
});

test('Save and Delete in the pop-up save the page straight away; card switches still use Save changes', () => {
  assert.match(MANAGE, /function handleSave\(\) \{ return persist\(config\); \}/);
  assert.match(MANAGE, /function saveWith\(partial\) \{\n\s*setConfig\(\(prev\) => \(\{ \.\.\.prev, \.\.\.partial \}\)\);\n\s*return persist\(\{ \.\.\.config, \.\.\.partial \}\);/);
  // Images added in the pop-up are still uploaded before saving.
  assert.match(MANAGE, /uploadConfigImages\(source\.products, businessSlug\)/);
  assert.match(PRODUCTS, /if \(onSaveWith\) \{ onSaveWith\(\{ products: newProducts \}\); setDirty\(false\); \}/);
  assert.match(PRODUCTS, /if \(now && onSaveWith\) \{ onSaveWith\(\{ products: next \}\); setDirty\(false\); \}/);
  assert.match(MANAGE, /onSaveWith=\{saveWith\}/);
  // The in-stock switch and reordering on the cards keep the Save changes bar.
  const toggle = PRODUCTS.slice(PRODUCTS.indexOf('function toggleStock'), PRODUCTS.indexOf('function handleSave'));
  assert.match(toggle, /setDirty\(true\)/);
});
