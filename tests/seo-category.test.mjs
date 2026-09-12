// Link previews for category links — /{slug}/c/{categoryId}.
//
// A category link exists to be pasted into WhatsApp, an Instagram bio, or under
// a printed QR on a shelf. If it previews as the generic shop card, or worse as
// nothing at all, it reads as a stray link and nobody taps it. Before this,
// api/render.js only handled single-segment paths, so every deeper link fell
// through to the bare SPA shell with no preview.
import test from 'node:test';
import assert from 'node:assert/strict';
import { storeSeo } from '../api/_seo.js';

const ORIGIN = 'https://www.pocketlink.store';
const SLUG = 'royalfoodsmasale';

const CFG = {
  businessName: 'Royal Foods & Spices',
  city: 'Solapur',
  category: 'Grocery',
  coverImage: 'https://img.example/cover.jpg',
  categories: [
    { id: 'all', label: 'All Products', emoji: '🛒' },
    { id: 'masala', label: 'Masalas', emoji: '🌶️' },
    { id: 'combos', label: 'Combos', emoji: '🎁' },
  ],
  products: [
    { name: 'Chicken Masala', category: 'masala', image: 'https://img.example/chicken.jpg' },
    { name: 'Royal Misal Masala', category: 'masala' },
    { name: 'Sunday Combo', category: 'combos', image: 'https://img.example/combo.jpg' },
  ],
};
const MASALA = CFG.categories[1];
const seo = (section) => storeSeo(CFG, SLUG, ORIGIN, null, section);

test('a category link previews as the category, not the whole shop', () => {
  assert.match(seo(MASALA).title, /^Masalas — Royal Foods & Spices/);
  assert.match(seo(null).title, /^Royal Foods & Spices/);
});

test('the description describes THAT category, not the full catalogue', () => {
  const d = seo(MASALA).description;
  assert.ok(d.includes('Chicken Masala'), d);
  assert.ok(d.includes('Royal Misal Masala'), d);
  assert.ok(!d.includes('Sunday Combo'), 'a combo must not appear under Masalas');
});

test('the preview image comes from inside the category', () => {
  // Showing the shop cover would misrepresent what the link opens.
  assert.equal(seo(MASALA).image, 'https://img.example/chicken.jpg');
});

test('a category with no product photo falls back to the shop cover', () => {
  const empty = { id: 'combos2', label: 'Gift Boxes' };
  assert.equal(seo(empty).image, 'https://img.example/cover.jpg');
});

test('the canonical url points at the category link itself', () => {
  assert.equal(seo(MASALA).url, `${ORIGIN}/${SLUG}/c/masala`);
  assert.equal(seo(null).url, `${ORIGIN}/${SLUG}`);
});

test('no section behaves exactly as before', () => {
  // The shop preview must be untouched by this feature.
  const before = storeSeo(CFG, SLUG, ORIGIN, null);
  const explicitNull = storeSeo(CFG, SLUG, ORIGIN, null, null);
  assert.deepEqual(before, explicitNull);
});

// ── Product links ────────────────────────────────────────────────────────────
// A seller sends one item to a customer far more often than they send a whole
// shop, and until now those links previewed as the shop — the customer saw a
// generic card instead of the thing being sold.
const CHICKEN = CFG.products[0];
const withPrice = { ...CHICKEN, id: 'p1', price: 270, description: 'Ready in 10 minutes.' };
const seoItem = (p) => storeSeo(CFG, SLUG, ORIGIN, null, null, p);

test('a product link previews as the product', () => {
  assert.match(seoItem(withPrice).title, /^Chicken Masala — Royal Foods & Spices/);
});

test('the description reads like a price tag, not a shop blurb', () => {
  const d = seoItem(withPrice).description;
  assert.ok(d.includes('₹270'), d);
  assert.ok(d.includes('Ready in 10 minutes.'), d);
  // The rest of the catalogue is noise when the reader is looking at one item.
  assert.ok(!d.includes('Sunday Combo'), d);
});

test('a product with no description still says who sells it', () => {
  const bare = { ...CHICKEN, id: 'p1', price: 270, description: '' };
  assert.ok(seoItem(bare).description.includes('Royal Foods & Spices'));
});

test('the preview image is the product photo', () => {
  assert.equal(seoItem(withPrice).image, 'https://img.example/chicken.jpg');
});

test('a product with no photo falls back to the shop cover', () => {
  const noPic = { id: 'p2', name: 'Royal Misal Masala', price: 270 };
  assert.equal(seoItem(noPic).image, 'https://img.example/cover.jpg');
});

test('the canonical url points at the product link', () => {
  assert.equal(seoItem(withPrice).url, `${ORIGIN}/${SLUG}/p/p1`);
});

test('structured data describes the one product, not the catalogue', () => {
  const products = seoItem(withPrice).ld['@graph'].filter((n) => n['@type'] === 'Product');
  assert.equal(products.length, 1);
  assert.equal(products[0].name, 'Chicken Masala');
  assert.equal(products[0].offers.price, '270');
});

test('the breadcrumb trail matches the URL shape', () => {
  const crumbs = (s) => s.ld['@graph'].find((n) => n['@type'] === 'BreadcrumbList').itemListElement;
  assert.equal(crumbs(seoItem(withPrice)).at(-1).name, 'Chicken Masala');
  assert.equal(crumbs(seo(MASALA)).at(-1).name, 'Masalas');
  assert.equal(crumbs(seo(null)).length, 2, 'the shop page has no third crumb');
});
