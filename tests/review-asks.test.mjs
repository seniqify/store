// "Ask for reviews" in the Reviews tab (founder, 2026-11-16; mockup
// 4G4RXkGPxexuUZYPDdwZeH): delivered orders listed with who was asked and who
// reviewed, and a free "send one by one" walk through them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { canAskReview, buildReviewAsks, withAsk, daysAgo, phone10, ASK_WINDOW_DAYS } from '../src/utils/reviewAsks.js';
import { reviewInviteMessage } from '../src/utils/reviewShape.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const DAY = 86400000;
const NOW = Date.parse('2026-11-16T12:00:00+05:30');
const iso = (daysBack) => new Date(NOW - daysBack * DAY).toISOString();
const order = (id, over = {}) => ({
  id, status: 'delivered', total: 540, items: [{ name: 'Misal', qty: 2 }], customer_name: `Buyer ${id}`,
  customer_phone: '9876543210', payment_method: 'cod', paid: false, delivered_at: iso(2), created_at: iso(4), ...over,
});

test('canAskReview follows the server rules (issue_review_invite)', () => {
  assert.equal(canAskReview(order('a')), true);
  assert.equal(canAskReview(order('a', { status: 'shipped' })), false, 'only delivered');
  assert.equal(canAskReview(order('a', { total: 0 })), false, 'service enquiries are ₹0');
  assert.equal(canAskReview(order('a', { items: [] })), false, 'no items');
  assert.equal(canAskReview(order('a', { payment_method: 'online', paid: false, payment_ref: null })), false, 'online, never paid');
  assert.equal(canAskReview(order('a', { payment_method: 'online', paid: true })), true);
  assert.equal(canAskReview(order('a', { customer_phone: '12345' })), false, 'no valid mobile');
  assert.equal(canAskReview(order('a', { customer_phone: '+91 98765-43210' })), true, 'any phone format');
  assert.equal(canAskReview(order('a'), ['919876543210']), false, 'the shop’s own number');
  assert.equal(phone10('+91 98765 43210'), '9876543210');
  const sql = read('supabase/reviews-verified-forward.sql');
  for (const rule of ["<> 'delivered'", 'total, 0) <= 0', "= 'online'", "'^[6-9][0-9]{9}$'", "'whatsappNumber'"]) {
    assert.ok(sql.includes(rule), `server still has: ${rule}`);
  }
});

test('the three lists: to ask (oldest first), asked waiting, reviewed; skips and old orders kept out', () => {
  const orders = [
    order('new', { delivered_at: iso(1) }),
    order('old', { delivered_at: iso(5) }),
    order('nodate', { delivered_at: null, created_at: iso(3) }),
    order('ancient', { delivered_at: iso(ASK_WINDOW_DAYS + 5) }),
    order('asked', { delivered_at: iso(6) }),
    order('done', { delivered_at: iso(9) }),
    order('skip', { delivered_at: iso(2) }),
    order('legacy', { delivered_at: iso(2) }),
    order('notyet', { status: 'shipped' }),
  ];
  const asks = [
    { order_id: 'asked', asked_at: iso(1), ask_count: 2 },
    { order_id: 'done', asked_at: iso(8), ask_count: 1 },
    { order_id: 'skip', asked_at: null, ask_count: 0, skipped_at: iso(1) },
  ];
  const reviews = [
    { order_id: 'done', rating: 5, status: 'published', submitted_at: iso(7) },
    { order_id: 'done', rating: 4, status: 'published', submitted_at: iso(7) },
    { order_id: 'legacy', rating: 5, status: 'legacy_unpublished', submitted_at: iso(1) },
  ];
  const r = buildReviewAsks(orders, asks, reviews, { now: NOW });
  assert.deepEqual(r.toAsk.map((x) => x.id), ['old', 'nodate', 'legacy', 'new'], 'oldest first; no delivery time = order time');
  assert.deepEqual(r.older.map((x) => x.id), ['ancient']);
  assert.deepEqual(r.asked.map((x) => [x.id, x.askCount]), [['asked', 2]]);
  assert.deepEqual(r.reviewed.map((x) => [x.id, x.rating, x.reviews]), [['done', 4.5, 2]]);
  assert.equal(r.skipped, 1);
  assert.equal(r.rate, 50, 'of the 2 asked, 1 reviewed');
  assert.equal(buildReviewAsks([], [], [], { now: NOW }).rate, null, 'nobody asked yet');
});

test('withAsk moves an order on the screen at once: asked, asked again, or skipped', () => {
  const at = iso(0);
  const one = withAsk([], 'x', { asked: true, at });
  assert.deepEqual(one, [{ order_id: 'x', asked_at: at, first_asked_at: at, ask_count: 1, skipped_at: null }]);
  const again = withAsk(one, 'x', { asked: true, at: 'later' });
  assert.equal(again[0].ask_count, 2);
  assert.equal(again[0].first_asked_at, at);
  const skipped = withAsk([], 'y', { skipped: true, at });
  assert.deepEqual(buildReviewAsks([order('y')], skipped, [], { now: NOW }).toAsk, []);
  assert.deepEqual(buildReviewAsks([order('x')], one, [], { now: NOW }).asked.map((x) => x.id), ['x']);
});

