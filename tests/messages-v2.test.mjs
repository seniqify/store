// WhatsApp messages v2 (supabase/messages-v2-*.sql, cart-reminders-now, the
// redesigned Abandoned tab, order attribution). The SQL runs in PGlite on top of
// the REAL v1 migrations (wallet, consent, cart reminders, offers), under
// Supabase-like default grants.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { cartReminderState, statusMap, reminderCounts, MANUAL_MAX_AGE_DAYS } from '../src/utils/reminderStatus.js';
import { saveMessageAttribution, takeMessageAttribution } from '../src/utils/messageAttribution.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = (p) => readFileSync(`${ROOT}${p}`, 'utf8').replace(/\r\n/g, '\n');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
const V1 = ['supabase/wallet-forward.sql', 'supabase/whatsapp-consent-forward.sql', 'supabase/cart-reminders-forward.sql', 'supabase/offers-forward.sql'];
const FORWARD = read('supabase/messages-v2-forward.sql');
const ROLLBACK = read('supabase/messages-v2-ROLLBACK.sql');
const VERIFY = read('supabase/messages-v2-verify.sql');
const EDGE = read('supabase/functions/cart-reminders-now/index.ts');
const V1_MD5 = {
  'public.cart_reminders_due(integer,timestamptz)': 'bb9e712817054a13d132a6526722087b',
  'public.cart_reminder_claim(uuid)': 'd88eca976669ec2c143f7952d1a62cbc',
  'public.get_cart_reminder_summary(text,text)': '6df2b2e0f5612f532a53817b8d77e6c5',
  'public.offer_claim(text,uuid,text,jsonb)': '90b3f7a4e1a78315fa7be885ce38433d',
};
const ADMIN = '00000000-0000-0000-0000-00000000000a';
const URL1 = 'https://campaignadmin.backendprod.com/webhook/template/test/process';
const at = (h, m = 0) => `(date_trunc('day', now() at time zone 'Asia/Kolkata') + interval '${h} hours ${m} minutes') at time zone 'Asia/Kolkata'`;
const NOON = at(12);

