// Custom-domain database foundation (PR-B), executed against REAL Postgres.
//
// Every test here runs supabase/custom-domains-forward.sql -- the exact file
// that would be pasted into production -- in PGlite (PostgreSQL 17 compiled to
// WASM) on top of a Supabase-shaped baseline (see tests/helpers/domainDb.mjs):
// the anon / authenticated / service_role roles and default privileges that
// hand every new table and function to all three. So a missing REVOKE, a
// wrong grant, a broken constraint or a trigger that does not fire fails here
// exactly as it would misbehave on production.
//
// WHAT THIS CANNOT PROVE. PGlite is one connection, so two transactions can
// never be in flight at once. First-proof-wins is therefore proven by (a) the
// RPC outcomes in both orders, and (b) forcing the transition with hand-written
// SQL that skips every RPC check -- the unique index alone still refuses the
// second group. The in-flight case (the second writer blocks on the first's
// uncommitted index entry, then fails once it commits) is PostgreSQL's
// documented unique-index behaviour, not code in this PR.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import {
  FORWARD, VERIFY, ROLLBACK, BASELINE, freshDb, asRole, rpc, refused, codeHash, groupRows, expireNow,
} from './helpers/domainDb.mjs';

const db = await freshDb();

let seq = 0;
const next = () => ++seq;
async function newStore() {
  const slug = `shop${next()}`;
  await db.query('insert into public.stores (slug) values ($1)', [slug]);
  return slug;
}
const newHost = (label = 'brand') => `${label}${next()}.com`;
const CODE = '482913';

async function claim(slug, host, kind = 'apex') {
  const c = await rpc(db, 'domain_claim', slug, host, kind);
  assert.equal(c.outcome, 'claimed', JSON.stringify(c));
  return c;
}
async function verified(slug, host, kind = 'apex') {
  const c = await claim(slug, host, kind);
  const v = await rpc(db, 'domain_mark_verified', c.group_id, slug, c.txt_token);
  assert.equal(v.outcome, 'verified', JSON.stringify(v));
  return c;
}
async function ready(slug, host, kind = 'apex') {
  const c = await verified(slug, host, kind);
  for (const h of c.hostnames) {
    assert.equal((await rpc(db, 'domain_set_vercel_state', c.group_id, slug, h, 'added', null)).outcome, 'ok');
  }
  assert.equal((await rpc(db, 'domain_mark_ready', c.group_id, slug)).outcome, 'ready');
  return c;
}
async function challenge(slug, groupId, action, target, code = CODE) {
  const ch = await rpc(db, 'domain_challenge_create', slug, groupId, action, target, codeHash(code));
  assert.equal(ch.outcome, 'created', JSON.stringify(ch));
  return ch.challenge_id;
}
async function connected(slug, host, kind = 'apex') {
  const c = await ready(slug, host, kind);
  const id = await challenge(slug, c.group_id, 'activate', c.primary_host);
  const a = await rpc(db, 'domain_activate', c.group_id, slug, id, codeHash(CODE));
  assert.equal(a.outcome, 'connected', JSON.stringify(a));
  return c;
}
const statusOf = async (groupId) => (await groupRows(db, groupId)).map((r) => r.status);
const resolve = async (host, role = 'anon') =>
  (await asRole(db, role, 'select * from public.resolve_store_host($1)', [host])).rows;
const primaryOf = async (slug, role = 'anon') =>
  (await asRole(db, role, 'select public.store_primary_host($1) as h', [slug])).rows[0].h;
async function inTx(sql) {
  try {
    await db.exec(`begin; ${sql}; commit;`);
  } catch (e) {
    await db.exec('rollback').catch(() => {});
    throw e;
  }
}

const NEW_TABLES = ['store_domains', 'store_domain_challenges', 'store_domain_events'];
const FN = {
  public_read: ['resolve_store_host(text)', 'store_primary_host(text)'],
  server: [
    'domain_claim(text,text,text)', 'domain_mark_verified(uuid,text,text)',
    'domain_set_vercel_state(uuid,text,text,text,text)', 'domain_mark_ready(uuid,text)',
    'domain_challenge_create(text,uuid,text,text,text)', 'domain_activate(uuid,text,uuid,text)',
    'domain_set_primary(uuid,text,text,uuid,text)', 'domain_begin_disconnect(uuid,text,text,uuid,text)',
    'domain_finish_disconnect(uuid,text)', 'domain_expire_stale(integer)',
    'domain_health_update(uuid,text,boolean,text)', 'domain_event_append(uuid,text,text,text,jsonb)',
  ],
  internal: [
    'store_domain_normalize(text)', 'store_domain_hostname_problem(text)',
    'store_domain_log(uuid,text,text,text,jsonb)', 'store_domain_expire_if_stale(uuid)',
    'store_domain_consume_challenge(uuid,text,uuid,text,text,text)', 'store_domains_guard_update()',
    'store_domains_check_group()', 'store_domain_events_append_only()',
  ],
};
const ALL_FN = [...FN.public_read, ...FN.server, ...FN.internal];
const NEW_FN_NAMES = ALL_FN.map((s) => s.split('(')[0]);

// ═══════════════════════════════════════════════════════════════════════════
// 1. The migration: applies, re-runs, and is purely additive
// ═══════════════════════════════════════════════════════════════════════════

/** Everything that existed before, as one comparable string per object. */
async function fingerprint(d) {
  const newRel = `c.relname not like 'store_domain%'`;
  const rows = (await d.query(`
    select x from (
      select 'rel:' || c.relname || ':' || c.relkind::text || ':' || c.relrowsecurity::text || ':' ||
             coalesce(array_to_string(c.relacl, ','), '') as x
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and ${newRel}
      union all
      select 'col:' || c.relname || '.' || a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' ||
             a.attnotnull || ':' || coalesce(pg_get_expr(ad.adbin, ad.adrelid), '')
        from pg_attribute a
        join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
        left join pg_attrdef ad on ad.adrelid = a.attrelid and ad.adnum = a.attnum
       where n.nspname = 'public' and ${newRel} and a.attnum > 0 and not a.attisdropped
      union all
      select 'con:' || c.relname || ':' || k.conname || ':' || pg_get_constraintdef(k.oid)
        from pg_constraint k join pg_class c on c.oid = k.conrelid join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and ${newRel}
      union all
      select 'idx:' || i.indexdef from pg_indexes i
       where i.schemaname = 'public' and i.tablename not like 'store_domain%'
      union all
      select 'pol:' || p.tablename || ':' || p.policyname || ':' || p.cmd || ':' || coalesce(p.qual, '')
        from pg_policies p where p.schemaname = 'public'
      union all
      select 'trg:' || c.relname || ':' || t.tgname
        from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and ${newRel} and not t.tgisinternal
      union all
      select 'fn:' || p.proname || ':' || md5(p.prosrc) || ':' || coalesce(array_to_string(p.proacl, ','), '')
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname::text <> all ($1::text[])
      union all
      select 'data:stores:' || md5(string_agg(s::text, ',' order by s.slug)) from public.stores s
      union all
      select 'data:orders:' || md5(string_agg(o::text, ',' order by o.id)) from public.orders o
    ) f order by x`, [NEW_FN_NAMES])).rows.map((r) => r.x);
  const internal = (await d.query(`
    select c.relname || ':' || coalesce(t.tgconstrrelid::regclass::text, '-') as x
      from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname not like 'store_domain%' and t.tgisinternal
     order by 1`)).rows.map((r) => r.x);
  return { rows, internal };
}

test('the migration applies cleanly on a Supabase-shaped database, and re-runs without error', async () => {
  const d = await freshDb();
  await d.exec(FORWARD);
  await d.exec(FORWARD);
  const n = (await d.query(`select count(*)::int as n from pg_class where relname = any ($1)`, [NEW_TABLES])).rows[0].n;
  assert.equal(n, 3);
  await d.close();
});

test('additive: every pre-existing object and row is identical after the migration', async () => {
  const d = await freshDb({ apply: false });
  const before = await fingerprint(d);
  await d.exec(FORWARD);
  const after = await fingerprint(d);
  assert.deepEqual(after.rows, before.rows);
  // The only trace on an existing table: the internal RI triggers that the new
  // tables' REFERENCES public.stores(slug) add. Nothing else.
  const added = after.internal.filter((x) => !before.internal.includes(x));
  assert.deepEqual(before.internal.filter((x) => !after.internal.includes(x)), []);
  assert.ok(added.length > 0);
  for (const x of added) {
    assert.match(x, /^stores:public\.store_domain(s|_challenges|_events)$|^stores:store_domain(s|_challenges|_events)$/, x);
  }
  await d.close();
});

