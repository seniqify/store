-- Orders history: let Manage read EVERY order, not just the newest 500.
--
-- get_store_orders returns the newest 500 real orders (plus the newest 300
-- abandoned checkouts). A store past 500 orders could not open anything older:
-- the Orders, Customers, Delivery, Payments and Stats lists simply stopped.
-- Merchants need their past orders (2026-10-22).
--
-- Adds ONE function, get_store_orders_before: the next page of real orders
-- older than a cursor, 500 at a time, newest first. Manage reads the first page
-- from get_store_orders exactly as today and then pages back with this until
-- the store's oldest order. Pages keep each request small, so a store with
-- thousands of orders never asks for one huge response.
--
--   p_before_at  created_at of the oldest row already loaded
--   p_before_id  its id -- or NULL for the first step back from
--                get_store_orders, which orders by created_at alone: the step
--                is then INCLUSIVE of p_before_at, so no row that shares the
--                boundary timestamp can be skipped (the client drops the
--                duplicates by id). Every later step is strictly older on
--                (created_at, id).
--
-- Abandoned checkouts are not paged: they have their own uncapped feed
-- (get_store_abandoned_carts) and their own tab.
--
-- Unchanged: get_store_orders (still the newest 500 + 300, same md5), every
-- other function, public.orders, its rows, triggers, policies and grants.
--
-- Same boundary as get_store_orders: PIN-checked once, before any row, through
-- verify_store_pin (a wrong PIN gives an empty set, never an error; a correct
-- PIN is never recorded, so paging costs the merchant nothing from the attempt
-- budget). VOLATILE, SECURITY DEFINER, pinned search_path. PUBLIC is revoked
-- and the browser roles are granted explicitly.
--
-- Run ONCE in the Supabase SQL editor, then orders-history-verify.sql.
-- Idempotent: running it twice is harmless.
-- Undo: orders-history-ROLLBACK.sql.

begin;

do $pre$
begin
  if to_regprocedure('public.get_store_orders(text,text)') is null then
    raise exception 'preflight: public.get_store_orders(text,text) does not exist -- nothing changed';
  end if;
  if to_regprocedure('public.verify_store_pin(text,text)') is null then
    raise exception 'preflight: public.verify_store_pin(text,text) does not exist -- nothing changed';
  end if;
end
$pre$;

create or replace function public.get_store_orders_before(
  p_slug       text,
  p_hashed_pin text,
  p_before_at  timestamptz,
  p_before_id  uuid
)
returns setof public.orders
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
begin
  if not public.verify_store_pin(p_slug, p_hashed_pin) then
    return;                       -- empty set, exactly like get_store_orders
  end if;
  if p_before_at is null then
    return;                       -- a cursor is required
  end if;
  return query
    select o.* from public.orders o
     where o.store_slug = p_slug
       and lower(coalesce(o.status, '')) <> 'abandoned'
       and (o.created_at < p_before_at
            or (o.created_at = p_before_at and (p_before_id is null or o.id < p_before_id)))
     order by o.created_at desc, o.id desc
     limit 500;
end;
$function$;

comment on function public.get_store_orders_before(text, text, timestamptz, uuid) is
  'PIN-checked next page (500) of a store''s real orders older than a (created_at, id) cursor, newest first. Lets Manage read past the newest 500 that get_store_orders returns.';

revoke all on function public.get_store_orders_before(text, text, timestamptz, uuid) from public;
grant execute on function public.get_store_orders_before(text, text, timestamptz, uuid)
  to anon, authenticated, service_role;

commit;
