// Checkout shadow instrumentation: the observation must be incapable of
// touching the checkout it observes.
//
// sendShadowOrder is plain JS and is executed here for real — fetch is stubbed
// at globalThis, no network. The call SITE lives in a React component that
// cannot be rendered in this suite, so its properties are pinned against the
// source: unawaited, after the save, guarded by the saved id, and its result
// discarded. Between the two, every requirement is covered by something that
// fails when it stops being true.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { sendShadowOrder, shadowLinesFromCart, SHADOW_TIMEOUT_MS } from '../src/utils/orderShadow.js';

// The storefront builds the URL from its Vite environment, which does not exist
// under the test runner; passing it explicitly exercises the real request path
// rather than the "not configured, do nothing" short-circuit.
const ENDPOINT = 'https://test.local/functions/v1/order-create';

const read = (p) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), 'utf8');
const FORM   = read('src/components/form/CustomerDetailsForm.jsx');
const SHADOW = read('src/utils/orderShadow.js');

const realFetch = globalThis.fetch;
test.afterEach(() => { globalThis.fetch = realFetch; });

const CONFIG = {
  slug: 'royalfoodsmasale',
  products: [
    { id: '101', name: 'Amti Premix', price: 270 },
    { id: '105', name: 'Pickle',
      variants: { label: 'Size', options: [{ name: '250g', price: 120 }, { name: '1kg', price: 400 }] },
      variantExtras: [{ label: 'Heat', options: [{ name: 'Mild' }, { name: 'Hot', addPrice: 20 }] }] },
    { id: '107', name: 'Gift Box',
      variantExtras: [{ label: 'Wrap', options: [{ name: 'Plain' }, { name: 'Ribbon', addPrice: 30 }] }] },
  ],
};

const CART = [
  { id: '101', name: 'Amti Premix', price: 270, qty: 2 },
  { id: '105::1kg::Hot', name: 'Pickle', price: 420, qty: 1,
    variantSelections: [{ label: 'Size', name: '1kg' }, { label: 'Heat', name: 'Hot' }] },
  { id: '107::Ribbon', name: 'Gift Box', price: 530, qty: 1,
    variantSelections: [{ label: 'Wrap', name: 'Ribbon' }] },
];

const ARGS = {
  slug: 'royalfoodsmasale', cart: CART, config: CONFIG,
  customer: { name: 'Asha', phone: '9175187668', destination: 'Mumbai', pincode: '400093' },
  paymentMethod: 'cod', couponCode: 'SAVE10', notes: 'ring the bell',
  observedOrderId: '96c1dd73-29c5-4f06-9a64-40dd150fcca7',
  attribution: { fbp: 'fb.1.x', fbc: null, ua: 'Chrome/152' },
  endpoint: ENDPOINT,
};

/** Capture what would go over the wire. */
function captureFetch(impl) {
  const seen = { calls: 0, url: null, body: null, init: null };
  globalThis.fetch = async (url, init) => {
    seen.calls += 1; seen.url = String(url); seen.init = init;
    seen.body = JSON.parse(init.body);
    return impl ? impl() : { ok: true, status: 200, json: async () => ({ ok: true }) };
  };
  return seen;
}

// ── what is sent ─────────────────────────────────────────────────────────────

test('it sends identifiers, selections and quantities — never prices', () => {
  const seen = captureFetch();
  sendShadowOrder(ARGS);
  const json = JSON.stringify(seen.body);
  for (const forbidden of ['price', 'mrp', 'total', 'subtotal', 'tax', 'shipping',
                           'packaging', 'codFee', 'discount', 'gstRate', 'cost']) {
    assert.equal(json.includes(`"${forbidden}"`), false, `${forbidden} must not be sent`);
  }
  assert.deepEqual(seen.body.lines, [
    { productId: '101', variant: null,  extras: [],       qty: 2 },
    { productId: '105', variant: '1kg', extras: ['Hot'],  qty: 1 },
    { productId: '107', variant: null,  extras: ['Ribbon'], qty: 1 },
  ]);
});