test('daysAgo says it like a person', () => {
  assert.equal(daysAgo(NOW, NOW), 'today');
  assert.equal(daysAgo(NOW - DAY, NOW), 'yesterday');
  assert.equal(daysAgo(NOW - 4 * DAY, NOW), '4 days ago');
  assert.equal(daysAgo(null, NOW), '');
});

test('the message in मराठी: first name, the shop, the link, no emoji; English unchanged', () => {
  const mr = reviewInviteMessage({ customerName: 'Amit Deshmukh', storeName: 'Shop', link: 'https://x/review/t', lang: 'mr' });
  assert.match(mr, /^नमस्कार Amit, \*Shop\* कडून ऑर्डर केल्याबद्दल धन्यवाद\./);
  assert.match(mr, /https:\/\/x\/review\/t/);
  assert.match(mr, /ही लिंक फक्त तुमच्या ऑर्डरसाठी आहे\.$/);
  assert.ok(!/\p{Extended_Pictographic}/u.test(mr), 'no emoji');
  const en = reviewInviteMessage({ customerName: 'Amit Deshmukh', storeName: 'Shop', link: 'L' });
  assert.match(en, /^Hi Amit, thank you for your order from \*Shop\*\./);
  assert.equal(reviewInviteMessage({ customerName: 'Amit', storeName: 'Shop', link: 'L', lang: 'en' }), reviewInviteMessage({ customerName: 'Amit', storeName: 'Shop', link: 'L' }));
});

test('SQL: additive only, PIN-checked, the table closed to the browser, a full undo', () => {
  const fwd = read('supabase/review-asks-forward.sql');
  assert.match(fwd, /^begin;$/m);
  assert.match(fwd, /^commit;$/m);
  assert.match(fwd, /raise exception 'preflight: public\.review_invites missing/);
  assert.equal((fwd.match(/if not public\.verify_store_pin\(p_slug, p_hashed_pin\) then/g) || []).length, 2);
  assert.match(fwd, /alter table public\.review_ask_skips enable row level security;/);
  assert.match(fwd, /revoke all on public\.review_ask_skips from public, anon, authenticated;/);
  assert.match(fwd, /revoke all on function public\.get_review_asks\(text, text\)\s+from public, anon, authenticated;/);
  assert.match(fwd, /grant execute on function public\.set_review_ask_skip\(text, text, uuid, boolean\) to anon, authenticated, service_role;/);
  assert.match(fwd, /o\.id = p_order_id and o\.store_slug = p_slug/, 'only this store’s orders');
  // Nothing that exists today is changed.
  assert.ok(!/\b(drop|alter function|issue_review_invite|get_owner_reviews)\b/i.test(fwd.replace(/--.*$/gm, '')));
  // No token, phone or name leaves: order ids and times only.
  assert.match(fwd, /order_id uuid, asked_at timestamptz, first_asked_at timestamptz,\n\s+ask_count integer, skipped_at timestamptz\)/);
  const undo = read('supabase/review-asks-ROLLBACK.sql');
  for (const d of ['drop function if exists public.get_review_asks(text, text);',
                   'drop function if exists public.set_review_ask_skip(text, text, uuid, boolean);',
                   'drop table if exists public.review_ask_skips;']) assert.ok(undo.includes(d), d);
  const verify = read('supabase/review-asks-verify.sql');
  for (const n of ['A1', 'A2', 'A3', 'A4', 'A5']) assert.match(verify, new RegExp(`'${n} `));
});

test('the Reviews tab lists who to ask and opens WhatsApp inside the tap', () => {
  const tab = read('src/components/manage/ReviewsTab.jsx');
  assert.match(tab, /<ReviewAsks data=\{askData\} error=\{asksError\}/);
  assert.match(tab, /fetchOrders\(slug, pin\), fetchReviewAsks\(slug, pin\)/);
  assert.match(tab, /askRef\.current\?\.scrollIntoView/);
  assert.match(read('src/pages/ManageStore.jsx'), /<ReviewsTab [^>]*products=\{config\.products \|\| \[\]\} shopPhones=\{\[config\.whatsappNumber, config\.ownerPhone\]\} \/>/);
  const asks = read('src/components/manage/ReviewAsks.jsx');
  const open = asks.slice(asks.indexOf('async function openReviewAsk'));
  assert.ok(open.indexOf("window.open('', '_blank')") < open.indexOf('await createReviewInvite'), 'the tab opens before the await');
  assert.match(asks, /https:\/\/wa\.me\/91\$\{phone10\(o\.customer_phone\)\}/);
  assert.match(asks, /Send one by one · free/);
  assert.match(asks, /await setReviewAskSkip\(slug, pin, cur\.o\.id, true\)/);
  // A failed read never shows everyone as "to ask".
  assert.match(tab, /orders && asks && rows && !asksError/);
});