async function world({ v2 = true } = {}) {
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
    insert into public.crm_team values ('${ADMIN}', 'Founder', 'admin');
    create table public.stores (slug text primary key, config jsonb not null default '{}');
    insert into public.stores values ('krupa', '{"businessName":"Krupa Agarbatti Work"}'), ('other', '{}');
    create table public.orders (
      id uuid primary key default gen_random_uuid(), store_slug text not null, status text,
      customer_name text, customer_phone text, items jsonb, total numeric,
      created_at timestamptz not null default now());
    create table public.automation_secrets (name text primary key, secret text not null, created_at timestamptz default now());
    create function public.verify_store_pin(p_slug text, p_hashed_pin text) returns boolean
      language sql volatile as $$ select p_hashed_pin = 'good' $$;`);
  for (const f of V1) await db.exec(read(f));
  if (v2) await db.exec(FORWARD);
  return db;
}
const val = async (db, sql, params = []) => Object.values((await db.query(sql, params)).rows[0] ?? {})[0];
const md5 = (db, sig) => val(db, `select md5(replace(prosrc, chr(13), '')) from pg_proc where oid = to_regprocedure($1)`, [sig]);
async function shop(db, { slug = 'krupa', on = false, paise = 15000 } = {}) {
  if (on) await db.query(`select public.set_cart_reminders($1, 'good', true)`, [slug]);
  if (paise) await db.query(`select public.wallet_adjust($1, $2, 'test')`, [slug, paise]);
}
async function cart(db, { slug = 'krupa', phone = '9822555192', name = 'Asha Patil', ago = '2 hours', from = 'now()', total = 300, status = 'abandoned' } = {}) {
  return val(db, `insert into public.orders (store_slug, status, customer_name, customer_phone, items, total, created_at)
    values ($1, $2, $3, $4, '[{"productId":"p1","name":"Combo","qty":1}]', $5, ${from} - $6::interval) returning id`,
  [slug, status, name, phone, total, ago]);
}
const consent = (db, phone, granted, slug = 'krupa') => db.query('select public.record_whatsapp_consent($1, $2, $3, $4)', [slug, phone, granted, 'x']);
const claim = (db, id, { manual = false, when = NOON, slug = 'krupa' } = {}) =>
  val(db, `select public.cart_reminder_claim($1, $2, ${when}, $3)`, [id, manual, slug]);
const finish = (db, id, sent = true) => val(db, 'select public.cart_reminder_finish($1, $2, 200, null)', [id, sent]);
const balance = async (db, slug = 'krupa') => Number(await val(db, 'select balance_paise from public.store_wallets where store_slug = $1', [slug]) ?? 0);
const istHour = () => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', hour12: false }).format(new Date()));

// ═══ the consent rule for reminders ══════════════════════════════════════════

test('automatic reminders now reach every customer who left a cart — never one who asked to stop', async () => {
  const db = await world();
  await shop(db, { on: true });
  const never = await cart(db, { phone: '9000000001', from: NOON });          // never ticked: now included
  await cart(db, { phone: '9000000002', from: NOON });                        // unticked / said no
  await consent(db, '9000000002', true); await consent(db, '9000000002', false);
  const back = await cart(db, { phone: '9000000003', from: NOON });           // said no, then yes
  await consent(db, '9000000003', false); await consent(db, '9000000003', true);
  const due = (await db.query(`select abandoned_order_id from public.cart_reminders_due(50, ${NOON})`)).rows.map((r) => r.abandoned_order_id);
  assert.deepEqual(due.sort(), [never, back].sort());
  assert.equal(await val(db, `select public.whatsapp_opted_out('krupa', '9000000002')`), true);
  assert.equal(await val(db, `select public.whatsapp_opted_out('krupa', '9000000001')`), false, 'no record is not a no');
  await db.close();
});

test('"Send reminder to all": each customer’s latest cart from the last 7 days that can get one now', async () => {
  const db = await world();
  await shop(db);
  await cart(db, { phone: '9000000001', ago: '3 days' });
  const latest = await cart(db, { phone: '9000000001', ago: '2 days' });     // same customer: only the latest
  await cart(db, { phone: '9000000002', ago: '8 days' });                     // too old for a reminder
  await cart(db, { phone: '9000000003', ago: '1 day' });                      // ordered since
  await db.query(`insert into public.orders (store_slug, status, customer_phone, total) values ('krupa', 'new', '9000000003', 300)`);
  const reminded = await cart(db, { phone: '9000000004', ago: '4 days' });    // reminded this week
  const c4 = await claim(db, reminded, { manual: true });
  await finish(db, c4.reminder_id);
  await cart(db, { phone: '9000000005', ago: '5 hours' });                    // asked to stop
  await consent(db, '9000000005', true); await consent(db, '9000000005', false);
  await cart(db, { slug: 'other', phone: '9000000006', ago: '1 hour' });      // another shop
  const cands = (await db.query(`select abandoned_order_id from public.cart_reminders_manual_candidates('krupa')`)).rows;
  assert.deepEqual(cands.map((r) => r.abandoned_order_id), [latest]);
  await db.close();
});

// ═══ sending by hand ═════════════════════════════════════════════════════════

test('a manual send: no switch needed, carts up to 7 days, Rs 1.50, recorded as manual', async () => {
  const db = await world();
  await shop(db);                                       // switch OFF
  const id = await cart(db, { ago: '3 days' });
  assert.equal((await claim(db, id)).reason, 'off', 'the automatic path still needs the switch');
  const c = await claim(db, id, { manual: true });
  assert.equal(c.ok, true);
  assert.match(c.values['5'], /^cart\/[0-9a-f]{20}$/);
  assert.equal(await balance(db), 14850);
  assert.equal(await val(db, 'select source from public.cart_reminders where id = $1', [c.reminder_id]), 'manual');
  const old = await cart(db, { phone: '9000000009', ago: '8 days' });
  assert.equal((await claim(db, old, { manual: true })).reason, 'too_old');
  await db.close();
});

test('SECURITY: a shop can only send for, and spend on, its OWN carts', async () => {
  const db = await world();
  await shop(db, { slug: 'other' });
  const theirs = await cart(db, { slug: 'other', phone: '9000000007' });
  assert.deepEqual(await claim(db, theirs, { manual: true, slug: 'krupa' }), { ok: false, reason: 'not_yours' });
  assert.deepEqual(await claim(db, theirs, { manual: true, slug: null }), { ok: false, reason: 'not_yours' });
  assert.equal(await balance(db, 'other'), 15000, "the other shop's wallet is untouched");
  assert.equal(Number(await val(db, 'select count(*) from public.cart_reminders')), 0);
  assert.equal((await claim(db, theirs, { manual: true, slug: 'other' })).ok, true, 'its own shop can');
  // The send function passes the PIN-checked shop with every claim.
  assert.match(strip(EDGE), /rpc\('cart_reminder_claim', \{ p_abandoned_id: id, p_manual: true, p_slug: slug \}\)/);
  await db.close();
});

test('manual sends only 9 am – 9 pm IST', async () => {
  const db = await world();
  await shop(db);
  const id = await cart(db, { ago: '1 hour' });
  assert.equal((await claim(db, id, { manual: true, when: at(8, 59) })).reason, 'night');
  assert.equal((await claim(db, id, { manual: true, when: at(21, 0) })).reason, 'night');
  assert.equal((await claim(db, id, { manual: true, when: at(9, 0) })).ok, true);
  await db.close();
});

test('the manual path keeps every other rule: once per week, never after an order, never after "stop", only when paid for', async () => {
  const db = await world();
  await shop(db, { paise: 150 });
  const a = await cart(db, { phone: '9000000011' });
  const ca = await claim(db, a, { manual: true });
  await finish(db, ca.reminder_id);
  assert.equal((await claim(db, a, { manual: true })).reason, 'already');
  const a2 = await cart(db, { phone: '9000000011', ago: '10 minutes' });
  assert.equal((await claim(db, a2, { manual: true })).reason, 'recent');
  const b = await cart(db, { phone: '9000000012' });
  await consent(db, '9000000012', true); await consent(db, '9000000012', false);
  assert.equal((await claim(db, b, { manual: true })).reason, 'opted_out');
  const c = await cart(db, { phone: '9000000013' });
  assert.equal((await claim(db, c, { manual: true })).reason, 'no_balance', 'the wallet had one message');
  await db.close();
});

// ═══ what the shop sees ══════════════════════════════════════════════════════

test('the preview before "Send to all", and each customer’s reminder state — both need the PIN', async () => {
  const db = await world();
  await shop(db);
  await cart(db, { phone: '9000000001' });
  await cart(db, { phone: '9000000002' });
  const r = await cart(db, { phone: '9000000003' });
  const c = await claim(db, r, { manual: true });
  await finish(db, c.reminder_id);
  assert.equal(await val(db, `select public.cart_reminder_preview('krupa', 'wrong')`), null);
  const p = await val(db, `select public.cart_reminder_preview('krupa', 'good')`);
  const night = istHour() < 9 || istHour() >= 21;
  assert.deepEqual(p, { eligible: 2, reminded_recently: 1, price_paise: 150, cost_paise: 300, balance_paise: 14850, night });
  assert.equal(await val(db, `select public.cart_reminder_statuses('krupa', 'wrong')`), null);
  const st = await val(db, `select public.cart_reminder_statuses('krupa', 'good')`);
  assert.deepEqual(st.map((s) => [s.phone, s.status, s.source]), [['9000000003', 'sent', 'manual']]);
  assert.ok(Date.parse(st[0].next_at) - Date.parse(st[0].sent_at) > 6.9 * 86400000, 'next one in a week');
  await db.close();
});

test('which orders the reminders earned: via the link, or within 7 days — cancelled never counts', async () => {
  const db = await world();
  await shop(db);
  const send = async (phone, name) => {
    const c = await claim(db, await cart(db, { phone, name }), { manual: true });
    await finish(db, c.reminder_id);
    return c.values['5'].slice('cart/'.length);
  };
  const tLink = await send('9000000021', 'Asha Patil');
  await send('9000000022', 'Ravi Shinde');
  const tCancel = await send('9000000023', 'Meena J');
  const order = (phone, total, status = 'new', name = null) => val(db,
    `insert into public.orders (store_slug, status, customer_name, customer_phone, total, created_at)
     values ('krupa', $1, $2, $3, $4, now() + interval '1 minute') returning id`, [status, name, phone, total]);
  // Asha came through the link, but ordered on her husband's number: still hers.
  const viaLink = await order('9111111111', 360, 'new', 'Asha Patil');
  assert.equal(await val(db, `select public.attribute_message_order('cart', $1, $2)`, [tLink, viaLink]), true);
  assert.equal(await val(db, `select public.attribute_message_order('cart', $1, $2)`, [tLink, viaLink]), true, 'idempotent');
  const another = await order('9111111111', 999);
  assert.equal(await val(db, `select public.attribute_message_order('cart', $1, $2)`, [tLink, another]), false, 'a reminder keeps its first order');
  await order('9000000022', 250);                                              // Ravi: ordered without the link
  const cancelled = await order('9000000023', 500, 'cancelled');
  await val(db, `select public.attribute_message_order('cart', $1, $2)`, [tCancel, cancelled]);

  const s = await val(db, `select public.get_cart_reminder_summary('krupa', 'good')`);
  assert.equal(s.sent_30d, 3);
  assert.equal(s.recovered_30d, 2, 'Asha (link) and Ravi (within 7 days); the cancelled order does not count');
  assert.equal(s.via_link_30d, 1);
  assert.equal(Number(s.recovered_value_30d), 610);
  assert.equal(s.spent_paise_30d, 450);
  assert.deepEqual(s.wins.map((w) => [w.name, Number(w.total), w.via_link]).sort(), [['Asha', 360, true], ['Ravi', 250, false]]);
  await db.close();
});

test('order tagging refuses anything that is not that shop’s order within the message’s 7 days', async () => {
  const db = await world();
  await shop(db);
  const c = await claim(db, await cart(db), { manual: true });
  const token = c.values['5'].slice(5);
  const mk = (slug, when) => val(db, `insert into public.orders (store_slug, status, customer_phone, total, created_at)
    values ($1, 'new', '9000000001', 100, ${when}) returning id`, [slug]);
  const early = await mk('krupa', `now() + interval '1 minute'`);
  assert.equal(await val(db, `select public.attribute_message_order('cart', $1, $2)`, [token, early]), false, 'not sent yet');
  await finish(db, c.reminder_id);
  const before = await mk('krupa', `now() - interval '1 hour'`);
  const tooLate = await mk('krupa', `now() + interval '8 days'`);
  const otherShop = await mk('other', `now() + interval '1 minute'`);
  for (const id of [before, tooLate, otherShop]) {
    assert.equal(await val(db, `select public.attribute_message_order('cart', $1, $2)`, [token, id]), false);
  }
  assert.equal(await val(db, `select public.attribute_message_order('cart', 'nope', $1)`, [early]), false);
  assert.equal(await val(db, `select public.attribute_message_order('evil', $1, $2)`, [token, early]), false);
  await db.close();
});

// ═══ offers get their own link ═══════════════════════════════════════════════

test('every offer carries its own /o/<token> link: opens and orders are counted', async () => {
  const db = await world();
  await shop(db);
  await db.exec(`set test.uid = '${ADMIN}'`);
  const tid = await val(db, `select public.admin_create_ready_template('Festival', 'Hi {name}! {shop} has {offer}. Tap below.', $1)`, [URL1]);
  await db.exec(`set test.uid = ''`);
  await db.query(`insert into public.orders (store_slug, status, customer_name, customer_phone, total) values ('krupa', 'new', 'Asha', '9822555192', 100)`);
  await consent(db, '9822555192', true);
  const c = await val(db, `select public.offer_claim('krupa', $1, '9822555192', '{"offer":"20% off"}')`, [tid]);
  assert.match(c.values['4'], /^o\/[0-9a-f]{20}$/, 'the button opens the offer link, not the bare shop');
  const token = c.values['4'].slice(2);
  assert.equal(await val(db, 'select public.get_offer_link($1)', [token]), null, 'not until sent');
  await val(db, 'select public.offer_finish($1, true, 200, null)', [c.send_id]);
  assert.deepEqual(await val(db, 'select public.get_offer_link($1)', [token]), { store_slug: 'krupa' });
  const o = await val(db, `insert into public.orders (store_slug, status, customer_phone, total, created_at)
    values ('krupa', 'new', '9822555192', 480, now() + interval '1 minute') returning id`);
  assert.equal(await val(db, `select public.attribute_message_order('offer', $1, $2)`, [token, o]), true);
  const s = await val(db, `select public.get_offer_summary('krupa', 'good')`);
  assert.deepEqual([s.sent_30d, s.clicked_30d, s.ordered_30d, s.via_link_30d, Number(s.ordered_value_30d), s.spent_paise_30d],
    [1, 1, 1, 1, 480, 150]);
  assert.equal(await val(db, `select public.get_offer_summary('krupa', 'wrong')`), null);
  await db.close();
});

// ═══ access ══════════════════════════════════════════════════════════════════

test('the browser cannot claim, list candidates or check opt-outs — only PIN-checked reads, links and tagging', async () => {
  const db = await world();
  const id = await cart(db);
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`set role ${role}`);
    for (const sql of [
      [`select public.cart_reminder_claim($1, true, now(), 'krupa')`, [id]],
      [`select * from public.cart_reminders_manual_candidates('krupa')`, []],
      [`select public.whatsapp_opted_out('krupa', '9822555192')`, []],
      [`select * from public.cart_reminders_due(50, now())`, []],
    ]) await assert.rejects(db.query(sql[0], sql[1]), /permission denied/, sql[0]);
    assert.ok(await val(db, `select public.cart_reminder_preview('krupa', 'good')`));
    assert.ok(Array.isArray(await val(db, `select public.cart_reminder_statuses('krupa', 'good')`)));
    assert.equal(await val(db, `select public.get_offer_link('0123456789abcdef0123')`), null);
    assert.equal(await val(db, `select public.attribute_message_order('cart', '0123456789abcdef0123', gen_random_uuid())`), false);
    await db.exec('reset role');
  }
  await db.close();
});

// ═══ migration hygiene ═══════════════════════════════════════════════════════

test('forward checks the live versions first, re-runs harmlessly, and the verifier passes', async () => {
  const odd = await world({ v2: false });
  await odd.exec(`create or replace function public.get_cart_reminder_summary(p_slug text, p_hashed_pin text)
    returns jsonb language sql security definer set search_path = public, pg_temp as $f$ select '{}'::jsonb $f$`);
  await assert.rejects(odd.exec(FORWARD), /get_cart_reminder_summary\(text,text\) is not the reviewed version/);
  await odd.exec('rollback');
  assert.ok(await md5(odd, 'public.cart_reminder_claim(uuid)'), 'nothing changed');
  await odd.close();

  const db = await world();
  await db.exec(FORWARD);
  const v = Object.fromEntries((await db.query(VERIFY)).rows.map((r) => [r.grp, r.result]));
  for (const c of ['C1', 'C2', 'C3', 'C4', 'C5', 'C6']) assert.equal(v[c], 'PASS', c);
  await db.close();
});

test('rollback restores the four v1 functions byte for byte, and the v1 rule (agreed only) with them', async () => {
  const db = await world();
  await shop(db, { on: true });
  const c = await claim(db, await cart(db, { phone: '9000000031' }), { manual: true });
  await finish(db, c.reminder_id);
  await db.exec(ROLLBACK);
  await db.exec(ROLLBACK);                                    // harmless twice
  for (const [sig, h] of Object.entries(V1_MD5)) assert.equal(await md5(db, sig), h, sig);
  for (const gone of ['public.cart_reminder_claim(uuid,boolean,timestamptz,text)', 'public.whatsapp_opted_out(text,text)',
                      'public.cart_reminders_manual_candidates(text)', 'public.attribute_message_order(text,text,uuid)']) {
    assert.equal(await val(db, 'select to_regprocedure($1)', [gone]), null, gone);
  }
  assert.equal(await val(db, `select source from public.cart_reminders limit 1`), 'manual', 'the record of what was sent stays');
  // v1 again: a customer who never ticked the box is not due.
  await cart(db, { phone: '9000000032', from: NOON });
  assert.deepEqual((await db.query(`select * from public.cart_reminders_due(50, ${NOON})`)).rows, []);
  await db.close();
});

// ═══ the send function ═══════════════════════════════════════════════════════

test('cart-reminders-now: PIN first, the server picks "all", at most 100 a call, every answer recorded', () => {
  const src = strip(EDGE);
  const pin = src.indexOf("supabase.rpc('verify_store_pin', { p_slug: slug, p_hashed_pin: hashedPin })");
  assert.ok(pin > 0 && pin < src.indexOf("rpc('cart_reminders_manual_candidates'"));
  assert.match(src, /if \(pinOk !== true\) return /);
  assert.match(src, /rpc\('cart_reminders_manual_candidates', \{ p_slug: slug \}\)/, 'the server decides who "all" is');
  assert.ok(!/body\.(ids|phones|abandoned_ids)/.test(src), 'the browser cannot hand over a list');
  assert.match(src, /const MAX_PER_CALL = 100;/);
  assert.match(src, /Deno\.env\.get\('SENIQIFY_CART_REMINDER_TEMPLATE_URL'\)/);
  assert.match(src, /body: JSON\.stringify\(\{ receiver: claim\.receiver, values: claim\.values \}\)/);
  const loop = src.slice(src.indexOf("rpc('cart_reminder_claim'"));
  assert.ok(loop.indexOf('await fetch(templateUrl') < loop.indexOf("rpc('cart_reminder_finish'"));
});

// ═══ the screens ═════════════════════════════════════════════════════════════

test('each cart’s reminder state: badge, whether it can be sent now, and the filter counts', () => {
  const now = Date.parse('2026-10-05T07:00:00Z');
  const cart1 = { customer_phone: '9000000001', created_at: '2026-10-04T07:00:00Z' };
  assert.deepEqual(cartReminderState(cart1, null, now), { key: 'none', badge: 'Not reminded', canSend: true, note: '' });
  const old = { customer_phone: '9', created_at: '2026-09-20T07:00:00Z' };
  assert.equal(cartReminderState(old, null, now).canSend, false);
  assert.match(cartReminderState(old, null, now).note, new RegExp(`${MANUAL_MAX_AGE_DAYS} days`));
  const r = { phone: '9000000001', status: 'sent', sent_at: '2026-10-05T04:00:00Z', clicked_at: '2026-10-05T05:00:00Z', next_at: '2026-10-12T04:00:00Z' };
  const s = cartReminderState(cart1, r, now);
  assert.equal(s.badge, 'Reminded 3 hr ago · Opened');
  assert.equal(s.canSend, false);
  assert.match(s.note, /Next reminder possible from 12 Oct/);
  assert.equal(cartReminderState(cart1, { ...r, status: 'failed' }, now).key, 'none', 'a failed one does not count');
  const m = statusMap([r]);
  assert.deepEqual(reminderCounts([cart1, { customer_phone: '9000000002', created_at: cart1.created_at }], m, now),
    { all: 2, reminded: 1, notReminded: 1 });
});

test('the link remembers which message brought the customer — for that shop, once, for 48 hours', () => {
  const m = new Map();
  const st = { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) };
  const t = '0123456789abcdef0123';
  saveMessageAttribution('krupa', 'cart', t, st, 1000);
  saveMessageAttribution('krupa', 'cart', 'not-a-token', st, 1000);       // ignored
  assert.equal(takeMessageAttribution('other', st, 2000), null);
  assert.deepEqual(takeMessageAttribution('krupa', st, 2000), { kind: 'cart', token: t });
  assert.equal(takeMessageAttribution('krupa', st, 3000), null, 'once');
  saveMessageAttribution('krupa', 'offer', t, st, 0);
  assert.equal(takeMessageAttribution('krupa', st, 48 * 3600 * 1000 + 1), null, 'stale');
  assert.equal(takeMessageAttribution('krupa', { getItem: () => { throw new Error('x'); } }), null);
});

test('the screens are wired: send all / one, results, the links, and tagging the order at checkout', () => {
  const tab = strip(read('src/components/manage/AbandonedTab.jsx'));
  assert.match(tab, /<RecoveryCard slug=\{slug\} pin=\{pin\}/);
  assert.match(tab, /sendRemindersNow\(\{ slug, pin, abandonedId: o\.id \}\)/);
  assert.match(tab, /<WalletCard slug=\{slug\} pin=\{pin\}[^>]*compact/);
  const card = strip(read('src/components/manage/RecoveryCard.jsx'));
  assert.match(card, /sendRemindersNow\(\{ slug, pin, onProgress: setProgress \}\)/);
  assert.match(card, /fetchReminderPreview\(slug, pin\)/, 'the sheet shows the server’s numbers');
  assert.match(card, /Won back/);
  const checkout = strip(read('src/components/form/CustomerDetailsForm.jsx'));
  assert.match(checkout, /attributePlacedOrder\(takeMessageAttribution\(config\?\.slug\), orderId\)/);
  assert.ok(checkout.indexOf('attributePlacedOrder(') > checkout.indexOf('setSubmitted(true)'), 'only after the order is placed');
  assert.match(strip(read('src/pages/CartRestore.jsx')), /saveMessageAttribution\(r\.store_slug, 'cart', token\)/);
  assert.match(strip(read('src/pages/OfferLink.jsx')), /saveMessageAttribution\(r\.store_slug, 'offer', token\)/);
  assert.match(read('src/App.jsx'), /<Route path="\/o\/:token"\s+element=\{<OfferLink \/>\} \/>/);
  assert.match(read('src/utils/slugify.js'), /'cart', 'order', 'confirm', 'review', 'o'/);
  assert.match(strip(read('src/components/manage/OffersPanel.jsx')), /fetchOfferSummary\(slug, pin\)/);
});
