// PR-B.1 (group leases), executed against the real migration files in PGlite.
// Single connection: this file proves the logic, bounds, grants, install,
// verifier and exact rollback. Concurrent locking is proven against real
// PostgreSQL in tests/custom-domains-lease-pg.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import {
  BASELINE, VERIFY, LEASE_FORWARD, LEASE_VERIFY, LEASE_ROLLBACK, freshDb, asRole, refused,
} from './helpers/domainDb.mjs';

// The seven PR-B functions PR-B.1 wraps, with their reviewed source md5.
const WRAPPED = {
  'domain_activate(uuid,text,text,uuid,text)': '5103a8af7950631f4d30e67ee4ddf437',
  'domain_begin_disconnect(uuid,text,text,uuid,text)': 'f1fa03f912a53d730c14a056a0d23e63',
  'domain_finish_disconnect(uuid,text)': '0483f8fe1b908f0d3e7e60aff6c2c280',
  'domain_health_update(uuid,text,boolean,text)': 'fa0d5fd7ebc53344a90534c9def84d1e',
  'domain_mark_ready(uuid,text)': '1870f5a37da7297b05b360865cadb912',
  'domain_vercel_intent(uuid,text,text,text)': '4c09f0f0b16b80b44bad7311a9985c0c',
  'domain_vercel_observe(uuid,text,text,boolean,boolean,boolean,text)': '2206a341ea63364ece918b74d88935c3',
};
const NEW_RPCS = [
  'domain_group_lease(uuid,text)', 'domain_group_lease_release(uuid,text,uuid)', 'domain_reconcile_lease(integer)',
  'domain_leased_activate(uuid,uuid,text,text,uuid,text)', 'domain_leased_begin_disconnect(uuid,uuid,text,text,uuid,text)',
  'domain_leased_finish_disconnect(uuid,uuid,text)', 'domain_leased_health_update(uuid,uuid,text,boolean,text)',
  'domain_leased_mark_ready(uuid,uuid,text)', 'domain_leased_vercel_intent(uuid,uuid,text,text,text)',
  'domain_leased_vercel_observe(uuid,uuid,text,text,boolean,boolean,boolean,text)',
];
const HELPERS = ['store_domain_health_interval()', 'store_domain_lease_batch_max()', 'store_domain_lease_refusal(uuid,text,uuid)',
  'store_domain_lease_seconds()'];
const V10_AFTER = 'FAIL - domain_vercel_intent, domain_vercel_observe, domain_mark_ready, domain_activate, '
  + 'domain_begin_disconnect, domain_finish_disconnect, domain_health_update';

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
const sigOf = (x) => x.split(':')[0];

let n = 0;
async function verifiedGroup(d, { host = `lease${++n}.com`, slug = `ls${n}` } = {}) {
  await d.query('insert into public.stores (slug) values ($1)', [slug]);
  const c = (await d.query(`select public.domain_claim($1, $2, 'apex') as r`, [slug, host])).rows[0].r;
  const v = (await d.query(`select public.domain_mark_verified($1, $2, $3) as r`, [c.group_id, slug, c.txt_token])).rows[0].r;
  assert.equal(v.outcome, 'verified');
  return { slug, host, group_id: c.group_id, token: c.txt_token };
}
/** Straight to connected through the gateways (the superuser test connection is not service_role). */
async function connectedGroup(d) {
  const g = await verifiedGroup(d);
  const l = await glease(d, g);
  for (const h of [g.host, `www.${g.host}`]) {
    await d.query(`select public.domain_leased_vercel_intent($1, $2, $3, $4, 'add')`, [l, g.group_id, g.slug, h]);
    await d.query('select public.domain_leased_vercel_observe($1, $2, $3, $4, true, true, false)', [l, g.group_id, g.slug, h]);
  }
  await d.query('select public.domain_leased_mark_ready($1, $2, $3)', [l, g.group_id, g.slug]);
  const hash = 'b'.repeat(64);
  const ch = (await d.query(`select public.domain_challenge_create($1, $2, 'activate', $3, $4) as r`,
    [g.slug, g.group_id, g.host, hash])).rows[0].r;
  const a = (await d.query('select public.domain_leased_activate($1, $2, $3, $4, $5, $6) as r',
    [l, g.group_id, g.slug, g.token, ch.challenge_id, hash])).rows[0].r;
  assert.equal(a.outcome, 'connected');
  await release(d, g, l);
  return g;
}
const lease = async (d, limit = 1) => (await d.query('select * from public.domain_reconcile_lease($1)', [limit])).rows;
const glease = async (d, g) => {
  const r = (await d.query('select public.domain_group_lease($1, $2) as r', [g.group_id, g.slug])).rows[0].r;
  assert.equal(r.outcome, 'leased', JSON.stringify(r));
  return r.lease_token;
};
const gleaseRaw = async (d, g, slug = g.slug) => (await d.query('select public.domain_group_lease($1, $2) as r', [g.group_id, slug])).rows[0].r;
const release = async (d, g, token) => (await d.query('select public.domain_group_lease_release($1, $2, $3) as r',
  [g.group_id, g.slug, token])).rows[0].r;
