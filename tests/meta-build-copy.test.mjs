// The shared campaign builder with merchant-approved words and a merchant-picked
// photo. Graph is stubbed at globalThis.fetch (read-only calls only).
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCampaign } from '../api/meta/_campaignBuild.js';

const realFetch = globalThis.fetch;
test.afterEach(() => { globalThis.fetch = realFetch; });

const CFG = {
  businessName: 'Royal Foods', city: 'Solapur', state: 'Maharashtra', tagline: 'Authentic masala',
  coverImage: 'https://cdn.example/cover.jpg',
  meta: { pageId: '111222333', pageName: 'Royal Foods & Masale' },
  products: [
    { id: 'p1', name: 'Bajar Amti 90 g Per Packet', price: '270', unit: '90g', image: 'https://cdn.example/amti.jpg', images: ['https://cdn.example/amti-back.jpg'],
      variants: { options: [{ name: '3 x Packet', price: 270, mrp: 330 }] } },
  ],
};

async function build(input = {}) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    calls.push({ url: u, method: (init.method || 'GET').toUpperCase() });
    const body = u.includes('/search?') ? { data: [{ key: '1010461', name: 'Solapur', region: 'Maharashtra' }] }
      : u.includes('111222333') ? { id: '111222333', name: 'Royal Foods & Masale' }
      : u.includes('act_') ? { currency: 'INR', name: 'Royal Foods', min_daily_budget: 9615, account_status: 1, timezone_name: 'Asia/Kolkata' }
      : { data: [] };
    return { ok: true, status: 200, json: async () => body };
  };
  const out = await buildCampaign({ slug: 'royalfoodsmasale', adId: 'act_1896623077683652', token: 'TEST', cfg: CFG },
    { objective: 'traffic', days: 7, dailyBudget: 200, promote: 'product', productId: 'p1', audienceStrategy: 'auto', ...input });
  return { out, calls };
}
const linkData = (out) => out.payloads.adcreative.body.object_story_spec.link_data;

test('approved words replace the default text, never the link', async () => {
  const { out, calls } = await build({ copy: { headline: 'Real Solapur Bajar Amti', primaryText: 'Pack of 3 for ₹270, ground in small batches.', description: 'Save 18% today', cta: 'ORDER_NOW' } });
  const ld = linkData(out);
  assert.equal(ld.name, 'Real Solapur Bajar Amti');
  assert.equal(ld.message, 'Pack of 3 for ₹270, ground in small batches.');
  assert.equal(ld.description, 'Save 18% today');
  assert.equal(ld.call_to_action.type, 'ORDER_NOW');
  assert.equal(ld.link, 'https://www.pocketlink.store/royalfoodsmasale/p/p1', 'the link is still the store\'s product page');
  assert.equal(out.creative.copySource, 'merchant');
  assert.equal(calls.some((c) => c.method === 'POST'), false, 'building never writes to Meta');
});

test('words with an invented price fall back to the product details, with a warning', async () => {
  const { out } = await build({ copy: { headline: 'Masala for ₹99', primaryText: 'Cheapest masala in town, order now.', description: '' } });
  assert.notEqual(linkData(out).name, 'Masala for ₹99');
  assert.equal(out.creative.copySource, 'store');
  assert.ok(out.warnings.some((w) => /could not be used as written/.test(w)));
});

test('without words the creative is exactly as before', async () => {
  const { out } = await build();
  assert.equal(linkData(out).description, 'Authentic masala');
  assert.equal(linkData(out).call_to_action.type, 'SHOP_NOW');
  assert.equal(out.creative.copySource, 'store');
});

test('a photo can be any of the store\'s own images, and nothing else', async () => {
  let { out } = await build({ imageUrl: 'https://cdn.example/amti-back.jpg' });
  assert.equal(linkData(out).picture, 'https://cdn.example/amti-back.jpg');
  ({ out } = await build({ imageUrl: 'https://cdn.example/cover.jpg' }));
  assert.equal(linkData(out).picture, 'https://cdn.example/cover.jpg');
  ({ out } = await build({ imageUrl: 'https://evil.example/other.jpg' }));
  assert.equal(linkData(out).picture, 'https://cdn.example/amti.jpg');
  assert.ok(out.warnings.some((w) => /not one of your store images/.test(w)));
});
