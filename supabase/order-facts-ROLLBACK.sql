-- ===========================================================================
--  Commerce metrics, PR 1  --  UNDO
--
--  Drops public.get_store_order_facts.
--
--  This is a clean removal: the function reads and returns, it writes nothing,
--  and no data anywhere depends on it. Dropping it cannot lose a row.
--
--  It is safe while nothing consumes it, which is the state PR 1 leaves the
--  product in. Once PRs 4-8 point the screens at it, dropping it breaks the
--  Manage dashboard's metrics -- so the guard below refuses if anything in the
--  database has started calling it, and the header tells you the client side is
--  yours to check.
--
--  BEFORE RUNNING, once any screen has been migrated: confirm no deployed
--  client build calls get_store_order_facts. The database cannot see that, so
--  this file cannot check it for you.
--
--  What this file does NOT touch, because PR 1 never touched them:
--    get_store_orders (still capped at 500), public.orders and its triggers,
--    policies and grants, verify_store_pin, and everything in phase 3C.
--
--  RUN: Supabase Dashboard -> SQL Editor -> paste -> Run. Idempotent.
--  VERIFY afterwards: supabase/order-facts-verify.sql
--          (F1..F8 return to 'N/A - facts feed not installed';
--           G1..G5 must read exactly what they read before PR 1.)
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Refuse if anything in the database has started calling it
--
-- The catalog records a dependency only for SQL functions with a BEGIN ATOMIC
-- body; a plpgsql body is opaque to it. So this is both checks: pg_depend for
-- what the catalog knows, and a text scan across every schema for what it
-- cannot see. A false positive refuses, which is the safe direction.
-- ---------------------------------------------------------------------------
do $guard$
declare
  v_fn      oid;
  v_callers text;
  v_depends text;
begin
  v_fn := to_regprocedure('public.get_store_order_facts(text,text)');
  if v_fn is null then
    raise notice 'get_store_order_facts does not exist - nothing to roll back';
    return;
  end if;

  select string_agg(n.nspname || '.' || p.proname, ', ' order by n.nspname, p.proname)
    into v_callers
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname not in ('pg_catalog', 'information_schema')
     and p.oid <> v_fn
     and p.prosrc ilike '%get_store_order_facts%';

  if v_callers is not null then
    raise exception using
      errcode = 'raise_exception',
      message = format('REFUSED - these functions call the facts feed: %s', v_callers),
      hint    = 'Repoint them first, on purpose.';
  end if;

  select string_agg(distinct d.classid::regclass::text, ', ') into v_depends
    from pg_depend d
   where d.refclassid = 'pg_proc'::regclass
     and d.refobjid = v_fn
     and d.deptype = 'n';

  if v_depends is not null then
    raise exception using
      errcode = 'raise_exception',
      message = format('REFUSED - these object kinds depend on the facts feed: %s', v_depends),
      hint    = 'Drop them first, on purpose.';
  end if;

  raise notice 'facts feed has no database callers - safe to drop';
end;
$guard$;

-- ---------------------------------------------------------------------------
-- 2. Drop it
--
-- No CASCADE. If something unexpected depends on it, PostgreSQL must stop and
-- say so rather than quietly removing that too.
-- ---------------------------------------------------------------------------
drop function if exists public.get_store_order_facts(text, text);

commit;

-- ===========================================================================
--  Nothing else is reverted, because nothing else was changed. In particular
--  get_store_orders still carries its LIMIT 500, which is deliberate and is
--  what PR 1 worked around rather than altered.
-- ===========================================================================
