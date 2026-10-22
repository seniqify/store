-- ===========================================================================
--  Abandoned carts, all time  --  UNDO
--
--  Drops public.get_store_abandoned_carts_since. A clean removal: the function
--  only reads, it writes nothing, and no data depends on it. Dropping it cannot
--  lose a row.
--
--  REVERT THE APP FIRST. Once the app that reads this function is deployed,
--  dropping it makes the Abandoned tab's "All time" and Customers -> Export CSV
--  say they could not load -- nothing else breaks. The database cannot see
--  which app build is deployed, so this file cannot check that for you.
--
--  It refuses if any database function has started calling it.
--
--  Nothing else is touched, because the forward touched nothing else:
--  get_store_abandoned_carts stays exactly as it is.
--
--  RUN: Supabase Dashboard -> SQL Editor -> paste -> Run. Idempotent.
--  VERIFY afterwards: supabase/abandoned-all-time-verify.sql (A1 reads
--  'FAIL - function missing', which is the expected state after an undo;
--  A5 still PASS).
-- ===========================================================================

begin;

do $guard$
declare
  v_fn      oid;
  v_callers text;
begin
  v_fn := to_regprocedure('public.get_store_abandoned_carts_since(text,text,timestamptz)');
  if v_fn is null then
    raise notice 'get_store_abandoned_carts_since does not exist - nothing to roll back';
    return;
  end if;

  select string_agg(n.nspname || '.' || p.proname, ', ' order by n.nspname, p.proname)
    into v_callers
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname not in ('pg_catalog', 'information_schema')
     and p.oid <> v_fn
     and p.prosrc ilike '%get_store_abandoned_carts_since%';

  if v_callers is not null then
    raise exception 'REFUSED - these functions call get_store_abandoned_carts_since: %', v_callers
      using hint = 'Repoint them first, on purpose.';
  end if;
end;
$guard$;

-- No CASCADE: if anything unexpected depends on it, stop and say so.
drop function if exists public.get_store_abandoned_carts_since(text, text, timestamptz);

commit;
