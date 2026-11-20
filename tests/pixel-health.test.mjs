// Meta Pixel check (2026-10-24). Upahar Cookies & Cakes showed ~24 Meta
// purchases against 4-5 orders: a rule saved on its pixel in Events Manager
// logged a Purchase whenever the shop's page opened. api/meta/_pixelHealth.js
// finds such rules in the pixel's public settings; the Ads tab and the Console
// warn about them, and the Ads tab flags Meta purchases far above real orders.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  parseEstRules, findingsFrom, checkPixel, checkPixels, storePixels, jsonAt, cleanPixelId, configUrl,
} from '../api/meta/_pixelHealth.js';
import { purchaseGap, topPixelProblem, eventWords, shortPage } from '../src/utils/adsTruth.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = (p) => readFileSync(`${ROOT}${p}`, 'utf8').replace(/\r\n/g, '\n');
const code = (p) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const UPAHAR = '1809635840220666';
// The rule exactly as Meta served it for Upahar on 2026-10-24.
const UPAHAR_RULE = `fbq.set("estRules", "${UPAHAR}", [{"condition":{"type":1,"conditions":[{"targetType":2,"extractor":1,"operator":2,"action":2,"value":"https:\\/\\/www.pocketlink.store\\/upaharcookiescakes"}]},"derived_event_name":"Purchase","transformations":[1],"rule_status":"ACTIVE","rule_id":"1091963450253333"}]);`;
const config = (id, extra = '') => `/*1.2*/ fbq.registerPlugin("config:${id}", {}); config.set("${id}", "inferredEvents", {"buttonSelector":"extended"});\n${extra}\nfbq.set("iwlExtractors", "${id}", []); instance.configLoaded("${id}");`;

// ── reading the rules ────────────────────────────────────────────────────────

test('finds the rule that turned every Upahar visit into a Purchase', () => {
  const rules = parseEstRules(config(UPAHAR, UPAHAR_RULE), UPAHAR);
  assert.equal(rules.length, 1);
  assert.deepEqual(findingsFrom(rules), [{
    ruleId: '1091963450253333', event: 'Purchase', severity: 'critical',
    pages: ['https://www.pocketlink.store/upaharcookiescakes'],
  }]);
});

test('a pixel with no rules is clean, and another pixel’s rules are not this one’s', () => {
  assert.deepEqual(parseEstRules(config('2459328801203274'), '2459328801203274'), []);
  const both = config(UPAHAR, UPAHAR_RULE) + config('2459328801203274');
  assert.deepEqual(parseEstRules(both, '2459328801203274'), []);
  assert.equal(parseEstRules(both, UPAHAR).length, 1);
});

test('brackets and quotes inside a page address do not end the rules early', () => {
  const tricky = `fbq.set("estRules", "1", [{"condition":{"conditions":[{"value":"https://x.in/a]b\\"c);"}]},"derived_event_name":"Lead","rule_status":"ACTIVE","rule_id":"9"}]);`;
  const rules = parseEstRules(tricky, '1');
  assert.equal(rules.length, 1);
  assert.equal(findingsFrom(rules)[0].pages[0], 'https://x.in/a]b"c);');
  assert.equal(jsonAt('[1,[2]', 0), undefined, 'an unterminated value is not guessed at');
  assert.equal(jsonAt('x', 0), undefined);
});

test('purchases are critical, other conversions a warning; paused rules and page views are ignored', () => {
  const rule = (event, status = 'ACTIVE', id = event) => ({ derived_event_name: event, rule_status: status, rule_id: id, condition: { conditions: [{ value: 'https://www.pocketlink.store/shop/p/1' }] } });
  const f = findingsFrom([rule('AddToCart'), rule('Purchase'), rule('Purchase', 'PAUSED', 'p2'), rule('ViewContent'), rule('PageView'), rule('Lead', 'DELETED')]);
  assert.deepEqual(f.map((x) => [x.event, x.severity]), [['Purchase', 'critical'], ['AddToCart', 'warning']]);
  assert.deepEqual(findingsFrom(null), []);
});

// ── fetching a pixel's settings ──────────────────────────────────────────────

const respond = (body, ok = true) => async () => ({ ok, text: async () => body });

test('checkPixel: problem, ok, and unknown when Meta cannot be read', async () => {
  assert.equal((await checkPixel(UPAHAR, { fetchImpl: respond(config(UPAHAR, UPAHAR_RULE)) })).status, 'problem');
  assert.equal((await checkPixel(UPAHAR, { fetchImpl: respond(config(UPAHAR)) })).status, 'ok');
  assert.equal((await checkPixel(UPAHAR, { fetchImpl: respond('', false) })).status, 'unknown', 'HTTP error');
  assert.equal((await checkPixel(UPAHAR, { fetchImpl: respond('<html>blocked</html>') })).status, 'unknown', 'not a pixel config');
  assert.equal((await checkPixel(UPAHAR, { fetchImpl: async () => { throw new Error('down'); } })).status, 'unknown', 'network');
  const slow = (url, { signal }) => new Promise((_, rej) => signal.addEventListener('abort', () => rej(new Error('aborted'))));
  assert.equal((await checkPixel(UPAHAR, { fetchImpl: slow, timeoutMs: 30 })).status, 'unknown', 'timeout');
  assert.equal((await checkPixel('not-a-pixel', { fetchImpl: respond(config(UPAHAR)) })).status, 'unknown');
});

