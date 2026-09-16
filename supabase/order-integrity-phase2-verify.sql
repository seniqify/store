-- ===========================================================================
--  Order integrity, phase 2  --  VERIFICATION
--
--  READ-ONLY. One single SELECT statement. No create, insert, update, delete,
--  grant, revoke, drop, alter, set role or temporary table. No transaction.
--  Safe to run on production before and after applying the migration.
--
--  Before applying, the V1-V4 rows read FAIL or "N/A - Phase 2 not installed"
--  -- nothing exists yet. After applying, every row must read PASS except the
--  rows labelled (info).
--
--  RUNNING BEFORE INSTALL IS THE POINT, AND IT USED TO CRASH
--
--  PostgreSQL resolves relation and function names while PARSING, before any
--  row is evaluated, so a statement mentioning public.order_integrity fails
--  outright when that table does not exist yet -- even inside a CASE branch
--  that would never be taken. Four rows did exactly that and took the whole
--  file down with 42P01 before the migration could be baselined.
--
--  They now reach those objects in the only two ways that survive parsing:
--    to_regclass / to_regprocedure  -- a lookup that returns NULL, not an error
--    query_to_xml('<sql text>')     -- the query is a STRING, so nothing in it
--                                      is parsed until the row is evaluated,
--                                      and it is only evaluated when the guard
--                                      above says the object exists
--  Both are read-only; query_to_xml is only ever handed a SELECT.
--
--  V5 is the one to read most carefully AFTER applying: it proves the migration
--  changed nothing that is live. The old insert policy and the old stock trigger
--  must both still be there, because the storefront still depends on them until
--  a later, separate step.
-- ===========================================================================

with tbl as (
  select c.relname::text as name, c.relrowsecurity as rls,
         (select count(*) from pg_policies p
           where p.schemaname = 'public' and p.tablename = c.relname) as policies
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname in ('order_requests', 'order_integrity', 'order_pricing_shadow')
),
fn as (
  select p.proname::text as name, p.prosecdef as definer,
         coalesce(array_to_string(p.proconfig, ', '), '') as cfg,
         coalesce(array_to_string(p.proacl, ' '), 'default(public)') as acl,
         p.prosrc
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('create_order_secure', 'store_pricing_fingerprint')
),
grants as (
  select table_name::text as name, grantee::text as grantee, privilege_type::text as priv
    from information_schema.role_table_grants
   where table_schema = 'public'
     and table_name in ('order_requests', 'order_integrity', 'order_pricing_shadow')
     and grantee in ('anon', 'authenticated')
)

-- -- V1  the three tables ------------------------------------------------------
select 'V1' as grp, 'V1.1 all three tables exist' as check_name,
  case when (select count(*) from tbl) = 3 then 'PASS'
       else 'FAIL - found ' || (select count(*) from tbl)::text || ' of 3' end as result
union all
select 'V1', 'V1.2 RLS on, with no policies at all',
  case when exists (select 1 from tbl where not rls) then 'FAIL - RLS off somewhere'
       when exists (select 1 from tbl where policies > 0) then 'FAIL - a policy exists'
       when (select count(*) from tbl) = 3 then 'PASS'
       else 'FAIL - tables missing' end
union all
select 'V1', 'V1.3 no grant to anon or authenticated',
  case when exists (select 1 from grants)
       then 'FAIL - ' || (select string_agg(distinct name || '/' || grantee, ', ') from grants)
       else 'PASS' end
union all
select 'V1', 'V1.4 order_integrity cannot be orphaned (ON DELETE RESTRICT)',
  -- to_regclass, never a ::regclass cast: the cast throws when the table is
  -- absent, which is precisely the state this file has to survive.
  case when to_regclass('public.order_integrity') is null
       then 'N/A - Phase 2 not installed'
       when exists (
         select 1 from pg_constraint
          where conrelid = to_regclass('public.order_integrity')
            and contype = 'f' and confdeltype = 'r')
       then 'PASS' else 'FAIL - missing or wrong delete rule' end

