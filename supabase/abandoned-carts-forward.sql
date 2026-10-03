-- ===========================================================================
--  Abandoned carts, one number everywhere  --  get_store_abandoned_carts
--
--  2026-10-04, krupaagarbattiwork: Home said "406 abandoned carts" and the
--  Abandoned tab said 50. Both were "right", and neither was the number a
--  shopkeeper means:
--
--    Home  counted every abandoned ROW in the last 30 days, from the uncapped
--          facts feed. The checkout records one row per phone per day, so a
--          customer who came back on five days was five carts -- and a
--          customer who went on to order was still counted.
--    Tab   took the capped get_store_orders list, dropped customers who later
--          ordered, then cut the result to the first 50.
--
--  This function is the ONE definition both screens now read:
--
--    an abandoned cart = a CUSTOMER (one phone number) who reached checkout in
--    the last 30 days and has not placed an order since their latest attempt.
--
--    * window   30 merchant civil days ending today, today included: from
--               00:00 IST 29 days ago. The same window Home always used.
--    * one row  per phone: the customer's LATEST attempt in the window (its
--               cart, name and time), plus `attempts`, how many days they
--               reached checkout in the window.
--    * not yet  ordered: no row for the same store and phone that is not
--               abandoned (any status, any case -- the app's classifyOrder
--               rule, and the Abandoned tab's rule since it shipped), created
--               at or after that latest attempt.
--    * no phone a row with no phone number cannot be won back, so it is not
--               listed. The checkout only records one once ten digits are in,
--               so in practice there are none.
--
--  NO ROW LIMIT. The window bounds it: at most one row per customer who reached
--  checkout in 30 days. A cap here would bring back exactly the silent "50".
--
--  THIS MIGRATION CHANGES NOTHING THAT EXISTS. It adds one read-only function.
--  get_store_orders, get_store_order_facts, public.orders and its triggers,
--  policies and grants are not touched.
--
--  RUN: Supabase Dashboard -> SQL Editor -> paste -> Run. Idempotent.
--  VERIFY afterwards: supabase/abandoned-carts-verify.sql (every C row PASS)
--  UNDO: supabase/abandoned-carts-ROLLBACK.sql
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Preflight. Stops with nothing changed if anything is not as reviewed.
-- ---------------------------------------------------------------------------
do $preflight$
declare
  v_md5 text;
begin
  if to_regprocedure('public.verify_store_pin(text,text)') is null then
    raise exception 'preflight: public.verify_store_pin(text,text) is missing - nothing changed';
  end if;

  if (select count(*) from information_schema.columns
       where table_schema = 'public' and table_name = 'orders'
         and column_name in ('id', 'store_slug', 'status', 'created_at', 'customer_name',
                             'customer_phone', 'items', 'total')) <> 8 then
    raise exception 'preflight: public.orders is missing a column this function reads - nothing changed';
  end if;

  -- Not installed yet, or exactly this version (a harmless re-run). Anything
  -- else is somebody else's function and is not overwritten.
  select md5(replace(p.prosrc, chr(13), '')) into v_md5
    from pg_proc p
   where p.oid = to_regprocedure('public.get_store_abandoned_carts(text,text)');
  if v_md5 is not null and v_md5 <> 'c25c35db957bfbe7ad90abc9eea938dd' then
    raise exception 'preflight: a different get_store_abandoned_carts already exists (md5 %) - nothing changed', v_md5;
  end if;
end;
$preflight$;

-- ---------------------------------------------------------------------------
-- 2. The function
--
-- RETURNS TABLE with an explicit column list, like get_store_order_facts, so
-- the projection is part of the signature: the screens need the customer's
-- name, phone and cart to send the WhatsApp nudge, and nothing else. No
-- address, notes, ad identifiers or confirm token.
--
-- The PIN check runs once, before any row, exactly as in get_store_orders: a
-- wrong PIN returns an empty set, never an error, so nothing leaks about
-- whether the store exists. Every column reference is qualified, because the
-- RETURNS TABLE names are plpgsql variables in this scope.
-- ---------------------------------------------------------------------------
create or replace function public.get_store_abandoned_carts(p_slug text, p_hashed_pin text)
returns table (
  id              uuid,
  created_at      timestamptz,
  customer_name   text,
  customer_phone  text,
  items           jsonb,
  total           numeric,
  attempts        integer
)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
declare
  -- 00:00 IST, 29 days ago: 30 merchant civil days ending today, today included.
  v_since timestamptz :=
    (date_trunc('day', now() at time zone 'Asia/Kolkata') - interval '29 days') at time zone 'Asia/Kolkata';
begin
  if not public.verify_store_pin(p_slug, p_hashed_pin) then
    return;
  end if;

  return query
    with tries as (
      select a.id, a.created_at, a.customer_name, a.customer_phone, a.items, a.total,
             row_number() over (partition by a.customer_phone
                                order by a.created_at desc, a.id desc) as rn,
             count(*) over (partition by a.customer_phone) as n
        from public.orders a
       where a.store_slug = p_slug
         and lower(coalesce(a.status, '')) = 'abandoned'
         and a.created_at >= v_since
         and coalesce(a.customer_phone, '') <> ''
    )
    select t.id, t.created_at, t.customer_name::text, t.customer_phone::text,
           to_jsonb(t.items), t.total::numeric, t.n::integer
      from tries t
     where t.rn = 1
       and not exists (
         select 1
           from public.orders r
          where r.store_slug = p_slug
            and r.customer_phone = t.customer_phone
            and lower(coalesce(r.status, '')) <> 'abandoned'
            and r.created_at >= t.created_at)
     order by t.created_at desc, t.id desc;
end;
$function$;

comment on function public.get_store_abandoned_carts(text, text) is
  'PIN-checked: one row per customer (phone) who reached checkout in the last 30 IST days and has not ordered since. Feeds Manage Home and the Abandoned tab.';

-- ---------------------------------------------------------------------------
-- 3. Who may call it: the browser, as anon or authenticated, proving itself
-- with the store PIN -- the same boundary as get_store_orders. PUBLIC's
-- automatic EXECUTE is revoked so nothing is granted by accident.
-- ---------------------------------------------------------------------------
revoke all on function public.get_store_abandoned_carts(text, text) from public;

grant execute on function public.get_store_abandoned_carts(text, text)
  to anon, authenticated, service_role;

commit;
