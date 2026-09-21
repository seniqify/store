-- ===========================================================================
--  Shipment attempts ledger -- UNDO
--
--  Drops public.shipment_attempts and its immutability trigger function.
--
--  This is a clean removal AS LONG AS NOTHING READS THE LEDGER YET, which is
--  the state PR B1 leaves the product in: no edge function writes it, no RPC
--  exposes it, no screen reads it, and public.orders is untouched by it.
--  Booking, tracking, cancellation and every Commerce Metrics figure work
--  exactly the same with the table present or absent.
--
--  IT STOPS BEING SAFE once B2 (booking claim) or B3 (status mirroring) ship.
--  From that point the ledger is the only record of how a shipment was booked,
--  and the guard below refuses if anything in public is still referencing it.
--
--  WHAT IS LOST
--   The backfilled history: 172 attempt rows on production at the time of
--   writing. Every one of them was derived from public.orders, which this
--   script does not touch, so re-applying the forward migration reconstructs
--   them identically. Nothing that only exists in the ledger is lost while
--   B1 is the only thing applied.
--
--  RUN: Supabase Dashboard -> SQL Editor -> paste all -> Run. Idempotent.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- Refuse if anything has started depending on the ledger
-- ---------------------------------------------------------------------------
do $preflight$
declare
  v_deps int;
begin
  select count(*) into v_deps
    from pg_depend d
    join pg_rewrite r on r.oid = d.objid
    join pg_class v   on v.oid = r.ev_class
   where d.refobjid = to_regclass('public.shipment_attempts')
     and v.relkind in ('v', 'm')
     and v.relname <> 'shipment_attempts';

  if v_deps > 0 then
    raise exception
      'refusing to run: % view(s)/materialized view(s) still read public.shipment_attempts',
      v_deps;
  end if;

  -- A function body mentioning the table is the B2/B3 tripwire.
  select count(*) into v_deps
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname <> 'shipment_attempt_is_final'
     and p.prosrc ilike '%shipment_attempts%';

  if v_deps > 0 then
    raise exception
      'refusing to run: % function(s) reference shipment_attempts -- B2/B3 may have shipped',
      v_deps;
  end if;
end
$preflight$;

drop trigger if exists shipment_attempts_closed_are_permanent on public.shipment_attempts;
drop table if exists public.shipment_attempts;
drop function if exists public.shipment_attempt_is_final();

commit;

-- public.orders is deliberately not mentioned anywhere above: the forward
-- migration never wrote to it, so there is nothing on it to undo.
