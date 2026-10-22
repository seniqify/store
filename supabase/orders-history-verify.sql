-- Verifier for orders-history-forward.sql. READ-ONLY: one SELECT.
-- After the forward: every H row PASS (I-rows are information).

with fn as (
  select p.oid, p.prosrc, p.provolatile::text as vol, p.prosecdef,
         coalesce(array_to_string(p.proconfig, ', '), '') as cfg, pg_get_function_result(p.oid) as ret
    from pg_proc p
   where p.oid = to_regprocedure('public.get_store_orders_before(text,text,timestamptz,uuid)')
),
per_store as (
  select store_slug, count(*) filter (where lower(coalesce(status, '')) <> 'abandoned') as orders_n
    from public.orders
   group by store_slug
)
select 'H1' as grp, 'H1 get_store_orders_before exists' as check_name,
  case when exists (select 1 from fn) then 'PASS' else 'FAIL - function missing' end as result
union all
select 'H2', 'H2 VOLATILE, SECURITY DEFINER, search_path public, pg_temp, returns setof orders',
  case when (select vol = 'v' and prosecdef and cfg = 'search_path=public, pg_temp' and ret = 'SETOF orders' from fn)
       then 'PASS' else 'FAIL - ' || coalesce((select vol || ' ' || prosecdef || ' ' || cfg || ' ' || ret from fn), 'missing') end
union all
select 'H3', 'H3 the PIN check runs once, before any row (not inside a WHERE)',
  case when (select prosrc ilike '%if not public.verify_store_pin(p_slug, p_hashed_pin) then%'
                    and prosrc not ilike '%and public.verify_store_pin%'
                    and prosrc not ilike '%and verify_store_pin%' from fn)
       then 'PASS' else 'FAIL' end
union all
select 'H4', 'H4 pages are 500 rows, real orders only',
  case when (select prosrc ilike '%limit 500%' and prosrc ilike '%<> ''abandoned''%' from fn)
       then 'PASS' else 'FAIL' end
union all
select 'H5', 'H5 the browser can call it (anon EXECUTE)',
  case when has_function_privilege('anon', 'public.get_store_orders_before(text,text,timestamptz,uuid)', 'EXECUTE')
       then 'PASS' else 'FAIL' end
union all
select 'H6', 'H6 PUBLIC cannot call it',
  case when not exists (
         select 1 from fn, aclexplode((select proacl from pg_proc where oid = fn.oid)) a
          where a.grantee = 0 and a.privilege_type = 'EXECUTE')
       then 'PASS' else 'FAIL - PUBLIC has EXECUTE' end
union all
select 'H7', 'H7 get_store_orders is unchanged (still the separate-caps version)',
  case when (select md5(replace(prosrc, chr(13), '')) from pg_proc
              where oid = to_regprocedure('public.get_store_orders(text,text)')) = '412869d96684c8e66f2981e162005f4e'
       then 'PASS' else 'FAIL - get_store_orders was modified' end
union all
select 'I1', 'I1 stores with more than 500 real orders (now fully readable)',
  (select count(*)::text from per_store where orders_n > 500)
union all
select 'I2', 'I2 most real orders in one store',
  (select coalesce(max(orders_n), 0)::text from per_store);
