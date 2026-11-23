-- ===========================================================================
--  Paying stores keep their plan  --  VERIFY (read-only)
--  Run after subscription-sync-forward.sql. Every row should say PASS.
-- ===========================================================================

with fn as (
  select p.oid, p.prosecdef, p.proconfig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'extend_store_plan_from_razorpay'
     and pg_get_function_identity_arguments(p.oid) = 'p_slug text, p_subscription_id text, p_plan text, p_expires_at text'
)
select 'V1 function exists' as check_name,
       case when exists (select 1 from fn) then 'PASS' else 'FAIL' end as result
union all
select 'V2 security definer with pinned search_path',
       case when exists (select 1 from fn where prosecdef and proconfig::text like '%search_path=public, pg_temp%')
            then 'PASS' else 'FAIL' end
union all
select 'V3 anon cannot execute',
       case when not has_function_privilege('anon', 'public.extend_store_plan_from_razorpay(text, text, text, text)', 'execute')
            then 'PASS' else 'FAIL' end
union all
select 'V4 authenticated cannot execute',
       case when not has_function_privilege('authenticated', 'public.extend_store_plan_from_razorpay(text, text, text, text)', 'execute')
            then 'PASS' else 'FAIL' end
union all
select 'V5 service_role can execute',
       case when has_function_privilege('service_role', 'public.extend_store_plan_from_razorpay(text, text, text, text)', 'execute')
            then 'PASS' else 'FAIL' end
union all
select 'V6 job secret exists',
       case when exists (select 1 from public.automation_secrets where name = 'subscription-sync' and length(secret) >= 32)
            then 'PASS' else 'FAIL' end
union all
select 'V7 bad input is refused without writing',
       case when public.extend_store_plan_from_razorpay('no-such-store-xyz', 'not-a-sub', 'premium', '2099-01-01T00:00:00Z') = 'bad_input'
            then 'PASS' else 'FAIL' end
union all
select 'V8 unknown store is refused',
       case when public.extend_store_plan_from_razorpay('no-such-store-xyz', 'sub_Test123', 'premium',
                   to_char((now() + interval '20 days') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')) = 'not_found'
            then 'PASS' else 'FAIL' end;
