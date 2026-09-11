// Behavioural tests for the Meta campaign path. Network is stubbed at
// globalThis.fetch, so NO real Meta call is made and NO Meta object is created.
//
// The invariants under test are the ones whose failure costs money or trust:
// preview writes nothing, every delivery object is PAUSED, budget claims match
// the payload, permission gating is real, and one merchant can never read
// another's ad account.
import test from 'node:test';
import assert from 'node:assert/strict';

import { buildCampaign } from '../api/meta/_campaignBuild.js';
import { getGrantedPermissions } from '../api/meta/_meta.js';

// ── fetch stub ────────────────────────────────────────────────────────────────
function stubFetch(routes) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: (init.method || 'GET').toUpperCase() });
    for (const [match, body] of routes) {
      if (String(url).includes(match)) {
        return { ok: true, status: 200, json: async () => body };
      }
    }
    return { ok: true, status: 200, json: async () => ({ data: [] }) };
  };
  return calls;
}
const realFetch = globalThis.fetch;
test.afterEach(() => { globalThis.fetch = realFetch; });

const ACCOUNT_OK = { currency: 'INR', name: 'Royal Foods', min_daily_budget: 9615, account_status: 1, timezone_name: 'Asia/Kolkata' };
const PAGE_OK = { id: '111222333', name: 'Royal Foods & Masale' };
const GEO_OK = { data: [{ key: '1010461', name: 'Solapur', region: 'Maharashtra' }] };

const CFG = {
  businessName: 'Royal Foods', city: 'Solapur', state: 'Maharashtra', tagline: 'Authentic masala',
  meta: { pageId: '111222333', pageName: 'Royal Foods & Masale' },
  products: [{ id: 'p1', name: 'Bajar Amti 90 g Per Packet', price: '270', unit: '90g', image: 'https://img/x.jpg',
    variants: { options: [{ name: '3 x Packet', price: 270, mrp: 540 }] } }],
};

const INPUT = { objective: 'traffic', days: 7, dailyBudget: 200, promote: 'product', productId: 'p1', audienceStrategy: 'auto' };

async function build(overrides = {}, adId = 'act_1896623077683652') {
  const calls = stubFetch([
    ['/search?', GEO_OK],
    ['111222333', PAGE_OK],
    ['act_', { ...ACCOUNT_OK }],
  ]);
  const out = await buildCampaign({ slug: 'royalfoodsmasale', adId, token: 'TEST', cfg: CFG }, { ...INPUT, ...overrides });
  return { out, calls };
}

// ── Preview makes no writes ───────────────────────────────────────────────────
test('preview performs no POST — it can never create a Meta object', async () => {
  const { calls } = await build();
  const writes = calls.filter((c) => c.method !== 'GET');
  assert.deepEqual(writes, [], `preview must be read-only, saw: ${JSON.stringify(writes)}`);
});

// ── Everything is PAUSED ──────────────────────────────────────────────────────
test('campaign, ad set and ad are all built PAUSED', async () => {
  const { out } = await build();
  assert.equal(out.payloads.campaign.body.status, 'PAUSED');
  assert.equal(out.payloads.adset.body.status, 'PAUSED');
  assert.equal(out.payloads.ad.body.status, 'PAUSED');
});

test('no payload ever carries ACTIVE', async () => {
  const { out } = await build();
  assert.ok(!JSON.stringify(out.payloads).includes('ACTIVE'), 'a delivery object must never be built ACTIVE');
});