test('checkPixel asks Meta for that pixel’s settings and nothing else', async () => {
  const urls = [];
  await checkPixel(UPAHAR, { fetchImpl: async (u) => { urls.push(u); return { ok: true, text: async () => config(UPAHAR) }; } });
  assert.deepEqual(urls, [configUrl(UPAHAR)]);
  assert.match(urls[0], /^https:\/\/connect\.facebook\.net\/signals\/config\/1809635840220666\?/);
});

test('checkPixels checks each pixel once', async () => {
  let calls = 0;
  const r = await checkPixels([UPAHAR, UPAHAR, ' 2459328801203274 ', 'junk', ''], { fetchImpl: async (u) => { calls++; const id = u.match(/config\/(\d+)/)[1]; return { ok: true, text: async () => config(id, id === UPAHAR ? UPAHAR_RULE : '') }; } });
  assert.equal(calls, 2);
  assert.equal(r.get(UPAHAR).status, 'problem');
  assert.equal(r.get('2459328801203274').status, 'ok');
});

test('a store’s pixels: the one the owner pasted and the one its ads use, once each', () => {
  assert.deepEqual(storePixels({ metaPixelId: UPAHAR, meta: { pixelId: UPAHAR } }), [{ pixelId: UPAHAR, used: ['storefront', 'ads'] }]);
  assert.deepEqual(storePixels({ metaPixelId: '111111', meta: { pixelId: '222222' } }).map((p) => p.pixelId), ['111111', '222222']);
  assert.deepEqual(storePixels({ metaPixelId: '', meta: {} }), []);
  assert.equal(cleanPixelId('12ab'), null);
});

// ── what the shop sees ───────────────────────────────────────────────────────

test('Meta purchases far above real orders are flagged; small differences are not', () => {
  assert.equal(purchaseGap(24, 5).inflated, true);
  assert.equal(purchaseGap(24, 5).extra, 19);
  assert.equal(purchaseGap(6, 4).inflated, false, 'attribution noise');
  assert.equal(purchaseGap(3, 0).inflated, true);
  assert.equal(purchaseGap(2, 0).inflated, false);
  assert.equal(purchaseGap(5, 5).inflated, false);
  assert.equal(purchaseGap(null, undefined).inflated, false);
});

test('the warning shows the purchase rule first, on the pixel it is on', () => {
  const health = { pixels: [
    { pixelId: '1', findings: [{ event: 'AddToCart', severity: 'warning', pages: [] }] },
    { pixelId: '2', findings: [{ event: 'Purchase', severity: 'critical', pages: ['https://www.pocketlink.store/s'] }] },
  ] };
  assert.deepEqual(topPixelProblem(health), { event: 'Purchase', severity: 'critical', pages: ['https://www.pocketlink.store/s'], pixelId: '2' });
  assert.equal(topPixelProblem({ pixels: [{ pixelId: '1', findings: [] }] }), null);
  assert.equal(topPixelProblem(null), null);
  assert.equal(eventWords('Purchase'), 'purchases');
  assert.equal(shortPage('https://www.pocketlink.store/upaharcookiescakes/'), 'pocketlink.store/upaharcookiescakes');
});

// ── the endpoint and the screens ─────────────────────────────────────────────

test('pixel-health: a store needs its PIN, the Console needs the founder; it only reads', () => {
  const src = code('api/meta/pixel-health.js');
  const pin = src.indexOf('verifyStorePin(slug, hashedPin)');
  const cfg = src.indexOf('getStoreConfig(slug)');
  assert.ok(pin > 0 && cfg > pin, 'PIN before the store’s config');
  assert.match(src, /if \(body\.scope === 'all'\) \{\n\s+if \(!\(await founder\(req\)\)\)/, 'founder check first');
  assert.match(src, /\[0\]\?\.role === 'admin'/);
  assert.ok(!/method:\s*'(POST|PATCH|PUT|DELETE)'/.test(src.replace("req.method !== 'POST'", '')), 'no writes');
  assert.ok(!/access_token|getMetaAccount/.test(src), 'no Meta token is used');
  assert.match(read('vercel.json'), /"api\/meta\/pixel-health\.js": \{ "maxDuration": 60 \}/);
});

test('the Ads tab warns about the rule and about inflated purchases', () => {
  const tab = code('src/components/manage/AdsTab.jsx');
  assert.match(tab, /fetchPixelHealth\(config\.slug, pin\)/);
  assert.match(tab, /\{pixelProblem && <PixelWarning/);
  assert.match(tab, /Meta is counting visits as \{words\}/);
  assert.match(tab, /PocketLink already tells Meta about every real order/);
  assert.match(tab, /purchaseGap\(mc\.meta\.purchases, mc\.pl\.orders\)/);
  assert.match(tab, /Judge this campaign by your orders/);
  assert.match(tab, /pixelBad=\{pixelProblem\?\.event === 'Purchase'\}/);
});

test('the Console checks every shop and lists problems under Needs attention', () => {
  const c = code('src/pages/Console.jsx');
  assert.match(c, /fetchPixelHealthAll\(\)\.then\(setPixelCheck\)/);
  assert.match(c, /Meta Pixel counts visits as \$\{eventWords\(f\.event\)\}/);
  assert.match(c, /<Panel title="Meta Pixels"/);
  assert.match(c, /\[stores, pixelCheck\]/);
  assert.match(code('src/utils/consoleService.js'), /Authorization: `Bearer \$\{token\}`[\s\S]*scope: 'all'/);
});
