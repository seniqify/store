// PR-E: the owner's "Your own domain" card -- the pure parts. Which step a
// status answer shows, which hostname links use, the record names shown, the
// message for every refusal the server can give, and the link helper.
// (The card itself is driven in a real browser: tests/e2e/manage-domain-browser.mjs.)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  manageDomain, domainStep, liveDomain, otherName, txtPanelName, domainMessage, DOMAIN_MESSAGES, FALLBACK_MESSAGE,
} from '../src/utils/domainsApi.js';
import { publicStoreUrl } from '../src/utils/storeUrls.js';
import { PL_ORIGIN } from '../src/utils/customDomainRoutes.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = (p) => readFileSync(`${ROOT}${p}`, 'utf8');

const apexGroup = (status, primary = 'brand.com') => ({
  status, primary_host: primary, expires_at: null,
  hostnames: [{ hostname: 'brand.com', kind: 'apex', role: primary === 'brand.com' ? 'primary' : 'redirect', vercel: 'configured' },
              { hostname: 'www.brand.com', kind: 'www', role: primary === 'brand.com' ? 'redirect' : 'primary', vercel: 'configured' }],
  txt: { type: 'TXT', name: '_pocketlink.brand.com', value: 'a'.repeat(32) },
});
const subGroup = (status) => ({
  status, primary_host: 'shop.brand.com', expires_at: null,
  hostnames: [{ hostname: 'shop.brand.com', kind: 'subdomain', role: 'primary', vercel: 'none' }],
  txt: { type: 'TXT', name: '_pocketlink.shop.brand.com', value: 'b'.repeat(32) },
});

test('domainStep: hidden whenever the server says the feature is not for this store', () => {
  for (const outcome of ['feature_disabled', 'not_configured', 'unauthorized']) assert.equal(domainStep({ outcome }), 'hidden', outcome);
});

test('domainStep: one step per open group status; no group = none; anything else = error', () => {
  assert.equal(domainStep({ outcome: 'ok', domain: null }), 'none');
  for (const s of ['pending', 'verified', 'ready', 'connected', 'misconfigured', 'disconnecting']) {
    assert.equal(domainStep({ outcome: 'ok', domain: apexGroup(s) }), s);
  }
  assert.equal(domainStep({ outcome: 'ok', domain: apexGroup('something_new') }), 'none');
  for (const outcome of ['temporarily_unavailable', 'network_error', 'busy', undefined]) assert.equal(domainStep({ outcome }), 'error', String(outcome));
});

test('liveDomain: only a CONNECTED group that the server says is SERVED', () => {
  assert.equal(liveDomain({ outcome: 'ok', serving: true, domain: apexGroup('connected') }), 'brand.com');
  assert.equal(liveDomain({ outcome: 'ok', serving: true, domain: apexGroup('connected', 'www.brand.com') }), 'www.brand.com');
  assert.equal(liveDomain({ outcome: 'ok', serving: false, domain: apexGroup('connected') }), null, 'connected but routing off');
  assert.equal(liveDomain({ outcome: 'ok', domain: apexGroup('connected') }), null, 'no serving field');
  for (const s of ['pending', 'verified', 'ready', 'misconfigured', 'disconnecting']) {
    assert.equal(liveDomain({ outcome: 'ok', serving: true, domain: apexGroup(s) }), null, s);
  }
  assert.equal(liveDomain({ outcome: 'feature_disabled' }), null);
  assert.equal(liveDomain(null), null);
});

test('otherName and txtPanelName', () => {
  assert.equal(otherName(apexGroup('connected')), 'www.brand.com');
  assert.equal(otherName(apexGroup('connected', 'www.brand.com')), 'brand.com');
  assert.equal(otherName(subGroup('connected')), null, 'a subdomain group has no other name');
  assert.equal(txtPanelName(apexGroup('pending')), '_pocketlink', 'apex: the name relative to the domain');
  assert.equal(txtPanelName(subGroup('pending')), '_pocketlink.shop.brand.com', 'subdomain: the full name');
});

test('publicStoreUrl: the live domain at its root; otherwise exactly today\'s PocketLink link', () => {
  assert.equal(publicStoreUrl('brandshop', {}, 'brand.com'), 'https://brand.com');
  assert.equal(publicStoreUrl('brandshop', { productId: 'p1' }, 'brand.com'), 'https://brand.com/p/p1');
  assert.equal(publicStoreUrl('brandshop', { categoryId: 'mugs' }, 'brand.com'), 'https://brand.com/c/mugs');
  assert.equal(publicStoreUrl('brandshop', {}, null), `${PL_ORIGIN}/brandshop`);
  assert.equal(publicStoreUrl('brandshop', { productId: 'p1' }, null, 'https://www.pocketlink.store'), 'https://www.pocketlink.store/brandshop/p/p1');
  assert.equal(publicStoreUrl('brandshop', { categoryId: 'mugs' }, '', 'https://preview.example'), 'https://preview.example/brandshop/c/mugs');
});

