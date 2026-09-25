-- ===========================================================================
--  Pre-B2B ledger gap repair -- VERIFICATION
--
--  READ-ONLY. One single SELECT. Writes nothing, calls no RPC, contacts no
--  courier. Aggregates only: no customer data, AWBs, order ids or store names
--  are printed.
--
--  POST-APPLY ONLY. Run this AFTER shipment-attempts-gap-repair.sql. Every row
--  must then read PASS except rows labelled (info).
--
--  R1 CAN LEGITIMATELY SHOW A SMALL NUMBER. Until B2B ships, every new booking
--  is a fresh gap. A few seconds between the repair and this check is enough
--  for one to appear. Re-running the repair is safe; then run this again.
--
--  BEFORE-THE-REPAIR FIGURES quoted in labels come from the read-only
--  diagnostic of 2026-09-25: 173 ledger rows (49 open, 124 terminal), 212
--  orders carrying an AWB, 41 of them with no ledger row. The repair's own
--  output table reports its exact before / written / after counts.
-- ===========================================================================

with fns as (
  select p.oid,
         p.proname,
         p.prosecdef as is_definer,
         p.proconfig as cfg,
         p.proacl    as acl
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('claim_shipment_attempt', 'finalize_shipment_attempt',
                       'fail_shipment_attempt', 'cancel_current_shipment',
                       'supersede_shipment_attempt')
),
sa as (
  select c.relrowsecurity
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'shipment_attempts'
),
-- The derivation B1 and the repair both use, applied to each order as it reads
-- now. Only used for the (info) freshness row.
derived as (
  select o.id,
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
         end as reason
    from public.orders o
)

