-- ===========================================================================
--  Phase 3C, PR 2  --  VERIFICATION
--
--  READ-ONLY. One single SELECT. No create, insert, update, delete, grant,
--  revoke, drop, alter, set role or temporary table. No transaction.
--  Safe on production before AND after applying the migration.
--
--  Anything the migration creates is reached through to_regprocedure and
--  to_regclass -- never named where PostgreSQL would resolve it while parsing --
--  so this runs in both states.
--
--  BEFORE: W* rows read 'N/A - writer not installed'; everything else PASS.
--  AFTER:  every row PASS except the rows labelled (info).
--
--  THE G ROWS ARE THE POINT OF THIS FILE. PR 2 builds the replacement
--  authority and removes nothing. G1 FAILS IF upgrade_store_plan STOPS BEING
--  ANON-EXECUTABLE, because closing it here -- before the browser has been
--  moved to the new path -- would break live signup. That is not a typo.
-- ===========================================================================

select 'B1' as grp, 'B1 stores plan fingerprint (MUST be identical before/after)' as check_name,
  md5(string_agg(s.slug || '|' || coalesce(s.config->>'plan', '') || '|' ||
                 coalesce(s.config->>'planExpiresAt', '') || '|' ||
                 coalesce(s.config->>'razorpaySubscriptionId', ''), ',' order by s.slug)) as result
  from public.stores s

union all
select 'G1', 'G1 upgrade_store_plan UNCHANGED and STILL anon-executable (PR 2 closes nothing)',
  case when (select md5(p.prosrc) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = 'upgrade_store_plan')
            = '9f6bbf1eafb22765dc601eb11fc2dfcb'
        and (select has_function_privilege('anon', p.oid, 'EXECUTE') from pg_proc p
               join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = 'upgrade_store_plan')
       then 'PASS - still open, deliberately, until the cutover PR'
       else 'FAIL - PR 2 must not modify or close the legacy path' end

union all
select 'G2', 'G2 pending_signups policies and grants unchanged',
  case when coalesce((select md5(string_agg(policyname || ':' || cmd || ':' || roles::text || ':' ||
                                  coalesce(qual, '-') || ':' || coalesce(with_check, '-'), ',' order by policyname))
              from pg_policies where schemaname = 'public' and tablename = 'pending_signups'), 'none')
            = '18d594bb7aacdbf5b3f96aa0f78f5b3a'
        and coalesce((select md5(string_agg(grantee || ':' || privilege_type, ',' order by grantee, privilege_type))
              from information_schema.role_table_grants
             where table_schema = 'public' and table_name = 'pending_signups'
               and grantee in ('anon', 'authenticated')), 'none')
            = '954f5b772f585c883b1e82b7dbf672a7'
       then 'PASS - untouched' else 'FAIL - PR 2 must not touch pending_signups' end

union all
select 'G3', 'G3 phase 1 and phase 2 protections intact',
  case when exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
                     where c.relname = 'orders' and t.tgname = 'orders_insert_guard' and t.tgenabled = 'O')
        and exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
                     where c.relname = 'orders' and t.tgname = 'trg_decrement_stock' and t.tgenabled = 'O')
        and exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                     where n.nspname = 'public' and p.proname = 'create_order_secure' and not p.prosecdef)
       then 'PASS' else 'FAIL - an earlier phase was disturbed' end

union all
select 'G4', 'G4 update_store_config and console_update_store unchanged',
  case when (select md5(p.prosrc) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = 'update_store_config') = 'c3c6da5207a9561e79f7692383ffab1d'
        and (select md5(p.prosrc) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = 'console_update_store') = '9d85170522f1c347d49bb2f0dd65016a'
       then 'PASS' else 'FAIL - an existing plan writer changed' end

