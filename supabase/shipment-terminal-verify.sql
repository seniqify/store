-- ===========================================================================
--  Terminal shipment transitions -- VERIFICATION
--
--  READ-ONLY. One single SELECT. Writes nothing. Neither transition RPC is
--  invoked: every check reads catalogue metadata or counts existing rows. No
--  shipment is cancelled, superseded or booked by running this.
--
--  POST-APPLY ONLY. Run this AFTER shipment-terminal-forward.sql has
--  succeeded. Every row must then read PASS except rows labelled (info).
--
--  WHAT THIS CANNOT PROVE. That the RPCs refuse a delivered shipment, or close
--  an attempt atomically with the pointer, is runtime behaviour and is not
--  visible in the catalogue. Those are executed in
--  tests/shipment-terminal-rpcs.test.mjs. What is verified here is that the
--  machinery exists, is locked down, and that B1 and B2A are untouched.
--
--  NOTE ON B2A's VERIFY. shipment-claim-verify.sql row S7.5 asserts that
--  exactly FOUR functions mention shipment_attempts. After this migration the
--  correct number is SIX. That row is version-pinned to B2A and will read FAIL
--  once this is applied; row S6.4 below is its replacement.
-- ===========================================================================

with fns as (
  select p.oid,
         p.proname,
         p.prosecdef                               as is_definer,
         p.proconfig                               as cfg,
         p.proacl                                  as acl,
         pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('cancel_current_shipment', 'supersede_shipment_attempt')
),
b2a as (
  select p.oid, p.proname, p.prosecdef as is_definer, p.proconfig as cfg, p.proacl as acl
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('claim_shipment_attempt',
                       'finalize_shipment_attempt',
                       'fail_shipment_attempt')
),
sa as (
  select c.relrowsecurity
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'shipment_attempts'
)