/** 120 s pass: live leases lapse and the reconciler's cool-down ends. */
const lapse = (d) => d.query(`update public.store_domain_reconcile
  set lease_until = case when lease_until is null then null else now() - interval '1 second' end,
      last_reconciled_at = last_reconciled_at - interval '121 seconds'`);
const due = (d, g) => d.query(`update public.store_domains set last_checked_at = now() - interval '61 minutes' where group_id = $1`, [g.group_id]);
const health = async (d, g, token, ok) => (await d.query(
  'select public.domain_leased_health_update($1, $2, $3, $4) as r', [token, g.group_id, g.slug, ok])).rows[0].r;
const verifyRows = async (d, sql) => Object.fromEntries((await d.query(sql)).rows.map((r) => [r.grp, r.result]));

// ═══════════════════════════════════════════════════════════════════════════
// Install, verify, exact rollback
// ═══════════════════════════════════════════════════════════════════════════

test('applies on PR-B, re-runs, and changes nothing of PR-B except service_role EXECUTE on the seven wrapped functions', async () => {
  const d = await freshDb();
  const before = await catalog(d);
  await d.exec(LEASE_FORWARD);
  await d.exec(LEASE_FORWARD);
  const after = await catalog(d);

  const changed = before.fns.filter((x) => !after.fns.includes(x));
  assert.deepEqual(changed.map(sigOf).sort(), Object.keys(WRAPPED).sort(), 'only the seven wrapped functions differ');
  for (const old of changed) {
    const now = after.fns.find((x) => sigOf(x) === sigOf(old));
    const [, md5, secdef, config] = old.split(':');
    assert.equal(now.split(':').slice(1, 4).join(':'), [md5, secdef, config].join(':'), `${sigOf(old)}: same source, definer, search_path`);
    assert.equal(md5, WRAPPED[sigOf(old).replace(/^public\./, '')] ?? WRAPPED[sigOf(old)], `${sigOf(old)} is the reviewed source`);
    assert.match(old, /service_role=X\/postgres/);
    assert.equal(now.replace(/,?service_role=X\/postgres/, ''), now, `${sigOf(old)}: service_role EXECUTE removed`);
    assert.equal(old.replace(/,service_role=X\/postgres/, ''), now, 'and nothing else about it changed');
  }
  const added = after.fns.filter((x) => !before.fns.map(sigOf).includes(sigOf(x))).map(sigOf).sort();
  assert.deepEqual(added, [...NEW_RPCS, ...HELPERS].sort());
  assert.deepEqual(after.rels.filter((x) => !before.rels.includes(x)).map((x) => x.split(':')[0]).sort(),
    ['store_domain_reconcile', 'store_domain_reconcile_fair_idx', 'store_domain_reconcile_pkey']);
  assert.deepEqual(before.rels.filter((x) => !after.rels.includes(x)), [], 'no existing relation changed');
  assert.deepEqual(before.cons.filter((x) => !after.cons.includes(x)), [], 'no existing constraint changed');
  assert.deepEqual(before.trg.filter((x) => !after.trg.includes(x)), [], 'no existing trigger changed');
  await d.close();
});

