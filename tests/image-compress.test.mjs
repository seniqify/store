// Photo sizing before upload. The canvas work needs a browser, but the numbers
// that decided whether a photo came out sharp are plain arithmetic, so they are
// pinned here.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  targetSize, downscaleSteps, PRODUCT_MAX_DIM, LOGO_MAX_DIM, JPEG_QUALITY,
} from '../src/utils/imageCompress.js';

test('product photos are kept large enough for the product page', () => {
  // The detail page shows a square up to 512 CSS px. A 3x phone needs ~1170
  // device pixels; 800 was upscaled and soft, 400 was blurry.
  assert.ok(PRODUCT_MAX_DIM >= 1170, `cap ${PRODUCT_MAX_DIM} is below what a 3x phone displays`);
});

test('JPEG quality did not go down', () => {
  assert.ok(JPEG_QUALITY >= 0.82 && JPEG_QUALITY <= 0.95);
});

test('a landscape camera photo is capped on its longest side', () => {
  assert.deepEqual(targetSize(4000, 3000, 1200), { width: 1200, height: 900 });
});

test('a portrait photo is capped on its longest side too', () => {
  assert.deepEqual(targetSize(3024, 4032, 1200), { width: 900, height: 1200 });
});

test('a photo already under the cap is never upscaled', () => {
  assert.deepEqual(targetSize(640, 480, 1200), { width: 640, height: 480 });
  assert.deepEqual(targetSize(1200, 1200, 1200), { width: 1200, height: 1200 });
});

test('a square photo stays square', () => {
  assert.deepEqual(targetSize(5000, 5000, 1200), { width: 1200, height: 1200 });
});

test('an extreme aspect ratio never collapses to zero pixels', () => {
  const t = targetSize(12000, 5, 1200);
  assert.equal(t.width, 1200);
  assert.ok(t.height >= 1);
});

test('an unreadable size yields nothing to draw', () => {
  assert.deepEqual(targetSize(0, 100, 1200), { width: 0, height: 0 });
  assert.deepEqual(targetSize(NaN, 100, 1200), { width: 0, height: 0 });
});

test('a large reduction is drawn in steps of at most 2x', () => {
  // The old code drew 4000 -> 800 in one jump. Each step here halves at most.
  const steps = downscaleSteps(4000, 3000, 1200, 900);
  let w = 4000, h = 3000;
  for (const s of steps) {
    assert.ok(w / s.width <= 2.0001 && h / s.height <= 2.0001,
      `a ${w}x${h} -> ${s.width}x${s.height} step reduces more than 2x`);
    w = s.width; h = s.height;
  }
  assert.deepEqual(steps[steps.length - 1], { width: 1200, height: 900 });
});

test('the steps for a 4000px photo are halve, then finish', () => {
  assert.deepEqual(downscaleSteps(4000, 3000, 1200, 900), [
    { width: 2000, height: 1500 },
    { width: 1200, height: 900 },
  ]);
});

test('a small reduction is a single draw', () => {
  assert.deepEqual(downscaleSteps(1500, 1000, 1200, 800), [{ width: 1200, height: 800 }]);
});

test('no reduction still re-encodes once at the same size', () => {
  assert.deepEqual(downscaleSteps(640, 480, 640, 480), [{ width: 640, height: 480 }]);
});

test('a target reached exactly by halving is not drawn twice', () => {
  assert.deepEqual(downscaleSteps(2400, 2400, 1200, 1200), [{ width: 1200, height: 1200 }]);
});

test('logos keep a smaller cap than product photos', () => {
  assert.ok(LOGO_MAX_DIM < PRODUCT_MAX_DIM);
});
