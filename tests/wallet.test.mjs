// WhatsApp message wallet (supabase/wallet-*.sql, supabase/functions/wallet-topup,
// src/utils/walletPacks.js). The money rules live in SQL, so they run here in
// PGlite against Supabase-like default grants; the edge function and the screen
// are checked statically.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import {
  MESSAGE_PRICE_PAISE, WALLET_PACKS, messagesLeft, formatPaise, ledgerLabel,
} from '../src/utils/walletPacks.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = (p) => readFileSync(`${ROOT}${p}`, 'utf8').replace(/\r\n/g, '\n');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const FORWARD = read('supabase/wallet-forward.sql');
const ROLLBACK = read('supabase/wallet-ROLLBACK.sql');
const VERIFY = read('supabase/wallet-verify.sql');
const EDGE = read('supabase/functions/wallet-topup/index.ts');

async function world({ install = true } = {}) {
  const db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin;
    -- What Supabase does for every new object in public.
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
    alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
    grant usage on schema public to anon, authenticated, service_role;
    create table public.stores (slug text primary key);
    insert into public.stores values ('shop'), ('other');
    create function public.verify_store_pin(p_slug text, p_hashed_pin text) returns boolean
      language sql volatile as $$ select p_hashed_pin = 'good' $$;`);
  if (install) await db.exec(FORWARD);
  return db;
}
const one = async (db, sql, params = []) => (await db.query(sql, params)).rows[0];
const fn = async (db, sql, params = []) => Object.values(await one(db, sql, params))[0];
async function topup(db, { slug = 'shop', order = `order_${Math.random().toString(36).slice(2)}`, amount = 15000, messages = 100 } = {}) {
  await db.query(`insert into public.wallet_topups (store_slug, razorpay_order_id, amount_paise, messages)
                  values ($1, $2, $3, $4)`, [slug, order, amount, messages]);
  return order;
}
const credit = (db, order, pay, amount = 15000) =>
  fn(db, 'select public.wallet_credit_topup($1, $2, $3)', [order, pay, amount]);
const debit = (db, ref, slug = 'shop', amount = 150) =>
  fn(db, 'select public.wallet_debit($1, $2, $3, $4)', [slug, amount, ref, 'Cart reminder']);
const balance = async (db, slug = 'shop') =>
  Number((await one(db, 'select balance_paise from public.store_wallets where store_slug = $1', [slug]))?.balance_paise ?? 0);
const ledgerSum = async (db, slug = 'shop') =>
  Number((await one(db, 'select coalesce(sum(amount_paise), 0) s from public.wallet_ledger where store_slug = $1', [slug])).s);

// ═══ top-ups ═════════════════════════════════════════════════════════════════

test('a paid top-up is credited once, for exactly its amount', async () => {
  const db = await world();
  const order = await topup(db);
  const first = await credit(db, order, 'pay_1');
  assert.deepEqual(first, { ok: true, already: false, balance_paise: 15000 });
  assert.equal(await balance(db), 15000);
  // The Checkout callback and the "open the wallet" check both confirm: once.
  assert.deepEqual(await credit(db, order, 'pay_1'), { ok: true, already: true, balance_paise: 15000 });
  assert.deepEqual(await credit(db, order, 'pay_other'), { ok: true, already: true, balance_paise: 15000 });
  assert.equal(await balance(db), 15000);
  assert.equal(Number((await one(db, 'select count(*) n from public.wallet_ledger')).n), 1);
  const t = await one(db, 'select status, razorpay_payment_id from public.wallet_topups where razorpay_order_id = $1', [order]);
  assert.deepEqual(t, { status: 'paid', razorpay_payment_id: 'pay_1' });
  await db.close();
});

test('a wrong amount, an unknown order or a missing payment id credits nothing', async () => {
  const db = await world();
  const order = await topup(db);
  await assert.rejects(credit(db, order, 'pay_1', 100), /does not match/);
  await assert.rejects(credit(db, 'order_nobody_made', 'pay_2'), /unknown top-up/);
  await assert.rejects(credit(db, order, ''), /payment id is required/);
  assert.equal(await balance(db), 0);
  assert.equal(Number((await one(db, 'select count(*) n from public.wallet_ledger')).n), 0);
  // One payment can never pay two top-ups.
  const o2 = await topup(db);
  await credit(db, order, 'pay_same');
  await assert.rejects(credit(db, o2, 'pay_same'), /duplicate key/);
  assert.equal(await balance(db), 15000);
  await db.close();
});

// ═══ debits and refunds ══════════════════════════════════════════════════════

test('no wallet, or not enough in it: the debit refuses and nothing changes', async () => {
  const db = await world();
  assert.deepEqual(await debit(db, 'msg-1'), { ok: false, reason: 'insufficient', balance_paise: 0 });
  await credit(db, await topup(db, { amount: 15000 }), 'pay_1');
  assert.deepEqual(await debit(db, 'msg-big', 'shop', 15001), { ok: false, reason: 'insufficient', balance_paise: 15000 });
  assert.equal(await balance(db), 15000);
  await db.close();
});

test('100 messages for Rs 150: the 101st is refused, and the balance never goes below zero', async () => {
  const db = await world();
  await credit(db, await topup(db), 'pay_1');
  for (let i = 1; i <= 100; i++) assert.equal((await debit(db, `m-${i}`)).ok, true, `message ${i}`);
  assert.equal(await balance(db), 0);
  assert.deepEqual(await debit(db, 'm-101'), { ok: false, reason: 'insufficient', balance_paise: 0 });
  await assert.rejects(db.query(`update public.store_wallets set balance_paise = -1 where store_slug = 'shop'`), /check/);
  await db.close();
});

test('the same message is charged once, and refunded once', async () => {
  const db = await world();
  await credit(db, await topup(db), 'pay_1');
  assert.deepEqual(await debit(db, 'msg-1'), { ok: true, already: false, balance_paise: 14850 });
  assert.deepEqual(await debit(db, 'msg-1'), { ok: true, already: true, balance_paise: 14850 });
  const refund = (ref) => fn(db, 'select public.wallet_refund($1, $2)', [ref, 'not delivered']);
  assert.deepEqual(await refund('msg-1'), { ok: true, already: false, balance_paise: 15000 });
  assert.deepEqual(await refund('msg-1'), { ok: true, already: true, balance_paise: 15000 });
  assert.deepEqual(await refund('never-sent'), { ok: false, reason: 'no_debit' });
  // A refunded message is not charged again by a retry with the same reference.
  assert.deepEqual(await debit(db, 'msg-1'), { ok: true, already: true, balance_paise: 15000 });
  await db.close();
});

test('founder adjustments need a note, a real store, and cannot go below zero', async () => {
  const db = await world();
  const adjust = (slug, amount, note) => fn(db, 'select public.wallet_adjust($1, $2, $3)', [slug, amount, note]);
  assert.deepEqual(await adjust('shop', 3000, 'Launch gift: 20 free messages'), { ok: true, balance_paise: 3000 });
  await assert.rejects(adjust('shop', -5000, 'too much'), /check/);
  await assert.rejects(adjust('shop', 100, ' '), /note/);
  await assert.rejects(adjust('nowhere', 100, 'x'), /no store/);
  assert.deepEqual(await adjust('shop', -1000, 'correction'), { ok: true, balance_paise: 2000 });
  await db.close();
});

test('every balance equals the sum of its ledger, through any mix of movements', async () => {
  const db = await world();
  let seed = 7;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  for (let i = 0; i < 150; i++) {
    const slug = rnd(2) ? 'shop' : 'other';
    const op = rnd(4);
    if (op === 0) await credit(db, await topup(db, { slug }), `pay_${i}`);
    else if (op === 1 || op === 2) await debit(db, `m-${rnd(40)}`, slug);
    else await fn(db, 'select public.wallet_refund($1)', [`m-${rnd(40)}`]);
  }
  for (const slug of ['shop', 'other']) assert.equal(await balance(db, slug), await ledgerSum(db, slug), slug);
  const after = await one(db, `select bool_and(l.balance_after_paise >= 0) ok from public.wallet_ledger l`);
  assert.equal(after.ok, true);
  await db.close();
});

// ═══ what the browser can and cannot do ══════════════════════════════════════

test('the shop reads its wallet with the PIN; a wrong PIN reads nothing', async () => {
  const db = await world();
  await credit(db, await topup(db), 'pay_1');
  await debit(db, 'msg-1');
  await topup(db);                                           // started, not paid
  assert.equal(await fn(db, `select public.get_store_wallet('shop', 'wrong')`), null);
  const w = await fn(db, `select public.get_store_wallet('shop', 'good')`);
  assert.equal(w.balance_paise, 14850);
  assert.equal(w.price_paise, 150);
  assert.equal(w.pending_topups, 1);
  assert.deepEqual(w.recent.map((r) => r.kind), ['debit', 'topup'], 'newest first');
  assert.deepEqual(Object.keys(w.recent[0]).sort(), ['amount_paise', 'balance_after_paise', 'created_at', 'kind', 'note']);
  const other = await fn(db, `select public.get_store_wallet('other', 'good')`);
  assert.deepEqual([other.balance_paise, other.recent], [0, []], 'another store sees only its own');
  await db.close();
});

test('anon and authenticated cannot touch the tables or move money, even with Supabase default grants', async () => {
  const db = await world();
  await credit(db, await topup(db), 'pay_1');
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`set role ${role}`);
    for (const t of ['store_wallets', 'wallet_topups', 'wallet_ledger']) {
      await assert.rejects(db.query(`select * from public.${t}`), /permission denied/, `${role} ${t}`);
    }
    await assert.rejects(db.query(`insert into public.wallet_topups (store_slug, razorpay_order_id, amount_paise, messages) values ('shop','x',1,1)`), /permission denied/);
    await assert.rejects(db.query(`select public.wallet_credit_topup('x', 'y', 1)`), /permission denied/);
    await assert.rejects(db.query(`select public.wallet_debit('shop', 150, 'z')`), /permission denied/);
    await assert.rejects(db.query(`select public.wallet_refund('z')`), /permission denied/);
    await assert.rejects(db.query(`select public.wallet_adjust('shop', 100000, 'free money')`), /permission denied/);
    assert.equal((await db.query(`select public.get_store_wallet('shop', 'good') w`)).rows[0].w.balance_paise, 15000);
    await db.exec('reset role');
  }
  await db.close();
});

// ═══ migration hygiene ═══════════════════════════════════════════════════════

test('forward re-runs harmlessly and keeps the money', async () => {
  const db = await world();
  await credit(db, await topup(db), 'pay_1');
  await db.exec(FORWARD);
  assert.equal(await balance(db), 15000);
  await db.close();
});

test('verifier: every C row passes, and C7 catches a balance that drifts from its ledger', async () => {
  const db = await world();
  await credit(db, await topup(db), 'pay_1');
  await debit(db, 'msg-1');
  const rows = Object.fromEntries((await db.query(VERIFY)).rows.map((r) => [r.grp, r.result]));
  for (const c of ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7']) assert.equal(rows[c], 'PASS', c);
  assert.equal(rows.I1, '1 / 148.5000000000000000 / 1 / 0');
  await db.exec(`update public.store_wallets set balance_paise = 99999 where store_slug = 'shop'`);
  const after = Object.fromEntries((await db.query(VERIFY)).rows.map((r) => [r.grp, r.result]));
  assert.equal(after.C7, 'FAIL - shop');
  await db.close();
});

test('rollback refuses while money or a started payment exists, and removes an empty wallet cleanly', async () => {
  const db = await world();
  await topup(db);
  await assert.rejects(db.exec(ROLLBACK), /REFUSED - wallet_topups has 1 rows/);
  await db.exec('rollback');
  await credit(db, (await one(db, 'select razorpay_order_id o from public.wallet_topups')).o, 'pay_1');
  await assert.rejects(db.exec(ROLLBACK), /REFUSED - wallet_ledger has 1 rows/);
  await db.exec('rollback');
  await db.close();

  const empty = await world();
  await empty.exec(ROLLBACK);
  await empty.exec(ROLLBACK);
  assert.equal((await one(empty, `select to_regclass('public.wallet_ledger') r`)).r, null);
  assert.equal((await one(empty, `select to_regprocedure('public.wallet_debit(text,integer,text,text)') r`)).r, null);
  await empty.close();
});

// ═══ the edge function ═══════════════════════════════════════════════════════

test('wallet-topup checks the PIN through the throttled verifier before any action', () => {
  const src = strip(EDGE);
  const pin = src.indexOf("supabase.rpc('verify_store_pin', { p_slug: slug, p_hashed_pin: hashedPin })");
  assert.ok(pin > 0);
  assert.match(src, /if \(pinOk !== true\) return /);
  assert.ok(pin < src.indexOf("action === 'create'") && pin < src.indexOf("action === 'confirm'"));
});

test('the price is the server\'s: packs in the function, never an amount from the browser', () => {
  const src = strip(EDGE);
  assert.ok(!/body\.amount|body\?\.amount/.test(src), 'no amount is read from the request');
  assert.match(src, /const amount = PACKS\[messages\]/);
  const packs = Object.fromEntries([...EDGE.matchAll(/^\s+(\d+):\s+(\d+),$/gm)].map((m) => [Number(m[1]), Number(m[2])]));
  assert.deepEqual(packs, Object.fromEntries(WALLET_PACKS.map((p) => [p.messages, p.amountPaise])));
  for (const p of WALLET_PACKS) assert.equal(p.amountPaise, p.messages * MESSAGE_PRICE_PAISE, `${p.messages} at Rs 1.50`);
  assert.equal(MESSAGE_PRICE_PAISE, 150);
  assert.match(FORWARD, /as \$function\$ select 150 \$function\$/, 'the same price in SQL');
});

test('a wallet is credited only when Razorpay reports a captured payment on that order, in INR, for that amount', () => {
  const src = strip(EDGE);
  const paid = src.slice(src.indexOf('const paid ='), src.indexOf("supabase.rpc('wallet_credit_topup'"));
  for (const rule of [/p\?\.status === 'captured'/, /p\?\.order_id === t\.razorpay_order_id/,
                      /p\?\.currency === 'INR'/, /Number\(p\?\.amount\) === Number\(t\.amount_paise\)/]) {
    assert.match(paid, rule);
  }
  assert.match(src, /if \(!paid\) \{ waiting \+= 1; continue; \}/);
  assert.match(src, /\.eq\('store_slug', slug\)/, 'only this store\'s top-ups');
  assert.match(src, /p_amount_paise: Number\(t\.amount_paise\)/, 'the amount credited is the top-up row\'s');
  // PocketLink's own account, not the merchant's.
  assert.match(src, /Deno\.env\.get\('RAZORPAY_KEY_SECRET'\)/);
  assert.ok(!src.includes('store_payment_accounts'));
});

// ═══ the screen ══════════════════════════════════════════════════════════════

test('prices and labels: Rs 1.50 shows as ₹1.50, messages are whole, nothing negative', () => {
  assert.equal(formatPaise(150), '₹1.50');
  assert.equal(formatPaise(15000), '₹150');
  assert.equal(formatPaise(150000), '₹1,500');
  assert.equal(formatPaise(14850), '₹148.50');
  assert.equal(messagesLeft(15000), 100);
  assert.equal(messagesLeft(14999), 99);
  assert.equal(messagesLeft(-150), 0);
  assert.equal(messagesLeft('x'), 0);
  assert.deepEqual(ledgerLabel({ kind: 'topup', amount_paise: 15000 }), { sign: '+', text: '100 messages added', tone: 'credit' });
  assert.deepEqual(ledgerLabel({ kind: 'refund', amount_paise: 150 }), { sign: '+', text: '1 message refunded (not sent)', tone: 'credit' });
  assert.equal(ledgerLabel({ kind: 'debit', amount_paise: -150, note: 'Cart reminder · Asha' }).text, 'Cart reminder · Asha');
});

test('the Abandoned tab shows the wallet, and the card never decides a balance itself', () => {
  const tab = read('src/components/manage/AbandonedTab.jsx');
  assert.match(tab, /<WalletCard slug=\{slug\} pin=\{pin\}/);
  const card = strip(read('src/components/manage/WalletCard.jsx'));
  assert.match(card, /fetchWallet\(slug, pin\)/);
  assert.match(card, /confirmTopups\(slug, pin\)/, 'opening the card settles any unconfirmed payment');
  assert.ok(!/balance_paise\s*[+-]=|setWallet\(\{/.test(card), 'it only ever shows what the server returned');
  assert.match(card, /if \(!wallet\.ok \|\| !wallet\.data\)/, 'a failed read is a retry card, not a zero balance');
});
