-- ===========================================================================
--  Phase 3C, PR 1  --  PLAN ENTITLEMENT LEDGER  (foundation only)
--
--  Creates public.plan_entitlements and imports the plan each store has TODAY.
--
--  THIS MIGRATION IS NOT AN AUTHORITY SWITCH.
--  Nothing reads this table. The application keeps reading stores.config
--  exactly as it does now. Not one existing function, grant, policy, trigger
--  or store row is touched.
--
--  What it does NOT do, deliberately:
--    * does not modify or re-grant upgrade_store_plan   (still anon-callable)
--    * does not modify pending_signups
--    * does not change verify-razorpay-payment or razorpay-webhook
--    * does not write to public.stores -- not one row, not updated_at
--    * does not change planLimits / effectivePlan / the AI plan gates
--    * does not touch phase 2, checkout, coupons, renewal or cancellation
--
--  RUN: Supabase Dashboard -> SQL Editor -> paste -> Run. Idempotent (see 4).
--  VERIFY (before AND after): supabase/plan-entitlements-verify.sql
--  UNDO: supabase/plan-entitlements-ROLLBACK.sql
--
--  ---------------------------------------------------------------------------
--  READ THIS BEFORE CHANGING THE GRANTS BELOW
--
--  This project's default privileges in schema public grant arwdDxtm -- every
--  privilege, INCLUDING TRUNCATE AND DELETE -- to anon and authenticated on
--  EVERY newly created table:
--
--    postgres      / public / type=r = anon=arwdDxtm/postgres
--                                      authenticated=arwdDxtm/postgres
--    supabase_admin / public / type=r = anon=arwdDxtm/supabase_admin
--                                       authenticated=arwdDxtm/supabase_admin
--
--  So a bare CREATE TABLE in this schema is world-writable the moment it
--  exists. The REVOKE in section 3 is not belt-and-braces -- it is the only
--  thing standing between a browser and this ledger, and it runs in the same
--  transaction as the CREATE so the table is never briefly open.
--
--  This is also how pending_signups and console_audit acquired the grants
--  earlier phases had to strip.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. The table
--
-- Column rule applied throughout: A COLUMN SHIPS IN THE PR THAT FIRST WRITES
-- IT. Fields from the accepted phase-3C design that no writer in THIS PR can
-- populate are deliberately absent, and are listed with their reasons at the
-- bottom of this section.
-- ---------------------------------------------------------------------------
create table if not exists public.plan_entitlements (
  id           uuid        primary key default pg_catalog.gen_random_uuid(),

  -- The subject. stores.slug is UNIQUE (stores_slug_key), so this is a real
  -- foreign key rather than a loose string.
  --
  -- ON DELETE RESTRICT, matching order_integrity from phase 2: a billing
  -- ledger must not be silently emptied by deleting its subject. Nothing in
  -- the codebase deletes a store (checked), so this blocks nothing that
  -- happens today. To delete a store by hand later, delete or revoke its
  -- entitlements first, on purpose.
  store_slug   text        not null references public.stores(slug) on delete restrict,

  plan         text        not null,

  -- WHERE the grant came from. Security-sensitive: this is what separates
  -- "a payment was proven" from "this is what the row already said".
  source       text        not null,

  -- WHETHER the grant still stands. Deliberately NOT whether it is in force
  -- right now -- see section 4 on lapsed stores.
  status       text        not null default 'active',

  -- NULL means "unknown". Imported rows genuinely do not know when the plan
  -- started; inventing a date would be the exact dishonesty this table exists
  -- to prevent.
  starts_at    timestamptz,

  -- NULL means "no expiry", which is a real state: two production stores hold
  -- a paid plan with no planExpiresAt and are entitled indefinitely.
  expires_at   timestamptz,

  -- The only external reference this PR can populate (7 stores carry one).
  -- NOT unique -- see section 2.
  razorpay_subscription_id text,

  -- Security-sensitive. The anchor for every future writer: the webhook, the
  -- activation endpoint and a Razorpay retry can all race for the same charge
  -- and exactly one row survives. For this migration it is what makes a rerun
  -- a no-op rather than a second grant.
  idempotency_key text     not null,

  -- Security-sensitive, and the most important column in the table.
  -- NON-NULL means: a server checked a cryptographic proof of payment and this
  -- is when. NULL means no such proof exists. Every row this migration writes
  -- is NULL, and a constraint makes that permanent for imported rows.
  verified_at  timestamptz,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  -- -- constraints --------------------------------------------------------

  constraint plan_entitlements_idempotency_key_key unique (idempotency_key),

  -- Every plan key the product has ever issued, including the retired ones,
  -- because grandfathered Razorpay mandates still renew on them
  -- (see PLAN_BY_ID in supabase/functions/razorpay-webhook/index.ts).
  constraint plan_entitlements_plan_known check (
    plan in ('free', 'starter', 'pro', 'business', 'premium', 'premium_plus')
  ),

  constraint plan_entitlements_source_known check (
    source in ('migration_backfill', 'razorpay_subscription', 'razorpay_payment',
               'coupon', 'console')
  ),

  constraint plan_entitlements_status_known check (
    status in ('active', 'superseded', 'revoked')
  ),

  constraint plan_entitlements_window_ordered check (
    starts_at is null or expires_at is null or expires_at > starts_at
  ),

  -- THE HONESTY CONSTRAINT. Imported production state can never be labelled
  -- as verified payment, by this migration or by anything later.
  constraint plan_entitlements_imported_is_never_verified check (
    source <> 'migration_backfill' or verified_at is null
  ),

  -- The other direction: a row that claims a payment source must say when the
  -- proof was checked. Nothing in this PR writes such a row.
  constraint plan_entitlements_payment_sources_are_verified check (
    source not in ('razorpay_subscription', 'razorpay_payment')
    or verified_at is not null
  )
);

