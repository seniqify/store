-- ===========================================================================
--  Hisaab: the shop's own expenses and monthly sales goal  --  UNDO
--
--  Drops the five hisaab functions. The two tables are dropped ONLY when they
--  are empty: an expense or a goal a shop typed in is theirs, and an undo must
--  not throw it away. A table with rows is kept, locked as before (no browser
--  access), and a NOTICE says so; drop it by hand, on purpose, if ever needed.
--
--  REVERT THE APP FIRST: the Hisaab tab calls these functions and would say
--  it could not load the book.
--
--  It refuses if any other database function has started calling one of them.
--
--  RUN: Supabase Dashboard -> SQL Editor -> paste -> Run. Idempotent.
--  VERIFY afterwards: supabase/hisaab-verify.sql (H1 reads 'FAIL - ... missing',
--  the expected state after an undo).
-- ===========================================================================

begin;

do $guard$
declare
  v_callers text;
begin
  select string_agg(n.nspname || '.' || p.proname, ', ' order by n.nspname, p.proname)
    into v_callers
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname not in ('pg_catalog', 'information_schema')
     and p.proname not in ('get_store_hisaab', 'add_store_expense', 'delete_store_expense',
                           'stop_store_expense', 'set_store_sales_goal')
     and (p.prosrc ilike '%get_store_hisaab%' or p.prosrc ilike '%add_store_expense%'
          or p.prosrc ilike '%delete_store_expense%' or p.prosrc ilike '%stop_store_expense%'
          or p.prosrc ilike '%set_store_sales_goal%' or p.prosrc ilike '%store_expenses%'
          or p.prosrc ilike '%store_sales_goals%');
  if v_callers is not null then
    raise exception 'REFUSED - these functions use the hisaab functions or tables: %', v_callers
      using hint = 'Repoint them first, on purpose.';
  end if;
end;
$guard$;

drop function if exists public.get_store_hisaab(text, text);
drop function if exists public.add_store_expense(text, text, date, numeric, text, text, text, boolean);
drop function if exists public.delete_store_expense(text, text, uuid);
drop function if exists public.stop_store_expense(text, text, uuid, date);
drop function if exists public.set_store_sales_goal(text, text, date, numeric);

do $tables$
begin
  if to_regclass('public.store_expenses') is not null then
    if exists (select 1 from public.store_expenses) then
      raise notice 'store_expenses has rows - KEPT (shops typed them in)';
    else
      drop table public.store_expenses;
    end if;
  end if;
  if to_regclass('public.store_sales_goals') is not null then
    if exists (select 1 from public.store_sales_goals) then
      raise notice 'store_sales_goals has rows - KEPT (shops typed them in)';
    else
      drop table public.store_sales_goals;
    end if;
  end if;
end;
$tables$;

commit;
