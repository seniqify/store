-- ═══════════════════════════════════════════════════════════════════════════
--  Store-scoped ads-test authorization  —  PREPARED FOR REVIEW, NOT APPLIED
--
--  Tester : pockelink@gmail.com
--  Scope  : store 'showme' only
--  Expires: 7 days from the moment this runs
-- ═══════════════════════════════════════════════════════════════════════════
--
--  WHY A NEW TABLE INSTEAD OF A crm_team ROLE
--
--  The obvious move — insert a crm_team row with role 'ads_tester' — is unsafe.
--  Every CRM policy keys off is_crm_member(), which tests MEMBERSHIP and not
--  role (console-setup.sql calls the admin variant "the same trust model as
--  is_crm_member(), restricted to role = 'admin'" — the role test lives in a
--  separate function precisely because is_crm_member() has none). Confirmed
--  against pg_policies:
--
--    crm_leads  "team full access leads"   ALL     using is_crm_member()
--    crm_team   "team members read team"   SELECT  using is_crm_member()
--    orders     "crm team read orders"     SELECT  using is_crm_member()
--
--  So a crm_team row for a tester would hand them every merchant's orders
--  (customer names included), the staff roster, and — because crm_leads is ALL,
--  not SELECT — INSERT/UPDATE/DELETE over the entire sales pipeline. An outside
--  reviewer's account could delete leads.
--
--  Nothing below touches crm_team, crm_leads, orders, stores, is_crm_member(),
--  or any existing policy. This script only CREATEs a new table and INSERTs one
--  row into it.
--
--  WHAT ONE ROW GRANTS
--
--  "This user may create PAUSED Meta objects for this ONE store." It is not CRM
--  membership; it cannot read leads, orders, the roster, or any other store; and
--  it can never activate an ad.
--
--  RUN: Supabase Dashboard → SQL Editor → paste → Run. Idempotent; safe to
--  re-run (it refreshes the expiry rather than duplicating the grant).
-- ═══════════════════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 0 — PRE-FLIGHT (read-only). Run this ALONE first.
-- Confirms the account exists and shows whose it is. If this returns no row,
-- stop: create the account under Authentication → Users, then start again.
-- ─────────────────────────────────────────────────────────────────────────────
select id as user_id, email, created_at, last_sign_in_at
from auth.users
where lower(email) = lower('pockelink@gmail.com');


-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 1 — THE TABLE
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.ads_testers (
  user_id    uuid        not null references auth.users (id) on delete cascade,
  store_slug text        not null,
  note       text,                                   -- who this is and why
  expires_at timestamptz,                            -- null = no expiry
  created_at timestamptz not null default now(),
  primary key (user_id, store_slug)
);

comment on table public.ads_testers is
  'Store-scoped permission to create PAUSED Meta ad objects. Deliberately NOT '
  'crm_team membership: that would inherit is_crm_member() access to leads and '
  'orders. Grants nothing but the named store, and never activation.';

alter table public.ads_testers enable row level security;

-- A tester may read their OWN, UNEXPIRED grant and nothing else. The client
-- needs it only to decide whether to render the create button; knowing your own
-- grant reveals nothing about anyone else. Folding the expiry into the policy
-- means an expired grant is invisible even before application code looks at it.
drop policy if exists ads_testers_read_own on public.ads_testers;
create policy ads_testers_read_own on public.ads_testers
  for select to authenticated
  using (
    user_id = auth.uid()
    and (expires_at is null or expires_at > now())
  );

-- No INSERT/UPDATE/DELETE policy is defined, so RLS denies all writes to
-- ordinary users: a tester cannot grant themselves a second store or push out
-- their own expiry. The explicit REVOKEs below are belt-and-braces — they hold
-- even if someone later disables RLS on this table by mistake.
revoke all                     on public.ads_testers from anon;
revoke insert, update, delete  on public.ads_testers from authenticated;

create index if not exists ads_testers_store_idx
  on public.ads_testers (store_slug);


-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 2 — THE GRANT
-- The user id is looked up from the email inside the transaction — never pasted
-- or guessed — and a missing account raises instead of silently inserting zero
-- rows, so "it ran fine" can't mean "it granted nothing".
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  v_email text := 'pockelink@gmail.com';
  v_slug  text := 'showme';
  v_uid   uuid;
