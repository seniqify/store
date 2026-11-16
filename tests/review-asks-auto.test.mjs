// "Ask automatically" and "Ask all" (founder, 2026-11-16: "i want exactly how to
// did in mockup"; mockup 4G4RXkGPxexuUZYPDdwZeH). PocketLink sends the review
// request from its WhatsApp, 1 Coin each; the shop's free "Send one by one" is
// tests/review-asks.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { reviewAskMessage, REVIEW_ASK_TEXT } from '../src/utils/reviewAskText.js';
import { askSourceLabel, orderImage, withAsk } from '../src/utils/reviewAsks.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const code = (s) => s.replace(/--.*$/gm, '');
const md5 = (s) => createHash('md5').update(s.replace(/\r/g, '')).digest('hex');
const body = (src, name, from = 0) => {
  const i = src.indexOf(`function public.${name}(`, from);
  const a = src.indexOf('as $function$', i) + 'as $function$'.length;
  return src.slice(a, src.indexOf('$function$;', a));
};
const FWD = read('supabase/review-asks-auto-forward.sql');
const NOW_FN = read('supabase/functions/review-asks-now/index.ts');
const SWEEP = read('supabase/functions/review-asks/index.ts');

test('the message: name, shop and item in that order, both languages, the same fallbacks as the senders', () => {
  for (const l of ['en', 'mr']) {
    const b = REVIEW_ASK_TEXT[l].body;
    assert.ok(b.indexOf('{{1}}') < b.indexOf('{{2}}') && b.indexOf('{{2}}') < b.indexOf('{{3}}'), `${l}: blanks in order`);
    assert.ok(!/\p{Extended_Pictographic}/u.test(b), `${l}: no emoji`);
  }
  const en = reviewAskMessage('en', { name: 'Amit Deshmukh', store: 'Shop', item: 'Sherwa' });
  assert.equal(en.text, 'Hi Amit, your order from Shop has been delivered.\n\nHow was your Sherwa? Please give it a rating. It takes 30 seconds and helps other customers.');
  assert.equal(en.button, 'Rate my order');
  const mr = reviewAskMessage('mr', { name: 'Amit', store: 'Shop', item: 'Sherwa' });
  assert.match(mr.text, /^नमस्कार Amit, Shop कडून तुमची ऑर्डर पोहोचली आहे\./);
  assert.equal(mr.button, 'रेटिंग द्या');
  assert.match(reviewAskMessage('mr', {}).text, /^नमस्कार ग्राहक, आमचे दुकान कडून/);
  assert.match(reviewAskMessage('en', {}).text, /^Hi there, your order from our shop/);
  // The senders fill an empty part exactly like the preview does.
  for (const src of [SWEEP, NOW_FN]) {
    assert.match(src, /'1': pick\(c\.name, 'there', 'ग्राहक'\)/);
    assert.match(src, /'2': pick\(c\.store, 'our shop', 'आमचे दुकान'\)/);
    assert.match(src, /'3': pick\(c\.item, 'order', 'ऑर्डर'\)/);
    assert.match(src, /'4': String\(c\.link\)/);
  }
});

test('the sweep: its own secret, nothing claimed or charged until the template is set, the language recorded', () => {
  assert.match(SWEEP, /\.from\('automation_secrets'\)\.select\('secret'\)\.eq\('name', 'review-asks'\)/);
  assert.ok(SWEEP.indexOf("return json({ skipped: 'not_configured' })") < SWEEP.indexOf("rpc('review_ask_claim'"));
  assert.match(SWEEP, /rpc\('review_ask_claim', \{ p_order_id: row\.order_id, p_source: 'auto' \}\)/);
  assert.match(SWEEP, /p_lang: useMr \? 'mr' : 'en'/);
  assert.ok(!/https:\/\/campaign/.test(SWEEP + NOW_FN), 'no template URL in code');
});

