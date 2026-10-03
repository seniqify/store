-- Orders list: separate caps for real orders and abandoned checkouts.
--
-- get_store_orders returned the newest 500 rows of EVERY kind -- abandoned
-- checkouts included -- and Manage then hid the abandoned ones. On a busy store
-- (krupaagarbattiwork, 2026-10-03) abandoned checkouts filled most of those 500
-- rows, so real orders older than about ten days were never loaded: the Orders,
-- Customers, Delivery and Payments lists could not show them. No data was lost:
-- the uncapped get_store_order_facts still counted every one.
--
-- Now: the newest 500 real orders (every status except 'abandoned', any case --
-- exactly the app's classifyOrder) PLUS the newest 300 abandoned checkouts,
-- newest first. An abandoned checkout can never push a real order out.
--
-- Unchanged: the signature and return type, the PIN check (once, before any
-- row, as the PIN-bypass closure requires), VOLATILE, SECURITY DEFINER, the
-- search_path, owner and grants (CREATE OR REPLACE keeps them). No table,
-- index, row or other function is touched.
--
-- Preflight: the function must be the live PIN-bypass-closure version, or
-- already this one (so running this twice is harmless). Anything else stops
-- here, unchanged.
--
-- Run ONCE in the Supabase SQL editor, then orders-separate-caps-verify.sql.
-- Undo: orders-separate-caps-ROLLBACK.sql.

begin;

do $pre$
declare
  v_md5 text;
begin
  select md5(replace(p.prosrc, chr(13), '')) into v_md5
    from pg_proc p
   where p.oid = to_regprocedure('public.get_store_orders(text,text)');
  if v_md5 is null then
    raise exception 'preflight: public.get_store_orders(text,text) does not exist -- nothing changed';
  end if;
  if v_md5 not in ('8aa6bbfaee3ccfa85e3871bd3d61b8aa',   -- pin-bypass-closure-forward.sql (live)
                   '412869d96684c8e66f2981e162005f4e') then  -- this version (re-run)
    raise exception 'preflight: public.get_store_orders is not the reviewed version (md5 %) -- nothing changed', v_md5;
  end if;
end
$pre$;

create or replace function public.get_store_orders(p_slug text, p_hashed_pin text)
returns setof public.orders
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
begin
  if not public.verify_store_pin(p_slug, p_hashed_pin) then
    return;                       -- empty set, exactly as before
  end if;
  -- Two separate caps: an abandoned checkout can never push a real order out.
  return query
    select u.* from (
      (select o.* from public.orders o
        where o.store_slug = p_slug
          and lower(coalesce(o.status, '')) <> 'abandoned'
        order by o.created_at desc
        limit 500)
      union all
      (select o.* from public.orders o
        where o.store_slug = p_slug
          and lower(coalesce(o.status, '')) = 'abandoned'
        order by o.created_at desc
        limit 300)
    ) u
    order by u.created_at desc;
end;
$function$;

commit;
