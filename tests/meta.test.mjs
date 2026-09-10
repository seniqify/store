// Meta integration unit tests. Run with:  npm test   (node --test, no deps)
//
// These cover the pure, decision-making parts of the ads integration — the ones
// whose failure is silent and expensive. Nothing here touches the network: no
// Meta call is made, and no Meta object is ever created by the test suite.
import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeAdAccountId } from '../api/meta/_meta.js';
import { productDisplay, CAPS } from '../api/meta/_campaignBuild.js';

// ── Ad-account id normalization ───────────────────────────────────────────────
// The bug this prevents: ad_account_ids are stored WITH the act_ prefix, and the
// creation path re-prefixed them, producing act_act_… which 400s on every call.
test('normalizeAdAccountId: already-prefixed id is left with exactly one prefix', () => {
  assert.equal(normalizeAdAccountId('act_1896623077683652'), 'act_1896623077683652');
});

test('normalizeAdAccountId: bare numeric id gains the prefix', () => {
  assert.equal(normalizeAdAccountId('1896623077683652'), 'act_1896623077683652');
});

test('normalizeAdAccountId: a doubled prefix is repaired, never emitted', () => {
  assert.equal(normalizeAdAccountId('act_act_1896623077683652'), 'act_1896623077683652');
  assert.equal(normalizeAdAccountId('ACT_act_123'), 'act_123');
});

test('normalizeAdAccountId: numeric input and surrounding space are handled', () => {
  assert.equal(normalizeAdAccountId(1896623077683652), 'act_1896623077683652');
  assert.equal(normalizeAdAccountId('  act_123  '), 'act_123');
});

test('normalizeAdAccountId: junk returns null rather than a malformed path', () => {
  for (const bad of ['', null, undefined, 'act_', 'act_abc', 'not-an-id', {}]) {
    assert.equal(normalizeAdAccountId(bad), null, `expected null for ${JSON.stringify(bad)}`);
  }
});

test('normalizeAdAccountId is idempotent', () => {
  const once = normalizeAdAccountId('123');
  assert.equal(normalizeAdAccountId(once), once);
});

// ── Pack-aware product display ────────────────────────────────────────────────
// Real data from royalfoodsmasale: the ₹270 headline price is the "3 x Packet"
// variant, so the ad must not imply ₹270 buys a single 90 g packet.
const bajarAmti90 = {
  name: 'Bajar Amti 90 g Per Packet',
  price: '270',
  unit: '90g',
  variants: { label: 'Packs', options: [
    { name: '3 x Packet', price: 270, mrp: 540, cost: 200 },
    { name: '5 x Packet', price: 450, mrp: 850, cost: 400 },
  ] },
};

test('productDisplay: multipack price is shown as a pack, not a single unit', () => {
  const d = productDisplay(bajarAmti90);
  assert.equal(d.qty, 3);
  assert.equal(d.packLabel, 'Pack of 3 × 90 g');
  assert.equal(d.title, 'Bajar Amti — Pack of 3 × 90 g');
});

test('productDisplay: reads price/qty, never rewrites them', () => {
  const before = JSON.stringify(bajarAmti90);
  productDisplay(bajarAmti90);
  assert.equal(JSON.stringify(bajarAmti90), before, 'product must not be mutated');
});

test('productDisplay: single-unit product keeps its own name', () => {
  const d = productDisplay({ name: 'Masala Tin', price: 120, unit: '200g' });
  assert.equal(d.packLabel, null);
  assert.equal(d.title, 'Masala Tin');
});

test('productDisplay: a 1x variant is not dressed up as a pack', () => {
  const d = productDisplay({
    name: 'Ghee 500 ml', price: 600, unit: '500ml',
    variants: { options: [{ name: '1 x Bottle', price: 600 }] },
  });
  assert.equal(d.packLabel, null);
});

test('productDisplay: generic — works for a different product/unit', () => {
  const d = productDisplay({
    name: 'Chivda 200 g Per Packet', price: 300, unit: '200g',
    variants: { options: [{ name: '4 x Packet', price: 300 }] },
  });
  assert.equal(d.title, 'Chivda — Pack of 4 × 200 g');
});

test('productDisplay: no variant matches the headline price → no pack claim', () => {
  const d = productDisplay({
    name: 'Amti 90 g', price: 99, unit: '90g',
    variants: { options: [{ name: '3 x Packet', price: 270 }] },
  });
  assert.equal(d.packLabel, null, 'must not borrow a pack size from a non-matching price');
});

test('productDisplay: null product is tolerated', () => {
  assert.equal(productDisplay(null), null);
});

// ── Budget caps ───────────────────────────────────────────────────────────────
test('CAPS: server-side ceilings are present and sane', () => {
  assert.equal(CAPS.maxDaily, 5000);
  assert.equal(CAPS.maxTotal, 25000);
  assert.equal(CAPS.maxDays, 30);
  // The ₹200 × 7 = ₹1,400 case sits BELOW Meta's spend-cap minimum, so the UI
  // must not claim a campaign spend cap is applied at that size.
  assert.ok(200 * 7 < CAPS.spendCapMinRupees);
});

// ── Ad-account resolution ─────────────────────────────────────────────────────
// The rule that matters: with several accounts and no saved choice, ASK — never
// fall back to the first. Array order is incidental, and relying on it is how
// showme paired the PocketLink Page with the Shobha IVF ad account.
import { resolveAdAccount } from '../api/meta/_meta.js';

test('resolveAdAccount: honours an explicit persisted selection', () => {
  const r = resolveAdAccount({
    ad_account_ids: ['act_26443868945229654', 'act_962613363265198'],
    selected_ad_account_id: 'act_962613363265198',
  });
  assert.equal(r.adAccount, 'act_962613363265198');
  assert.equal(r.error, undefined);
});

test('resolveAdAccount: several accounts, no selection → asks instead of guessing', () => {
  const r = resolveAdAccount({ ad_account_ids: ['act_111', 'act_222'] });
  assert.equal(r.error, 'ad_account_not_selected');
  assert.equal(r.adAccount, undefined, 'must NOT silently pick the first');
  assert.deepEqual(r.available, ['act_111', 'act_222']);
});

test('resolveAdAccount: a single account needs no explicit choice', () => {
  const r = resolveAdAccount({ ad_account_ids: ['act_111'] });
  assert.equal(r.adAccount, 'act_111');
});

test('resolveAdAccount: a stale selection no longer granted is ignored', () => {
  const r = resolveAdAccount({ ad_account_ids: ['act_111', 'act_222'], selected_ad_account_id: 'act_999' });
  assert.equal(r.error, 'ad_account_not_selected', 'a revoked account must not be used');
});

test('resolveAdAccount: selection matches regardless of act_ prefix form', () => {
  const r = resolveAdAccount({ ad_account_ids: ['act_962613363265198'], selected_ad_account_id: '962613363265198' });
  assert.equal(r.adAccount, 'act_962613363265198');
});

test('resolveAdAccount: no accounts at all', () => {
  assert.equal(resolveAdAccount({ ad_account_ids: [] }).error, 'no_ad_account');
  assert.equal(resolveAdAccount({}).error, 'no_ad_account');
});
