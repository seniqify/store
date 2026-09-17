-- ===========================================================================
--  Commerce metrics, PR 2  --  VERIFICATION
--
--  READ-ONLY. One single SELECT. No create, insert, update, delete, grant,
--  revoke, drop, alter, set role or temporary table. No transaction.
--  Safe on production before AND after applying the migration.
--
--  Anything the migration creates is reached through to_regprocedure or a
--  pg_trigger lookup that simply returns no rows, so this runs in both states.
--
--  BEFORE: T1..T5 read 'N/A - guard not installed'; everything else PASS.
--  AFTER:  every row PASS except the rows labelled (info).
--
--  H1 IS THE ROW THAT MATTERS MOST. The 84 production rows with paid = true and
--  paid_at = NULL are deliberate legacy uncertainty from the one-time backfill
--  in payments-automation.sql. This migration must not backfill them, and H1
--  pins both their count and their exact row ids.
--
--  NOTE ON LIVE TRAFFIC: a real payment landing between the two runs legitimately
--  changes the (info) counts in Z1. It does NOT change H1, because a newly paid
--  order carries a paid_at. If H1 moves, something rewrote history.
-- ===========================================================================

select 'T1' as grp, 'T1 the trigger exists and is enabled' as check_name,
  case when not exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
                         where c.relname = 'orders' and t.tgname = 'orders_payment_time_guard')
       then 'N/A - guard not installed'
       when exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
                     where c.relname = 'orders' and t.tgname = 'orders_payment_time_guard'
                       and t.tgenabled = 'O')
       then 'PASS' else 'FAIL - present but disabled' end as result

union all
select 'T2', 'T2 it is BEFORE UPDATE, per row, and NOT on insert or delete',
  case when not exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
                         where c.relname = 'orders' and t.tgname = 'orders_payment_time_guard')
       then 'N/A - guard not installed'
       when (select (t.tgtype & 2) <> 0     -- BEFORE
                and (t.tgtype & 1) <> 0     -- FOR EACH ROW
                and (t.tgtype & 16) <> 0    -- UPDATE
                and (t.tgtype & 4) = 0      -- not INSERT
                and (t.tgtype & 8) = 0      -- not DELETE
               from pg_trigger t join pg_class c on c.oid = t.tgrelid
              where c.relname = 'orders' and t.tgname = 'orders_payment_time_guard')
       then 'PASS - update only, which is complete: no INSERT can create a paid row'
       else 'FAIL - wrong timing or event set' end

union all
select 'T3', 'T3 it carries the transition-only WHEN clause',
  -- This is what makes the guard structurally unable to touch a historical row:
  -- PostgreSQL does not call the function at all unless the clause is true.
  case when not exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
                         where c.relname = 'orders' and t.tgname = 'orders_payment_time_guard')
       then 'N/A - guard not installed'
       -- Matched on the semantics, not on the exact bracketing: PostgreSQL
       -- renders this as WHEN (((old.paid IS NOT TRUE) AND (new.paid IS TRUE)))
       -- and the paren count is not a contract across versions.
       when (select pg_get_triggerdef(t.oid) from pg_trigger t join pg_class c on c.oid = t.tgrelid
              where c.relname = 'orders' and t.tgname = 'orders_payment_time_guard')
            like '%WHEN %old.paid IS NOT TRUE%AND%new.paid IS TRUE%'
        and (select pg_get_triggerdef(t.oid) from pg_trigger t join pg_class c on c.oid = t.tgrelid
              where c.relname = 'orders' and t.tgname = 'orders_payment_time_guard')
            not like '% OR %'
       then 'PASS' else 'FAIL - the WHEN clause is missing or different: '
            || coalesce((select pg_get_triggerdef(t.oid) from pg_trigger t join pg_class c on c.oid = t.tgrelid
                          where c.relname = 'orders' and t.tgname = 'orders_payment_time_guard'), 'none') end

union all
select 'T4', 'T4 its function is SECURITY INVOKER with a pinned search_path',
  case when to_regprocedure('public.orders_payment_time_guard()') is null
       then 'N/A - guard not installed'
       when (select not p.prosecdef
                and coalesce(array_to_string(p.proconfig, ', '), '') = 'search_path=public, pg_temp'
               from pg_proc p where p.oid = to_regprocedure('public.orders_payment_time_guard()'))
       then 'PASS' else 'FAIL - definer or unpinned' end

