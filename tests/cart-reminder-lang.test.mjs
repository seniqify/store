// Cart reminders in मराठी, and what the customer did with each one
// (supabase/cart-reminder-lang-*.sql, the two senders, the Abandoned tab chat).
// The SQL runs in PGlite on top of the REAL migrations that installed the live
// versions (wallet, consent, cart reminders, offers, messages v2, and the
// abandoned-private cart_reminder_statuses), under Supabase-like default grants.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { cartOutcome, OUTCOME_FILTERS } from '../src/utils/reminderStatus.js';
import { cartReminderMessage } from '../src/utils/cartReminderText.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = (p) => readFileSync(`${ROOT}${p}`, 'utf8').replace(/\r\n/g, '\n');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
const fnBlock = (src, head) => {
  const i = src.indexOf(head);
  return src.slice(i, src.indexOf('$function$;', src.indexOf('as $function$', i)) + '$function$;'.length);
};
const LIVE = [
  'supabase/wallet-forward.sql', 'supabase/whatsapp-consent-forward.sql', 'supabase/cart-reminders-forward.sql',
  'supabase/offers-forward.sql', 'supabase/messages-v2-forward.sql',
].map(read).concat([fnBlock(read('supabase/abandoned-private-forward.sql'), 'create or replace function public.cart_reminder_statuses(')]);
const FORWARD = read('supabase/cart-reminder-lang-forward.sql');
const ROLLBACK = read('supabase/cart-reminder-lang-ROLLBACK.sql');
const VERIFY = read('supabase/cart-reminder-lang-verify.sql');
const NOW_EDGE = read('supabase/functions/cart-reminders-now/index.ts');
const AUTO_EDGE = read('supabase/functions/cart-reminders/index.ts');
const NOON = `(date_trunc('day', now() at time zone 'Asia/Kolkata') + interval '12 hours') at time zone 'Asia/Kolkata'`;

