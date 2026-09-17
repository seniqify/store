-- ===========================================================================
--  Commerce metrics, PR 2  --  orders_payment_time_guard
--
--  Locks one invariant going forward: an order that BECOMES paid carries the
--  moment it became paid.
--
--  WHY THIS IS A BACKSTOP AND NOT A FIX
--
--  Every live writer already stamps paid_at, and this migration does not
--  change any of them:
--
--    payments-verify           paid_at: new Date().toISOString()
--    payments-link       (x2)  paid_at: new Date().toISOString()
--    status-sweep        (x2)  paid_at: new Date().toISOString()
--    set_order_paid            paid_at = coalesce(paid_at, now())
--    orders_payment_automation NEW.paid_at := coalesce(NEW.paid_at, now())
--
--  The 84 production rows with paid = true and paid_at = NULL come from the
--  one-time backfill in supabase/payments-automation.sql, which set paid and
--  paid_via and DELIBERATELY did not invent a payment time. That was the right
--  call. This migration does not second-guess it.
--
--  NOTHING HISTORICAL IS REWRITTEN. There is no UPDATE statement in this file.
--  The 84 rows keep paid_at = NULL, which is the canonical, readable value for
--  "collected, time unknown", and the metrics model treats it as a balance that
--  never enters a date-range flow.
--
--  WHY UPDATE ONLY, AND WHY THAT IS COMPLETE
--
--  No INSERT can create a paid row:
--    * orders_insert_guard forces paid = false on every INSERT (phase 1)
--    * the server-side safety net's allowlist sets row.paid = false and
--      row.paid_at = null explicitly (send-otp safeOrderRow)
--  So "becomes paid" is always an UPDATE, and an UPDATE-only trigger covers
--  every path. Firing on INSERT as well would add surface for a transition that
--  cannot happen.
--
--  RUN: Supabase Dashboard -> SQL Editor -> paste -> Run. Idempotent.
--  VERIFY (before AND after): supabase/paid-at-guard-verify.sql
--  UNDO: supabase/paid-at-guard-ROLLBACK.sql
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. The function
--
-- It assigns exactly ONE field. Nothing else in the row can be affected by it,
-- and a test fails if a second assignment ever appears: not payment_method, not
-- paid_via, not payment_ref, not status, not any total.
--
-- SECURITY INVOKER with a pinned search_path, matching
-- orders_payment_automation, the trigger it sits beside.
-- ---------------------------------------------------------------------------
create or replace function public.orders_payment_time_guard()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $function$
begin
  -- Reached only through the trigger's WHEN clause, i.e. only on a genuine
  -- false -> true transition. See section 2.
  --
  -- coalesce semantics, spelled out because the invariant depends on it:
  --   * paid_at already carried on the row (an earlier genuine payment, or a
  --     value the writer supplied in this same statement) -> KEPT, exactly
  --   * paid_at NULL -> stamped now()
  --
  -- So a row that has ever had a real paid_at never has it replaced by a newer
  -- one, including on a later false -> true transition. Refund and repayment
  -- semantics are a separate business workflow and are not decided here.
  if NEW.paid_at is null then
    NEW.paid_at := now();
  end if;

  return NEW;
end;
$function$;

comment on function public.orders_payment_time_guard() is
  'Commerce metrics PR 2 - stamps paid_at on a false to true transition when the writer did not. Never overwrites an existing paid_at, never touches any other column, never fires on a historical row.';

-- ---------------------------------------------------------------------------
-- 2. The trigger
--
-- THE WHEN CLAUSE IS THE SAFETY MECHANISM, not an optimisation.
--
-- With `when (old.paid is not true and new.paid is true)` PostgreSQL does not
-- call the function at all for any other update. So for:
--
--   * a legacy paid row with paid_at NULL, edited for an unrelated reason
--   * a paid row with a real paid_at, edited for an unrelated reason
--   * any update that leaves paid false
--   * any update that sets paid false
--
-- ...the function body never executes. The guarantee is structural rather than
-- a matter of reading the body correctly.
--
-- `old.paid is not true` rather than `old.paid = false` on purpose: paid is
-- nullable, and NULL -> true is just as much a transition as false -> true.
--
-- NAME AND FIRING ORDER. BEFORE row triggers fire in alphabetical order:
--
--   orders_insert_guard          BEFORE INSERT          (phase 1)
--   orders_payment_automation    BEFORE INSERT OR UPDATE
--   orders_payment_time_guard    BEFORE UPDATE          <- this one, last
--
-- Running last is deliberate. orders_payment_automation may itself flip paid to
-- true on a COD delivery and stamp paid_at; this guard then sees the final NEW
-- row, finds paid_at already set, and does nothing. It only ever acts when
-- every writer before it has left paid_at empty.
-- ---------------------------------------------------------------------------
drop trigger if exists orders_payment_time_guard on public.orders;

create trigger orders_payment_time_guard
  before update on public.orders
  for each row
  when (old.paid is not true and new.paid is true)
  execute function public.orders_payment_time_guard();

-- ---------------------------------------------------------------------------
-- 3. Who may call the function directly
--
-- Nobody needs to. PostgreSQL checks EXECUTE on a trigger function when the
-- trigger is CREATED, not when it fires, so revoking afterwards does not stop
-- the trigger working -- and the phase 3B audit flagged the unnecessary PUBLIC
-- EXECUTE that the schema default hands to every new function. Confirmed by a
-- rolled-back dry run against production: with PUBLIC, anon and authenticated
-- all revoked, the trigger still fired and stamped paid_at.
--
-- service_role is revoked too: nothing should call a trigger function
-- directly, and the dry run confirms the trigger still fires with every role
-- revoked. Calling it directly raises 'can only be called as a trigger', so
-- this is hygiene rather than a hole being closed - but it is the same default
-- that made upgrade_store_plan anon-callable, so it is not left to chance.
-- ---------------------------------------------------------------------------
revoke all on function public.orders_payment_time_guard() from public, anon, authenticated, service_role;

commit;

-- ===========================================================================
--  AFTER RUNNING
--
--  Re-run supabase/paid-at-guard-verify.sql and compare with the baseline.
--  Required:
--    * T1..T5 the trigger exists, is enabled, is BEFORE UPDATE, carries the
--      WHEN clause, and its function is invoker + pinned
--    * H1 the 84 legacy rows still read paid_at = NULL, same row ids
--    * H2 every paid row's paid_at value is unchanged
--    * W1..W3 set_order_paid, orders_payment_automation and
--      get_store_order_facts are byte-identical
--    * B1..B4 the other four order triggers, the policies and the browser
--      grants are unchanged -- this migration adds exactly one trigger
--
--  Nothing to deploy. No client code changes in this PR.
-- ===========================================================================
