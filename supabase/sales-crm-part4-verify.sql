-- ===========================================================================
--  PocketLink Sales CRM part 4  --  VERIFY (read-only). Every row should say PASS.
-- ===========================================================================
with f as (
  select p.oid, p.proname, p.prosecdef, p.proconfig, p.prosrc
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('sales_new_ref_code', 'sales_staff_defaults', 'sales_capture_signup', 'sales_incentive_amount', 'sales_incentive_add',
                       'sales_win_from_payment', 'sales_win_review', 'sales_incentive_check', 'sales_incentive_set', 'sales_my_link_stats',
                       'sales_exam_start', 'sales_exam_submit', 'sales_report_data')
), t as (
  select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname in ('sales_referrals', 'sales_incentives', 'sales_training', 'sales_exam_questions', 'sales_exam_attempts', 'sales_reports')
)
select 'R1 thirteen functions exist and pin search_path' as check_name,
       case when (select count(*) from f) = 13
             and not exists (select 1 from f where proconfig is null or not (proconfig::text like '%search_path=public, pg_temp%'))
            then 'PASS' else 'FAIL' end as result
union all
select 'R2 six new tables, row level security on all',
       case when (select count(*) from t where relrowsecurity) = 6 then 'PASS' else 'FAIL' end
union all
select 'R3 nobody signed in can read referrals or the exam answers',
       case when not exists (select 1 from information_schema.role_table_grants
                              where table_schema = 'public' and table_name in ('sales_referrals', 'sales_exam_questions')
                                and grantee in ('anon', 'authenticated'))
            then 'PASS' else 'FAIL' end
union all
select 'R4 every person has a sign-up code',
       case when not exists (select 1 from public.sales_staff where ref_code is null) then 'PASS' else 'FAIL' end
union all
select 'R5 new people must pass training (column default true, not null)',
       case when (select column_default from information_schema.columns where table_schema = 'public' and table_name = 'sales_staff' and column_name = 'must_train') = 'true'
             and (select is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'sales_staff' and column_name = 'must_train') = 'NO'
            then 'PASS' else 'FAIL' end
union all
select 'R6 internal functions are not callable by app logins',
       case when not exists (select 1 from f, (values ('anon'), ('authenticated')) r(role)
                              where f.proname in ('sales_new_ref_code', 'sales_incentive_amount', 'sales_incentive_add', 'sales_incentive_check',
                                                  'sales_win_from_payment', 'sales_capture_signup')
                                and has_function_privilege(r.role, f.oid, 'execute'))
            then 'PASS' else 'FAIL' end
union all
select 'R7 anon cannot run any of the new functions',
       case when not exists (select 1 from f where has_function_privilege('anon', f.oid, 'execute'))
            then 'PASS' else 'FAIL' end
union all
select 'R8 sign-up capture v3 reads the code and still swallows errors',
       case when (select prosrc from f where proname = 'sales_capture_signup') like '%salesRef%'
             and (select prosrc from f where proname = 'sales_capture_signup') like '%exception when others then%'
            then 'PASS' else 'FAIL' end
union all
select 'R9 exam is graded on the server (answers never returned)',
       case when (select prosrc from f where proname = 'sales_exam_start') not like '%''answer''%'
             and (select prosrc from f where proname = 'sales_exam_submit') like '%q.answer%'
             and (select count(*) from public.sales_exam_questions where active) >= 15
            then 'PASS' else 'FAIL' end
union all
select 'R10 reports: managers or the service role only; sweep secret exists',
       case when (select prosrc from f where proname = 'sales_report_data') like '%sales_is_manager() or v_role = ''service_role''%'
             and exists (select 1 from public.automation_secrets where name = 'sales-report')
            then 'PASS' else 'FAIL' end;
