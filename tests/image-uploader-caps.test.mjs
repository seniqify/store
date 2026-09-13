// Guards the upload caps that made HD product photos blurry.
//
// An audit of 569 stored product images (2026-09-13) found 330 at 400px or less:
// every variant photo, because ManageStore passed maxDim={400} to the variant
// uploader — and the first variant is preselected, so that 400px photo is what
// the grid and the full-width product page lead with. These read the source so a
// future edit cannot quietly shrink a cap again.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (p) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), 'utf8');
const MANAGE = read('src/pages/ManageStore.jsx');
const ONBOARD = read('src/components/onboarding/StepProducts.jsx');
const STRINGS = read('src/i18n/strings.js');

test('no uploader in Manage is capped below the product size', () => {
  const caps = [...MANAGE.matchAll(/<ImageUploader\b[^>]*?maxDim=\{(\d+)\}/g)].map((m) => Number(m[1]));
  for (const c of caps) {
    assert.ok(c >= 1200, `found a literal maxDim={${c}} — use PRODUCT_MAX_DIM, LOGO_MAX_DIM or the 1600 cover cap`);
  }
});

test('the variant photo uploader uses the product cap', () => {
  assert.match(MANAGE, /<ImageUploader compact maxDim=\{PRODUCT_MAX_DIM\}[^>]*value=\{o\.image\}/);
  assert.equal(/maxDim=\{400\}/.test(MANAGE), false, 'the 400px variant cap is back');
});

test('gallery photos use the product cap', () => {
  assert.match(MANAGE, /<ImageUploader key=\{i\} compact maxDim=\{PRODUCT_MAX_DIM\}/);
});

test('both uploaders share one compressor rather than their own copies', () => {
  for (const [name, src] of [['ManageStore', MANAGE], ['StepProducts', ONBOARD]]) {
    assert.match(src, /from '\.\.\/(\.\.\/)?utils\/imageCompress'/, `${name} must import the shared helper`);
    assert.equal(/canvas\.toDataURL\('image\/jpeg', 0\.82\)/.test(src), false,
      `${name} still has its own one-jump 0.82 compressor`);
  }
});

test('product photos are flagged when they are the legacy low-res size', () => {
  // 268 main photos were stored at 400px before July; the originals never left
  // the merchant's phone, so the only fix is re-uploading — which the flag prompts.
  // Not [^>]*: the onChange arrow function (`v => …`) contains a ">".
  assert.match(MANAGE, /value=\{form\.image\}[\s\S]{0,160}?lowResWarnBelow=\{500\} lowResBy="long"/);
  assert.match(MANAGE, /value=\{o\.image\}/);
});

test('a numeric low-res state never renders a stray 0', () => {
  // `{lowRes && …}` with lowRes === 0 renders the character "0" in React.
  assert.equal(/\{lowRes && /.test(MANAGE), false);
});

test('the upload hint no longer promises 400px in any language', () => {
  assert.equal(/400\s?px/.test(STRINGS), false, 'img.formats still says 400px');
  assert.equal((STRINGS.match(/1200\s?px/g) || []).length, 3, 'en, hi and mr should all say 1200px');
});
