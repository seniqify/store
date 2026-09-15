// Order tracking helpers: which pixels an ad account can use, the status the Ads
// screen shows, and making the store's pixel one the ad account can use.
// Graph is faked at globalThis.fetch — no network; nothing is created in Meta.
import test from 'node:test';
import assert from 'node:assert/strict';
import { storePixelId, accountPixels, trackingStatus, ensureOrderPixel } from '../api/meta/_orderTracking.js';

const realFetch = globalThis.fetch;
test.afterEach(() => { globalThis.fetch = realFetch; });

const ACCOUNT = 'act_962613363265198';

// lists: successive answers for the ad account's pixel list; create: the answer to a create.
function graph({ lists = [{ data: [] }], create = { id: '5550001112223334' } } = {}) {
  const log = { reads: 0, creates: [] };
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    const reply = (b, status = 200) => ({ ok: status < 400, status, json: async () => b });
    if (u.includes(`/${ACCOUNT}/adspixels`) && (init.method || 'GET') === 'POST') {
      log.creates.push(JSON.parse(init.body));
      return create.error ? reply(create, 400) : reply(create);
    }
    if (u.includes(`/${ACCOUNT}/adspixels?`)) {
      const body = lists[Math.min(log.reads, lists.length - 1)];
      log.reads += 1;
      return reply(body, body.error ? 400 : 200);
    }
    return reply({});
  };
  return log;
}

const ensure = (config, pixelId) => ensureOrderPixel({ adAccount: ACCOUNT, token: 'TOKEN', config, pixelId });

test('storePixelId: the ads pixel first, then the storefront field, digits only', () => {
  assert.equal(storePixelId({ meta: { pixelId: '1813709013140947' }, metaPixelId: '2459328801203274' }), '1813709013140947');
  assert.equal(storePixelId({ metaPixelId: ' 2459328801203274 ' }), '2459328801203274');
  assert.equal(storePixelId({}), null);
});

test('accountPixels: most recently active first', async () => {
  graph({ lists: [{ data: [
    { id: '1111111111', name: 'Old', last_fired_time: '2026-09-01T00:00:00Z' },
    { id: '2222222222', name: 'New', last_fired_time: '2026-09-14T00:00:00Z' },
  ] }] });
  const r = await accountPixels(ACCOUNT, 'TOKEN');
  assert.deepEqual(r.pixels.map((p) => p.id), ['2222222222', '1111111111']);
});

test('accountPixels: a refusal or an incomplete list is unreadable; an expired token asks to reconnect', async () => {
  graph({ lists: [{ error: { code: 200, message: 'Permissions error' } }] });
  assert.deepEqual(await accountPixels(ACCOUNT, 'TOKEN'), { error: 'unreadable' });
  graph({ lists: [{ data: [{ id: '1111111111' }], paging: { next: 'https://graph.facebook.com/next' } }] });
  assert.deepEqual(await accountPixels(ACCOUNT, 'TOKEN'), { error: 'unreadable' });
  graph({ lists: [{ error: { code: 190, message: 'Error validating access token' } }] });
  assert.deepEqual(await accountPixels(ACCOUNT, 'TOKEN'), { error: 'reauth' });
});

test('trackingStatus: ready, not on the account, no pixel, unknown', () => {
  const cfg = { meta: { pixelId: '1813709013140947' }, metaPixelId: '1813709013140947' };
  assert.equal(trackingStatus(cfg, { pixels: [{ id: '1813709013140947', name: 'Store' }] }).status, 'ready');
  assert.equal(trackingStatus(cfg, { pixels: [{ id: '4444444444', name: 'Other' }] }).status, 'not_on_account');
  assert.equal(trackingStatus(cfg, { pixels: [] }).status, 'no_pixel');
  const unknown = trackingStatus(cfg, { error: 'unreadable' });
  assert.deepEqual([unknown.status, unknown.storefrontPixelId], ['unknown', '1813709013140947']);
});

test('ensure: the store pixel is kept when the ad account can use it; nothing is created', async () => {
  const log = graph({ lists: [{ data: [{ id: '1111111111' }, { id: '1813709013140947' }] }] });
  const r = await ensure({ meta: { pixelId: '1813709013140947' } });
  assert.deepEqual([r.ok, r.pixel.id, r.created], [true, '1813709013140947', false]);
  assert.equal(log.creates.length, 0);
});

test('ensure: the ad account\'s only pixel is used', async () => {
  const log = graph({ lists: [{ data: [{ id: '3333333333', name: 'Seniqify pixel' }] }] });
  const r = await ensure({ meta: { pixelId: '1813709013140947' } });
  assert.deepEqual([r.ok, r.pixel.id, r.created], [true, '3333333333', false]);
  assert.equal(log.creates.length, 0);
});

test('ensure: with several pixels the merchant chooses, and a chosen pixel must be on the account', async () => {
  const pixels = [{ id: '3333333333', name: 'A' }, { id: '4444444444', name: 'B' }];
  let log = graph({ lists: [{ data: pixels }] });
  let r = await ensure({ meta: { pixelId: '1813709013140947' } });
  assert.equal(r.error, 'choose_pixel');
  assert.deepEqual(r.accountPixels.map((p) => p.id), ['3333333333', '4444444444']);
  assert.equal(log.creates.length, 0);

  graph({ lists: [{ data: pixels }] });
  r = await ensure({}, '9999999999');
  assert.equal(r.error, 'pixel_not_on_account');

  log = graph({ lists: [{ data: pixels }] });
  r = await ensure({}, '4444444444');
  assert.deepEqual([r.ok, r.pixel.id], [true, '4444444444']);
  assert.equal(log.creates.length, 0);
});

test('ensure: an ad account with no pixel gets one, named after the store', async () => {
  const log = graph({ lists: [{ data: [] }] });
  const r = await ensure({ businessName: 'Protine Hub', meta: { pixelId: '1813709013140947' } });
  assert.deepEqual([r.ok, r.pixel.id, r.created], [true, '5550001112223334', true]);
  assert.deepEqual(log.creates, [{ name: 'Protine Hub · PocketLink', access_token: 'TOKEN' }]);
});

test('ensure: if Meta says the ad account already has a pixel, that pixel is used', async () => {
  graph({ lists: [{ data: [] }, { data: [{ id: '6666666666', name: 'Made elsewhere' }] }], create: { error: { code: 6200, message: 'A pixel already exists for this account' } } });
  const r = await ensure({ businessName: 'Protine Hub' });
  assert.deepEqual([r.ok, r.pixel.id, r.created], [true, '6666666666', false]);
});

test('ensure: a create Meta refuses is reported in Meta\'s words', async () => {
  graph({ lists: [{ data: [] }], create: { error: { code: 100, message: 'Invalid parameter', error_user_msg: 'Pixels cannot be created for this ad account.' } } });
  const r = await ensure({ businessName: 'Protine Hub' });
  assert.equal(r.error, 'pixel_create_failed');
  assert.equal(r.message, 'Pixels cannot be created for this ad account.');
});

test('ensure: when the pixel list cannot be read, nothing is created', async () => {
  const log = graph({ lists: [{ error: { code: 1, message: 'An unknown error occurred' } }] });
  const r = await ensure({ businessName: 'Protine Hub' });
  assert.equal(r.error, 'pixels_unreadable');
  assert.equal(log.creates.length, 0);
});
