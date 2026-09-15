// campaign-launch 'list': what Meta says about each launch's campaign. Supabase and
// Graph are faked at globalThis.fetch — no network; nothing is created or changed.
import test from 'node:test';
import assert from 'node:assert/strict';
import launchHandler, { liveStatus, publicLaunch } from '../api/meta/campaign-launch.js';

const realFetch = globalThis.fetch;
test.beforeEach(() => { process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key-for-tests'; });
test.afterEach(() => { globalThis.fetch = realFetch; delete process.env.SUPABASE_SERVICE_ROLE_KEY; });

const ACCOUNT = 'act_962613363265198';
const ROW = (campaignId, over = {}) => ({
  launch_id: `launch-${campaignId}`, store_slug: 'showme', status: 'created', engine: 'graph', budget_type: 'lifetime',
  campaign_id: campaignId, adset_id: `${campaignId}1`, ad_id: `${campaignId}2`, lifetime_minor: 9500, days: 1,
  config: { product: 'Plant protein' }, ...over,
});

// campaigns: the account's campaign list; an array of arrays is served as pages;
// 'error' makes Meta refuse the read.
function world({ launches, campaigns, connected = true }) {
  const seen = { campaignReads: 0 };
  globalThis.fetch = async (url) => {
    const u = String(url);
    const reply = (b, status = 200) => ({ ok: status < 400, status, headers: { get: () => null }, json: async () => b, text: async () => JSON.stringify(b) });
    if (u.includes('/rpc/verify_store_pin')) return reply(true);
    if (u.includes('/auth/v1/user')) return reply({}, 401);
    if (u.includes('/rest/v1/meta_campaigns')) return reply(launches);
    if (u.includes('/rest/v1/store_meta_accounts')) {
      return reply(connected ? [{ store_slug: 'showme', status: 'connected', access_token: 'STORE-TOKEN', ad_account_ids: [ACCOUNT], selected_ad_account_id: ACCOUNT }] : []);
    }
    if (u.includes(`/${ACCOUNT}/campaigns?`)) {
      seen.campaignReads += 1;
      if (campaigns === 'error') return reply({ error: { message: 'User request limit reached', code: 17 } }, 400);
      const pages = Array.isArray(campaigns[0]) ? campaigns : [campaigns];
      const i = Number(new URL(u).searchParams.get('after') || 0);
      const more = i + 1 < pages.length;
      return reply({ data: pages[i], ...(more ? { paging: { cursors: { after: String(i + 1) }, next: `${u}&more` } } : {}) });
    }
    if (u.includes('/rest/v1/')) return reply([]);
    return reply({});
  };
  return seen;
}

const call = async () => {
  const r = { statusCode: 200, body: null };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  await launchHandler({ method: 'POST', body: { action: 'list', slug: 'showme', hashedPin: 'h' }, headers: {} }, r);
  return r.body;
};

test('a campaign deleted in Meta is reported gone; one started in Ads Manager shows as running', async () => {
  world({ launches: [ROW('501'), ROW('502')], campaigns: [{ id: '502', status: 'ACTIVE' }] });
  const body = await call();
  const by = Object.fromEntries(body.launches.map((l) => [l.ids.campaign_id, l]));
  assert.deepEqual([by['501'].inMeta, by['501'].status], [false, 'created']);
  assert.deepEqual([by['502'].inMeta, by['502'].status], [true, 'active']);
});

test('the ad account is read once for all of its launches', async () => {
  const seen = world({ launches: [ROW('501'), ROW('502'), ROW('503')], campaigns: [] });
  await call();
  assert.equal(seen.campaignReads, 1);
});

test('a campaign on a later page of the account is still found', async () => {
  world({ launches: [ROW('801')], campaigns: [[{ id: '800', status: 'PAUSED' }], [{ id: '801', status: 'PAUSED' }]] });
  const body = await call();
  assert.deepEqual([body.launches[0].inMeta, body.launches[0].status], [true, 'created']);
});

test('when Meta cannot be read, no launch is reported gone', async () => {
  world({ launches: [ROW('501'), ROW('502')], campaigns: 'error' });
  const body = await call();
  assert.deepEqual(body.launches.map((l) => [l.inMeta, l.status]), [[null, 'created'], [null, 'created']]);
});

test('without a Meta connection the list is the ledger, unchecked', async () => {
  const seen = world({ launches: [ROW('501')], campaigns: [], connected: false });
  const body = await call();
  assert.equal(body.launches[0].inMeta, null);
  assert.equal(seen.campaignReads, 0);
});

test('an automation launch missing from the list stays unknown: it may be an Ads Manager draft', async () => {
  world({ launches: [ROW('601', { engine: 'mcp', config: { adAccountId: ACCOUNT } })], campaigns: [] });
  const body = await call();
  assert.equal(body.launches[0].inMeta, null);
});

test('a launch that spent, with no recorded ad account, is never reported gone', async () => {
  world({ launches: [ROW('701', { status: 'paused', activated_at: '2026-09-11T06:30:00Z' })], campaigns: [] });
  const body = await call();
  assert.equal(body.launches[0].inMeta, null);
});

test('a launch that spent in its recorded ad account is reported gone once deleted there', async () => {
  world({ launches: [ROW('702', { status: 'paused', activated_at: '2026-09-11T06:30:00Z', config: { adAccountId: ACCOUNT } })], campaigns: [] });
  const body = await call();
  assert.equal(body.launches[0].inMeta, false);
});

test('the list never carries the store token', async () => {
  world({ launches: [ROW('501')], campaigns: [{ id: '501', status: 'PAUSED' }] });
  const body = await call();
  assert.equal(JSON.stringify(body).includes('STORE-TOKEN'), false);
});

test('liveStatus: Meta decides running vs paused and never un-fails a launch', () => {
  assert.equal(liveStatus('created', 'ACTIVE'), 'active');
  assert.equal(liveStatus('stopped', 'ACTIVE'), 'active');
  assert.equal(liveStatus('active', 'PAUSED'), 'paused');
  assert.equal(liveStatus('created', 'PAUSED'), 'created');
  assert.equal(liveStatus('partial', 'ACTIVE'), 'partial');
  assert.equal(liveStatus('failed', undefined), 'failed');
});

test('publicLaunch without Meta state keeps the ledger status and leaves inMeta unknown', () => {
  const p = publicLaunch(ROW('901', { status: 'active' }));
  assert.deepEqual([p.status, p.inMeta], ['active', null]);
  // Array.map passes an index as the second argument; it must not read as Meta state.
  assert.deepEqual([ROW('902'), ROW('903')].map(publicLaunch).map((l) => l.inMeta), [null, null]);
});
