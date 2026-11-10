-- Verifier for delivery-tools-forward.sql. READ-ONLY: one SELECT.
-- After the forward: every C row PASS.

with server_only(sig) as (
  values ('public.ship_update_event(text)'),
         ('public.ship_update_price_paise()'),
         ('public.ship_updates_due(integer,timestamp with time zone)'),
         ('public.ship_update_claim(uuid,text)'),
         ('public.ship_update_finish(uuid,boolean,integer,text)'),
         ('public.ship_updates_expire_stuck()')
),
browser(sig) as (
  values ('public.set_ship_updates(text,text,boolean,text[])'),
         ('public.get_ship_updates(text,text)'),
         ('public.get_cod_remittance(text,text)'),
         ('public.mark_cod_remitted(text,text,uuid[],boolean)'),
         ('public.set_delivery_choice(uuid,text,text)'),
         ('public.get_delivery_choice(uuid)'),
         ('public.seller_prepay_discount(text,text,uuid,numeric)')
),
pin_checked(sig) as (
  values ('public.set_ship_updates(text,text,boolean,text[])'),
         ('public.get_ship_updates(text,text)'),
         ('public.get_cod_remittance(text,text)'),
         ('public.mark_cod_remitted(text,text,uuid[],boolean)'),
         ('public.seller_prepay_discount(text,text,uuid,numeric)')
)
select 'C1' as grp, 'C1 shipping_messages exists with row level security, closed to the browser' as check_name,
  case when exists (select 1 from pg_class c where c.oid = to_regclass('public.shipping_messages') and c.relrowsecurity)
        and not exists (select 1 from unnest(array['anon', 'authenticated']) r, unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) p
                         where has_table_privilege(r, 'public.shipping_messages', p))
       then 'PASS' else 'FAIL' end as result
union all
select 'C2', 'C2 the sweep functions are service_role only',
  case when (select count(*) from server_only where to_regprocedure(sig) is not null) = 6
        and not exists (select 1 from server_only, unnest(array['anon', 'authenticated']) r
                         where has_function_privilege(r, to_regprocedure(sig), 'EXECUTE'))
       then 'PASS' else 'FAIL' end
union all
select 'C3', 'C3 the shop and buyer functions are callable from the browser',
  case when (select count(*) from browser where has_function_privilege('anon', to_regprocedure(sig), 'EXECUTE')) = 7
       then 'PASS' else 'FAIL' end
union all
select 'C4', 'C4 every shop function checks the PIN first',
  case when (select count(*) from pg_proc p join pin_checked k on p.oid = to_regprocedure(k.sig)
              where p.prosrc ilike '%not public.verify_store_pin(p_slug, p_hashed_pin)%') = 5
       then 'PASS' else 'FAIL' end
union all
select 'C5', 'C5 every security definer function pins search_path public, pg_temp',
  case when not exists (select 1 from pg_proc p
                         where p.oid in (select to_regprocedure(sig) from server_only union all select to_regprocedure(sig) from browser)
                           and p.prosecdef and array_to_string(p.proconfig, ',') <> 'search_path=public, pg_temp')
       then 'PASS' else 'FAIL' end
union all
select 'C6', 'C6 the new order columns exist',
  case when (select count(*) from information_schema.columns
              where table_schema = 'public' and table_name = 'orders'
                and column_name in ('cod_remitted_at', 'delivery_choice', 'delivery_choice_at', 'delivery_choice_address',
                                    'delivery_choice_sent_at', 'prepay_discount')) = 6
       then 'PASS' else 'FAIL' end
union all
select 'C7', 'C7 the status reading matches the app on known statuses',
  case when public.ship_update_event('Delivered') = 'delivered'
        and public.ship_update_event('RTO Delivered') is null
        and public.ship_update_event('Not Delivered') = 'failed'
        and public.ship_update_event('Out For Delivery') = 'ofd'
        and public.ship_update_event('Dispatched') = 'ofd'
        and public.ship_update_event('In Transit') = 'shipped'
        and public.ship_update_event('Manifested') is null
        and public.ship_update_event('Cancelled') is null
       then 'PASS' else 'FAIL' end
union all
select 'C8', 'C8 the ship-updates secret exists',
  case when exists (select 1 from public.automation_secrets where name = 'ship-updates') then 'PASS' else 'FAIL' end;