-- Columns from the phase-3C design that are NOT here, and why:
--
--   phone_last10       Stores PII and has no writer in this PR. It belongs in
--                      the PR that closes pending_signups, where its purpose
--                      and its retention get designed together. Adding an
--                      unwritten PII column to a security table now is the
--                      same mistake review rejected in phase 3A.
--   razorpay_payment_id, razorpay_plan_id, source_reference, metadata
--                      No writer in this PR and no backfill source -- none of
--                      these appear anywhere in stores.config. They ship with
--                      the endpoint that first needs them.
--
-- Constraints deliberately NOT added:
--
--   A format CHECK on razorpay_subscription_id. All 7 production values match
--   ^sub_[A-Za-z0-9]+$ with zero anomalies, so it would pass today -- but it
--   is a hard constraint on a third party's identifier format, and the failure
--   mode is a webhook INSERT rejecting a real payment. Format validation
--   belongs in the writer, where it can log and fall back.

comment on table public.plan_entitlements is
  'Server-owned record of WHY a store has its plan. Phase 3C PR 1 - written by migration only, read by nothing. stores.config remains the read path.';

-- ---------------------------------------------------------------------------
-- 2. Indexes
--
-- NO UNIQUE INDEX ON razorpay_subscription_id, and this is a decision, not an
-- omission. Production has zero duplicates across all 7 values today, so the
-- constraint WOULD succeed -- which is exactly what makes adding it an easy,
-- silent mistake. This ledger is append-only: one subscription legitimately
-- produces a new entitlement row on every renewal cycle. Uniqueness belongs on
-- idempotency_key, which encodes (source, reference, cycle), and it is there.
-- ---------------------------------------------------------------------------
create index if not exists plan_entitlements_store_slug_idx
  on public.plan_entitlements (store_slug);

create index if not exists plan_entitlements_store_active_idx
  on public.plan_entitlements (store_slug) where status = 'active';

create index if not exists plan_entitlements_subscription_idx
  on public.plan_entitlements (razorpay_subscription_id)
  where razorpay_subscription_id is not null;

-- ---------------------------------------------------------------------------
-- 3. Authority boundary  (read the header before touching this)
--
-- Two independent locks, because either one alone has failed in this project
-- before:
--   * RLS on with ZERO policies -- no row is visible or writable to a role
--     that does not bypass RLS, even if a grant reappears.
--   * Grants revoked from the browser roles -- because the schema default
--     hands them everything, including TRUNCATE, which ignores RLS entirely.
--
-- service_role gets SELECT/INSERT/UPDATE. It does NOT get DELETE or TRUNCATE:
-- an entitlement is withdrawn by setting status='revoked', never by erasing
-- the evidence.
-- ---------------------------------------------------------------------------
alter table public.plan_entitlements enable row level security;

revoke all on public.plan_entitlements from anon, authenticated;
revoke all on public.plan_entitlements from public;

