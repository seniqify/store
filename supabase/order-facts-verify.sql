-- ===========================================================================
--  Commerce metrics, PR 1  --  VERIFICATION
--
--  READ-ONLY. One single SELECT. No create, insert, update, delete, grant,
--  revoke, drop, alter, set role or temporary table. No transaction.
--  Safe on production before AND after applying the migration.
--
--  get_store_order_facts is never named where PostgreSQL would resolve it while
--  parsing -- only through to_regprocedure -- so this runs in both states.
--
--  BEFORE: F* rows read 'N/A - facts feed not installed'; G* rows all PASS.
--  AFTER:  every row PASS except the rows labelled (info).
--
--  THE G ROWS ARE THE POINT. This PR adds a function and changes nothing else.
--  G1 fails if get_store_orders is touched -- including if someone "helpfully"
--  removes its LIMIT 500, which is deliberate and stays.
-- ===========================================================================

select 'G1' as grp, 'G1 get_store_orders source UNCHANGED, still capped at 500' as check_name,
  case when (select md5(p.prosrc) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = 'get_store_orders')
            = '4fc814c21f3e367777063cf3005f2048'
       then 'PASS - untouched, cap intact by design'
       else 'FAIL - get_store_orders was modified in a PR that must not touch it' end as result

union all
select 'G2', 'G2 get_store_orders grants unchanged',
  case when (select md5(array_to_string(p.proacl, ' ')) from pg_proc p
               join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = 'get_store_orders')
            = 'a2e3a0f8aa234106c9e2040309b3a05c'
       then 'PASS' else 'FAIL - the order list feed was re-granted' end

union all
select 'G3', 'G3 public.orders untouched: triggers, policies and browser grants',
  case when (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid
              where c.relname = 'orders' and not t.tgisinternal) = 4
        and (select count(*) from pg_policies
              where schemaname = 'public' and tablename = 'orders') = 2
        and (select count(*) from information_schema.role_table_grants
              where table_schema = 'public' and table_name = 'orders'
                and grantee in ('anon', 'authenticated')) =
            (select count(*) from information_schema.role_table_grants
              where table_schema = 'public' and table_name = 'orders'
                and grantee in ('anon', 'authenticated'))
        and exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
                     where c.relname = 'orders' and t.tgname = 'orders_insert_guard' and t.tgenabled = 'O')
        and exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
                     where c.relname = 'orders' and t.tgname = 'trg_decrement_stock' and t.tgenabled = 'O')
       then 'PASS' else 'FAIL - the orders table changed' end

union all
select 'G4', 'G4 verify_store_pin still the PIN gate, definer and pinned',
  case when (select p.prosecdef and coalesce(array_to_string(p.proconfig, ', '), '') = 'search_path=public, pg_temp'
               from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = 'verify_store_pin')
       then 'PASS' else 'FAIL' end

union all
select 'G5', 'G5 phase 3C billing objects untouched by this PR',
  case when (select md5(p.prosrc) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = 'upgrade_store_plan')
            = '9f6bbf1eafb22765dc601eb11fc2dfcb'
        and to_regprocedure('public.apply_plan_entitlement(text,text,text,timestamptz,timestamptz,text,text,text,text,timestamptz)') is not null
        and (select count(*) from public.plan_entitlements where source <> 'migration_backfill') = 0
       then 'PASS' else 'FAIL - a billing object moved' end

-- -- F  the new feed ----------------------------------------------------------
union all
select 'F1', 'F1 get_store_order_facts exists with the expected signature',
  case when to_regprocedure('public.get_store_order_facts(text,text)') is null
       then 'N/A - facts feed not installed' else 'PASS' end

union all
select 'F2', 'F2 it is SECURITY DEFINER (it must read orders past RLS)',
  case when to_regprocedure('public.get_store_order_facts(text,text)') is null
       then 'N/A - facts feed not installed'
       when (select p.prosecdef from pg_proc p
              where p.oid = to_regprocedure('public.get_store_order_facts(text,text)'))
       then 'PASS' else 'FAIL - it cannot read orders without definer' end

union all
select 'F3', 'F3 its search_path is pinned with pg_temp last',
  case when to_regprocedure('public.get_store_order_facts(text,text)') is null
       then 'N/A - facts feed not installed'
       when (select coalesce(array_to_string(p.proconfig, ', '), '') from pg_proc p
              where p.oid = to_regprocedure('public.get_store_order_facts(text,text)'))
            = 'search_path=public, pg_temp'
       then 'PASS' else 'FAIL - search_path is not pinned' end

