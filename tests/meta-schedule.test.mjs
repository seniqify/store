// Plan builder: the ad set schedule. Meta rejects a daily-budget ad set scheduled
// for under 24 hours (subcode 1487793), so every run is measured from its start.
// Network is stubbed; no Meta call; nothing is created.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCampaign } from '../api/meta/_campaignBuild.js';
import { mcpCreateArgs } from '../api/meta/_mcpAds.js';

const realFetch = globalThis.fetch;
test.afterEach(() => { globalThis.fetch = realFetch; });

function stubFetch(routes) {
  globalThis.fetch = async (url) => {
    for (const [match, body] of routes) {
      if (String(url).includes(match)) return { ok: true, status: 200, json: async () => body };
    }
    return { ok: true, status: 200, json: async () => ({ data: [] }) };
  };
}

const DAY = 86400000;
const CFG = {
  businessName: 'Protine Hub', city: 'Solapur', state: 'Maharashtra', tagline: 'Order online',
  meta: { pageId: '1124874604040958', pageName: 'PocketLink' },
  products: [{ id: 'p1', name: 'Plant protein', price: 1599, unit: '1kg', image: 'https://cdn.example/plant.jpg' }],
};

async function build(days) {
  stubFetch([
    ['/search?', { data: [{ key: '1010461', name: 'Solapur', region: 'Maharashtra' }] }],
    ['1124874604040958', { id: '1124874604040958', name: 'PocketLink' }],
    ['act_', { currency: 'INR', name: 'PocketLink', min_daily_budget: 9491, account_status: 1, timezone_name: 'Asia/Kolkata' }],
  ]);
  return buildCampaign(
    { slug: 'showme', adId: 'act_962613363265198', token: 'TEST', cfg: CFG },
    { objective: 'traffic', days, dailyBudget: 95, promote: 'product', productId: 'p1', audienceStrategy: 'auto' },
  );
}

for (const days of [1, 5]) {
  test(`a ${days}-day run is scheduled for at least ${days * 24} hours from its start`, async () => {
    const out = await build(days);
    const { start_time: start, end_time: end } = out.payloads.adset.body;
    assert.ok(Date.parse(end) - Date.parse(start) >= days * DAY, `${start} → ${end}`);
    assert.equal(out.budget.endTime, end, 'the campaign stops when the ad set does');
  });
}

test('automation gets the same schedule: ad set start and end, and the campaign stop time', async () => {
  const out = await build(1);
  assert.equal(out.launchReady, true, JSON.stringify(out.launchBlockers));
  const args = mcpCreateArgs(out, { budgetType: 'daily' });
  assert.ok(Date.parse(args.adSet.end_time) - Date.parse(args.adSet.start_time) >= DAY);
  assert.equal(args.campaign.campaign_stop_time, args.adSet.end_time);
});
