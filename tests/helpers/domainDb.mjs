// Real-Postgres harness for the custom-domain migration (PR-B): PGlite (Postgres
// compiled to WASM, in-process) with a Supabase-shaped baseline, then the REAL
// supabase/custom-domains-forward.sql applied on top.
//
// The baseline reproduces what makes grants dangerous on this project:
//   * the anon / authenticated / service_role roles (service_role BYPASSRLS);
//   * default privileges that give all three EVERY privilege on each new table
//     and sequence and EXECUTE on each new function -- so a migration that
//     forgot a REVOKE would fail these tests, exactly as it would leak on
//     production;
//   * public.stores with stores_slug_key, and one unrelated table, so "existing
//     objects untouched" is checked against something real.
//
// PGlite is a single connection: tests switch roles with SET ROLE, and cannot
// interleave two transactions. See the first-proof-wins tests for what that
// does and does not prove.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHmac } from 'node:crypto';

export const read = (p) => readFileSync(fileURLToPath(new URL(`../../${p}`, import.meta.url)), 'utf8');

export const FORWARD  = read('supabase/custom-domains-forward.sql');
export const VERIFY   = read('supabase/custom-domains-verify.sql');
export const ROLLBACK = read('supabase/custom-domains-ROLLBACK.sql');

// PR-B.1 (reconciler leases + ordered health results), applied on top of PR-B.
export const LEASE_FORWARD  = read('supabase/custom-domains-lease-forward.sql');
export const LEASE_VERIFY   = read('supabase/custom-domains-lease-verify.sql');
export const LEASE_ROLLBACK = read('supabase/custom-domains-lease-ROLLBACK.sql');

export const BASELINE = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables    to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

  create table public.stores (
    id         uuid        primary key default gen_random_uuid(),
    slug       text        not null,
    config     jsonb       not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    constraint stores_slug_key unique (slug)
  );
  alter table public.stores enable row level security;
  create policy stores_public_read on public.stores for select using (true);

  create table public.orders (
    id         uuid        primary key default gen_random_uuid(),
    store_slug text        not null,
    total      numeric,
    created_at timestamptz not null default now()
  );

  insert into public.stores (slug, config) values
    ('alpha', '{"businessName":"Alpha"}'), ('beta', '{"businessName":"Beta"}'),
    ('gamma', '{"businessName":"Gamma"}'), ('delta', '{"businessName":"Delta"}'),
    ('epsilon', '{"businessName":"Epsilon"}'), ('zeta', '{"businessName":"Zeta"}');
  insert into public.orders (store_slug, total) values ('alpha', 120), ('beta', 90);
`;

export async function freshDb({ apply = true, lease = false } = {}) {
  const db = new PGlite();
  await db.exec(BASELINE);
  if (apply) await db.exec(FORWARD);
  if (apply && lease) await db.exec(LEASE_FORWARD);
  return db;
}

/** Run one statement as a role; always resets. */
export async function asRole(db, role, sql, params = []) {
  await db.exec(`set role ${role}`);
  try {
    return await db.query(sql, params);
  } finally {
    await db.exec('reset role');
  }
}

/** Call a jsonb-returning server RPC as service_role; returns the parsed object. */
export async function rpc(db, fn, ...args) {
  const ph = args.map((_, i) => `$${i + 1}`).join(', ');
  const r = await asRole(db, 'service_role', `select public.${fn}(${ph}) as r`, args);
  return r.rows[0].r;
}

/** Expect a query to be refused; returns the error. */
export async function refused(promise) {
  try {
    await promise;
  } catch (e) {
    return e;
  }
  throw new Error('expected the statement to be refused, but it succeeded');
}

/** What PR-C's server will do: HMAC the code with a secret the database never sees. */
export const PEPPER = 'test-only-pepper';
export const codeHash = (code) => createHmac('sha256', PEPPER).update(String(code)).digest('hex');

/** Rows of a group, primary first. */
export async function groupRows(db, groupId) {
  return (await db.query(
    `select * from public.store_domains where group_id = $1 order by role, kind`, [groupId])).rows;
}

/** Move a group's clock back: expires_at (and nothing else) into the past. */
export async function expireNow(db, groupId) {
  await db.query(
    `update public.store_domains set expires_at = now() - interval '1 second' where group_id = $1`, [groupId]);
}
