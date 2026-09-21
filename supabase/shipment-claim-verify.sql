-- ===========================================================================
--  Atomic shipment booking claim -- VERIFICATION
--
--  READ-ONLY. One single SELECT. Writes nothing. Books nothing: no courier is
--  contacted, no order is claimed, no attempt row is created or changed. Every
--  check below reads catalogue metadata or counts existing rows.
--
--  POST-APPLY ONLY. Run this AFTER shipment-claim-forward.sql has succeeded.
--  Every row must then read PASS except rows labelled (info).
--
--  Before the migration, the function rows report FAIL ("missing") rather than
--  erroring -- they are catalogue lookups, so they plan fine against an empty
--  catalogue. The B1 rows would still pass, because B1 is already live. That
--  makes a pre-apply run merely useless, not dangerous; it is still not the
--  intended use.
--
--  WHAT THIS CANNOT PROVE. That two concurrent claims serialize correctly is a
--  runtime property of the lock and the partial unique index; it is not
--  visible in the catalogue. What is verified here is that the machinery that
--  produces that property exists and is unchanged: the functions, their
--  security properties, their grants, and every B1 invariant they depend on.
-- ===========================================================================

with fns as (
  select p.oid,
         p.proname,
         p.prosecdef                                  as is_definer,
         p.proconfig                                  as cfg,
         p.proacl                                     as acl,
         pg_get_function_identity_arguments(p.oid)    as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('claim_shipment_attempt',
                       'finalize_shipment_attempt',
                       'fail_shipment_attempt')
),
sa as (
  select c.oid, c.relrowsecurity
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'shipment_attempts'
)

