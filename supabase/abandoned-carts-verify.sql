-- Verifier for abandoned-carts-forward.sql. READ-ONLY: one SELECT.
-- After the forward: every C row PASS (I rows are information).

with fn as (
  select p.oid, md5(replace(p.prosrc, chr(13), '')) as md5, p.prosrc, p.provolatile::text as vol, p.prosecdef,
         coalesce(array_to_string(p.proconfig, ', '), '') as cfg, pg_get_function_result(p.oid) as ret, p.proacl
    from pg_proc p
   where p.oid = to_regprocedure('public.get_store_abandoned_carts(text,text)')
),
-- The function's own rule, restated for the information rows below.
since as (
  select (date_trunc('day', now() at time zone 'Asia/Kolkata') - interval '29 days') at time zone 'Asia/Kolkata' as t
),
tries as (
  select a.store_slug, a.customer_phone, max(a.created_at) as latest, count(*) as n
    from public.orders a, since
   where lower(coalesce(a.status, '')) = 'abandoned'
     and a.created_at >= since.t
     and coalesce(a.customer_phone, '') <> ''
   group by a.store_slug, a.customer_phone
),
per_store as (
  select t.store_slug,
         sum(t.n) as attempts,
         count(*) as customers,
         count(*) filter (where not exists (
           select 1 from public.orders r
            where r.store_slug = t.store_slug and r.customer_phone = t.customer_phone
              and lower(coalesce(r.status, '')) <> 'abandoned'
              and r.created_at >= t.latest)) as to_win_back
    from tries t
   group by t.store_slug
)
select 'C1' as grp, 'C1 get_store_abandoned_carts is the reviewed version (md5)' as check_name,
  case when (select md5 from fn) = 'c25c35db957bfbe7ad90abc9eea938dd' then 'PASS'
       else 'FAIL - ' || coalesce('md5 ' || (select md5 from fn), 'function missing') end as result
union all
select 'C2', 'C2 VOLATILE, SECURITY DEFINER, search_path public, pg_temp, returns the 7 declared columns',
  case when (select vol = 'v' and prosecdef and cfg = 'search_path=public, pg_temp'
                    and ret = 'TABLE(id uuid, created_at timestamp with time zone, customer_name text, customer_phone text, items jsonb, total numeric, attempts integer)'
               from fn)
       then 'PASS' else 'FAIL - ' || coalesce((select vol || ' ' || prosecdef || ' ' || cfg || ' ' || ret from fn), 'missing') end
union all
select 'C3', 'C3 the PIN check runs once, before any row (not inside a WHERE)',
  case when (select prosrc ilike '%if not public.verify_store_pin(p_slug, p_hashed_pin) then%'
                    and prosrc not ilike '%and public.verify_store_pin%'
                    and prosrc not ilike '%and verify_store_pin%' from fn)
       then 'PASS' else 'FAIL' end
union all
select 'C4', 'C4 the browser can call it (anon, authenticated); PUBLIC cannot',
  case when (select oid from fn) is not null
        and has_function_privilege('anon', 'public.get_store_abandoned_carts(text,text)', 'EXECUTE')
        and has_function_privilege('authenticated', 'public.get_store_abandoned_carts(text,text)', 'EXECUTE')
        and not exists (select 1 from fn, aclexplode(fn.proacl) x where x.grantee = 0 and x.privilege_type = 'EXECUTE')
       then 'PASS' else 'FAIL' end
union all
select 'I1', 'I1 the store with the most abandoned checkouts in 30 days: checkouts / customers / still to win back',
  coalesce((select store_slug || ': ' || attempts || ' / ' || customers || ' / ' || to_win_back
              from per_store order by attempts desc, store_slug limit 1), 'none')
union all
select 'I2', 'I2 krupaagarbattiwork: checkouts / customers / still to win back',
  coalesce((select attempts || ' / ' || customers || ' / ' || to_win_back
              from per_store where store_slug = 'krupaagarbattiwork'), 'none in 30 days');
