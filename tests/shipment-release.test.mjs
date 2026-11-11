// read_open_attempt + release_unsent_attempt (supabase/shipment-release-*.sql)
// on real Postgres (PGlite), on top of the REAL ledger migrations (B1 table +
// B2A claim / finalize / fail + B2A.1 terminal + resume), under Supabase-like
// default grants.
//
// shipping-book calls these only after Delhivery said, explicitly, that it has
// no parcel under an open attempt's reference. The release must then refuse
// anything that could still be a live booking: a re-send since the read
// (claimed_at moved), a send under 10 minutes ago, an AWB, an ended attempt.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

const read = (p) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), 'utf8').replace(/\r\n/g, '\n');
const LEDGER = ['supabase/shipment-attempts-forward.sql', 'supabase/shipment-claim-forward.sql',
  'supabase/shipment-terminal-forward.sql', 'supabase/shipment-resume-forward.sql'];
const FORWARD = read('supabase/shipment-release-forward.sql');
const VERIFY = read('supabase/shipment-release-verify.sql');
const ROLLBACK = read('supabase/shipment-release-ROLLBACK.sql');
const ORDER = '3f2a9c1e-7b4d-4e8a-9c3b-1d2e3f4a5b6c';
const ORDER2 = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';

async function world({ install = true } = {}) {
  const db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
    grant usage on schema public to anon, authenticated, service_role;
    create table public.orders (
      id uuid primary key, store_slug text not null, status text, awb text, courier text,
      shipment_status text, shipment_outcome text, shipping_cost numeric,
      delivered_at timestamptz, returned_at timestamptz, created_at timestamptz not null default now());
    insert into public.orders (id, store_slug, status) values
      ('${ORDER}', 'store-a', 'confirmed'), ('${ORDER2}', 'store-a', 'confirmed');`);
  for (const f of LEDGER) await db.exec(read(f));
  if (install) await db.exec(FORWARD);
  return db;
}
const val = async (db, sql, params = []) => Object.values((await db.query(sql, params)).rows[0] ?? {})[0];
const claim = (db, courier = 'delhivery', order = ORDER) =>
  val(db, 'select public.claim_shipment_attempt($1, $2, $3)', ['store-a', order, courier]);
const resume = (db, courier = 'delhivery', order = ORDER) =>
  val(db, 'select public.resume_shipment_attempt($1, $2, $3)', ['store-a', order, courier]);
const peek = (db, id, order = ORDER, slug = 'store-a') =>
  val(db, 'select public.read_open_attempt($1, $2, $3)', [slug, order, id]);
// claimed_at goes in as the JSON text read_open_attempt gave -- exactly what
// shipping-book sends back through PostgREST.
const release = (db, id, claimedAt, order = ORDER, slug = 'store-a') =>
  val(db, 'select public.release_unsent_attempt($1, $2, $3, $4::timestamptz, $5)', [slug, order, id, claimedAt, 'no parcel at Delhivery']);
const age = (db, secs, order = ORDER) =>
  db.query(`update public.shipment_attempts set claimed_at = now() - make_interval(secs => $2) where order_id = $1 and end_reason is null`, [order, secs]);

test('read_open_attempt: the open attempt, exactly; anything else is not_open', async () => {
  const db = await world();
  const c = await claim(db);
  const p = await peek(db, c.attempt_id);
  assert.equal(p.outcome, 'open');
  assert.equal(p.attempt_id, c.attempt_id);
  assert.equal(p.attempt_no, 1);
  assert.equal(p.courier, 'delhivery');
  const exact = await val(db, `select to_jsonb(claimed_at) #>> '{}' from public.shipment_attempts where id = $1`, [c.attempt_id]);
  assert.equal(p.claimed_at, exact, 'claimed_at to the microsecond');
  assert.equal((await peek(db, c.attempt_id, ORDER2)).outcome, 'not_open', 'another order');
  assert.equal((await peek(db, c.attempt_id, ORDER, 'store-b')).outcome, 'not_open', 'another store');
  assert.equal((await peek(db, 999999)).outcome, 'not_open');
  await db.query(`update public.shipment_attempts set awb = 'LIVE1' where id = $1`, [c.attempt_id]);
  assert.equal((await peek(db, c.attempt_id)).outcome, 'not_open', 'an attempt holding an AWB');
  await db.close();
});

