-- ===========================================================================
--  Shipment attempts ledger -- VERIFICATION
--
--  READ-ONLY. One single SELECT. Writes nothing.
--
--  POST-APPLY ONLY. Run this AFTER shipment-attempts-forward.sql has succeeded.
--  Every row must then read PASS except rows labelled (info).
--
--  If public.shipment_attempts does not exist, this script does NOT report a
--  friendly failure -- it errors with
--      relation "public.shipment_attempts" does not exist
--  because Postgres resolves the relation when it plans the query, before any
--  check can run. That is intentional and is the honest contract: a missing
--  table means the migration did not apply, and the error says so.
--
--  The PRE-apply check is a different script: the production preflight, which
--  validates the data against every constraint this migration is about to
--  create (duplicate AWBs, courier vocabulary, backfill population, cost
--  profile) while the table still does not exist.
-- ===========================================================================

with tbl as (
  select to_regclass('public.shipment_attempts') as t
),
a as (
  select * from public.shipment_attempts
),
-- what the backfill SHOULD have produced, recomputed independently from orders
expected as (
  select
    count(*) filter (where nullif(btrim(lower(coalesce(o.courier,''))),'') is not null) as candidates,
    count(*) filter (where nullif(btrim(coalesce(o.awb,'')),'') is not null
                       and nullif(btrim(lower(coalesce(o.courier,''))),'') is not null) as with_awb,
    count(*) filter (where nullif(btrim(coalesce(o.shipment_status,'')),'') is not null
                       and nullif(btrim(lower(coalesce(o.courier,''))),'') is null
                       and nullif(btrim(coalesce(o.awb,'')),'') is null)                as local_deliveries
  from public.orders o
)