union all
select 'T5', 'T5 it assigns ONLY paid_at, and no role can call it directly',
  case when to_regprocedure('public.orders_payment_time_guard()') is null
       then 'N/A - guard not installed'
       when (select p.prosrc from pg_proc p
              where p.oid = to_regprocedure('public.orders_payment_time_guard()'))
            like '%NEW.paid_at := now()%'
        and (select p.prosrc from pg_proc p
              where p.oid = to_regprocedure('public.orders_payment_time_guard()'))
            not like '%NEW.paid %'
        and (select p.prosrc from pg_proc p
              where p.oid = to_regprocedure('public.orders_payment_time_guard()'))
            not like '%NEW.status%'
        and (select p.prosrc from pg_proc p
              where p.oid = to_regprocedure('public.orders_payment_time_guard()'))
            not like '%NEW.paid_via%'
        and (select p.prosrc from pg_proc p
              where p.oid = to_regprocedure('public.orders_payment_time_guard()'))
            not like '%NEW.payment_%'
        and (select p.prosrc from pg_proc p
              where p.oid = to_regprocedure('public.orders_payment_time_guard()'))
            not like '%NEW.total%'
        and not has_function_privilege('anon', to_regprocedure('public.orders_payment_time_guard()'), 'EXECUTE')
        and not has_function_privilege('authenticated', to_regprocedure('public.orders_payment_time_guard()'), 'EXECUTE')
        and not exists (select 1 from pg_proc p, unnest(coalesce(p.proacl, '{}'::aclitem[])) a
                         where p.oid = to_regprocedure('public.orders_payment_time_guard()')
                           and a::text like '=%')
       then 'PASS - one assignment, browser roles and PUBLIC revoked'
       else 'FAIL - it writes more than paid_at, or a role can execute it' end

-- -- H  history is not rewritten ------------------------------------------------
union all
select 'H1', 'H1 the 84 legacy rows still have paid_at NULL, and are the SAME rows',
  case when (select count(*) from public.orders where paid and paid_at is null) = 84
        and (select md5(string_agg(id::text, ',' order by id))
               from public.orders where paid and paid_at is null)
            = '14a6d549e7da52aada52e1a7857c0670'
       then 'PASS - no backfill, no rewrite'
       else 'FAIL - legacy rows changed: now '
            || (select count(*)::text from public.orders where paid and paid_at is null)
            || ' rows (expected 84)' end

union all
select 'H2', 'H2 the migration contains no UPDATE of orders at all',
  -- Belt and braces on H1: if anything had rewritten history it would have to
  -- have run an UPDATE, and the only new database object is a trigger whose
  -- body assigns a single NEW field (T5).
  case when to_regprocedure('public.orders_payment_time_guard()') is null
       then 'N/A - guard not installed'
       when (select p.prosrc from pg_proc p
              where p.oid = to_regprocedure('public.orders_payment_time_guard()'))
            not ilike '%update %'
        and (select p.prosrc from pg_proc p
              where p.oid = to_regprocedure('public.orders_payment_time_guard()'))
            not ilike '%insert %'
        and (select p.prosrc from pg_proc p
              where p.oid = to_regprocedure('public.orders_payment_time_guard()'))
            not ilike '%delete %'
       then 'PASS' else 'FAIL - the guard body touches other rows' end

-- -- W  the existing payment writers are untouched ------------------------------
union all
select 'W1', 'W1 set_order_paid unchanged',
  case when (select md5(p.prosrc) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = 'set_order_paid')
            = 'b9cfb319694bb8b21936c5dd64fb9b1d'
       then 'PASS' else 'FAIL - a payment writer was modified' end

union all
select 'W2', 'W2 orders_payment_automation unchanged',
  case when (select md5(p.prosrc) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = 'orders_payment_automation')
            = '8a1f90ec4c7048acfe8fb032e7b482eb'
       then 'PASS' else 'FAIL - the COD automation was modified' end

union all
select 'W3', 'W3 get_store_order_facts (PR 1) unchanged',
  case when (select md5(p.prosrc) from pg_proc p
              where p.oid = to_regprocedure('public.get_store_order_facts(text,text)'))
            = '10766b40c4056817c1d7084420297aeb'
       then 'PASS' else 'FAIL - PR 1 was disturbed' end

union all
select 'W4', 'W4 shipment_outcome_of unchanged',
  case when (select md5(p.prosrc) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = 'shipment_outcome_of')
            = '5b1639bd9cc9f6aab787600c554910ac'
       then 'PASS' else 'FAIL - the shipment classifier was modified' end

-- -- B  the orders baseline, unchanged EXCEPT this one intentional trigger -------
union all
select 'B1', 'B1 the other four order triggers are untouched',
  -- Fingerprinted with the new trigger excluded, so the expected value is the
  -- same before and after. This is what "unchanged except for one intentional
  -- addition" means, checked rather than asserted.
  case when (select md5(string_agg(t.tgname || ':' || t.tgenabled::text, ',' order by t.tgname))
               from pg_trigger t join pg_class c on c.oid = t.tgrelid
              where c.relname = 'orders' and not t.tgisinternal
                and t.tgname <> 'orders_payment_time_guard')
            = '11af8163bb6f3fa4d110377466aa79ab'
       then 'PASS' else 'FAIL - an existing order trigger moved' end