test('refuses without PR-B, refuses a modified wrapped function, refuses if PR-B\'s grant is not in place', async () => {
  const bare = new PGlite();
  await bare.exec(BASELINE);
  assert.match((await refused(bare.exec(LEASE_FORWARD))).message, /PR-B .* is not installed/);
  await bare.close();

  const d = await freshDb();
  await d.exec(`create or replace function public.domain_vercel_observe(p_group_id uuid, p_store_slug text, p_hostname text,
                  p_attached boolean, p_verified boolean, p_misconfigured boolean, p_error text default null)
                returns jsonb language sql as $$ select '{"outcome":"tampered"}'::jsonb $$`);
  assert.match((await refused(d.exec(LEASE_FORWARD))).message,
    /not the reviewed PR-B definition: public\.domain_vercel_observe\(uuid,text,text,boolean,boolean,boolean,text\)/);
  await d.exec('rollback');
  assert.equal((await d.query(`select to_regclass('public.store_domain_reconcile') as t`)).rows[0].t, null, 'nothing created');
  await d.close();

  const g = await freshDb();
  await g.exec('revoke execute on function public.domain_mark_ready(uuid, text) from service_role');
  assert.match((await refused(g.exec(LEASE_FORWARD))).message, /service_role does not hold PR-B's EXECUTE on public\.domain_mark_ready/);
  await g.exec('rollback');
  await g.close();
});

test('rollback restores the exact PR-B state -- every function, source and grant -- and refuses while a lease is live', async () => {
  const d = await freshDb();
  const prb = await catalog(d);
  await d.exec(LEASE_FORWARD);
  const g = await verifiedGroup(d);
  await glease(d, g);
  assert.match((await refused(d.exec(LEASE_ROLLBACK))).message, /1 lease\(s\) still live/);
  await d.exec('rollback');
  await lapse(d);
  await d.exec(LEASE_ROLLBACK);
  await d.exec(LEASE_ROLLBACK);                                   // idempotent
  const back = await catalog(d);
  assert.deepEqual(back.fns, prb.fns);
  assert.deepEqual(back.rels, prb.rels);
  assert.deepEqual(back.cons, prb.cons);
  assert.deepEqual(back.trg, prb.trg);
  await d.close();
});

test('verifiers: PR-B.1 rows before / after / rolled back, and PR-B\'s own verifier after PR-B.1 (only V10 differs)', async () => {
  const d = await freshDb();
  const prbBefore = await verifyRows(d, VERIFY);
  let r = await verifyRows(d, LEASE_VERIFY);
  assert.deepEqual([r.P1, r.P2], ['PASS', 'PASS']);
  for (const k of ['L01', 'L02', 'L03', 'L04', 'L05', 'L06', 'L07', 'L08']) assert.equal(r[k], 'N/A - not installed', k);
  assert.equal(r.L09, 'no rows');

  await d.exec(LEASE_FORWARD);
  const prbAfter = await verifyRows(d, VERIFY);
  const g = await verifiedGroup(d);
  r = await verifyRows(d, LEASE_VERIFY);
  assert.deepEqual([r.P1, r.P2], ['PASS', 'N/A - PR-B.1 installed']);
  for (const k of ['L01', 'L02', 'L03', 'L04', 'L05', 'L06', 'L07']) assert.equal(r[k], 'PASS', `${k}: ${r[k]}`);
  assert.equal(r.L08, '0', 'information: live leases');
  assert.equal(r.L09, 'verified=2', 'information: rows by status');
  await glease(d, g);
  assert.equal((await verifyRows(d, LEASE_VERIFY)).L08, '1');

  for (const [k, v] of Object.entries(prbBefore)) {
    if (k === 'V10') continue;
    assert.equal(prbAfter[k], v, `PR-B ${k} unchanged`);
  }
  assert.equal(prbBefore.V10, 'PASS');
  assert.equal(prbAfter.V10, V10_AFTER, 'the documented, expected V10 after PR-B.1');
  assert.equal(prbAfter.V06, 'PASS', 'no PR-B function is replaced');
  assert.equal(prbAfter.V14, 'no rows', "V14's known defect: it cannot count rows");

  await lapse(d);
  await d.exec(LEASE_ROLLBACK);
  r = await verifyRows(d, LEASE_VERIFY);
  assert.deepEqual([r.P1, r.P2, r.L01, r.L09], ['PASS', 'PASS', 'N/A - not installed', 'verified=2']);
  assert.equal((await verifyRows(d, VERIFY)).V10, 'PASS');
  // The expectation documented in the verifier's header is exactly the one tested here.
  assert.ok(LEASE_VERIFY.replace(/\r?\n--/g, ' ').replace(/\s+/g, ' ').includes(V10_AFTER), 'header states the expected V10');
  await d.close();
});

// ═══════════════════════════════════════════════════════════════════════════
// Grants
// ═══════════════════════════════════════════════════════════════════════════

test('grants: lease table closed to every role; new RPCs service_role only; helpers nobody; wrapped PR-B functions no longer callable by service_role', async () => {
  const d = await freshDb({ lease: true });
  for (const role of ['anon', 'authenticated', 'service_role']) {
    assert.equal((await refused(asRole(d, role, 'select * from public.store_domain_reconcile'))).code, '42501', role);
    assert.equal((await refused(asRole(d, role, `update public.store_domain_reconcile set lease_until = null`))).code, '42501', role);
  }
  const g = await verifiedGroup(d);
  for (const role of ['anon', 'authenticated']) {
    assert.equal((await refused(asRole(d, role, 'select * from public.domain_reconcile_lease(1)'))).code, '42501', role);
    assert.equal((await refused(asRole(d, role, 'select public.domain_group_lease($1, $2)', [g.group_id, g.slug]))).code, '42501', role);
  }
  const l = (await asRole(d, 'service_role', 'select public.domain_group_lease($1, $2) as r', [g.group_id, g.slug])).rows[0].r;
  assert.equal(l.outcome, 'leased');
  assert.equal((await asRole(d, 'service_role', `select public.domain_leased_vercel_intent($1, $2, $3, $4, 'add') as r`,
    [l.lease_token, g.group_id, g.slug, g.host])).rows[0].r.outcome, 'ok', 'service_role uses the gateway');
  // ...and cannot go around it.
  for (const [sql, args] of [
    ['select public.domain_vercel_intent($1, $2, $3, \'add\')', [g.group_id, g.slug, g.host]],
    ['select public.domain_vercel_observe($1, $2, $3, false, null, null)', [g.group_id, g.slug, g.host]],
    ['select public.domain_mark_ready($1, $2)', [g.group_id, g.slug]],
    ['select public.domain_activate($1, $2, $3, $4, $5)', [g.group_id, g.slug, g.token, crypto.randomUUID(), 'x']],
    ['select public.domain_begin_disconnect($1, $2, \'admin\')', [g.group_id, g.slug]],
    ['select public.domain_finish_disconnect($1, $2)', [g.group_id, g.slug]],
    ['select public.domain_health_update($1, $2, true)', [g.group_id, g.slug]],
  ]) {
    for (const role of ['anon', 'authenticated', 'service_role']) {
      assert.equal((await refused(asRole(d, role, sql, args))).code, '42501', `${role}: ${sql}`);
    }
  }
  for (const fn of ['store_domain_health_interval()', 'store_domain_lease_seconds()', 'store_domain_lease_batch_max()']) {
    for (const role of ['anon', 'authenticated', 'service_role']) {
      assert.equal((await refused(asRole(d, role, `select public.${fn}`))).code, '42501', `${role} ${fn}`);
    }
  }
  assert.equal((await refused(asRole(d, 'service_role', 'select public.store_domain_lease_refusal($1, $2, $3)',
    [g.group_id, g.slug, l.lease_token]))).code, '42501');
  await d.close();
});

// ═══════════════════════════════════════════════════════════════════════════
// The gateways
// ═══════════════════════════════════════════════════════════════════════════

test('gateways: every write needs the CURRENT, UNEXPIRED lease; a refusal writes nothing and spends no code', async () => {
  const d = await freshDb({ lease: true });
  const g = await verifiedGroup(d);
  const snapshot = async () => ({
    rows: (await d.query('select hostname, status, vercel_state, vercel_state_at, last_error from public.store_domains where group_id = $1 order by kind',
      [g.group_id])).rows,
    events: (await d.query('select count(*)::int as n from public.store_domain_events where group_id = $1', [g.group_id])).rows[0].n,
  });
  const calls = (t) => [
    ['domain_leased_vercel_intent', [t, g.group_id, g.slug, g.host, 'add']],
    ['domain_leased_vercel_observe', [t, g.group_id, g.slug, g.host, false, null, null, null]],
    ['domain_leased_mark_ready', [t, g.group_id, g.slug]],
    ['domain_leased_begin_disconnect', [t, g.group_id, g.slug, 'admin', null, null]],
    ['domain_leased_finish_disconnect', [t, g.group_id, g.slug]],
    ['domain_leased_health_update', [t, g.group_id, g.slug, true, null]],
  ];
  const run = async (fn, args) => (await d.query(`select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(', ')}) as r`, args)).rows[0].r;

  // Ready + an activation challenge, so activate can be probed too.
  const setup = await glease(d, g);
  for (const h of [g.host, `www.${g.host}`]) {
    await run('domain_leased_vercel_intent', [setup, g.group_id, g.slug, h, 'add']);
    await run('domain_leased_vercel_observe', [setup, g.group_id, g.slug, h, true, true, false, null]);
  }
  assert.equal((await run('domain_leased_mark_ready', [setup, g.group_id, g.slug])).outcome, 'ready');
  const hash = 'c'.repeat(64);
  const ch = (await d.query(`select public.domain_challenge_create($1, $2, 'activate', $3, $4) as r`,
    [g.slug, g.group_id, g.host, hash])).rows[0].r;
  const activateCall = (t) => ['domain_leased_activate', [t, g.group_id, g.slug, g.token, ch.challenge_id, hash]];
  await release(d, g, setup);

  const stale = setup;                                                // released
  const live = await glease(d, g);
  await d.query(`update public.store_domain_reconcile set lease_until = now() - interval '1 second' where group_id = $1`, [g.group_id]);
  const expired = live;                                               // not released, but lapsed
  const before = await snapshot();
  for (const [label, token] of [['no token', null], ['made-up', crypto.randomUUID()], ['released', stale], ['expired', expired]]) {
    for (const [fn, args] of [...calls(token), activateCall(token)]) {
      assert.deepEqual(await run(fn, args), { outcome: 'lease_lost' }, `${label}: ${fn}`);
    }
  }
  assert.deepEqual(await snapshot(), before, 'nothing written by any refused call');
  const c = (await d.query('select attempts, consumed_at from public.store_domain_challenges where id = $1', [ch.challenge_id])).rows[0];
  assert.deepEqual(c, { attempts: 0, consumed_at: null }, 'no code checked or spent');

  // Another store's slug with a real token: not_found, nothing written.
  const cur = await glease(d, g);
  assert.deepEqual(await run('domain_leased_vercel_observe', [cur, g.group_id, 'someone-else', g.host, false, null, null, null]),
    { outcome: 'not_found' });
  // The current lease passes through to PR-B unchanged: its answers are PR-B's.
  assert.equal((await run(...activateCall(cur))).outcome, 'connected');
  assert.equal((await run('domain_leased_vercel_intent', [cur, g.group_id, g.slug, g.host, 'add'])).outcome, 'already_attached');
  await d.close();
});

// ═══════════════════════════════════════════════════════════════════════════
// Lease semantics (single connection)
// ═══════════════════════════════════════════════════════════════════════════

test('one holder: merchant and reconciler leases exclude each other; release frees a merchant at once, the reconciler after its cool-down', async () => {
  const d = await freshDb({ lease: true });
  const g = await verifiedGroup(d);

  const m = await glease(d, g);
  assert.deepEqual(await lease(d, 5), [], 'held by a merchant request: the reconciler skips it');
  const busy = await gleaseRaw(d, g);
  assert.equal(busy.outcome, 'busy');
  assert.ok(busy.retry_after_seconds >= 1 && busy.retry_after_seconds <= 120, String(busy.retry_after_seconds));
  assert.equal(busy.lease_token, undefined, 'a busy answer carries no token');
  assert.deepEqual(await release(d, g, crypto.randomUUID()), { outcome: 'not_holder' });
  assert.equal((await gleaseRaw(d, g)).outcome, 'busy', 'a wrong token released nothing');
  assert.deepEqual(await release(d, g, m), { outcome: 'released' });
  assert.deepEqual(await release(d, g, m), { outcome: 'not_holder' }, 'release is once');

  const [r] = await lease(d, 1);
  assert.equal(r.group_id, g.group_id);
  assert.equal((await gleaseRaw(d, g)).outcome, 'busy', 'held by the reconciler: the merchant waits');
  await release(d, g, r.lease_token);
  const m2 = await glease(d, g);                                   // at once
  await release(d, g, m2);
  assert.deepEqual(await lease(d, 1), [], 'the reconciler does not re-serve within its cool-down');
  await lapse(d);
  assert.equal((await lease(d, 1)).length, 1, 'after it, it does');

  assert.deepEqual(await gleaseRaw(d, g, 'someone-else'), { outcome: 'not_found' });
  await lapse(d);
  const a = await glease(d, g);
  await d.query(`select public.domain_leased_begin_disconnect($1, $2, $3, 'admin')`, [a, g.group_id, g.slug]);
  await release(d, g, a);
  assert.deepEqual(await gleaseRaw(d, g), { outcome: 'group_ended', status: 'disconnected' });
  await d.close();
});

test('bounds are server-side: batch clamped to 1..5, every lease fixed at 120 s whatever the caller asks', async () => {
  const d = await freshDb({ lease: true });
  for (let i = 0; i < 7; i++) await verifiedGroup(d);
  assert.equal((await lease(d, 0)).length, 1);
  assert.equal((await lease(d, -3)).length, 1);
  assert.equal((await lease(d, 99)).length, 5, 'never more than 5');
  const g = await verifiedGroup(d);
  await glease(d, g);
  const secs = (await d.query(`select extract(epoch from lease_until - now())::int as s from public.store_domain_reconcile
                                 where lease_until is not null`)).rows.map((r) => r.s);
  assert.equal(secs.length, 8);
  assert.ok(secs.every((s) => s === 120), secs.join(','));
  const one = await lease(d, 99);
  assert.ok(one.every((x) => x.lease_seconds === 120));
  await d.close();
});

test('whole groups only; eligible work only -- pending, ended and not-yet-due groups are never leased by the reconciler', async () => {
  const d = await freshDb({ lease: true });
  await d.query(`insert into public.stores (slug) values ('pend')`);
  await d.query(`select public.domain_claim('pend', 'pending1.com', 'apex')`);          // pending: never leased
  const ended = await verifiedGroup(d);
  const a = await glease(d, ended);
  await d.query(`select public.domain_leased_begin_disconnect($1, $2, $3, 'admin')`, [a, ended.group_id, ended.slug]);
  const conn = await connectedGroup(d);                                                   // never checked -> due
  const got = await lease(d, 5);
  assert.deepEqual(got.map((x) => [x.store_slug, x.work, x.status]), [[conn.slug, 'health', 'connected']]);
  const rows = (await d.query('select count(*)::int as n from public.store_domain_reconcile where group_id = $1', [conn.group_id])).rows[0].n;
  assert.equal(rows, 1, 'one lease row per group -- never per hostname');
  // Recorded a result just now: not due for an hour, so not eligible even with the lease lapsed.
  assert.equal((await health(d, conn, got[0].lease_token, true)).outcome, 'connected');
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
  // Released or not, a served group waits its turn.
  for (const [i, g] of gs.entries()) {
    const tok = (await d.query('select lease_token from public.store_domain_reconcile where group_id = $1', [g.group_id])).rows[0].lease_token;
    if (i % 2 === 0) await release(d, g, tok);
  }
  assert.deepEqual(await lease(d, 1), [], 'served moments ago: not yet');
  await lapse(d);
  const again = [];
  for (let i = 0; i < 3; i++) { again.push((await lease(d, 1))[0].group_id); }
  assert.deepEqual(again, served, 'the same round-robin order: oldest service first');
  // A merchant lease does not move a group in the queue.
  await lapse(d);
  const first = gs.find((g) => g.group_id === served[0]);
  await release(d, first, await glease(d, first));
  assert.equal((await lease(d, 1))[0].group_id, served[0]);
  await d.close();
});

test('health: counted once, only under the reconciler lease that found it due; an older lease is refused', async () => {
  const d = await freshDb({ lease: true });
  const g = await connectedGroup(d);
  const [a] = await lease(d, 1);
  assert.equal(a.work, 'health');
  assert.deepEqual(await health(d, g, a.lease_token, false), { outcome: 'connected', failures: 1 });
  assert.equal((await health(d, g, a.lease_token, false)).outcome, 'stale_check', 'once per lease');
  assert.equal((await health(d, g, null, false)).outcome, 'lease_lost');
  assert.equal((await health(d, g, a.lease_token, null)).outcome, 'invalid_result');
  // A newer lease supersedes an older one.
  await due(d, g); await lapse(d);
  const [b] = await lease(d, 1);
  await due(d, g); await lapse(d);
  const [c] = await lease(d, 1);
  assert.equal((await health(d, g, b.lease_token, true)).outcome, 'lease_lost', 'a delayed older result');
  assert.deepEqual(await health(d, g, c.lease_token, false), { outcome: 'misconfigured', failures: 2 });
  // Nor does a merchant lease, or a lapsed reconciler lease, authorise a result.
  await release(d, g, c.lease_token);
  const m = await glease(d, g);
  assert.equal((await health(d, g, m, true)).outcome, 'stale_check');
  await release(d, g, m);
  await due(d, g); await lapse(d);
  const [e] = await lease(d, 1);
  await d.query(`update public.store_domain_reconcile set lease_until = now() - interval '1 second' where group_id = $1`, [g.group_id]);
  assert.equal((await health(d, g, e.lease_token, true)).outcome, 'lease_lost');
  const f = (await d.query('select consecutive_health_failures as f, status from public.store_domains where group_id = $1 limit 1', [g.group_id])).rows[0];
  assert.deepEqual(f, { f: 2, status: 'misconfigured' }, 'only authorised, current results ever counted');
  await d.close();
});

test('lease constants are the ones the app relies on: 1-hour interval, 120-s lease >= 2 x maxDuration of BOTH functions, batch 5', async () => {
  const d = await freshDb({ lease: true });
  const r = (await d.query(`select public.store_domain_health_interval()::text as i, public.store_domain_lease_seconds() as l,
                                   public.store_domain_lease_batch_max() as b`)).rows[0];
  assert.deepEqual(r, { i: '01:00:00', l: 120, b: 5 });
  const { readFileSync } = await import('node:fs');
  const vj = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  for (const fn of ['api/domains/reconcile.js', 'api/domains/manage.js']) {
    assert.ok(r.l >= 2 * vj.functions[fn].maxDuration, `a lease outlives any ${fn} execution that could hold it`);
  }
  await d.close();
});
