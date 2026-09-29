// PR-B.1 (reconciler leases + ordered health results), executed against the
// real migration files in PGlite. Single connection: this file proves the
// logic, bounds, grants, install and exact rollback. Concurrent locking is
// proven against real PostgreSQL in tests/custom-domains-lease-pg.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import {
  BASELINE, FORWARD, LEASE_FORWARD, LEASE_VERIFY, LEASE_ROLLBACK, freshDb, asRole, refused,
} from './helpers/domainDb.mjs';

const PRB_HEALTH_MD5 = 'fa0d5fd7ebc53344a90534c9def84d1e';
const NEW_FNS = ['domain_reconcile_lease', 'store_domain_health_interval', 'store_domain_lease_seconds',
  'store_domain_lease_batch_max'];

/** Every public function and relation, as comparable strings. */
async function catalog(d) {
  const fns = (await d.query(`
    select p.oid::regprocedure::text || ':' || md5(replace(p.prosrc, chr(13), '')) || ':' || p.prosecdef::text || ':' ||
           coalesce(array_to_string(p.proconfig, ','), '') || ':' || coalesce(array_to_string(p.proacl, ','), '') as x
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' order by 1`)).rows.map((r) => r.x);
  const rels = (await d.query(`
    select c.relname || ':' || c.relkind::text || ':' || c.relrowsecurity::text || ':' || coalesce(array_to_string(c.relacl, ','), '') as x
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' order by 1`)).rows.map((r) => r.x);
  const cons = (await d.query(`
    select c.conrelid::regclass::text || ':' || c.conname || ':' || pg_get_constraintdef(c.oid) as x
      from pg_constraint c join pg_namespace n on n.oid = c.connamespace where n.nspname = 'public' order by 1`)).rows.map((r) => r.x);
  const trg = (await d.query(`
    select t.tgrelid::regclass::text || ':' || t.tgname as x from pg_trigger t
      join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and not t.tgisinternal order by 1`)).rows.map((r) => r.x);
  return { fns, rels, cons, trg };
}

let n = 0;
async function verifiedGroup(d, { host = `lease${++n}.com`, slug = `ls${n}` } = {}) {
  await d.query('insert into public.stores (slug) values ($1)', [slug]);
  const c = (await d.query(`select public.domain_claim($1, $2, 'apex') as r`, [slug, host])).rows[0].r;
  const v = (await d.query(`select public.domain_mark_verified($1, $2, $3) as r`, [c.group_id, slug, c.txt_token])).rows[0].r;
  assert.equal(v.outcome, 'verified');
  return { slug, host, group_id: c.group_id, token: c.txt_token };
}
/** Straight to connected, as the RPCs would get there (challenge created and used). */
async function connectedGroup(d) {
  const g = await verifiedGroup(d);
  for (const h of [g.host, `www.${g.host}`]) {
    await d.query(`select public.domain_vercel_intent($1, $2, $3, 'add')`, [g.group_id, g.slug, h]);
    await d.query(`select public.domain_vercel_observe($1, $2, $3, true, true, false)`, [g.group_id, g.slug, h]);
  }
  await d.query('select public.domain_mark_ready($1, $2)', [g.group_id, g.slug]);
  const hash = 'b'.repeat(64);
  const ch = (await d.query(`select public.domain_challenge_create($1, $2, 'activate', $3, $4) as r`,
    [g.slug, g.group_id, g.host, hash])).rows[0].r;
  const a = (await d.query('select public.domain_activate($1, $2, $3, $4, $5) as r',
    [g.group_id, g.slug, g.token, ch.challenge_id, hash])).rows[0].r;
  assert.equal(a.outcome, 'connected');
  return g;
}
const lease = async (d, limit = 1) => (await d.query('select * from public.domain_reconcile_lease($1)', [limit])).rows;
const lapse = (d) => d.query(`update public.store_domain_reconcile set lease_until = now() - interval '1 second' where lease_until is not null`);
const due = (d, g) => d.query(`update public.store_domains set last_checked_at = now() - interval '61 minutes' where group_id = $1`, [g.group_id]);
const health = async (d, g, token, ok) => (await d.query(
  'select public.domain_health_update($1, $2, $3, $4) as r', [g.group_id, g.slug, token, ok])).rows[0].r;

// ═══════════════════════════════════════════════════════════════════════════
// Install, verify, exact rollback
// ═══════════════════════════════════════════════════════════════════════════

