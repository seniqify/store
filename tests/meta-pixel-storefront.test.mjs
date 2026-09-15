// Storefront pixel: events go to both of a store's pixels (the owner's and the ads
// pixel) when they differ, to one when they match, and to none for a store without.
// A fake fbq records the calls; no script loads and nothing reaches Meta.
import test from 'node:test';
import assert from 'node:assert/strict';

const calls = [];
globalThis.window = { fbq: (...args) => calls.push(args) };
const { initMetaPixel, pixelTrack } = await import('../src/utils/metaPixel.js');
const reset = () => { calls.length = 0; };
const inits = () => calls.filter((c) => c[0] === 'init').map((c) => c[1]);

test('two different pixels: both start, and both get the purchase with its event id', () => {
  reset();
  initMetaPixel(['1813709013140947', '2459328801203274']);
  pixelTrack('Purchase', { value: 1499, currency: 'INR' }, 'order-1');
  assert.deepEqual(inits(), ['1813709013140947', '2459328801203274']);
  const purchases = calls.filter((c) => c[2] === 'Purchase');
  assert.deepEqual(purchases.map((c) => c[1]), ['1813709013140947', '2459328801203274']);
  assert.ok(purchases.every((c) => c[4]?.eventID === 'order-1'), 'server events with the same id are counted once');
});

test('the same pixel twice is one pixel, and starting the same store again does nothing', () => {
  reset();
  initMetaPixel(['4378179455825363', '4378179455825363']);
  initMetaPixel(['4378179455825363']);
  assert.deepEqual(inits(), ['4378179455825363']);
});

test('a store without a pixel stops events going to the previous store\'s', () => {
  reset();
  initMetaPixel([]);
  pixelTrack('AddToCart', { value: 100 });
  assert.equal(calls.length, 0);
});

test('anything that is not a pixel id is ignored', () => {
  reset();
  initMetaPixel(['', null, 'abc', ' 1897790801105314 ']);
  assert.deepEqual(inits(), ['1897790801105314']);
});
