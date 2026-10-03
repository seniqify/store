-- Verifier for orders-separate-caps-forward.sql. READ-ONLY: one SELECT.
-- After the forward: every row PASS (I-rows are information).

with fn as (
  select p.oid, md5(replace(p.prosrc, chr(13), '')) as md5, p.prosrc, p.provolatile::text as vol, p.prosecdef,
         coalesce(array_to_string(p.proconfig, ', '), '') as cfg, pg_get_function_result(p.oid) as ret
    from pg_proc p
   where p.oid = to_regprocedure('public.get_store_orders(text,text)')
),
per_store as (
  select store_slug,
         count(*) filter (where lower(coalesce(status, '')) <> 'abandoned') as orders_n,
         count(*) filter (where lower(coalesce(status, '')) = 'abandoned')  as abandoned_n
    from public.orders
   group by store_slug
)
select 'C1' as grp, 'C1 get_store_orders is the separate-caps version (md5)' as check_name,
  case when (select md5 from fn) = '412869d96684c8e66f2981e162005f4e' then 'PASS'
       else 'FAIL - md5 ' || coalesce((select md5 from fn), 'function missing') end as result
union all
select 'C2', 'C2 still VOLATILE, SECURITY DEFINER, search_path public, pg_temp, returns setof orders',
  case when (select vol = 'v' and prosecdef and cfg = 'search_path=public, pg_temp' and ret = 'SETOF orders' from fn)
       then 'PASS' else 'FAIL - ' || coalesce((select vol || ' ' || prosecdef || ' ' || cfg || ' ' || ret from fn), 'missing') end
union all
select 'C3', 'C3 the PIN check runs once, before any row (not inside a WHERE)',
  case when (select prosrc ilike '%if not public.verify_store_pin(p_slug, p_hashed_pin) then%'
                    and prosrc not ilike '%and public.verify_store_pin%'
                    and prosrc not ilike '%and verify_store_pin%' from fn)
       then 'PASS' else 'FAIL' end
union all
select 'C4', 'C4 the browser can still call it (anon EXECUTE, as before)',
  case when has_function_privilege('anon', 'public.get_store_orders(text,text)', 'EXECUTE') then 'PASS' else 'FAIL' end
union all
select 'I1', 'I1 stores with more than 500 real orders (their oldest are still beyond the list)',
  (select count(*)::text from per_store where orders_n > 500)
union all
select 'I2', 'I2 most real orders / abandoned checkouts in one store',
  (select coalesce(max(orders_n), 0)::text || ' / ' || coalesce(max(abandoned_n), 0)::text from per_store);
