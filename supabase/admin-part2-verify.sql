-- ===========================================================================
--  PocketLink Admin part 2  --  VERIFY (read-only). Every row should say PASS.
-- ===========================================================================
with f as (
  select p.oid, p.proname, p.proconfig, p.prosrc
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('admin_autopay_on', 'admin_autopay_stopped', 'admin_note', 'admin_may_manage', 'admin_people', 'admin_team_save',
                       'admin_team_remove', 'admin_hub_remove', 'admin_orders', 'admin_orders_summary', 'admin_review_reports',
                       'admin_review_decide', 'admin_coins', 'admin_coins_summary', 'admin_store_coins', 'admin_reset_pin')
)
select 'B1 sixteen new functions, all with a pinned search_path' as check_name,
       case when (select count(*) from f) = 16
             and not exists (select 1 from f where proconfig is null or not (proconfig::text like '%search_path=public, pg_temp%'))
            then 'PASS' else 'FAIL' end as result
union all
select 'B2 every new read and change checks role and 2-step',
       case when not exists (select 1 from f where f.proname not in ('admin_autopay_on', 'admin_may_manage') and f.prosrc not like '%admin_require(%')
             and (select prosrc from f where proname = 'admin_may_manage') like '%admin_can(''people'')%'
            then 'PASS' else 'FAIL' end
union all
select 'B3 anon can run none; the auto-pay helper is closed to app logins',
       case when not exists (select 1 from f where has_function_privilege('anon', f.oid, 'execute'))
             and not has_function_privilege('authenticated', (select oid from f where proname = 'admin_autopay_on'), 'execute')
            then 'PASS' else 'FAIL' end
union all
select 'B4 the team rules: own role, Owners and Admins, the last Owner',
       case when (select prosrc from f where proname = 'admin_team_save') like '%you cannot change your own role%'
             and (select prosrc from f where proname = 'admin_team_save') like '%only the Owner can make someone an Owner or Admin%'
             and (select prosrc from f where proname = 'admin_team_save') like '%there must always be one active Owner%'
             and (select prosrc from f where proname = 'admin_team_remove') like '%there must always be one active Owner%'
            then 'PASS' else 'FAIL' end
union all
select 'B5 orders are read only; Coins go through wallet_adjust; PIN takes a hash only',
       case when not exists (select 1 from f where f.prosrc ~* '(update|delete from|insert into)\s+public\.orders')
             and (select prosrc from f where proname = 'admin_coins') like '%public.wallet_adjust(%'
             and (select prosrc from f where proname = 'admin_reset_pin') like '%^[0-9a-f]{64}$%'
            then 'PASS' else 'FAIL' end
union all
select 'B6 part 1 still uses the auto-pay helper (state, list, billing, delete)',
       case when (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'public' and p.proname in ('admin_store_state', 'admin_stores', 'admin_billing', 'admin_set_status')
                     and p.prosrc like '%admin_autopay_on(%') = 4
            then 'PASS' else 'FAIL' end
union all
select 'B7 the note writer accepts only known actions',
       case when (select prosrc from f where proname = 'admin_note') like '%unknown action%' then 'PASS' else 'FAIL' end;
