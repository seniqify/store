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
//   * overlapping reconciler workers never lease the same group (explicit
//     interleaving, and 8 connections at once);
//   * a worker that cannot lock EVERY row of a group skips the WHOLE group and
//     leaves no lock or lease behind;
//   * leases and the domain RPCs share one lock order: no waiting past NOWAIT,
//     no deadlock either way round;
//   * merchant and reconciler leases racing for one group: exactly one holder;
//   * the reviewed race: a write from an execution whose lease has gone is
//     refused, in whichever order the write and the new lease arrive -- and
//     nothing can take the lease while a holder's write is in flight;
//   * 'busy' and a lost lease never spend a step-up code;
//   * a stress mix of leases, gateway writes and releases: stale tokens always
//     refused, current ones always accepted, no deadlock;
//   * one authorised health result counts once; an older lease's never counts.
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
/** A separate connection -- as service_role, like the PR-C server, unless asked otherwise. */
async function client({ role = 'service_role' } = {}) {
  const u = new URL(URL_ENV);
  u.pathname = `/${dbName}`;
  const c = new pg.Client({ connectionString: u.toString() });
  await c.connect();
  await c.query(`set lock_timeout = '10s'; set statement_timeout = '20s'`);
  if (role) await c.query(`set role ${role}`);
  clients.push(c);
  return c;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const call = async (c, fn, ...args) =>
  (await c.query(`select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(', ')}) as r`, args)).rows[0].r;

let n = 0;
async function verifiedGroup() {
  const slug = `pg${++n}`;
  const host = `pglease${n}.com`;
  await owner.query('insert into public.stores (slug) values ($1)', [slug]);
  const c = (await owner.query(`select public.domain_claim($1, $2, 'apex') as r`, [slug, host])).rows[0].r;
  await owner.query('select public.domain_mark_verified($1, $2, $3)', [c.group_id, slug, c.txt_token]);
  return { slug, host, group_id: c.group_id, token: c.txt_token };
}
/** Ready: both names attached, verified, configured. (Setup runs as the owner, below any lease.) */
async function readyGroup() {
  const g = await verifiedGroup();
  for (const h of [g.host, `www.${g.host}`]) {
    await owner.query(`select public.domain_vercel_intent($1, $2, $3, 'add')`, [g.group_id, g.slug, h]);
    await owner.query('select public.domain_vercel_observe($1, $2, $3, true, true, false)', [g.group_id, g.slug, h]);
  }
  await owner.query('select public.domain_mark_ready($1, $2)', [g.group_id, g.slug]);
  return g;
}
async function connectedGroup() {
  const g = await readyGroup();
  const hash = 'c'.repeat(64);
  const ch = (await owner.query(`select public.domain_challenge_create($1, $2, 'activate', $3, $4) as r`,
    [g.slug, g.group_id, g.host, hash])).rows[0].r;
  const a = (await owner.query('select public.domain_activate($1, $2, $3, $4, $5) as r',
    [g.group_id, g.slug, g.token, ch.challenge_id, hash])).rows[0].r;
  assert.equal(a.outcome, 'connected');
  return g;
}
const lease = async (c, limit) => (await c.query('select * from public.domain_reconcile_lease($1)', [limit])).rows;
const glease = (c, g) => call(c, 'domain_group_lease', g.group_id, g.slug);
const release = (c, g, token) => call(c, 'domain_group_lease_release', g.group_id, g.slug, token);
const observe = (c, token, g, host, attached, error = null) =>
  call(c, 'domain_leased_vercel_observe', token, g.group_id, g.slug, host, attached, attached ? true : null, attached ? false : null, error);
/** 120 s pass for leases: live ones lapse, and the reconciler's cool-down ends. */
const lapse = (g) => owner.query(`update public.store_domain_reconcile
  set lease_until = case when lease_until is null then null else now() - interval '1 second' end,
      last_reconciled_at = last_reconciled_at - interval '121 seconds' where group_id = $1`, [g.group_id]);
/** The reconciler's 120-s cool-down over -- WITHOUT lapsing anyone's live lease. */
const coolDownOver = (g) => owner.query(`update public.store_domain_reconcile
  set last_reconciled_at = last_reconciled_at - interval '121 seconds' where group_id = $1`, [g.group_id]);
const makeDue = (g) => owner.query(`update public.store_domains set last_checked_at = now() - interval '61 minutes' where group_id = $1`, [g.group_id]);
const clearLeases = () => owner.query('delete from public.store_domain_reconcile');
/** Every other group already leased, so `g` is the only candidate. */
const busyAllBut = (g) => owner.query(`
  insert into public.store_domain_reconcile (group_id, last_reconciled_at, lease_until, lease_token, lease_holder)
  select x.group_id, now(), now() + interval '1 hour', gen_random_uuid(), 'reconciler'
    from (select distinct group_id from public.store_domains where group_id <> $1) x
  on conflict (group_id) do update
    set last_reconciled_at = excluded.last_reconciled_at, lease_until = excluded.lease_until,
        lease_token = excluded.lease_token, lease_holder = excluded.lease_holder, health_pending = false`, [g.group_id]);
const stateOf = async (g) => (await owner.query(
  'select hostname, status, vercel_state from public.store_domains where group_id = $1 order by kind', [g.group_id])).rows;
const failuresOf = async (g) => (await owner.query(
  'select consecutive_health_failures as f from public.store_domains where group_id = $1 limit 1', [g.group_id])).rows[0].f;

test.before(async () => {
  if (skip) return;
  admin = new pg.Client({ connectionString: URL_ENV });
  await admin.connect();
  await admin.query(`create database ${dbName}`);
  owner = await client({ role: null });
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

// ═══════════════════════════════════════════════════════════════════════════
// Reconciler leases
// ═══════════════════════════════════════════════════════════════════════════

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
  const workers = [];
  for (let i = 0; i < 8; i++) workers.push(await client());
  const got = (await Promise.all(workers.map((w) => lease(w, 3)))).flat().map((x) => x.group_id);
  assert.equal(new Set(got).size, got.length, 'disjoint under real concurrency');
  const rest = await lease(workers[0], 5);
  assert.equal(rest.filter((x) => got.includes(x.group_id)).length, 0);
});

test('a single contested group goes to exactly one of eight simultaneous workers', { skip }, async () => {
  const lone = await verifiedGroup();
  await busyAllBut(lone);
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
    await busyAllBut(g);
    const [holder, worker, probe] = [await client({ role: null }), await client(), await client({ role: null })];
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
  await busyAllBut(g);
  const [rpc, worker] = [await client({ role: null }), await client()];

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

// ═══════════════════════════════════════════════════════════════════════════
// Merchant requests and the reconciler: one lease per group
// ═══════════════════════════════════════════════════════════════════════════

test('merchant and reconciler leases racing for one group: exactly one holder, every round', { skip }, async () => {
  const g = await verifiedGroup();
  await busyAllBut(g);
  const conns = [];
  for (let i = 0; i < 8; i++) conns.push(await client());
  for (let round = 0; round < 6; round++) {
    await lapse(g);
    const got = await Promise.all(conns.map((c, i) => (i % 2 === 0
      ? glease(c, g).then((r) => ({ kind: 'merchant', r }))
      : lease(c, 1).then((rows) => ({ kind: 'reconciler', r: rows[0] ?? null })))));
    const winners = got.filter((x) => (x.kind === 'merchant' ? x.r.outcome === 'leased' : x.r !== null));
    assert.equal(winners.length, 1, `round ${round}: ${JSON.stringify(got.map((x) => x.r?.outcome ?? (x.r ? 'row' : 'none')))}`);
    for (const x of got) if (x.kind === 'merchant' && x.r.outcome !== 'leased') assert.equal(x.r.outcome, 'busy');
    assert.deepEqual(await release(conns[0], g, winners[0].r.lease_token), { outcome: 'released' });
  }
});

test('the reviewed race: a write whose lease has gone is refused, in whichever order it and the new lease arrive', { skip }, async () => {
  await clearLeases();
  const g = await readyGroup();
  const other = `pgother${++n}`;
  await owner.query('insert into public.stores (slug) values ($1)', [other]);
  await busyAllBut(g);
  const [merchant, reconciler, third] = [await client(), await client(), await client()];

  // 1. The merchant request leases the group and reads Vercel: "absent". Its answer is delayed
  //    past its lease; the reconciler takes the group and records what is true now.
  const m = await glease(merchant, g);
  assert.equal(m.outcome, 'leased');
  await lapse(g);
  const [r] = await lease(reconciler, 1);
  assert.equal(r.group_id, g.group_id);
  assert.equal((await observe(reconciler, r.lease_token, g, g.host, true)).vercel_state, 'configured');
  // 2. The delayed "absent" arrives: refused, nothing written.
  assert.deepEqual(await observe(merchant, m.lease_token, g, g.host, false), { outcome: 'lease_lost' });
  assert.deepEqual((await stateOf(g)).map((x) => [x.status, x.vercel_state]), [['ready', 'configured'], ['ready', 'configured']]);
  await release(reconciler, g, r.lease_token);

  // 3. The new lease is being granted (open transaction) when the stale write arrives: the
  //    write waits for it, then is refused.
  const m2 = await glease(merchant, g);
  await lapse(g);
  await reconciler.query('begin');
  const [r2] = await lease(reconciler, 1);
  assert.equal(r2.group_id, g.group_id);
  const t0 = Date.now();
  const stale = observe(merchant, m2.lease_token, g, g.host, false);
  await sleep(300);
  await reconciler.query('commit');
  assert.deepEqual(await stale, { outcome: 'lease_lost' });
  assert.ok(Date.now() - t0 >= 250, 'the stale write waited for the lease grant to finish');
  assert.equal((await stateOf(g))[0].vercel_state, 'configured');
  await release(reconciler, g, r2.lease_token);

  // 4. The holder's write is in flight (open transaction): nothing can take or replace the
  //    lease underneath it -- a reconciler skips the group; another request waits, then is busy.
  await lapse(g);                                              // the reconciler's cool-down: over
  const m3 = await glease(merchant, g);
  await merchant.query('begin');
  assert.equal((await observe(merchant, m3.lease_token, g, g.host, true)).outcome, 'ok');
  assert.deepEqual(await lease(reconciler, 1), [], 'NOWAIT: the group is skipped, not taken');
  const waiter = glease(third, g);
  await sleep(300);
  await merchant.query('commit');
  assert.equal((await waiter).outcome, 'busy', 'the waiting request sees the live lease');
  await release(merchant, g, m3.lease_token);

  // 5. Then the TTL and the 2-minute fence pass. Vercel holds the names, as recorded, so the
  //    database does not free them: cleanup first.
  await owner.query(`update public.store_domains set expires_at = now() - interval '1 second',
                       vercel_state_at = vercel_state_at - interval '3 minutes' where group_id = $1`, [g.group_id]);
  const exp = await call(third, 'domain_expire_stale', 200);
  assert.ok(exp.expired >= 1);
  assert.deepEqual([...new Set((await stateOf(g)).map((x) => x.status))], ['disconnecting']);
  assert.equal((await call(third, 'domain_claim', other, g.host, 'apex')).outcome, 'hostname_releasing');
});

test("'busy' and a lost lease never spend a step-up code, even under concurrency", { skip }, async () => {
  await clearLeases();
  const g = await readyGroup();
  await busyAllBut(g);
  const hash = 'd'.repeat(64);
  const ch = (await owner.query(`select public.domain_challenge_create($1, $2, 'activate', $3, $4) as r`,
    [g.slug, g.group_id, g.host, hash])).rows[0].r;
  const codeState = async () => (await owner.query(
    'select attempts, consumed_at from public.store_domain_challenges where id = $1', [ch.challenge_id])).rows[0];
  const activate = (c, token) => call(c, 'domain_leased_activate', token, g.group_id, g.slug, g.token, ch.challenge_id, hash);
  const [merchant, reconciler] = [await client(), await client()];

  // The reconciler holds the group: the merchant request is busy; with no lease it is refused.
  const [r] = await lease(reconciler, 1);
  assert.equal((await glease(merchant, g)).outcome, 'busy');
  assert.deepEqual(await activate(merchant, null), { outcome: 'lease_lost' });
  assert.deepEqual(await activate(merchant, crypto.randomUUID()), { outcome: 'lease_lost' });
  await release(reconciler, g, r.lease_token);

  // A merchant lease lapses while a new lease is being granted: the activation waits, then is
  // refused -- before the code is looked at.
  const m = await glease(merchant, g);
  await lapse(g);
  await reconciler.query('begin');
  const [r2] = await lease(reconciler, 1);
  assert.equal(r2.group_id, g.group_id);
  const late = activate(merchant, m.lease_token);
  await sleep(300);
  await reconciler.query('commit');
  assert.deepEqual(await late, { outcome: 'lease_lost' });
  assert.deepEqual(await codeState(), { attempts: 0, consumed_at: null }, 'the code was never checked');
  await release(reconciler, g, r2.lease_token);

  // With the group free, the same code works.
  const m2 = await glease(merchant, g);
  assert.equal((await activate(merchant, m2.lease_token)).outcome, 'connected');
});

test('stress: 8 connections mixing leases, gateway writes and releases -- stale always refused, current always accepted, no deadlock', { skip }, async () => {
  await clearLeases();
  const g = await readyGroup();
  await busyAllBut(g);
  const conns = [];
  for (let i = 0; i < 8; i++) conns.push(await client());
  const tally = { held: 0, busy: 0, accepted: 0, staleRefused: 0, reconcilerSkips: 0 };
  const tokens = new Set();
  const errors = [];
  await Promise.all(conns.map(async (c, w) => {
    let previous = null;
    for (let i = 0; i < 30; i++) {
      try {
        let token = null;
        if ((w + i) % 3 === 0) {
          const [row] = await lease(c, 1);
          if (row) token = row.lease_token; else tally.reconcilerSkips++;
        } else {
          const l = await glease(c, g);
          if (l.outcome === 'leased') token = l.lease_token; else { assert.equal(l.outcome, 'busy'); tally.busy++; }
        }
        if (previous) {
          const s = await observe(c, previous, g, g.host, true, `stale ${w}:${i}`);
          assert.deepEqual(s, { outcome: 'lease_lost' }, 'a released token never writes');
          tally.staleRefused++;
        }
        if (!token) continue;
        tally.held++;
        assert.ok(!tokens.has(token), 'every lease is a new token');
        tokens.add(token);
        const ok = await observe(c, token, g, `www.${g.host}`, true, `w${w}:${i}`);
        assert.equal(ok.outcome, 'ok', 'the current holder always writes');
        tally.accepted++;
        assert.deepEqual(await release(c, g, token), { outcome: 'released' });
        previous = token;
        await coolDownOver(g);                              // let the reconciler back in, now and then
      } catch (e) {
        errors.push(`${w}:${i} ${e.code || ''} ${e.message}`);
      }
    }
  }));
  assert.deepEqual(errors, [], 'no deadlock (40P01), lock timeout (55P03) or assertion');
  assert.ok(tally.held >= 20 && tally.staleRefused >= 20, JSON.stringify(tally));
  assert.equal(tally.accepted, tally.held);
  const errs = (await owner.query('select last_error from public.store_domains where group_id = $1', [g.group_id])).rows;
  assert.ok(errs.every((x) => !String(x.last_error ?? '').startsWith('stale')), 'no stale write ever landed');
});

// ═══════════════════════════════════════════════════════════════════════════
// Health
// ═══════════════════════════════════════════════════════════════════════════

test('overlapping deliveries of one authorised health result: it counts exactly once', { skip }, async () => {
  await clearLeases();
  const g = await connectedGroup();
  await busyAllBut(g);
  const [w1, w2] = [await client(), await client()];
  const [l] = await lease(w1, 1);
  assert.equal(l.work, 'health');
  const result = (c, token) => call(c, 'domain_leased_health_update', token, g.group_id, g.slug, false);

  await w1.query('begin');
  const first = await result(w1, l.lease_token);
  const second = result(w2, l.lease_token);                  // blocks on the row locks
  await sleep(300);
  await w1.query('commit');
  assert.equal(first.outcome, 'connected');
  assert.equal((await second).outcome, 'stale_check');
  assert.equal(await failuresOf(g), 1, 'one real failure, counted once');

  // And fired at the same instant from two connections.
  await release(w1, g, l.lease_token);
  await makeDue(g); await lapse(g);
  const [l2] = await lease(w1, 1);
  const outs = (await Promise.all([w1, w2].map((c) => result(c, l2.lease_token)))).map((x) => x.outcome).sort();
  assert.deepEqual(outs, ['misconfigured', 'stale_check']);
  assert.equal(await failuresOf(g), 2);
});

test('a delayed result from an older lease can never overwrite a newer one, whatever order they arrive in', { skip }, async () => {
  await clearLeases();
  const g = await connectedGroup();
  await busyAllBut(g);
  const [w1, w2] = [await client(), await client()];
  const [older] = await lease(w1, 1);
  await makeDue(g); await lapse(g);
  const [newer] = await lease(w2, 1);
  assert.notEqual(older.lease_token, newer.lease_token);
  // The newer failure and the older success race.
  const [oldR, newR] = await Promise.all([
    call(w1, 'domain_leased_health_update', older.lease_token, g.group_id, g.slug, true),
    call(w2, 'domain_leased_health_update', newer.lease_token, g.group_id, g.slug, false),
  ]);
  assert.equal(oldR.outcome, 'lease_lost');
  assert.equal(newR.outcome, 'connected');
  assert.equal(await failuresOf(g), 1);
  // Arriving after it changes nothing either.
  assert.equal((await call(w1, 'domain_leased_health_update', older.lease_token, g.group_id, g.slug, true)).outcome, 'lease_lost');
  assert.equal(await failuresOf(g), 1);
});