-- -- L  the PR 1 ledger is not disturbed -----------------------------------
union all
select 'L1', 'L1 the 36 imported rows are still 36, still imported, still unverified',
  case when (select count(*) from public.plan_entitlements where source = 'migration_backfill') = 36
        and (select count(*) from public.plan_entitlements
              where source = 'migration_backfill' and verified_at is not null) = 0
       then 'PASS' else 'FAIL - the backfill was altered' end

union all
select 'L2', 'L2 every store still has exactly one imported row',
  case when (select count(*) from public.stores) =
            (select count(distinct store_slug) from public.plan_entitlements
              where source = 'migration_backfill')
        and not exists (select 1 from (
              select store_slug from public.plan_entitlements where source = 'migration_backfill'
               group by store_slug having count(*) > 1) d)
       then 'PASS' else 'FAIL - backfill coverage moved' end

union all
select 'L3', 'L3 the ledger is still closed to the browser',
  case when not exists (select 1 from information_schema.role_table_grants
                         where table_schema = 'public' and table_name = 'plan_entitlements'
                           and grantee in ('anon', 'authenticated', 'PUBLIC'))
        and (select count(*) from pg_policies
              where schemaname = 'public' and tablename = 'plan_entitlements') = 0
        and (select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
              where n.nspname = 'public' and c.relname = 'plan_entitlements')
       then 'PASS' else 'FAIL - the authority boundary moved' end

union all
select 'L4', 'L4 razorpay_subscription_id is still NOT unique (renewals reuse it)',
  case when not exists (select 1 from pg_index i
                         where i.indrelid = to_regclass('public.plan_entitlements')
                           and i.indisunique
                           and pg_get_indexdef(i.indexrelid) ilike '%razorpay_subscription_id%')
       then 'PASS - uniqueness stays on idempotency_key' else 'FAIL' end

-- -- C  the two evidence columns --------------------------------------------
union all
select 'C1', 'C1 razorpay_payment_id and razorpay_plan_id exist and are nullable',
  case when (select count(*) from pg_attribute
              where attrelid = to_regclass('public.plan_entitlements')
                and attname in ('razorpay_payment_id', 'razorpay_plan_id')
                and not attisdropped and not attnotnull) = 2
       then 'PASS'
       when (select count(*) from pg_attribute
              where attrelid = to_regclass('public.plan_entitlements')
                and attname in ('razorpay_payment_id', 'razorpay_plan_id')
                and not attisdropped) = 0
       then 'N/A - writer not installed'
       else 'FAIL - evidence columns are wrong' end

union all
select 'C2', 'C2 a razorpay_subscription grant must carry its subscription and plan evidence',
  case when exists (select 1 from pg_constraint
                     where conrelid = to_regclass('public.plan_entitlements')
                       and conname = 'plan_entitlements_subscription_evidence')
       then 'PASS' else 'N/A - writer not installed' end

union all
select 'C3', 'C3 the PR 1 honesty constraints are still in force',
  case when (select count(*) from pg_constraint
              where conrelid = to_regclass('public.plan_entitlements')
                and conname in ('plan_entitlements_imported_is_never_verified',
                                'plan_entitlements_payment_sources_are_verified',
                                'plan_entitlements_plan_known',
                                'plan_entitlements_source_known',
                                'plan_entitlements_status_known',
                                'plan_entitlements_window_ordered',
                                'plan_entitlements_idempotency_key_key')) = 7
       then 'PASS' else 'FAIL - a PR 1 constraint was dropped' end

-- -- W  the writer ------------------------------------------------------------
union all
select 'W1', 'W1 apply_plan_entitlement exists with the expected signature',
  case when to_regprocedure('public.apply_plan_entitlement(text,text,text,timestamptz,timestamptz,text,text,text,text,timestamptz)') is null
       then 'N/A - writer not installed' else 'PASS' end

