-- ===========================================================================
--  PocketLink Sales CRM part 6  --  VERIFY (read-only). Every row should say PASS.
-- ===========================================================================
with f as (
  select p.oid, p.proname, p.proconfig, p.prosrc
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('sales_work_rule', 'sales_work_level', 'sales_work_rows', 'sales_work_days', 'sales_days_worked')
)
select 'E1 five new functions, all with a pinned search_path' as check_name,
       case when (select count(*) from f) = 5
             and not exists (select 1 from f where proconfig is null or not (proconfig::text like '%search_path=public, pg_temp%'))
            then 'PASS' else 'FAIL' end as result
union all
select 'E2 the browser may only read sales_work_days (managers all, others themselves)',
       case when not exists (select 1 from f where has_function_privilege('anon', f.oid, 'execute'))
             and not exists (select 1 from f where f.proname <> 'sales_work_days' and has_function_privilege('authenticated', f.oid, 'execute'))
             and has_function_privilege('authenticated', (select oid from f where proname = 'sales_work_days'), 'execute')
             and (select prosrc from f where proname = 'sales_work_days') like '%case when v_all then null else auth.uid() end%'
            then 'PASS' else 'FAIL' end
union all
select 'E3 scoreboard and report count days in from real work',
       case when (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'public' and p.proname in ('sales_scoreboard', 'sales_report_data')
                     and p.prosrc like '%public.sales_days_worked(s.user_id, p_from, p_to)%'
                     and p.prosrc not like '%t.first_seen_at is not null or t.day_start_at is not null%') = 2
            then 'PASS' else 'FAIL' end
union all
select 'E4 rejected work and imported leads never count',
       case when (select prosrc from f where proname = 'sales_work_rows') like '%a.review is distinct from ''rejected''%'
             and (select prosrc from f where proname = 'sales_work_rows') like '%l.source not in (''import'', ''hub'', ''signup'', ''pending_signup'')%'
            then 'PASS' else 'FAIL' end
union all
select 'E5 the rule has a start date (days before it keep the old rule)',
       case when (select value->'work_rule'->>'from' from public.sales_settings where key = 'work') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
            then 'PASS' else 'FAIL' end;