async function world({ forward = true } = {}) {
  const db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
    alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
    grant usage on schema public to anon, authenticated, service_role;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated, service_role;
    grant execute on function auth.uid() to anon, authenticated, service_role;
    create table public.crm_team (user_id uuid primary key, name text, role text);
    create table public.stores (slug text primary key, config jsonb not null default '{}');
    insert into public.stores values ('krupa', '{"businessName":"Krupa Agarbatti Work"}'), ('other', '{}');
    create table public.orders (
      id uuid primary key default gen_random_uuid(), store_slug text not null, status text,
      customer_name text, customer_phone text, items jsonb, total numeric,
      created_at timestamptz not null default now());
    create table public.automation_secrets (name text primary key, secret text not null, created_at timestamptz default now());
    create function public.verify_store_pin(p_slug text, p_hashed_pin text) returns boolean
      language sql volatile as $$ select p_hashed_pin = 'good' $$;`);
  for (const sql of LIVE) await db.exec(sql);
  if (forward) await db.exec(FORWARD);
  return db;
}
const val = async (db, sql, params = []) => Object.values((await db.query(sql, params)).rows[0] ?? {})[0];
const md5 = (db, sig) => val(db, `select md5(replace(prosrc, chr(13), '')) from pg_proc where oid = to_regprocedure($1)`, [sig]);
async function cart(db, { phone = '9822555192', name = 'Asha Patil', items = '[{"name":"Rose Agarbatti","qty":1},{"name":"Dhoop","qty":2},{"name":"Kapur","qty":1}]', total = 300, ago = '2 hours' } = {}) {
  return val(db, `insert into public.orders (store_slug, status, customer_name, customer_phone, items, total, created_at)
    values ('krupa', 'abandoned', $1, $2, $3::jsonb, $4, ${NOON} - $5::interval) returning id`, [name, phone, items, total, ago]);
}
const claim = (db, id) => val(db, `select public.cart_reminder_claim($1, true, ${NOON}, 'krupa')`, [id]);
const finish = (db, id) => val(db, `select public.cart_reminder_finish($1, true, 200, null)`, [id]);
const fund = (db) => db.query(`select public.wallet_adjust('krupa', 15000, 'test')`);

// ═══ the safety net ══════════════════════════════════════════════════════════

test('the preflight knows the live versions and this one, and stops on anything else', async () => {
  const db = await world({ forward: false });
  const sigs = ['public.cart_reminder_claim(uuid,boolean,timestamptz,text)', 'public.cart_reminder_statuses(text,text)', 'public.get_cart_reminder_summary(text,text)'];
  for (const sig of sigs) assert.ok(FORWARD.includes(`'${await md5(db, sig)}'`), `${sig}: the live md5 is in the preflight`);
  await db.exec(FORWARD);
  for (const sig of sigs) assert.ok(FORWARD.includes(`'${await md5(db, sig)}'`), `${sig}: the new md5 is in the preflight`);
  await db.exec(FORWARD);   // a re-run is harmless
  await db.exec(`create or replace function public.get_cart_reminder_summary(p_slug text, p_hashed_pin text) returns jsonb language sql as $$ select '{}'::jsonb $$`);
  await assert.rejects(db.exec(FORWARD), /not the reviewed version/);
  await db.close();
});

test('the rollback puts the live versions back and drops only the new functions', async () => {
  const db = await world({ forward: false });
  const sigs = ['public.cart_reminder_claim(uuid,boolean,timestamptz,text)', 'public.cart_reminder_statuses(text,text)', 'public.get_cart_reminder_summary(text,text)'];
  const before = {};
  for (const s of sigs) before[s] = await md5(db, s);
  await db.exec(FORWARD);
  await db.exec(ROLLBACK);
  for (const s of sigs) assert.equal(await md5(db, s), before[s], `${s} restored`);
  assert.equal(await val(db, `select to_regprocedure('public.set_cart_reminder_lang(text,text,text)')`), null);
  assert.equal(await val(db, `select to_regprocedure('public.cart_reminder_mark_lang(uuid,text)')`), null);
  await db.exec(ROLLBACK);   // already undone: harmless
  await db.close();
});

test('the verify script passes after the forward', async () => {
  const db = await world();
  const rows = (await db.query(VERIFY)).rows;
  assert.ok(rows.length >= 6);
  for (const r of rows) assert.equal(r.result, 'PASS', `${r.check}: ${r.result}`);
  await db.close();
});

// ═══ the language ════════════════════════════════════════════════════════════

test('a shop picks its reminder language; English until it does; only with its PIN', async () => {
  const db = await world();
  assert.equal(await val(db, `select public.get_cart_reminder_summary('krupa', 'good')->>'lang'`), 'en');
  assert.equal(await val(db, `select public.set_cart_reminder_lang('krupa', 'bad', 'mr')`), null, 'wrong PIN');
  assert.equal(await val(db, `select public.set_cart_reminder_lang('krupa', 'good', 'hi')`), null, 'only en or mr');
  assert.equal(await val(db, `select public.set_cart_reminder_lang('krupa', 'good', 'mr')`), 'mr');
  assert.equal(await val(db, `select public.get_cart_reminder_summary('krupa', 'good')->>'lang'`), 'mr');
  assert.equal(await val(db, `select cart_reminders from public.store_message_settings where store_slug = 'krupa'`), false,
    'choosing a language does not switch automatic reminders on');
  await db.query(`select public.set_cart_reminders('krupa', 'good', true)`);
  assert.equal(await val(db, `select cart_reminder_lang from public.store_message_settings where store_slug = 'krupa'`), 'mr',
    'and switching them on keeps the language');
  await db.close();
});

test('the claim carries the shop’s language and the Marathi values, same link, same price', async () => {
  const db = await world();
  await fund(db);
  await db.query(`select public.set_cart_reminder_lang('krupa', 'good', 'mr')`);
  const c = await claim(db, await cart(db));
  assert.equal(c.ok, true);
  assert.equal(c.lang, 'mr');
  assert.deepEqual(c.values, { 1: 'Asha', 2: 'Rose Agarbatti + 2 more', 3: 'Krupa Agarbatti Work', 4: '300', 5: c.values['5'] });
  assert.deepEqual(c.values_mr, { 1: 'Asha', 2: 'Rose Agarbatti + आणखी 2 वस्तू', 3: 'Krupa Agarbatti Work', 4: '300', 5: c.values['5'] });
  assert.match(c.values['5'], /^cart\/[0-9a-f]{20}$/);
  assert.equal(await val(db, `select lang from public.cart_reminders where id = $1`, [c.reminder_id]), 'en', 'English until the sender marks it');
  assert.equal(await val(db, `select public.cart_reminder_mark_lang($1, 'mr')`, [c.reminder_id]), true);
  assert.equal(await val(db, `select lang from public.cart_reminders where id = $1`, [c.reminder_id]), 'mr');
  const one = await claim(db, await cart(db, { phone: '9000000002', items: '[{"name":"Dhoop","qty":1}]', name: '' }));
  assert.equal(one.values_mr['2'], 'Dhoop', 'one item: no "more"');
  assert.equal(one.values_mr['1'], 'ग्राहक', 'no name: a Marathi fallback');
  await db.close();
});

test('SECURITY: only the sender can mark a language; the browser can set its own shop’s only', async () => {
  const db = await world();
  const can = (role, fn) => val(db, `select has_function_privilege($1, $2, 'execute')`, [role, fn]);
  assert.equal(await can('anon', 'public.cart_reminder_mark_lang(uuid,text)'), false);
  assert.equal(await can('authenticated', 'public.cart_reminder_mark_lang(uuid,text)'), false);
  assert.equal(await can('service_role', 'public.cart_reminder_mark_lang(uuid,text)'), true);
  assert.equal(await can('anon', 'public.set_cart_reminder_lang(text,text,text)'), true);
  assert.equal(await can('anon', 'public.cart_reminder_claim(uuid,boolean,timestamptz,text)'), false, 'unchanged');
  await db.close();
});

// ═══ what the customer did ═══════════════════════════════════════════════════

test('statuses: the language, the order it won back (link first), and asking to stop', async () => {
  const db = await world();
  await fund(db);
  // Won back through the link.
  const a = await cart(db, { phone: '9000000001', name: 'Rutuja S' });
  const ca = await claim(db, a); await finish(db, ca.reminder_id);
  await db.query(`select public.cart_reminder_mark_lang($1, 'mr')`, [ca.reminder_id]);
  const order = await val(db, `insert into public.orders (store_slug, status, customer_phone, total) values ('krupa', 'new', '9000000001', 850) returning id`);
  await db.query(`update public.cart_reminders set ordered_order_id = $1, ordered_at = now(), clicked_at = now() where id = $2`, [order, ca.reminder_id]);
  // Asked to stop.
  const b = await cart(db, { phone: '9000000002' });
  const cb = await claim(db, b); await finish(db, cb.reminder_id);
  await db.query(`select public.record_whatsapp_consent('krupa', '9000000002', false, 'x')`);
  // Reminded, nothing yet.
  const c = await cart(db, { phone: '9000000003' });
  const cc = await claim(db, c); await finish(db, cc.reminder_id);

  const rows = await val(db, `select public.cart_reminder_statuses('krupa', 'good')`);
  const by = Object.fromEntries(rows.map((r) => [r.cart_id, r]));
  assert.equal(by[a].lang, 'mr');
  assert.equal(by[a].won_order_id, order);
  assert.equal(Number(by[a].won_total), 850);
  assert.equal(by[a].won_via_link, true);
  assert.equal(by[a].stopped_at, null);
  assert.ok(by[b].stopped_at, 'asked to stop');
  assert.equal(by[b].won_order_id, null);
  assert.equal(by[c].lang, 'en');
  assert.equal(by[c].won_order_id, null);
  assert.equal(by[c].stopped_at, null);
  assert.equal(await val(db, `select public.cart_reminder_statuses('krupa', 'bad')`), null, 'PIN still checked');
  await db.close();
});

test('summary: the same totals as before, plus results by language', async () => {
  const db = await world();
  await fund(db);
  const ids = [];
  for (const [phone, lang] of [['9000000011', 'mr'], ['9000000012', 'mr'], ['9000000013', 'en']]) {
    const c = await claim(db, await cart(db, { phone }));
    await finish(db, c.reminder_id);
    await db.query(`update public.cart_reminders set lang = $1, sent_at = now() - interval '1 hour' where id = $2`, [lang, c.reminder_id]);
    ids.push(c.reminder_id);
  }
  await db.query(`insert into public.orders (store_slug, status, customer_phone, total) values ('krupa', 'new', '9000000011', 500)`);
  const s = await val(db, `select public.get_cart_reminder_summary('krupa', 'good')`);
  assert.equal(Number(s.sent_30d), 3);
  assert.equal(Number(s.recovered_30d), 1);
  assert.deepEqual(s.by_lang, { en: { sent: 1, won: 0 }, mr: { sent: 2, won: 1 } });
  await db.close();
});

// ═══ the two senders ═════════════════════════════════════════════════════════

test('both senders use the Marathi template only when it exists, and record what they used', () => {
  for (const [name, src] of [['cart-reminders-now', NOW_EDGE], ['cart-reminders', AUTO_EDGE]]) {
    const s = strip(src);
    assert.match(s, /Deno\.env\.get\('SENIQIFY_CART_REMINDER_MR_TEMPLATE_URL'\)/, `${name}: reads the Marathi template`);
    assert.match(s, /const useMr = claim\.lang === 'mr' && Boolean\(mrUrl\) && Boolean\(claim\.values_mr\);/, `${name}: falls back to English`);
    assert.match(s, /body: JSON\.stringify\(\{ receiver: claim\.receiver, values: useMr \? claim\.values_mr : claim\.values \}\)/, `${name}`);
    assert.match(s, /fetch\(useMr \? mrUrl : templateUrl, \{/, `${name}`);
    assert.match(s, /rpc\('cart_reminder_mark_lang', \{ p_reminder_id: claim\.reminder_id, p_lang: 'mr' \}\)/, `${name}: records Marathi`);
    // The English template is still what must exist before anything is claimed.
    assert.match(s, /Deno\.env\.get\('SENIQIFY_CART_REMINDER_TEMPLATE_URL'\)/);
    assert.ok(!/campaignadmin\.backendprod\.com/.test(src), 'no template URL in code');
  }
});

// ═══ the screen ══════════════════════════════════════════════════════════════

test('the reminder text in both languages, as the customer sees it', () => {
  const cart = { customer_name: 'Rutuja Salunkhe', items: [{ name: 'Royal Misal Premix', qty: 2 }, { name: 'Chicken Masala', qty: 1 }], total: 850 };
  const en = cartReminderMessage('en', cart, 'Royal Foods & Spices');
  assert.match(en.text, /^Hi Rutuja, you left Royal Misal Premix \+ 1 more in your cart at Royal Foods & Spices \(₹850\)\./);
  assert.deepEqual(en.buttons, ['Complete my order', 'Stop offers']);
  const mr = cartReminderMessage('mr', cart, 'Royal Foods & Spices');
  assert.match(mr.text, /^नमस्कार Rutuja, तुम्ही कार्टमध्ये ठेवलेले Royal Misal Premix \+ आणखी 1 वस्तू अजून Royal Foods & Spices वर तुमची वाट पाहत आहे \(₹850\)\./);
  // The template's blanks appear in order: name, items, shop, total (Meta wants them sequential).
  const at = (s) => mr.text.indexOf(s);
  assert.ok(at('Rutuja') < at('Royal Misal') && at('Royal Misal') < at('Royal Foods') && at('Royal Foods') < at('₹850'));
  assert.deepEqual(mr.buttons, ['माझी ऑर्डर पूर्ण करा', 'ऑफर थांबवा']);
});

test('what the customer did, in one word per cart', () => {
  const cart = { id: 'c', created_at: new Date().toISOString() };
  const now = Date.now();
  assert.equal(cartOutcome(cart, undefined, now).key, 'none');
  assert.equal(cartOutcome(cart, { status: 'sent', sent_at: 'x' }, now).key, 'sent');
  assert.equal(cartOutcome(cart, { status: 'failed' }, now).key, 'failed');
  assert.equal(cartOutcome(cart, { status: 'sent', clicked_at: 'x' }, now).key, 'opened');
  assert.equal(cartOutcome(cart, { status: 'sent', clicked_at: 'x', won_order_id: 'o', won_total: 850 }, now).key, 'won');
  assert.equal(cartOutcome(cart, { status: 'sent', won_order_id: 'o', stopped_at: 'x' }, now).key, 'won', 'an order counts more than a stop');
  assert.equal(cartOutcome(cart, { status: 'sent', clicked_at: 'x', stopped_at: 'x' }, now).key, 'stopped');
  assert.deepEqual(OUTCOME_FILTERS.map((f) => f[0]), ['opened', 'won', 'stopped']);
});

test('the Abandoned tab: a chat per cart, a status per row, the language switch', () => {
  const tab = strip(read('src/components/manage/AbandonedTab.jsx'));
  assert.match(tab, /<CartChat /);
  assert.match(tab, /cartOutcome\(o, reminderFor\(byCart, o\)\)/);
  assert.match(tab, /\[\.\.\.FILTERS, \.\.\.OUTCOME_FILTERS\]/, 'filters for what they did');
  assert.ok(!/customer_phone|wa\.me|MessageCircle/.test(tab), 'numbers stay private');
  const chat = strip(read('src/components/manage/CartChat.jsx'));
  assert.match(chat, /cartReminderMessage\(lang, cart, storeName\)/);
  assert.match(chat, /Number hidden/);
  assert.ok(!/customer_phone/.test(chat), 'never the number');
  const card = strip(read('src/components/manage/RecoveryCard.jsx'));
  assert.match(card, /setCartReminderLang\(slug, pin, next\)/);
  assert.match(card, /by_lang/);
});
