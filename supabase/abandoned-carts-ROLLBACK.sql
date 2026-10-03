-- ===========================================================================
--  Abandoned carts, one number everywhere  --  UNDO
--
--  Drops public.get_store_abandoned_carts. A clean removal: the function only
--  reads, it writes nothing, and no data depends on it. Dropping it cannot lose
--  a row.
--
--  REVERT THE APP FIRST. Once the app that reads this function is deployed,
--  dropping it makes Manage Home leave out its abandoned-carts row and the
--  Abandoned tab show "couldn't load" -- nothing breaks, but both go quiet. The
--  database cannot see which app build is deployed, so this file cannot check
--  that for you.
--
--  It refuses if any database function has started calling it.
--
--  Nothing else is touched, because the forward touched nothing else.
--
--  RUN: Supabase Dashboard -> SQL Editor -> paste -> Run. Idempotent.
--  VERIFY afterwards: supabase/abandoned-carts-verify.sql (C1 reads
--  'FAIL - function missing', which is the expected state after an undo).
-- ===========================================================================

begin;

do $guard$
declare
  v_fn      oid;
  v_callers text;
begin
  v_fn := to_regprocedure('public.get_store_abandoned_carts(text,text)');
  if v_fn is null then
    raise notice 'get_store_abandoned_carts does not exist - nothing to roll back';
    return;
  end if;

  select string_agg(n.nspname || '.' || p.proname, ', ' order by n.nspname, p.proname)
    into v_callers
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname not in ('pg_catalog', 'information_schema')
     and p.oid <> v_fn
     and p.prosrc ilike '%get_store_abandoned_carts%';

  if v_callers is not null then
    raise exception 'REFUSED - these functions call get_store_abandoned_carts: %', v_callers
      using hint = 'Repoint them first, on purpose.';
  end if;
end;
$guard$;

-- No CASCADE: if anything unexpected depends on it, stop and say so.
drop function if exists public.get_store_abandoned_carts(text, text);

commit;
