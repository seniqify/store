-- ===========================================================================
--  Shipment attempts -- PRE-B2B LEDGER GAP REPAIR (AWB-bearing orders only)
--  PREPARED FOR REVIEW. NOT APPLIED.
--
--  WHY
--   B1 filled public.shipment_attempts once, on 2026-09-21. Nothing has
--   written it since: today's shipping-book books through public.orders
--   alone, and will until B2B ships. So every shipment booked after B1 has an
--   AWB on its order and no ledger row. The read-only diagnostic of
--   2026-09-25 found 41 of them (40 Shadowfax, 1 Delhivery) and proved each
--   one an ordinary post-B1 booking.
--
--   The gap matters before PR2. cancel_current_shipment deliberately refuses
--   an order with no ledger row (attempt_not_found) instead of clearing its
--   pointer on an assertion the ledger cannot corroborate. With the gap open,
--   PR2 would make every recent shipment uncancellable.
--
--  WHAT THIS DOES
--   Writes ONE attempt for every order that
--     * carries an AWB (non-null and non-blank),
--     * whose courier normalises to exactly 'delhivery' or 'shadowfax', and
--     * has no shipment_attempts row at all.
--   B1's truth rules, unchanged: attempt_no 1; claimed_at and booked_at NULL
--   because neither moment was recorded; shipping_cost copied as the quote it
--   is; end_reason from shipment_outcome first, then the raw courier status --
--   the derivation below is B1's, copied exactly, and a test pins the two
--   together. Terminal times come only from delivered_at / returned_at.
--   Nothing is timestamped now().
--
--  WHAT THIS DELIBERATELY DOES NOT DO
--   * It is NOT a re-run of shipment-attempts-forward.sql. B1's backfill also
--     picks up orders that have a courier but NO AWB. Today that is exactly
--     one order: a booking cancelled in the app after B1 and later marked
--     delivered. B1's derivation would freeze it forever as "delivered, no
--     AWB", and the data cannot say whether that is true -- a real cancel
--     followed by a hand delivery, or a courier REFUSAL that today's
--     shipping-ops misread as success, after which the parcel was delivered
--     anyway. Closed rows can never be edited, so a guess could never be
--     taken back. Every order without an AWB is excluded, by construction.
--   * It never updates or deletes a ledger row. Existing attempts, open or
--     closed, are not touched; B1's trigger would refuse the closed ones.
--   * It does not write public.orders.
--   * It does not refresh stale OPEN attempts. The same diagnostic found 22
--     of the 49 open attempts whose order already reads delivered / returned
--     / lost. Nothing mirrors courier status into the ledger yet -- that is
--     B3 -- and this repair only adds missing rows. See the PR2 note at the
--     foot of this file.
--
--  IDEMPOTENT
--   Re-running is safe and intended. An order that already has a row is
--   skipped, so a second run writes only bookings made since the first. It
--   may write more than 41: every booking between the diagnostic and the run
--   is a gap of exactly the same proven shape.
--
--  WHEN TO RUN IT
--   Immediately before PR2 goes live -- not days before. Today's shipping-ops
--   clears orders.awb on an in-app cancel WITHOUT closing the ledger row, so
--   every open row this adds can be stranded by a cancellation until PR2
--   ships. Run it once more straight after B2B deploys, to catch bookings
--   made by old shipping-book instances during the version swap.
--
--  HOW IT IS BUILT
--   Two statements. First, a check that refuses unsafe states with a plain
--   message. Second, ONE INSERT that writes the rows and reports what it did,
--   in a single snapshot: it writes every row or none, so there is no partial
--   state. The database's own constraints refuse exactly what the check
--   refuses -- the check exists to explain, not to protect.
--
--  RUN: Supabase Dashboard -> SQL Editor -> paste all -> Run.
--  You will see a small before / written / after table.
--  Then run supabase/shipment-attempts-gap-verify.sql (read-only).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Refuse unsafe states before anything is written
-- ---------------------------------------------------------------------------
do $preflight$
declare
  v_repeated int;
  v_taken    int;
  v_nostore  int;
