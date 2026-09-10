-- ═══════════════════════════════════════════════════════════════════════════
--  Store-scoped ads-test authorization  —  PREPARED FOR REVIEW, NOT APPLIED
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
--  reviewer's account could delete leads. Existing CRM permissions are left
--  exactly as they are; this grant lives in its own table with its own rules.
--
--  WHAT THIS GRANTS
--
--  One row = "this user may create PAUSED Meta objects for this ONE store."
--  It grants nothing else. It is not CRM membership, cannot read leads, orders,
--  the roster or any other store, and can never activate an ad — activation
--  stays admin-only in campaign-launch.js and is refused outright by
--  activationBlocked() on any environment that sets META_ALLOWED_SLUGS.
--
--  Scope is per-store by design. The old role was global: a crm_team role
--  carries no slug, so "scoped to showme" would have been true only because the
--  preview happens to set META_ALLOWED_SLUGS. This table makes the scope a
--  property of the grant, enforced server-side in production too.
--
--  APPLY: Supabase Dashboard → SQL Editor → paste → Run. Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

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

-- A tester may read their OWN grant and nothing else — the client needs it only
-- to decide whether to render the create button. It cannot enumerate other
-- testers, and knowing your own grant reveals nothing about anyone else.
drop policy if exists ads_testers_read_own on public.ads_testers;
create policy ads_testers_read_own on public.ads_testers
  for select to authenticated
  using (user_id = auth.uid());

-- No INSERT/UPDATE/DELETE policy exists, so under RLS nobody can grant
-- themselves access or extend their own expiry. Grants are made only with the
-- service-role key (this SQL editor, or a founder-run statement) — the same
-- shape as console_audit in console-setup.sql.

create index if not exists ads_testers_store_idx
  on public.ads_testers (store_slug);


-- ── The grant itself ────────────────────────────────────────────────────────
-- Left commented deliberately: fill in the email once, then run. Uses a lookup
-- on auth.users rather than a pasted uuid so a typo cannot silently grant
-- access to the wrong account. ON CONFLICT keeps re-running harmless.
--
-- insert into public.ads_testers (user_id, store_slug, note, expires_at)
-- select id, 'showme', 'Meta App Review — paused Traffic demo', now() + interval '30 days'
-- from auth.users
-- where email = 'REPLACE_WITH_TESTER_EMAIL'
-- on conflict (user_id, store_slug) do update
--   set note = excluded.note, expires_at = excluded.expires_at;


-- ── Verification (read-only; run after the grant) ───────────────────────────
-- 1. The grant exists and is scoped to exactly one store:
-- select u.email, t.store_slug, t.expires_at
-- from public.ads_testers t join auth.users u on u.id = t.user_id;
--
-- 2. The tester is NOT a CRM member — this must return zero rows:
-- select 'LEAK: tester is in crm_team' as problem, u.email
-- from public.crm_team c join auth.users u on u.id = c.user_id
-- where u.email = 'REPLACE_WITH_TESTER_EMAIL';


-- ── Revoking (when the review is done) ──────────────────────────────────────
-- delete from public.ads_testers where store_slug = 'showme';