test('the price-driving variant is split from the extras using the store config', () => {
  // 105 has priced variants, so the first pick is the variant; 107 has none, so
  // every pick belongs to an extras group. Getting this backwards would make the
  // server resolve a different option than the customer chose.
  const lines = shadowLinesFromCart(CART, CONFIG);
  assert.deepEqual([lines[1].variant, lines[1].extras], ['1kg', ['Hot']]);
  assert.deepEqual([lines[2].variant, lines[2].extras], [null, ['Ribbon']]);
});

test('it carries the rest of the reviewed schema', () => {
  const seen = captureFetch();
  sendShadowOrder(ARGS);
  assert.equal(seen.url.endsWith('/functions/v1/order-create'), true);
  assert.equal(seen.body.slug, 'royalfoodsmasale');
  assert.equal(seen.body.mode, 'order');
  assert.equal(seen.body.paymentMethod, 'cod');
  assert.equal(seen.body.couponCode, 'SAVE10');
  assert.equal(seen.body.notes, 'ring the bell');
  assert.deepEqual(seen.body.customer,
    { name: 'Asha', phone: '9175187668', destination: 'Mumbai', pincode: '400093' });
  assert.deepEqual(seen.body.attribution, { fbp: 'fb.1.x', fbc: null, ua: 'Chrome/152' });
  assert.match(seen.body.idempotencyKey, /.{8,}/);
});

test('every call gets a fresh idempotency key', () => {
  const keys = new Set();
  for (let i = 0; i < 5; i++) {
    const seen = captureFetch();
    sendShadowOrder(ARGS);
    keys.add(seen.body.idempotencyKey);
  }
  assert.equal(keys.size, 5);
});

test('observedOrderId is exactly what the caller passes, and is required', () => {
  const seen = captureFetch();
  sendShadowOrder(ARGS);
  assert.equal(seen.body.observedOrderId, ARGS.observedOrderId);

  const none = captureFetch();
  sendShadowOrder({ ...ARGS, observedOrderId: null });
  assert.equal(none.calls, 0, 'no saved order, no observation');
});

test('an empty cart sends nothing', () => {
  const seen = captureFetch();
  sendShadowOrder({ ...ARGS, cart: [] });
  assert.equal(seen.calls, 0);
});

// ── it cannot break the checkout ─────────────────────────────────────────────

test('it resolves when the server succeeds', async () => {
  captureFetch();
  await assert.doesNotReject(() => sendShadowOrder(ARGS));
});

test('it resolves when the server returns 400 or 500', async () => {
  for (const status of [400, 500]) {
    captureFetch(() => ({ ok: false, status, json: async () => ({ error: 'nope' }) }));
    await assert.doesNotReject(() => sendShadowOrder(ARGS), `status ${status}`);
  }
});

test('it resolves when the network fails outright', async () => {
  captureFetch(() => { throw new TypeError('Failed to fetch'); });
  await assert.doesNotReject(() => sendShadowOrder(ARGS));
});

test('it resolves when the request times out', async () => {
  // A fetch that never settles until it is aborted, as a hung endpoint behaves.
  globalThis.fetch = (url, init) => new Promise((_, reject) => {
    init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
  });
  const t0 = Date.now();
  await assert.doesNotReject(() => sendShadowOrder({ ...ARGS, timeoutMs: 30 }));
  assert.ok(Date.now() - t0 < 2000, 'and it gives up quickly');
});

test('it resolves when building the request would throw', async () => {
  captureFetch();
  const hostile = { ...ARGS, cart: [{ get id() { throw new Error('boom'); }, qty: 1 }] };
  await assert.doesNotReject(() => sendShadowOrder(hostile));
});

test('it resolves even with no fetch at all in the environment', async () => {
  globalThis.fetch = undefined;
  await assert.doesNotReject(() => sendShadowOrder(ARGS));
});

