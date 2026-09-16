// The two fingerprints, and the idempotency contract they carry.
//
//   request_fingerprint  binds the complete order INTENT. Computed in JS here,
//                        compared (never recomputed) in SQL.
//   config_fingerprint   binds the authoritative pricing inputs. Computed only
//                        in SQL, carried through JS as an opaque string.
//
// Neither is computed twice anywhere in the system; these tests hold that line.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { canonicalRequest, requestFingerprint, sha256Hex } from '../shared/pricing.mjs';

const read = (p) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), 'utf8');
const FWD    = read('supabase/order-integrity-phase2-forward.sql');
const SHADOW = read('supabase/functions/order-create/index.ts');
const ENGINE = read('shared/pricing.mjs');

const BASE = {
  slug: 'royalfoodsmasale',
  mode: 'order',
  paymentMethod: 'cod',
  couponCode: 'SAVE10',
  notes: 'ring the bell',
  customer: { name: 'Asha Patil', phone: '9175187668', destination: 'Mumbai', pincode: '400093' },
  lines: [
    { productId: '101', variant: null, extras: [], qty: 2 },
    { productId: '105', variant: '1kg', extras: ['Hot', 'Pack of 3'], qty: 1 },
  ],
};
const fp = (o) => requestFingerprint(o);

// ── what the request fingerprint binds ───────────────────────────────────────

test('the same intent always produces the same fingerprint', async () => {
  assert.equal(await fp(BASE), await fp(structuredClone(BASE)));
});

test('every field that lands on the order changes it', async () => {
  const base = await fp(BASE);
  const changes = [
    ['slug',        { ...BASE, slug: 'otherstore' }],
    ['mode',        { ...BASE, mode: 'abandoned' }],
    ['payment',     { ...BASE, paymentMethod: 'online' }],
    ['coupon',      { ...BASE, couponCode: 'FLAT50' }],
    ['notes',       { ...BASE, notes: 'leave at door' }],
    ['name',        { ...BASE, customer: { ...BASE.customer, name: 'Asha P' } }],
    ['phone',       { ...BASE, customer: { ...BASE.customer, phone: '9999999999' } }],
    ['destination', { ...BASE, customer: { ...BASE.customer, destination: 'Pune' } }],
    ['pincode',     { ...BASE, customer: { ...BASE.customer, pincode: '411001' } }],
    ['productId',   { ...BASE, lines: [{ ...BASE.lines[0], productId: '102' }, BASE.lines[1]] }],
    ['variant',     { ...BASE, lines: [BASE.lines[0], { ...BASE.lines[1], variant: '250g' }] }],
    ['extras',      { ...BASE, lines: [BASE.lines[0], { ...BASE.lines[1], extras: ['Mild', 'Pack of 3'] }] }],
    ['qty',         { ...BASE, lines: [{ ...BASE.lines[0], qty: 3 }, BASE.lines[1]] }],
    ['added line',  { ...BASE, lines: [...BASE.lines, { productId: '102', variant: null, extras: [], qty: 1 }] }],
    ['dropped line',{ ...BASE, lines: [BASE.lines[0]] }],
  ];
  for (const [what, variant] of changes) {
    assert.notEqual(await fp(variant), base, `${what} must change the fingerprint`);
  }
});

test('the order of extras within a line is significant', async () => {
  // Position maps to the config's variantExtras groups: Hot+Pack is not the
  // same order as Pack+Hot, and pricing would differ.
  const swapped = { ...BASE, lines: [BASE.lines[0], { ...BASE.lines[1], extras: ['Pack of 3', 'Hot'] }] };
  assert.notEqual(await fp(swapped), await fp(BASE));
});

test('the order of LINES is not significant — a re-sorted cart is the same intent', async () => {
  const reordered = { ...BASE, lines: [BASE.lines[1], BASE.lines[0]] };
  assert.equal(await fp(reordered), await fp(BASE));
});

test('cosmetic differences in typing do not split a retry', async () => {
  const base = await fp(BASE);
  const same = [
    ['spacing',    { ...BASE, customer: { ...BASE.customer, name: '  Asha   Patil ' } }],
    ['slug case',  { ...BASE, slug: 'RoyalFoodsMasale' }],
    ['coupon case',{ ...BASE, couponCode: 'save10' }],
    ['phone form', { ...BASE, customer: { ...BASE.customer, phone: '+91 91751 87668' } }],
  ];
  for (const [what, variant] of same) {
    assert.equal(await fp(variant), base, `${what} must NOT change the fingerprint`);
  }
});

test('attribution is deliberately outside the fingerprint', async () => {
  // A refreshed cookie or a browser update between an attempt and its retry
  // must not become an idempotency conflict — that would push the buyer into
  // placing a second order, the exact thing idempotency prevents.
  const withAttr = { ...BASE, attribution: { fbp: 'fb.1.x', fbc: 'fb.1.y', ua: 'Chrome/152' } };
  const other    = { ...BASE, attribution: { fbp: 'fb.1.z', fbc: null, ua: 'Safari/17' } };
  assert.equal(await fp(withAttr), await fp(other));
  assert.equal(await fp(withAttr), await fp(BASE));
  assert.match(ENGINE, /DELIBERATELY EXCLUDED: attribution/, 'and the reason is written down');
});

test('the idempotency key is not part of what it binds', async () => {
  const a = { ...BASE, idempotencyKey: 'aaaa' };
  const b = { ...BASE, idempotencyKey: 'bbbb' };
  assert.equal(await fp(a), await fp(b));
});

