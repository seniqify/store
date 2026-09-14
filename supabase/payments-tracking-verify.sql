-- ===========================================================================
--  Payments section -- VERIFICATION
--
--  READ-ONLY. One single SELECT. Writes nothing. Safe on production before and
--  after applying payments-tracking.sql. Every row must read PASS afterwards,
--  except rows labelled (info).
-- ===========================================================================

with cols as (
  select column_name::text as col, data_type::text as typ
    from information_schema.columns
   where table_schema = 'public' and table_name = 'orders'
     and column_name in ('paid_at', 'paid_via', 'payment_link_id', 'payment_link_url',
                         'payment_link_created_at')
),
fn as (
  select p.oid, p.prosrc, p.prosecdef, p.provolatile::text as provolatile,
         coalesce(array_to_string(p.proconfig, ', '), '') as cfg,
         pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'set_order_paid'
)

select 'T1' as grp, 'T1.1 the five new order columns exist' as check_name,
  case when (select count(*) from cols) = 5 then 'PASS'
       else 'FAIL - found ' || (select count(*) from cols)::text || ' of 5' end as result
union all
select 'T1', 'T1.2 paid_at and payment_link_created_at are timestamptz',
  case when (select count(*) from cols
              where col in ('paid_at', 'payment_link_created_at')
                and typ = 'timestamp with time zone') = 2
       then 'PASS' else 'FAIL - wrong type or missing' end
union all
select 'T1', 'T1.3 paid_via only accepts razorpay, payment_link or seller',
  case when exists (select 1 from pg_constraint
                     where conrelid = 'public.orders'::regclass
                       and conname = 'orders_paid_via_known')
       then 'PASS' else 'FAIL - constraint missing' end

union all
select 'T2', 'T2.1 set_order_paid keeps its signature (one function, no overload)',
  case when (select count(*) from fn) = 1
        and (select args from fn) = 'p_slug text, p_hashed_pin text, p_order_id uuid, p_paid boolean'
       then 'PASS'
       else 'FAIL - ' || coalesce((select string_agg(args, ' | ') from fn), 'function missing') end
union all
select 'T2', 'T2.2 set_order_paid still goes through the PIN throttle',
  case when (select prosrc from fn) ilike '%public.verify_store_pin(p_slug, p_hashed_pin)%'
       then 'PASS' else 'FAIL - PIN check missing' end
union all
select 'T2', 'T2.3 set_order_paid records the payment time and source',
  case when (select prosrc from fn) ilike '%paid_at%coalesce(paid_at, now())%'
        and (select prosrc from fn) ilike '%coalesce(paid_via, ''seller'')%'
       then 'PASS' else 'FAIL - not applied yet' end
union all
select 'T2', 'T2.4 set_order_paid: SECURITY DEFINER, VOLATILE, search_path public, pg_temp',
  case when (select prosecdef from fn)
        and (select provolatile from fn) = 'v'
        and (select cfg from fn) = 'search_path=public, pg_temp'
       then 'PASS' else 'FAIL' end
union all
select 'T2', 'T2.5 (info) anon can execute set_order_paid, as the dashboard needs',
  case when has_function_privilege('anon', (select oid from fn), 'execute') then 'yes' else 'NO' end

union all
-- The new columns are reached only through query_to_xml, behind a check that
-- they exist: naming them directly would stop this file running before the
-- migration.
select 'T3', 'T3.1 (info) paid orders: total, with a recorded time, by source',
  case when (select count(*) from cols) < 5 then 'not applied yet'
       else (xpath('/row/v/text()', query_to_xml(
              'select (select count(*) from public.orders where paid)::text || '' paid, ''
                   || (select count(*) from public.orders where paid and paid_at is not null)::text
                   || '' with a time | ''
                   || coalesce((select string_agg(coalesce(paid_via, ''(none)'') || '' x '' || n::text, '', '')
                                  from (select paid_via, count(*) n from public.orders where paid group by 1) s), '''')
                   as v',
              false, true, '')))[1]::text end
union all
select 'T3', 'T3.2 (info) orders with a payment link',
  case when (select count(*) from cols) < 5 then 'not applied yet'
       else (xpath('/row/n/text()', query_to_xml(
              'select count(*) as n from public.orders where payment_link_id is not null',
              false, true, '')))[1]::text end

order by grp, check_name;