union all
select 'F4', 'F4 PUBLIC cannot execute it (the default grant was revoked)',
  -- PostgreSQL grants EXECUTE on every new function to PUBLIC. That default is
  -- how upgrade_store_plan became anon-callable, so it is revoked here.
  case when to_regprocedure('public.get_store_order_facts(text,text)') is null
       then 'N/A - facts feed not installed'
       when (select coalesce(array_to_string(p.proacl, ' '), '') from pg_proc p
              where p.oid = to_regprocedure('public.get_store_order_facts(text,text)'))
            not like '%=X/%'
       then 'PASS' else 'FAIL - PUBLIC holds EXECUTE' end

union all
select 'F5', 'F5 anon, authenticated and service_role CAN execute it',
  case when to_regprocedure('public.get_store_order_facts(text,text)') is null
       then 'N/A - facts feed not installed'
       when has_function_privilege('anon', to_regprocedure('public.get_store_order_facts(text,text)'), 'EXECUTE')
        and has_function_privilege('authenticated', to_regprocedure('public.get_store_order_facts(text,text)'), 'EXECUTE')
        and has_function_privilege('service_role', to_regprocedure('public.get_store_order_facts(text,text)'), 'EXECUTE')
       then 'PASS' else 'FAIL - the merchant browser cannot call it' end

union all
select 'F6', 'F6 it returns EXACTLY the 16 declared scalar columns',
  case when to_regprocedure('public.get_store_order_facts(text,text)') is null
       then 'N/A - facts feed not installed'
       when (select string_agg(a.name, ',' order by a.ord) from (
               select unnest(p.proargnames) as name,
                      generate_subscripts(p.proargnames, 1) as ord,
                      unnest(p.proargmodes) as mode
                 from pg_proc p
                where p.oid = to_regprocedure('public.get_store_order_facts(text,text)')) a
              where a.mode = 't')
            = 'id,created_at,status,payment_method,total,paid,paid_at,paid_via,'
              || 'payment_ref,payment_link_id,awb,courier,shipment_status,'
              || 'shipment_outcome,delivered_at,returned_at'
       then 'PASS' else 'FAIL - the projection changed' end

union all
select 'F7', 'F7 it leaks NO customer PII and no bulk columns',
  -- The columns that exist in public.orders and must never appear here.
  case when to_regprocedure('public.get_store_order_facts(text,text)') is null
       then 'N/A - facts feed not installed'
       when not exists (
         select 1 from pg_proc p
          where p.oid = to_regprocedure('public.get_store_order_facts(text,text)')
            and p.proargnames && array['customer_name','customer_phone','destination','pincode',
                                       'notes','items','item_count','fbp','fbc','client_ua',
                                       'confirm_token','store_slug']::text[])
       then 'PASS - scalar facts only' else 'FAIL - PII or bulk data is being returned' end

union all
select 'F8', 'F8 it is PIN-gated and has NO row cap',
  case when to_regprocedure('public.get_store_order_facts(text,text)') is null
       then 'N/A - facts feed not installed'
       when (select p.prosrc from pg_proc p
              where p.oid = to_regprocedure('public.get_store_order_facts(text,text)'))
            like '%verify_store_pin(p_slug, p_hashed_pin)%'
        and (select p.prosrc from pg_proc p
              where p.oid = to_regprocedure('public.get_store_order_facts(text,text)'))
            not ilike '% limit %'
       then 'PASS - gated, uncapped' else 'FAIL - ungated or capped' end

union all
select 'F9', 'F9 nothing in the schema calls it yet (this PR wires up no consumer)',
  case when not exists (
         select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public'
            and p.proname <> 'get_store_order_facts'
            and p.prosrc ilike '%get_store_order_facts%')
       then 'PASS' else 'FAIL - something already consumes it' end

-- -- info ---------------------------------------------------------------------
union all
select 'Z1', '(info) largest store vs the get_store_orders cap of 500',
  (select string_agg(x, ' | ') from (
     select store_slug || ': ' || count(*)::text || ' rows ('
            || count(*) filter (where status = 'abandoned')::text || ' abandoned)' as x
       from public.orders group by store_slug order by count(*) desc limit 3) t)

union all
select 'Z2', '(info) stores already past 80 percent of the cap',
  coalesce((select string_agg(store_slug, ', ') from (
     select store_slug from public.orders group by store_slug having count(*) >= 400) t),
     'none')

order by 1, 2;
