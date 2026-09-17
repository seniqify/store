-- ===========================================================================
--  Phase 3C, PR 1  --  UNDO
--
--  Drops public.plan_entitlements and everything in it.
--
--  This is safe ONLY while the ledger is still what PR 1 made it: a write-only
--  record that nothing reads and nothing else writes. In that state the table
--  is pure addition, so removing it restores the database exactly.
--
--  IT IS NOT SAFE LATER. Once PR 2+ make the ledger authoritative -- the
--  activation endpoint writing it, the webhook writing it, anything reading it
--  to decide a plan -- dropping it destroys the only server-side record of why
--  merchants have the plans they have, and there is no way to reconstruct it.
--
--  So this file REFUSES rather than trusting whoever pasted it. Section 1 aborts
--  the transaction if it finds any evidence that the ledger has become live.
--  If it aborts, that is the file working correctly. Do not delete the check to
--  get past it -- work out what is writing the ledger first.
--
--  What this file does NOT touch, because PR 1 never touched them:
--    upgrade_store_plan, pending_signups, stores, the webhook, checkout,
--    coupons, phase 1, phase 2.
--
--  RUN: Supabase Dashboard -> SQL Editor -> paste -> Run.
--  VERIFY afterwards: supabase/plan-entitlements-verify.sql
--          (every A/S/E/P/H row returns to 'N/A - ledger not installed',
--           and B1..B7 must read exactly what they read before PR 1.)
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Refuse if the ledger is no longer just an import
-- ---------------------------------------------------------------------------
do $guard$
declare
  v_foreign   integer := 0;
  v_readers   text;
  v_dependent text;
begin
  if to_regclass('public.plan_entitlements') is null then
    raise notice 'plan_entitlements does not exist - nothing to roll back';
    return;
  end if;

  -- (a) Any row that did NOT come from the migration means a real writer has
  --     been active, and its evidence would be destroyed by this drop.
  execute 'select count(*) from public.plan_entitlements where source <> ''migration_backfill'''
    into v_foreign;

  if v_foreign > 0 then
    raise exception using
      errcode = 'raise_exception',
      message = format('REFUSED - %s entitlements were written by something other than the '
                    || 'migration. The ledger is live. Dropping it would destroy the only '
                    || 'server-side record of those grants.', v_foreign),
      hint    = 'Export public.plan_entitlements first, then decide deliberately.';
  end if;

  -- (b) Anything that reads or writes it in SQL means a later phase has wired
  --     it in, even if no foreign row has landed yet.
  select string_agg(p.proname, ', ' order by p.proname) into v_readers
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosrc ilike '%plan_entitlements%';

  if v_readers is not null then
    raise exception using
      errcode = 'raise_exception',
      message = format('REFUSED - these functions reference the ledger: %s. It is wired in.', v_readers),
      hint    = 'Remove or repoint those functions first.';
  end if;

  -- (c) A view or another table depending on it would break on drop anyway,
  --     but say so plainly rather than leaving PostgreSQL to report it.
  select string_agg(distinct c.relname, ', ') into v_dependent
    from pg_depend d
    join pg_rewrite r on r.oid = d.objid
    join pg_class c on c.oid = r.ev_class
   where d.refobjid = to_regclass('public.plan_entitlements')
     and c.relname <> 'plan_entitlements';

  if v_dependent is not null then
    raise exception using
      errcode = 'raise_exception',
      message = format('REFUSED - these objects depend on the ledger: %s', v_dependent),
      hint    = 'Drop them first, on purpose.';
  end if;

  raise notice 'ledger is still import-only - safe to drop';
end;
$guard$;

-- ---------------------------------------------------------------------------
-- 2. Drop it
--
-- No CASCADE. If something unexpected depends on this table, PostgreSQL should
-- stop and say so rather than quietly removing it too. The guard above has
-- already checked the cases we know about.
--
-- The indexes and constraints go with the table. There is nothing else to
-- undo: PR 1 created no function, no policy, no trigger, and altered no
-- existing grant.
-- ---------------------------------------------------------------------------
drop table if exists public.plan_entitlements;

commit;

-- ===========================================================================
--  Nothing else is reverted, because nothing else was changed. In particular
--  upgrade_store_plan is still SECURITY DEFINER with EXECUTE granted to anon,
--  exactly as it was before PR 1 and exactly as it is after it. Closing that
--  is PR 4.
-- ===========================================================================