test('applies on PR-B, re-runs, and changes nothing but its own objects and the one replaced function', async () => {
  const d = await freshDb();
  const before = await catalog(d);
  await d.exec(LEASE_FORWARD);
  await d.exec(LEASE_FORWARD);
  const after = await catalog(d);
  const gone = before.fns.filter((x) => !after.fns.includes(x));
  assert.deepEqual(gone.map((x) => x.split(':')[0]), ['domain_health_update(uuid,text,boolean,text)']);
  const added = after.fns.filter((x) => !before.fns.includes(x)).map((x) => x.split(':')[0]).sort();
  assert.deepEqual(added, ['domain_health_update(uuid,text,uuid,boolean,text)', 'domain_reconcile_lease(integer)',
    'store_domain_health_interval()', 'store_domain_lease_batch_max()', 'store_domain_lease_seconds()']);
  assert.deepEqual(after.rels.filter((x) => !before.rels.includes(x)).map((x) => x.split(':')[0]).sort(),
    ['store_domain_reconcile', 'store_domain_reconcile_fair_idx', 'store_domain_reconcile_pkey']);
  assert.deepEqual(before.rels.filter((x) => !after.rels.includes(x)), [], 'no existing relation changed');
  assert.deepEqual(before.cons.filter((x) => !after.cons.includes(x)), [], 'no existing constraint changed');
  assert.deepEqual(before.trg.filter((x) => !after.trg.includes(x)), [], 'no existing trigger changed');
  await d.close();
});

test('refuses without PR-B, and refuses if domain_health_update is not the reviewed PR-B definition', async () => {
  const bare = new PGlite();
  await bare.exec(BASELINE);
  assert.match((await refused(bare.exec(LEASE_FORWARD))).message, /PR-B .* is not installed/);
  await bare.close();

  const d = await freshDb();
  await d.exec(`create or replace function public.domain_health_update(p_group_id uuid, p_store_slug text, p_ok boolean, p_error text default null)
                returns jsonb language sql as $$ select '{"outcome":"tampered"}'::jsonb $$`);
  assert.match((await refused(d.exec(LEASE_FORWARD))).message, /not the reviewed PR-B definition/);
  await d.exec('rollback');
  assert.equal((await d.query(`select to_regclass('public.store_domain_reconcile') as t`)).rows[0].t, null);
  await d.close();
});

test('rollback restores the exact PR-B state -- including domain_health_update, byte for byte, with its grants', async () => {
  const d = await freshDb();
  const prb = await catalog(d);
  await d.exec(LEASE_FORWARD);
  await verifiedGroup(d);
  await lease(d);
  assert.match((await refused(d.exec(LEASE_ROLLBACK))).message, /lease\(s\) still running/);
  await d.exec('rollback');
  await lapse(d);
  await d.exec(LEASE_ROLLBACK);
  await d.exec(LEASE_ROLLBACK);                                   // idempotent
  const back = await catalog(d);
  assert.deepEqual(back.fns, prb.fns);
  assert.deepEqual(back.rels, prb.rels);
  assert.deepEqual(back.cons, prb.cons);
  assert.deepEqual(back.trg, prb.trg);
  const md5 = (await d.query(`select md5(replace(prosrc, chr(13), '')) as m from pg_proc
                               where oid = 'public.domain_health_update(uuid,text,boolean,text)'::regprocedure`)).rows[0].m;
  assert.equal(md5, PRB_HEALTH_MD5);
  await d.close();
});

test('verify: before (P1 PASS, L N/A), after (every L row PASS), after rollback (P1 PASS again)', async () => {
  const d = await freshDb();
  const rows = async () => Object.fromEntries((await d.query(LEASE_VERIFY)).rows.map((r) => [r.grp, r.result]));
  let r = await rows();
  assert.equal(r.P1, 'PASS');
  for (const k of ['L01', 'L02', 'L03', 'L04', 'L05', 'L06']) assert.equal(r[k], 'N/A - not installed', k);
  await d.exec(LEASE_FORWARD);
  await verifiedGroup(d);
  r = await rows();
  for (const k of ['L01', 'L02', 'L03', 'L04', 'L05']) assert.equal(r[k], 'PASS', `${k}: ${r[k]}`);
  assert.equal(r.L06, '0');
  assert.equal(r.L07, 'verified=2', 'the corrected status count');
  await d.exec(LEASE_ROLLBACK);
  assert.equal((await rows()).P1, 'PASS');
  await d.close();
});

// ═══════════════════════════════════════════════════════════════════════════
// Grants
// ═══════════════════════════════════════════════════════════════════════════

test('grants: the lease table is closed to every role; the two RPCs are service_role only; helpers callable by nobody', async () => {
  const d = await freshDb({ lease: true });
  for (const role of ['anon', 'authenticated', 'service_role']) {
    assert.equal((await refused(asRole(d, role, 'select * from public.store_domain_reconcile'))).code, '42501', role);
    assert.equal((await refused(asRole(d, role, `update public.store_domain_reconcile set lease_until = null`))).code, '42501', role);
  }
  for (const role of ['anon', 'authenticated']) {
    assert.equal((await refused(asRole(d, role, 'select * from public.domain_reconcile_lease(1)'))).code, '42501', role);
  }
  await asRole(d, 'service_role', 'select * from public.domain_reconcile_lease(1)');
  for (const fn of NEW_FNS.slice(1)) {
    for (const role of ['anon', 'authenticated', 'service_role']) {
      assert.equal((await refused(asRole(d, role, `select public.${fn}()`))).code, '42501', `${role} ${fn}`);
    }
  }
  await d.close();
});

// ═══════════════════════════════════════════════════════════════════════════
// Lease semantics (single connection)
// ═══════════════════════════════════════════════════════════════════════════

