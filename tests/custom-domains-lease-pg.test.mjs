// PR-B.1 concurrency, against REAL PostgreSQL with separate connections.
// PGlite is a single connection and cannot show locking behaviour; this can.
//
// Runs only when DOMAINS_PG_TEST_URL points at a LOCAL PostgreSQL, e.g.
//   DOMAINS_PG_TEST_URL=postgres://postgres:pw@127.0.0.1:5432/postgres
// Any other host is refused outright: this must never touch a shared or
// production database. Each run creates its own throwaway database (with the
// Supabase-shaped baseline, PR-B and PR-B.1 applied from the repo files) and
// drops it afterwards.
//
// What it proves:
//   * overlapping workers never lease the same group (explicit interleaving,
//     and 8 connections at once);
//   * a worker that cannot lock EVERY row of a group skips the WHOLE group and
//     leaves no lock or lease behind;
//   * leases and the domain RPCs share one lock order: no waiting past NOWAIT,
//     no deadlock either way round;
//   * one authorised health result counts once, even from overlapping workers;
//   * a delayed older result can never overwrite a newer one.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import pg from 'pg';
import { FORWARD, LEASE_FORWARD } from './helpers/domainDb.mjs';

const URL_ENV = process.env.DOMAINS_PG_TEST_URL || '';
const LOCAL = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
let skip = false;
if (!URL_ENV) skip = 'set DOMAINS_PG_TEST_URL to a LOCAL PostgreSQL to run the real-concurrency tests';
else if (!LOCAL.has(new URL(URL_ENV).hostname)) throw new Error('DOMAINS_PG_TEST_URL must point at localhost -- refusing');

const PG_BASELINE = `
  do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
  do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
  do $$ begin create role service_role nologin bypassrls; exception when duplicate_object then null; end $$;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables    to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
  create table public.stores (
    id uuid primary key default gen_random_uuid(), slug text not null,
    config jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(),
    constraint stores_slug_key unique (slug));
`;

