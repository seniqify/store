-- ===========================================================================
--  Commerce metrics, PR 2  --  UNDO
--
--  Removes the trigger and its function.
--
--  THIS CANNOT LOSE DATA. The guard only ever ADDS a paid_at that a writer left
--  empty, on a false -> true transition. It never overwrites, never clears and
--  never touches a historical row. Dropping it stops future stamping; it does
--  not un-stamp anything already recorded, and the 84 legacy rows are exactly
--  as untouched afterwards as they were before.
--
--  What comes back if you run it: an unpaid -> paid transition by a writer that
--  forgets paid_at would once again leave the payment time unknown. Every
--  current writer stamps it, so today that is a latent risk rather than an
--  active one -- which is why this is a backstop.
--
--  What this file does NOT touch, because PR 2 never touched them:
--    set_order_paid, orders_payment_automation, shipment_outcome_of,
--    get_store_order_facts, get_store_orders, public.orders rows, policies,
--    grants, the other four order triggers, and everything in phases 1, 2 and 3C.
--
--  RUN: Supabase Dashboard -> SQL Editor -> paste -> Run. Idempotent.
--  VERIFY afterwards: supabase/paid-at-guard-verify.sql
--          (T1..T5 and H2 return to 'N/A - guard not installed';
--           H1, W1..W4 and B1..B4 must read exactly what they read before.)
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Refuse if anything else has come to depend on the function
--
-- The catalog records a dependency for the trigger itself, which is expected
-- and is dropped with it. Anything ELSE -- a second trigger, another function
-- calling it -- means someone built on top of this guard, and dropping it
-- underneath them should be a decision rather than a side effect.
-- ---------------------------------------------------------------------------
do $guard$
declare
  v_fn       oid;
  v_triggers text;
  v_callers  text;
begin
  v_fn := to_regprocedure('public.orders_payment_time_guard()');
  if v_fn is null then
    raise notice 'orders_payment_time_guard does not exist - nothing to roll back';
    return;
  end if;

  select string_agg(c.relname || '.' || t.tgname, ', ' order by c.relname, t.tgname)
    into v_triggers
    from pg_trigger t join pg_class c on c.oid = t.tgrelid
   where t.tgfoid = v_fn and not t.tgisinternal
     and not (c.relname = 'orders' and t.tgname = 'orders_payment_time_guard');

  if v_triggers is not null then
    raise exception using
      errcode = 'raise_exception',
      message = format('REFUSED - other triggers use this function: %s', v_triggers),
      hint    = 'Drop them first, on purpose.';
  end if;

  -- plpgsql bodies are opaque to pg_depend, so this is a text scan across every
  -- schema. A false positive refuses, which is the safe direction.
  select string_agg(n.nspname || '.' || p.proname, ', ' order by n.nspname, p.proname)
    into v_callers
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname not in ('pg_catalog', 'information_schema')
     and p.oid <> v_fn
     and p.prosrc ilike '%orders_payment_time_guard%';

  if v_callers is not null then
    raise exception using
      errcode = 'raise_exception',
      message = format('REFUSED - these functions reference the guard: %s', v_callers),
      hint    = 'Repoint them first, on purpose.';
  end if;

  raise notice 'guard has no other dependants - safe to remove';
end;
$guard$;

-- ---------------------------------------------------------------------------
-- 2. Remove the trigger, then the function
--
-- No CASCADE. The trigger is dropped explicitly first so the function drop has
-- nothing left depending on it; if something unexpected still does, PostgreSQL
-- must stop and say so rather than removing it too.
--
-- NO UPDATE STATEMENT. Undoing the guard does not and must not revisit any row.
-- ---------------------------------------------------------------------------
drop trigger if exists orders_payment_time_guard on public.orders;

drop function if exists public.orders_payment_time_guard();

commit;

-- ===========================================================================
--  The 84 legacy rows still read paid_at = NULL, every recorded paid_at is
--  still exactly what it was, and the other four triggers on public.orders are
--  untouched. PR 2 added one trigger and one function, and this removed them.
-- ===========================================================================
