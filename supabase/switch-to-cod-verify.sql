-- Verifier for switch-to-cod-forward.sql. READ-ONLY: one SELECT.
-- After the forward: every S row PASS (I rows are information).

with fn as (
  select p.oid, md5(replace(p.prosrc, chr(13), '')) as md5, p.prosrc, p.provolatile::text as vol, p.prosecdef,
         coalesce(array_to_string(p.proconfig, ', '), '') as cfg, pg_get_function_result(p.oid) as ret, p.proacl
    from pg_proc p
   where p.oid = to_regprocedure('public.switch_order_to_cod(text,text,uuid)')
)
select 'S1' as grp, 'S1 switch_order_to_cod is the reviewed version (md5)' as check_name,
  case when (select md5 from fn) = '0f958608466f4468a9320862e5b4a0d6' then 'PASS'
       else 'FAIL - ' || coalesce('md5 ' || (select md5 from fn), 'function missing') end as result
union all
select 'S2', 'S2 VOLATILE, SECURITY DEFINER, search_path public, pg_temp, returns boolean',
  case when (select vol = 'v' and prosecdef and cfg = 'search_path=public, pg_temp' and ret = 'boolean' from fn)
       then 'PASS' else 'FAIL' end
union all
select 'S3', 'S3 the PIN check runs first',
  case when (select prosrc ilike '%if not public.verify_store_pin(p_slug, p_hashed_pin) then%' from fn)
       then 'PASS' else 'FAIL' end
union all
select 'S4', 'S4 the browser can call it (anon, authenticated); PUBLIC cannot',
  case when (select oid from fn) is not null
        and has_function_privilege('anon', 'public.switch_order_to_cod(text,text,uuid)', 'EXECUTE')
        and has_function_privilege('authenticated', 'public.switch_order_to_cod(text,text,uuid)', 'EXECUTE')
        and not exists (select 1 from fn, aclexplode(fn.proacl) x where x.grantee = 0 and x.privilege_type = 'EXECUTE')
       then 'PASS' else 'FAIL' end
union all
select 'I1', 'I1 unpaid online orders a shop could switch (all stores)',
  (select count(*)::text from public.orders o
    where lower(coalesce(o.payment_method, '')) = 'online' and o.paid is not true
      and coalesce(o.payment_ref, '') = '' and lower(coalesce(o.status, '')) not in ('cancelled', 'abandoned'));
