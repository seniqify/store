// WhatsApp marketing consent at checkout (supabase/whatsapp-consent-*.sql,
// src/utils/whatsappConsent.js, the checkbox in CustomerDetailsForm).
// The SQL runs in PGlite under Supabase-like default grants.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { optInWording, rememberedOptIn, rememberOptIn } from '../src/utils/whatsappConsent.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = (p) => readFileSync(`${ROOT}${p}`, 'utf8').replace(/\r\n/g, '\n');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
const FORWARD = read('supabase/whatsapp-consent-forward.sql');
const ROLLBACK = read('supabase/whatsapp-consent-ROLLBACK.sql');
const VERIFY = read('supabase/whatsapp-consent-verify.sql');

async function world({ install = true } = {}) {
  const db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
    alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
    grant usage on schema public to anon, authenticated, service_role;
    create table public.stores (slug text primary key);
    insert into public.stores values ('krupa'), ('other');`);
  if (install) await db.exec(FORWARD);
  return db;
}
const val = async (db, sql, params = []) => Object.values((await db.query(sql, params)).rows[0])[0];
const record = (db, slug, phone, granted, wording = 'Get offers & cart reminders on WhatsApp. From Krupa. You can stop anytime.') =>
  val(db, 'select public.record_whatsapp_consent($1, $2, $3, $4)', [slug, phone, granted, wording]);
const granted = (db, slug, phone) => val(db, 'select public.whatsapp_consent_granted($1, $2)', [slug, phone]);
const rows = async (db) => Number(await val(db, 'select count(*) from public.whatsapp_consents'));

test('no record means no: a customer who never ticked gets no marketing', async () => {
  const db = await world();
  assert.equal(await granted(db, 'krupa', '9822555192'), false);
  await db.close();
});

test('the latest choice for this shop decides; repeating it writes nothing', async () => {
  const db = await world();
  assert.equal(await record(db, 'krupa', '9822555192', true), true);
  assert.equal(await granted(db, 'krupa', '9822555192'), true);
  assert.equal(await record(db, 'krupa', '9822555192', true), true);
  assert.equal(await rows(db), 1, 'a repeat is not a new row');
  await record(db, 'krupa', '9822555192', false);
  assert.equal(await granted(db, 'krupa', '9822555192'), false, 'an untick withdraws it');
  await record(db, 'krupa', '9822555192', true);
  assert.equal(await granted(db, 'krupa', '9822555192'), true);
  assert.equal(await rows(db), 3, 'every real change of mind is kept as evidence');
  await db.close();
});

test('consent is per shop: agreeing to one shop is not agreeing to another', async () => {
  const db = await world();
  await record(db, 'krupa', '9822555192', true);
  assert.equal(await granted(db, 'other', '9822555192'), false);
  await db.close();
});

test('phone numbers are normalised the same way on both sides', async () => {
  const db = await world();
  await record(db, 'krupa', '+91 98225 55192', true);
  assert.equal(await granted(db, 'krupa', '9822555192'), true);
  assert.equal(await granted(db, 'krupa', '919822555192'), true);
  await db.close();
});

test('unusable input records nothing and never raises', async () => {
  const db = await world();
  assert.equal(await record(db, 'krupa', '12345', true), false, 'too short');
  assert.equal(await record(db, 'krupa', '1234567890', true), false, 'not an Indian mobile');
  assert.equal(await record(db, 'nowhere', '9822555192', true), false, 'no such store');
  assert.equal(await val(db, `select public.record_whatsapp_consent('krupa', '9822555192', null, 'x')`), false);
  assert.equal(await rows(db), 0);
  await record(db, 'krupa', '9822555192', true, 'x'.repeat(1000));
  assert.equal(Number(await val(db, 'select char_length(wording) from public.whatsapp_consents')), 300, 'wording is capped');
  await db.close();
});

test('the exact wording is kept with the choice', async () => {
  const db = await world();
  const w = optInWording('Krupa Agarbatti Work').recorded;
  await record(db, 'krupa', '9822555192', true, w);
  const r = (await db.query('select store_slug, phone, granted, source, wording from public.whatsapp_consents')).rows[0];
  assert.deepEqual(r, { store_slug: 'krupa', phone: '9822555192', granted: true, source: 'checkout',
    wording: 'Get offers & cart reminders on WhatsApp. From Krupa Agarbatti Work. You can stop anytime.' });
  await db.close();
});

test('the browser can record a choice, but cannot read the table or ask about anyone', async () => {
  const db = await world();
  await record(db, 'krupa', '9822555192', true);
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`set role ${role}`);
    await assert.rejects(db.query('select * from public.whatsapp_consents'), /permission denied/);
    await assert.rejects(db.query(`insert into public.whatsapp_consents (store_slug, phone, granted, source) values ('krupa','9000000000',true,'seller')`), /permission denied/);
    await assert.rejects(db.query(`select public.whatsapp_consent_granted('krupa', '9822555192')`), /permission denied/);
    assert.equal(await record(db, 'krupa', '9000000001', true), true);
    await db.exec('reset role');
  }
  await db.close();
});

test('verifier passes; rollback refuses once consent is recorded and is clean before', async () => {
  const db = await world();
  await record(db, 'krupa', '9822555192', true);
  await record(db, 'krupa', '9000000002', true);
  await record(db, 'krupa', '9000000002', false);
  const v = Object.fromEntries((await db.query(VERIFY)).rows.map((r) => [r.grp, r.result]));
  for (const c of ['C1', 'C2', 'C3', 'C4', 'C5']) assert.equal(v[c], 'PASS', c);
  assert.equal(v.I1, '1 / 1 / 1');
  await assert.rejects(db.exec(ROLLBACK), /REFUSED - whatsapp_consents holds 3 consent records/);
  await db.exec('rollback');
  await db.exec(FORWARD);                                    // re-run harmless
  assert.equal(await rows(db), 3);
  await db.close();

  const empty = await world();
  await empty.exec(ROLLBACK);
  await empty.exec(ROLLBACK);
  assert.equal(await val(empty, `select to_regclass('public.whatsapp_consents')`), null);
  await empty.close();
});

// ── device memory: per shop, default no ────────────────────────────────────

function memStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
}

test('the box starts unticked, and a tick is remembered for that shop only', () => {
  const s = memStorage();
  assert.equal(rememberedOptIn('krupa', s), false);
  rememberOptIn('krupa', true, s);
  assert.equal(rememberedOptIn('krupa', s), true);
  assert.equal(rememberedOptIn('other', s), false, 'never carried to another shop');
  rememberOptIn('krupa', false, s);
  assert.equal(rememberedOptIn('krupa', s), false);
  assert.equal(rememberedOptIn('krupa', { getItem: () => '{not json' }), false);
  assert.equal(rememberedOptIn('krupa', { getItem: () => { throw new Error('blocked'); } }), false);
  assert.equal(rememberedOptIn('', s), false);
});

test('the wording names the shop and says it can be stopped', () => {
  const w = optInWording('Krupa Agarbatti Work');
  assert.equal(w.title, 'Get offers & cart reminders on WhatsApp');
  assert.equal(w.detail, 'From Krupa Agarbatti Work. You can stop anytime.');
  assert.equal(optInWording('').detail, 'From this shop. You can stop anytime.');
});

test('the checkout shows the unticked box in both views and records the words it shows', () => {
  const src = strip(read('src/components/form/CustomerDetailsForm.jsx'));
  assert.match(src, /useState\(\(\) => rememberedOptIn\(config\?\.slug\)\)/, 'starts from the per-shop memory, default unticked');
  assert.match(src, /recordWhatsappConsent\(config\.slug, ph, waOptIn, optIn\.recorded\)/);
  assert.match(src, /\{optIn\.title\}/);
  assert.match(src, /\{optIn\.detail\}/);
  // The box sits after the form / welcome-back switch, so both views show it.
  const box = src.indexOf('id="cdf-wa-optin"');
  assert.ok(box > src.indexOf('Welcome back') && box > src.indexOf('id="cdf-mobile"'));
  assert.ok(!/checked=\{true\}|defaultChecked/.test(src), 'never pre-ticked');
});
