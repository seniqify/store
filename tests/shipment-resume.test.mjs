// resume_shipment_attempt (supabase/shipment-resume-*.sql) on real Postgres
// (PGlite), on top of the REAL ledger migrations (B1 table + B2A claim /
// finalize / fail + B2A.1 terminal), under Supabase-like default grants.
//
// The function hands an order's OPEN attempt without an AWB back to
// shipping-book after 2 quiet minutes, so the SAME courier reference can be
// sent again -- an unconfirmed booking never locks an order for good, and two
// presses can never both re-send.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

const read = (p) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), 'utf8').replace(/\r\n/g, '\n');
const LEDGER = ['supabase/shipment-attempts-forward.sql', 'supabase/shipment-claim-forward.sql', 'supabase/shipment-terminal-forward.sql'];
const FORWARD = read('supabase/shipment-resume-forward.sql');
const VERIFY = read('supabase/shipment-resume-verify.sql');
const ROLLBACK = read('supabase/shipment-resume-ROLLBACK.sql');
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
const claim = (db, courier = 'shadowfax', order = ORDER, slug = 'store-a') =>
  val(db, 'select public.claim_shipment_attempt($1, $2, $3)', [slug, order, courier]);
const resume = (db, courier = 'shadowfax', order = ORDER, slug = 'store-a') =>
  val(db, 'select public.resume_shipment_attempt($1, $2, $3)', [slug, order, courier]);
/** Pretend the last send was `secs` seconds ago. */
const age = (db, secs, order = ORDER) =>
  db.query(`update public.shipment_attempts set claimed_at = now() - make_interval(secs => $2) where order_id = $1 and end_reason is null`, [order, secs]);

test('a fresh claim cannot be resumed for 2 minutes; then the SAME attempt comes back, once', async () => {
  const db = await world();
  const c = await claim(db);
  assert.equal(c.outcome, 'claimed');
  const soon = await resume(db);
  assert.equal(soon.outcome, 'too_soon');
  assert.ok(soon.retry_in >= 119 && soon.retry_in <= 120, String(soon.retry_in));
  await age(db, 119);
  assert.equal((await resume(db)).outcome, 'too_soon');
  await age(db, 121);
  const r = await resume(db);
  assert.deepEqual(r, { outcome: 'resumed', attempt_id: c.attempt_id, attempt_no: c.attempt_no, courier: 'shadowfax' });
  assert.equal((await resume(db)).outcome, 'too_soon', 'resuming restarts the 2 minutes: a second press sends nothing');
  assert.equal(await val(db, 'select count(*)::int from public.shipment_attempts'), 1, 'never a new attempt');
  assert.equal((await claim(db)).outcome, 'open_without_awb', 'and the claim still sees it open');
  await db.close();
});

test('it never hands back anything but an open attempt without an AWB, for this store and courier', async () => {
  const db = await world();
  assert.equal((await resume(db)).outcome, 'nothing_open');
  assert.equal((await resume(db, 'fedex')).outcome, 'invalid_courier');
  assert.equal((await resume(db, 'shadowfax', ORDER, 'store-b')).outcome, 'order_not_found', 'another store sees nothing');
  const c = await claim(db);
  await age(db, 600);
  assert.equal((await resume(db, 'delhivery')).outcome, 'other_courier');
  assert.equal((await resume(db, 'delhivery')).courier, 'shadowfax');
  assert.equal((await resume(db, 'Shadowfax ')).outcome, 'resumed', 'courier normalised like the claim');
  // Finalized: the order has its AWB.
  await age(db, 600);
  const fin = await val(db, `select public.finalize_shipment_attempt($1, 'store-a', 'shadowfax', 'SF1', 55, 'new')`, [c.attempt_id]);
  assert.equal(fin.outcome, 'finalized');
  assert.deepEqual(await resume(db), { outcome: 'already_booked', awb: 'SF1' });
  // Released (failed): nothing open.
  const c2 = await claim(db, 'shadowfax', ORDER2);
  await val(db, `select public.fail_shipment_attempt($1, 'store-a', 'refused')`, [c2.attempt_id]);
  assert.equal((await resume(db, 'shadowfax', ORDER2)).outcome, 'nothing_open');
  // Cancelled orders are not bookable.
  await db.query(`update public.orders set status = 'cancelled' where id = $1`, [ORDER2]);
  assert.equal((await resume(db, 'shadowfax', ORDER2)).outcome, 'order_not_bookable');
  await db.close();
});

test('an open attempt that already holds an AWB is never resumed', async () => {
  const db = await world();
  const c = await claim(db);
  await db.query(`update public.shipment_attempts set awb = 'LIVE1' where id = $1`, [c.attempt_id]);
  await age(db, 600);
  assert.deepEqual(await resume(db), { outcome: 'open_with_awb', attempt_id: c.attempt_id, awb: 'LIVE1' });
  await db.close();
});

test('a resume changes claimed_at and nothing else', async () => {
  const db = await world();
  await claim(db);
  await age(db, 600);
  const before = (await db.query('select * from public.shipment_attempts')).rows[0];
  await resume(db);
  const after = (await db.query('select * from public.shipment_attempts')).rows[0];
  assert.ok(after.claimed_at > before.claimed_at);
  for (const k of Object.keys(before).filter((k) => k !== 'claimed_at')) assert.deepEqual(after[k], before[k], k);
  await db.close();
});

test('service role only; idempotent; the verifier passes; the undo drops it', async () => {
  const db = await world();
  const can = (role) => val(db, `select has_function_privilege($1, 'public.resume_shipment_attempt(text,uuid,text)', 'EXECUTE')`, [role]);
  assert.equal(await can('anon'), false);
  assert.equal(await can('authenticated'), false);
  assert.equal(await can('service_role'), true);
  await db.exec(FORWARD);
  const rows = (await db.query(VERIFY)).rows;
  assert.deepEqual(rows.filter((r) => r.grp.startsWith('C')).map((r) => r.result), ['PASS', 'PASS', 'PASS']);
  await claim(db);
  assert.equal((await db.query(VERIFY)).rows.find((r) => r.grp === 'I1').result, '1 / 0');
  await db.exec(ROLLBACK);
  await db.exec(ROLLBACK);
  assert.equal(await val(db, `select to_regprocedure('public.resume_shipment_attempt(text,uuid,text)')::text`), null);
  assert.equal((await claim(db, 'shadowfax', ORDER2)).outcome, 'claimed', 'the ledger works as before');
  await db.close();
});

test('refuses to install without the ledger', async () => {
  const db = new PGlite();
  await assert.rejects(db.exec(FORWARD), /shipment ledger .* is missing/);
  await db.close();
});