begin
  if to_regclass('public.shipment_attempts') is null then
    raise exception 'gap repair refused: public.shipment_attempts does not exist -- B1 is not applied to this database. Nothing was written.';
  end if;

  with candidate as (
    select o.id,
           o.store_slug,
           lower(btrim(coalesce(o.courier, '')))   as courier,
           nullif(btrim(coalesce(o.awb, '')), '')  as awb
      from public.orders o
     where nullif(btrim(coalesce(o.awb, '')), '') is not null
       and lower(btrim(coalesce(o.courier, ''))) in ('delhivery', 'shadowfax')
       and not exists (select 1 from public.shipment_attempts sa where sa.order_id = o.id)
  )
  select
    (select count(*) from (select c.courier, c.awb from candidate c
                            group by c.courier, c.awb having count(*) > 1) d),
    (select count(*) from candidate c
      where exists (select 1 from public.shipment_attempts a
                     where a.courier = c.courier and a.awb = c.awb)),
    (select count(*) from candidate c where c.store_slug is null)
    into v_repeated, v_taken, v_nostore;

  -- Two ledger rows must never claim one parcel.
  if v_repeated > 0 then
    raise exception 'gap repair refused: % (courier, AWB) pair(s) appear on more than one order that would be written. Nothing was written.', v_repeated
      using hint = 'Look at the orders sharing that AWB before repairing anything.';
  end if;

  if v_taken > 0 then
    raise exception 'gap repair refused: % order(s) carry an AWB that an existing ledger row already holds. Nothing was written.', v_taken
      using hint = 'An AWB resolves to exactly one attempt. Find out which order really owns it.';
  end if;

  if v_nostore > 0 then
    raise exception 'gap repair refused: % order(s) to be written have no store_slug. Nothing was written.', v_nostore;
  end if;
end
$preflight$;

-- ---------------------------------------------------------------------------
-- 2. The repair: ONE statement that writes and reports in a single snapshot
-- ---------------------------------------------------------------------------
with candidate as (
  select o.id,
         o.store_slug,
         lower(btrim(coalesce(o.courier, '')))   as courier,
         nullif(btrim(coalesce(o.awb, '')), '')  as awb,
         o.shipping_cost,
         o.shipment_status,
         o.delivered_at,
         o.returned_at,
         -- B1's derivation, copied exactly from shipment-attempts-forward.sql.
         -- The same shipment_outcome -> raw status precedence, the same
         -- return-family-first order, the same not-delivered guard.
         case
           when o.shipment_outcome = 'delivered'                          then 'delivered'
           when o.shipment_outcome = 'returned'                           then 'returned'
           when o.shipment_outcome = 'lost'                               then 'lost'
           when coalesce(o.shipment_status, '') ~* '(rto|rts|return)'     then 'returned'
           when coalesce(o.shipment_status, '') ~* '\mlost\M'             then 'lost'
           when coalesce(o.shipment_status, '') ~* '\mdelivered\M'
            and coalesce(o.shipment_status, '') !~* '(undeliver|not deliver)' then 'delivered'
           when coalesce(o.shipment_status, '') ~* 'cancel'               then 'cancelled'
           else null
         end                                     as reason
    from public.orders o
   where nullif(btrim(coalesce(o.awb, '')), '') is not null
     and lower(btrim(coalesce(o.courier, ''))) in ('delhivery', 'shadowfax')
     and not exists (select 1 from public.shipment_attempts sa where sa.order_id = o.id)
),
before as (
  select
    (select count(*) from public.shipment_attempts)                          as attempts,
    (select count(*) from public.shipment_attempts where end_reason is null) as open_attempts,
    (select count(*) from candidate)                                         as gaps,
    -- An AWB with a courier this ledger does not accept: never written here.
    (select count(*) from public.orders o
      where nullif(btrim(coalesce(o.awb, '')), '') is not null
        and lower(btrim(coalesce(o.courier, ''))) not in ('delhivery', 'shadowfax')
        and not exists (select 1 from public.shipment_attempts sa
                         where sa.order_id = o.id))                          as gaps_unwritable,
    -- A courier but no AWB: never written here. Includes the ambiguous order.
    (select count(*) from public.orders o
      where nullif(btrim(coalesce(o.awb, '')), '') is null
        and nullif(btrim(coalesce(o.courier, '')), '') is not null
        and not exists (select 1 from public.shipment_attempts sa
                         where sa.order_id = o.id))                          as no_awb
),
written as (
  insert into public.shipment_attempts
    (store_slug, order_id, attempt_no, courier, awb,
     claimed_at, booked_at, shipping_cost, ended_at, end_reason, final_status)
  select c.store_slug,
         c.id,
         1,
         c.courier,
         c.awb,
         null,                        -- claimed_at: never recorded
         null,                        -- booked_at:  never recorded
         c.shipping_cost,             -- the booking-time quote, copied as-is
         case c.reason
           when 'delivered' then c.delivered_at
           when 'returned'  then c.returned_at
           when 'lost'      then c.returned_at
           else null                  -- no authoritative timestamp exists
         end,
         c.reason,
         nullif(btrim(coalesce(c.shipment_status, '')), '')
    from candidate c
  returning courier, awb, end_reason
)