-- service_role is revoked FIRST and then granted back exactly three
-- privileges. The schema default hands it arwdDxtm as well, so granting
-- without revoking would silently leave DELETE and TRUNCATE in place -- which
-- is what a rolled-back dry run of this very file caught. Granting a subset
-- does not remove a privilege that is already there.
revoke all on public.plan_entitlements from service_role;
grant select, insert, update on public.plan_entitlements to service_role;

-- No policies are created. That is intentional and is asserted by the verifier.
-- No RPC is created either: there is deliberately no way for a browser role to
-- reach this table at all, directly or through a function.

-- ---------------------------------------------------------------------------
-- 4. Backfill
--
-- WHAT THIS IS: a snapshot of what stores.config says right now.
-- WHAT THIS IS NOT: evidence that any of these merchants paid.
--
-- Every row is written with source='migration_backfill' and verified_at=NULL,
-- and plan_entitlements_imported_is_never_verified makes that permanent. The
-- five stores carrying a console billingNote have no machine-readable payment
-- reference of any kind (checked: zero of them carry a payment id), and this
-- migration invents none for them -- they import exactly like every other row,
-- as unverified legacy state.
--
-- ALL 36 stores are imported, including the 8 on 'free'. A complete snapshot
-- is what a backfill is, and it makes coverage trivially checkable (36 = 36)
-- rather than a conditional subset the verifier has to re-derive.
--
-- LAPSED STORES STAY LAPSED. status='active' on every row means "this grant
-- still stands", NOT "this plan is in force today". Whether a plan is in force
-- is derived from expires_at vs now(), which is precisely what effectivePlan()
-- already does in the application:
--
--     plan !== 'free' && exp && new Date(exp) < Date.now()  ->  'free'
--
-- Storing a frozen 'expired' status instead would denormalise a time-derived
-- fact into a column that goes stale the moment the clock moves. expires_at is
-- copied verbatim, so the derivation produces the same answer here as it does
-- in src/utils/planLimits.js. The verifier proves that store by store.
--
-- IDEMPOTENCY: idempotency_key is 'migration_backfill:' || slug and is UNIQUE,
-- so ON CONFLICT DO NOTHING makes a rerun insert zero rows and change nothing.
-- Rerunning after a new store has been created imports that one store and
-- leaves the other 36 untouched.
-- ---------------------------------------------------------------------------
insert into public.plan_entitlements (
  store_slug, plan, source, status, starts_at, expires_at,
  razorpay_subscription_id, idempotency_key, verified_at
)
select
  s.slug,
  coalesce(s.config->>'plan', 'free'),
  'migration_backfill',
  'active',
  null,                                   -- starts_at: genuinely unknown
  case when jsonb_typeof(s.config->'planExpiresAt') = 'string'
         and s.config->>'planExpiresAt' <> ''
       then (s.config->>'planExpiresAt')::timestamptz
  end,
  case when jsonb_typeof(s.config->'razorpaySubscriptionId') = 'string'
         and s.config->>'razorpaySubscriptionId' <> ''
       then s.config->>'razorpaySubscriptionId'
  end,
  'migration_backfill:' || s.slug,
  null                                    -- verified_at: never, for imports
from public.stores s
where coalesce(s.config->>'plan', 'free')
      in ('free', 'starter', 'pro', 'business', 'premium', 'premium_plus')
on conflict (idempotency_key) do nothing;

-- Any store whose plan key is NOT in the known set is skipped rather than
-- failing the migration. Production has none (only free/business/premium
-- exist), and the verifier reports coverage, so a skip would show up as a
-- coverage gap instead of an aborted transaction at 2am.

commit;

-- ===========================================================================
--  AFTER RUNNING
--
--  Re-run supabase/plan-entitlements-verify.sql and compare against the
--  baseline you captured before applying. Required:
--
--    * B1 stores_plan_fingerprint IDENTICAL before and after
--      (this is the proof the migration did not touch a single store)
--    * B2..B6 function/grant/policy fingerprints IDENTICAL before and after
--    * E1 entitlements = 36, exactly one per store, zero duplicates
--    * P1..P4 plan / expiry / subscription-id / in-force parity: zero
--      mismatches
--    * H1 zero imported rows carry verified_at
--    * A1..A4 RLS on, zero policies, zero anon/authenticated grants
--
--  The application is unchanged. Do not deploy anything for this migration --
--  there is no client code in this PR.
-- ===========================================================================
