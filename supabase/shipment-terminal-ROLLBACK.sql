-- ===========================================================================
--  Terminal shipment transitions -- UNDO
--
--  Drops the two B2A.1 functions. Nothing else.
--
--  This is a clean removal AS LONG AS NOTHING CALLS THEM, which is the state
--  PR1 leaves the product in: shipping-ops and shipping-book are byte-for-byte
--  unchanged and still behave exactly as they do today. Dropping two functions
--  nobody invokes restores the exact pre-B2A.1 state.
--
--  IT STOPS BEING SAFE THE MOMENT PR2 IS DEPLOYED. From that point the live
--  shipping-ops calls cancel_current_shipment on every confirmed cancellation,
--  and dropping it does not revert to the old path -- it makes CANCELLATION
--  FAIL OUTRIGHT, because the deployed code calls a function that is no longer
--  there. The database cannot see a deployed edge function, so the guard below
--  can only infer it. Therefore:
--
--    ROLLING BACK AFTER PR2  =  redeploy the previous shipping-ops FIRST,
--                               confirm cancellation works, and only then run
--                               this script.
--
--  IT IS EQUALLY VALID TO LEAVE THEM INSTALLED. These functions are inert
--  without callers: they never run on a schedule, nothing references them from
--  a view, trigger or default. After a runtime rollback the simplest and
--  safest thing is usually to leave them in place and re-deploy PR2 later.
--  Dropping is offered for completeness, not because it is preferred.
--
--  WHAT IS NEVER TOUCHED
--   public.shipment_attempts        kept, with every row, index and trigger.
--   public.orders                   never written by PR1; nothing to undo.
--   B2A's three RPCs                 untouched.
--   TERMINAL LEDGER HISTORY          kept in full. A row closed as 'cancelled'
--                                    or 'superseded' records something that
--                                    actually happened to a real parcel.
--                                    Rolling back code does not un-happen it,
--                                    and this script will not rewrite or
--                                    delete a single terminal row. B1's
--                                    trigger would refuse anyway.
--
--  ORDER RELATIVE TO THE OTHER ROLLBACKS
--   shipment-claim-ROLLBACK.sql (B2A) and shipment-attempts-ROLLBACK.sql (B1)
--   both refuse while functions reference the ledger. This must therefore run
--   BEFORE either of them. The full unwind order is:
--     runtime (PR2) -> this -> B2A rollback -> B1 rollback.
--
--  RUN: Supabase Dashboard -> SQL Editor -> paste all -> Run. Idempotent.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- Refuse if the database can see that these transitions are in use
-- ---------------------------------------------------------------------------
-- A row closed as 'superseded' can only have been written by
-- supersede_shipment_attempt: B1's backfill never produced that reason (its
-- derivation emits delivered / returned / lost / cancelled or nothing), and no
-- other function writes it. Its presence therefore means PR2 or B2B is live.
--
-- A 'cancelled' row is NOT proof on its own: B1 backfilled 2 of them. What
-- distinguishes a row this function closed is that it carries an ended_at,
-- which the backfill deliberately left NULL for cancellations because no
-- authoritative timestamp existed.
--
-- This is evidence, not proof. A PR2 that is deployed but has not yet handled
-- a cancellation leaves no trace here. The operator instruction in the header
-- is the real control; this only catches the case where it was forgotten.
do $preflight$
declare
  v_superseded int;
  v_cancelled  int;
begin
  if to_regclass('public.shipment_attempts') is null then
    return;   -- B1 already rolled back; nothing here can be in use
  end if;

  select count(*) into v_superseded
    from public.shipment_attempts where end_reason = 'superseded';

  select count(*) into v_cancelled
    from public.shipment_attempts
   where end_reason = 'cancelled' and ended_at is not null;

  if v_superseded > 0 then
    raise exception
      'refusing to run: % attempt(s) are closed as superseded, so supersede_shipment_attempt has been called and B2B is live. Redeploy the previous runtime FIRST, confirm booking and cancellation work, then re-run with this guard removed. The superseded rows themselves must be kept.',
      v_superseded;
  end if;

  if v_cancelled > 0 then
    raise exception
      'refusing to run: % attempt(s) are closed as cancelled WITH a recorded ended_at, which only cancel_current_shipment writes, so PR2 is live. Redeploy the previous shipping-ops FIRST, confirm cancellation works, then re-run with this guard removed. The cancelled rows themselves must be kept.',
      v_cancelled;
  end if;
end
$preflight$;

drop function if exists public.cancel_current_shipment(text, uuid, text, text, text);
drop function if exists public.supersede_shipment_attempt(bigint, text, text, text, text);

commit;

-- public.shipment_attempts and public.orders are deliberately not mentioned
-- above. PR1 created no table and wrote no row, so there is no data to undo --
-- and terminal ledger history is never deleted under any circumstances.
