// WhatsApp offers: ready-made + a shop's own messages, sent to opted-in
// customers, paid from the wallet (supabase/offers-*.sql, the send-offer edge
// function, OffersPanel, the Console's Messages tab). The SQL runs in PGlite on
// top of the REAL wallet, consent and cart-reminder migrations, under
// Supabase-like default grants.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import {
  placeholdersIn, fieldError, requestError, fillOffer, seniqifyTemplate, batches, OFFER_BATCH,
  offerLanguage, OFFER_BUTTONS, OFFER_FIELDS,
} from '../src/utils/offerText.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = (p) => readFileSync(`${ROOT}${p}`, 'utf8').replace(/\r\n/g, '\n');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
const FORWARD = read('supabase/offers-forward.sql');
const ROLLBACK = read('supabase/offers-ROLLBACK.sql');
const VERIFY = read('supabase/offers-verify.sql');
const EDGE = read('supabase/functions/send-offer/index.ts');
const ADMIN = '00000000-0000-0000-0000-00000000000a';
const SALES = '00000000-0000-0000-0000-00000000000b';
const URL1 = 'https://campaignadmin.backendprod.com/webhook/template/test-offer/process';

async function world({ install = true } = {}) {
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
    insert into public.crm_team values ('${ADMIN}', 'Founder', 'admin'), ('${SALES}', 'Exec', 'sales');
    create table public.stores (slug text primary key, config jsonb not null default '{}');
    insert into public.stores values ('krupa', '{"businessName":"Krupa Agarbatti Work"}'), ('other', '{"businessName":"Other"}');
    create table public.orders (
      id uuid primary key default gen_random_uuid(), store_slug text not null, status text,
      customer_name text, customer_phone text, items jsonb, total numeric,
      created_at timestamptz not null default now());
    create table public.automation_secrets (name text primary key, secret text not null, created_at timestamptz default now());
    create function public.verify_store_pin(p_slug text, p_hashed_pin text) returns boolean
      language sql volatile as $$ select p_hashed_pin = 'good' $$;`);
  for (const f of ['supabase/wallet-forward.sql', 'supabase/whatsapp-consent-forward.sql', 'supabase/cart-reminders-forward.sql']) {
    await db.exec(read(f));
  }
  if (install) await db.exec(FORWARD);
  return db;
}
const val = async (db, sql, params = []) => Object.values((await db.query(sql, params)).rows[0] ?? {})[0];
const asAdmin = async (db, sql, params = [], uid = ADMIN) => {
  await db.exec(`set test.uid = '${uid}'`);
  try { return await val(db, sql, params); } finally { await db.exec(`set test.uid = ''`); }
};
async function ready(db, body = 'Hi {name}! {shop} has a special offer for you: {offer}. Tap below to shop now.') {
  return asAdmin(db, 'select public.admin_create_ready_template($1, $2, $3)', ['Festival offer', body, URL1]);
}
async function customer(db, { slug = 'krupa', phone = '9822555192', name = 'Asha Patil', agreed = true, status = 'confirmed' } = {}) {
  await db.query(`insert into public.orders (store_slug, status, customer_name, customer_phone, total) values ($1, $2, $3, $4, 290)`, [slug, status, name, phone]);
  if (agreed) await db.query(`select public.record_whatsapp_consent($1, $2, true, 'Get offers')`, [slug, phone]);
}
const fund = (db, slug = 'krupa', paise = 15000) => db.query(`select public.wallet_adjust($1, $2, 'test')`, [slug, paise]);
const claim = (db, tid, phone = '9822555192', fields = { offer: '20% off all agarbatti' }, slug = 'krupa') =>
  val(db, 'select public.offer_claim($1, $2, $3, $4)', [slug, tid, phone, JSON.stringify(fields)]);
const audience = (db, tid, phones, fields = { offer: '20% off' }, pin = 'good', slug = 'krupa') =>
  val(db, 'select public.offer_audience($1, $2, $3, $4, $5)', [slug, pin, tid, phones, JSON.stringify(fields)]);
const balance = async (db, slug = 'krupa') => Number(await val(db, 'select balance_paise from public.store_wallets where store_slug = $1', [slug]) ?? 0);

// ═══ message text ════════════════════════════════════════════════════════════

test('the variables are the placeholders in order, then the Shop now button; unknown ones are refused', async () => {
  const db = await world();
  assert.deepEqual(await val(db, `select public.offer_value_map('Hi {name}, use {code} at {shop} for {offer} — {name}!')`),
    ['name', 'code', 'shop', 'offer', 'name', 'link']);
  assert.deepEqual(await val(db, `select public.offer_value_map('No placeholders at all here')`), ['link']);
  await assert.rejects(val(db, `select public.offer_value_map('Hi {customer}')`), /unknown placeholder \{customer\}/);
  // The Console's Seniqify helper numbers them exactly the same way.
  const body = 'Hi {name}, use {code} at {shop} for {offer} — {name}!';
  const t = seniqifyTemplate(body);
  assert.equal(t.text, 'Hi {{1}}, use {{2}} at {{3}} for {{4}} — {{5}}!');
  assert.deepEqual(t.samples.map((s) => s.key), (await val(db, 'select public.offer_value_map($1)', [body])).slice(0, -1));
  assert.equal(t.button.number, 6);
  assert.equal(t.button.websiteUrl, 'https://www.pocketlink.store/');
  await db.close();
});

test('shop-filled values: one short line, never a link — the same rule in the browser and the database', async () => {
  const db = await world();
  const cases = [
    ['20% off all agarbatti', true], ['DIWALI20', true], ['', false], ['   ', false], ['x'.repeat(61), false],
    ['visit www.cheap.com', false], ['https://bit.ly/x', false], ['wa.me/919', false], ['shop.in now', false],
    ['Rs.100 off', true],
  ];
  for (const [v, ok] of cases) {
    assert.equal(await val(db, 'select public.offer_field_ok($1)', [v]), ok, `sql: ${v}`);
    assert.equal(fieldError(v) === '', ok, `js: ${v}`);
  }
  await db.close();
});

// ═══ a shop's own message ════════════════════════════════════════════════════

test('a shop requests its own message: checked, waiting, at most 5 at once, PIN needed', async () => {
  const db = await world();
  const req = (name, body, pin = 'good') => val(db, 'select public.request_message_template($1, $2, $3, $4)', ['krupa', pin, name, body]);
  assert.equal(await req('Diwali', 'Hi {name}! {shop} has {offer} this Diwali.', 'wrong'), null);
  assert.equal((await req('Diwali', 'Hi {name}! {shop} has {offer} this Diwali.')).ok, true);
  assert.match((await req('Bad', 'Hi {customer}, big sale today')).error, /Use only/);
  assert.match((await req('Link', 'Hi {name}, see https://x.co for more')).error, /Leave links out/);
  assert.match((await req('x', 'Hi {name}, big sale today')).error, /short name/);
  assert.match((await req('Short', 'Hi')).error, /10 to 600/);
  for (let i = 0; i < 4; i++) assert.equal((await req(`Msg ${i}`, 'Hi {name}, more offers soon')).ok, true);
  assert.match((await req('Sixth', 'Hi {name}, more offers soon')).error, /5 messages waiting/);
  // The browser's pre-check agrees.
  assert.equal(requestError('Diwali', 'Hi {name}! {shop} has {offer} this Diwali.'), '');
  assert.match(requestError('Bad', 'Hi {customer}, big sale today'), /Unknown \{customer\}/);
  assert.match(requestError('Link', 'Hi {name}, see https://x.co'), /Leave links out/);
  await db.close();
});

test('a shop sees ready-made messages and its own — never another shop\'s, never a template link', async () => {
  const db = await world();
  await ready(db);
  await val(db, `select public.request_message_template('krupa', 'good', 'Mine', 'Hi {name}, {item} is back in stock!')`);
  await val(db, `select public.request_message_template('other', 'good', 'Theirs', 'Hi {name}, something else for you')`);
  const list = await val(db, `select public.list_message_templates('krupa', 'good')`);
  assert.deepEqual(list.map((t) => [t.name, t.status, t.own]), [['Mine', 'requested', true], ['Festival offer', 'approved', false]]);
  assert.deepEqual(list.find((t) => t.name === 'Mine').fields, ['item']);
  assert.ok(!JSON.stringify(list).includes('backendprod'), 'no template URL');
  assert.equal(await val(db, `select public.list_message_templates('krupa', 'wrong')`), null);
  await db.close();
});

// ═══ the founder's Console ═══════════════════════════════════════════════════

test('only a crm_team admin can approve, reject, retire or add — and approving needs the Seniqify link', async () => {
  const db = await world();
  const id = (await val(db, `select public.request_message_template('krupa', 'good', 'Mine', 'Hi {name}, {item} is back!')`)).id;
  await assert.rejects(asAdmin(db, `select public.admin_list_message_templates()`, [], SALES), /not authorised/);
  await assert.rejects(val(db, `select public.admin_decide_message_template($1, 'approved', $2, null)`, [id, URL1]), /not authorised/);
  await assert.rejects(asAdmin(db, `select public.admin_decide_message_template($1, 'approved', 'not a url', null)`, [id]), /https/);

  const before = await asAdmin(db, 'select public.admin_list_message_templates()');
  assert.equal(before[0].status, 'requested');
  assert.equal(before[0].store_name, 'Krupa Agarbatti Work');
  assert.equal(before[0].has_url, false);
  assert.ok(!JSON.stringify(before).includes('template_url'));

  assert.equal(await asAdmin(db, `select public.admin_decide_message_template($1, 'rejected', null, 'Too promotional')`, [id]), true);
  let mine = (await val(db, `select public.list_message_templates('krupa', 'good')`))[0];
  assert.deepEqual([mine.status, mine.reject_reason], ['rejected', 'Too promotional']);
  await asAdmin(db, `select public.admin_decide_message_template($1, 'approved', $2, null)`, [id, URL1]);
  mine = (await val(db, `select public.list_message_templates('krupa', 'good')`))[0];
  assert.deepEqual([mine.status, mine.reject_reason], ['approved', null]);
  await asAdmin(db, `select public.admin_decide_message_template($1, 'retired', null, null)`, [id]);
  assert.deepEqual(await val(db, `select public.list_message_templates('krupa', 'good')`), []);
  await db.close();
});

// ═══ who receives an offer ═══════════════════════════════════════════════════

test('only this shop\'s customers who agreed, at most once every 3 days — counted before sending', async () => {
  const db = await world();
  const tid = await ready(db);
  await fund(db);
  await customer(db, { phone: '9000000001' });                       // agreed
  await customer(db, { phone: '9000000002', agreed: false });        // never ticked
  await customer(db, { phone: '9000000003' });                       // agreed, offered yesterday
  await customer(db, { slug: 'other', phone: '9000000004' });        // another shop's customer
  const c3 = await claim(db, tid, '9000000003');
  await val(db, 'select public.offer_finish($1, true, 200, null)', [c3.send_id]);

  const a = await audience(db, tid, ['9000000001', '+91 90000 00002', '9000000003', '9000000004', '12345', '9000000001']);
  assert.deepEqual({ ...a, balance_paise: undefined }, {
    ok: true, eligible: 1, no_consent: 1, recent: 1, other: 2, price_paise: 150, cost_paise: 150, balance_paise: undefined,
  });
  assert.equal(a.balance_paise, 14850);
  assert.match((await audience(db, tid, ['9000000001'], {})).error, /Fill in \{offer\}/);
  assert.match((await audience(db, tid, ['9000000001'], { offer: 'see www.x.com' })).error, /no links/);
  assert.equal(await audience(db, tid, ['9000000001'], { offer: 'x' }, 'wrong'), null);
  await db.close();
});

test('sending one: the exact values, Rs 1.50 once, and every rule re-checked', async () => {
  const db = await world();
  const tid = await ready(db, 'Hi {name}! {shop} has {offer} till {date}. Tap below to shop.');
  await fund(db);
  await customer(db, { name: 'Asha Patil' });
  const c = await claim(db, tid, '9822555192', { offer: '20% off', date: '31 Oct' });
  assert.equal(c.ok, true);
  assert.equal(c.receiver, '919822555192');
  assert.equal(c.template_url, URL1, 'the sender gets the link; the browser never does');
  assert.deepEqual(c.values, { 1: 'Asha', 2: 'Krupa Agarbatti Work', 3: '20% off', 4: '31 Oct', 5: 'krupa' });
  assert.equal(await balance(db), 14850);
  assert.equal((await claim(db, tid, '9822555192', { offer: '20% off', date: '31 Oct' })).reason, 'recent');
  assert.equal((await claim(db, tid, '9822555192', { offer: '' , date: 'x' })).reason, 'recent', 'the lock-held checks come first');
  assert.equal(await balance(db), 14850, 'charged once');

  await customer(db, { phone: '9000000009', agreed: false });
  assert.equal((await claim(db, tid, '9000000009', { offer: 'x', date: 'y' })).reason, 'no_consent');
  assert.equal((await claim(db, tid, '9000000010', { offer: 'x', date: 'y' })).reason, 'not_customer');
  await customer(db, { phone: '9000000011' });
  assert.equal((await claim(db, tid, '9000000011', { offer: 'www.x.com', date: 'y' })).reason, 'bad_field');
  const own = (await val(db, `select public.request_message_template('other', 'good', 'Theirs', 'Hi {name}, something for you')`)).id;
  await asAdmin(db, `select public.admin_decide_message_template($1, 'approved', $2, null)`, [own, URL1]);
  assert.equal((await claim(db, own, '9000000011', {})).reason, 'not_approved', "another shop's own message");
  await db.query(`select public.wallet_adjust('krupa', -14850, 'drain')`);
  assert.equal((await claim(db, tid, '9000000011', { offer: 'x', date: 'y' })).reason, 'no_balance');
  assert.equal(Number(await val(db, 'select count(*) from public.offer_sends')), 1, 'nothing recorded unless paid');
  await db.close();
});

test('a refused offer is refunded once; one with no answer is refunded after 30 minutes', async () => {
  const db = await world();
  const tid = await ready(db);
  await fund(db);
  await customer(db, { phone: '9000000001' });
  await customer(db, { phone: '9000000002' });
  const a = await claim(db, tid, '9000000001');
  const b = await claim(db, tid, '9000000002');
  assert.equal(await balance(db), 14700);
  assert.deepEqual(await val(db, 'select public.offer_finish($1, false, 422, $2)', [a.send_id, 'bad']), { ok: true, already: false, status: 'failed' });
  assert.deepEqual(await val(db, 'select public.offer_finish($1, false, 422, $2)', [a.send_id, 'bad']), { ok: true, already: true, status: 'failed' });
  assert.equal(await balance(db), 14850);
  await db.query(`update public.offer_sends set created_at = now() - interval '31 minutes' where id = $1`, [b.send_id]);
  assert.equal(Number(await val(db, 'select public.offer_sends_expire_stuck()')), 1);
  assert.equal(await balance(db), 15000);
  // A failed send does not count toward the 3-day limit.
  assert.equal((await audience(db, tid, ['9000000001'])).eligible, 1);
  await db.close();
});

test('a customer who asked the shop to stop gets no offer and no cart reminder', async () => {
  const db = await world();
  const tid = await ready(db);
  await fund(db);
  await customer(db);
  assert.equal(await val(db, `select public.seller_record_optout('krupa', 'wrong', '9822555192')`), null);
  assert.equal(await val(db, `select public.seller_record_optout('krupa', 'good', '+91 98225 55192')`), true);
  assert.equal(await val(db, `select public.whatsapp_consent_granted('krupa', '9822555192')`), false);
  assert.equal((await audience(db, tid, ['9822555192'])).no_consent, 1);
  assert.equal((await claim(db, tid)).reason, 'no_consent');
  const src = (await db.query(`select source, granted from public.whatsapp_consents order by id desc limit 1`)).rows[0];
  assert.deepEqual(src, { source: 'seller', granted: false });
  assert.equal(await val(db, `select public.seller_record_optout('krupa', 'good', '9822555192')`), true, 'repeat is harmless');
  assert.equal(Number(await val(db, `select count(*) from public.whatsapp_consents where source = 'seller'`)), 1);
  await db.close();
});

// ═══ access ══════════════════════════════════════════════════════════════════

test('the browser cannot read the tables, claim, finish, or act as the founder', async () => {
  const db = await world();
  const tid = await ready(db);
  await customer(db);
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`set role ${role}`);
    for (const t of ['message_templates', 'offer_sends']) {
      await assert.rejects(db.query(`select * from public.${t}`), /permission denied/, `${role} ${t}`);
    }
    await assert.rejects(db.query('select public.offer_claim($1, $2, $3, $4)', ['krupa', tid, '9822555192', '{}']), /permission denied/);
    await assert.rejects(db.query(`select public.offer_finish(gen_random_uuid(), true, 200, null)`), /permission denied/);
    await assert.rejects(db.query(`select public.offer_sends_expire_stuck()`), /permission denied/);
    if (role === 'anon') {
      await assert.rejects(db.query('select public.admin_list_message_templates()'), /permission denied/);
    } else {
      await assert.rejects(db.query('select public.admin_list_message_templates()'), /not authorised/, 'signed in but not the founder');
    }
    assert.equal(Array.isArray(await val(db, `select public.list_message_templates('krupa', 'good')`)), true);
    await db.exec('reset role');
  }
  await db.close();
});

test('forward needs the earlier migrations; verifier passes; rollback refuses once used, clean before', async () => {
  const bare = new PGlite();
  await bare.exec(`create function public.verify_store_pin(a text, b text) returns boolean language sql as $$ select true $$;`);
  await assert.rejects(bare.exec(FORWARD), /run supabase\/wallet-forward\.sql first/);
  await bare.close();

  const db = await world();
  const v = Object.fromEntries((await db.query(VERIFY)).rows.map((r) => [r.grp, r.result]));
  for (const c of ['C1', 'C2', 'C3', 'C4', 'C5', 'C6']) assert.equal(v[c], 'PASS', c);
  await db.exec(FORWARD);                                      // re-run harmless
  await ready(db);
  await assert.rejects(db.exec(ROLLBACK), /REFUSED - message_templates holds 1/);
  await db.exec('rollback');
  await db.close();

  const empty = await world();
  await empty.exec(ROLLBACK);
  await empty.exec(ROLLBACK);
  assert.equal(await val(empty, `select to_regclass('public.offer_sends')`), null);
  await empty.close();
});

// ═══ the edge function ═══════════════════════════════════════════════════════

test('send-offer: PIN first, at most 100 per call, sends exactly what the database built, records every answer', () => {
  const src = strip(EDGE);
  const pin = src.indexOf("supabase.rpc('verify_store_pin', { p_slug: slug, p_hashed_pin: hashedPin })");
  assert.ok(pin > 0 && pin < src.indexOf("rpc('offer_claim'"));
  assert.match(src, /if \(pinOk !== true\) return /);
  assert.match(src, /const MAX_PER_CALL = 100;/);
  assert.equal(OFFER_BATCH, 100, 'the screen batches the same size');
  assert.match(src, /fetch\(String\(claim\.template_url\)/);
  assert.match(src, /body: JSON\.stringify\(\{ receiver: claim\.receiver, values: claim\.values \}\)/);
  const loop = src.slice(src.indexOf("rpc('offer_claim'"));
  assert.ok(loop.indexOf('await fetch(') < loop.indexOf("rpc('offer_finish'"));
  assert.match(src, /return json\(result\)/);
  assert.ok(!/template_url[^)]*\)\s*;?\s*\}\s*\)\s*;?\s*$/.test(src) && !/json\(\{[^}]*template_url/.test(src), 'never returned to the browser');
});

// ═══ the screens ═════════════════════════════════════════════════════════════

test('previews and batches', () => {
  assert.deepEqual(placeholdersIn('Hi {name}, {offer} at {shop} {oops}'), { keys: ['name', 'offer', 'shop'], unknown: ['oops'] });
  assert.equal(fillOffer('Hi {name}! {shop}: {offer}', { name: 'Asha Patil', shop: 'Krupa', fields: { offer: '20% off' } }),
    'Hi Asha! Krupa: 20% off');
  assert.equal(fillOffer('Hi {name}! {offer}', {}), 'Hi there! {offer}');
  assert.deepEqual(batches([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(batches(null), []);
});

test('Customers shows the wallet and offers instead of the paste-a-link card; the Console has the Messages tab', () => {
  const tab = read('src/components/manage/CustomersTab.jsx');
  assert.ok(!/CampaignPanel/.test(tab));
  assert.match(tab, /<WalletCard slug=\{slug\} pin=\{pin\}/);
  assert.match(tab, /<OffersPanel slug=\{slug\} pin=\{pin\}/);
  assert.match(tab, /recordOptOut\(slug, pin, c\.phone\)/);
  const panel = strip(read('src/components/manage/OffersPanel.jsx'));
  assert.ok(!/template_url|backendprod/.test(panel), 'the shop never handles a template link');
  assert.match(panel, /offerAudience\(slug, pin, picked\.id, phones, fields\)/, 'always shows who and what it costs first');
  const consolePage = read('src/pages/Console.jsx');
  assert.match(consolePage, /\{ id: 'messages', label: 'Messages'/);
  assert.match(consolePage, /<MessagesSection templates=\{templates\}/);
});

// ═══ English and Marathi ═════════════════════════════════════════════════════

// The approved ready-made messages (the bodies only; their send links stay in the database).
const READY = {
  en: 'Hi {name}, here is a gift from {shop}: use code {code} to get {offer} on your next order. Tap below to shop.',
  mr: 'नमस्कार {name}, {shop} कडून तुमच्यासाठी भेट! पुढच्या ऑर्डरवर {code} हा कोड वापरा आणि {offer} मिळवा. खरेदीसाठी खालील बटण दाबा.',
};

test('a message with Devanagari letters is Marathi; its buttons and samples are Marathi too', () => {
  assert.equal(offerLanguage(READY.en), 'en');
  assert.equal(offerLanguage(READY.mr), 'mr');
  assert.equal(offerLanguage('Hi {name}! 20% सूट at {shop}'), 'mr');
  assert.equal(offerLanguage(''), 'en');
  assert.equal(offerLanguage(null), 'en');
  assert.deepEqual(OFFER_BUTTONS.mr, { shop: 'आत्ताच खरेदी करा', stop: 'ऑफर थांबवा' });
  for (const f of Object.values(OFFER_FIELDS)) assert.match(f.placeholderMr, /^उदा\. /);

  const mr = seniqifyTemplate(READY.mr);
  assert.equal(mr.language, 'Marathi');
  assert.equal(mr.text, 'नमस्कार {{1}}, {{2}} कडून तुमच्यासाठी भेट! पुढच्या ऑर्डरवर {{3}} हा कोड वापरा आणि {{4}} मिळवा. खरेदीसाठी खालील बटण दाबा.');
  assert.deepEqual(mr.samples.map((s) => s.key), ['name', 'shop', 'code', 'offer']);
  assert.equal(mr.samples[0].sample, 'आशा');
  assert.equal(mr.button.number, 5);
  assert.equal(mr.button.label, 'आत्ताच खरेदी करा');
  assert.equal(mr.stopLabel, 'ऑफर थांबवा');
  assert.equal(seniqifyTemplate(READY.en).language, 'English');
  assert.equal(seniqifyTemplate(READY.en).button.label, 'Shop now');
});

test('the Seniqify button sample is a FULL offer link — a bare slug or token is refused by Seniqify', () => {
  for (const body of [READY.en, READY.mr]) {
    const { button } = seniqifyTemplate(body);
    assert.ok(button.sample.startsWith(button.websiteUrl), 'the sample starts with the Website URL');
    const suffix = button.sample.slice(button.websiteUrl.length);
    assert.match(suffix, /^o\/[A-Za-z0-9]+$/, 'the rest is what we send: o/<token>');
  }
  const app = read('src/App.jsx');
  assert.match(app, /path="\/o\/:token"/, 'and that link opens a real page');
  const consolePage = strip(read('src/pages/Console.jsx'));
  assert.match(consolePage, /seniqifyTemplate\(body\)/);
  assert.match(consolePage, /Marketing · \{t\.language\}/);
  assert.match(consolePage, /\{t\.stopLabel\}/);
});

test('Send an offer shows one language at a time when both exist, with matching buttons in the preview', () => {
  const panel = strip(read('src/components/manage/OffersPanel.jsx'));
  assert.match(panel, /new Set\(approved\.map\(\(t\) => offerLanguage\(t\.body\)\)\)\.size > 1/, 'the switch only when both languages exist');
  assert.match(panel, /approved\.filter\(\(t\) => offerLanguage\(t\.body\) === lang\)/);
  assert.match(panel, /shown\.find\(\(t\) => t\.id === pickedId\) \|\| shown\[0\]/, 'the picked message is always one on screen');
  assert.match(panel, /\{bothLangs && \(/);
  assert.match(panel, /\{OFFER_BUTTONS\[pickedLang\]\.shop\}/);
  assert.match(panel, /\{OFFER_BUTTONS\[pickedLang\]\.stop\}/);
  assert.ok(!/text-sky-600[^>]*>(Shop now|Stop offers)</.test(panel), 'no English-only preview buttons left');
  // The remembered language never breaks the page (private mode, blocked storage).
  assert.match(panel, /try \{ return localStorage\.getItem\(LANG_KEY\) === 'mr' \? 'mr' : 'en'; \} catch \{ return 'en'; \}/);
  assert.match(panel, /try \{ localStorage\.setItem\(LANG_KEY, code\); \} catch/);
  assert.ok(!/template_url|backendprod/.test(panel), 'the shop never handles a template link');
});
