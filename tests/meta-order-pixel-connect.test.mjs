// At connect, which pixel becomes the store's ads pixel, and when PocketLink may
// fill the storefront's own pixel field. Supabase and Graph are faked at
// globalThis.fetch — no network; nothing is written.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pixelForConnect, storefrontPixelIsPocketLinks } from '../api/meta/_orderTracking.js';

const realFetch = globalThis.fetch;
test.afterEach(() => { globalThis.fetch = realFetch; });

const ACCOUNT = 'act_962613363265198';
const OTHER = 'act_26443868945229654';
const STORE_PIXEL = '1813709013140947';

function world({ prior = null, config = {}, pixels = [] } = {}) {
  const log = { pixelReads: 0 };
  globalThis.fetch = async (url) => {
    const u = String(url);
    const reply = (b) => ({ ok: true, status: 200, json: async () => b });
    if (u.includes('/rest/v1/store_meta_accounts')) return reply(prior ? [prior] : []);
    if (u.includes('/rest/v1/stores')) return reply([{ config }]);
    if (u.includes(`/${ACCOUNT}/adspixels?`)) { log.pixelReads += 1; return reply({ data: pixels }); }
    return reply({ data: [] });
  };
  return log;
}

test('keeps the store\'s pixel when the ad account it advertises from can use it', async () => {
  world({
    prior: { selected_ad_account_id: ACCOUNT }, config: { meta: { pixelId: STORE_PIXEL } },
    pixels: [{ id: '9999999999', last_fired_time: '2026-09-15T00:00:00Z' }, { id: STORE_PIXEL, last_fired_time: '2026-09-01T00:00:00Z' }],
  });
  assert.equal(await pixelForConnect({ slug: 'showme', token: 'T', adAccountIds: [OTHER, ACCOUNT] }), STORE_PIXEL);
});

test('otherwise the ad account\'s most recently active pixel', async () => {
  world({
    prior: { selected_ad_account_id: ACCOUNT }, config: { meta: { pixelId: STORE_PIXEL } },
    pixels: [{ id: '1111111111', last_fired_time: '2026-09-01T00:00:00Z' }, { id: '2222222222', last_fired_time: '2026-09-14T00:00:00Z' }],
  });
  assert.equal(await pixelForConnect({ slug: 'showme', token: 'T', adAccountIds: [OTHER, ACCOUNT] }), '2222222222');
});

test('with several ad accounts and none chosen yet, no guess is made', async () => {
  const log = world({ prior: null, pixels: [{ id: '1111111111' }] });
  assert.equal(await pixelForConnect({ slug: 'showme', token: 'T', adAccountIds: [OTHER, ACCOUNT] }), null);
  assert.equal(log.pixelReads, 0);
});

test('an ad account with no pixel gives no pixel', async () => {
  world({ prior: { selected_ad_account_id: ACCOUNT }, pixels: [] });
  assert.equal(await pixelForConnect({ slug: 'showme', token: 'T', adAccountIds: [ACCOUNT] }), null);
});

test('the storefront pixel field is PocketLink\'s to set only when empty or holding PocketLink\'s pixel', () => {
  assert.equal(storefrontPixelIsPocketLinks({}), true);
  assert.equal(storefrontPixelIsPocketLinks({ metaPixelId: STORE_PIXEL, meta: { pixelId: STORE_PIXEL } }), true);
  assert.equal(storefrontPixelIsPocketLinks({ metaPixelId: '2459328801203274', meta: { pixelId: STORE_PIXEL } }), false);
  assert.equal(storefrontPixelIsPocketLinks({ metaPixelId: '2459328801203274' }), false);
});