test('the response is never read', () => {
  // Not parsed, not inspected, not returned: nothing downstream can depend on it.
  assert.equal(/\.json\(\)|\.text\(\)|res\.|response\./.test(SHADOW), false);
  assert.match(SHADOW, /\.then\(\(\) => undefined, \(\) => undefined\)/);
});

test('it has a timeout, and the timer is always cleared', () => {
  assert.equal(typeof SHADOW_TIMEOUT_MS, 'number');
  assert.ok(SHADOW_TIMEOUT_MS > 0 && SHADOW_TIMEOUT_MS <= 10000);
  assert.match(SHADOW, /finally\(\(\) => \{ if \(timer\) clearTimeout\(timer\); \}\)/);
});

// ── the call site, pinned against the component source ───────────────────────

test('checkout fires it AFTER the order is saved, and only then', () => {
  const at = FORM.indexOf('void sendShadowOrder(');
  assert.ok(at > -1, 'the call must exist');
  assert.ok(FORM.indexOf('saved = await saveOrder(') < at, 'after the save');
  assert.ok(FORM.lastIndexOf('if (saved) {', at) > -1, 'guarded by the saved id');
});

test('checkout does not await it, and discards what it returns', () => {
  // `void` is the whole point: no latency, and no value to depend on.
  assert.match(FORM, /void sendShadowOrder\(\{/);
  assert.equal(/await sendShadowOrder|= sendShadowOrder|shadow\s*=/.test(FORM), false);
});

test('observedOrderId is the id this checkout wrote, never user input', () => {
  const call = FORM.slice(FORM.indexOf('void sendShadowOrder('), FORM.indexOf('void sendShadowOrder(') + 900);
  assert.match(call, /observedOrderId: saved,/);
  // `saved` is the return of saveOrder, or the retry's own order id.
  assert.match(FORM, /let saved = retry \? retry\.orderId : null;/);
  assert.match(FORM, /saved = await saveOrder\(sendData, cart, effConfig, appliedCoupon, orderId, confirmToken\);/);
  assert.equal(/observedOrderId:\s*(formData|body|req|props|params)/.test(FORM), false);
});

test('checkout sends no prices to the shadow endpoint', () => {
  const call = FORM.slice(FORM.indexOf('void sendShadowOrder('), FORM.indexOf('void sendShadowOrder(') + 900);
  for (const forbidden of ['finalTotal', 'orderRow.total', 'price', 'subtotal', 'total:']) {
    assert.equal(call.includes(forbidden), false, `${forbidden} must not be passed`);
  }
});

// ── the existing paths are untouched ─────────────────────────────────────────

test('the order is still saved exactly as before, and payment still gated on it', () => {
  assert.match(FORM, /saved = await saveOrder\(sendData, cart, effConfig, appliedCoupon, orderId, confirmToken\);/);
  assert.match(FORM, /if \(!saved && formData\.paymentMethod === 'online'\) \{[\s\S]{0,200}setPayError\([\s\S]{0,200}return;/);
});

test('online payment still runs after the save, unchanged', () => {
  const save = FORM.indexOf('saved = await saveOrder(');
  const pay  = FORM.indexOf('await payOnline(');
  const shadow = FORM.indexOf('void sendShadowOrder(');
  assert.ok(save < shadow && shadow < pay, 'the observation sits between them and blocks neither');
  assert.match(FORM, /const result = await payOnline\(\{/);
});

test('COD, notifications, stock and the safety net are untouched', () => {
  assert.match(FORM, /sendOrderNotifications\(\{/);
  assert.match(FORM, /order:\s*orderRow,/, 'the safety net still carries the saved row');
  assert.equal(/decrement|stock/i.test(FORM.slice(FORM.indexOf('void sendShadowOrder('),
                                                 FORM.indexOf('void sendShadowOrder(') + 900)), false);
});

test('the shadow module does not touch orders, payments or the writer', () => {
  for (const forbidden of ['create_order_secure', "from('orders')", 'payments-', 'razorpay',
                           'shipping', 'meta-capi']) {
    assert.equal(SHADOW.includes(forbidden), false, `${forbidden} must not appear`);
  }
});