test('bounds are server-side: batch clamped to 1..5, lease fixed at 120 s whatever the caller asks', async () => {
  const d = await freshDb({ lease: true });
  for (let i = 0; i < 7; i++) await verifiedGroup(d);
  assert.equal((await lease(d, 0)).length, 1);
  assert.equal((await lease(d, -3)).length, 1);
  assert.equal((await lease(d, 99)).length, 5, 'never more than 5');
  const secs = (await d.query(`select extract(epoch from lease_until - now())::int as s from public.store_domain_reconcile
                                 where lease_until is not null`)).rows.map((r) => r.s);
  assert.ok(secs.every((s) => s === 120), secs.join(','));
  const one = (await lease(d, 99));
  assert.ok(one.every((x) => x.lease_seconds === 120));
  await d.close();
});

test('whole groups only; eligible work only -- pending, ended and not-yet-due groups are never leased', async () => {
  const d = await freshDb({ lease: true });
  await d.query(`insert into public.stores (slug) values ('pend')`);
  await d.query(`select public.domain_claim('pend', 'pending1.com', 'apex')`);          // pending: never leased
  const ended = await verifiedGroup(d);
  await d.query(`select public.domain_begin_disconnect($1, $2, 'admin')`, [ended.group_id, ended.slug]);
  const conn = await connectedGroup(d);                                                   // connected, checked just now? never checked -> due
  const got = await lease(d, 5);
  assert.deepEqual(got.map((x) => [x.store_slug, x.work, x.status]), [[conn.slug, 'health', 'connected']]);
  assert.ok(got[0].health_token, 'a due health check carries a token');
  const locks = (await d.query('select count(*)::int as n from public.store_domain_reconcile')).rows[0].n;
  assert.equal(locks, 1, 'one reconcile row per group -- never per hostname');
  // Recorded a result just now: not due for an hour, so not eligible even with the lease lapsed.
  assert.equal((await health(d, conn, got[0].health_token, true)).outcome, 'connected');
  await lapse(d);
  assert.deepEqual(await lease(d, 5), []);
  await due(d, conn);
  assert.equal((await lease(d, 5))[0].work, 'health');
  await d.close();
});

test('fair order: never-served first, then least-recently-served; a held lease is never handed out twice', async () => {
  const d = await freshDb({ lease: true });
  const gs = [await verifiedGroup(d), await verifiedGroup(d), await verifiedGroup(d)];
  const served = [];
  for (let i = 0; i < 3; i++) served.push((await lease(d, 1))[0].group_id);
  assert.deepEqual([...served].sort(), gs.map((g) => g.group_id).sort(), 'each group once before any twice');
  assert.deepEqual(await lease(d, 1), [], 'all held');
  await lapse(d);
  const again = [];
  for (let i = 0; i < 3; i++) { again.push((await lease(d, 1))[0].group_id); }
  assert.deepEqual(again, served, 'the same round-robin order: oldest service first');
  await d.close();
});

test('health tokens: consumed once, refused when stale, refused when older than a lease, refused when absent', async () => {
  const d = await freshDb({ lease: true });
  const g = await connectedGroup(d);
  const [a] = await lease(d, 1);
  assert.deepEqual(await health(d, g, a.health_token, false), { outcome: 'connected', failures: 1 });
  assert.equal((await health(d, g, a.health_token, false)).outcome, 'stale_check', 'consumed');
  assert.equal((await health(d, g, null, false)).outcome, 'stale_check');
  // A newer lease supersedes an older token.
  await due(d, g); await lapse(d);
  const [b] = await lease(d, 1);
  await due(d, g); await lapse(d);
  const [c] = await lease(d, 1);
  assert.equal((await health(d, g, b.health_token, true)).outcome, 'stale_check', 'a delayed older result');
  assert.deepEqual(await health(d, g, c.health_token, false), { outcome: 'misconfigured', failures: 2 });
  // A token older than one lease is refused even if nothing replaced it.
  await due(d, g); await lapse(d);
  const [e] = await lease(d, 1);
  await d.query(`update public.store_domain_reconcile set health_token_at = now() - interval '121 seconds' where group_id = $1`, [g.group_id]);
  assert.equal((await health(d, g, e.health_token, true)).outcome, 'stale_check');
  const f = (await d.query('select consecutive_health_failures as f, status from public.store_domains where group_id = $1 limit 1', [g.group_id])).rows[0];
  assert.deepEqual(f, { f: 2, status: 'misconfigured' }, 'only authorised, current results ever counted');
  await d.close();
});

test('lease constants are the ones the app relies on: 1-hour interval, 120-s lease > 2 x maxDuration, batch 5', async () => {
  const d = await freshDb({ lease: true });
  const r = (await d.query(`select public.store_domain_health_interval()::text as i, public.store_domain_lease_seconds() as l,
                                   public.store_domain_lease_batch_max() as b`)).rows[0];
  assert.deepEqual(r, { i: '01:00:00', l: 120, b: 5 });
  const { readFileSync } = await import('node:fs');
  const vj = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  const maxDuration = vj.functions['api/domains/reconcile.js'].maxDuration;
  assert.ok(r.l >= 2 * maxDuration, 'a lease outlives any worker that could hold it');
  await d.close();
});