test('Ask all: PIN first, this shop’s orders only, at most 100 a call, stops when Coins or daylight run out', () => {
  assert.ok(NOW_FN.indexOf("rpc('verify_store_pin'") < NOW_FN.indexOf('SENIQIFY_REVIEW_ASK_TEMPLATE_URL'));
  assert.match(NOW_FN, /if \(body\.check\) return json\(\{ ready: Boolean\(templateUrl\), ready_mr: Boolean\(mrUrl\) \}\);/);
  assert.match(NOW_FN, /p_order_id: id, p_source: 'all', p_slug: slug, p_lang: lang,/);
  assert.match(NOW_FN, /const MAX_PER_CALL = 100;/);
  assert.match(NOW_FN, /if \(reason === 'no_balance' \|\| reason === 'night'\) \{ result\.more = false; break; \}/);
  assert.match(NOW_FN, /filter\(\(x\) => UUID\.test\(x\)\)/);
});

test('SQL: replaces get_review_asks only over the reviewed version; the rules of who is asked', () => {
  const part1 = execSync('git show c43cf4d:supabase/review-asks-forward.sql').toString().replace(/\r\n/g, '\n');
  const oldMd5 = md5(body(part1, 'get_review_asks'));
  const newMd5 = md5(body(FWD, 'get_review_asks', FWD.indexOf('create function public.get_review_asks') - 9));
  assert.ok(FWD.includes(`v_md5 not in ('${oldMd5}', '${newMd5}')`), 'preflight pins both versions');
  assert.ok(read('supabase/review-asks-auto-verify.sql').includes(`= '${newMd5}'`), 'verify pins the new one');
  // The rollback puts back exactly the part-1 function.
  const undo = read('supabase/review-asks-auto-ROLLBACK.sql');
  assert.equal(md5(body(undo, 'get_review_asks', undo.indexOf('create function public.get_review_asks') - 9)), oldMd5);

  const due = body(FWD, 'review_asks_due');
  for (const rule of ["extract(hour from p_now at time zone 'Asia/Kolkata') >= 11", 'o.delivered_at >= s.review_ask_since',
    "(o.delivered_at at time zone 'Asia/Kolkata')::date + s.review_ask_days", 'then s.review_ask_couriers else s.review_ask_manual end',
    'public.review_ask_fresh(o.id)', 'not public.whatsapp_opted_out(o.store_slug, o.customer_phone)',
    'w.balance_paise >= public.review_ask_price_paise()']) assert.ok(due.includes(rule), `due: ${rule}`);

  const claim = body(FWD, 'review_ask_claim');
  // Every check before the money; the money before the link.
  const at = (s) => { const i = claim.indexOf(s); assert.ok(i > 0, s); return i; };
  const debit = at('v_debit := public.wallet_debit(');
  for (const s of ["'reason', 'night'", "'reason', 'not_eligible'", "'reason', 'already'", "'reason', 'opted_out'", "'reason', 'not_this_store'"]) {
    assert.ok(at(s) < debit, `${s} before paying`);
  }
  assert.ok(debit < at('insert into public.review_invites'));
  assert.match(claim, /values \(a\.id, a\.store_slug, 'invite_issued', 'system'\)/);
  const finish = body(FWD, 'review_ask_finish');
  assert.match(finish, /perform public\.wallet_refund\(r\.debit_ref, 'Review request not sent'\);\n\s+delete from public\.review_invites i where i\.token_hash = r\.token_hash;/);
  const ok = body(FWD, 'review_ask_ok');
  for (const s of ["= 'delivered'", 'returned_at is null', 'coalesce(p_order.total, 0) > 0', "'whatsappNumber'", "'ownerPhone'"]) assert.ok(ok.includes(s), s);
  // Switching on starts from now: no surprise bill for old orders.
  assert.match(body(FWD, 'set_review_ask_auto'), /v_since := case when not p_on then null\n\s+when coalesce\(v_was_on, false\) and v_since is not null then v_since\n\s+else now\(\) end;/);
  assert.match(body(FWD, 'review_ask_price_paise'), /select 50/);
  // Grants: the sending functions are service_role only; the switch is PIN-checked for the browser.
  for (const f of ['review_asks_due(integer, timestamptz)', 'review_ask_claim(uuid, text, text, text)', 'review_ask_finish(uuid, boolean, integer, text, text)']) {
    assert.ok(code(FWD).includes(`grant execute on function public.${f}`) && new RegExp(`grant execute on function public\\.${f.replace(/[()]/g, '\\$&')}\\s+to service_role;`).test(code(FWD)), f);
  }
  assert.match(code(FWD), /grant execute on function public\.set_review_ask_auto\(text, text, boolean, integer, text, boolean, boolean\) to anon, authenticated, service_role;/);
});