// ── Ad-account prefix ─────────────────────────────────────────────────────────
test('endpoints carry exactly one act_ prefix (prefixed input)', async () => {
  const { out } = await build({}, 'act_1896623077683652');
  for (const k of ['campaign', 'adset', 'adcreative', 'ad']) {
    assert.match(out.payloads[k].endpoint, /\/act_1896623077683652\//);
    assert.ok(!out.payloads[k].endpoint.includes('act_act_'), `${k} endpoint double-prefixed`);
  }
});

test('endpoints are identical for a bare numeric account id', async () => {
  const a = (await build({}, 'act_1896623077683652')).out.payloads.campaign.endpoint;
  const b = (await build({}, '1896623077683652')).out.payloads.campaign.endpoint;
  assert.equal(a, b);
});

// ── Audience claim matches payload ────────────────────────────────────────────
test('Advantage+ is actually sent when the audience is automatic', async () => {
  const { out } = await build({ audienceStrategy: 'auto' });
  assert.deepEqual(out.payloads.adset.body.targeting.targeting_automation, { advantage_audience: 1 });
});

test('Advantage+ is absent when the audience is manual', async () => {
  const { out } = await build({ audienceStrategy: 'manual' });
  assert.equal(out.payloads.adset.body.targeting.targeting_automation, undefined);
});

// ── Budget: claim must match what is sent ─────────────────────────────────────
test('₹200 x 7 sets a lifetime budget and does NOT claim a spend cap', async () => {
  const { out } = await build({ dailyBudget: 200, days: 7 });
  assert.equal(out.budget.total, 1400);
  assert.equal(out.payloads.adset.body.lifetime_budget, 140000);       // paise
  assert.equal(out.budget.spendCapApplied, false);
  assert.equal(out.payloads.campaign.body.spend_cap, undefined, 'must not send a spend cap it cannot set');
  assert.match(out.budget.enforcedBy, /no campaign spend cap/);
  assert.ok(out.payloads.adset.body.end_time, 'end_time bounds the run');
});

test('a large enough total does apply the campaign spend cap', async () => {
  const { out } = await build({ dailyBudget: 2000, days: 7 });          // ₹14,000
  assert.equal(out.budget.spendCapApplied, true);
  assert.equal(out.payloads.campaign.body.spend_cap, 1400000);
  assert.match(out.budget.enforcedBy, /spend cap/);
});

test('server-side caps clamp an over-large request', async () => {
  const { out } = await build({ dailyBudget: 999999, days: 999 });
  assert.ok(out.budget.daily <= 5000);
  assert.ok(out.budget.total <= 25000);
  assert.ok(out.budget.days <= 30);
});

// ── Creative truthfulness ─────────────────────────────────────────────────────
test('creative states the pack size and points at the storefront product page', async () => {
  const { out } = await build();
  const ld = out.payloads.adcreative.body.object_story_spec.link_data;
  assert.match(ld.name, /Pack of 3 × 90 g/);
  assert.equal(ld.call_to_action.type, 'SHOP_NOW');
  assert.match(ld.link, /pocketlink\.store\/royalfoodsmasale\/p\/p1$/);
  assert.ok(!/whatsapp/i.test(ld.message), 'copy must not promise a WhatsApp destination');
});

// ── Bad account id ────────────────────────────────────────────────────────────
test('an unusable ad account id is rejected, not turned into a broken path', async () => {
  const { out } = await build({}, 'not-an-account');
  assert.equal(out.error, 'no_ad_account');
});

// ── Live permission check ─────────────────────────────────────────────────────
test('getGrantedPermissions returns only granted permissions', async () => {
  stubFetch([['me/permissions', { data: [
    { permission: 'ads_read', status: 'granted' },
    { permission: 'ads_management', status: 'declined' },
    { permission: 'public_profile', status: 'granted' },
  ] }]]);
  const { granted } = await getGrantedPermissions('TEST');
  assert.ok(granted.has('ads_read'));
  assert.ok(!granted.has('ads_management'), 'a declined permission must never count as granted');
});

test('getGrantedPermissions surfaces an error instead of an empty grant set', async () => {
  stubFetch([['me/permissions', { error: { message: 'Invalid OAuth access token' } }]]);
  const r = await getGrantedPermissions('TEST');
  assert.equal(r.granted, null);
  assert.match(r.error, /Invalid OAuth/);
});

// Meta requires this whenever the budget sits on the ad set rather than the
// campaign; without it every campaign create fails with subcode 4834011.
test('campaign declares ad-set budget sharing, and disables it', async () => {
  const { out } = await build();
  assert.equal(out.payloads.campaign.body.is_adset_budget_sharing_enabled, false,
    'must be explicitly false — true would let ad sets share budget and break the ceiling');
});

// ── Advantage+ and the upper age limit ───────────────────────────────────────
// Meta rejects an ad set whose age_max is below 65 when Advantage+ audience is
// on (error 100 / subcode 1870189). That rejection arrived AFTER the campaign
// had been created, so a reasonable seller choice like "25 to 55" could never
// launch and left a half-built campaign behind on every attempt.

test('Advantage+ opens the upper age limit to 65 instead of failing', async () => {
  const { out } = await build({ audienceStrategy: 'auto', ageMin: 25, ageMax: 55 });
  assert.equal(out.payloads.adset.body.targeting.age_max, 65);
  assert.equal(out.payloads.adset.body.targeting.age_min, 25, 'the lower bound is still honoured');
  assert.ok(out.payloads.adset.body.targeting.targeting_automation, 'Advantage+ stays on');
});

test('the plan shows what is actually sent, and records what was asked for', async () => {
  const { out } = await build({ audienceStrategy: 'auto', ageMin: 25, ageMax: 55 });
  assert.equal(out.targeting.ageMax, 65, 'preview must equal launch');
  assert.equal(out.targeting.ageMaxRequested, 55);
  assert.equal(out.targeting.ageMaxRelaxed, true);
  assert.ok(out.warnings.some((w) => w.includes('Advantage+')), 'the seller is told, not silently overridden');
});

test('manual targeting honours a narrow upper age exactly', async () => {
  const { out } = await build({ audienceStrategy: 'manual', ageMin: 25, ageMax: 55 });
  assert.equal(out.payloads.adset.body.targeting.age_max, 55);
  assert.equal(out.targeting.ageMaxRelaxed, false);
  assert.equal(out.payloads.adset.body.targeting.targeting_automation, undefined);
});

test('an already-open age range is untouched and raises no warning', async () => {
  const { out } = await build({ audienceStrategy: 'auto', ageMin: 18, ageMax: 65 });
  assert.equal(out.payloads.adset.body.targeting.age_max, 65);
  assert.equal(out.targeting.ageMaxRelaxed, false);
  assert.ok(!out.warnings.some((w) => w.includes('Advantage+')));
});
