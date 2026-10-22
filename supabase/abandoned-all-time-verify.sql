-- Verifier for abandoned-all-time-forward.sql. READ-ONLY: one SELECT.
-- After the forward: every A row PASS (I rows are information).

with fn as (
  select p.oid, md5(replace(p.prosrc, chr(13), '')) as md5, p.prosrc, p.provolatile::text as vol, p.prosecdef,
         coalesce(array_to_string(p.proconfig, ', '), '') as cfg, pg_get_function_result(p.oid) as ret, p.proacl
    from pg_proc p
   where p.oid = to_regprocedure('public.get_store_abandoned_carts_since(text,text,timestamptz)')
),
old_fn as (
  select md5(replace(p.prosrc, chr(13), '')) as md5
    from pg_proc p
   where p.oid = to_regprocedure('public.get_store_abandoned_carts(text,text)')
),
-- The function's own rule, restated for the information rows below:
-- each customer's latest abandoned checkout, all time, not ordered since.
latest as (
  select a.store_slug, a.customer_phone, max(a.created_at) as at
    from public.orders a
   where lower(coalesce(a.status, '')) = 'abandoned'
     and coalesce(a.customer_phone, '') <> ''
   group by a.store_slug, a.customer_phone
),
win_back as (
  select l.store_slug,
         count(*) as all_time,
         count(*) filter (where l.at >= (date_trunc('day', now() at time zone 'Asia/Kolkata')
                                         - interval '29 days') at time zone 'Asia/Kolkata') as last_30
    from latest l
   where not exists (
     select 1 from public.orders r
      where r.store_slug = l.store_slug and r.customer_phone = l.customer_phone
        and lower(coalesce(r.status, '')) <> 'abandoned'
        and r.created_at >= l.at)
   group by l.store_slug
)
select 'A1' as grp, 'A1 get_store_abandoned_carts_since is the reviewed version (md5)' as check_name,
  case when (select md5 from fn) = 'c148f70a88bca87773d1b0986556bf4b' then 'PASS'
       else 'FAIL - ' || coalesce('md5 ' || (select md5 from fn), 'function missing') end as result
union all
select 'A2', 'A2 VOLATILE, SECURITY DEFINER, search_path public, pg_temp, returns the 8 declared columns',
  case when (select vol = 'v' and prosecdef and cfg = 'search_path=public, pg_temp'
                    and ret = 'TABLE(id uuid, created_at timestamp with time zone, customer_name text, customer_phone text, items jsonb, total numeric, attempts integer, destination text)'
               from fn)
       then 'PASS' else 'FAIL - ' || coalesce((select vol || ' ' || prosecdef || ' ' || cfg || ' ' || ret from fn), 'missing') end
union all
select 'A3', 'A3 the PIN check runs once, before any row (not inside a WHERE)',
  case when (select prosrc ilike '%if not public.verify_store_pin(p_slug, p_hashed_pin) then%'
                    and prosrc not ilike '%and public.verify_store_pin%'
                    and prosrc not ilike '%and verify_store_pin%' from fn)
       then 'PASS' else 'FAIL' end
union all
select 'A4', 'A4 the browser can call it (anon, authenticated); PUBLIC cannot',
  case when (select oid from fn) is not null
        and has_function_privilege('anon', 'public.get_store_abandoned_carts_since(text,text,timestamptz)', 'EXECUTE')
        and has_function_privilege('authenticated', 'public.get_store_abandoned_carts_since(text,text,timestamptz)', 'EXECUTE')
        and not exists (select 1 from fn, aclexplode(fn.proacl) x where x.grantee = 0 and x.privilege_type = 'EXECUTE')
       then 'PASS' else 'FAIL' end
union all
select 'A5', 'A5 get_store_abandoned_carts (Home, "Last 30 days") is unchanged',
  case when (select md5 from old_fn) = 'c25c35db957bfbe7ad90abc9eea938dd' then 'PASS'
       else 'FAIL - ' || coalesce('md5 ' || (select md5 from old_fn), 'function missing') end
union all
select 'I1', 'I1 the store with the most customers to win back, all time / last 30 days',
  coalesce((select store_slug || ': ' || all_time || ' / ' || last_30
              from win_back order by all_time desc, store_slug limit 1), 'none')
union all
select 'I2', 'I2 krupaagarbattiwork: customers to win back, all time / last 30 days',
  coalesce((select all_time || ' / ' || last_30
              from win_back where store_slug = 'krupaagarbattiwork'), 'none');