test('the schedule reads its secret at run time', () => {
  const s = read('supabase/review-asks-schedule.sql');
  assert.match(s, /'pocketlink-review-asks',\n\s+'\*\/15 \* \* \* \*'/);
  assert.match(s, /\(select secret from public\.automation_secrets where name = 'review-asks'\)/);
  assert.match(s, /functions\/v1\/review-asks'/);
});

test('the review card chip, and the photo of an order', () => {
  const asks = withAsk(withAsk([], 'a', { asked: true, source: 'auto' }), 'b', { asked: true });
  assert.equal(askSourceLabel(asks, 'a'), 'Asked automatically');
  assert.equal(askSourceLabel(asks, 'b'), 'Asked by you');
  assert.equal(askSourceLabel(asks, 'c'), '');
  assert.equal(askSourceLabel(withAsk([], 'd', { skipped: true }), 'd'), '', 'skipped is not asked');
  const products = [{ id: 7, name: 'Misal', image: 'm.jpg' }, { id: 8, name: 'Hamper', images: ['h.jpg'] }];
  assert.equal(orderImage({ items: [{ id: '7::Large', name: 'Misal' }] }, products), 'm.jpg');
  assert.equal(orderImage({ items: [{ productId: 8, name: 'x' }] }, products), 'h.jpg');
  assert.equal(orderImage({ items: [{ name: 'Hamper' }] }, products), 'h.jpg');
  assert.equal(orderImage({ items: [] }, products), '');
});

test('the screens: as the mockup, and "Ask all" waits for the approved template', () => {
  const tab = read('src/components/manage/ReviewsTab.jsx');
  assert.match(tab, /<AutoCard auto=\{auto\} ready=\{ready\}/);
  assert.match(tab, /<AutoRow auto=\{auto\}/);
  assert.match(tab, /onAddCoins=\{\(\) => \{ setAutoOpen\(false\); onGoTab\?\.\('whatsapp'\); \}\}/);
  assert.match(tab, /source=\{askSourceLabel\(asks, r\.order_id\)\}/);
  assert.match(tab, /useEffect\(\(\) => \{ if \(toAsk !== null\) onToAsk\?\.\(toAsk\); \}, \[toAsk, onToAsk\]\);/);
  const asks = read('src/components/manage/ReviewAsks.jsx');
  assert.match(asks, /disabled=\{!ready \|\| list\.length === 0\}/);
  assert.match(asks, /askAllReviews\(slug, pin, ids, autoLang,/);
  // Each batch moves to "Asked, waiting" as it goes (once: never again at the end).
  assert.match(asks, /\(p\.sentIds \|\| \[\]\)\.forEach\(\(id\) => onAsked\(id, 'all'\)\)/);
  assert.ok(!/res\.sentIds\.forEach/.test(asks));
  // Stopped part-way: only the rest are offered.
  assert.match(asks, /rows: a\.rows\.filter\(\(r\) => !done\.has\(String\(r\.o\.id\)\)\)/);
  const manage = read('src/pages/ManageStore.jsx');
  assert.match(manage, /const badges    = \{ orders: newCount, reviews: reviewToAsk \};/);
  assert.match(manage, /onToAsk=\{setReviewToAsk\}/);
  assert.match(read('src/components/manage/shell/ManageSidebar.jsx'), /key === 'reviews' \? 'bg-amber-500 text-gray-900'/);
  assert.match(read('src/components/manage/WhatsAppTab.jsx'), /onClick=\{\(\) => onGoTab\?\.\('reviews'\)\}/);
  const svc = read('src/utils/reviewService.js');
  // Ten a call, so the count moves and no call nears the 150-second limit; a
  // dropped connection is tried once more; a stop says what went.
  assert.match(svc, /export const ASK_ALL_BATCH = 10;/);
  assert.match(svc, /const batch = left\.slice\(0, ASK_ALL_BATCH\);/);
  assert.match(svc, /for \(let attempt = 0; attempt < 2; attempt\+\+\)/);
  assert.match(svc, /\{ partial: sum \}/);
  assert.match(svc, /rpc\('set_review_ask_auto'/);
});