select * from (

  -- == 1. before ==============================================================
  select 110 as seq, '1 before' as grp,
         '1.1 ledger rows' as check_name,
         '(info) ' || (select attempts from before)::text as result
  union all select 111,'1 before','1.2 of which open',
    '(info) ' || (select open_attempts from before)::text
  union all select 112,'1 before','1.3 orders with an AWB and a delhivery/shadowfax courier but no ledger row',
    '(info) ' || (select gaps from before)::text
  union all select 113,'1 before','1.4 orders with an AWB and any OTHER courier, no ledger row (never written)',
    case when (select gaps_unwritable from before) = 0 then 'PASS'
         else 'FAIL - ' || (select gaps_unwritable from before)::text
              || ' order(s) left unrepaired, investigate before PR2' end
  union all select 114,'1 before','1.5 orders with a courier but NO AWB, no ledger row (never written, by design)',
    '(info) ' || (select no_awb from before)::text

  -- == 2. written =============================================================
  union all select 210,'2 written','2.1 ledger rows written',
    '(info) ' || (select count(*) from written)::text
  union all select 211,'2 written','2.2 by courier',
    '(info) ' || coalesce((select string_agg(courier || '=' || n, ', ' order by n desc, courier)
                             from (select courier, count(*) n from written
                                    group by courier) t), 'none')
  union all select 212,'2 written','2.3 by end_reason',
    '(info) ' || coalesce((select string_agg(coalesce(end_reason, 'OPEN') || '=' || n,
                                             ', ' order by n desc, end_reason)
                             from (select end_reason, count(*) n from written
                                    group by end_reason) t), 'none')
  union all select 213,'2 written','2.4 rows written without an AWB (must be 0)',
    case when (select count(*) from written where awb is null) = 0
         then 'PASS' else 'FAIL' end

  -- == 3. after ===============================================================
  union all select 310,'3 after','3.1 ledger rows',
    '(info) ' || ((select attempts from before) + (select count(*) from written))::text
  union all select 311,'3 after','3.2 of which open',
    '(info) ' || ((select open_attempts from before)
                  + (select count(*) from written where end_reason is null))::text
  union all select 312,'3 after','3.3 orders with an AWB and a valid courier still without a row',
    case when (select gaps from before) = (select count(*) from written)
         then 'PASS' else 'FAIL' end

) report
order by seq;

-- ---------------------------------------------------------------------------
-- NOTE FOR PR2 -- documented here, NOT implemented by this file
-- ---------------------------------------------------------------------------
-- The ledger is not a live mirror of courier status. The 2026-09-25
-- diagnostic found 22 of the 49 OPEN attempts whose order already reads
-- delivered / returned / lost. cancel_current_shipment's
-- shipment_already_terminal guard can only see terminal states the ledger
-- has recorded, so for those 22 -- and for every row this repair writes as
-- open, once its parcel is delivered -- it cannot refuse on its own.
--
-- PR2 must therefore not rely on shipment_attempts alone. BEFORE contacting
-- the courier, shipping-ops must refuse the cancellation locally whenever the
-- ORDER's own evidence says the shipment has ended, with B1's precedence:
--   1. shipment_outcome in ('delivered', 'returned', 'lost')         -> refuse
--   2. otherwise shipment_status, read exactly as the derivation above reads
--      it: the return family, then lost, then delivered guarded against
--      "undeliver" / "not deliver"                                  -> refuse
-- Only then may it call the courier, and it must still require an
-- explicitly positive cancellation confirmation before calling
-- cancel_current_shipment. That RPC's own guard stays as the second,
-- ledger-side check.
--
-- This gate is a read of the order at cancel time. It is NOT B3: PR2 writes
-- nothing back to the ledger and mirrors no courier status.
