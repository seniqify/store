-- ===========================================================================
--  PocketLink Admin part 3  --  VERIFY (read-only). Every row should say PASS.
-- ===========================================================================
with f as (
  select p.oid, p.proname, p.proconfig, p.prosrc
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('platform_flags', 'admin_switches', 'admin_switch_set', 'stores_signup_gate', 'admin_jobs',
                       'admin_job_run', 'admin_job_pause', 'admin_purge_list', 'admin_purge_store')
)
select 'C1 nine new functions, all with a pinned search_path' as check_name,
       case when (select count(*) from f) = 9
             and not exists (select 1 from f where proconfig is null or not (proconfig::text like '%search_path=public, pg_temp%'))
            then 'PASS' else 'FAIL' end as result
union all
select 'C2 every admin read and change checks role and 2-step; changes are Owner only',
       case when not exists (select 1 from f where f.proname like 'admin\_%' and f.prosrc not like '%admin_require(%')
             and (select prosrc from f where proname = 'admin_switch_set') like '%admin_require(''system'')%'
             and (select prosrc from f where proname = 'admin_job_run') like '%admin_require(''system'')%'
             and (select prosrc from f where proname = 'admin_job_pause') like '%admin_require(''system'')%'
             and (select prosrc from f where proname = 'admin_purge_store') like '%admin_require(''delete'')%'
            then 'PASS' else 'FAIL' end
union all
select 'C3 anon may only read the platform flags; the gate is closed to app logins',
       case when has_function_privilege('anon', (select oid from f where proname = 'platform_flags'), 'execute')
             and not exists (select 1 from f where f.proname <> 'platform_flags' and has_function_privilege('anon', f.oid, 'execute'))
             and not has_function_privilege('authenticated', (select oid from f where proname = 'stores_signup_gate'), 'execute')
            then 'PASS' else 'FAIL' end
union all
select 'C4 platform_settings: row level security on, closed to the browser, 3 switches',
       case when (select relrowsecurity from pg_class where oid = 'public.platform_settings'::regclass)
             and not has_table_privilege('anon', 'public.platform_settings', 'select')
             and not has_table_privilege('authenticated', 'public.platform_settings', 'select')
             and (select count(*) from public.platform_settings) = 3
            then 'PASS' else 'FAIL' end
union all
select 'C5 the sign-up gate is on stores, before insert',
       case when exists (select 1 from pg_trigger t where t.tgrelid = 'public.stores'::regclass and t.tgname = 'stores_signup_gate' and not t.tgisinternal)
            then 'PASS' else 'FAIL' end
union all
select 'C6 remove for good: 30 days, typed link, never orders, reviews, parcels or money',
       case when (select prosrc from f where proname = 'admin_purge_store') like '%interval ''30 days''%'
             and (select prosrc from f where proname = 'admin_purge_store') like '%type the shop link to confirm%'
             and (select prosrc from f where proname = 'admin_purge_store') !~ '''(orders|product_reviews|review_reports|review_audit|shipment_attempts|wallet_ledger|wallet_topups|store_wallets|plan_entitlements)'''
            then 'PASS' else 'FAIL' end
union all
select 'C7 a shop removed for good stays closed; part 2 rules kept',
       case when (select p.prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'public' and p.proname = 'admin_set_status') like '%removed for good and cannot be opened again%'
             and (select p.prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'public' and p.proname = 'admin_set_status') like '%admin_autopay_on(%'
             and (select p.prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'public' and p.proname = 'admin_note') like '%purge_photos%'
            then 'PASS' else 'FAIL' end
union all
select 'C8 scheduled jobs are readable here (pg_cron present)',
       case when to_regclass('cron.job') is not null and to_regclass('cron.job_run_details') is not null
            then 'PASS' else 'FAIL' end;
