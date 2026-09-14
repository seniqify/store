-- ===========================================================================
--  Automatic payment status -- VERIFICATION
--
--  READ-ONLY. One single SELECT. Writes nothing. Safe on production before and
--  after applying payments-automation.sql. After applying, every row must read
--  PASS except rows labelled (info).
-- ===========================================================================

with cols as (
  select column_name::text as col
    from information_schema.columns
   where table_schema = 'public' and table_name = 'orders'
     and column_name in ('shipment_outcome', 'delivered_at', 'returned_at')
),
outcome as (
  select to_regprocedure('public.shipment_outcome_of(text,text)') as fn
),
cases (status_text, order_status, expected) as (
  values ('Delivered', 'confirmed', 'delivered'),
         ('delivered', null, 'delivered'),
         ('Returned To Seller', 'confirmed', 'returned'),
         ('Returned To Client', null, 'returned'),
         ('In Transit for Return', null, 'returned'),
         ('In RTO/RTS Process', null, 'returned'),
         ('RTO', 'confirmed', 'returned'),
         ('RTO Delivered', 'delivered', 'returned'),
         ('rts_d', null, 'returned'),
         ('Lost', null, 'lost'),
         ('Out For Delivery', 'dispatched', null),
         ('Undelivered', null, null),
         ('Not Contactable', null, null),
         ('Bag In Transit', 'confirmed', null),
         ('Cancelled', 'cancelled', null),
         (null, 'delivered', 'delivered'),
         (null, 'confirmed', null)
)

select 'U1' as grp, 'U1.1 shipment_outcome, delivered_at, returned_at exist' as check_name,
  case when (select count(*) from cols) = 3 then 'PASS'
       else 'FAIL - found ' || (select count(*) from cols)::text || ' of 3' end as result
union all
select 'U1', 'U1.2 paid_via accepts cod_delivery',
  coalesce((select case when pg_get_constraintdef(oid) ilike '%cod_delivery%' then 'PASS'
                        else 'FAIL - constraint does not allow cod_delivery' end
              from pg_constraint
             where conrelid = 'public.orders'::regclass and conname = 'orders_paid_via_known'),
           'FAIL - constraint missing')

union all
select 'U2', 'U2.1 courier status texts read correctly (returned before delivered)',
  case when (select fn from outcome) is null then 'FAIL - not applied yet'
       else coalesce((xpath('/row/v/text()', query_to_xml(
              $q$
              select coalesce(string_agg(status_text || ' -> ' || coalesce(got, 'null'), '; '), 'PASS') as v
                from (select c.status_text, c.expected,
                             public.shipment_outcome_of(c.status_text, c.order_status) as got
                        from (values ('Delivered', 'confirmed', 'delivered'),
                                     ('delivered', null, 'delivered'),
                                     ('Returned To Seller', 'confirmed', 'returned'),
                                     ('Returned To Client', null, 'returned'),
                                     ('In Transit for Return', null, 'returned'),
                                     ('In RTO/RTS Process', null, 'returned'),
                                     ('RTO', 'confirmed', 'returned'),
                                     ('RTO Delivered', 'delivered', 'returned'),
                                     ('rts_d', null, 'returned'),
                                     ('Lost', null, 'lost'),
                                     ('Out For Delivery', 'dispatched', null),
                                     ('Undelivered', null, null),
                                     ('Not Contactable', null, null),
                                     ('Bag In Transit', 'confirmed', null),
                                     ('Cancelled', 'cancelled', null),
                                     (null, 'delivered', 'delivered'),
                                     (null, 'confirmed', null)) as c(status_text, order_status, expected)) t
               where got is distinct from expected
              $q$, false, true, '')))[1]::text, 'PASS') end
union all
select 'U2', 'U2.2 (info) cases checked',
  (select count(*)::text from cases)

union all
select 'U3', 'U3.1 the automation trigger is on orders and enabled',
  case when exists (select 1 from pg_trigger
                     where tgrelid = 'public.orders'::regclass and not tgisinternal
                       and tgname = 'orders_payment_automation' and tgenabled <> 'D')
       then 'PASS' else 'FAIL - trigger missing or disabled' end
union all
select 'U3', 'U3.2 it fires before insert and before status / shipment_status updates',
  coalesce((select case when pg_get_triggerdef(t.oid) ilike '%BEFORE INSERT OR UPDATE OF status, shipment_status%'
                        then 'PASS' else 'FAIL - ' || pg_get_triggerdef(t.oid) end
              from pg_trigger t
             where t.tgrelid = 'public.orders'::regclass and t.tgname = 'orders_payment_automation'),
           'FAIL - not applied yet')
union all
select 'U3', 'U3.3 checkout (anon) can still write orders: outcome reader is executable',
  case when (select fn from outcome) is null then 'FAIL - not applied yet'
       when has_function_privilege('anon', (select fn from outcome), 'execute') then 'PASS'
       else 'FAIL - anon cannot run shipment_outcome_of; checkout inserts would fail' end
union all
select 'U3', 'U3.4 the trigger function pins search_path public, pg_temp',
  coalesce((select case when coalesce(array_to_string(p.proconfig, ', '), '') = 'search_path=public, pg_temp'
                        then 'PASS' else 'FAIL' end
              from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = 'orders_payment_automation'),
           'FAIL - not applied yet')

union all
select 'U4', 'U4.1 the sweep secret exists and no client role can read it',
  case when to_regclass('public.automation_secrets') is null then 'FAIL - not applied yet'
       when has_table_privilege('anon', 'public.automation_secrets', 'select')
         or has_table_privilege('authenticated', 'public.automation_secrets', 'select')
       then 'FAIL - a client role can read the secret'
       when (xpath('/row/n/text()', query_to_xml(
              'select count(*) as n from public.automation_secrets where name = ''status-sweep'' and length(secret) >= 48',
              false, true, '')))[1]::text = '1'
       then 'PASS' else 'FAIL - secret missing' end
union all
select 'U4', 'U4.2 (info) scheduled status sweep',
  case when to_regclass('cron.job') is null then 'pg_cron not installed'
       else coalesce((xpath('/row/v/text()', query_to_xml(
              'select string_agg(jobname || '' · '' || schedule || case when active then '''' else '' (paused)'' end, '' | '') as v
                 from cron.job where jobname = ''pocketlink-status-sweep''',
              false, true, '')))[1]::text, 'not scheduled yet (run payments-automation-schedule.sql)') end

union all
select 'U5', 'U5.1 (info) COD orders now: collected automatically · still to collect · returned or lost',
  case when (select count(*) from cols) < 3 then 'not applied yet'
       else (xpath('/row/v/text()', query_to_xml(
              'select (select count(*) from public.orders where paid_via = ''cod_delivery'')::text || '' · ''
                   || (select count(*) from public.orders
                        where lower(coalesce(payment_method, '''')) = ''cod'' and not coalesce(paid, false)
                          and coalesce(status, '''') not in (''cancelled'', ''abandoned'')
                          and shipment_outcome is null)::text || '' · ''
                   || (select count(*) from public.orders
                        where lower(coalesce(payment_method, '''')) = ''cod''
                          and shipment_outcome in (''returned'', ''lost''))::text as v',
              false, true, '')))[1]::text end

order by grp, check_name;
