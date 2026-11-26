-- ===========================================================================
--  PocketLink Admin part 1  --  VERIFY (read-only). Every row should say PASS.
-- ===========================================================================
with f as (
  select p.oid, p.proname, p.prosecdef, p.proconfig, p.prosrc
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname like 'admin\_%'
)
select 'A1 seventeen admin functions, all with a pinned search_path' as check_name,
       case when (select count(*) from f) = 17
             and not exists (select 1 from f where proconfig is null or not (proconfig::text like '%search_path=public, pg_temp%'))
            then 'PASS' else 'FAIL' end as result
union all
select 'A2 at least one active Owner',
       case when exists (select 1 from public.admin_team where role = 'owner' and active) then 'PASS' else 'FAIL' end
union all
select 'A3 admin_team and admin_audit: row level security on, no writes for app logins',
       case when (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
                   where n.nspname = 'public' and c.relname in ('admin_team', 'admin_audit') and c.relrowsecurity) = 2
             and not exists (select 1 from information_schema.role_table_grants
                              where table_schema = 'public' and table_name in ('admin_team', 'admin_audit')
                                and grantee in ('anon', 'authenticated') and privilege_type <> 'SELECT')
             and not exists (select 1 from information_schema.role_table_grants
                              where table_schema = 'public' and table_name in ('admin_team', 'admin_audit') and grantee = 'anon')
            then 'PASS' else 'FAIL' end
union all
select 'A4 the audit log refuses update, delete and truncate',
       case when (select count(*) from pg_trigger where tgrelid = 'public.admin_audit'::regclass and not tgisinternal) = 2
            then 'PASS' else 'FAIL' end
union all
select 'A5 every read and change checks the role and 2-step sign-in',
       case when not exists (select 1 from f where f.proname in ('admin_stores', 'admin_store', 'admin_home', 'admin_billing', 'admin_audit_list',
                                                                  'admin_store_update', 'admin_set_plan', 'admin_set_status')
                                             and f.prosrc not like '%admin_require(%')
             and (select prosrc from f where proname = 'admin_can') like '%admin_mfa_ok()%'
             and (select prosrc from f where proname = 'admin_require') like '%admin_mfa_ok()%'
            then 'PASS' else 'FAIL' end
union all
select 'A6 anon can run none of them; internal ones are closed to app logins too',
       case when not exists (select 1 from f where has_function_privilege('anon', f.oid, 'execute'))
             and not exists (select 1 from f where f.proname in ('admin_role', 'admin_mfa_ok', 'admin_require', 'admin_log', 'admin_audit_frozen',
                                                                 'admin_mask_phone', 'admin_store_state')
                                             and has_function_privilege('authenticated', f.oid, 'execute'))
            then 'PASS' else 'FAIL' end
union all
select 'A7 stores.admin_status exists, checked, readable by shop pages, config still private',
       case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'stores' and column_name = 'admin_status')
             and exists (select 1 from pg_constraint where conname = 'stores_admin_status_check')
             and has_column_privilege('anon', 'public.stores', 'admin_status', 'select')
             and not has_column_privilege('anon', 'public.stores', 'config', 'select')
            then 'PASS' else 'FAIL' end
union all
select 'A8 deleting needs the typed link, and never while auto-pay runs',
       case when (select prosrc from f where proname = 'admin_set_status') like '%p_confirm is distinct from p_slug%'
             and (select prosrc from f where proname = 'admin_set_status') like '%razorpaySubscriptionId%'
            then 'PASS' else 'FAIL' end
union all
select 'A9 store edits are limited to listed keys',
       case when (select prosrc from f where proname = 'admin_store_update') like '%v_allowed%'
             and (select prosrc from f where proname = 'admin_store_update') not like '%plan%'
            then 'PASS' else 'FAIL' end
union all
select 'A10 no admin function touches orders tables for writing',
       case when not exists (select 1 from f where f.prosrc ~* '(update|delete from|insert into)\s+public\.orders')
            then 'PASS' else 'FAIL' end;
