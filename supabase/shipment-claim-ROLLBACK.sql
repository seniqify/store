-- ===========================================================================
--  Atomic shipment booking claim -- UNDO
--
--  Drops the three B2A functions. Nothing else.
--
--  This is a clean removal AS LONG AS NOTHING CALLS THEM, which is the state
--  PR B2A leaves the product in: shipping-book is byte-for-byte unchanged and
--  still books the way it does today. Dropping three functions nobody invokes
--  restores the exact pre-B2A behaviour.
--
--  IT STOPS BEING SAFE THE MOMENT B2B IS DEPLOYED. From that point the live
--  edge function calls claim_shipment_attempt before every courier request,
--  and dropping it does not revert to the old path -- it makes BOOKING FAIL
--  OUTRIGHT, because the deployed code will call a function that is no longer
--  there. The guard below refuses in that case as far as the database can see
--  it, but the database cannot see a deployed edge function. So:
--
--    ROLLING BACK AFTER B2B  =  redeploy the previous shipping-book version
--                               FIRST, confirm booking works, and only then
--                               run this script.
--
--  WHAT IS NOT TOUCHED
--   public.shipment_attempts        kept, with every row, index and trigger.
--   public.orders                   never written by B2A; nothing to undo.
--   B1's backfilled history          kept in full.
--   Any attempt a live B2B created   kept. An open claim stays open and keeps
--                                    blocking, which is the safe direction: an
--                                    unresolved booking must not silently
--                                    become bookable again because a migration
--                                    was rolled back.
--
--  ORDER RELATIVE TO B1's ROLLBACK
--   shipment-attempts-ROLLBACK.sql refuses to run while any function mentions
--   shipment_attempts -- the B2/B3 tripwire. These three do. So this script
--   must run BEFORE it, never after. That ordering is deliberate: the ledger
--   cannot be dropped out from under the functions that write it.
--
--  RUN: Supabase Dashboard -> SQL Editor -> paste all -> Run. Idempotent.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- Refuse if the database can see that the claim path is in use
-- ---------------------------------------------------------------------------
-- A claim leaves a fingerprint B1's backfill never could: claimed_at is NULL on
-- every one of the 173 backfilled rows, by design, because that moment was
-- never recorded. So any row with claimed_at set was written by
-- claim_shipment_attempt -- which means B2B is deployed and calling it.
--
-- This is evidence, not proof. A B2B that was deployed and has not yet taken a
-- booking leaves no trace here at all. The operator instruction above is the
-- real control; this only catches the case where it was forgotten.
do $preflight$
declare
  v_claims int;
  v_open   int;
begin
  if to_regclass('public.shipment_attempts') is null then
    return;   -- B1 already rolled back; nothing here can be in use
  end if;

  select count(*) into v_claims
    from public.shipment_attempts where claimed_at is not null;

  select count(*) into v_open
    from public.shipment_attempts where end_reason is null and awb is null;

  if v_claims > 0 then
    raise exception
      'refusing to run: % attempt(s) were created by claim_shipment_attempt, so B2B is live. Redeploy the previous shipping-book FIRST, confirm booking works, then re-run with the guard removed.',
      v_claims;
  end if;

  if v_open > 0 then
    raise exception
      'refusing to run: % open claim(s) hold no AWB and are unresolved. Dropping the finalize/fail primitives would leave them with no way to be closed.',
      v_open;
  end if;
end
$preflight$;

drop function if exists public.claim_shipment_attempt(text, uuid, text);
drop function if exists public.finalize_shipment_attempt(bigint, text, text, text, numeric, text);
drop function if exists public.fail_shipment_attempt(bigint, text, text);

commit;

-- public.shipment_attempts and public.orders are deliberately not mentioned
-- above. B2A created no table and wrote no row, so there is no data to undo.
