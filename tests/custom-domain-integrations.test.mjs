// PR-F: payments and tracking on a shop's own domain.
//  - Razorpay takes LIVE payments only on websites registered on that account,
//    so "Pay Online" shows on the shop's domain only once the owner confirms
//    Razorpay approved it (test mode and PocketLink pages are unchanged).
//  - The server-side Meta Purchase names the shop's connected domain as the page.
//  - Links in WhatsApp templates and the order tracking page stay on PocketLink.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  onlinePayOffered, needsRazorpayApproval, razorpayApprovedHosts, razorpayTestMode, withRazorpayHost,
} from '../src/utils/domainPayments.js';
import { parseHostMarker } from '../src/utils/hostMode.js';

const read = (p) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), 'utf8').replace(/\r\n/g, '\n');
const FORM = read('src/components/form/CustomerDetailsForm.jsx');
const CARD = read('src/components/manage/DomainConnect.jsx');
const MANAGE = read('src/pages/ManageStore.jsx');
const CAPI = read('supabase/functions/meta-capi/index.ts');

const PL = parseHostMarker(undefined, 'www.pocketlink.store');
const BRAND = parseHostMarker({ slug: 'demo', base: 'https://brand.com' }, 'brand.com');
const live = (extra = {}) => ({ razorpay: true, mode: 'live', keyIdMasked: 'rzp_live_…ab12', ...extra });

test('no Razorpay: online payment is never offered, on any host', () => {
  assert.equal(onlinePayOffered(undefined, PL), false);
  assert.equal(onlinePayOffered({ razorpay: false }, BRAND), false);
});

test('PocketLink pages offer it exactly as before, approved or not', () => {
  assert.equal(onlinePayOffered(live(), PL), true);
  assert.equal(onlinePayOffered(live({ razorpayDomains: [] }), PL), true);
});

test('on the shop\'s own domain, live Razorpay waits for the owner to confirm the domain', () => {
  assert.equal(onlinePayOffered(live(), BRAND), false);
  assert.equal(onlinePayOffered(live({ razorpayDomains: ['other.com'] }), BRAND), false);
  assert.equal(onlinePayOffered(live({ razorpayDomains: ['brand.com'] }), BRAND), true);
  // Stored names are compared cleaned: case, spaces and a trailing dot do not matter.
  assert.equal(onlinePayOffered(live({ razorpayDomains: [' Brand.COM. '] }), BRAND), true);
  // www is a different website to Razorpay: approving the apex does not cover it.
  const WWW = parseHostMarker({ slug: 'demo', base: 'https://www.brand.com' }, 'www.brand.com');
  assert.equal(onlinePayOffered(live({ razorpayDomains: ['brand.com'] }), WWW), false);
});

test('Razorpay test mode is offered everywhere (test payments are not checked against the website)', () => {
  assert.equal(razorpayTestMode({ mode: 'TEST' }), true);
  assert.equal(onlinePayOffered({ razorpay: true, mode: 'test' }, BRAND), true);
  assert.equal(needsRazorpayApproval({ razorpay: true, mode: 'test' }, 'brand.com'), false);
});

test('an invalid host marker never offers online payment', () => {
  assert.equal(onlinePayOffered(live({ razorpayDomains: ['brand.com'] }), { mode: 'merchant', slug: 'demo', base: 'not a url' }), false);
});

test('the confirmed list: add, remove, no duplicates, junk dropped, other payment fields kept', () => {
  const p = live({ razorpayDomains: ['brand.com', 'BRAND.com', 'bad host', '', null] });
  assert.deepEqual(razorpayApprovedHosts(p), ['brand.com']);
  const added = withRazorpayHost(p, 'www.brand.com', true);
  assert.deepEqual(added.razorpayDomains, ['brand.com', 'www.brand.com']);
  assert.equal(added.razorpay, true);
  assert.equal(added.keyIdMasked, 'rzp_live_…ab12');
  assert.deepEqual(withRazorpayHost(added, 'BRAND.COM', false).razorpayDomains, ['www.brand.com']);
  assert.deepEqual(withRazorpayHost(live(), 'not a host!', true).razorpayDomains, []);
  assert.deepEqual(withRazorpayHost(null, 'brand.com', true), { razorpayDomains: ['brand.com'] });
});

test('checkout asks the one helper, and clears a remembered "Pay Online" the page does not offer', () => {
  assert.match(FORM, /const onlineAvailable = onlinePayOffered\(config\.payments\);/);
  assert.ok(!/const onlineAvailable = Boolean\(config\.payments\?\.razorpay\)/.test(FORM), 'the old unconditional check is gone');
  assert.match(FORM, /if \(formData\.paymentMethod === 'online' && !onlineAvailable\) onChange\(\{ \.\.\.formData, paymentMethod: '' \}\);/);
});

test('the domain card: Razorpay steps until confirmed, then "on", and the Meta allow-list note', () => {
  assert.match(CARD, /Account &amp; Settings → Business website detail → Add additional\s+website\/app/);
  assert.match(CARD, /href="https:\/\/dashboard\.razorpay\.com\/" target="_blank" rel="noopener noreferrer"/);
  assert.match(CARD, /onPayments\?\.\(withRazorpayHost\(payments, host, true\)\)/);
  assert.match(CARD, /onPayments\?\.\(withRazorpayHost\(payments, host, false\)\)/);
  assert.match(CARD, /Online payments are on for/);
  assert.match(CARD, /Traffic permissions in Meta Events Manager/);
  // Shown only on a live, served domain; test-mode Razorpay needs nothing.
  assert.match(CARD, /\{res\?\.serving !== false && \(\n\s*<OnYourDomain /);
  assert.match(CARD, /const razorpayLive = Boolean\(payments\?\.razorpay\) && !razorpayTestMode\(payments\);/);
  // Settings saves the confirmation like any other setting.
  assert.match(MANAGE, /payments=\{config\.payments\} onPayments=\{\(payments\) => update\(\{ payments \}\)\}/);
  assert.match(MANAGE, /hasPixel=\{Boolean\(config\.metaPixelId \|\| config\.meta\?\.pixelId\)\}/);
});

test('Meta CAPI: event_source_url is the connected domain, else the PocketLink page', () => {
  assert.ok(!CAPI.includes('event_source_url: `https://www.pocketlink.store/${order.store_slug}`'), 'no longer hard-coded');
  assert.match(CAPI, /event_source_url: sourceUrl,/);
  assert.match(CAPI, /supabase\.rpc\('store_primary_host', \{ p_slug: slug \}\)/);
  assert.match(CAPI, /if \(!error && host\.length <= 253 && HOSTNAME\.test\(host\)\) return `https:\/\/\$\{host\}\/`;/);
  assert.match(CAPI, /const pocketlink = `https:\/\/www\.pocketlink\.store\/\$\{slug\}`;/);
  assert.match(CAPI, /catch \{ \/\* fall back to the PocketLink page \*\/ \}/);
});

test('the CAPI host check accepts real hostnames only', () => {
  const src = CAPI.match(/const HOSTNAME = (\/.+\/);/)[1];
  const HOSTNAME = new Function(`return ${src}`)();
  for (const ok of ['brand.com', 'shop.brand.co.in', 'poketlink.app', 'xn--80ak6aa92e.com']) assert.ok(HOSTNAME.test(ok), ok);
  for (const bad of ['', 'localhost', 'brand', '-brand.com', 'brand.com/x', 'brand .com', 'BRAND.COM', 'a..b']) assert.ok(!HOSTNAME.test(bad), bad);
});
