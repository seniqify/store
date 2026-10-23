-- Verifier for hisaab-forward.sql. READ-ONLY: one SELECT.
-- After the forward: every H row PASS (I rows are information).

with fns as (
  select t.sig, t.want, p.oid, md5(replace(p.prosrc, chr(13), '')) as md5, p.prosrc,
         p.provolatile::text as vol, p.prosecdef,
         coalesce(array_to_string(p.proconfig, ', '), '') as cfg, p.proacl
    from (values
      -- md5:get_store_hisaab
      ('public.get_store_hisaab(text,text)',                                      '91082b923f5bc7c4c352589f719c4d5d'),
      -- md5:add_store_expense
      ('public.add_store_expense(text,text,date,numeric,text,text,text,boolean)', 'b6ec422e03b5767da74a25c5c2d5e559'),
      -- md5:delete_store_expense
      ('public.delete_store_expense(text,text,uuid)',                             '6bf0d262af9b2f33e8f8bb94002285c4'),
      -- md5:stop_store_expense
      ('public.stop_store_expense(text,text,uuid,date)',                          '4377f639092f641481cc29dc3dc413dd'),
      -- md5:set_store_sales_goal
      ('public.set_store_sales_goal(text,text,date,numeric)',                     'a2ebe8fd23668e0f5d59730a594521bb')
    ) as t(sig, want)
    left join pg_proc p on p.oid = to_regprocedure(t.sig)
)
select 'H1' as grp, 'H1 all five functions are the reviewed versions (md5)' as check_name,
  case when (select count(*) from fns where md5 = want) = 5 then 'PASS'
       else 'FAIL - ' || (select string_agg(sig || ' ' || coalesce('md5 ' || md5, 'missing'), '; ')
                            from fns where md5 is distinct from want) end as result
union all
select 'H2', 'H2 each is VOLATILE, SECURITY DEFINER, search_path public, pg_temp',
  case when (select bool_and(vol = 'v' and prosecdef and cfg = 'search_path=public, pg_temp') from fns where oid is not null)
        and (select count(*) from fns where oid is not null) = 5
       then 'PASS' else 'FAIL' end
union all
select 'H3', 'H3 each checks the PIN first',
  case when (select count(*) from fns where prosrc ilike '%if not public.verify_store_pin(p_slug, p_hashed_pin) then%') = 5
       then 'PASS' else 'FAIL' end
union all
select 'H4', 'H4 the browser can call them (anon, authenticated); PUBLIC cannot',
  case when (select count(*) from fns where oid is not null
               and has_function_privilege('anon', oid, 'EXECUTE')
               and has_function_privilege('authenticated', oid, 'EXECUTE')
               and not exists (select 1 from aclexplode(fns.proacl) x where x.grantee = 0 and x.privilege_type = 'EXECUTE')) = 5
       then 'PASS' else 'FAIL' end
union all
select 'H5', 'H5 both tables exist with row level security on',
  case when (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
              where n.nspname = 'public' and c.relname in ('store_expenses', 'store_sales_goals')
                and c.relrowsecurity) = 2
       then 'PASS' else 'FAIL' end
union all
select 'H6', 'H6 the browser roles cannot read or write either table directly',
  case when to_regclass('public.store_expenses') is not null and to_regclass('public.store_sales_goals') is not null
        and not has_table_privilege('anon', 'public.store_expenses', 'SELECT,INSERT,UPDATE,DELETE')
        and not has_table_privilege('authenticated', 'public.store_expenses', 'SELECT,INSERT,UPDATE,DELETE')
        and not has_table_privilege('anon', 'public.store_sales_goals', 'SELECT,INSERT,UPDATE,DELETE')
        and not has_table_privilege('authenticated', 'public.store_sales_goals', 'SELECT,INSERT,UPDATE,DELETE')
        and not exists (select 1 from pg_policies where schemaname = 'public'
                          and tablename in ('store_expenses', 'store_sales_goals'))
       then 'PASS' else 'FAIL' end
union all
select 'I1', 'I1 expenses saved (all stores)',
  case when to_regclass('public.store_expenses') is null then 'table missing'
       else (xpath('/row/n/text()', query_to_xml('select count(*) as n from public.store_expenses', false, false, '')))[1]::text end
union all
select 'I2', 'I2 stores with a sales goal',
  case when to_regclass('public.store_sales_goals') is null then 'table missing'
       else (xpath('/row/n/text()', query_to_xml('select count(distinct store_slug) as n from public.store_sales_goals', false, false, '')))[1]::text end;
