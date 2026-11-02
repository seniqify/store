// The owner's sign-up phone stays server-side: anon/authenticated read
// stores.public_config (config without ownerPhone), never config itself.
// The migration runs on real Postgres (PGlite), set up with production's
// privileges: column grants (config, created_at, id, slug, updated_at), RLS
// `SELECT USING (true)`, a security_invoker marketplace view, and a security
// definer update_store_config that pins ownerPhone.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { PGlite } from '@electric-sql/pglite';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = (p) => readFileSync(`${ROOT}${p}`, 'utf8').replace(/\r\n/g, '\n');
const STEP1 = read('supabase/owner-phone-private-forward.sql');
const STEP2 = read('supabase/owner-phone-private-revoke.sql');
const UNDO2 = read('supabase/owner-phone-private-revoke-ROLLBACK.sql');
const UNDO1 = read('supabase/owner-phone-private-ROLLBACK.sql');
const VERIFY = read('supabase/owner-phone-private-verify.sql');

const PROD_LIKE = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  grant usage on schema public to anon, authenticated, service_role;
  create table public.stores (
    id uuid primary key default gen_random_uuid(),
    slug text unique not null,
    config jsonb not null default '{}',
    pin text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );
  alter table public.stores enable row level security;
  create policy "stores are public" on public.stores for select using (true);
  create policy "anyone may sign up" on public.stores for insert with check (true);
  revoke all on public.stores from anon, authenticated;
  grant select (config, created_at, id, slug, updated_at) on public.stores to anon, authenticated;
  grant insert (slug, config, pin) on public.stores to anon;
  grant all on public.stores to service_role;
  create view public.marketplace_listing with (security_invoker = on) as
    select s.slug, s.created_at,
           s.config ->> 'businessName' as "businessName",
           s.config -> 'theme' as theme,
           (select string_agg(p ->> 'name', ' ')
              from jsonb_array_elements(coalesce(s.config -> 'products', '[]'::jsonb)) p) as search_text
      from public.stores s
     where (s.config ->> 'businessName') is not null;
  revoke all on public.marketplace_listing from anon, authenticated;
  grant select on public.marketplace_listing to anon, authenticated;
  create function public.update_store_config(p_slug text, p_config jsonb) returns boolean
    language plpgsql security definer set search_path = public, pg_temp as $f$
  begin
    update public.stores s
       set config = p_config || jsonb_build_object('ownerPhone', s.config -> 'ownerPhone'), updated_at = now()
     where s.slug = p_slug;
    return found;
  end $f$;
  grant execute on function public.update_store_config(text, jsonb) to anon;
  insert into public.stores (slug, config, pin) values
    ('alpha', '{"businessName":"Alpha","whatsappNumber":"919800000001","ownerPhone":"919811111111","products":[{"name":"Clay Mug"}],"theme":{"primary":"#0d9488"}}', 'hash-a'),
    ('beta',  '{"businessName":"Beta","whatsappNumber":"919800000002","ownerPhone":"919822222222"}', 'hash-b');
