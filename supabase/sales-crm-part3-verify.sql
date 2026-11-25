-- ===========================================================================
--  PocketLink Sales CRM part 3  --  VERIFY (read-only). Every row should say PASS.
-- ===========================================================================
with f as (
  select p.oid, p.proname, p.prosecdef, p.proconfig, p.prosrc
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('sales_callable_at', 'sales_lead_in', 'sales_lead_failed', 'sales_lead_feed', 'sales_rotate_slow_leads',
                       'sales_win_from_payment', 'sales_capture_payment', 'sales_win_review', 'sales_pending_wins', 'sales_scoreboard')
)
select 'Q1 ten functions exist and pin search_path' as check_name,
       case when (select count(*) from f) = 10
             and not exists (select 1 from f where proconfig is null or not (proconfig::text like '%search_path=public, pg_temp%'))
            then 'PASS' else 'FAIL' end as result
union all
select 'Q2 lead events + private values: row level security on',
       case when (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
                   where n.nspname = 'public' and c.relname in ('sales_lead_events', 'sales_private') and c.relrowsecurity) = 2
            then 'PASS' else 'FAIL' end
union all
select 'Q3 nobody signed in can read sales_private (no policy, no grant)',
       case when not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'sales_private')
             and not exists (select 1 from information_schema.role_table_grants
                              where table_schema = 'public' and table_name = 'sales_private' and grantee in ('anon', 'authenticated'))
            then 'PASS' else 'FAIL' end
union all
select 'Q4 only the service role can put a lead in',
       case when not exists (select 1 from f, (values ('anon'), ('authenticated')) r(role)
                              where f.proname in ('sales_lead_in', 'sales_lead_failed', 'sales_rotate_slow_leads', 'sales_win_from_payment', 'sales_capture_payment')
                                and has_function_privilege(r.role, f.oid, 'execute'))
             and has_function_privilege('service_role', (select oid from f where proname = 'sales_lead_in'), 'execute')
            then 'PASS' else 'FAIL' end
union all
select 'Q5 anon cannot run feed / review / pending wins / scoreboard',
       case when not exists (select 1 from f where proname in ('sales_lead_feed', 'sales_win_review', 'sales_pending_wins', 'sales_scoreboard', 'sales_callable_at')
                              and has_function_privilege('anon', f.oid, 'execute'))
            then 'PASS' else 'FAIL' end
union all
select 'Q6 win proof columns + guard v3 locks them',
       case when (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'sales_leads'
                   and column_name in ('won_proof', 'won_proof_at', 'won_proof_by')) = 3
             and (select prosrc from pg_proc where proname = 'sales_leads_guard') like '%new.won_proof := old.won_proof%'
            then 'PASS' else 'FAIL' end
union all
select 'Q7 scoreboard v2 returns talk time and pending wins',
       case when (select prosrc from f where proname = 'sales_scoreboard') like '%w.won_proof is null%'
             and (select prosrc from f where proname = 'sales_scoreboard') like '%sum(a.duration_sec)%'
            then 'PASS' else 'FAIL' end
union all
select 'Q8 payment capture swallows its own errors',
       case when (select prosrc from f where proname = 'sales_capture_payment') like '%exception when others then%'
            then 'PASS' else 'FAIL' end
union all
select 'Q9 payment trigger present (when plan_entitlements exists)',
       case when to_regclass('public.plan_entitlements') is null
             or exists (select 1 from pg_trigger where tgname = 'sales_capture_payment' and tgrelid = to_regclass('public.plan_entitlements') and not tgisinternal)
            then 'PASS' else 'FAIL' end
union all
select 'Q10 manager-only setting keys hidden from callers',
       case when (select qual from pg_policies where schemaname = 'public' and tablename = 'sales_settings' and policyname = 'sales_settings_read')
                 like '%auto_assign%policies%incentive%'
            then 'PASS' else 'FAIL' end;