select * from (

  -- == S1. the three functions exist, once each =============================
  select 110 as seq, 'S1 exists' as grp,
         'S1.1 claim_shipment_attempt exists exactly once' as check_name,
    case when (select count(*) from fns where proname = 'claim_shipment_attempt') = 1
         then 'PASS' else 'FAIL - missing or overloaded' end as result
  union all select 111,'S1 exists','S1.2 finalize_shipment_attempt exists exactly once',
    case when (select count(*) from fns where proname = 'finalize_shipment_attempt') = 1
         then 'PASS' else 'FAIL - missing or overloaded' end
  union all select 112,'S1 exists','S1.3 fail_shipment_attempt exists exactly once',
    case when (select count(*) from fns where proname = 'fail_shipment_attempt') = 1
         then 'PASS' else 'FAIL - missing or overloaded' end
  union all select 113,'S1 exists','S1.4 exactly three functions total',
    case when (select count(*) from fns) = 3 then 'PASS' else 'FAIL' end
  union all select 114,'S1 exists','S1.5 claim signature',
    '(info) ' || coalesce((select args from fns where proname = 'claim_shipment_attempt'), 'absent')
  union all select 115,'S1 exists','S1.6 finalize signature',
    '(info) ' || coalesce((select args from fns where proname = 'finalize_shipment_attempt'), 'absent')
  union all select 116,'S1 exists','S1.7 fail signature',
    '(info) ' || coalesce((select args from fns where proname = 'fail_shipment_attempt'), 'absent')

  -- == S2. security properties ==============================================
  union all select 210,'S2 security','S2.1 all three are SECURITY DEFINER',
    case when (select count(*) from fns where is_definer) = 3
         then 'PASS' else 'FAIL - a function runs as its caller' end
  union all select 211,'S2 security','S2.2 all three pin search_path',
    case when (select count(*) from fns
                where cfg is not null
                  and exists (select 1 from unnest(cfg) c where c like 'search_path=%')) = 3
         then 'PASS' else 'FAIL - an unpinned definer function is hijackable' end
  union all select 212,'S2 security','S2.3 search_path is exactly public, pg_temp',
    case when (select count(*) from fns
                where cfg @> array['search_path=public, pg_temp']) = 3
         then 'PASS' else 'FAIL' end
  -- Context, not a gate: B2A's three are pinned (S2.2), but the schema has
  -- older definer functions that predate that convention. A rising number here
  -- is worth a look; it is not a B2A failure.
  union all select 213,'S2 security','S2.4 unpinned SECURITY DEFINER functions in public',
    '(info) ' || (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'public' and p.prosecdef and p.proconfig is null)::text

  -- == S3. grants -- service_role only ======================================
  union all select 310,'S3 grants','S3.1 anon cannot execute any of the three',
    case when (select count(*) from fns
                where has_function_privilege('anon', oid, 'EXECUTE')) = 0
         then 'PASS' else 'FAIL - the browser role can book shipments' end
  union all select 311,'S3 grants','S3.2 authenticated cannot execute any of the three',
    case when (select count(*) from fns
                where has_function_privilege('authenticated', oid, 'EXECUTE')) = 0
         then 'PASS' else 'FAIL - the browser role can book shipments' end
  union all select 312,'S3 grants','S3.3 PUBLIC cannot execute any of the three',
    case when (select count(*) from fns
                where acl is null
                   or exists (select 1 from aclexplode(acl) a
                               where a.grantee = 0 and a.privilege_type = 'EXECUTE')) = 0
         then 'PASS' else 'FAIL - default PUBLIC execute was not revoked' end
  union all select 313,'S3 grants','S3.4 service_role CAN execute all three',
    case when (select count(*) from fns
                where has_function_privilege('service_role', oid, 'EXECUTE')) = 3
         then 'PASS' else 'FAIL - the edge function will not be able to call these' end

  -- == S4. the ledger table is exactly as B1 left it ========================
  union all select 410,'S4 table','S4.1 shipment_attempts still exists',
    case when (select count(*) from sa) = 1 then 'PASS' else 'FAIL' end
  union all select 411,'S4 table','S4.2 RLS still enabled',
    case when (select relrowsecurity from sa) then 'PASS' else 'FAIL' end
  union all select 412,'S4 table','S4.3 still no RLS policy of any kind',
    case when (select count(*) from pg_policies
                where schemaname = 'public' and tablename = 'shipment_attempts') = 0
         then 'PASS' else 'FAIL - a policy was added, the table is now reachable' end
  union all select 413,'S4 table','S4.4 anon has no table privilege',
    case when (select count(*) from information_schema.role_table_grants
                where table_schema = 'public' and table_name = 'shipment_attempts'
                  and grantee = 'anon') = 0
         then 'PASS' else 'FAIL - browser direct write' end
  union all select 414,'S4 table','S4.5 authenticated has no table privilege',
    case when (select count(*) from information_schema.role_table_grants
                where table_schema = 'public' and table_name = 'shipment_attempts'
                  and grantee = 'authenticated') = 0
         then 'PASS' else 'FAIL - browser direct write' end
  union all select 415,'S4 table','S4.6 column set unchanged (12 columns)',
    case when (select count(*) from information_schema.columns
                where table_schema = 'public' and table_name = 'shipment_attempts') = 12
         then 'PASS' else 'FAIL - the ledger schema was altered' end

  -- == S5. B1 invariants the claim depends on ===============================
  union all select 510,'S5 B1 invariants','S5.1 one-open-attempt unique index present',
    case when (select count(*) from pg_indexes
                where schemaname = 'public'
                  and indexname = 'shipment_attempts_one_open_idx') = 1
         then 'PASS' else 'FAIL - the concurrency primitive is gone' end
  union all select 511,'S5 B1 invariants','S5.2 it is UNIQUE and keyed on end_reason is null',
    case when (select indexdef from pg_indexes
                where schemaname = 'public'
                  and indexname = 'shipment_attempts_one_open_idx')
              ilike '%unique%(order_id)%end_reason is null%'
         then 'PASS' else 'FAIL - re-check the predicate' end
  union all select 512,'S5 B1 invariants','S5.3 (order_id, attempt_no) unique index present',
    case when (select count(*) from pg_indexes
                where schemaname = 'public'
                  and indexname = 'shipment_attempts_order_no_idx') = 1
         then 'PASS' else 'FAIL' end
  union all select 513,'S5 B1 invariants','S5.4 (courier, awb) unique index present',
    case when (select count(*) from pg_indexes
                where schemaname = 'public'
                  and indexname = 'shipment_attempts_courier_awb_idx') = 1
         then 'PASS' else 'FAIL' end
  union all select 514,'S5 B1 invariants','S5.5 all four B1 indexes plus the primary key',
    case when (select count(*) from pg_indexes
                where schemaname = 'public' and tablename = 'shipment_attempts') = 5
         then 'PASS' else 'FAIL - an index was added or dropped' end
  union all select 515,'S5 B1 invariants','S5.6 immutability trigger still attached',
    case when (select count(*) from pg_trigger
                where tgrelid = 'public.shipment_attempts'::regclass
                  and not tgisinternal
                  and tgname = 'shipment_attempts_closed_are_permanent') = 1
         then 'PASS' else 'FAIL - closed attempts are editable again' end
  union all select 516,'S5 B1 invariants','S5.7 it is the ONLY trigger on the ledger',
    case when (select count(*) from pg_trigger
                where tgrelid = 'public.shipment_attempts'::regclass
                  and not tgisinternal) = 1
         then 'PASS' else 'FAIL - a trigger was added' end
  union all select 517,'S5 B1 invariants','S5.8 trigger function body unchanged',
    case when (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'public' and p.proname = 'shipment_attempt_is_final'
                  and p.prosrc ilike '%cannot be un-happened%'
                  and p.prosrc ilike '%OLD.end_reason is not null%') = 1
         then 'PASS' else 'FAIL' end
  union all select 518,'S5 B1 invariants','S5.9 terminal-needs-reason check constraint present',
    case when (select count(*) from pg_constraint
                where conrelid = 'public.shipment_attempts'::regclass
                  and conname = 'shipment_attempts_ended_needs_reason') = 1
         then 'PASS' else 'FAIL' end

  -- == S6. the migration wrote no data ======================================
  -- B2A adds functions. It must not have created, closed or altered a single
  -- attempt. These are the B1 post-apply counts, re-read.
  union all select 610,'S6 data','S6.1 total attempts',
    '(info) ' || (select count(*) from public.shipment_attempts)::text
  union all select 611,'S6 data','S6.2 open attempts (end_reason is null)',
    '(info) ' || (select count(*) from public.shipment_attempts where end_reason is null)::text
  union all select 612,'S6 data','S6.3 terminal attempts',
    '(info) ' || (select count(*) from public.shipment_attempts where end_reason is not null)::text
  union all select 613,'S6 data','S6.4 no attempt has claimed_at (B2A created no claims)',
    case when (select count(*) from public.shipment_attempts where claimed_at is not null) = 0
         then 'PASS' else 'FAIL - something claimed, so B2B may already be live' end
  union all select 614,'S6 data','S6.5 no attempt closed as failed yet',
    case when (select count(*) from public.shipment_attempts where end_reason = 'failed') = 0
         then 'PASS' else 'FAIL - fail_shipment_attempt has been called' end
  union all select 615,'S6 data','S6.6 no attempt closed as unknown -- ever',
    case when (select count(*) from public.shipment_attempts where end_reason = 'unknown') = 0
         then 'PASS' else 'FAIL - an uncertain outcome was closed, investigate' end
  union all select 616,'S6 data','S6.7 every open attempt still has an AWB',
    case when (select count(*) from public.shipment_attempts
                where end_reason is null and awb is null) = 0
         then 'PASS' else '(info) an AWB-less claim exists -- expected only once B2B is live' end

  -- == S7. nothing else moved ===============================================
  union all select 710,'S7 blast radius','S7.1 orders still has its three trigger guards',
    case when (select count(*) from pg_trigger
                where tgrelid = 'public.orders'::regclass and not tgisinternal
                  and tgname in ('orders_insert_guard','orders_payment_automation',
                                 'orders_payment_time_guard')) = 3
         then 'PASS' else 'FAIL' end
  union all select 711,'S7 blast radius','S7.2 orders gained no shipment_attempt column',
    case when (select count(*) from information_schema.columns
                where table_schema = 'public' and table_name = 'orders'
                  and column_name ilike '%attempt%') = 0
         then 'PASS' else 'FAIL - orders was altered' end
  union all select 712,'S7 blast radius','S7.3 no new table appeared in public',
    case when (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
                where n.nspname = 'public' and c.relkind = 'r'
                  and c.relname like 'shipment%') = 1
         then 'PASS' else 'FAIL - a shipment table was added or removed' end
  union all select 713,'S7 blast radius','S7.4 no view reads the ledger yet',
    case when (select count(*) from pg_depend d
                join pg_rewrite r on r.oid = d.objid
                join pg_class v on v.oid = r.ev_class
                where d.refobjid = to_regclass('public.shipment_attempts')
                  and v.relkind in ('v','m')
                  and v.relname <> 'shipment_attempts') = 0
         then 'PASS' else 'FAIL - a view was built on the ledger' end
  union all select 714,'S7 blast radius','S7.5 exactly four functions mention shipment_attempts',
    case when (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'public' and p.prosrc ilike '%shipment_attempts%') = 4
         then 'PASS' else 'FAIL - an unexpected function references the ledger' end

) report
order by seq;
