-- Verifier for abandoned-private-forward.sql. READ-ONLY: one SELECT.
-- After the forward: every P row PASS (I rows are information).

with expected(sig, md5) as (
  values ('public.get_store_orders(text,text)',                            'e6696b5b2ce92b3832a053fb90851758'),
         ('public.get_store_abandoned_carts(text,text)',                   '981b255474df48093560d8e17019787a'),
         ('public.get_store_abandoned_carts_since(text,text,timestamptz)', '1bc07513a01c452dacebc1d9f7c80640'),
         ('public.cart_reminder_statuses(text,text)',                      '843ec185703173bee7b9c3da203760f2')
),
fns as (
  select e.sig, e.md5 as want, p.oid, md5(replace(p.prosrc, chr(13), '')) as got, p.prosrc,
         p.prosecdef, coalesce(array_to_string(p.proconfig, ', '), '') as cfg
    from expected e left join pg_proc p on p.oid = to_regprocedure(e.sig)
)
select 'P1' as grp, 'P1 all four functions are the reviewed versions (md5)' as check_name,
  case when (select bool_and(got = want) from fns) then 'PASS'
       else 'FAIL - ' || (select string_agg(sig || ' md5 ' || coalesce(got, 'missing'), '; ') from fns where got is distinct from want) end as result
union all
select 'P2', 'P2 still SECURITY DEFINER with search_path public, pg_temp',
  case when (select bool_and(prosecdef and cfg = 'search_path=public, pg_temp') from fns) then 'PASS' else 'FAIL' end
union all
select 'P3', 'P3 the PIN check still runs first in every one',
  case when (select bool_and(prosrc ilike '%if not public.verify_store_pin(p_slug, p_hashed_pin) then%') from fns) then 'PASS' else 'FAIL' end
union all
select 'P4', 'P4 the browser can still call them (anon, authenticated) - grants are untouched',
  case when (select bool_and(has_function_privilege('anon', oid, 'EXECUTE')
                         and has_function_privilege('authenticated', oid, 'EXECUTE'))
               from fns) then 'PASS' else 'FAIL' end
union all
select 'I1', 'I1 abandoned checkouts the shops can no longer read numbers from (all stores, all time)',
  (select count(*)::text from public.orders where lower(coalesce(status, '')) = 'abandoned'
                                              and coalesce(customer_phone, '') <> '')
union all
select 'I2', 'I2 reminders sent in the last 30 days (still sent by PocketLink, number kept server-side)',
  (select count(*)::text from public.cart_reminders where created_at > now() - interval '30 days');