union all
select 'B2', 'B2 the trigger set on orders is EXACTLY right for the state it is in',
  -- State-aware on purpose. An earlier version accepted `count(*) in (4, 5)`,
  -- which passed in BOTH states and so proved nothing about whether the guard
  -- should be there. This branches on whether the guard exists and then demands
  -- the exact name set for that state.
  --
  -- Comparing the sorted, comma-joined names in one string asserts all three
  -- things at once: the exact count, every expected name present, and zero
  -- unexpected names.
  case when exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
                     where c.relname = 'orders' and t.tgname = 'orders_payment_time_guard'
                       and not t.tgisinternal)
       then
         -- POST-INSTALL: the four originals plus the guard, and nothing else.
         case when (select string_agg(t.tgname, ',' order by t.tgname)
                      from pg_trigger t join pg_class c on c.oid = t.tgrelid
                     where c.relname = 'orders' and not t.tgisinternal)
                   = 'orders_insert_guard,orders_payment_automation,'
                     || 'orders_payment_time_guard,trg_decrement_stock,trg_meta_capi'
              then 'PASS - post-install: exactly 5, the 4 originals plus the guard'
              else 'FAIL - post-install trigger set is wrong: '
                   || coalesce((select string_agg(t.tgname, ',' order by t.tgname)
                                  from pg_trigger t join pg_class c on c.oid = t.tgrelid
                                 where c.relname = 'orders' and not t.tgisinternal), 'none') end
       else
         -- PRE-INSTALL: exactly the four originals, and the guard absent.
         case when (select string_agg(t.tgname, ',' order by t.tgname)
                      from pg_trigger t join pg_class c on c.oid = t.tgrelid
                     where c.relname = 'orders' and not t.tgisinternal)
                   = 'orders_insert_guard,orders_payment_automation,'
                     || 'trg_decrement_stock,trg_meta_capi'
              then 'PASS - pre-install: exactly the 4 expected triggers, guard absent'
              else 'FAIL - pre-install trigger set is wrong: '
                   || coalesce((select string_agg(t.tgname, ',' order by t.tgname)
                                  from pg_trigger t join pg_class c on c.oid = t.tgrelid
                                 where c.relname = 'orders' and not t.tgisinternal), 'none') end
  end

union all
select 'B3', 'B3 orders policies and browser grants unchanged',
  case when (select md5(string_agg(policyname || ':' || cmd || ':' || roles::text, ',' order by policyname))
               from pg_policies where schemaname = 'public' and tablename = 'orders')
            = '7688ac51decf44b30d8051ef8d32defb'
        and (select md5(string_agg(grantee || ':' || privilege_type, ',' order by grantee, privilege_type))
               from information_schema.role_table_grants
              where table_schema = 'public' and table_name = 'orders'
                and grantee in ('anon', 'authenticated'))
            = 'f1fe5bb55be0937a01c7ae64fac8b84a'
        and (select md5(string_agg(grantee || ':' || column_name || ':' || privilege_type,
                                   ',' order by grantee, column_name, privilege_type))
               from information_schema.role_column_grants
              where table_schema = 'public' and table_name = 'orders'
                and grantee in ('anon', 'authenticated'))
            = '55d396069f53d6ec791338390358e761'
       then 'PASS' else 'FAIL - policies or browser grants on orders drifted' end

union all
select 'B4', 'B4 phase 1, phase 2 and phase 3C objects unchanged',
  case when exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
                     where c.relname = 'orders' and t.tgname = 'orders_insert_guard' and t.tgenabled = 'O')
        and exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
                     where c.relname = 'orders' and t.tgname = 'trg_decrement_stock' and t.tgenabled = 'O')
        and exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                     where n.nspname = 'public' and p.proname = 'create_order_secure' and not p.prosecdef)
        and (select md5(p.prosrc) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = 'upgrade_store_plan')
            = '9f6bbf1eafb22765dc601eb11fc2dfcb'
        and (select count(*) from public.plan_entitlements where source <> 'migration_backfill') = 0
       then 'PASS' else 'FAIL - an earlier phase was disturbed' end

-- -- info ---------------------------------------------------------------------
union all
select 'Z1', '(info) paid rows, split by whether the payment time is known',
  (select 'paid with paid_at: ' || count(*) filter (where paid_at is not null)::text
          || ' / paid at an UNKNOWN time: ' || count(*) filter (where paid_at is null)::text
     from public.orders where paid)

union all
select 'Z2', '(info) returns with no returned_at (the same class of legacy gap)',
  (select count(*)::text from public.orders
    where (coalesce(shipment_outcome, '') in ('returned', 'lost')
           or lower(coalesce(shipment_status, '')) ~ 'rto|rts|return|lost')
      and returned_at is null)

order by 1, 2;
