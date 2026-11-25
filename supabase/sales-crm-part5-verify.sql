-- ===========================================================================
--  PocketLink Sales CRM part 5  --  VERIFY (read-only). Every row should say PASS.
-- ===========================================================================
with f as (
  select p.oid, p.proname, p.prosecdef, p.proconfig, p.prosrc, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('sales_is_ads', 'sales_verify_lead', 'sales_pick_owner', 'sales_auto_assign', 'sales_lead_feed',
                       'sales_incentive_add', 'sales_win_from_payment', 'sales_win_review', 'sales_incentive_check',
                       'sales_incentive_set', 'sales_signoff', 'sales_exam_start', 'sales_scoreboard')
)
select 'P1 thirteen functions (one each) pin search_path' as check_name,
       case when (select count(*) from f) = 13 and (select count(distinct proname) from f) = 13
             and not exists (select 1 from f where proconfig is null or not (proconfig::text like '%search_path=public, pg_temp%'))
            then 'PASS' else 'FAIL' end as result
union all
select 'P2 the Ads & leads role is allowed',
       case when exists (select 1 from pg_constraint where conname = 'sales_staff_role_check'
                          and pg_get_constraintdef(oid) like '%ads%' and pg_get_constraintdef(oid) like '%manager%')
            then 'PASS' else 'FAIL' end
union all
select 'P3 lead checking columns and their limits exist',
       case when (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'sales_leads'
                   and column_name in ('verify_status', 'verified_by', 'verified_at', 'verify_note')) = 4
             and exists (select 1 from pg_constraint where conname = 'sales_leads_verify_check')
            then 'PASS' else 'FAIL' end
union all
select 'P4 lead guard v4 locks the checking result and never gives a lead to Ads & leads',
       case when (select p.prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'public' and p.proname = 'sales_leads_guard') like '%new.verify_status := old.verify_status%'
             and (select p.prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'public' and p.proname = 'sales_leads_guard') like '%s.role = ''ads''%'
            then 'PASS' else 'FAIL' end
union all
select 'P5 the auto-assign rules never pick Ads & leads',
       case when (select prosrc from f where proname = 'sales_pick_owner') like '%s.role <> ''ads''%' then 'PASS' else 'FAIL' end
union all
select 'P6 incentives are one row per lead and person; lead checker basis allowed',
       case when (select pg_get_constraintdef(oid) from pg_constraint where conname = 'sales_incentives_pkey') = 'PRIMARY KEY (lead_id, staff_id)'
             and (select pg_get_constraintdef(oid) from pg_constraint where conname = 'sales_incentives_basis_check') like '%verified%'
            then 'PASS' else 'FAIL' end
union all
select 'P7 internal functions are not callable by app logins',
       case when not exists (select 1 from f, (values ('anon'), ('authenticated')) r(role)
                              where f.proname in ('sales_pick_owner', 'sales_incentive_add', 'sales_incentive_check', 'sales_win_from_payment')
                                and has_function_privilege(r.role, f.oid, 'execute'))
            then 'PASS' else 'FAIL' end
union all
select 'P8 anon cannot run any of them; app logins can run the screen ones',
       case when not exists (select 1 from f where has_function_privilege('anon', f.oid, 'execute'))
             and not exists (select 1 from f where f.proname in ('sales_is_ads', 'sales_verify_lead', 'sales_auto_assign', 'sales_lead_feed',
                                                                  'sales_win_review', 'sales_incentive_set', 'sales_signoff', 'sales_exam_start', 'sales_scoreboard')
                                             and not has_function_privilege('authenticated', f.oid, 'execute'))
            then 'PASS' else 'FAIL' end
union all
select 'P9 exam questions carry roles; every role has questions; payment question fixed',
       case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'sales_exam_questions' and column_name = 'roles')
             and (select count(*) from public.sales_exam_questions where active and 'all' = any (roles)) >= 6
             and not exists (select 1 from (values ('caller'), ('field'), ('manager'), ('ads')) r(role)
                              where (select count(*) from public.sales_exam_questions q where q.active and r.role = any (q.roles)) < 8)
             and not exists (select 1 from public.sales_exam_questions where question ilike '%payment link%' or options::text ilike '%Razorpay payment link%')
            then 'PASS' else 'FAIL' end
union all
select 'P10 exam start still never sends the answers',
       case when (select prosrc from f where proname = 'sales_exam_start') not like '%''answer''%'
             and (select prosrc from f where proname = 'sales_exam_start') like '%roles%'
            then 'PASS' else 'FAIL' end
union all
select 'P11 Ads & leads see only lead sources and ad spend in settings; nothing about shops',
       case when (select qual from pg_policies where schemaname = 'public' and tablename = 'sales_settings' and policyname = 'sales_settings_read') like '%ad_spend%'
             and not exists (select 1 from f where f.proname in ('sales_verify_lead', 'sales_lead_feed', 'sales_scoreboard', 'sales_auto_assign')
                                             and f.prosrc ~ 'public\.(orders|store_views)')
            then 'PASS' else 'FAIL' end
union all
select 'P12 sign-off columns exist',
       case when (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'sales_staff'
                   and column_name in ('signed_off_at', 'signed_off_by')) = 2
            then 'PASS' else 'FAIL' end;
