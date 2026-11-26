-- ===========================================================================
--  PocketLink Salary  --  VERIFY (read-only). Every row should say PASS.
-- ===========================================================================
with f as (
  select p.oid, p.proname, p.proconfig, p.prosrc, p.pronargs
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('payroll_settings_get', 'payroll_settings_clean', 'payroll_mask', 'payroll_advance_taken',
                       'payroll_incentive_taken', 'payroll_check_lines', 'payroll_totals', 'payroll_lock_on', 'payroll_tax',
                       'payroll_incentive_guard', 'admin_payroll_inputs', 'admin_payroll_save_drafts', 'admin_payroll_draft_remove',
                       'admin_payroll_line_add', 'admin_payroll_line_remove', 'admin_payroll_approve', 'admin_payroll_unapprove',
                       'admin_payroll_mark_paid', 'admin_payroll_undo_paid', 'admin_payroll_settings_save', 'admin_payroll_person_save',
                       'admin_payroll_advance_add', 'admin_payroll_advance_remove', 'admin_payroll_notify_data', 'admin_payroll_notified',
                       'sales_my_pay')
),
pub as (select * from f where proname like 'admin\_payroll\_%' or proname = 'sales_my_pay')
select 'S1 26 salary functions, all with a pinned search_path' as check_name,
       case when (select count(*) from f) = 26
             and not exists (select 1 from f where proconfig is null or not (proconfig::text like '%search_path=public, pg_temp%'))
            then 'PASS' else 'FAIL' end as result
union all
select 'S2 every Admin salary function checks role and 2-step; approving and setup are Owner only',
       case when not exists (select 1 from f where proname like 'admin\_payroll\_%' and prosrc not like '%admin_require(''salary%')
             and not exists (select 1 from f where proname in ('admin_payroll_approve', 'admin_payroll_unapprove', 'admin_payroll_undo_paid',
                                                                'admin_payroll_settings_save', 'admin_payroll_person_save')
                              and prosrc not like '%admin_require(''salary_approve'')%')
            then 'PASS' else 'FAIL' end
union all
select 'S3 visitors run nothing; app logins run only the Admin functions and their own pay',
       case when not exists (select 1 from f where has_function_privilege('anon', f.oid, 'execute'))
             and not exists (select 1 from f where proname like 'payroll\_%' and has_function_privilege('authenticated', f.oid, 'execute'))
             and not exists (select 1 from pub where not has_function_privilege('authenticated', pub.oid, 'execute'))
            then 'PASS' else 'FAIL' end
union all
select 'S4 the 4 salary tables: row level security on, closed to the browser',
       case when (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
                   where n.nspname = 'public' and c.relname in ('payroll_settings', 'payroll_people', 'payroll_advances', 'payroll_slips')
                     and c.relrowsecurity) = 4
             and not has_table_privilege('anon', 'public.payroll_slips', 'select')
             and not has_table_privilege('authenticated', 'public.payroll_slips', 'select')
             and not has_table_privilege('authenticated', 'public.payroll_people', 'select')
             and not has_table_privilege('authenticated', 'public.payroll_advances', 'select')
             and not has_table_privilege('authenticated', 'public.payroll_settings', 'select')
            then 'PASS' else 'FAIL' end
union all
select 'S5 admin_can: salary is Owner and Finance, approving is Owner only',
       case when (select p.prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'admin_can')
                 like '%''salary''         then v_role in (''owner'', ''finance'')%'
             and (select p.prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'admin_can')
                 like '%''salary_approve'' then v_role = ''owner''%'
            then 'PASS' else 'FAIL' end
union all
select 'S6 an incentive inside an approved salary is guarded',
       case when exists (select 1 from pg_trigger t where t.tgrelid = 'public.sales_incentives'::regclass
                          and t.tgname = 'payroll_incentive_guard' and not t.tgisinternal)
            then 'PASS' else 'FAIL' end
union all
select 'S7 the rules row exists and fills its defaults',
       case when (select count(*) from public.payroll_settings) = 1
             and public.payroll_settings_get()->>'pay_day' is not null
             and public.payroll_settings_get()->>'lock_day' is not null
            then 'PASS' else 'FAIL' end
union all
select 'S8 the CRM gives each person only their own pay',
       case when (select prosrc from f where proname = 'sales_my_pay') like '%v_me uuid := auth.uid()%'
             and (select prosrc from f where proname = 'sales_my_pay') like '%sales_is_staff()%'
             and (select pronargs from f where proname = 'sales_my_pay') = 0
            then 'PASS' else 'FAIL' end
union all
select 'S9 salary amounts and reasons in the audit log reach only the Owner and Finance',
       case when (select pg_get_expr(p.polqual, p.polrelid) from pg_policy p
                   where p.polrelid = 'public.admin_audit'::regclass and p.polname = 'admin_audit_read') like '%admin_can(''salary''::text)%'
             and (select p.prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'admin_audit_list')
                 like '%a.target_kind = ''salary'' and not v_pay%'
             and (select p.prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'admin_home')
                 like '%a.target_kind = ''salary'' and not public.admin_can(''salary'')%'
            then 'PASS' else 'FAIL' end;
