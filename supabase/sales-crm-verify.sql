-- ===========================================================================
--  PocketLink Sales CRM  --  VERIFY (read-only). Every row should say PASS.
-- ===========================================================================
with t as (
  select c.relname, c.relrowsecurity
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname in ('sales_staff', 'sales_leads', 'sales_activities', 'sales_attendance', 'sales_holidays', 'sales_leave')
), f as (
  select p.proname, p.prosecdef, p.proconfig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname like 'sales\_%'
)
select 'C1 six tables exist' as check_name,
       case when (select count(*) from t) = 6 then 'PASS' else 'FAIL' end as result
union all
select 'C2 row level security on all six',
       case when (select count(*) from t where relrowsecurity) = 6 then 'PASS' else 'FAIL' end
union all
select 'C3 anon has no table privilege',
       case when not exists (
         select 1 from information_schema.role_table_grants
          where grantee = 'anon' and table_schema = 'public' and table_name like 'sales\_%'
       ) then 'PASS' else 'FAIL' end
union all
select 'C4 every sales function pins search_path',
       case when not exists (
         select 1 from f where proconfig is null or not (proconfig::text like '%search_path=public, pg_temp%')
       ) then 'PASS' else 'FAIL' end
union all
select 'C5 anon cannot run any sales function',
       case when not exists (
         select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname like 'sales\_%'
            and p.proname <> 'sales_today' and p.proname <> 'sales_leads_guard'
            and has_function_privilege('anon', p.oid, 'execute')
       ) then 'PASS' else 'FAIL' end
union all
select 'C6 lookup / touch / day are security definer, log / assign are invoker',
       case when (select count(*) from f where proname in ('sales_phone_lookup', 'sales_touch', 'sales_day', 'sales_role', 'sales_is_staff', 'sales_is_manager') and prosecdef) = 6
             and (select count(*) from f where proname in ('sales_log', 'sales_assign') and not prosecdef) = 2
            then 'PASS' else 'FAIL' end
union all
select 'C7 one lead per phone (unique index)',
       case when exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'sales_leads_phone_key')
            then 'PASS' else 'FAIL' end
union all
select 'C8 private bucket sales-visits',
       case when exists (select 1 from storage.buckets where id = 'sales-visits' and not public) then 'PASS' else 'FAIL' end
union all
select 'C9 two storage policies for the bucket',
       case when (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects'
                   and policyname in ('sales_visits_upload', 'sales_visits_view')) = 2 then 'PASS' else 'FAIL' end
union all
select 'C10 no policy on stores, orders or store_views mentions the CRM',
       case when not exists (
         select 1 from pg_policies
          where schemaname = 'public' and tablename in ('stores', 'orders', 'store_views')
            and (coalesce(qual, '') like '%sales_%' or coalesce(with_check, '') like '%sales_%')
       ) then 'PASS' else 'FAIL' end
union all
select 'C11 nobody signed in here is staff (auth.uid() is null)',
       case when public.sales_role() is null then 'PASS' else 'FAIL' end;