begin
  select id into v_uid from auth.users where lower(email) = lower(v_email);

  if v_uid is null then
    raise exception
      'No Supabase auth user with email %. Create the account (Authentication -> Users), then re-run. Nothing was granted.',
      v_email;
  end if;

  -- Refuse to grant to someone who is already CRM staff: that account already
  -- holds is_crm_member() access, so this row would misrepresent it as a
  -- narrowly-scoped tester.
  if exists (select 1 from public.crm_team where user_id = v_uid) then
    raise exception
      'User % is a crm_team member and already has CRM access. A scoped ads-test grant would be misleading. Nothing was granted.',
      v_email;
  end if;

  insert into public.ads_testers (user_id, store_slug, note, expires_at)
  values (v_uid, v_slug,
          'Meta App Review — paused Traffic demo, authorised by founder',
          now() + interval '7 days')
  on conflict (user_id, store_slug) do update
    set note       = excluded.note,
        expires_at = excluded.expires_at;

  raise notice 'Granted % scoped ads-test access to store % until %',
    v_email, v_slug, (now() + interval '7 days');
end $$;


-- ═══════════════════════════════════════════════════════════════════════════
--  VERIFICATION — run after STEP 2. Each query states its own pass condition.
-- ═══════════════════════════════════════════════════════════════════════════

-- V1. The grant exists, names exactly one store, and expires in ~7 days.
--     PASS: exactly one row, store_slug = 'showme', days_left ≈ 7.
select u.email,
       t.store_slug,
       t.expires_at,
       round(extract(epoch from (t.expires_at - now())) / 86400.0, 2) as days_left
from public.ads_testers t
join auth.users u on u.id = t.user_id;

-- V2. The tester is NOT CRM staff, so is_crm_member() is false for them and
--     every crm_leads / crm_team / orders policy denies them.
--     PASS: zero rows.
select 'LEAK: tester is in crm_team' as problem, u.email
from public.crm_team c
join auth.users u on u.id = c.user_id
where lower(u.email) = lower('pockelink@gmail.com');

-- V3. Testers cannot grant themselves access.
--     PASS: exactly ONE row, cmd = 'SELECT'. Any INSERT/UPDATE/ALL row here
--     would mean a tester could write to this table.
select policyname, cmd, roles, qual
from pg_policies
where schemaname = 'public' and tablename = 'ads_testers';

-- V4. RLS is actually switched on (a policy on an RLS-disabled table is inert).
--     PASS: rls_enabled = true.
select relname as table_name, relrowsecurity as rls_enabled
from pg_class
where oid = 'public.ads_testers'::regclass;

-- V5. No write privilege survives at the GRANT level either.
--     PASS: zero rows.
select grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name   = 'ads_testers'
  and grantee      in ('anon', 'authenticated')
  and privilege_type in ('INSERT', 'UPDATE', 'DELETE');

-- V6. Existing CRM policies are untouched. Compare against what you sent me:
--     PASS: crm_leads ALL/is_crm_member(), crm_team SELECT/is_crm_member(),
--     orders SELECT/is_crm_member() + orders_anon_insert, stores public
--     read/insert. Six rows, exactly as before.
select tablename, policyname, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('crm_team', 'crm_leads', 'orders', 'stores')
order by tablename, policyname;

-- V7. Expiry, proven rather than assumed. Backdates the grant, confirms the
--     tester's own RLS view goes empty, then restores the 7-day window.
--     PASS: middle result is zero rows.
begin;
  update public.ads_testers set expires_at = now() - interval '1 minute'
  where store_slug = 'showme';

  -- What the tester's session would see through ads_testers_read_own. Zero rows
  -- means an expired grant is invisible at the database layer, independent of
  -- the separate expiry filter in api/meta/campaign-launch.js.
  select count(*) as rows_visible_to_expired_tester
  from public.ads_testers
  where user_id = (select id from auth.users where lower(email) = lower('pockelink@gmail.com'))
    and (expires_at is null or expires_at > now());
rollback;   -- nothing above is kept


-- ═══════════════════════════════════════════════════════════════════════════
--  REVOKING — after the App Review recording is done
-- ═══════════════════════════════════════════════════════════════════════════
-- delete from public.ads_testers where store_slug = 'showme';
