// Offers to every customer (supabase/offers-everyone-*.sql): the founder's
// 2026-10-04 rule — like cart reminders, offers go to every customer of the
// shop except those who asked to stop. Runs in PGlite on top of the REAL
// wallet, consent, cart-reminder, offers and messages-v2 migrations, under
// Supabase-like default grants.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = (p) => readFileSync(`${ROOT}${p}`, 'utf8').replace(/\r\n/g, '\n');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
const BEFORE = ['wallet', 'whatsapp-consent', 'cart-reminders', 'offers', 'messages-v2'].map((f) => `supabase/${f}-forward.sql`);
const FORWARD = read('supabase/offers-everyone-forward.sql');
const ROLLBACK = read('supabase/offers-everyone-ROLLBACK.sql');
const VERIFY = read('supabase/offers-everyone-verify.sql');
const ADMIN = '00000000-0000-0000-0000-00000000000a';
const URL1 = 'https://campaignadmin.backendprod.com/webhook/template/test/process';
const SIGS = {
  audience: 'public.offer_audience(text,text,uuid,text[],jsonb)',
  claim: 'public.offer_claim(text,uuid,text,jsonb)',
  optout: 'public.seller_record_optout(text,text,text)',
};
const OLD = { audience: 'b3312b3b091f2fa68d5d098acf4716c7', claim: 'e26ad9fa1fad1bf4e5cb46c286b17ca0', optout: '8ada037494f02bb72b2feaac92d405c8' };
const NEW = { audience: '6de2710c9f26bb3fc87e66712c589ec2', claim: '3b9ec7bace212a5f9315641c7d46a465', optout: '711db68335f6d4535a760d5c1a9d9198' };

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
    insert into public.crm_team values ('${ADMIN}', 'Founder', 'admin');
    create table public.stores (slug text primary key, config jsonb not null default '{}');
    insert into public.stores values ('krupa', '{"businessName":"Krupa Agarbatti Work"}'), ('other', '{"businessName":"Other"}');
    create table public.orders (
      id uuid primary key default gen_random_uuid(), store_slug text not null, status text,
      customer_name text, customer_phone text, items jsonb, total numeric,
      created_at timestamptz not null default now());
    create table public.automation_secrets (name text primary key, secret text not null, created_at timestamptz default now());
    create function public.verify_store_pin(p_slug text, p_hashed_pin text) returns boolean
      language sql volatile as $$ select p_hashed_pin = 'good' $$;`);
  for (const f of BEFORE) await db.exec(read(f));
  if (install) await db.exec(FORWARD);
  return db;
}
const val = async (db, sql, params = []) => Object.values((await db.query(sql, params)).rows[0] ?? {})[0];
const md5 = (db, key) => val(db, `select md5(replace(prosrc, chr(13), '')) from pg_proc where oid = to_regprocedure($1)`, [SIGS[key]]);
async function ready(db) {
  await db.exec(`set test.uid = '${ADMIN}'`);
  try {
    return await val(db, 'select public.admin_create_ready_template($1, $2, $3)',
      ['Festival offer', 'Hi {name}! {shop} has a special offer for you: {offer}. Tap below to shop now.', URL1]);
  } finally { await db.exec(`set test.uid = ''`); }
}
const order = (db, phone, { slug = 'krupa', name = 'Asha Patil', status = 'confirmed' } = {}) =>
  db.query(`insert into public.orders (store_slug, status, customer_name, customer_phone, total) values ($1, $2, $3, $4, 290)`, [slug, status, name, phone]);
const consent = (db, phone, granted, slug = 'krupa') => db.query('select public.record_whatsapp_consent($1, $2, $3, $4)', [slug, phone, granted, 'x']);
const fund = (db, paise = 15000, slug = 'krupa') => db.query(`select public.wallet_adjust($1, $2, 'test')`, [slug, paise]);
const audience = (db, tid, phones, pin = 'good') =>
  val(db, 'select public.offer_audience($1, $2, $3, $4, $5)', ['krupa', pin, tid, phones, JSON.stringify({ offer: '20% off' })]);
const claim = (db, tid, phone, slug = 'krupa') =>
  val(db, 'select public.offer_claim($1, $2, $3, $4)', [slug, tid, phone, JSON.stringify({ offer: '20% off' })]);
const balance = async (db) => Number(await val(db, `select balance_paise from public.store_wallets where store_slug = 'krupa'`) ?? 0);
const stop = (db, phone, pin = 'good') => val(db, 'select public.seller_record_optout($1, $2, $3)', ['krupa', pin, phone]);

// ═══ the rule ════════════════════════════════════════════════════════════════

test('offers reach every customer of the shop — not only those who ticked the box', async () => {
  const db = await world();
  const tid = await ready(db);
  await fund(db);
  await order(db, '9822555192');                       // never saw or ticked the box
  await order(db, '9822555193', { name: 'Ravi K' });
  await consent(db, '9822555193', true);               // ticked it
  await order(db, '9822555194', { status: 'abandoned' }); // started an order: also this shop's customer
  const a = await audience(db, tid, ['9822555192', '+91 98225 55193', '9822555194']);
  assert.equal(a.eligible, 3);
  assert.equal(a.opted_out, 0);
  assert.equal(a.cost_paise, 450);
  assert.ok(!('no_consent' in a), 'the old "has not agreed" count is gone');
  const c = await claim(db, tid, '9822555192');
  assert.equal(c.ok, true);
  assert.equal(c.receiver, '919822555192');
  assert.deepEqual(Object.keys(c.values), ['1', '2', '3', '4']);
  assert.equal(c.values['1'], 'Asha');
  assert.match(c.values['4'], /^o\/[0-9a-f]{20}$/);
  assert.equal(await balance(db), 15000 - 150);
  await db.close();
});

test('never to anyone who asked to stop — unticked at checkout, or the shop recorded it', async () => {
  const db = await world();
  const tid = await ready(db);
  await fund(db);
  await order(db, '9822555192');
  await consent(db, '9822555192', true);
  await consent(db, '9822555192', false);              // ticked, then unticked
  await order(db, '9822555193', { name: 'Ravi K' });   // never ticked; asks the shop to stop
  assert.equal(await stop(db, '9822555193', 'wrong'), null, 'PIN first');
  assert.equal(await val(db, 'select count(*)::int from public.whatsapp_consents where phone = $1', ['9822555193']), 0);
  assert.equal(await stop(db, '+91 98225 55193'), true);
  assert.equal(await stop(db, '9822555193'), true);
  const rows = (await db.query(`select granted, source from public.whatsapp_consents where phone = '9822555193'`)).rows;
  assert.deepEqual(rows, [{ granted: false, source: 'seller' }], 'the stop is saved for a customer who never ticked — once');
  assert.equal(await val(db, `select public.whatsapp_opted_out('krupa', '9822555193')`), true, 'so cart reminders skip them too');
  assert.equal(await val(db, `select public.whatsapp_opted_out('other', '9822555193')`), false, 'only for this shop');

  const a = await audience(db, tid, ['9822555192', '9822555193']);
  assert.equal(a.eligible, 0);
  assert.equal(a.opted_out, 2);
  assert.equal((await claim(db, tid, '9822555192')).reason, 'opted_out');
  assert.equal((await claim(db, tid, '9822555193')).reason, 'opted_out');
  assert.equal(await balance(db), 15000, 'nothing charged');
  // Ticking the box again at a later checkout lets offers through again.
  await consent(db, '9822555193', true);
  assert.equal((await audience(db, tid, ['9822555193'])).eligible, 1);
  await db.close();
});

test('unchanged: once every 3 days, only this shop\'s customers, valid numbers, paid from the wallet', async () => {
  const db = await world();
  const tid = await ready(db);
  await fund(db, 150);
  await order(db, '9822555192');
  await order(db, '9822555195', { slug: 'other' });
  const first = await claim(db, tid, '9822555192');
  assert.equal(first.ok, true);
  await db.query('select public.offer_finish($1, true, 200, null)', [first.send_id]);
  assert.equal((await claim(db, tid, '9822555192')).reason, 'recent');
  assert.equal((await claim(db, tid, '9822555195')).reason, 'not_customer');
  assert.equal((await claim(db, tid, '12345')).reason, 'invalid');
  await order(db, '9822555196');
  assert.equal((await claim(db, tid, '9822555196')).reason, 'no_balance');
  const a = await audience(db, tid, ['9822555192', '9822555195', '12345', '9822555196']);
  assert.deepEqual([a.eligible, a.recent, a.other], [1, 1, 2]);
  assert.equal(await audience(db, tid, ['9822555196'], 'wrong'), null);
  await db.close();
});

// ═══ the migration ═══════════════════════════════════════════════════════════

test('the browser can check who gets it and record a stop, but never send', async () => {
  const db = await world();
  const can = (role, key) => val(db, `select has_function_privilege($1, $2, 'EXECUTE')`, [role, SIGS[key]]);
  assert.equal(await can('anon', 'audience'), true);
  assert.equal(await can('anon', 'optout'), true);
  assert.equal(await can('anon', 'claim'), false);
  assert.equal(await can('authenticated', 'claim'), false);
  assert.equal(await can('service_role', 'claim'), true);
  for (const key of Object.keys(SIGS)) {
    const p = (await db.query(`select prosecdef, array_to_string(proconfig, ',') cfg from pg_proc where oid = to_regprocedure($1)`, [SIGS[key]])).rows[0];
    assert.deepEqual(p, { prosecdef: true, cfg: 'search_path=public, pg_temp' }, key);
  }
  await db.close();
});

test('safe to run twice; the verifier passes; the undo puts the old bodies back exactly', async () => {
  const db = await world({ install: false });
  for (const k of Object.keys(SIGS)) assert.equal(await md5(db, k), OLD[k], `the old ${k} is the reviewed one`);
  await db.exec(FORWARD);
  await db.exec(FORWARD);
  for (const k of Object.keys(SIGS)) assert.equal(await md5(db, k), NEW[k], `new ${k}`);
  const rows = (await db.query(VERIFY)).rows;
  assert.deepEqual(rows.filter((r) => r.grp.startsWith('C')).map((r) => r.result), ['PASS', 'PASS', 'PASS', 'PASS']);
  const tid = await ready(db);
  await order(db, '9822555192');
  await consent(db, '9822555193', true);
  await order(db, '9822555193');
  assert.equal(rows.length, 5);
  assert.equal((await db.query(VERIFY)).rows.find((r) => r.grp === 'I1').result, '1 / 2');

  await db.exec(ROLLBACK);
  await db.exec(ROLLBACK);
  for (const k of Object.keys(SIGS)) assert.equal(await md5(db, k), OLD[k], `old ${k} restored byte for byte`);
  assert.equal((await audience(db, tid, ['9822555192'])).no_consent, 1, 'back to: only those who ticked');
  assert.deepEqual((await db.query(VERIFY)).rows.filter((r) => r.grp.startsWith('C')).map((r) => r.result).slice(0, 2), ['FAIL', 'FAIL']);
  await db.exec(FORWARD);
  for (const k of Object.keys(SIGS)) assert.equal(await md5(db, k), NEW[k]);
  // C2 on its own: a body that still asks "ticked the box?" fails it.
  await db.exec(`update pg_proc set prosrc = prosrc || ' -- whatsapp_consent_granted' where oid = to_regprocedure('${SIGS.claim}')`);
  assert.equal((await db.query(VERIFY)).rows.find((r) => r.grp === 'C2').result, 'FAIL');
  await db.close();
});

test('it refuses to replace a version nobody reviewed — and changes nothing', async () => {
  for (const key of Object.keys(SIGS)) {
    const db = await world({ install: false });
    const fn = { audience: 'offer_audience', claim: 'offer_claim', optout: 'seller_record_optout' }[key];
    await db.exec(`update pg_proc set prosrc = prosrc || ' ' where oid = to_regprocedure('${SIGS[key]}')`);
    const before = {};
    for (const k of Object.keys(SIGS)) before[k] = await md5(db, k);
    await assert.rejects(db.exec(FORWARD), new RegExp(`${fn}.*not the reviewed version`));
    await db.exec('rollback');
    for (const k of Object.keys(SIGS)) assert.equal(await md5(db, k), before[k], `${k} untouched`);
    await db.close();
  }
  const bare = new PGlite();
  await assert.rejects(bare.exec(FORWARD), /whatsapp_opted_out is missing/);
  await bare.close();
});

// ═══ the app ═════════════════════════════════════════════════════════════════

test('Send an offer says who asked to stop — not who "has not agreed"', () => {
  const panel = strip(read('src/components/manage/OffersPanel.jsx'));
  assert.match(panel, /check\.opted_out > 0 && `\$\{check\.opted_out\} asked to stop offers\. `/);
  assert.ok(!/no_consent|haven.t agreed/.test(panel));
  const tab = read('src/components/manage/CustomersTab.jsx');
  assert.ok(!/only to customers\s+\*\s+who agreed at checkout/.test(tab));
  assert.match(tab, /recordOptOut\(slug, pin, c\.phone\)/, 'the Stop button still records the stop');
});
