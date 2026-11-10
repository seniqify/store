// WhatsApp Coins (supabase/whatsapp-coins-*.sql, send-otp's order-notify,
// wallet-topup bonus, the WhatsApp tab). The SQL runs in PGlite on top of the
// real wallet migration, under Supabase-like default grants.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { WALLET_PACKS, COIN_PAISE, coinsOf, formatCoins, packCoins, ledgerLabel } from '../src/utils/walletPacks.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = (p) => readFileSync(`${ROOT}${p}`, 'utf8').replace(/\r\n/g, '\n');
const FORWARD = read('supabase/whatsapp-coins-forward.sql');
const ROLLBACK = read('supabase/whatsapp-coins-ROLLBACK.sql');
const VERIFY = read('supabase/whatsapp-coins-verify.sql');
const WALLET = read('supabase/wallet-forward.sql');
const OTP = read('supabase/functions/send-otp/index.ts');
const TOPUP = read('supabase/functions/wallet-topup/index.ts');
const SWEEP = read('supabase/functions/ship-updates/index.ts');

async function world() {
  const db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
    grant usage on schema public to anon, authenticated, service_role;
    create table public.stores (slug text primary key, config jsonb not null default '{}');
    insert into public.stores values ('kul', '{}'), ('other', '{}');
    create table public.orders (
      id uuid primary key default gen_random_uuid(), store_slug text not null, status text default 'new',
      customer_name text, customer_phone text, total numeric, payment_method text,
      confirm_token uuid default gen_random_uuid(), created_at timestamptz not null default now());
    create function public.verify_store_pin(p_slug text, p_hashed_pin text) returns boolean
      language sql volatile as $$ select p_hashed_pin = 'good' $$;`);
  await db.exec(WALLET);
  await db.exec(FORWARD);
  return db;
}
const val = async (db, sql, params = []) => Object.values((await db.query(sql, params)).rows[0] ?? {})[0];
const balance = (db, slug = 'kul') => val(db, 'select coalesce((select balance_paise from public.store_wallets where store_slug = $1), 0)', [slug]);
const order = (db, o = {}) => val(db, `insert into public.orders (store_slug, status, customer_name, customer_phone, total, payment_method, created_at)
  values ($1, $2, 'Asha Patil', '9822555192', 500, 'cod', now() - $3::interval) returning id`, [o.slug || 'kul', o.status || 'new', o.ago || '1 minute']);
const claim = (db, id, kind = 'confirm') => val(db, 'select public.order_message_claim($1, $2)', [id, kind]);
const finish = (db, id, sent) => val(db, 'select public.order_message_finish($1, $2, null)', [id, sent]);
const MONTH = `to_char(now() at time zone 'Asia/Kolkata', 'YYYY-MM')`;
// This month's free messages, already used: n rows.
const useFree = (db, n, slug = 'kul') => db.query(`insert into public.order_messages (store_slug, order_id, kind, month, charged, status)
  select $1, gen_random_uuid(), 'confirm', ${MONTH}, false, 'sent' from generate_series(1, $2)`, [slug, n]);
const confirmMsg = (db, id) => val(db, 'select confirm_msg from public.orders where id = $1', [id]);

test('the first 500 order messages of the month are free, the 501st is 1 Coin', async () => {
  const db = await world();
  await db.query(`select public.wallet_adjust('kul', 1000, 'credit')`);
  const a = await order(db);
  const c1 = await claim(db, a);
  assert.equal(c1.ok, true);
  assert.equal(c1.charged, false);
  assert.equal(c1.free_left, 499);
  assert.equal(await balance(db), 1000, 'free costs nothing');
  await finish(db, c1.id, true);
  assert.equal(await confirmMsg(db, a), 'sent');

  await useFree(db, 499);
  const b = await order(db);
  const c2 = await claim(db, b, 'paid');
  assert.equal(c2.ok, true);
  assert.equal(c2.charged, true);
  assert.equal(await balance(db), 950, '1 Coin = 50 paise');
  // Another shop's month is its own.
  const o = await order(db, { slug: 'other' });
  assert.equal((await claim(db, o)).charged, false);
});

test('no Coins left after the free 500: the message is skipped, the order is marked, nothing charged', async () => {
  const db = await world();
  await useFree(db, 500);
  await db.query(`select public.wallet_adjust('kul', 30, 'less than a coin')`);
  const a = await order(db);
  const c = await claim(db, a);
  assert.deepEqual(c, { ok: false, reason: 'no_coins' });
  assert.equal(await confirmMsg(db, a), 'skipped');
  assert.equal(await balance(db), 30);
  assert.equal((await claim(db, a)).reason, 'already', 'never retried into a double message');
  const u = await val(db, `select public.get_order_message_usage('kul', 'good')`);
  assert.equal(u.free_used, 500);
  assert.equal(u.skipped, 1);
  assert.equal(Number(u.balance_paise), 30);
});

test('a failed send: a charged one is refunded, a free one gives its free slot back', async () => {
  const db = await world();
  await useFree(db, 499);
  await db.query(`select public.wallet_adjust('kul', 500, 'credit')`);
  const free = await claim(db, await order(db));
  assert.equal(free.charged, false);
  await finish(db, free.id, false);
  const again = await claim(db, await order(db));
  assert.equal(again.charged, false, 'the failed free one did not use up the 500th');
  const paid = await claim(db, await order(db));
  assert.equal(paid.charged, true);
  assert.equal(await balance(db), 450);
  await finish(db, paid.id, false);
  assert.equal(await balance(db), 500, 'refunded');
  // Lost answer: refunded after 30 minutes.
  const lost = await claim(db, await order(db));
  await db.query(`update public.order_messages set created_at = now() - interval '31 minutes' where id = $1`, [lost.id]);
  assert.equal(await balance(db), 450, 'the lost one was charged (the 500th free one is still sending)');
  assert.equal(await val(db, 'select public.order_messages_expire_stuck()'), 1, 'only the one older than 30 minutes');
  assert.equal(await balance(db), 500);
});

test('one message per order, fresh real orders only', async () => {
  const db = await world();
  const a = await order(db);
  assert.equal((await claim(db, a)).ok, true);
  assert.equal((await claim(db, a, 'paid')).reason, 'already');
  assert.equal((await claim(db, await order(db, { ago: '3 hours' }))).reason, 'too_old');
  assert.equal((await claim(db, await order(db, { status: 'abandoned' }))).reason, 'not_an_order');
  assert.equal((await claim(db, '00000000-0000-0000-0000-000000000000')).reason, 'not_found');
  assert.equal((await claim(db, a, 'spam')).reason, 'bad_input');
  assert.equal(await val(db, `select public.get_order_message_usage('kul', 'bad')`), null);
});

test('a top-up credits its bonus with the payment, once', async () => {
  const db = await world();
  await db.query(`insert into public.wallet_topups (store_slug, razorpay_order_id, amount_paise, messages, bonus_paise)
                  values ('kul', 'order_B', 75000, 500, 3750)`);
  const r = await val(db, `select public.wallet_credit_topup('order_B', 'pay_1', 75000)`);
  assert.equal(r.ok, true);
  assert.equal(await balance(db), 78750, '1,500 + 75 bonus Coins');
  assert.equal((await val(db, `select public.wallet_credit_topup('order_B', 'pay_1', 75000)`)).already, true);
  assert.equal(await balance(db), 78750, 'never twice');
  assert.equal(await val(db, `select note from public.wallet_ledger where ref = 'pay_1'`), '₹750 paid · incl. 75 bonus Coins');
  await assert.rejects(db.query(`select public.wallet_credit_topup('order_B', 'pay_2', 1)`).then(() => db.query(`insert into public.wallet_topups (store_slug, razorpay_order_id, amount_paise, messages) values ('kul', 'order_C', 15000, 100)`)).then(() => db.query(`select public.wallet_credit_topup('order_C', 'pay_3', 1)`)), /does not match/);
  await db.query(`select public.wallet_credit_topup('order_C', 'pay_3', 15000)`);
  assert.equal(await balance(db), 93750, 'no bonus on the small pack');
});

test('grants: the claim is server-only; the verifier passes; the rollback restores the old credit', async () => {
  const db = await world();
  for (const fn of ['order_message_claim(uuid, text)', 'order_message_finish(uuid, boolean, text)', 'order_messages_expire_stuck()', 'wallet_credit_topup(text, text, integer)']) {
    assert.equal(await val(db, `select has_function_privilege('anon', 'public.${fn}', 'EXECUTE')`), false, fn);
  }
  assert.equal(await val(db, `select has_function_privilege('anon', 'public.get_order_message_usage(text, text)', 'EXECUTE')`), true);
  assert.equal(await val(db, `select has_table_privilege('anon', 'public.order_messages', 'SELECT')`), false);
  assert.deepEqual((await db.query(VERIFY)).rows.filter((r) => r.result !== 'PASS').map((r) => r.check_name), []);
  await db.exec(FORWARD);   // idempotent
  await db.exec(ROLLBACK);
  assert.equal(await val(db, `select to_regclass('public.order_messages')`), null);
  const body = await val(db, `select prosrc from pg_proc where oid = 'public.wallet_credit_topup(text,text,integer)'::regprocedure`);
  const original = WALLET.slice(WALLET.indexOf('create or replace function public.wallet_credit_topup'));
  assert.ok(original.includes(body.trim().slice(0, 200)), 'the original function body is back');
  assert.ok(!body.includes('bonus'));
});

test('the rollback refuses while shops have paid Coins for order messages', async () => {
  const db = await world();
  await useFree(db, 500);
  await db.query(`select public.wallet_adjust('kul', 100, 'credit')`);
  await claim(db, await order(db));
  await assert.rejects(db.exec(ROLLBACK), /REFUSED/);
});

// ── the edge functions ───────────────────────────────────────────────────────
test('send-otp: claims before the buyer message, records the answer, never falls back to the plain thank-you when skipped', () => {
  const claimAt = OTP.indexOf("supabase.rpc('order_message_claim'");
  assert.ok(claimAt > 0);
  assert.ok(claimAt < OTP.indexOf('const r = await fetch(paidTrackUrl') && claimAt < OTP.indexOf('const r = await fetch(confirmSend'));
  assert.match(OTP, /if \(claimErr\) console\.error\('order-notify: claim unavailable, sending anyway:'/, 'fails open when the claim cannot run');
  assert.match(OTP, /if \(skipBuyer\) \{[\s\S]*?\} else if \(token && sendPaidTrack\) \{/, 'a skipped message sends nothing at all');
  assert.equal((OTP.match(/await finishClaim\(r\.ok, errText\);/g) || []).length, 2, 'both templates record their answer');
  // The seller alert is untouched and comes first.
  assert.ok(OTP.indexOf('const r = await fetch(sellerUrl') < claimAt);
});

test('wallet-topup: the bonus is the server’s and matches the app', () => {
  const bonus = TOPUP.match(/const BONUS_PAISE: Record<number, number> = \{ ([^}]+) \};/);
  assert.ok(bonus);
  const map = Object.fromEntries(bonus[1].split(',').map((x) => x.split(':').map((n) => Number(n.trim()))));
  assert.deepEqual(map, Object.fromEntries(WALLET_PACKS.map((p) => [p.messages, p.bonusPaise])));
  assert.match(TOPUP, /bonus_paise: BONUS_PAISE\[messages\] \?\? 0,/);
  assert.ok(!/body\.bonus/.test(TOPUP), 'never from the browser');
  assert.match(SWEEP, /supabase\.rpc\('order_messages_expire_stuck'\)/, 'stuck order messages are refunded by the 10-minute sweep');
});

// ── app ──────────────────────────────────────────────────────────────────────
test('Coins: 1 Coin = 50 paise, whole numbers, packs with bonus', () => {
  assert.equal(COIN_PAISE, 50);
  assert.equal(coinsOf(18450), 369);
  assert.equal(coinsOf(149), 2);
  assert.equal(coinsOf(-50), 0);
  assert.equal(formatCoins(1), '1 Coin');
  assert.equal(formatCoins(1575), '1,575 Coins');
  assert.deepEqual(WALLET_PACKS.map(packCoins), [
    { coins: 300, bonus: 0, total: 300, price: '₹150' },
    { coins: 1500, bonus: 75, total: 1575, price: '₹750' },
    { coins: 3000, bonus: 300, total: 3300, price: '₹1,500' },
  ]);
  assert.deepEqual(ledgerLabel({ kind: 'debit', amount_paise: -150, note: 'Cart reminder · Asha' }), { sign: '−', coins: 3, text: 'Cart reminder · Asha', tone: 'debit' });
  assert.deepEqual(ledgerLabel({ kind: 'refund', amount_paise: 50 }), { sign: '+', coins: 1, text: 'Given back · message not sent', tone: 'credit' });
  assert.equal(ledgerLabel({ kind: 'topup', amount_paise: 78750, note: '₹750 paid · incl. 75 bonus Coins' }).text, 'Added · ₹750 paid · incl. 75 bonus Coins');
  assert.equal(ledgerLabel({ kind: 'topup', amount_paise: 15000, note: '100 messages' }).text, 'Added', 'old notes in messages are not shown');
});

test('the WhatsApp tab holds the messages; Delivery is back to four views', () => {
  const MS = read('src/pages/ManageStore.jsx');
  assert.match(MS, /\['ship', 'Ship'\], \['track', 'Track'\], \['money', 'COD'\], \['settings', 'Settings'\]/);
  assert.match(MS, /\{ key: 'whatsapp', label: 'WhatsApp', icon: MessageCircle \}/);
  assert.match(MS, /tab === 'whatsapp' \? \(/);
  const TAB = read('src/components/manage/WhatsAppTab.jsx');
  assert.match(TAB, /<WalletCard /);
  assert.match(TAB, /<ShipUpdates /);
  assert.match(TAB, /getOrderMessageUsage\(slug, pin\)/);
  const CARD = read('src/components/manage/OrdersTab.jsx');
  assert.match(CARD, /o\.confirm_msg === 'skipped' \|\| o\.confirm_msg === 'failed'/);
  assert.match(CARD, /\/confirm\/\$\{o\.confirm_token\}/);
});
