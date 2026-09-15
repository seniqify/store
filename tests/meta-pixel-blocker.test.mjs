// Plan builder: an orders goal is blocked, in plain words, when the ad account
// cannot use the store's pixel — otherwise Meta rejects the ad set only after the
// campaign already exists. Network is stubbed; no Meta call; nothing is created.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCampaign } from '../api/meta/_campaignBuild.js';

const realFetch = globalThis.fetch;
test.afterEach(() => { globalThis.fetch = realFetch; });

function stubFetch(routes) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: (init.method || 'GET').toUpperCase() });
    for (const [match, body] of routes) {
      if (String(url).includes(match)) return { ok: true, status: 200, json: async () => body };
    }
    return { ok: true, status: 200, json: async () => ({ data: [] }) };
  };
  return calls;
}

const PIXEL = '1813709013140947';
const CFG = {
  businessName: 'Protine Hub', city: 'Solapur', state: 'Maharashtra', tagline: 'Order online',
  meta: { pageId: '1124874604040958', pageName: 'PocketLink', pixelId: PIXEL },
  products: [{ id: 'p1', name: 'Fule one', price: 1499, unit: 'per piece', image: 'https://cdn.example/fule.jpg' }],
};
const INPUT = { objective: 'sales', days: 1, dailyBudget: 95, promote: 'product', productId: 'p1', audienceStrategy: 'auto' };
const PIXEL_BLOCKER = /pixel isn’t connected to this ad account/;

// pixels: what Meta answers for the ad account's pixel list.
async function build(pixels, input = INPUT) {
  const calls = stubFetch([
    ['/adspixels', pixels],
    ['/search?', { data: [{ key: '1010461', name: 'Solapur', region: 'Maharashtra' }] }],
    ['1124874604040958', { id: '1124874604040958', name: 'PocketLink' }],
    ['act_', { currency: 'INR', name: 'PocketLink', min_daily_budget: 9491, account_status: 1, timezone_name: 'Asia/Kolkata' }],
  ]);
  const out = await buildCampaign({ slug: 'showme', adId: 'act_962613363265198', token: 'TEST', cfg: CFG }, input);
  return { out, calls };
}

test('orders goal: blocked when the ad account cannot use the store pixel', async () => {
  const { out } = await build({ data: [] });
  assert.equal(out.launchReady, false);
  assert.ok(out.launchBlockers.some((b) => PIXEL_BLOCKER.test(b)), JSON.stringify(out.launchBlockers));
});

test('orders goal: not blocked when the ad account lists the store pixel', async () => {
  const { out } = await build({ data: [{ id: PIXEL }] });
  assert.equal(out.launchBlockers.some((b) => PIXEL_BLOCKER.test(b)), false);
  assert.deepEqual(out.payloads.adset.body.promoted_object, { pixel_id: PIXEL, custom_event_type: 'PURCHASE' });
});

test('orders goal: a pixel list Meta will not return never blocks — Meta decides at creation', async () => {
  const { out } = await build({ error: { code: 200, message: 'Permissions error' } });
  assert.equal(out.launchBlockers.some((b) => PIXEL_BLOCKER.test(b)), false);
});

test('orders goal: an incomplete pixel list (more pages) never blocks', async () => {
  const { out } = await build({ data: [{ id: '999' }], paging: { next: 'https://graph.facebook.com/next' } });
  assert.equal(out.launchBlockers.some((b) => PIXEL_BLOCKER.test(b)), false);
});

test('store visitors goal: pixels are never read', async () => {
  const { calls } = await build({ data: [] }, { ...INPUT, objective: 'traffic' });
  assert.equal(calls.some((c) => c.url.includes('/adspixels')), false);
});

test('the pixel check is a read: the plan still makes no writes', async () => {
  const { calls } = await build({ data: [] });
  assert.deepEqual(calls.filter((c) => c.method !== 'GET'), []);
});