const dbName = `cd_lease_${crypto.randomBytes(4).toString('hex')}`;
const clients = [];
let admin, owner;
async function client() {
  const u = new URL(URL_ENV);
  u.pathname = `/${dbName}`;
  const c = new pg.Client({ connectionString: u.toString() });
  await c.connect();
  await c.query(`set lock_timeout = '10s'; set statement_timeout = '20s'`);
  clients.push(c);
  return c;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let n = 0;
async function verifiedGroup() {
  const slug = `pg${++n}`;
  const host = `pglease${n}.com`;
  await owner.query('insert into public.stores (slug) values ($1)', [slug]);
  const c = (await owner.query(`select public.domain_claim($1, $2, 'apex') as r`, [slug, host])).rows[0].r;
  await owner.query('select public.domain_mark_verified($1, $2, $3)', [c.group_id, slug, c.txt_token]);
  return { slug, host, group_id: c.group_id, token: c.txt_token };
}
async function connectedGroup() {
  const g = await verifiedGroup();
  for (const h of [g.host, `www.${g.host}`]) {
    await owner.query(`select public.domain_vercel_intent($1, $2, $3, 'add')`, [g.group_id, g.slug, h]);
    await owner.query('select public.domain_vercel_observe($1, $2, $3, true, true, false)', [g.group_id, g.slug, h]);
  }
  await owner.query('select public.domain_mark_ready($1, $2)', [g.group_id, g.slug]);
  const hash = 'c'.repeat(64);
  const ch = (await owner.query(`select public.domain_challenge_create($1, $2, 'activate', $3, $4) as r`,
    [g.slug, g.group_id, g.host, hash])).rows[0].r;
  const a = (await owner.query('select public.domain_activate($1, $2, $3, $4, $5) as r',
    [g.group_id, g.slug, g.token, ch.challenge_id, hash])).rows[0].r;
  assert.equal(a.outcome, 'connected');
  return g;
}
const lease = async (c, limit) => (await c.query('select * from public.domain_reconcile_lease($1)', [limit])).rows;
const lapseAll = () => owner.query(`update public.store_domain_reconcile set lease_until = now() - interval '1 second' where lease_until is not null`);
const lapse = (g) => owner.query(`update public.store_domain_reconcile set lease_until = now() - interval '1 second' where group_id = $1`, [g.group_id]);
const makeDue = (g) => owner.query(`update public.store_domains set last_checked_at = now() - interval '61 minutes' where group_id = $1`, [g.group_id]);
const clearLeases = () => owner.query('delete from public.store_domain_reconcile');
const failuresOf = async (g) => (await owner.query(
  'select consecutive_health_failures as f from public.store_domains where group_id = $1 limit 1', [g.group_id])).rows[0].f;

test.before(async () => {
  if (skip) return;
  admin = new pg.Client({ connectionString: URL_ENV });
  await admin.connect();
  await admin.query(`create database ${dbName}`);
  owner = await client();
  await owner.query(PG_BASELINE);
  await owner.query(FORWARD);
  await owner.query(LEASE_FORWARD);
});

test.after(async () => {
  if (skip) return;
  for (const c of clients) await c.end().catch(() => {});
  await admin.query(`drop database if exists ${dbName} with (force)`).catch(() => {});
  await admin.end();
});

test('overlapping workers never lease the same group (explicit interleaving)', { skip }, async () => {
  await clearLeases();
  const groups = [];
  for (let i = 0; i < 12; i++) groups.push(await verifiedGroup());
  const [c1, c2, c3] = [await client(), await client(), await client()];
  await c1.query('begin');
  const a = await lease(c1, 5);                          // leased, rows still locked, NOT committed
  const b = await lease(c2, 5);                          // must not see or wait for c1's groups
  await c1.query('commit');
  const c = await lease(c3, 5);
  const all = [...a, ...b, ...c].map((x) => x.group_id);
  assert.deepEqual([a.length, b.length, c.length], [5, 5, 2]);
  assert.equal(new Set(all).size, all.length, 'no group leased twice');
  assert.deepEqual([...new Set(all)].sort(), groups.map((g) => g.group_id).sort());
});

test('eight simultaneous workers partition the eligible groups exactly', { skip }, async () => {
  await clearLeases();
  await lapseAll();
  const workers = [];
  for (let i = 0; i < 8; i++) workers.push(await client());
  const got = (await Promise.all(workers.map((w) => lease(w, 3)))).flat().map((x) => x.group_id);
  assert.equal(new Set(got).size, got.length, 'disjoint under real concurrency');
  const rest = await lease(workers[0], 5);
  assert.equal(rest.filter((x) => got.includes(x.group_id)).length, 0);
});

test('a single contested group goes to exactly one of eight simultaneous workers', { skip }, async () => {
  await lapseAll();
  const lone = await verifiedGroup();
  await owner.query(`update public.store_domain_reconcile set last_reconciled_at = now(), lease_until = now() + interval '1 hour',
                     lease_token = gen_random_uuid() where group_id <> $1`, [lone.group_id]);   // everyone else busy
  const workers = [];
  for (let i = 0; i < 8; i++) workers.push(await client());
  const got = (await Promise.all(workers.map((w) => lease(w, 1)))).flat();
  assert.equal(got.length, 1);
  assert.equal(got[0].group_id, lone.group_id);
});

test('partial-lock contention: if ANY row of a group is locked, the WHOLE group is skipped and nothing is left behind', { skip }, async () => {
  for (const kind of ['www', 'apex']) {
    await clearLeases();
    const g = await verifiedGroup();
    // Every other group: leased already, so only g is a candidate.
    await owner.query(`insert into public.store_domain_reconcile (group_id, last_reconciled_at, lease_until, lease_token)
                       select x.group_id, now(), now() + interval '1 hour', gen_random_uuid()
                         from (select distinct group_id from public.store_domains where group_id <> $1) x
                       on conflict (group_id) do update set lease_until = excluded.lease_until, lease_token = excluded.lease_token`, [g.group_id]);
    const [holder, worker, probe] = [await client(), await client(), await client()];
    await holder.query('begin');
    await holder.query(`select 1 from public.store_domains where group_id = $1 and kind = $2 for update`, [g.group_id, kind]);

    const t0 = Date.now();
    assert.deepEqual(await lease(worker, 5), [], `${kind} held: the group is skipped`);
    assert.ok(Date.now() - t0 < 3000, 'NOWAIT: no waiting on the held row');

    // The worker left NO lock on the other row, and no lease row.
    const other = kind === 'www' ? 'apex' : 'www';
    await probe.query('begin');
    await probe.query(`select 1 from public.store_domains where group_id = $1 and kind = $2 for update nowait`, [g.group_id, other]);
    await probe.query('rollback');
    const left = (await owner.query('select count(*)::int as n from public.store_domain_reconcile where group_id = $1', [g.group_id])).rows[0].n;
    assert.equal(left, 0, 'the skipped attempt rolled back its own insert');

    await holder.query('commit');
    const got = await lease(worker, 5);
    assert.deepEqual(got.map((x) => x.group_id), [g.group_id], 'free again: leased whole');
  }
});

test('leases and domain RPCs share one lock order: neither deadlocks the other', { skip }, async () => {
  await clearLeases();
  const g = await verifiedGroup();
  await owner.query(`insert into public.store_domain_reconcile (group_id, last_reconciled_at, lease_until, lease_token)
                     select distinct group_id, now(), now() + interval '1 hour', gen_random_uuid()
                       from public.store_domains where group_id <> $1 on conflict (group_id) do nothing`, [g.group_id]);
  const [rpc, worker] = [await client(), await client()];

  // A domain RPC holds the group (its rows, in kind order) inside an open transaction.
  await rpc.query('begin');
  await rpc.query('select public.domain_mark_ready($1, $2)', [g.group_id, g.slug]);
  const t0 = Date.now();
  assert.deepEqual(await lease(worker, 5), [], 'skipped without waiting');
  assert.ok(Date.now() - t0 < 3000);
  await rpc.query('commit');

  // The other way round: a lease holds the group; the RPC simply waits for it.
  await worker.query('begin');
  assert.equal((await lease(worker, 5)).length, 1);
  const waiting = rpc.query('select public.domain_mark_ready($1, $2) as r', [g.group_id, g.slug]);
  await sleep(300);
  await worker.query('commit');
  const r = await waiting;                                   // no 40P01
  assert.ok(r.rows[0].r.outcome);
});

test('overlapping workers holding the same health token: the result counts exactly once', { skip }, async () => {
  await clearLeases();
  const g = await connectedGroup();
  await owner.query(`insert into public.store_domain_reconcile (group_id, last_reconciled_at, lease_until, lease_token)
                     select distinct group_id, now(), now() + interval '1 hour', gen_random_uuid()
                       from public.store_domains where group_id <> $1 on conflict (group_id) do nothing`, [g.group_id]);
  const [w1, w2] = [await client(), await client()];
  const [l] = await lease(w1, 1);
  assert.equal(l.work, 'health');
  const call = (c) => c.query('select public.domain_health_update($1, $2, $3, false) as r', [g.group_id, g.slug, l.health_token]);

  await w1.query('begin');
  const first = (await call(w1)).rows[0].r;
  const second = call(w2);                                   // blocks on the row locks
  await sleep(300);
  await w1.query('commit');
  assert.equal(first.outcome, 'connected');
  assert.equal((await second).rows[0].r.outcome, 'stale_check');
  assert.equal(await failuresOf(g), 1, 'one real failure, counted once');

  // And fired at the same instant from two connections.
  await makeDue(g); await lapse(g);
  const [l2] = await lease(w1, 1);
  const both = await Promise.all([w1, w2].map((c) =>
    c.query('select public.domain_health_update($1, $2, $3, false) as r', [g.group_id, g.slug, l2.health_token])));
  const outs = both.map((x) => x.rows[0].r.outcome).sort();
  assert.deepEqual(outs, ['misconfigured', 'stale_check']);
  assert.equal(await failuresOf(g), 2);
});

test('a delayed older result can never overwrite a newer one, whatever order they arrive in', { skip }, async () => {
  await clearLeases();
  const g = await connectedGroup();
  await owner.query(`insert into public.store_domain_reconcile (group_id, last_reconciled_at, lease_until, lease_token)
                     select distinct group_id, now(), now() + interval '1 hour', gen_random_uuid()
                       from public.store_domains where group_id <> $1 on conflict (group_id) do nothing`, [g.group_id]);
  const [w1, w2] = [await client(), await client()];
  const [older] = await lease(w1, 1);
  await makeDue(g); await lapse(g);
  const [newer] = await lease(w2, 1);
  assert.notEqual(older.health_token, newer.health_token);
  // The newer failure and the older success race.
  const [oldR, newR] = await Promise.all([
    w1.query('select public.domain_health_update($1, $2, $3, true) as r', [g.group_id, g.slug, older.health_token]),
    w2.query('select public.domain_health_update($1, $2, $3, false) as r', [g.group_id, g.slug, newer.health_token]),
  ]);
  assert.equal(oldR.rows[0].r.outcome, 'stale_check');
  assert.equal(newR.rows[0].r.outcome, 'connected');
  assert.equal(await failuresOf(g), 1);
  // Arriving after it changes nothing either.
  assert.equal((await w1.query('select public.domain_health_update($1, $2, $3, true) as r',
    [g.group_id, g.slug, older.health_token])).rows[0].r.outcome, 'stale_check');
  assert.equal(await failuresOf(g), 1);
});
