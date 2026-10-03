-- Rollback for orders-separate-caps-forward.sql: restore the PIN-bypass-closure
-- version of public.get_store_orders exactly (newest 500 rows of every kind).
--
-- Preflight: the function must be the separate-caps version, or already the
-- previous one (so running this twice is harmless). Anything else stops here.

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
  if v_md5 not in ('412869d96684c8e66f2981e162005f4e',   -- separate caps
                   '8aa6bbfaee3ccfa85e3871bd3d61b8aa') then  -- already rolled back
    raise exception 'preflight: public.get_store_orders is neither the separate-caps nor the previous version (md5 %) -- nothing changed', v_md5;
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
  return query
    select o.* from public.orders o
    where o.store_slug = p_slug
    order by o.created_at desc
    limit 500;
end;
$function$;

commit;
