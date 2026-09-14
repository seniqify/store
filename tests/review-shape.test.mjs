import test from 'node:test';
import assert from 'node:assert/strict';
import {
  lineProductId, toPublicReview, reviewStats, ratingsByStore, reviewLink, reviewInviteMessage,
} from '../src/utils/reviewShape.js';

test('lineProductId: plain products and variant lines map to the catalogue id', () => {
  assert.equal(lineProductId({ id: 'p1' }), 'p1');
  assert.equal(lineProductId({ id: 17 }), '17');
  assert.equal(lineProductId({ id: 'p1::Red::XL' }), 'p1');
  assert.equal(lineProductId({ id: '' }), null);
  assert.equal(lineProductId({}), null);
  assert.equal(lineProductId(null), null);
});

test('toPublicReview keeps the field names older components read', () => {
  const r = toPublicReview({
    id: 'r1', display_name: 'Asha', rating: 4, body: 'Soft towels', submitted_at: '2026-09-14T10:00:00Z',
    verified_purchase: true, product_id: 'p1', item_name: 'Towel', variant: 'Blue',
    merchant_reply: 'Thanks!', merchant_replied_at: '2026-09-14T11:00:00Z', edit_count: 1,
  });
  assert.equal(r.customer_name, 'Asha');
  assert.equal(r.comment, 'Soft towels');
  assert.equal(r.created_at, '2026-09-14T10:00:00Z');
  assert.equal(r.verified, true);
  assert.equal(r.productId, 'p1');
  assert.equal(r.reply, 'Thanks!');
  assert.equal(r.edited, true);
});

test('toPublicReview never marks a review verified unless the server said so', () => {
  assert.equal(toPublicReview({ verified_purchase: 'true' }).verified, false);
  assert.equal(toPublicReview({}).verified, false);
  assert.equal(toPublicReview({}).customer_name, 'Customer');
});

test('reviewStats counts every rating, low ones included', () => {
  assert.deepEqual(reviewStats([]), { avg: 0, count: 0 });
  assert.deepEqual(reviewStats([{ rating: 5 }, { rating: 1 }, { rating: 4 }]), { avg: 3.3, count: 3 });
});

test('ratingsByStore groups by store and skips rows without a store', () => {
  assert.deepEqual(
    ratingsByStore([{ store_slug: 'a', rating: 5 }, { store_slug: 'a', rating: 4 }, { store_slug: 'b', rating: 2 }, { rating: 5 }]),
    { a: { avg: 4.5, count: 2 }, b: { avg: 2, count: 1 } },
  );
});

test('reviewLink builds the /review/<token> page URL', () => {
  assert.equal(reviewLink('https://www.pocketlink.store/', 'abc'), 'https://www.pocketlink.store/review/abc');
  assert.equal(reviewLink('', 'abc'), 'https://www.pocketlink.store/review/abc');
});

test('reviewInviteMessage: first name, the link, no emoji', () => {
  const msg = reviewInviteMessage({ customerName: 'Rahul Patil', storeName: 'Solapur Chaddar', link: 'https://x/review/t' });
  assert.match(msg, /^Hi Rahul,/);
  assert.match(msg, /\*Solapur Chaddar\*/);
  assert.ok(msg.includes('https://x/review/t'));
  assert.equal(/\p{Extended_Pictographic}/u.test(msg), false);
  assert.match(reviewInviteMessage({ link: 'L' }), /^Hi, thank you/);
});
