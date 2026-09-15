// Route: campaign-preview 'setup-order-tracking' and the order tracking status in
// 'connection'. Supabase and Graph are faked at globalThis.fetch — no network, and
// no pixel is really created.
import test from 'node:test';
import assert from 'node:assert/strict';
import previewHandler from '../api/meta/campaign-preview.js';

const realFetch = globalThis.fetch;
const ENV = ['SUPABASE_SERVICE_ROLE_KEY', 'META_ADS_PILOT_SLUGS', 'META_ADS_MERCHANT_WRITES', 'META_ALLOWED_SLUGS'];
test.beforeEach(() => { process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key-for-tests'; });
test.afterEach(() => { globalThis.fetch = realFetch; for (const k of ENV) delete process.env[k]; });

const ACCOUNT = 'act_962613363265198';
const STORE_PIXEL = '1813709013140947';

function world({ config, pixels = [], create = { id: '5550001112223334' }, slug = 'showme' } = {}) {
  const log = { patches: [], creates: [], audits: [] };
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    const method = (init.method || 'GET').toUpperCase();
    const body = init.body ? JSON.parse(init.body) : null;
    const reply = (b, status = 200) => ({ ok: status < 400, status, json: async () => b, text: async () => JSON.stringify(b) });
    if (u.includes('/rpc/verify_store_pin')) return reply(true);
    if (u.includes('/rest/v1/store_meta_accounts')) {
      return method === 'GET'
        ? reply([{ store_slug: slug, status: 'connected', access_token: 'STORED-TOKEN', expires_at: new Date(Date.now() + 40 * 86400000).toISOString(), ad_account_ids: [ACCOUNT], selected_ad_account_id: ACCOUNT, scopes: ['ads_management', 'ads_read'], token_status: 'valid' }])
        : reply(null, 204);
    }
    if (u.includes('/rest/v1/stores')) {
      if (method === 'PATCH') { log.patches.push(body.config); return reply(null, 204); }
      return reply([{ config }]);
    }
    if (u.includes('/rest/v1/meta_ad_actions')) { log.audits.push(body); return reply(null, 201); }
    if (u.includes('/rest/v1/')) return reply([]);
    if (u.includes(`/${ACCOUNT}/adspixels`) && method === 'POST') { log.creates.push(body); return create.error ? reply(create, 400) : reply(create); }
    if (u.includes(`/${ACCOUNT}/adspixels?`)) return reply({ data: pixels });
    if (u.includes('/me/permissions')) return reply({ data: [{ permission: 'ads_management', status: 'granted' }, { permission: 'ads_read', status: 'granted' }] });
    return reply({ data: [] });
  };
  return log;
}

async function post(body) {
  const r = { statusCode: 200, body: null };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  await previewHandler({ method: 'POST', body: { slug: 'showme', hashedPin: 'h', action: 'setup-order-tracking', ...body } }, r);
  return r;
}

test('an ad account with no pixel gets one, and it becomes the store\'s pixel for ads and the storefront', async () => {
  const log = world({ config: { businessName: 'Protine Hub', meta: { pixelId: STORE_PIXEL }, metaPixelId: STORE_PIXEL } });
  const r = await post({});
  assert.deepEqual([r.body.ok, r.body.created, r.body.pixelId], [true, true, '5550001112223334']);
  assert.equal(log.creates[0].name, 'Protine Hub · PocketLink');
  assert.deepEqual([log.patches[0].meta.pixelId, log.patches[0].metaPixelId], ['5550001112223334', '5550001112223334']);
  assert.equal(log.patches[0].businessName, 'Protine Hub', 'the rest of the store config is kept');
  const audit = log.audits.find((a) => a.action === 'select');
  assert.deepEqual([audit.detail.kind, audit.detail.created, audit.target_id], ['pixel', true, '5550001112223334']);
});

test('a pixel the owner added themselves keeps working: the storefront field is left alone', async () => {
  const log = world({ config: { businessName: 'Protine Hub', meta: {}, metaPixelId: '2459328801203274' } });
  const r = await post({});
  assert.equal(r.body.ok, true);
  assert.deepEqual([log.patches[0].meta.pixelId, log.patches[0].metaPixelId], ['5550001112223334', '2459328801203274']);
});

test('the ad account\'s only pixel is used and nothing is created', async () => {
  const log = world({ config: { meta: { pixelId: STORE_PIXEL }, metaPixelId: STORE_PIXEL }, pixels: [{ id: '4444444444444444', name: 'Seniqify pixel' }] });
  const r = await post({});
  assert.deepEqual([r.body.ok, r.body.created, r.body.pixelId], [true, false, '4444444444444444']);
  assert.equal(log.creates.length, 0);
});

test('several pixels: the merchant is asked to choose; nothing is saved until they do', async () => {
  const pixels = [{ id: '4444444444444444', name: 'A' }, { id: '7777777777777777', name: 'B' }];
  let log = world({ config: { meta: { pixelId: STORE_PIXEL } }, pixels });
  let r = await post({});
  assert.equal(r.body.error, 'choose_pixel');
  assert.equal(r.body.accountPixels.length, 2);
  assert.deepEqual([log.patches.length, log.creates.length], [0, 0]);

  log = world({ config: { meta: { pixelId: STORE_PIXEL } }, pixels });
  r = await post({ pixelId: '7777777777777777' });
  assert.deepEqual([r.body.ok, log.patches[0].meta.pixelId], [true, '7777777777777777']);
});

test('a create Meta refuses is reported in Meta\'s words, and nothing is saved', async () => {
  const log = world({ config: { businessName: 'Protine Hub', meta: {} }, create: { error: { code: 100, message: 'Invalid parameter', error_user_msg: 'Pixels cannot be created for this ad account.' } } });
  const r = await post({});
  assert.deepEqual([r.body.error, r.body.message], ['pixel_create_failed', 'Pixels cannot be created for this ad account.']);
  assert.equal(log.patches.length, 0);
});

test('a store outside the pilot is refused before any Meta call or save', async () => {
  const log = world({ slug: 'royalfoodsmasale', config: { meta: {} } });
  const r = await post({ slug: 'royalfoodsmasale' });
  assert.deepEqual([r.statusCode, r.body.error], [403, 'writes_disabled']);
  assert.deepEqual([log.creates.length, log.patches.length], [0, 0]);
});

test('a preview deployment cannot set it up for another store', async () => {
  process.env.META_ALLOWED_SLUGS = 'showme';
  process.env.META_ADS_MERCHANT_WRITES = 'on';
  const log = world({ slug: 'royalfoodsmasale', config: { meta: {} } });
  const r = await post({ slug: 'royalfoodsmasale' });
  assert.deepEqual([r.statusCode, r.body.error], [403, 'not_allowed_in_this_environment']);
  assert.equal(log.creates.length, 0);
});

test('the connection shows whether orders are tracked in the selected ad account', async () => {
  world({ config: { meta: { pixelId: STORE_PIXEL }, metaPixelId: STORE_PIXEL }, pixels: [{ id: STORE_PIXEL, name: 'Shobha IVF' }] });
  let r = await post({ action: 'connection' });
  assert.deepEqual([r.body.orderTracking.status, r.body.orderTracking.pixel.id], ['ready', STORE_PIXEL]);

  world({ config: { meta: { pixelId: STORE_PIXEL }, metaPixelId: STORE_PIXEL }, pixels: [] });
  r = await post({ action: 'connection' });
  assert.equal(r.body.orderTracking.status, 'no_pixel');
  assert.equal(JSON.stringify(r.body).includes('STORED-TOKEN'), false);
});
