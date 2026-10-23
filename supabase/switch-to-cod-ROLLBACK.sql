-- ===========================================================================
--  Switch an unpaid online order to cash on delivery  --  UNDO
--
--  Drops public.switch_order_to_cod. Orders it already switched stay cash on
--  delivery: they were changed with the shop's agreement and are real orders
--  now; this does not guess which ones to change back.
--
--  REVERT THE APP FIRST: the Payments screen's "Switch to COD" button calls
--  this function and would say it could not switch the order.
--
--  It refuses if any database function has started calling it.
--
--  RUN: Supabase Dashboard -> SQL Editor -> paste -> Run. Idempotent.
--  VERIFY afterwards: supabase/switch-to-cod-verify.sql (S1 reads
--  'FAIL - function missing', the expected state after an undo).
-- ===========================================================================

begin;

do $guard$
declare
  v_fn      oid;
  v_callers text;
begin
  v_fn := to_regprocedure('public.switch_order_to_cod(text,text,uuid)');
  if v_fn is null then
    raise notice 'switch_order_to_cod does not exist - nothing to roll back';
    return;
  end if;
  select string_agg(n.nspname || '.' || p.proname, ', ' order by n.nspname, p.proname)
    into v_callers
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname not in ('pg_catalog', 'information_schema')
     and p.oid <> v_fn
     and p.prosrc ilike '%switch_order_to_cod%';
  if v_callers is not null then
    raise exception 'REFUSED - these functions call switch_order_to_cod: %', v_callers
      using hint = 'Repoint them first, on purpose.';
  end if;
end;
$guard$;

drop function if exists public.switch_order_to_cod(text, text, uuid);

commit;
