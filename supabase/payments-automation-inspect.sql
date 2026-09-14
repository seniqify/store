-- ===========================================================================
--  Automatic payment status -- READ-ONLY INSPECTION (run BEFORE building it)
--
--  One single SELECT. Writes nothing. Safe on production.
--
--  Why: COD should turn "collected" by itself when the courier (or the seller's
--  own delivery) marks it delivered, and "returned" when it comes back. That
--  rule must match the courier status texts your orders REALLY hold, and it
--  should run on a schedule so nobody has to open Manage for it to happen.
-- ===========================================================================

select 'A1' as grp, 'A1 courier status texts on orders (courier · status x count)' as item,
  coalesce((select string_agg(k || ' x ' || n::text, ' | ' order by n desc)
              from (select coalesce(nullif(courier, ''), '(none)') || ' · ' || coalesce(shipment_status, '(empty)') as k,
                           count(*) as n
                      from public.orders
                     where awb is not null or shipment_status is not null
                     group by 1) s), 'none') as value
union all
select 'A2', 'A2 order status values (status x count)',
  (select string_agg(k || ' x ' || n::text, ' | ' order by n desc)
     from (select coalesce(status, '(null)') as k, count(*) as n from public.orders group by 1) s)
union all
select 'A3', 'A3 COD orders not marked paid: total · status delivered · courier says delivered · courier says return/RTO',
  (select count(*)::text || ' (Rs ' || coalesce(round(sum(total))::text, '0') || ') · '
       || count(*) filter (where status = 'delivered')::text || ' · '
       || count(*) filter (where shipment_status ~* '\mdelivered\M')::text || ' · '
       || count(*) filter (where shipment_status ~* 'rto|rts|return')::text
     from public.orders
    where lower(coalesce(payment_method, '')) = 'cod' and not coalesce(paid, false)
      and coalesce(status, '') not in ('cancelled', 'abandoned'))
union all
select 'A4', 'A4 COD orders already marked paid',
  (select count(*)::text from public.orders
    where lower(coalesce(payment_method, '')) = 'cod' and coalesce(paid, false))
union all
select 'A5', 'A5 scheduler extensions installed (pg_cron · pg_net)',
  'pg_cron=' || exists (select 1 from pg_extension where extname = 'pg_cron')::text ||
  ' · pg_net=' || exists (select 1 from pg_extension where extname = 'pg_net')::text
union all
select 'A6', 'A6 scheduled jobs that already exist (name · schedule)',
  case when to_regclass('cron.job') is null then 'pg_cron not installed'
       else coalesce((xpath('/row/v/text()', query_to_xml(
              'select string_agg(jobname || '' · '' || schedule, '' | '') as v from cron.job',
              false, true, '')))[1]::text, 'none') end
union all
select 'A7', 'A7 stores with a courier connected (provider · stores)',
  case when to_regclass('public.store_shipping_accounts') is null then 'table missing'
       else coalesce((xpath('/row/v/text()', query_to_xml(
              'select string_agg(provider || '' · '' || n::text, '' | '') as v
                 from (select provider, count(distinct store_slug) n
                         from public.store_shipping_accounts where status = ''connected'' group by 1) s',
              false, true, '')))[1]::text, 'none') end
union all
select 'A8', 'A8 stores with Razorpay connected',
  case when to_regclass('public.store_payment_accounts') is null then 'table missing'
       else (xpath('/row/n/text()', query_to_xml(
              'select count(*) as n from public.store_payment_accounts where status = ''connected''',
              false, true, '')))[1]::text end

order by 1;
