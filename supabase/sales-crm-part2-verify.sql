-- ===========================================================================
--  PocketLink Sales CRM part 2  --  VERIFY (read-only). Every row should say PASS.
-- ===========================================================================
with f as (
  select p.oid, p.proname, p.prosecdef, p.proconfig, p.prosrc
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('sales_review', 'sales_scoreboard', 'sales_auto_assign', 'sales_pick_owner',
                       'sales_capture_signup', 'sales_capture_pending', 'sales_settings_stamp', 'sales_leads_guard')
), t as (
  select c.relname, c.relrowsecurity
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname in ('sales_settings', 'sales_questions')
)
select 'P1 lead guard v2 holds back only app logins' as check_name,
       case when (select prosrc from f where proname = 'sales_leads_guard') like '%current_user = ''authenticated''%'
            then 'PASS' else 'FAIL' end as result
union all
select 'P2 sales_staff.targets exists',
       case when exists (select 1 from information_schema.columns
                          where table_schema = 'public' and table_name = 'sales_staff' and column_name = 'targets')
            then 'PASS' else 'FAIL' end
union all
select 'P3 settings + questions tables with row level security',
       case when (select count(*) from t where relrowsecurity) = 2 then 'PASS' else 'FAIL' end
union all
select 'P4 policies: settings 3, questions 4, visit review 1',
       case when (select count(*) from pg_policies where schemaname = 'public' and tablename = 'sales_settings') = 3
             and (select count(*) from pg_policies where schemaname = 'public' and tablename = 'sales_questions') = 4
             and exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'sales_activities' and policyname = 'sales_activities_review')
            then 'PASS' else 'FAIL' end
union all
select 'P5 visit review columns exist',
       case when (select count(*) from information_schema.columns
                   where table_schema = 'public' and table_name = 'sales_activities'
                     and column_name in ('review', 'reviewed_by', 'reviewed_at')) = 3
            then 'PASS' else 'FAIL' end
union all
select 'P6 all eight functions exist and pin search_path',
       case when (select count(*) from f) = 8
             and not exists (select 1 from f where proconfig is null or not (proconfig::text like '%search_path=public, pg_temp%'))
            then 'PASS' else 'FAIL' end
union all
select 'P7 scoreboard / auto-assign / pick / captures are security definer',
       case when (select count(*) from f where prosecdef
                   and proname in ('sales_scoreboard', 'sales_auto_assign', 'sales_pick_owner', 'sales_capture_signup', 'sales_capture_pending')) = 5
             and (select count(*) from f where not prosecdef and proname in ('sales_review', 'sales_settings_stamp', 'sales_leads_guard')) = 3
            then 'PASS' else 'FAIL' end
union all
select 'P8 no app login can run the internal picker or the capture triggers',
       case when not exists (
         select 1 from f, (values ('anon'), ('authenticated')) r(role)
          where f.proname in ('sales_pick_owner', 'sales_capture_signup', 'sales_capture_pending')
            and has_function_privilege(r.role, f.oid, 'execute'))
            then 'PASS' else 'FAIL' end
union all
select 'P9 anon cannot run review / scoreboard / auto-assign',
       case when not exists (
         select 1 from f where proname in ('sales_review', 'sales_scoreboard', 'sales_auto_assign')
            and has_function_privilege('anon', f.oid, 'execute'))
             and (select count(*) from f where proname in ('sales_review', 'sales_scoreboard', 'sales_auto_assign')
                   and has_function_privilege('authenticated', f.oid, 'execute')) = 3
            then 'PASS' else 'FAIL' end
union all
select 'P10 anon has no privilege on the new tables',
       case when not exists (
         select 1 from information_schema.role_table_grants
          where grantee = 'anon' and table_schema = 'public' and table_name in ('sales_settings', 'sales_questions'))
            then 'PASS' else 'FAIL' end
union all
select 'P11 sign-up triggers are on stores and pending_signups',
       case when exists (select 1 from pg_trigger where tgname = 'sales_capture_signup' and tgrelid = 'public.stores'::regclass and not tgisinternal)
             and exists (select 1 from pg_trigger where tgname = 'sales_capture_pending' and tgrelid = 'public.pending_signups'::regclass and not tgisinternal)
            then 'PASS' else 'FAIL' end
union all
select 'P12 the capture triggers swallow their own errors',
       case when (select count(*) from f where proname in ('sales_capture_signup', 'sales_capture_pending')
                   and prosrc like '%exception when others then%') = 2
            then 'PASS' else 'FAIL' end;
