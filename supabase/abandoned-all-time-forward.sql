-- ===========================================================================
--  Abandoned carts, all time  --  FORWARD
--
--  2026-10-22, founder: "remove the cap from everywhere - stats, orders and
--  abandoned". Orders and Stats already read every order (orders-history,
--  get_store_orders_before). Two abandoned-cart limits were left:
--
--    * the Abandoned tab lists only the last 30 days
--      (get_store_abandoned_carts, the same number as Home's row), and
--    * Customers -> Export CSV took its abandoned-cart leads from
--      get_store_orders, which carries only the newest 300 abandoned
--      checkouts -- a busy shop's export lost every lead older than ~3 weeks.
--
--  Adds ONE read-only function, get_store_abandoned_carts_since: the SAME rule
--  as get_store_abandoned_carts -- one row per customer (phone), their latest
--  cart, and a customer who has ordered since that cart is not listed -- over
--  a window the caller picks:
--
--    p_since  NULL = all time; otherwise only checkouts at or after it.
--
--  It also returns `destination` (what the customer typed as their address at
--  checkout, often empty), so the CSV export keeps its Area column for
--  abandoned-only leads. Nothing new is exposed: get_store_orders already
--  returns that column, to the same PIN.
--
--  NO ROW LIMIT, like get_store_abandoned_carts. At most one row per customer
--  who ever reached checkout; a cap here would bring back the silent cut-off.
--
--  THIS MIGRATION CHANGES NOTHING THAT EXISTS. get_store_abandoned_carts (Home
--  and the tab's default "Last 30 days"), get_store_orders, public.orders and
--  its triggers, policies and grants are not touched.
--
--  RUN: Supabase Dashboard -> SQL Editor -> paste -> Run. Idempotent.
--  VERIFY afterwards: supabase/abandoned-all-time-verify.sql (every A row PASS)
--  UNDO: supabase/abandoned-all-time-ROLLBACK.sql
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
                             'customer_phone', 'items', 'total', 'destination')) <> 9 then
    raise exception 'preflight: public.orders is missing a column this function reads - nothing changed';
  end if;

  -- Not installed yet, or exactly this version (a harmless re-run). Anything
  -- else is somebody else's function and is not overwritten.
  select md5(replace(p.prosrc, chr(13), '')) into v_md5
    from pg_proc p
   where p.oid = to_regprocedure('public.get_store_abandoned_carts_since(text,text,timestamptz)');
  if v_md5 is not null and v_md5 <> 'c148f70a88bca87773d1b0986556bf4b' then
    raise exception 'preflight: a different get_store_abandoned_carts_since already exists (md5 %) - nothing changed', v_md5;
  end if;
end;
$preflight$;

-- ---------------------------------------------------------------------------
-- 2. The function
--
-- The body is get_store_abandoned_carts' with its fixed 30-day v_since
-- replaced by p_since (NULL = no lower bound), plus the destination column.
-- Keep the two rules identical: with p_since = the 30-day boundary this
-- returns exactly get_store_abandoned_carts' rows (the tests check that).
--
-- The PIN check runs once, before any row, exactly as in get_store_orders: a
-- wrong PIN returns an empty set, never an error. Every column reference is
-- qualified, because the RETURNS TABLE names are plpgsql variables here.
-- ---------------------------------------------------------------------------
create or replace function public.get_store_abandoned_carts_since(
  p_slug       text,
  p_hashed_pin text,
  p_since      timestamptz
)
returns table (
  id              uuid,
  created_at      timestamptz,
  customer_name   text,
  customer_phone  text,
  items           jsonb,
  total           numeric,
  attempts        integer,
  destination     text
)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
begin
  if not public.verify_store_pin(p_slug, p_hashed_pin) then
    return;
  end if;

  return query
    with tries as (
      select a.id, a.created_at, a.customer_name, a.customer_phone, a.items, a.total, a.destination,
             row_number() over (partition by a.customer_phone
                                order by a.created_at desc, a.id desc) as rn,
             count(*) over (partition by a.customer_phone) as n
        from public.orders a
       where a.store_slug = p_slug
         and lower(coalesce(a.status, '')) = 'abandoned'
         and (p_since is null or a.created_at >= p_since)
         and coalesce(a.customer_phone, '') <> ''
    )
    select t.id, t.created_at, t.customer_name::text, t.customer_phone::text,
           to_jsonb(t.items), t.total::numeric, t.n::integer, t.destination::text
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

comment on function public.get_store_abandoned_carts_since(text, text, timestamptz) is
  'PIN-checked: one row per customer (phone) who reached checkout at or after p_since (NULL = all time) and has not ordered since. Feeds the Abandoned tab''s "All time" and the Customers CSV export.';

-- ---------------------------------------------------------------------------
-- 3. Who may call it: the browser, as anon or authenticated, proving itself
-- with the store PIN -- the same boundary as get_store_abandoned_carts.
-- PUBLIC's automatic EXECUTE is revoked so nothing is granted by accident.
-- ---------------------------------------------------------------------------
revoke all on function public.get_store_abandoned_carts_since(text, text, timestamptz) from public;

grant execute on function public.get_store_abandoned_carts_since(text, text, timestamptz)
  to anon, authenticated, service_role;

commit;