select * from (

  -- == S1. the two functions exist, once each ===============================
  select 110 as seq, 'S1 exists' as grp,
         'S1.1 cancel_current_shipment exists exactly once' as check_name,
    case when (select count(*) from fns where proname = 'cancel_current_shipment') = 1
         then 'PASS' else 'FAIL - missing or overloaded' end as result
  union all select 111,'S1 exists','S1.2 supersede_shipment_attempt exists exactly once',
    case when (select count(*) from fns where proname = 'supersede_shipment_attempt') = 1
         then 'PASS' else 'FAIL - missing or overloaded' end
  union all select 112,'S1 exists','S1.3 exactly two new functions',
    case when (select count(*) from fns) = 2 then 'PASS' else 'FAIL' end
  union all select 113,'S1 exists','S1.4 cancel signature',
    '(info) ' || coalesce((select args from fns where proname = 'cancel_current_shipment'), 'absent')
  union all select 114,'S1 exists','S1.5 supersede signature',
    '(info) ' || coalesce((select args from fns where proname = 'supersede_shipment_attempt'), 'absent')

  -- == S2. security properties ==============================================
  union all select 210,'S2 security','S2.1 both are SECURITY DEFINER',
    case when (select count(*) from fns where is_definer) = 2
         then 'PASS' else 'FAIL - a function runs as its caller' end
  union all select 211,'S2 security','S2.2 both pin search_path',
    case when (select count(*) from fns
                where cfg is not null
                  and exists (select 1 from unnest(cfg) c where c like 'search_path=%')) = 2
         then 'PASS' else 'FAIL - an unpinned definer function is hijackable' end
  union all select 212,'S2 security','S2.3 search_path is exactly public, pg_temp',
    case when (select count(*) from fns where cfg @> array['search_path=public, pg_temp']) = 2
         then 'PASS' else 'FAIL' end

  -- == S3. grants -- service_role only ======================================
  union all select 310,'S3 grants','S3.1 anon cannot execute either',
    case when (select count(*) from fns
                where has_function_privilege('anon', oid, 'EXECUTE')) = 0
         then 'PASS' else 'FAIL - the browser role can terminate shipments' end
  union all select 311,'S3 grants','S3.2 authenticated cannot execute either',
    case when (select count(*) from fns
                where has_function_privilege('authenticated', oid, 'EXECUTE')) = 0
         then 'PASS' else 'FAIL - the browser role can terminate shipments' end
  union all select 312,'S3 grants','S3.3 PUBLIC cannot execute either',
    case when (select count(*) from fns
                where acl is null
                   or exists (select 1 from aclexplode(acl) a
                               where a.grantee = 0 and a.privilege_type = 'EXECUTE')) = 0
         then 'PASS' else 'FAIL - default PUBLIC execute was not revoked' end
  union all select 313,'S3 grants','S3.4 service_role CAN execute both',
    case when (select count(*) from fns
                where has_function_privilege('service_role', oid, 'EXECUTE')) = 2
         then 'PASS' else 'FAIL - the edge function will not be able to call these' end

  -- == S4. B2A is untouched =================================================
  union all select 410,'S4 B2A intact','S4.1 all three B2A RPCs still present',
    case when (select count(*) from b2a) = 3 then 'PASS' else 'FAIL' end
  union all select 411,'S4 B2A intact','S4.2 all three still SECURITY DEFINER',
    case when (select count(*) from b2a where is_definer) = 3 then 'PASS' else 'FAIL' end
  union all select 412,'S4 B2A intact','S4.3 all three still pin search_path',
    case when (select count(*) from b2a
                where cfg @> array['search_path=public, pg_temp']) = 3
         then 'PASS' else 'FAIL' end
  union all select 413,'S4 B2A intact','S4.4 browser roles still cannot execute them',
    case when (select count(*) from b2a
                where has_function_privilege('anon', oid, 'EXECUTE')
                   or has_function_privilege('authenticated', oid, 'EXECUTE')) = 0
         then 'PASS' else 'FAIL' end
  union all select 414,'S4 B2A intact','S4.5 service_role can still execute them',
    case when (select count(*) from b2a
                where has_function_privilege('service_role', oid, 'EXECUTE')) = 3
         then 'PASS' else 'FAIL' end

  -- == S5. B1 is untouched ==================================================
  union all select 510,'S5 B1 intact','S5.1 shipment_attempts RLS still enabled',
    case when (select relrowsecurity from sa) then 'PASS' else 'FAIL' end
  union all select 511,'S5 B1 intact','S5.2 still no RLS policy of any kind',
    case when (select count(*) from pg_policies
                where schemaname = 'public' and tablename = 'shipment_attempts') = 0
         then 'PASS' else 'FAIL - a policy was added' end
  union all select 512,'S5 B1 intact','S5.3 anon has no table privilege',
    case when (select count(*) from information_schema.role_table_grants
                where table_schema = 'public' and table_name = 'shipment_attempts'
                  and grantee = 'anon') = 0
         then 'PASS' else 'FAIL - browser direct write' end
  union all select 513,'S5 B1 intact','S5.4 authenticated has no table privilege',
    case when (select count(*) from information_schema.role_table_grants
                where table_schema = 'public' and table_name = 'shipment_attempts'
                  and grantee = 'authenticated') = 0
         then 'PASS' else 'FAIL - browser direct write' end
  union all select 514,'S5 B1 intact','S5.5 column set unchanged (12 columns)',
    case when (select count(*) from information_schema.columns
                where table_schema = 'public' and table_name = 'shipment_attempts') = 12
         then 'PASS' else 'FAIL - the ledger schema was altered' end
  union all select 515,'S5 B1 intact','S5.6 all four B1 indexes plus the primary key',
    case when (select count(*) from pg_indexes
                where schemaname = 'public' and tablename = 'shipment_attempts') = 5
         then 'PASS' else 'FAIL - an index was added or dropped' end
  union all select 516,'S5 B1 intact','S5.7 one-open-attempt index still UNIQUE on end_reason is null',
    case when (select indexdef from pg_indexes
                where schemaname = 'public'
                  and indexname = 'shipment_attempts_one_open_idx')
              ilike '%unique%(order_id)%end_reason is null%'
         then 'PASS' else 'FAIL - the concurrency primitive changed' end
  union all select 517,'S5 B1 intact','S5.8 (courier, awb) unique index still present',
    case when (select count(*) from pg_indexes
                where schemaname = 'public'
                  and indexname = 'shipment_attempts_courier_awb_idx') = 1
         then 'PASS' else 'FAIL - supersede loses its duplicate-AWB backstop' end
  union all select 518,'S5 B1 intact','S5.9 immutability trigger still attached and still alone',
    case when (select count(*) from pg_trigger
                where tgrelid = 'public.shipment_attempts'::regclass
                  and not tgisinternal) = 1
         and  (select count(*) from pg_trigger
                where tgrelid = 'public.shipment_attempts'::regclass
                  and tgname = 'shipment_attempts_closed_are_permanent') = 1
         then 'PASS' else 'FAIL' end
  union all select 519,'S5 B1 intact','S5.10 trigger function body unchanged',
    case when (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'public' and p.proname = 'shipment_attempt_is_final'
                  and p.prosrc ilike '%cannot be un-happened%'
                  and p.prosrc ilike '%OLD.end_reason is not null%') = 1
         then 'PASS' else 'FAIL' end

  -- == S6. installing PR1 changed no data ===================================
  -- This migration creates two functions and nothing else. These are the B2A
  -- post-apply figures, re-read, plus the diagnostic's alignment counts.
  union all select 610,'S6 data','S6.1 total attempts (B2A baseline 173)',
    '(info) ' || (select count(*) from public.shipment_attempts)::text
  union all select 611,'S6 data','S6.2 open attempts (B2A baseline 49)',
    '(info) ' || (select count(*) from public.shipment_attempts where end_reason is null)::text
  union all select 612,'S6 data','S6.3 terminal attempts (B2A baseline 124)',
    '(info) ' || (select count(*) from public.shipment_attempts where end_reason is not null)::text
  union all select 613,'S6 data','S6.4 exactly six functions mention shipment_attempts',
    case when (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'public' and p.prosrc ilike '%shipment_attempts%') = 6
         then 'PASS' else 'FAIL - an unexpected function references the ledger' end
  union all select 614,'S6 data','S6.5 no attempt has claimed_at (B2B is not live)',
    case when (select count(*) from public.shipment_attempts where claimed_at is not null) = 0
         then 'PASS' else '(info) B2B has begun claiming' end
  union all select 615,'S6 data','S6.6 no attempt closed as unknown -- ever',
    case when (select count(*) from public.shipment_attempts where end_reason = 'unknown') = 0
         then 'PASS' else 'FAIL - an uncertain outcome was closed, investigate' end
  union all select 616,'S6 data','S6.7 no attempt closed as superseded yet (PR1 is inert)',
    case when (select count(*) from public.shipment_attempts where end_reason = 'superseded') = 0
         then 'PASS' else '(info) supersede_shipment_attempt has been called' end
  union all select 617,'S6 data','S6.8 terminal breakdown',
    '(info) ' || coalesce((select string_agg(end_reason || '=' || n::text, ', ' order by end_reason)
       from (select end_reason, count(*) n from public.shipment_attempts
              where end_reason is not null group by end_reason) t), 'none')

  -- == S7. the population the cancel guard protects =========================
  -- The diagnostic that shaped this design, re-run as a standing check.
  union all select 710,'S7 guard population','S7.1 orders carrying an AWB',
    '(info) ' || (select count(*) from public.orders
                   where nullif(btrim(coalesce(awb, '')), '') is not null)::text
  union all select 711,'S7 guard population','S7.2 of those, with an OPEN attempt',
    '(info) ' || (select count(*) from public.orders o
                   join public.shipment_attempts a on a.order_id = o.id
                  where nullif(btrim(coalesce(o.awb, '')), '') is not null
                    and a.end_reason is null)::text
  union all select 712,'S7 guard population','S7.3 of those, TERMINAL (cancel must refuse these)',
    '(info) ' || (select count(*) from public.orders o
                   join public.shipment_attempts a on a.order_id = o.id
                  where nullif(btrim(coalesce(o.awb, '')), '') is not null
                    and a.end_reason in ('delivered', 'returned', 'lost'))::text
  union all select 713,'S7 guard population','S7.4 every AWB-bearing order still has a ledger row',
    case when (select count(*) from public.orders o
                where nullif(btrim(coalesce(o.awb, '')), '') is not null
                  and not exists (select 1 from public.shipment_attempts a
                                   where a.order_id = o.id)) = 0
         then 'PASS' else '(info) an AWB-bearing order has no attempt' end
  union all select 714,'S7 guard population','S7.5 open attempts whose order has no AWB (lockout shape)',
    case when (select count(*) from public.shipment_attempts a
                join public.orders o on o.id = a.order_id
               where a.end_reason is null
                 and nullif(btrim(coalesce(o.awb, '')), '') is null) = 0
         then 'PASS' else '(info) a stranded open attempt exists -- PR2 recovers these' end

  -- == S8. nothing else moved ===============================================
  union all select 810,'S8 blast radius','S8.1 orders still has its three trigger guards',
    case when (select count(*) from pg_trigger
                where tgrelid = 'public.orders'::regclass and not tgisinternal
                  and tgname in ('orders_insert_guard','orders_payment_automation',
                                 'orders_payment_time_guard')) = 3
         then 'PASS' else 'FAIL' end
  union all select 811,'S8 blast radius','S8.2 orders gained no shipment_attempt column',
    case when (select count(*) from information_schema.columns
                where table_schema = 'public' and table_name = 'orders'
                  and column_name ilike '%attempt%') = 0
         then 'PASS' else 'FAIL - orders was altered' end
  union all select 812,'S8 blast radius','S8.3 still exactly one shipment table in public',
    case when (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
                where n.nspname = 'public' and c.relkind = 'r'
                  and c.relname like 'shipment%') = 1
         then 'PASS' else 'FAIL - a shipment table was added or removed' end
  union all select 813,'S8 blast radius','S8.4 no view reads the ledger',
    case when (select count(*) from pg_depend d
                join pg_rewrite r on r.oid = d.objid
                join pg_class v on v.oid = r.ev_class
                where d.refobjid = to_regclass('public.shipment_attempts')
                  and v.relkind in ('v','m')
                  and v.relname <> 'shipment_attempts') = 0
         then 'PASS' else 'FAIL - a view was built on the ledger' end

) report
order by seq;
