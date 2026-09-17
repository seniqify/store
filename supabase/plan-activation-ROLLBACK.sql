-- ===========================================================================
--  Phase 3C, PR 2  --  UNDO
--
--  Removes the entitlement writer and the two evidence columns it added.
--  It does NOT remove the ledger itself -- that is PR 1's rollback.
--
--  Safe ONLY while the writer has never granted anything. Once it has, those
--  columns hold the payment evidence behind real entitlements and dropping
--  them destroys it irreversibly, so this file REFUSES rather than trusting
--  whoever pasted it.
--
--  What this file does NOT touch, because PR 2 never touched them:
--    upgrade_store_plan (still SECURITY DEFINER, still anon-executable),
--    pending_signups, razorpay-webhook, stores, checkout, phase 1, phase 2,
--    and the 36 migration_backfill rows.
--
--  RUN: Supabase Dashboard -> SQL Editor -> paste -> Run.
--  VERIFY afterwards: supabase/plan-activation-verify.sql
--          (W1..W5 and C1..C2 return to 'N/A - writer not installed'.
--           B1, G1..G4 and L1..L4 must read exactly what they read before.)
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Refuse if the writer has ever granted anything
--
-- Same shape as PR 1's guard, and for the same reason: the evidence is the
-- point of the table, and a DROP COLUMN cannot be undone by re-adding it.
--
-- Note this deliberately checks for ANY non-backfill row, not only rows with a
-- payment id. A grant written by this writer without a payment id -- an
-- activation event rather than a charge -- is still a grant whose plan_id
-- evidence would be destroyed.
-- ---------------------------------------------------------------------------
do $guard$
declare
  v_granted   integer := 0;
  v_evidence  integer := 0;
  v_callers   text;
begin
  if to_regclass('public.plan_entitlements') is null then
    raise notice 'plan_entitlements does not exist - nothing to roll back';
    return;
  end if;

  execute 'select count(*) from public.plan_entitlements where source <> ''migration_backfill'''
    into v_granted;

  if v_granted > 0 then
    raise exception using
      errcode = 'raise_exception',
      message = format('REFUSED - the writer has granted %s entitlements. Dropping the evidence '
                    || 'columns would destroy the payment references behind them.', v_granted),
      hint    = 'Export public.plan_entitlements first, then decide deliberately.';
  end if;

  -- Belt and braces: even a backfill row should never carry payment evidence,
  -- but if something has written into these columns, do not silently bin it.
  execute 'select count(*) from public.plan_entitlements '
       || 'where razorpay_payment_id is not null or razorpay_plan_id is not null'
    into v_evidence;

  if v_evidence > 0 then
    raise exception using
      errcode = 'raise_exception',
      message = format('REFUSED - %s rows carry values in the evidence columns.', v_evidence),
      hint    = 'Export those rows before dropping the columns.';
  end if;

  -- Anything that calls the writer means a later phase has wired it in. The
  -- catalog records a dependency for BEGIN ATOMIC SQL bodies only, so this is
  -- a text scan across every schema -- the same reasoning as PR 1's guard (d).
  select string_agg(n.nspname || '.' || p.proname, ', ' order by n.nspname, p.proname)
    into v_callers
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname not in ('pg_catalog', 'information_schema')
     and p.proname <> 'apply_plan_entitlement'
     and p.prosrc ilike '%apply_plan_entitlement%';

  if v_callers is not null then
    raise exception using
      errcode = 'raise_exception',
      message = format('REFUSED - these functions call the writer: %s', v_callers),
      hint    = 'Repoint them first, on purpose.';
  end if;

  raise notice 'writer has granted nothing and has no SQL callers - safe to remove';
end;
$guard$;

-- ---------------------------------------------------------------------------
-- 2. Remove the writer, then the constraint, then the columns
--
-- No CASCADE anywhere. If something unexpected depends on any of these,
-- PostgreSQL must stop and say so rather than quietly removing it too.
--
-- The plan-activate edge function becomes a 500 the moment this runs. That is
-- correct: it has no other way to write an entitlement, and in this PR nothing
-- calls it.
-- ---------------------------------------------------------------------------
drop function if exists public.apply_plan_entitlement(text, text, text, timestamptz, timestamptz,
                                                      text, text, text, text, timestamptz);

alter table public.plan_entitlements
  drop constraint if exists plan_entitlements_subscription_evidence;

alter table public.plan_entitlements drop column if exists razorpay_payment_id;
alter table public.plan_entitlements drop column if exists razorpay_plan_id;

commit;

-- ===========================================================================
--  The ledger, its 36 imported rows, and every PR 1 constraint remain exactly
--  as they were. upgrade_store_plan is still SECURITY DEFINER with EXECUTE
--  granted to anon -- PR 2 never changed it, so there is nothing to restore.
-- ===========================================================================