test('the canonical form is readable, versioned and hashed with SHA-256', async () => {
  const canon = canonicalRequest(BASE);
  assert.match(canon, /^req-v1\n/);
  assert.match(canon, /royalfoodsmasale/);
  assert.equal((await fp(BASE)).length, 64);
  assert.equal(await fp(BASE), await sha256Hex(canon));
});

// ── the idempotency contract, as written in SQL ──────────────────────────────

test('same key + same fingerprint returns the same order', () => {
  const fn = FWD.slice(FWD.indexOf('create or replace function public.create_order_secure'));
  assert.match(fn, /on conflict \(store_slug, idempotency_key\) do nothing/);
  assert.match(fn, /return jsonb_build_object\('order_id', v_existing\.order_id,[\s\S]{0,120}'idempotent', true\)/);
});

test('same key + different fingerprint is refused, and says nothing about the order', () => {
  const fn = FWD.slice(FWD.indexOf('create or replace function public.create_order_secure'));
  assert.match(fn, /v_existing\.request_fingerprint is distinct from p_request_fingerprint/);
  assert.match(fn, /raise exception 'idempotency_conflict'/);
  const conflictBlock = fn.slice(fn.indexOf('is distinct from p_request_fingerprint'),
                                 fn.indexOf("raise exception 'idempotency_conflict'"));
  assert.equal(/order_id|confirm_token|total/.test(conflictBlock), false,
    'a guessed key must not become a way to read somebody else\'s order');
});

test('a failed attempt never consumes its idempotency key', () => {
  const fn = FWD.slice(FWD.indexOf('create or replace function public.create_order_secure'));
  // The reservation is an INSERT inside the same transaction as every raise
  // below it, so any failure rolls it back with everything else.
  assert.ok(fn.indexOf('insert into public.order_requests') < fn.indexOf("raise exception 'config_changed'"));
  assert.ok(fn.indexOf('insert into public.order_requests') < fn.indexOf("raise exception 'out_of_stock"));
  assert.match(FWD, /a refused order never burns a key|rolls back with it/i);
});

test('SQL compares the request fingerprint and never recomputes it', () => {
  // One definition, in JS. If SQL hashed it too they would drift.
  assert.equal(/md5\([^)]*p_request_fingerprint/.test(FWD), false);
  assert.equal(/sha|digest/.test(FWD.replace(/--.*$/gm, '')) && /p_request_fingerprint/.test(FWD)
    && /digest\([^)]*request/.test(FWD), false);
});

// ── the config fingerprint is SQL's alone ────────────────────────────────────

test('the config fingerprint is computed only in SQL', () => {
  assert.match(FWD, /create or replace function public\.store_pricing_fingerprint\(p_slug text\)/);
  assert.equal(/configFingerprint\s*\(/.test(ENGINE), false, 'the JS engine must not compute one');
  assert.equal(/store_pricing_fingerprint/.test(ENGINE), false);
});

test('it binds every input that can change what a buyer owes', () => {
  const fn = FWD.slice(FWD.indexOf('create or replace function public.store_pricing_fingerprint'),
                       FWD.indexOf('revoke all on function public.store_pricing_fingerprint'));
  for (const bound of ['price', 'mrp', 'gstRate', 'taxInclusive', 'inStock', 'variants',
                       'variantExtras', 'taxRate', 'freeShippingAbove', 'shippingCharge',
                       'packagingCharge', 'codCharge', 'discountType', 'discountValue',
                       'minOrder', 'expiresAt']) {
    assert.ok(fn.includes(bound), `${bound} must be bound`);
  }
});

test('it deliberately excludes cost and stock, and the file says why', () => {
  const fn = FWD.slice(FWD.indexOf('create or replace function public.store_pricing_fingerprint'),
                       FWD.indexOf('revoke all on function public.store_pricing_fingerprint'));
  assert.equal(/'cost'/.test(fn), false, 'merchant margin cannot change what a buyer owes');
  assert.equal(/->'stock'/.test(fn), false, 'availability is checked live under the lock instead');
  assert.match(FWD, /Excluded on purpose[\s\S]{0,400}STOCK/);
  assert.match(FWD, /turn ordinary traffic into a[\s\S]{0,40}storm of retries/);
});

test('a changed config aborts the attempt rather than pricing against a stale read', () => {
  const fn = FWD.slice(FWD.indexOf('create or replace function public.create_order_secure'));
  assert.match(fn, /v_live_fp := public\.store_pricing_fingerprint\(p_store_slug\);/);
  assert.match(fn, /raise exception 'config_changed'/);
  assert.ok(fn.indexOf('for update') < fn.indexOf('store_pricing_fingerprint'),
    'the fingerprint is re-read under the lock, not before it');
  assert.ok(fn.indexOf("raise exception 'config_changed'") < fn.indexOf('insert into public.orders'),
    'and nothing is written when it moved');
});

// ── shadow mode does not participate in any of this yet ──────────────────────

test('the shadow endpoint computes a request fingerprint but writes no order', () => {
  assert.match(SHADOW, /requestFingerprint\(req0\)/);
  // The header explains that the writer is not called yet; check the code.
  const code = SHADOW.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.equal(/create_order_secure/.test(code), false, 'the writer is not called yet');
  assert.equal(/from\('orders'\)\s*\.\s*(insert|upsert|update)/.test(code), false,
    'shadow mode never writes to orders');
});