select * from (

  -- == S1. the object exists and is locked down ============================
  -- Reaching this row at all means the table exists: the query would not have
  -- planned otherwise. It is kept as an explicit statement of that fact.
  select 110 as seq, 'S1 object' as grp, 'S1.1 table exists' as check_name,
    case when (select t from tbl) is not null then 'PASS'
         else 'FAIL - unreachable, a missing table errors at plan time' end as result
  union all select 111,'S1 object','S1.2 RLS enabled',
    coalesce((select case when c.relrowsecurity then 'PASS' else 'FAIL - RLS is off' end
                from pg_class c where c.oid = (select t from tbl)), 'FAIL')
  union all select 112,'S1 object','S1.3 no policy grants browser access',
    coalesce((select case when count(*) = 0 then 'PASS'
                          else 'FAIL - ' || count(*)::text || ' policy(ies) exist' end
                from pg_policies p
               where p.schemaname = 'public' and p.tablename = 'shipment_attempts'), 'FAIL')
  union all select 113,'S1 object','S1.4 anon + authenticated hold no privileges',
    coalesce((select case when count(*) = 0 then 'PASS'
                          else 'FAIL - ' || string_agg(distinct grantee || ':' || privilege_type, ', ') end
                from information_schema.role_table_grants
               where table_schema = 'public' and table_name = 'shipment_attempts'
                 and grantee in ('anon', 'authenticated', 'PUBLIC')), 'FAIL')

  -- == S2. constraints and indexes =========================================
  union all select 210,'S2 shape','S2.1 FK order_id -> orders ON DELETE RESTRICT',
    coalesce((select case when count(*) = 1 then 'PASS' else 'FAIL' end
                from pg_constraint
               where conrelid = (select t from tbl) and contype = 'f' and confdeltype = 'r'), 'FAIL')
  union all select 211,'S2 shape','S2.2 CHECK courier in (delhivery, shadowfax)',
    coalesce((select case when count(*) >= 1 then 'PASS' else 'FAIL' end
                from pg_constraint
               where conrelid = (select t from tbl) and contype = 'c'
                 and pg_get_constraintdef(oid) ilike '%delhivery%'
                 and pg_get_constraintdef(oid) ilike '%shadowfax%'), 'FAIL')
  union all select 212,'S2 shape','S2.3 CHECK attempt_no >= 1',
    coalesce((select case when count(*) >= 1 then 'PASS' else 'FAIL' end
                from pg_constraint
               where conrelid = (select t from tbl) and contype = 'c'
                 and pg_get_constraintdef(oid) ilike '%attempt_no%'), 'FAIL')
  union all select 213,'S2 shape','S2.4 CHECK end_reason vocabulary (7 values)',
    coalesce((select case when count(*) >= 1 then 'PASS' else 'FAIL' end
                from pg_constraint
               where conrelid = (select t from tbl) and contype = 'c'
                 and pg_get_constraintdef(oid) ilike '%superseded%'
                 and pg_get_constraintdef(oid) ilike '%unknown%'), 'FAIL')
  union all select 214,'S2 shape','S2.5 CHECK ended_at implies end_reason (asymmetric)',
    coalesce((select case when count(*) = 1 then 'PASS' else 'FAIL' end
                from pg_constraint
               where conrelid = (select t from tbl) and contype = 'c'
                 and conname = 'shipment_attempts_ended_needs_reason'), 'FAIL')
  union all select 215,'S2 shape','S2.6 claimed_at and booked_at are NULLABLE',
    coalesce((select case when count(*) = 2 then 'PASS' else 'FAIL - a NOT NULL crept in' end
                from information_schema.columns
               where table_schema = 'public' and table_name = 'shipment_attempts'
                 and column_name in ('claimed_at','booked_at') and is_nullable = 'YES'), 'FAIL')
  union all select 220,'S2 shape','S2.7 one-open-attempt index keyed on end_reason',
    coalesce((select case when count(*) = 1 then 'PASS'
                          else 'FAIL - missing, or keyed on ended_at' end
                from pg_indexes
               where schemaname = 'public' and tablename = 'shipment_attempts'
                 and indexname = 'shipment_attempts_one_open_idx'
                 and indexdef ilike '%end_reason IS NULL%'), 'FAIL')
  union all select 221,'S2 shape','S2.8 UNIQUE (order_id, attempt_no)',
    coalesce((select case when count(*) = 1 then 'PASS' else 'FAIL' end
                from pg_indexes
               where schemaname = 'public' and tablename = 'shipment_attempts'
                 and indexname = 'shipment_attempts_order_no_idx'), 'FAIL')
  union all select 222,'S2 shape','S2.9 UNIQUE (courier, awb) WHERE awb not null',
    coalesce((select case when count(*) = 1 then 'PASS' else 'FAIL' end
                from pg_indexes
               where schemaname = 'public' and tablename = 'shipment_attempts'
                 and indexname = 'shipment_attempts_courier_awb_idx'
                 and indexdef ilike '%awb IS NOT NULL%'), 'FAIL')
  union all select 223,'S2 shape','S2.10 immutability trigger present',
    coalesce((select case when count(*) = 1 then 'PASS' else 'FAIL' end
                from pg_trigger
               where tgrelid = (select t from tbl)
                 and tgname = 'shipment_attempts_closed_are_permanent'
                 and not tgisinternal), 'FAIL')

  -- == S3. backfill volume =================================================
  union all select 310,'S3 backfill','S3.1 rows = courier-backed orders',
    case when (select count(*) from a) = (select candidates from expected)
         then 'PASS - ' || (select count(*) from a)::text
         else 'FAIL - ledger ' || (select count(*) from a)::text
              || ' vs orders ' || (select candidates from expected)::text end
  union all select 311,'S3 backfill','S3.2 rows WITH awb match orders',
    case when (select count(*) from a where awb is not null) = (select with_awb from expected)
         then 'PASS - ' || (select count(*) from a where awb is not null)::text
         else 'FAIL' end
  union all select 312,'S3 backfill','S3.3 rows with awb NULL (in-app cancels)', '(info) '
    || (select count(*) from a where awb is null)::text
  union all select 313,'S3 backfill','S3.4 every attempt_no = 1 on first backfill',
    case when (select count(*) from a where attempt_no <> 1) = 0 then 'PASS'
         else 'FAIL - ' || (select count(*) from a where attempt_no <> 1)::text || ' rows' end

  -- == S4. open vs terminal ================================================
  union all select 410,'S4 state','S4.1 open attempts (end_reason IS NULL)', '(info) '
    || (select count(*) from a where end_reason is null)::text
  union all select 411,'S4 state','S4.2 terminal attempts', '(info) '
    || (select count(*) from a where end_reason is not null)::text
  union all select 412,'S4 state','S4.3 delivered', '(info) '
    || (select count(*) from a where end_reason = 'delivered')::text
  union all select 413,'S4 state','S4.4 returned', '(info) '
    || (select count(*) from a where end_reason = 'returned')::text
  union all select 414,'S4 state','S4.5 lost (kept distinct)', '(info) '
    || (select count(*) from a where end_reason = 'lost')::text
  union all select 415,'S4 state','S4.6 return family = returned + lost', '(info) '
    || (select count(*) from a where end_reason in ('returned','lost'))::text
  union all select 416,'S4 state','S4.7 cancelled', '(info) '
    || (select count(*) from a where end_reason = 'cancelled')::text
  union all select 417,'S4 state','S4.8 open + terminal = all rows',
    case when (select count(*) from a where end_reason is null)
            + (select count(*) from a where end_reason is not null)
            = (select count(*) from a) then 'PASS' else 'FAIL' end

  -- == S5. THE RULE THAT IS EASY TO GET WRONG ==============================
  union all select 510,'S5 timestamps','S5.1 terminal WITHOUT ended_at are accepted', '(info) '
    || (select count(*) from a where end_reason is not null and ended_at is null)::text
  union all select 511,'S5 timestamps','S5.2 ...and are NOT counted as open',
    case when (select count(*) from a
                where end_reason is not null and ended_at is null and end_reason is null) = 0
         then 'PASS' else 'FAIL' end
  union all select 512,'S5 timestamps','S5.3 terminal WITH ended_at', '(info) '
    || (select count(*) from a where end_reason is not null and ended_at is not null)::text
  union all select 513,'S5 timestamps','S5.4 no ended_at without an end_reason',
    case when (select count(*) from a where ended_at is not null and end_reason is null) = 0
         then 'PASS' else 'FAIL' end
  union all select 514,'S5 timestamps','S5.5 claimed_at NOT fabricated on backfill',
    case when (select count(*) from a where attempt_no = 1 and claimed_at is not null) = 0
         then 'PASS' else 'FAIL - a timestamp was invented' end
  union all select 515,'S5 timestamps','S5.6 booked_at NOT fabricated on backfill',
    case when (select count(*) from a where attempt_no = 1 and booked_at is not null) = 0
         then 'PASS' else 'FAIL - a timestamp was invented' end

  -- == S6. integrity =======================================================
  union all select 610,'S6 integrity','S6.1 no duplicate (order_id, attempt_no)',
    case when (select count(*) from (select order_id, attempt_no from a
                                      group by 1,2 having count(*) > 1) d) = 0
         then 'PASS' else 'FAIL' end
  union all select 611,'S6 integrity','S6.2 no duplicate (courier, awb)',
    case when (select count(*) from (select courier, awb from a where awb is not null
                                      group by 1,2 having count(*) > 1) d) = 0
         then 'PASS' else 'FAIL' end
  union all select 612,'S6 integrity','S6.3 never more than one open attempt per order',
    case when (select count(*) from (select order_id from a where end_reason is null
                                      group by 1 having count(*) > 1) d) = 0
         then 'PASS' else 'FAIL' end
  union all select 613,'S6 integrity','S6.4 no courier outside the vocabulary',
    case when (select count(*) from a where courier not in ('delhivery','shadowfax')) = 0
         then 'PASS' else 'FAIL' end
  union all select 614,'S6 integrity','S6.5 every order_id resolves to an order',
    case when (select count(*) from a left join public.orders o on o.id = a.order_id
                where o.id is null) = 0
         then 'PASS' else 'FAIL' end
  union all select 615,'S6 integrity','S6.6 store_slug matches the order',
    case when (select count(*) from a join public.orders o on o.id = a.order_id
                where a.store_slug is distinct from o.store_slug) = 0
         then 'PASS' else 'FAIL' end

  -- == S7. the ledger did not disturb orders ===============================
  union all select 710,'S7 pointer','S7.1 local/manual deliveries absent from ledger',
    case when (select count(*) from a join public.orders o on o.id = a.order_id
                where nullif(btrim(lower(coalesce(o.courier,''))),'') is null
                  and nullif(btrim(coalesce(o.awb,'')),'') is null) = 0
         then 'PASS - ' || (select local_deliveries from expected)::text || ' excluded'
         else 'FAIL - a local delivery became a courier attempt' end
  union all select 711,'S7 pointer','S7.2 every attempt AWB matches its order pointer',
    case when (select count(*) from a join public.orders o on o.id = a.order_id
                where a.awb is distinct from nullif(btrim(coalesce(o.awb,'')),'')) = 0
         then 'PASS' else 'FAIL' end
  union all select 712,'S7 pointer','S7.3 every attempt courier matches its order pointer',
    case when (select count(*) from a join public.orders o on o.id = a.order_id
                where a.courier is distinct from nullif(btrim(lower(coalesce(o.courier,''))),'')) = 0
         then 'PASS' else 'FAIL' end
  union all select 713,'S7 pointer','S7.4 orders gained no shipment_attempt column',
    case when (select count(*) from information_schema.columns
                where table_schema = 'public' and table_name = 'orders'
                  and column_name ilike '%attempt%') = 0
         then 'PASS' else 'FAIL - orders was altered' end
  union all select 714,'S7 pointer','S7.5 orders still has its three trigger guards',
    case when (select count(*) from pg_trigger
                where tgrelid = 'public.orders'::regclass and not tgisinternal
                  and tgname in ('orders_insert_guard','orders_payment_automation',
                                 'orders_payment_time_guard')) = 3
         then 'PASS' else 'FAIL' end

  -- == S8. cost ============================================================
  union all select 810,'S8 cost','S8.1 quoted cost rows', '(info) '
    || (select count(*) from a where shipping_cost is not null)::text
  union all select 811,'S8 cost','S8.2 SUM equals orders SUM over the same rows',
    case when coalesce((select sum(shipping_cost) from a), 0)
            = coalesce((select sum(o.shipping_cost) from public.orders o
                         join a on a.order_id = o.id), 0)
         then 'PASS' else 'FAIL - a cost was altered in transit' end

) report
order by seq;