-- -- V2  the fingerprint function ---------------------------------------------
union all
select 'V2', 'V2.1 store_pricing_fingerprint exists, pinned, service-role only',
  case when not exists (select 1 from fn where name = 'store_pricing_fingerprint')
       then 'FAIL - not found'
       when (select cfg from fn where name = 'store_pricing_fingerprint') <> 'search_path=public, pg_temp'
       then 'FAIL - search_path not pinned'
       when (select acl from fn where name = 'store_pricing_fingerprint') like '%anon=X%'
         or (select acl from fn where name = 'store_pricing_fingerprint') like '%authenticated=X%'
         or (select acl from fn where name = 'store_pricing_fingerprint') like '=X/%'
       then 'FAIL - reachable from the browser'
       when (select acl from fn where name = 'store_pricing_fingerprint') like '%service_role=X%'
       then 'PASS' else 'FAIL - service_role cannot call it' end
union all
select 'V2', 'V2.2 it binds prices, fees and coupons but not cost or stock',
  case when not exists (select 1 from fn where name = 'store_pricing_fingerprint') then 'FAIL - not found'
       when (select prosrc from fn where name = 'store_pricing_fingerprint') like '%''cost''%'
         or (select prosrc from fn where name = 'store_pricing_fingerprint') like '%->''stock''%'
       then 'FAIL - hashes cost or stock'
       when (select prosrc from fn where name = 'store_pricing_fingerprint') like '%discountValue%'
        and (select prosrc from fn where name = 'store_pricing_fingerprint') like '%freeShippingAbove%'
        and (select prosrc from fn where name = 'store_pricing_fingerprint') like '%variantExtras%'
       then 'PASS' else 'FAIL - a pricing input is not bound' end
union all
select 'V2', 'V2.3 (info) the fingerprint computes for a live store',
  -- A direct call would be resolved at parse time and fail before the function
  -- exists, so it goes through query_to_xml, whose argument is a string. The
  -- old wording claimed to prove determinism "across two reads"; two reads in
  -- one statement prove nothing of the sort, because the function is STABLE and
  -- may legitimately be evaluated once. What is worth reporting is that it runs
  -- and returns a full md5, which is what this now says.
  case when to_regprocedure('public.store_pricing_fingerprint(text)') is null
       then 'N/A - Phase 2 not installed'
       else coalesce(
         (select case when length(v) = 32 then 'ok - ' || length(v)::text || ' hex chars'
                      when v is null or v = '' then 'FAIL - returned nothing'
                      else 'CHECK - unexpected length ' || length(v)::text end
            from (select (xpath('/row/f/text()', query_to_xml(
                    'select public.store_pricing_fingerprint(s.slug) as f'
                    || ' from public.stores s order by s.slug limit 1',
                    false, true, '')))[1]::text as v) q),
         'N/A - no stores') end

-- -- V3  the writer ------------------------------------------------------------
union all
select 'V3', 'V3.1 create_order_secure exists, INVOKER, pinned',
  case when not exists (select 1 from fn where name = 'create_order_secure') then 'FAIL - not found'
       when (select definer from fn where name = 'create_order_secure') then 'FAIL - must be SECURITY INVOKER'
       when (select cfg from fn where name = 'create_order_secure') <> 'search_path=public, pg_temp'
       then 'FAIL - search_path not pinned'
       else 'PASS' end
union all
select 'V3', 'V3.2 only the service role may call it',
  case when not exists (select 1 from fn where name = 'create_order_secure') then 'FAIL - not found'
       when (select acl from fn where name = 'create_order_secure') = 'default(public)'
         or (select acl from fn where name = 'create_order_secure') like '%anon=X%'
         or (select acl from fn where name = 'create_order_secure') like '%authenticated=X%'
         or (select acl from fn where name = 'create_order_secure') like '=X/%'
         or (select acl from fn where name = 'create_order_secure') like '% =X/%'
       then 'FAIL - reachable from the browser: ' || (select acl from fn where name = 'create_order_secure')
       when (select acl from fn where name = 'create_order_secure') like '%service_role=X%'
       then 'PASS' else 'FAIL - service_role cannot call it' end