test('the migration refuses to run over a pre-existing function with one of its names', async () => {
  const d = new PGlite();
  await d.exec(BASELINE);
  await d.exec(`create function public.domain_claim() returns int language sql as 'select 1'`);
  const e = await refused(d.exec(FORWARD));
  assert.match(e.message, /refusing to run: public already has function\(s\) named domain_claim/);
  await d.exec('rollback');
  assert.equal((await d.query(`select to_regclass('public.store_domains') as t`)).rows[0].t, null, 'nothing was created');
  await d.close();
});

test('additive (source): the forward file never alters, drops or writes an existing object', () => {
  const code = FORWARD.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n').toLowerCase();
  assert.doesNotMatch(code, /\bdrop\s/);
  assert.doesNotMatch(code, /(^|;)\s*truncate\s+(table\s+)?public\./m);
  assert.doesNotMatch(code, /\bdelete\s+from\b/);
  assert.doesNotMatch(code, /(insert\s+into|update)\s+public\.(stores|orders)\b/);
  for (const m of code.matchAll(/alter\s+table\s+(?:if\s+exists\s+)?public\.(\w+)/g)) {
    assert.ok(NEW_TABLES.includes(m[1]), `alters existing table ${m[1]}`);
  }
  for (const m of code.matchAll(/create\s+table\s+if\s+not\s+exists\s+public\.(\w+)/g)) {
    assert.ok(NEW_TABLES.includes(m[1]), m[1]);
  }
  for (const m of code.matchAll(/create\s+or\s+replace\s+function\s+public\.(\w+)/g)) {
    assert.ok(NEW_FN_NAMES.includes(m[1]), `replaces a function this PR does not own: ${m[1]}`);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. RLS and grants
// ═══════════════════════════════════════════════════════════════════════════

test('partial-index predicates use status and role only -- never the clock', async () => {
  const idx = Object.fromEntries((await db.query(
    `select indexname, indexdef from pg_indexes where tablename = any ($1)`, [NEW_TABLES])).rows
    .map((r) => [r.indexname, r.indexdef]));
  for (const def of Object.values(idx)) {
    assert.doesNotMatch(def, /now\(\)|current_timestamp|clock_timestamp|statement_timestamp|localtimestamp/i, def);
  }
  const where = (name) => idx[name].split(' WHERE ')[1];
  assert.match(idx.store_domains_active_hostname_uidx, /^CREATE UNIQUE INDEX .* \(hostname\) WHERE/);
  assert.deepEqual(where('store_domains_active_hostname_uidx').match(/'(\w+)'/g),
    ["'verified'", "'ready'", "'connected'", "'misconfigured'", "'disconnecting'"]);
  assert.match(idx.store_domains_one_open_group_per_store_uidx, /^CREATE UNIQUE INDEX .* \(store_slug\) WHERE/);
  assert.deepEqual(where('store_domains_one_open_group_per_store_uidx').match(/'(\w+)'/g),
    ["'primary'", "'pending'", "'verified'", "'ready'", "'connected'", "'misconfigured'", "'disconnecting'"]);
});

test('RLS is enabled on all three tables, with zero policies', async () => {
  const r = (await db.query(`select relname, relrowsecurity from pg_class where relname = any ($1) order by relname`,
    [NEW_TABLES])).rows;
  assert.deepEqual(r.map((x) => x.relrowsecurity), [true, true, true]);
  const p = (await db.query(`select count(*)::int as n from pg_policies where tablename = any ($1)`, [NEW_TABLES])).rows[0].n;
  assert.equal(p, 0);
});

const WRITES = {
  store_domains: [
    `insert into public.store_domains (group_id, store_slug, hostname, kind, role, txt_token)
       values (gen_random_uuid(), 'alpha', 'direct1.com', 'subdomain', 'primary', repeat('a', 32))`,
    `update public.store_domains set status = 'connected'`,
    `delete from public.store_domains`,
    `truncate public.store_domains`,
  ],
  store_domain_challenges: [
    `insert into public.store_domain_challenges (store_slug, group_id, action, target_hostname, code_hash, expires_at)
       values ('alpha', gen_random_uuid(), 'activate', 'x.brand.com', repeat('a', 64), now() + interval '1 minute')`,
    `update public.store_domain_challenges set attempts = 0`,
    `delete from public.store_domain_challenges`,
    `truncate public.store_domain_challenges`,
  ],
  store_domain_events: [
    `insert into public.store_domain_events (group_id, store_slug, event, actor)
       values (gen_random_uuid(), 'alpha', 'forged', 'system')`,
    `update public.store_domain_events set event = 'forged'`,
    `delete from public.store_domain_events`,
    `truncate public.store_domain_events`,
  ],
};

for (const role of ['anon', 'authenticated']) {
  test(`${role} cannot read, write or truncate any of the tables directly`, async () => {
    for (const t of NEW_TABLES) {
      const e = await refused(asRole(db, role, `select * from public.${t}`));
      assert.equal(e.code, '42501', `${role} select ${t}`);
      for (const w of WRITES[t]) {
        const e2 = await refused(asRole(db, role, w));
        assert.equal(e2.code, '42501', `${role}: ${w}`);
      }
    }
    const s = await refused(asRole(db, role, `select nextval('public.store_domain_events_id_seq')`));
    assert.equal(s.code, '42501');
  });
}

test('service_role reads store_domains and events, cannot read challenges, cannot write anything', async () => {
  await asRole(db, 'service_role', 'select * from public.store_domains');
  await asRole(db, 'service_role', 'select * from public.store_domain_events');
  const e = await refused(asRole(db, 'service_role', 'select * from public.store_domain_challenges'));
  assert.equal(e.code, '42501');
  for (const t of NEW_TABLES) {
    for (const w of WRITES[t]) {
      const e2 = await refused(asRole(db, 'service_role', w));
      assert.equal(e2.code, '42501', `service_role: ${w}`);
    }
  }
});

test('EXECUTE grants are exactly as intended, and PUBLIC holds none', async () => {
  const want = (sig) => FN.public_read.includes(sig) ? 'public_read' : FN.server.includes(sig) ? 'server' : 'internal';
  for (const sig of ALL_FN) {
    const r = (await db.query(`
      select has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
             has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth,
             has_function_privilege('service_role', p.oid, 'EXECUTE') as svc,
             exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                      where a.grantee = 0) as public_exec
        from pg_proc p where p.oid = to_regprocedure($1)`, [`public.${sig}`])).rows[0];
    assert.ok(r, `${sig} exists`);
    const cls = want(sig);
    assert.equal(r.public_exec, false, `${sig}: PUBLIC`);
    assert.equal(r.anon, cls === 'public_read', `${sig}: anon`);
    assert.equal(r.auth, cls === 'public_read', `${sig}: authenticated`);
    assert.equal(r.svc, cls !== 'internal', `${sig}: service_role`);
  }
});

test('a browser role calling a server RPC is refused; service_role calling a helper is refused', async () => {
  for (const role of ['anon', 'authenticated']) {
    const e = await refused(asRole(db, role, `select public.domain_claim('alpha', 'x9.com', 'apex')`));
    assert.equal(e.code, '42501');
    const e2 = await refused(asRole(db, role, `select public.domain_expire_stale(10)`));
    assert.equal(e2.code, '42501');
  }
  for (const sql of [
    `select public.store_domain_log(gen_random_uuid(), 'alpha', 'forged', 'system', '{}'::jsonb)`,
    `select public.store_domain_expire_if_stale(gen_random_uuid())`,
    `select public.store_domain_consume_challenge(gen_random_uuid(), 'alpha', gen_random_uuid(), 'activate', 'a.com', repeat('a', 64))`,
    `select public.store_domain_normalize('x.com')`,
  ]) {
    const e = await refused(asRole(db, 'service_role', sql));
    assert.equal(e.code, '42501', sql);
  }
});

test('SECURITY DEFINER is on exactly the 14 RPCs, and every function pins search_path', async () => {
  const rows = (await db.query(`
    select p.proname, p.prosecdef, p.proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = any ($1)`, [NEW_FN_NAMES])).rows;
  assert.equal(rows.length, 22);
  const definer = rows.filter((r) => r.prosecdef).map((r) => r.proname).sort();
  assert.deepEqual(definer, [...FN.public_read, ...FN.server].map((s) => s.split('(')[0]).sort());
  for (const r of rows) {
    assert.deepEqual(r.proconfig, ['search_path=public, pg_temp'], r.proname);
  }
});

test('the pinned search_path holds: a look-alike table earlier in the caller path is never read', async () => {
  const slug = await newStore();
  const c = await connected(slug, newHost('pinned'));
  await db.exec(`
    create schema evil;
    create table evil.store_domains (group_id uuid, store_slug text, hostname text, role text, status text);
    insert into evil.store_domains values (gen_random_uuid(), 'zeta', 'hijack.com', 'primary', 'connected');
    grant usage on schema evil to anon; grant select on evil.store_domains to anon;`);
  try {
    await db.exec('set search_path = evil, public');
    assert.deepEqual(await resolve('hijack.com'), []);
    assert.deepEqual(await resolve(c.primary_host), [{ store_slug: slug, primary_host: c.primary_host }]);
  } finally {
    await db.exec('reset search_path; drop schema evil cascade');
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. The public read RPCs expose connected groups only, and only a route
// ═══════════════════════════════════════════════════════════════════════════

test('resolve_store_host / store_primary_host answer only once a group is connected', async () => {
  const slug = await newStore();
  const host = newHost('lifecycle');
  const www = `www.${host}`;
  const hidden = async (label) => {
    assert.deepEqual(await resolve(host), [], `${label}: apex`);
    assert.deepEqual(await resolve(www), [], `${label}: www`);
    assert.equal(await primaryOf(slug), null, `${label}: store_primary_host`);
  };

  const c = await claim(slug, host);
  await hidden('pending');
  await rpc(db, 'domain_mark_verified', c.group_id, slug, c.txt_token);
  await hidden('verified');
  for (const h of c.hostnames) await rpc(db, 'domain_set_vercel_state', c.group_id, slug, h, 'added', null);
  await rpc(db, 'domain_mark_ready', c.group_id, slug);
  await hidden('ready');

  const id = await challenge(slug, c.group_id, 'activate', host);
  assert.equal((await rpc(db, 'domain_activate', c.group_id, slug, id, codeHash(CODE))).outcome, 'connected');
  for (const role of ['anon', 'authenticated', 'service_role']) {
    assert.deepEqual(await resolve(host, role), [{ store_slug: slug, primary_host: host }], role);
    assert.deepEqual(await resolve(www, role), [{ store_slug: slug, primary_host: host }], `${role}: redirect row`);
    assert.equal(await primaryOf(slug, role), host, role);
  }

  // misconfigured: two consecutive failed health checks
  await rpc(db, 'domain_health_update', c.group_id, slug, false, 'dns points elsewhere');
  assert.deepEqual(await resolve(host), [{ store_slug: slug, primary_host: host }], 'one failure: still connected');
  await rpc(db, 'domain_health_update', c.group_id, slug, false, 'dns points elsewhere');
  assert.deepEqual(await statusOf(c.group_id), ['misconfigured', 'misconfigured']);
  await hidden('misconfigured');
  await rpc(db, 'domain_health_update', c.group_id, slug, true, null);
  assert.equal(await primaryOf(slug), host, 'recovered');

  // disconnecting, then disconnected
  const d = await challenge(slug, c.group_id, 'disconnect', host);
  assert.equal((await rpc(db, 'domain_begin_disconnect', c.group_id, slug, 'merchant', d, codeHash(CODE))).outcome,
    'disconnecting');
  await hidden('disconnecting');
  for (const h of c.hostnames) await rpc(db, 'domain_set_vercel_state', c.group_id, slug, h, 'removed', null);
  assert.equal((await rpc(db, 'domain_finish_disconnect', c.group_id, slug)).outcome, 'disconnected');
  await hidden('disconnected');
});

test('an expired group is hidden too', async () => {
  const slug = await newStore();
  const c = await verified(slug, newHost('exp'));
  await expireNow(db, c.group_id);
  await rpc(db, 'domain_expire_stale', 50);
  assert.deepEqual(await statusOf(c.group_id), ['expired', 'expired']);
  assert.deepEqual(await resolve(c.primary_host), []);
});

test('resolve_store_host returns exactly two columns and nothing internal', async () => {
  const slug = await newStore();
  const c = await connected(slug, newHost('cols'));
  const r = await asRole(db, 'anon', 'select * from public.resolve_store_host($1)', [c.primary_host]);
  assert.deepEqual(r.fields.map((f) => f.name), ['store_slug', 'primary_host']);
  const p = await asRole(db, 'anon', 'select * from public.store_primary_host($1)', [slug]);
  assert.equal(p.fields.length, 1);
  const leaked = JSON.stringify([r.rows, p.rows]);
  assert.equal(leaked.includes(c.txt_token), false);
  assert.equal(leaked.includes(c.group_id), false);
});

test('resolve_store_host normalises the Host header like render.js, and junk returns nothing, never an error', async () => {
  const slug = await newStore();
  const c = await connected(slug, newHost('norm'));
  for (const h of [c.primary_host.toUpperCase(), `${c.primary_host}:443`, `${c.primary_host}.`,
                   ` ${c.primary_host} `, `WWW.${c.primary_host.toUpperCase()}.:8080`]) {
    assert.deepEqual(await resolve(h), [{ store_slug: slug, primary_host: c.primary_host }], h);
  }
  for (const junk of [null, '', ' ', 'x'.repeat(300), '[::1]:443', `${c.primary_host}/evil`,
                      `evil.${c.primary_host}`, `${c.primary_host}.evil.com`, "' or 1=1 --", 'пример.com']) {
    assert.deepEqual(await resolve(junk), [], String(junk));
  }
  assert.equal(await primaryOf(null), null);
  assert.equal(await primaryOf('x'.repeat(200)), null);
  assert.equal(await primaryOf(slug.toUpperCase()), c.primary_host);
});

test('enumeration: a pending, verified, ready, lost or ended claim looks exactly like no claim at all', async () => {
  const never = newHost('never');
  const baseline = [await resolve(never), await resolve(`www.${never}`)];
  const states = [];
  const s1 = await newStore(); states.push((await claim(s1, newHost('en'))).primary_host);
  const s2 = await newStore(); states.push((await verified(s2, newHost('en'))).primary_host);
  const s3 = await newStore(); states.push((await ready(s3, newHost('en'))).primary_host);
  const s4 = await newStore(); const g4 = await claim(s4, newHost('en'));
  await rpc(db, 'domain_begin_disconnect', g4.group_id, s4, 'merchant', null, null);
  states.push(g4.primary_host);
  for (const h of states) {
    assert.deepEqual([await resolve(h), await resolve(`www.${h}`)], baseline, h);
  }
  for (const s of [s1, s2, s3, s4]) assert.equal(await primaryOf(s), null);
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. Claims, first-proof-wins, exclusivity
// ═══════════════════════════════════════════════════════════════════════════

test('two stores may both hold a pending claim on the same hostname', async () => {
  const host = newHost('shared');
  const [a, b] = [await newStore(), await newStore()];
  const ca = await claim(a, host);
  const cb = await claim(b, host);
  assert.notEqual(ca.group_id, cb.group_id);
  assert.notEqual(ca.txt_token, cb.txt_token);
  assert.deepEqual(await statusOf(ca.group_id), ['pending', 'pending']);
  assert.deepEqual(await statusOf(cb.group_id), ['pending', 'pending']);
  const n = (await db.query(`select count(*)::int as n from public.store_domains where hostname = $1`, [host])).rows[0].n;
  assert.equal(n, 2);
});

for (const [first, second] of [['a', 'b'], ['b', 'a']]) {
  test(`first proof wins (${first} proves first): the loser is ended as lost_race, deterministically and for good`, async () => {
    const host = newHost('race');
    const s = { a: await newStore(), b: await newStore() };
    const c = { a: await claim(s.a, host), b: await claim(s.b, host) };

    const win = await rpc(db, 'domain_mark_verified', c[first].group_id, s[first], c[first].txt_token);
    assert.equal(win.outcome, 'verified');
    const lose = await rpc(db, 'domain_mark_verified', c[second].group_id, s[second], c[second].txt_token);
    assert.deepEqual(lose, { outcome: 'lost_race', group_id: c[second].group_id });

    const rows = await groupRows(db, c[second].group_id);
    assert.deepEqual(rows.map((r) => [r.status, r.end_reason]), [['expired', 'lost_race'], ['expired', 'lost_race']]);
    assert.ok(rows.every((r) => r.verified_at === null), 'the loser never held a verified_at');
    assert.deepEqual(await statusOf(c[first].group_id), ['verified', 'verified']);

    // Retrying cannot turn the loser into a winner.
    const again = await rpc(db, 'domain_mark_verified', c[second].group_id, s[second], c[second].txt_token);
    assert.equal(again.outcome, 'not_pending');
    // A fresh claim is refused while the winner holds the name.
    assert.equal((await rpc(db, 'domain_claim', s[second], host, 'apex')).outcome, 'hostname_in_use');
  });
}

test('first proof wins is enforced by the index itself: hand-written SQL that skips every RPC check still fails', async () => {
  const host = newHost('index');
  const [a, b] = [await newStore(), await newStore()];
  const ca = await claim(a, host);
  const cb = await claim(b, host);
  const promote = (g) => `update public.store_domains
                             set status = 'verified', verified_at = now(), expires_at = now() + interval '7 days'
                           where group_id = '${g}'`;
  await inTx(promote(ca.group_id));
  const e = await refused(inTx(promote(cb.group_id)));
  assert.equal(e.code, '23505');
  assert.match(e.message, /store_domains_active_hostname_uidx/);
  assert.deepEqual(await statusOf(cb.group_id), ['pending', 'pending'], 'nothing of the second promotion survived');
});

test('first proof wins across group shapes: an apex group and a www subdomain group overlap on www only', async () => {
  const apex = newHost('shape');
  const www = `www.${apex}`;
  const [a, b] = [await newStore(), await newStore()];
  const sub = await claim(b, www, 'subdomain');
  const pair = await claim(a, apex, 'apex');
  assert.equal((await rpc(db, 'domain_mark_verified', sub.group_id, b, sub.txt_token)).outcome, 'verified');
  const lose = await rpc(db, 'domain_mark_verified', pair.group_id, a, pair.txt_token);
  assert.equal(lose.outcome, 'lost_race', 'the apex half was free, but the group is all or nothing');
  assert.deepEqual(await statusOf(pair.group_id), ['expired', 'expired']);
  const free = (await db.query(`select count(*)::int as n from public.store_domains
                                 where hostname = $1 and status = 'verified'`, [apex])).rows[0].n;
  assert.equal(free, 0, 'no half-group was left holding the apex');
});

test('a hostname proved by one store cannot be claimed or inserted for another', async () => {
  const host = newHost('held');
  const [a, b] = [await newStore(), await newStore()];
  const ca = await connected(a, host);
  assert.equal((await rpc(db, 'domain_claim', b, host, 'apex')).outcome, 'hostname_in_use');
  assert.equal((await rpc(db, 'domain_claim', b, `www.${host}`, 'www')).outcome, 'hostname_in_use');
  assert.equal((await rpc(db, 'domain_claim', b, `www.${host}`, 'subdomain')).outcome, 'hostname_in_use');
  const e = await refused(inTx(`
    insert into public.store_domains (group_id, store_slug, hostname, kind, role, status, txt_token,
                                      verified_at, expires_at)
    values ('11111111-1111-4111-8111-111111111111', '${b}', '${host}', 'apex', 'primary', 'verified',
            repeat('b', 32), now(), now() + interval '1 day'),
           ('11111111-1111-4111-8111-111111111111', '${b}', 'www.${host}', 'www', 'redirect', 'verified',
            repeat('b', 32), now(), now() + interval '1 day')`));
  assert.equal(e.code, '23505');
  assert.deepEqual(await statusOf(ca.group_id), ['connected', 'connected']);
});

test('one open group per store: a second claim is refused, the same claim is idempotent', async () => {
  const slug = await newStore();
  const host = newHost('one');
  const c = await claim(slug, host);
  const same = await rpc(db, 'domain_claim', slug, host.toUpperCase(), 'apex');
  assert.equal(same.outcome, 'already_claimed');
  assert.equal(same.group_id, c.group_id);
  assert.equal(same.txt_token, c.txt_token);
  const other = await rpc(db, 'domain_claim', slug, newHost('two'), 'apex');
  assert.equal(other.outcome, 'store_has_open_group');
  assert.equal(other.group_id, c.group_id);
  assert.equal((await rpc(db, 'domain_claim', slug, `www.${host}`, 'www')).outcome, 'store_has_open_group');

  // Connected: still one.
  const s2 = await newStore();
  await connected(s2, newHost('live'));
  assert.equal((await rpc(db, 'domain_claim', s2, newHost('more'), 'apex')).outcome, 'store_has_open_group');

  // And the index refuses it without the RPC.
  const e = await refused(inTx(`
    insert into public.store_domains (group_id, store_slug, hostname, kind, role, txt_token, expires_at)
    values (gen_random_uuid(), '${slug}', 'second${next()}.brand.com', 'subdomain', 'primary',
            repeat('c', 32), now() + interval '1 day')`));
  assert.equal(e.code, '23505');
  assert.match(e.message, /store_domains_one_open_group_per_store_uidx/);
});

test('verification requires the exact token of the group, from the right store', async () => {
  const [a, b] = [await newStore(), await newStore()];
  const host = newHost('tok');
  const ca = await claim(a, host);
  const cb = await claim(b, host);
  assert.equal((await rpc(db, 'domain_mark_verified', ca.group_id, a, cb.txt_token)).outcome, 'token_mismatch');
  assert.equal((await rpc(db, 'domain_mark_verified', ca.group_id, a, null)).outcome, 'token_mismatch');
  assert.equal((await rpc(db, 'domain_mark_verified', ca.group_id, b, ca.txt_token)).outcome, 'not_found');
  assert.deepEqual(await statusOf(ca.group_id), ['pending', 'pending']);
});

test('claim validation: shape, reserved names, normalisation, store', async () => {
  const slug = await newStore();
  const out = async (h, k = 'apex') => (await rpc(db, 'domain_claim', slug, h, k)).outcome;
  for (const h of ['1.2.3.4', 'localhost', 'brand', 'bad_host.com', '-brand.com', 'brand-.com', 'brand..com',
                   'br and.com', 'пример.com', 'brand.c', `${'a'.repeat(64)}.com`, `${'a.'.repeat(130)}com`,
                   'brand.com/x', 'brand.com:443', '']) {
    assert.equal(await out(h), 'invalid_hostname', h);
  }
  for (const h of ['pocketlink.store', 'shop.pocketlink.store', 'x.vercel.app', 'seniqify.com', 'deep.sub.supabase.co']) {
    assert.equal(await out(h, h.split('.').length > 2 ? 'subdomain' : 'apex'), 'reserved_hostname', h);
  }
  assert.equal(await out('www.brand.com', 'apex'), 'invalid_hostname', 'apex claim of a www name');
  assert.equal(await out('brand.com', 'www'), 'invalid_hostname', 'www claim without www');
  assert.equal(await out('www.com', 'www'), 'invalid_hostname', 'www claim whose apex is a bare TLD');
  assert.equal(await out('brand.com', 'subdomain'), 'invalid_hostname', 'a two-label name is never a subdomain');
  assert.equal(await out('brand.com', 'bogus'), 'invalid_kind');
  assert.equal((await rpc(db, 'domain_claim', 'no-such-store', 'x.com', 'apex')).outcome, 'store_not_found');

  const c = await rpc(db, 'domain_claim', slug, '  Mixed.Case-Brand.COM.  ', 'apex');
  assert.equal(c.outcome, 'claimed');
  assert.deepEqual(c.hostnames, ['mixed.case-brand.com', 'www.mixed.case-brand.com']);
});

test('punycode is stored as sent; the www kind makes www primary and apex the redirect', async () => {
  const slug = await newStore();
  const c = await claim(slug, `www.xn--80ak6aa92e${next()}.com`, 'www');
  const rows = await groupRows(db, c.group_id);
  assert.deepEqual(rows.map((r) => [r.kind, r.role]), [['www', 'primary'], ['apex', 'redirect']]);
  assert.ok(rows.every((r) => /^[\x00-\x7f]+$/.test(r.hostname)));
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. Group invariants (the deferred constraint trigger) and the lifecycle guard
// ═══════════════════════════════════════════════════════════════════════════

const row = (g, slug, host, kind, role, { status = 'expired', token = 'd'.repeat(32), extra = '' } = {}) => `
  ('${g}', '${slug}', '${host}', '${kind}', '${role}', '${status}', '${token}',
   ${status === 'expired' ? `'pending_ttl', now()` : 'null, null'}${extra})`;
const insertRows = (...rows) => `
  insert into public.store_domains (group_id, store_slug, hostname, kind, role, status, txt_token, end_reason, ended_at)
  values ${rows.join(',')}`;

test('an apex group must be exactly {apex, www.apex}, agree on everything, and have one primary', async () => {
  const slug = await newStore();
  const g = () => `22222222-2222-4222-8222-${String(next()).padStart(12, '0')}`;
  const h = newHost('inv');
  const bad = {
    'a lone apex row': [row(g(), slug, h, 'apex', 'primary')],
    'www of a different apex': ((x) => [row(x, slug, h, 'apex', 'primary'), row(x, slug, `www.other${h}`, 'www', 'redirect')])(g()),
    'two primaries': ((x) => [row(x, slug, h, 'apex', 'primary'), row(x, slug, `www.${h}`, 'www', 'primary')])(g()),
    'no primary': ((x) => [row(x, slug, h, 'apex', 'redirect'), row(x, slug, `www.${h}`, 'www', 'redirect')])(g()),
    'rows disagree on the token': ((x) => [row(x, slug, h, 'apex', 'primary'),
      row(x, slug, `www.${h}`, 'www', 'redirect', { token: 'e'.repeat(32) })])(g()),
    'a subdomain row with a second row': ((x) => [row(x, slug, `shop.${h}`, 'subdomain', 'primary'),
      row(x, slug, h, 'apex', 'redirect')])(g()),
  };
  for (const [name, rows] of Object.entries(bad)) {
    const e = await refused(inTx(insertRows(...rows)));
    assert.equal(e.code, '23514', name);
    assert.match(e.message, /store_domains group/, name);
  }
  // Rows disagreeing on status: each row is valid alone, the pair is not.
  const x = g();
  const e = await refused(inTx(`
    insert into public.store_domains (group_id, store_slug, hostname, kind, role, status, txt_token, end_reason, ended_at, expires_at)
    values ('${x}', '${slug}', '${h}', 'apex', 'primary', 'expired', '${'d'.repeat(32)}', 'pending_ttl', now(), null),
           ('${x}', '${slug}', 'www.${h}', 'www', 'redirect', 'pending', '${'d'.repeat(32)}', null, null, now() + interval '1 day')`));
  assert.equal(e.code, '23514');

  // The valid shapes commit.
  const ok = g();
  await inTx(insertRows(row(ok, slug, h, 'apex', 'primary'), row(ok, slug, `www.${h}`, 'www', 'redirect')));
  const sub = g();
  await inTx(insertRows(row(sub, slug, `shop.${h}`, 'subdomain', 'primary')));
});

test('row shape: www/apex/subdomain names, subdomain role, token and hash formats are CHECKed immediately', async () => {
  const slug = await newStore();
  const g = '33333333-3333-4333-8333-333333333333';
  for (const [name, r] of [
    ['www kind without www.', row(g, slug, 'shop.brand.com', 'www', 'primary')],
    ['apex kind with www.', row(g, slug, 'www.brand.com', 'apex', 'primary')],
    ['two-label subdomain', row(g, slug, 'brand.com', 'subdomain', 'primary')],
    ['redirect subdomain', row(g, slug, 'a.brand.com', 'subdomain', 'redirect')],
    ['short token', row(g, slug, 'a.brand.com', 'subdomain', 'primary', { token: 'abc' })],
    ['reserved name', row(g, slug, 'x.pocketlink.store', 'subdomain', 'primary')],
    ['uppercase name', row(g, slug, 'A.Brand.com', 'subdomain', 'primary')],
  ]) {
    const e = await refused(inTx(insertRows(r)));
    assert.equal(e.code, '23514', name);
  }
});

test('the lifecycle guard: only permitted transitions, identity is immutable, an ended group is frozen', async () => {
  const slug = await newStore();
  const c = await claim(slug, newHost('guard'));
  const upd = (set) => inTx(`update public.store_domains set ${set} where group_id = '${c.group_id}'`);
  for (const set of [
    `status = 'connected', verified_at = now(), activated_at = now(), expires_at = null`,  // pending -> connected
    `status = 'ready', verified_at = now()`,                                               // pending -> ready
    `hostname = 'other' || hostname`,
    `txt_token = repeat('f', 32)`,
    `store_slug = 'alpha'`,
  ]) {
    const e = await refused(upd(set));
    assert.equal(e.code, '23514', set);
  }
  await rpc(db, 'domain_begin_disconnect', c.group_id, slug, 'merchant', null, null);
  assert.deepEqual(await statusOf(c.group_id), ['disconnected', 'disconnected']);
  const e = await refused(upd(`status = 'pending', end_reason = null, ended_at = null`));
  assert.equal(e.code, '23514');
  assert.match(e.message, /ended group is frozen/);
  // The cleanup record may still move.
  await upd(`vercel_state = 'removed'`);
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. Disconnect and expiry free the hostname
// ═══════════════════════════════════════════════════════════════════════════

test('disconnect frees the hostname -- but only once Vercel has let go of it', async () => {
  const host = newHost('free');
  const [a, b] = [await newStore(), await newStore()];
  const ca = await connected(a, host);
  const id = await challenge(a, ca.group_id, 'disconnect', host);
  const d = await rpc(db, 'domain_begin_disconnect', ca.group_id, a, 'merchant', id, codeHash(CODE));
  assert.equal(d.outcome, 'disconnecting');
  assert.deepEqual(d.vercel, { [host]: 'added', [`www.${host}`]: 'added' });

  assert.equal((await rpc(db, 'domain_claim', b, host, 'apex')).outcome, 'hostname_in_use', 'still exclusive while Vercel holds it');
  assert.equal((await rpc(db, 'domain_finish_disconnect', ca.group_id, a)).outcome, 'vercel_not_removed');

  await rpc(db, 'domain_set_vercel_state', ca.group_id, a, host, 'removed', null);
  assert.equal((await rpc(db, 'domain_finish_disconnect', ca.group_id, a)).outcome, 'vercel_not_removed');
  await rpc(db, 'domain_set_vercel_state', ca.group_id, a, `www.${host}`, 'removed', null);
  assert.equal((await rpc(db, 'domain_finish_disconnect', ca.group_id, a)).outcome, 'disconnected');
  const rows = await groupRows(db, ca.group_id);
  assert.ok(rows.every((r) => r.status === 'disconnected' && r.end_reason === 'merchant' && r.ended_at));

  const cb = await verified(b, host);
  assert.deepEqual(await statusOf(cb.group_id), ['verified', 'verified']);

  // The original store can come back only with a NEW claim and a NEW token.
  const again = await rpc(db, 'domain_claim', a, newHost('back'), 'apex');
  assert.equal(again.outcome, 'claimed');
  assert.notEqual(again.txt_token, ca.txt_token);
});

test('a group Vercel never held disconnects at once; a pending claim cancels without a code', async () => {
  const s1 = await newStore();
  const c1 = await verified(s1, newHost('never'));
  assert.equal((await rpc(db, 'domain_begin_disconnect', c1.group_id, s1, 'admin', null, null)).outcome, 'disconnected');
  assert.deepEqual((await groupRows(db, c1.group_id)).map((r) => r.end_reason), ['admin', 'admin']);

  const s2 = await newStore();
  const c2 = await claim(s2, newHost('cancel'));
  assert.equal((await rpc(db, 'domain_begin_disconnect', c2.group_id, s2, 'merchant', null, null)).outcome, 'disconnected');
});

test('a merchant disconnect of a proven group needs its code; admin and system do not', async () => {
  const slug = await newStore();
  const c = await connected(slug, newHost('stepup'));
  assert.equal((await rpc(db, 'domain_begin_disconnect', c.group_id, slug, 'merchant', null, null)).outcome,
    'challenge_required');
  assert.equal((await rpc(db, 'domain_begin_disconnect', c.group_id, slug, 'intruder', null, null)).outcome,
    'invalid_actor');
  assert.deepEqual(await statusOf(c.group_id), ['connected', 'connected']);
  assert.equal((await rpc(db, 'domain_begin_disconnect', c.group_id, slug, 'system', null, null)).outcome,
    'disconnecting');
});

test('expiry frees the hostname: the sweep ends stale groups and reports what Vercel still holds', async () => {
  const host = newHost('sweep');
  const [a, b] = [await newStore(), await newStore()];
  const cb = await claim(b, host);
  const ca = await ready(a, host);
  await expireNow(db, ca.group_id);
  const r = await rpc(db, 'domain_expire_stale', 500);
  const mine = r.groups.find((x) => x.group_id === ca.group_id);
  assert.deepEqual(mine, {
    group_id: ca.group_id, store_slug: a, reason: 'verify_ttl',
    vercel: { [host]: 'added', [`www.${host}`]: 'added' },
  });
  assert.deepEqual((await groupRows(db, ca.group_id)).map((x) => [x.status, x.end_reason]),
    [['expired', 'verify_ttl'], ['expired', 'verify_ttl']]);
  assert.equal((await rpc(db, 'domain_mark_verified', cb.group_id, b, cb.txt_token)).outcome, 'verified');
});

test('expiry frees the hostname without the sweep: a stale holder is ended the moment it blocks a proof', async () => {
  const host = newHost('lazy');
  const [a, b] = [await newStore(), await newStore()];
  const cb = await claim(b, host);
  const ca = await verified(a, host);
  await expireNow(db, ca.group_id);
  assert.equal((await rpc(db, 'domain_mark_verified', cb.group_id, b, cb.txt_token)).outcome, 'verified');
  assert.deepEqual(await statusOf(ca.group_id), ['expired', 'expired']);
});

test('a stale group cannot move forward: pending past 72h cannot verify, ready past 7 days cannot activate', async () => {
  const s1 = await newStore();
  const c1 = await claim(s1, newHost('late'));
  await expireNow(db, c1.group_id);
  assert.equal((await rpc(db, 'domain_mark_verified', c1.group_id, s1, c1.txt_token)).outcome, 'expired');
  assert.deepEqual((await groupRows(db, c1.group_id)).map((r) => r.end_reason), ['pending_ttl', 'pending_ttl']);

  const s2 = await newStore();
  const c2 = await ready(s2, newHost('late'));
  const id = await challenge(s2, c2.group_id, 'activate', c2.primary_host);
  await expireNow(db, c2.group_id);
  assert.equal((await rpc(db, 'domain_activate', c2.group_id, s2, id, codeHash(CODE))).outcome, 'expired');
  assert.deepEqual((await groupRows(db, c2.group_id)).map((r) => r.end_reason), ['verify_ttl', 'verify_ttl']);
});

test('TTLs: 72h pending, 7 days verified/ready, 30 days misconfigured, 10 minutes per code', async () => {
  const hoursLeft = async (g) => Number((await db.query(
    `select extract(epoch from expires_at - now()) / 3600 as h from public.store_domains where group_id = $1 and role = 'primary'`,
    [g])).rows[0].h);
  const slug = await newStore();
  const c = await claim(slug, newHost('ttl'));
  assert.ok(Math.abs(await hoursLeft(c.group_id) - 72) < 0.1);
  await rpc(db, 'domain_mark_verified', c.group_id, slug, c.txt_token);
  assert.ok(Math.abs(await hoursLeft(c.group_id) - 168) < 0.1);
  for (const h of c.hostnames) await rpc(db, 'domain_set_vercel_state', c.group_id, slug, h, 'added', null);
  await rpc(db, 'domain_mark_ready', c.group_id, slug);
  assert.ok(Math.abs(await hoursLeft(c.group_id) - 168) < 0.1, 'ready keeps the clock from verification');
  const id = await challenge(slug, c.group_id, 'activate', c.primary_host);
  const mins = Number((await db.query(
    `select extract(epoch from expires_at - created_at) / 60 as m from public.store_domain_challenges where id = $1`,
    [id])).rows[0].m);
  assert.equal(mins, 10);
  await rpc(db, 'domain_activate', c.group_id, slug, id, codeHash(CODE));
  const exp = (await db.query(`select expires_at from public.store_domains where group_id = $1`, [c.group_id])).rows;
  assert.ok(exp.every((r) => r.expires_at === null), 'connected never expires');
  await rpc(db, 'domain_health_update', c.group_id, slug, false, 'x');
  await rpc(db, 'domain_health_update', c.group_id, slug, false, 'x');
  assert.ok(Math.abs(await hoursLeft(c.group_id) - 720) < 0.1);
});

test('health: one failure is tolerated, the second marks misconfigured, one success resets; 30 days releases it', async () => {
  const host = newHost('health');
  const [a, b] = [await newStore(), await newStore()];
  const c = await connected(a, host);
  const h = (ok) => rpc(db, 'domain_health_update', c.group_id, a, ok, ok ? null : 'CNAME missing');

  assert.deepEqual(await h(false), { outcome: 'connected', failures: 1 });
  assert.deepEqual(await h(true), { outcome: 'connected', failures: 0 }, 'a success resets the count');
  assert.deepEqual(await h(false), { outcome: 'connected', failures: 1 }, 'not consecutive: back to one');
  assert.deepEqual(await h(false), { outcome: 'misconfigured', failures: 2 });
  assert.deepEqual(await h(false), { outcome: 'misconfigured', failures: 3 });
  const rows = await groupRows(db, c.group_id);
  assert.ok(rows.every((r) => r.last_error === 'CNAME missing' && r.last_checked_at));

  assert.equal((await rpc(db, 'domain_claim', b, host, 'apex')).outcome, 'hostname_in_use', 'still held for 30 days');
  await expireNow(db, c.group_id);
  await rpc(db, 'domain_expire_stale', 500);
  assert.deepEqual((await groupRows(db, c.group_id)).map((r) => r.end_reason), ['misconfigured_ttl', 'misconfigured_ttl']);
  assert.equal((await rpc(db, 'domain_claim', b, host, 'apex')).outcome, 'claimed', 'released');
});

test('Vercel is never recorded as holding a name before its TXT proof', async () => {
  const slug = await newStore();
  const c = await claim(slug, newHost('vercel'));
  for (const s of ['adding', 'pending_verification', 'added']) {
    assert.equal((await rpc(db, 'domain_set_vercel_state', c.group_id, slug, c.primary_host, s, null)).outcome, 'not_verified');
  }
  for (const s of ['removing', 'removed']) {
    assert.equal((await rpc(db, 'domain_set_vercel_state', c.group_id, slug, c.primary_host, s, null)).outcome,
      'not_verified', `${s} on a pending group is an outcome, not an error`);
  }
  assert.equal((await rpc(db, 'domain_set_vercel_state', c.group_id, slug, c.primary_host, 'bogus', null)).outcome, 'invalid_state');
  assert.equal((await rpc(db, 'domain_set_vercel_state', c.group_id, slug, 'elsewhere.com', 'removed', null)).outcome,
    'hostname_not_in_group');
  const e = await refused(inTx(`update public.store_domains set vercel_state = 'added' where group_id = '${c.group_id}'`));
  assert.equal(e.code, '23514');
  await rpc(db, 'domain_mark_verified', c.group_id, slug, c.txt_token);
  await rpc(db, 'domain_set_vercel_state', c.group_id, slug, c.primary_host, 'added', null);
  assert.equal((await rpc(db, 'domain_mark_ready', c.group_id, slug)).outcome, 'vercel_not_ready', 'www not added yet');
});

test('set_primary swaps roles under a code, and the resolver follows', async () => {
  const slug = await newStore();
  const host = newHost('swap');
  const c = await connected(slug, host);
  const id = await challenge(slug, c.group_id, 'set_primary', `www.${host}`);
  assert.equal((await rpc(db, 'domain_set_primary', c.group_id, slug, `www.${host}`, id, codeHash(CODE))).outcome, 'ok');
  assert.deepEqual(await resolve(host), [{ store_slug: slug, primary_host: `www.${host}` }]);
  assert.equal(await primaryOf(slug), `www.${host}`);
  assert.equal((await rpc(db, 'domain_set_primary', c.group_id, slug, `www.${host}`, id, codeHash(CODE))).outcome,
    'already_primary');

  const sub = await newStore();
  const cs = await connected(sub, `shop.${newHost('sub')}`, 'subdomain');
  assert.equal((await rpc(db, 'domain_challenge_create', sub, cs.group_id, 'set_primary', cs.primary_host,
    codeHash(CODE))).outcome, 'action_not_applicable');
});

test('no server RPC raises for a refusal: every call in every status, and all-NULL input, returns an outcome', async () => {
  const groups = {};
  const mk = async (name, build) => { const slug = await newStore(); groups[name] = { slug, c: await build(slug) }; };
  await mk('pending', (s) => claim(s, newHost('sweep')));
  await mk('verified', (s) => verified(s, newHost('sweep')));
  await mk('ready', (s) => ready(s, newHost('sweep')));
  await mk('connected', (s) => connected(s, newHost('sweep')));
  await mk('misconfigured', async (s) => {
    const c = await connected(s, newHost('sweep'));
    await rpc(db, 'domain_health_update', c.group_id, s, false, 'x');
    await rpc(db, 'domain_health_update', c.group_id, s, false, 'x');
    return c;
  });
  await mk('disconnecting', async (s) => {
    const c = await connected(s, newHost('sweep'));
    await rpc(db, 'domain_begin_disconnect', c.group_id, s, 'admin', null, null);
    return c;
  });
  await mk('disconnected', async (s) => {
    const c = await claim(s, newHost('sweep'));
    await rpc(db, 'domain_begin_disconnect', c.group_id, s, 'merchant', null, null);
    return c;
  });
  await mk('expired', async (s) => { const c = await claim(s, newHost('sweep')); await expireNow(db, c.group_id); return c; });

  const outcomes = new Set();
  for (const [name, { slug, c }] of Object.entries(groups)) {
    const [p, r] = [c.primary_host, c.hostnames.find((h) => h !== c.primary_host) ?? c.primary_host];
    const calls = [
      ['domain_mark_verified', c.group_id, slug, c.txt_token],
      ...['adding', 'pending_verification', 'added', 'removing', 'removed']
        .map((st) => ['domain_set_vercel_state', c.group_id, slug, p, st, null]),
      ['domain_mark_ready', c.group_id, slug],
      ...['activate', 'set_primary', 'disconnect'].flatMap((a) => [p, r]
        .map((t) => ['domain_challenge_create', slug, c.group_id, a, t, codeHash(CODE)])),
      ['domain_activate', c.group_id, slug, null, null],
      ['domain_set_primary', c.group_id, slug, r, null, null],
      ['domain_health_update', c.group_id, slug, true, null],
      ['domain_health_update', c.group_id, slug, false, 'x'],
      ['domain_event_append', c.group_id, slug, 'probe_step', 'system', '{}'],
      ['domain_begin_disconnect', c.group_id, slug, 'merchant', null, null],
      ['domain_finish_disconnect', c.group_id, slug],
      ['domain_begin_disconnect', c.group_id, slug, 'admin', null, null],
      ['domain_finish_disconnect', c.group_id, slug],
    ];
    for (const [fn, ...args] of calls) {
      const out = await rpc(db, fn, ...args).catch((e) => assert.fail(`${name}: ${fn} raised ${e.code} ${e.message}`));
      assert.equal(typeof out.outcome, 'string', `${name}: ${fn}`);
      outcomes.add(out.outcome);
    }
  }
  for (const [fn, n] of [['domain_claim', 3], ['domain_mark_verified', 3], ['domain_set_vercel_state', 5],
                         ['domain_mark_ready', 2], ['domain_challenge_create', 5], ['domain_activate', 4],
                         ['domain_set_primary', 5], ['domain_begin_disconnect', 5], ['domain_finish_disconnect', 2],
                         ['domain_expire_stale', 1], ['domain_health_update', 4], ['domain_event_append', 5]]) {
    const out = await rpc(db, fn, ...Array(n).fill(null)).catch((e) => assert.fail(`${fn}(NULL...) raised ${e.message}`));
    assert.equal(typeof out.outcome, 'string', fn);
  }
  assert.ok(outcomes.size > 10);
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. Step-up challenges
// ═══════════════════════════════════════════════════════════════════════════

test('challenge purpose binding: a code for one action, group or hostname works for no other', async () => {
  const slug = await newStore();
  const host = newHost('purpose');
  const c = await ready(slug, host);
  const act = await challenge(slug, c.group_id, 'activate', host);

  // Used for a different action (disconnect) -> refused, counted, not consumed.
  assert.equal((await rpc(db, 'domain_begin_disconnect', c.group_id, slug, 'merchant', act, codeHash(CODE))).outcome,
    'challenge_purpose_mismatch');
  assert.deepEqual(await statusOf(c.group_id), ['ready', 'ready']);

  // Another store cannot use it at all.
  const other = await newStore();
  const co = await ready(other, newHost('purpose'));
  assert.equal((await rpc(db, 'domain_activate', co.group_id, other, act, codeHash(CODE))).outcome, 'challenge_not_found');

  // A set_primary code (target www) cannot activate (target apex).
  const sp = await challenge(slug, c.group_id, 'set_primary', `www.${host}`);
  assert.equal((await rpc(db, 'domain_activate', c.group_id, slug, sp, codeHash(CODE))).outcome, 'challenge_purpose_mismatch');

  // Its own purpose still works.
  assert.equal((await rpc(db, 'domain_activate', c.group_id, slug, act, codeHash(CODE))).outcome, 'connected');
  const a = (await db.query(`select attempts, consumed_at from public.store_domain_challenges where id = $1`, [act])).rows[0];
  assert.equal(a.attempts, 1);
  assert.ok(a.consumed_at);
});

test('challenges are single-use', async () => {
  const slug = await newStore();
  const host = newHost('once');
  const c = await connected(slug, host);
  const toWww = await challenge(slug, c.group_id, 'set_primary', `www.${host}`);
  assert.equal((await rpc(db, 'domain_set_primary', c.group_id, slug, `www.${host}`, toWww, codeHash(CODE))).outcome, 'ok');
  const toApex = await challenge(slug, c.group_id, 'set_primary', host);
  assert.equal((await rpc(db, 'domain_set_primary', c.group_id, slug, host, toApex, codeHash(CODE))).outcome, 'ok');
  // The first code again, for exactly the purpose it was made for:
  assert.equal((await rpc(db, 'domain_set_primary', c.group_id, slug, `www.${host}`, toWww, codeHash(CODE))).outcome,
    'challenge_used');
  assert.equal(await primaryOf(slug), host);
});

test('challenges expire after 10 minutes', async () => {
  const slug = await newStore();
  const c = await ready(slug, newHost('stale'));
  const id = await challenge(slug, c.group_id, 'activate', c.primary_host);
  await db.query(`update public.store_domain_challenges
                     set created_at = created_at - interval '11 minutes', expires_at = expires_at - interval '11 minutes'
                   where id = $1`, [id]);
  assert.equal((await rpc(db, 'domain_activate', c.group_id, slug, id, codeHash(CODE))).outcome, 'challenge_expired');
  assert.deepEqual(await statusOf(c.group_id), ['ready', 'ready']);
});

test('five wrong codes lock a challenge; the right code is refused after that', async () => {
  const slug = await newStore();
  const c = await ready(slug, newHost('brute'));
  const id = await challenge(slug, c.group_id, 'activate', c.primary_host);
  for (let i = 1; i <= 4; i++) {
    assert.equal((await rpc(db, 'domain_activate', c.group_id, slug, id, codeHash(`00000${i}`))).outcome,
      'challenge_wrong_code', `attempt ${i}`);
  }
  assert.equal((await rpc(db, 'domain_activate', c.group_id, slug, id, codeHash('000005'))).outcome, 'challenge_locked');
  assert.equal((await rpc(db, 'domain_activate', c.group_id, slug, id, codeHash(CODE))).outcome, 'challenge_locked');
  assert.deepEqual(await statusOf(c.group_id), ['ready', 'ready']);
  const r = (await db.query(`select attempts, consumed_at from public.store_domain_challenges where id = $1`, [id])).rows[0];
  assert.deepEqual(r, { attempts: 5, consumed_at: null });
  const e = await refused(inTx(`update public.store_domain_challenges set attempts = 6 where id = '${id}'`));
  assert.equal(e.code, '23514', 'attempts can never exceed 5');
});

test('a request that fails its state check never burns the code', async () => {
  const slug = await newStore();
  const c = await ready(slug, newHost('noburn'));
  const id = await challenge(slug, c.group_id, 'activate', c.primary_host);
  await rpc(db, 'domain_set_vercel_state', c.group_id, slug, c.primary_host, 'removing', null);
  assert.equal((await rpc(db, 'domain_activate', c.group_id, slug, id, codeHash('999999'))).outcome, 'vercel_not_ready');
  const r = (await db.query(`select attempts from public.store_domain_challenges where id = $1`, [id])).rows[0];
  assert.equal(r.attempts, 0);
});

test('codes are only issued for an action that is possible now, at most 5 per store per hour', async () => {
  const slug = await newStore();
  const c = await verified(slug, newHost('issue'));
  const mk = (action, target, hash = codeHash(CODE)) =>
    rpc(db, 'domain_challenge_create', slug, c.group_id, action, target, hash);
  assert.equal((await mk('activate', c.primary_host)).outcome, 'action_not_applicable', 'not ready yet');
  assert.equal((await mk('disconnect', `www.${c.primary_host}`)).outcome, 'action_not_applicable', 'target must be primary');
  assert.equal((await mk('disconnect', 'elsewhere.com')).outcome, 'target_not_in_group');
  assert.equal((await mk('launch', c.primary_host)).outcome, 'invalid_action');
  for (let i = 0; i < 5; i++) assert.equal((await mk('disconnect', c.primary_host)).outcome, 'created');
  assert.equal((await mk('disconnect', c.primary_host)).outcome, 'rate_limited');
  await db.query(`update public.store_domain_challenges
                     set created_at = created_at - interval '61 minutes', expires_at = expires_at - interval '61 minutes'
                   where store_slug = $1`, [slug]);
  assert.equal((await mk('disconnect', c.primary_host)).outcome, 'created', 'the window rolls');
});

test('no plaintext code is ever stored', async () => {
  const slug = await newStore();
  const c = await ready(slug, newHost('plain'));
  for (const bad of [CODE, codeHash(CODE).toUpperCase(), codeHash(CODE).slice(0, 63), '', null]) {
    assert.equal((await rpc(db, 'domain_challenge_create', slug, c.group_id, 'activate', c.primary_host, bad)).outcome,
      'invalid_code_hash', String(bad));
  }
  const e = await refused(inTx(`
    insert into public.store_domain_challenges (store_slug, group_id, action, target_hostname, code_hash, expires_at)
    values ('${slug}', '${c.group_id}', 'activate', '${c.primary_host}', '${CODE}', now() + interval '5 minutes')`));
  assert.equal(e.code, '23514');

  const cols = (await db.query(`select column_name from information_schema.columns
                                 where table_name = 'store_domain_challenges' order by ordinal_position`)).rows
    .map((r) => r.column_name);
  assert.deepEqual(cols, ['id', 'store_slug', 'group_id', 'action', 'target_hostname', 'code_hash',
                          'expires_at', 'attempts', 'consumed_at', 'created_at']);

  const id = await challenge(slug, c.group_id, 'activate', c.primary_host);
  await rpc(db, 'domain_activate', c.group_id, slug, id, codeHash(CODE));
  const everything = JSON.stringify((await db.query(`select * from public.store_domain_events`)).rows);
  assert.equal(everything.includes(CODE), false);
  assert.equal(everything.includes(codeHash(CODE)), false);
  assert.equal(everything.includes(c.txt_token), false);
});

// ═══════════════════════════════════════════════════════════════════════════
// 8. The audit trail
// ═══════════════════════════════════════════════════════════════════════════

test('a full lifecycle leaves an ordered audit trail', async () => {
  const slug = await newStore();
  const c = await connected(slug, newHost('audit'));
  const ev = (await db.query(`select event, actor from public.store_domain_events where group_id = $1 order by id`,
    [c.group_id])).rows.map((r) => `${r.event}/${r.actor}`);
  assert.deepEqual(ev, ['claimed/merchant', 'verified/system', 'vercel_state/system', 'vercel_state/system',
    'ready/system', 'challenge_created/merchant', 'challenge_consumed/merchant', 'activated/merchant']);
});

test('the audit trail is append-only, even for the table owner', async () => {
  for (const sql of [`update public.store_domain_events set actor = 'admin'`,
                     `delete from public.store_domain_events`,
                     `truncate public.store_domain_events`]) {
    const e = await refused(db.query(sql));
    assert.match(e.message, /append-only/, sql);
  }
});

test('domain_event_append: records external steps, never forges lifecycle events or stores secrets', async () => {
  const slug = await newStore();
  const c = await ready(slug, newHost('ext'));
  const id = await challenge(slug, c.group_id, 'activate', c.primary_host);
  const hash = (await db.query(`select code_hash from public.store_domain_challenges where id = $1`, [id])).rows[0].code_hash;
  const app = (event, detail = '{}', s = slug, actor = 'system') =>
    rpc(db, 'domain_event_append', c.group_id, s, event, actor, detail);
  assert.equal((await app('vercel_add_failed', JSON.stringify({ status: 409 }))).outcome, 'ok');
  assert.equal((await app('activated')).outcome, 'reserved_event');
  assert.equal((await app('Bad Event')).outcome, 'invalid_event');
  assert.equal((await app('dns_lookup', JSON.stringify({ seen: c.txt_token }))).outcome, 'detail_contains_secret');
  assert.equal((await app('dns_lookup', JSON.stringify({ h: hash }))).outcome, 'detail_contains_secret');
  assert.equal((await app('dns_lookup', JSON.stringify({ big: 'x'.repeat(3000) }))).outcome, 'detail_too_large');
  assert.equal((await app('dns_lookup', '[]')).outcome, 'invalid_detail');
  assert.equal((await app('dns_lookup', '{}', 'alpha')).outcome, 'not_found', "another store's group");
  assert.equal((await app('dns_lookup', '{}', slug, 'root')).outcome, 'invalid_actor');
});

// ═══════════════════════════════════════════════════════════════════════════
// 9. The verify and rollback scripts
// ═══════════════════════════════════════════════════════════════════════════

test('verify: runs before the migration (N/A) and after (every V row PASS); B rows identical', async () => {
  const d = await freshDb({ apply: false });
  const before = (await d.query(VERIFY)).rows;
  assert.ok(before.filter((r) => r.grp.startsWith('V')).every((r) => r.result === 'N/A - not installed'));
  await d.exec(FORWARD);
  const after = (await d.query(VERIFY)).rows;
  for (const r of after.filter((x) => x.grp.startsWith('V') && x.grp !== 'V14')) {
    assert.equal(r.result, 'PASS', `${r.grp}: ${r.result}`);
  }
  assert.equal(after.find((r) => r.grp === 'V14').result, 'no rows');
  for (const g of ['B1', 'B2', 'B3']) {
    assert.equal(after.find((r) => r.grp === g).result, before.find((r) => r.grp === g).result, g);
  }
  await d.close();
});

test('verify catches a leaked grant', async () => {
  const d = await freshDb();
  await d.exec(`grant select on public.store_domain_challenges to anon;
                grant execute on function public.domain_claim(text, text, text) to authenticated;`);
  const r = Object.fromEntries((await d.query(VERIFY)).rows.map((x) => [x.grp, x.result]));
  assert.match(r.V04, /^FAIL/);
  assert.match(r.V10, /^FAIL - .*domain_claim/);
  await d.close();
});

test('rollback: removes every object and restores the exact pre-migration state; refuses once rows exist', async () => {
  const d = await freshDb({ apply: false });
  const before = await fingerprint(d);
  await d.exec(FORWARD);
  await d.exec(ROLLBACK);
  const after = await fingerprint(d);
  assert.deepEqual(after, before);
  const left = (await d.query(`select count(*)::int as n from pg_proc where proname = any ($1)`, [NEW_FN_NAMES])).rows[0].n;
  assert.equal(left, 0);
  await d.exec(ROLLBACK); // idempotent

  await d.exec(FORWARD);
  await d.query(`select public.domain_claim('alpha', 'rollback.com', 'apex')`);
  const e = await refused(d.exec(ROLLBACK));
  assert.match(e.message, /refusing to run: \d+ custom-domain row\(s\) exist/);
  await d.exec('rollback');
  assert.notEqual((await d.query(`select to_regclass('public.store_domains') as t`)).rows[0].t, null);
  await d.close();
});