union all
select 'W2', 'W2 it is SECURITY INVOKER, not DEFINER',
  -- INVOKER on purpose: service_role already holds every privilege the body
  -- needs, so DEFINER would only turn a leaked grant into an escalation.
  case when to_regprocedure('public.apply_plan_entitlement(text,text,text,timestamptz,timestamptz,text,text,text,text,timestamptz)') is null
       then 'N/A - writer not installed'
       when not (select p.prosecdef from pg_proc p
                  where p.oid = to_regprocedure('public.apply_plan_entitlement(text,text,text,timestamptz,timestamptz,text,text,text,text,timestamptz)'))
       then 'PASS' else 'FAIL - the writer became SECURITY DEFINER' end

union all
select 'W3', 'W3 its search_path is pinned with pg_temp last',
  case when to_regprocedure('public.apply_plan_entitlement(text,text,text,timestamptz,timestamptz,text,text,text,text,timestamptz)') is null
       then 'N/A - writer not installed'
       when (select coalesce(array_to_string(p.proconfig, ','), '') from pg_proc p
              where p.oid = to_regprocedure('public.apply_plan_entitlement(text,text,text,timestamptz,timestamptz,text,text,text,text,timestamptz)'))
            = 'search_path=public, pg_temp'
       then 'PASS' else 'FAIL - search_path is not pinned' end

union all
select 'W4', 'W4 anon and authenticated CANNOT execute the writer',
  -- The schema default grants EXECUTE on every new function to both roles.
  -- This row is what proves the REVOKE actually ran.
  case when to_regprocedure('public.apply_plan_entitlement(text,text,text,timestamptz,timestamptz,text,text,text,text,timestamptz)') is null
       then 'N/A - writer not installed'
       when not has_function_privilege('anon',
              to_regprocedure('public.apply_plan_entitlement(text,text,text,timestamptz,timestamptz,text,text,text,text,timestamptz)'), 'EXECUTE')
        and not has_function_privilege('authenticated',
              to_regprocedure('public.apply_plan_entitlement(text,text,text,timestamptz,timestamptz,text,text,text,text,timestamptz)'), 'EXECUTE')
       then 'PASS' else 'FAIL - a browser role can manufacture entitlements' end

union all
select 'W5', 'W5 service_role CAN execute the writer',
  case when to_regprocedure('public.apply_plan_entitlement(text,text,text,timestamptz,timestamptz,text,text,text,text,timestamptz)') is null
       then 'N/A - writer not installed'
       when has_function_privilege('service_role',
              to_regprocedure('public.apply_plan_entitlement(text,text,text,timestamptz,timestamptz,text,text,text,text,timestamptz)'), 'EXECUTE')
       then 'PASS' else 'FAIL - the server cannot call its own writer' end

union all
select 'W6', 'W6 no OTHER browser-callable function touches the ledger',
  case when not exists (
         select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public'
            and p.prosrc ilike '%plan_entitlements%'
            and (has_function_privilege('anon', p.oid, 'EXECUTE')
              or has_function_privilege('authenticated', p.oid, 'EXECUTE')))
       then 'PASS'
       else 'FAIL - ' || (select string_agg(p.proname, ', ')
              from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.prosrc ilike '%plan_entitlements%'
               and (has_function_privilege('anon', p.oid, 'EXECUTE')
                 or has_function_privilege('authenticated', p.oid, 'EXECUTE'))) end

-- -- info -------------------------------------------------------------------
union all
select 'Z1', '(info) entitlements by source',
  coalesce((select string_agg(source || '=' || n::text, ', ' order by source)
              from (select source, count(*) as n from public.plan_entitlements group by 1) t), 'none')

union all
select 'Z2', '(info) in-force breakdown as the application sees it right now',
  (select string_agg(st || '=' || n::text, ', ' order by st) from (
     select case when coalesce(config->>'plan', 'free') = 'free' then 'free'
                 when coalesce(config->>'planExpiresAt', '') = '' then 'paid_no_expiry_in_force'
                 when (config->>'planExpiresAt')::timestamptz > now() then 'paid_in_force'
                 else 'lapsed_to_free' end as st,
            count(*) as n
       from public.stores group by 1) t)

order by 1, 2;