test('release: an unchanged, 10-minute-quiet attempt is released; the order can be claimed again with ANY courier', async () => {
  const db = await world();
  const c = await claim(db);
  await age(db, 601);
  const p = await peek(db, c.attempt_id);
  assert.deepEqual(await release(db, c.attempt_id, p.claimed_at), { outcome: 'released', attempt_id: c.attempt_id });
  const row = (await db.query('select end_reason, final_status, ended_at from public.shipment_attempts where id = $1', [c.attempt_id])).rows[0];
  assert.equal(row.end_reason, 'failed');
  assert.equal(row.final_status, 'no parcel at Delhivery');
  assert.ok(row.ended_at);
  const again = await claim(db, 'shadowfax');
  assert.equal(again.outcome, 'claimed');
  assert.equal(again.attempt_no, 2, 'a NEW attempt, so a NEW reference');
  assert.equal((await release(db, c.attempt_id, p.claimed_at)).outcome, 'attempt_terminal', 'never twice');
  await db.close();
});

test('release: under 10 quiet minutes => too_soon, with the seconds left; nothing changes', async () => {
  const db = await world();
  const c = await claim(db);
  await age(db, 240);
  const p = await peek(db, c.attempt_id);
  const r = await release(db, c.attempt_id, p.claimed_at);
  assert.equal(r.outcome, 'too_soon');
  assert.ok(r.retry_in >= 359 && r.retry_in <= 360, String(r.retry_in));
  assert.equal((await peek(db, c.attempt_id)).outcome, 'open');
  await db.close();
});

test('release: a re-send since the read (resume moved claimed_at) => sent_again; nothing changes', async () => {
  const db = await world();
  const c = await claim(db);
  await age(db, 3600);
  const p = await peek(db, c.attempt_id);
  assert.equal((await resume(db)).outcome, 'resumed', 'the merchant pressed Delhivery meanwhile');
  assert.equal((await release(db, c.attempt_id, p.claimed_at)).outcome, 'sent_again');
  await age(db, 3600);
  assert.equal((await release(db, c.attempt_id, p.claimed_at)).outcome, 'sent_again', 'even once it is old again: the read is stale');
  assert.equal((await release(db, c.attempt_id, null)).outcome, 'sent_again', 'no claimed_at, no release');
  assert.equal((await peek(db, c.attempt_id)).outcome, 'open');
  await db.close();
});

test('release: an AWB, an ended attempt, another order or store => refused', async () => {
  const db = await world();
  const c = await claim(db);
  await age(db, 3600);
  const p = await peek(db, c.attempt_id);
  assert.equal((await release(db, c.attempt_id, p.claimed_at, ORDER2)).outcome, 'attempt_not_found');
  assert.equal((await release(db, c.attempt_id, p.claimed_at, ORDER, 'store-b')).outcome, 'order_not_found');
  await db.query(`update public.shipment_attempts set awb = 'LIVE1' where id = $1`, [c.attempt_id]);
  assert.deepEqual(await release(db, c.attempt_id, p.claimed_at), { outcome: 'attempt_has_awb', awb: 'LIVE1' });
  const c2 = await claim(db, 'delhivery', ORDER2);
  await age(db, 3600, ORDER2);
  const p2 = await peek(db, c2.attempt_id, ORDER2);
  await val(db, `select public.fail_shipment_attempt($1, 'store-a', 'refused')`, [c2.attempt_id]);
  assert.deepEqual(await release(db, c2.attempt_id, p2.claimed_at, ORDER2), { outcome: 'attempt_terminal', end_reason: 'failed' });
  await db.close();
});

test('service role only; idempotent; the verifier passes; the undo drops both', async () => {
  const db = await world();
  for (const fn of ['public.read_open_attempt(text,uuid,bigint)', 'public.release_unsent_attempt(text,uuid,bigint,timestamptz,text)']) {
    const can = (role) => val(db, `select has_function_privilege($1, $2, 'EXECUTE')`, [role, fn]);
    assert.equal(await can('anon'), false, fn);
    assert.equal(await can('authenticated'), false, fn);
    assert.equal(await can('service_role'), true, fn);
  }
  await db.exec(FORWARD);
  const rows = (await db.query(VERIFY)).rows;
  assert.deepEqual(rows.filter((r) => r.grp.startsWith('C')).map((r) => r.result), ['PASS', 'PASS', 'PASS', 'PASS']);
  await claim(db);
  assert.equal((await db.query(VERIFY)).rows.find((r) => r.grp === 'I1').result, '0 / 1');
  await db.exec(ROLLBACK);
  await db.exec(ROLLBACK);
  assert.equal(await val(db, `select to_regprocedure('public.release_unsent_attempt(text,uuid,bigint,timestamptz,text)')::text`), null);
  assert.equal(await val(db, `select to_regprocedure('public.read_open_attempt(text,uuid,bigint)')::text`), null);
  assert.equal((await resume(db)).outcome, 'too_soon', 'the ledger works as before');
  await db.close();
});

test('refuses to install without the ledger', async () => {
  const db = new PGlite();
  await assert.rejects(db.exec(FORWARD), /shipment ledger .* is missing/);
  await db.close();
});