select * from (

  -- == R. the gap is closed, and only the proven shape was written ==========
  select 110 as seq, 'R repair' as grp,
         'R1 orders with an AWB and a delhivery/shadowfax courier but no ledger row' as check_name,
    case when (select count(*) from public.orders o
                where nullif(btrim(coalesce(o.awb, '')), '') is not null
                  and lower(btrim(coalesce(o.courier, ''))) in ('delhivery', 'shadowfax')
                  and not exists (select 1 from public.shipment_attempts a
                                   where a.order_id = o.id)) = 0
         then 'PASS'
         else '(info) ' || (select count(*) from public.orders o
                             where nullif(btrim(coalesce(o.awb, '')), '') is not null
                               and lower(btrim(coalesce(o.courier, ''))) in ('delhivery', 'shadowfax')
                               and not exists (select 1 from public.shipment_attempts a
                                                where a.order_id = o.id))::text
              || ' -- if the repair has run, these were booked after it: re-run it (safe), then this' end as result
  union all select 111,'R repair','R2 orders with an AWB and any OTHER courier, no ledger row (never repaired)',
    case when (select count(*) from public.orders o
                where nullif(btrim(coalesce(o.awb, '')), '') is not null
                  and lower(btrim(coalesce(o.courier, ''))) not in ('delhivery', 'shadowfax')
                  and not exists (select 1 from public.shipment_attempts a
                                   where a.order_id = o.id)) = 0
         then 'PASS'
         else 'FAIL - ' || (select count(*) from public.orders o
                             where nullif(btrim(coalesce(o.awb, '')), '') is not null
                               and lower(btrim(coalesce(o.courier, ''))) not in ('delhivery', 'shadowfax')
                               and not exists (select 1 from public.shipment_attempts a
                                                where a.order_id = o.id))::text
              || ' order(s), investigate before PR2' end
  union all select 112,'R repair','R3 orders with a courier but NO AWB and no ledger row (left untouched by design, was 1)',
    '(info) ' || (select count(*) from public.orders o
                   where nullif(btrim(coalesce(o.awb, '')), '') is null
                     and nullif(btrim(coalesce(o.courier, '')), '') is not null
                     and not exists (select 1 from public.shipment_attempts a
                                      where a.order_id = o.id))::text
  -- The repair copies the order's AWB and only writes orders that have one, so
  -- it can never produce an AWB-less row. The only AWB-less rows that may
  -- exist are B1's two historical in-app cancellations (terminal 'cancelled',
  -- no end time) and, once B2B is live, claims (which carry claimed_at).
  union all select 113,'R repair','R4 every AWB-less ledger row is one of B1''s historical cancellations or a claim',
    case when (select count(*) from public.shipment_attempts a
                where a.awb is null
                  and a.claimed_at is null
                  and not (a.end_reason = 'cancelled' and a.ended_at is null)) = 0
         then 'PASS'
         else 'FAIL - an AWB-less row was written by something other than B1' end
  union all select 114,'R repair','R5 AWB-less ledger rows (B1 wrote 2)',
    '(info) ' || (select count(*) from public.shipment_attempts where awb is null)::text
  union all select 115,'R repair','R6 every OPEN attempt holding an AWB matches its order''s AWB',
    case when (select count(*) from public.shipment_attempts a
                join public.orders o on o.id = a.order_id
               where a.end_reason is null
                 and a.awb is not null
                 and nullif(btrim(coalesce(o.awb, '')), '') is not null
                 and nullif(btrim(coalesce(o.awb, '')), '') <> a.awb) = 0
         then 'PASS' else 'FAIL - an open attempt and its order disagree about the AWB' end
  union all select 116,'R repair','R7 OPEN attempts whose order no longer has an AWB (stranded by an in-app cancel)',
    case when (select count(*) from public.shipment_attempts a
                join public.orders o on o.id = a.order_id
               where a.end_reason is null
                 and nullif(btrim(coalesce(o.awb, '')), '') is null) = 0
         then 'PASS'
         else '(info) ' || (select count(*) from public.shipment_attempts a
                             join public.orders o on o.id = a.order_id
                            where a.end_reason is null
                              and nullif(btrim(coalesce(o.awb, '')), '') is null)::text
              || ' -- each blocks a future booking, close with cancel_current_shipment before B2B' end

  -- == I. ledger invariants ==================================================
  union all select 210,'I invariants','I1 no two rows share (order_id, attempt_no)',
    case when (select count(*) from (select order_id, attempt_no from public.shipment_attempts
                                      group by order_id, attempt_no having count(*) > 1) d) = 0
         then 'PASS' else 'FAIL' end
  union all select 211,'I invariants','I2 no two rows share (courier, awb)',
    case when (select count(*) from (select courier, awb from public.shipment_attempts
                                      where awb is not null
                                      group by courier, awb having count(*) > 1) d) = 0
         then 'PASS' else 'FAIL' end
  union all select 212,'I invariants','I3 at most one OPEN attempt per order',
    case when (select count(*) from (select order_id from public.shipment_attempts
                                      where end_reason is null
                                      group by order_id having count(*) > 1) d) = 0
         then 'PASS' else 'FAIL' end
  union all select 213,'I invariants','I4 every recorded end time has a reason',
    case when (select count(*) from public.shipment_attempts
                where ended_at is not null and end_reason is null) = 0
         then 'PASS' else 'FAIL' end
  union all select 214,'I invariants','I5 every attempt is attempt 1 (no order has been re-booked yet)',
    case when (select count(*) from public.shipment_attempts where attempt_no <> 1) = 0
         then 'PASS' else '(info) an order has a second attempt -- B2B rebooking has begun' end
  union all select 215,'I invariants','I6 no attempt closed as unknown -- ever',
    case when (select count(*) from public.shipment_attempts where end_reason = 'unknown') = 0
         then 'PASS' else 'FAIL - an uncertain outcome was closed, investigate' end
  union all select 216,'I invariants','I7 no attempt has claimed_at (B2B is not live)',
    case when (select count(*) from public.shipment_attempts where claimed_at is not null) = 0
         then 'PASS' else '(info) B2B has begun claiming' end

  -- == C. counts =============================================================
  union all select 310,'C counts','C1 ledger rows now (173 before the repair)',
    '(info) ' || (select count(*) from public.shipment_attempts)::text
  union all select 311,'C counts','C2 open now (49 before)',
    '(info) ' || (select count(*) from public.shipment_attempts where end_reason is null)::text
  union all select 312,'C counts','C3 terminal now (124 before)',
    '(info) ' || (select count(*) from public.shipment_attempts where end_reason is not null)::text
    || '  [' || coalesce((select string_agg(end_reason || '=' || n, ', ' order by end_reason)
                            from (select end_reason, count(*) n from public.shipment_attempts
                                   where end_reason is not null group by end_reason) t), 'none') || ']'
  union all select 313,'C counts','C4 orders carrying an AWB now (212 before)',
    '(info) ' || (select count(*) from public.orders
                   where nullif(btrim(coalesce(awb, '')), '') is not null)::text
  union all select 314,'C counts','C5 of those, with a ledger row (171 before)',
    '(info) ' || (select count(*) from public.orders o
                   where nullif(btrim(coalesce(o.awb, '')), '') is not null
                     and exists (select 1 from public.shipment_attempts a
                                  where a.order_id = o.id))::text
  union all select 315,'C counts','C6 OPEN attempts whose order already reads delivered / returned / lost (stale: B3 is not live)',
    '(info) ' || (select count(*) from public.shipment_attempts a
                   join derived d on d.id = a.order_id
                  where a.end_reason is null
                    and d.reason in ('delivered', 'returned', 'lost'))::text
    || ' of ' || (select count(*) from public.shipment_attempts where end_reason is null)::text
    || ' -- why PR2 must gate on the order, not only the ledger'

  -- == S. B1, B2A and B2A.1 unchanged ========================================
  union all select 410,'S security','S1 all five ledger RPCs exist exactly once',
    case when (select count(*) from fns) = 5
          and (select count(distinct proname) from fns) = 5
         then 'PASS' else 'FAIL - missing or overloaded' end
  union all select 411,'S security','S2 all five are SECURITY DEFINER',
    case when (select count(*) from fns where is_definer) = 5 then 'PASS' else 'FAIL' end
  union all select 412,'S security','S3 all five pin search_path to exactly public, pg_temp',
    case when (select count(*) from fns where cfg @> array['search_path=public, pg_temp']) = 5
         then 'PASS' else 'FAIL' end
  union all select 413,'S security','S4 PUBLIC cannot execute any of them',
    case when (select count(*) from fns
                where acl is null
                   or exists (select 1 from aclexplode(acl) x
                               where x.grantee = 0 and x.privilege_type = 'EXECUTE')) = 0
         then 'PASS' else 'FAIL' end
  union all select 414,'S security','S5 anon cannot execute any of them',
    case when (select count(*) from fns where has_function_privilege('anon', oid, 'EXECUTE')) = 0
         then 'PASS' else 'FAIL - the browser role can reach the ledger RPCs' end
  union all select 415,'S security','S6 authenticated cannot execute any of them',
    case when (select count(*) from fns where has_function_privilege('authenticated', oid, 'EXECUTE')) = 0
         then 'PASS' else 'FAIL - the browser role can reach the ledger RPCs' end
  union all select 416,'S security','S7 service_role can execute all five',
    case when (select count(*) from fns where has_function_privilege('service_role', oid, 'EXECUTE')) = 5
         then 'PASS' else 'FAIL' end
  union all select 417,'S security','S8 shipment_attempts RLS still enabled',
    case when (select relrowsecurity from sa) then 'PASS' else 'FAIL' end
  union all select 418,'S security','S9 still no RLS policy of any kind',
    case when (select count(*) from pg_policies
                where schemaname = 'public' and tablename = 'shipment_attempts') = 0
         then 'PASS' else 'FAIL - a policy was added' end
  union all select 419,'S security','S10 browser roles have no table privilege',
    case when (select count(*) from information_schema.role_table_grants
                where table_schema = 'public' and table_name = 'shipment_attempts'
                  and grantee in ('anon', 'authenticated')) = 0
         then 'PASS' else 'FAIL - browser direct write' end
  union all select 420,'S security','S11 column set unchanged (12 columns)',
    case when (select count(*) from information_schema.columns
                where table_schema = 'public' and table_name = 'shipment_attempts') = 12
         then 'PASS' else 'FAIL - the ledger schema was altered' end
  union all select 421,'S security','S12 all four B1 indexes plus the primary key',
    case when (select count(*) from pg_indexes
                where schemaname = 'public' and tablename = 'shipment_attempts') = 5
         then 'PASS' else 'FAIL - an index was added or dropped' end
  union all select 422,'S security','S13 one-open-attempt index still UNIQUE on end_reason is null',
    case when (select indexdef from pg_indexes
                where schemaname = 'public'
                  and indexname = 'shipment_attempts_one_open_idx')
              ilike '%unique%(order_id)%end_reason is null%'
         then 'PASS' else 'FAIL - the concurrency primitive changed' end
  union all select 423,'S security','S14 immutability trigger still attached and still alone',
    case when (select count(*) from pg_trigger
                where tgrelid = 'public.shipment_attempts'::regclass and not tgisinternal) = 1
          and (select count(*) from pg_trigger
                where tgrelid = 'public.shipment_attempts'::regclass
                  and tgname = 'shipment_attempts_closed_are_permanent') = 1
         then 'PASS' else 'FAIL' end
  union all select 424,'S security','S15 trigger function body unchanged',
    case when (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'public' and p.proname = 'shipment_attempt_is_final'
                  and p.prosrc ilike '%cannot be un-happened%'
                  and p.prosrc ilike '%OLD.end_reason is not null%') = 1
         then 'PASS' else 'FAIL' end
  union all select 425,'S security','S16 exactly six functions mention shipment_attempts (the repair added none)',
    case when (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'public' and p.prosrc ilike '%shipment_attempts%') = 6
         then 'PASS' else 'FAIL - an unexpected function references the ledger' end
  union all select 426,'S security','S17 orders still has its three trigger guards',
    case when (select count(*) from pg_trigger
                where tgrelid = 'public.orders'::regclass and not tgisinternal
                  and tgname in ('orders_insert_guard', 'orders_payment_automation',
                                 'orders_payment_time_guard')) = 3
         then 'PASS' else 'FAIL' end
  union all select 427,'S security','S18 no view reads the ledger',
    case when (select count(*) from pg_depend d
                join pg_rewrite r on r.oid = d.objid
                join pg_class v on v.oid = r.ev_class
                where d.refobjid = to_regclass('public.shipment_attempts')
                  and v.relkind in ('v', 'm')
                  and v.relname <> 'shipment_attempts') = 0
         then 'PASS' else 'FAIL - a view was built on the ledger' end

) report
order by seq;