test('manageDomain: POSTs JSON with the hashed PIN (never the PIN); failures come back as outcomes', async () => {
  const seen = [];
  const ok = await manageDomain('brandshop', '2580', 'claim', { hostname: 'brand.com' }, async (url, init) => {
    seen.push({ url, init });
    return { json: async () => ({ outcome: 'claimed' }) };
  });
  assert.equal(ok.outcome, 'claimed');
  assert.equal(seen[0].url, '/api/domains/manage');
  assert.equal(seen[0].init.method, 'POST');
  assert.equal(seen[0].init.headers['Content-Type'], 'application/json');
  const body = JSON.parse(seen[0].init.body);
  assert.deepEqual(Object.keys(body).sort(), ['action', 'hashedPin', 'hostname', 'slug']);
  assert.match(body.hashedPin, /^[0-9a-f]{64}$/);
  assert.ok(!seen[0].init.body.includes('2580'), 'the raw PIN is never sent');
  // An extra field can never override the action, slug or PIN hash. (Asserted
  // outside the fake fetch: manageDomain turns anything thrown in it into an outcome.)
  let sent = null;
  await manageDomain('brandshop', '2580', 'status', { action: 'disconnect', slug: 'other', hashedPin: 'x' }, async (u, init) => {
    sent = JSON.parse(init.body);
    return { json: async () => ({ outcome: 'ok', domain: null }) };
  });
  assert.deepEqual([sent.action, sent.slug], ['status', 'brandshop']);
  assert.match(sent.hashedPin, /^[0-9a-f]{64}$/);
  assert.equal((await manageDomain('s', '1', 'status', {}, async () => { throw new Error('offline'); })).outcome, 'network_error');
  assert.equal((await manageDomain('s', '1', 'status', {}, async () => ({ json: async () => { throw new Error('html'); } }))).outcome, 'temporarily_unavailable');
  assert.equal((await manageDomain('s', '1', 'status', {}, async () => ({ json: async () => ({ nope: 1 }) }))).outcome, 'temporarily_unavailable');
});

// Every outcome the merchant API can return: the literals in the API layer, and the
// outcomes of the SQL it passes straight through. Outcomes the server only uses
// internally (leases, event validation) never reach the browser.
const INTERNAL_SQL = new Set([
  'leased', 'released', 'lease_lost', 'not_holder', 'stale_check', 'created', 'ready', 'nothing_to_remove',
  'already_attached', 'not_disconnecting', 'vercel_not_configured', 'reserved_event', 'detail_contains_secret',
  'detail_too_large', 'invalid_detail', 'invalid_event', 'invalid_actor', 'invalid_code_hash', 'invalid_intent',
  'invalid_kind', 'invalid_observation', 'invalid_result', 'not_found_lease',
]);
function serverOutcomes() {
  const out = new Set();
  for (const f of ['api/domains/manage.js', 'api/domains/_service.js']) {
    for (const m of read(f).matchAll(/outcome: '([a-z_]+)'/g)) out.add(m[1]);
  }
  for (const m of read('api/domains/_parse.js').matchAll(/reason: '([a-z_]+)'/g)) out.add(m[1]);
  for (const f of ['supabase/custom-domains-forward.sql', 'supabase/custom-domains-lease-forward.sql']) {
    for (const m of read(f).matchAll(/'outcome', '([a-z_]+)'/g)) if (!INTERNAL_SQL.has(m[1])) out.add(m[1]);
  }
  return [...out].sort();
}

test('every outcome the server can return is either a success or has its own plain message', () => {
  const missing = serverOutcomes().filter((o) => domainMessage(o) === FALLBACK_MESSAGE);
  assert.deepEqual(missing, [], `outcomes without a message: ${missing.join(', ')}`);
  for (const o of ['ok', 'claimed', 'already_claimed', 'verified', 'otp_sent', 'connected', 'disconnected', 'disconnecting']) {
    assert.equal(domainMessage(o), null, o);
  }
  assert.equal(domainMessage('some_future_outcome'), FALLBACK_MESSAGE);
  for (const [k, v] of Object.entries(DOMAIN_MESSAGES)) {
    assert.ok(v.length > 10 && !/[a-z]+_[a-z]+/.test(v.replace(/[a-z0-9.-]+\.(com|in)/g, '')), `${k}: a sentence, not a code`);
  }
});

test('Manage hands out the live domain only through publicStoreUrl; transactional links stay on PocketLink', () => {
  const manage = read('src/pages/ManageStore.jsx');
  // The owner's shareable links go through the helper...
  for (const f of ['src/pages/ManageStore.jsx', 'src/components/manage/ReachCard.jsx', 'src/components/manage/OverviewTab.jsx']) {
    assert.match(read(f), /publicStoreUrl\(/, f);
  }
  // ...and no shareable link still builds "origin/slug" by hand in those places.
  assert.doesNotMatch(read('src/components/manage/ReachCard.jsx'), /`\$\{window\.location\.origin\}\/\$\{slug\}`/);
  assert.doesNotMatch(read('src/components/manage/OverviewTab.jsx'), /`\$\{window\.location\.origin\}\/\$\{slug\}`/);
  assert.doesNotMatch(manage, /`\$\{window\.location\.origin\}\/\$\{config\.slug\}(\/c\/)?/);
  // The printed QR poster keeps the PocketLink link (founder decision 2026-10-02).
  assert.doesNotMatch(read('src/utils/storePoster.js'), /domain/i);
  // Review / tracking links are untouched.
  assert.match(read('src/components/manage/OrdersTab.jsx'), /reviewLink\(window\.location\.origin, token\)/);
});