`;

async function world(extra = '') {
  const db = new PGlite();
  await db.exec(PROD_LIKE + extra);
  return db;
}
async function as(db, role, sql, params = []) {
  await db.exec(`set role ${role}`);
  try { return await db.query(sql, params); } finally { await db.exec('reset role'); }
}
async function refused(promise) {
  try { await promise; } catch (e) { return e; }
  throw new Error('expected a refusal, but it succeeded');
}
/** Run a migration file that should stop; leaves the connection usable. */
async function stops(db, sql) {
  const e = await refused(db.exec(sql));
  await db.exec('rollback').catch(() => {});
  return e;
}
const viewDef = async (db) => (await db.query(`select pg_get_viewdef('public.marketplace_listing'::regclass, false) as d`)).rows[0].d;
// The stores columns the view reads, from Postgres's own dependency records.
const viewReads = async (db) => (await db.query(`
  select distinct a.attname from pg_depend d
    join pg_rewrite r on r.oid = d.objid and d.classid = 'pg_rewrite'::regclass
    join pg_attribute a on a.attrelid = d.refobjid and a.attnum = d.refobjsubid
   where r.ev_class = 'public.marketplace_listing'::regclass and d.refobjid = 'public.stores'::regclass
   order by 1`)).rows.map((r) => r.attname);
const verify = async (db) => Object.fromEntries((await db.query(VERIFY)).rows.map((r) => [r.id, r.result]));
const listing = async (db) => (await as(db, 'anon', 'select slug, "businessName", theme, search_text from public.marketplace_listing order by slug')).rows;

test('before: the public role reads config, owner phone included (the leak this closes)', async () => {
  const db = await world();
  const r = await as(db, 'anon', `select config from public.stores where slug = 'alpha'`);
  assert.equal(r.rows[0].config.ownerPhone, '919811111111');
});

test('step 1 only adds: public_config without ownerPhone, config still readable, the view unchanged', async () => {
  const db = await world();
  const before = await listing(db);
  await db.exec(STEP1);
  await db.exec(STEP1);   // idempotent
  for (const role of ['anon', 'authenticated']) {
    const r = await as(db, role, `select slug, public_config, config from public.stores order by slug`);
    for (const row of r.rows) {
      assert.equal('ownerPhone' in row.public_config, false, `${role} ${row.slug}`);
      const { ownerPhone, ...rest } = row.config;
      assert.ok(ownerPhone);
      assert.deepEqual(row.public_config, rest, 'everything else is identical');
    }
  }
  assert.deepEqual(await viewReads(db), ['created_at', 'public_config', 'slug'], 'the view reads public_config, not config');
  assert.deepEqual(await listing(db), before, 'marketplace output is the same');
  const v = await verify(db);
  for (const id of ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S9', 'S10']) assert.match(v[id], /^PASS/, `${id}: ${v[id]}`);
  assert.equal(v.S7, 'FAIL', 'config still readable after step 1, as designed');
});

test('step 2: config is gone for anon and authenticated; every public read still works', async () => {
  const db = await world();
  await db.exec(STEP1);
  const before = await listing(db);
  await db.exec(STEP2);
  await db.exec(STEP2);   // idempotent
  for (const role of ['anon', 'authenticated']) {
    const e = await refused(as(db, role, `select config from public.stores where slug = 'alpha'`));
    assert.match(e.message, /permission denied/, role);
    const fe = await refused(as(db, role, `select slug from public.stores where config ->> 'whatsappNumber' like '%0001'`));
    assert.match(fe.message, /permission denied/, `${role}: filtering on config is refused too`);
    // What the site now asks for: config:public_config, and filters on public_config.
    const r = await as(db, role, `select slug, public_config as config from public.stores where slug = 'alpha'`);
    assert.equal(r.rows[0].config.businessName, 'Alpha');
    assert.equal('ownerPhone' in r.rows[0].config, false);
    const f = await as(db, role, `select slug from public.stores where public_config ->> 'whatsappNumber' ilike '%0002'`);
    assert.deepEqual(f.rows.map((x) => x.slug), ['beta']);
  }
  assert.deepEqual(await listing(db), before, 'the marketplace view keeps working as the caller');
  assert.match((await refused(as(db, 'anon', 'select pin from public.stores'))).message, /permission denied/);
  const v = await verify(db);
  for (const id of ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9', 'S10']) assert.match(v[id], /^PASS/, `${id}: ${v[id]}`);
  assert.equal(v.I1, '2');
});

test('writers are unchanged: sign-up and Settings keep the owner phone server-side', async () => {
  const db = await world();
  await db.exec(STEP1);
  await db.exec(STEP2);
  // Sign-up: the browser inserts config with ownerPhone (no read-back).
  await as(db, 'anon', `insert into public.stores (slug, config, pin) values ('gamma', $1, 'hash-g')`,
    [JSON.stringify({ businessName: 'Gamma', ownerPhone: '919833333333' })]);
  const pub = await as(db, 'anon', `select public_config from public.stores where slug = 'gamma'`);
  assert.equal('ownerPhone' in pub.rows[0].public_config, false);
  // Settings → Save: the browser sends back the public copy; the function pins the phone.
  const loaded = (await as(db, 'anon', `select public_config from public.stores where slug = 'alpha'`)).rows[0].public_config;
  await as(db, 'anon', 'select public.update_store_config($1, $2)', ['alpha', JSON.stringify({ ...loaded, tagline: 'New' })]);
  const server = (await as(db, 'service_role', `select config, public_config from public.stores where slug = 'alpha'`)).rows[0];
  assert.equal(server.config.ownerPhone, '919811111111', 'kept');
  assert.equal(server.config.tagline, 'New');
  assert.equal(server.public_config.tagline, 'New', 'the public copy follows');
  assert.equal('ownerPhone' in server.public_config, false);
});

test('step 2 refuses, and changes nothing, before step 1', async () => {
  const db = await world();
  const e = await stops(db, STEP2);
  assert.match(e.message, /step 1 is not applied/);
  assert.ok((await as(db, 'anon', 'select config from public.stores')).rows.length);
});

test('step 2 refuses when a row-level policy on stores reads config', async () => {
  const db = await world();
  await db.exec(STEP1);
  await db.exec(`create policy "named shops" on public.stores for select using ((config ->> 'businessName') is not null)`);
  const e = await stops(db, STEP2);
  assert.match(e.message, /policy on stores reads config/);
  assert.ok((await as(db, 'anon', 'select config from public.stores')).rows.length, 'nothing revoked');
});

test('step 2 rolls itself back when config would stay readable (a table-level grant)', async () => {
  const db = await world('grant select on public.stores to anon;');
  await db.exec(STEP1);
  const e = await stops(db, STEP2);
  assert.match(e.message, /still readable/);
  assert.ok(await db.query(`select has_column_privilege('authenticated', 'public.stores', 'config', 'SELECT') as ok`).then((r) => r.rows[0].ok),
    'authenticated keeps config too: the whole step was undone');
});

test('step 1 rewrites only identifiers: a quoted \'config\' in the view is left as it was', async () => {
  const db = await world(`
    create or replace view public.marketplace_listing with (security_invoker = on) as
      select s.slug, s.created_at, s.config ->> 'businessName' as "businessName", s.config -> 'theme' as theme,
             'config'::text as search_text
        from public.stores s;`);
  await db.exec(STEP1);
  assert.deepEqual(await viewReads(db), ['created_at', 'public_config', 'slug']);
  const rows = await listing(db);
  assert.ok(rows.every((r) => r.search_text === 'config'), JSON.stringify(rows));
});

test('step 1 stops, adding nothing, when the view also reads another table with a config column', async () => {
  const db = await world(`
    create table public.extras (slug text primary key, config jsonb);
    grant select on public.extras to anon, authenticated;
    create or replace view public.marketplace_listing with (security_invoker = on) as
      select s.slug, s.created_at, s.config ->> 'businessName' as "businessName", e.config -> 'theme' as theme,
             null::text as search_text
        from public.stores s left join public.extras e on e.slug = s.slug;`);
  const e = await stops(db, STEP1);
  assert.match(e.message, /another relation with a config column/);
  const col = await db.query(`select count(*)::int as n from pg_attribute where attrelid = 'public.stores'::regclass and attname = 'public_config'`);
  assert.equal(col.rows[0].n, 0, 'the column was not added either');
});

test('rollbacks: step 2 undo is instant; step 1 undo refuses until step 2 is undone, then restores the view', async () => {
  const db = await world();
  const before = await listing(db);
  await db.exec(STEP1);
  await db.exec(STEP2);
  assert.match((await stops(db, UNDO1)).message, /step 2 is still applied/);
  await db.exec(UNDO2);
  assert.ok((await as(db, 'anon', 'select config from public.stores')).rows.length, 'config readable again');
  await db.exec(UNDO1);
  assert.doesNotMatch(await viewDef(db), /public_config/);
  const col = await db.query(`select count(*)::int as n from pg_attribute where attrelid = 'public.stores'::regclass and attname = 'public_config' and not attisdropped`);
  assert.equal(col.rows[0].n, 0);
  assert.deepEqual(await listing(db), before);
});

test('the site: every public read asks for public_config; only server-key code reads config', () => {
  const files = execSync('git ls-files src api middleware.js', { cwd: ROOT, encoding: 'utf8' }).split('\n').filter((f) => /\.(js|jsx)$/.test(f));
  const SERVER_KEY = new Set(['api/domains/_db.js', 'api/meta/_meta.js']);   // service-role reads, need the phone
  const raw = /select=(slug,)?config[&,]|\.select\(\s*'config'|'config->>|[:,(]\s*config->/;
  const offenders = [];
  for (const f of files) {
    if (SERVER_KEY.has(f)) continue;
    const src = read(f);
    if (!/from\(['"`]stores['"`]\)|\/rest\/v1\/stores/.test(src)) continue;
    src.split('\n').forEach((line, i) => { if (raw.test(line)) offenders.push(`${f}:${i + 1}: ${line.trim()}`); });
  }
  assert.deepEqual(offenders, [], offenders.join('\n'));
  // And the reads that matter most use the alias, so every caller still gets `config`.
  assert.match(read('api/render.js'), /select=slug,config:public_config&limit=1/);
  assert.match(read('src/utils/storeService.js'), /\.select\('config:public_config'\)/);
  assert.match(read('src/utils/storeService.js'), /\.filter\('public_config->>whatsappNumber', 'ilike'/);
});