union all
select 'V3', 'V3.3 it takes no parameter for paid, status or payment reference',
  -- p.oid, not a bare oid: pg_proc and pg_namespace both have one, and the
  -- ambiguity is an error rather than a wrong answer. And when the function is
  -- absent the subquery is NULL, the regex yields NULL, and the old CASE fell
  -- through to its ELSE and reported PASS for a function that did not exist --
  -- so the absent case is now named explicitly instead of passing by accident.
  case when to_regprocedure('public.create_order_secure(text, text, text, text,'
                            || ' text, jsonb, text, text, jsonb, jsonb, jsonb, text)') is null
       then 'N/A - Phase 2 not installed'
       when coalesce((select pg_get_function_arguments(p.oid)
                        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                       where n.nspname = 'public' and p.proname = 'create_order_secure'), '')
            ~* '(p_paid|p_status|p_payment_ref|p_payment_provider|p_paid_at|p_paid_via)'
       then 'FAIL - a trusted field is a parameter'
       else 'PASS' end
union all
select 'V3', 'V3.4 it locks the store row and checks the fingerprint',
  case when not exists (select 1 from fn where name = 'create_order_secure')
       then 'N/A - Phase 2 not installed'
       when (select prosrc from fn where name = 'create_order_secure') like '%for update%'
        and (select prosrc from fn where name = 'create_order_secure') like '%config_changed%'
        and (select prosrc from fn where name = 'create_order_secure') like '%store_pricing_fingerprint%'
       then 'PASS' else 'FAIL - missing lock or fingerprint check' end
union all
select 'V3', 'V3.5 it decrements stock by product id, never by name',
  case when not exists (select 1 from fn where name = 'create_order_secure')
       then 'N/A - Phase 2 not installed'
       when (select prosrc from fn where name = 'create_order_secure') like '%dec.pid = prod->>''id''%'
        and (select prosrc from fn where name = 'create_order_secure') not like '%dec.name = prod->>''name''%'
       then 'PASS' else 'FAIL - matching by name' end
union all
select 'V3', 'V3.6 out of stock is raised before any write',
  case when not exists (select 1 from fn where name = 'create_order_secure')
       then 'N/A - Phase 2 not installed'
       when (select prosrc from fn where name = 'create_order_secure') like '%out_of_stock%'
        and position('out_of_stock' in (select prosrc from fn where name = 'create_order_secure'))
          < position('insert into public.orders' in (select prosrc from fn where name = 'create_order_secure'))
       then 'PASS' else 'FAIL - availability is checked too late' end

-- -- V4  the orders table is untouched by this migration ----------------------
union all
select 'V4', 'V4.1 no column was added to or removed from orders',
  case when (select count(*) from information_schema.columns
              where table_schema = 'public' and table_name = 'orders') = 38
       then 'PASS'
       else 'CHECK - orders now has ' ||
            (select count(*)::text from information_schema.columns
              where table_schema = 'public' and table_name = 'orders') || ' columns, expected 38' end

-- -- V5  NOTHING LIVE CHANGED (the point of this phase) -----------------------
union all
select 'V5', 'V5.1 the storefront can still insert orders (policy intact)',
  case when exists (
         select 1 from pg_policies
          where schemaname = 'public' and tablename = 'orders' and cmd = 'INSERT'
            and roles::text like '%anon%')
       then 'PASS' else 'FAIL - the old path was cut off too early' end
union all
select 'V5', 'V5.2 the old stock trigger is still in place',
  case when exists (
         select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
          where c.relname = 'orders' and t.tgname = 'trg_decrement_stock' and t.tgenabled = 'O')
       then 'PASS' else 'FAIL - stock would not be decremented at all' end
union all
select 'V5', 'V5.3 the phase-1 payment guard is still in place',
  case when exists (
         select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
          where c.relname = 'orders' and t.tgname = 'orders_insert_guard' and t.tgenabled = 'O')
       then 'PASS' else 'FAIL - phase 1 was disturbed' end
union all
select 'V5', 'V5.4 (info) orders written through the new writer so far',
  -- A static FROM public.order_integrity is resolved at parse time; wrapping it
  -- in CASE does not help. The table name travels as text instead.
  case when to_regclass('public.order_integrity') is null
       then 'N/A - Phase 2 not installed'
       else coalesce((xpath('/row/c/text()', query_to_xml(
              'select count(*) as c from public.order_integrity',
              false, true, '')))[1]::text, '0') end
union all
select 'V5', 'V5.5 (info) shadow observations recorded',
  case when to_regclass('public.order_pricing_shadow') is null
       then 'N/A - Phase 2 not installed'
       else coalesce((xpath('/row/c/text()', query_to_xml(
              'select count(*) as c from public.order_pricing_shadow',
              false, true, '')))[1]::text, '0') end

order by 1, 2;
