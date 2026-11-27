-- ===========================================================================
--  "Deliver it yourself"  --  VERIFY (read-only). Every row should say PASS.
-- ===========================================================================
with f as (
  select p.oid, p.proconfig, p.prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mark_self_delivered'
)
select 'D1 mark_self_delivered exists, search_path pinned, checks the owner PIN' as check_name,
       case when (select count(*) from f) = 1
             and (select proconfig::text from f) like '%search_path=public, pg_temp%'
             and (select prosrc from f) like '%verify_store_pin(p_slug, p_hashed_pin)%'
            then 'PASS' else 'FAIL' end as result
union all
select 'D2 the shop app may call it (the PIN is the key); a courier parcel is refused',
       case when has_function_privilege('anon', (select oid from f), 'execute')
             and (select prosrc from f) like '%o.awb is not null%'
            then 'PASS' else 'FAIL' end;
