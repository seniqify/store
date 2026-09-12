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
