-- ===========================================================================
--  Checkout for a signed-in browser  --  VERIFICATION
--
--  READ-ONLY. One single SELECT statement. No create, insert, update, delete,
--  grant, revoke, drop, alter, set role or temporary table. No transaction.
--  Safe to run on production before and after applying the migration.
--
--  Before applying, V1.2 reads FAIL and everything else PASS -- that is the
--  bug. After applying, every row reads PASS except the rows labelled (info).
--
--  This proves the policy is shaped correctly. That both roles can actually
--  INSERT, and that the payment columns are still stripped on the way in, is
--  proved by running supabase/orders-authenticated-insert-PROOF.sql, which
--  inserts as each role inside a transaction and rolls back.
-- ===========================================================================

with ins as (
  select policyname::text as name, permissive::text as permissive,
         roles::text as roles, coalesce(with_check, '') as check_expr
    from pg_policies
   where schemaname = 'public' and tablename = 'orders' and cmd = 'INSERT'
),
allpol as (
  select cmd::text as cmd, roles::text as roles, policyname::text as name
    from pg_policies
   where schemaname = 'public' and tablename = 'orders'
),
guard as (
  select t.tgenabled::text as tgenabled, t.tgtype, p.prosrc
    from pg_trigger t
    join pg_proc p on p.oid = t.tgfoid
    join pg_class c on c.oid = t.tgrelid
   where c.relname = 'orders' and t.tgname = 'orders_insert_guard'
     and not t.tgisinternal
)

-- -- V1  the INSERT policy ----------------------------------------------------
select 'V1' as grp, 'V1.1 exactly one INSERT policy, still permissive' as check_name,
  case when (select count(*) from ins) <> 1 then 'FAIL - found ' || (select count(*) from ins)::text
       when (select permissive from ins) <> 'PERMISSIVE' then 'FAIL - no longer permissive'
       when (select name from ins) <> 'orders_anon_insert' then 'FAIL - renamed: ' || (select name from ins)
       else 'PASS' end as result
union all
select 'V1', 'V1.2 it applies to anon AND authenticated',
  case when (select count(*) from ins) <> 1 then 'FAIL - no single INSERT policy'
       when (select roles from ins) like '%anon%' and (select roles from ins) like '%authenticated%'
       then 'PASS'
       else 'FAIL - roles are ' || (select roles from ins) end
union all
select 'V1', 'V1.3 the check is unchanged (true)',
  case when (select btrim(check_expr) from ins) = 'true' then 'PASS'
       else 'FAIL - check is now: ' || (select check_expr from ins) end
union all
select 'V1', 'V1.4 the policy was not widened to PUBLIC',
  case when (select roles from ins) like '%public%' then 'FAIL - granted to PUBLIC'
       else 'PASS' end

-- -- V2  nothing else was broadened -------------------------------------------
union all
select 'V2', 'V2.1 no SELECT, UPDATE or DELETE policy for authenticated on orders',
  case when exists (select 1 from allpol
                     where cmd in ('SELECT', 'UPDATE', 'DELETE', 'ALL')
                       and roles like '%authenticated%'
                       and name <> 'crm team read orders')
       then 'FAIL - ' || (select string_agg(name || ' (' || cmd || ')', ', ')
                            from allpol
                           where cmd in ('SELECT', 'UPDATE', 'DELETE', 'ALL')
                             and roles like '%authenticated%'
                             and name <> 'crm team read orders')
       else 'PASS' end
union all
select 'V2', 'V2.2 anon and authenticated still cannot DELETE or TRUNCATE orders',
  case when not exists (
         select 1 from information_schema.role_table_grants
          where table_schema = 'public' and table_name = 'orders'
            and grantee in ('anon', 'authenticated')
            and privilege_type in ('DELETE', 'TRUNCATE'))
       then 'PASS' else 'FAIL - a destructive grant is back' end
union all
select 'V2', 'V2.3 row level security is still on for orders',
  case when (select relrowsecurity from pg_class where oid = 'public.orders'::regclass)
       then 'PASS' else 'FAIL - RLS is off' end

-- -- V3  the payment guard is untouched ---------------------------------------
union all
select 'V3', 'V3.1 orders_insert_guard still fires BEFORE INSERT',
  case when exists (select 1 from guard
                     where (tgtype & 2) <> 0 and (tgtype & 4) <> 0 and tgenabled = 'O')
       then 'PASS' else 'FAIL - missing, wrong timing, or disabled' end
union all
select 'V3', 'V3.2 it still clears every payment column and clamps status',
  case when exists (select 1 from guard
                     where prosrc like '%NEW.paid %' and prosrc like '%NEW.paid_at%'
                       and prosrc like '%NEW.paid_via%' and prosrc like '%NEW.payment_ref%'
                       and prosrc like '%NEW.payment_provider%'
                       and prosrc like '%not in (''new'', ''abandoned'')%')
       then 'PASS' else 'FAIL - the guard changed' end

-- -- V4  what the ledger looks like now (info) ---------------------------------
union all
select 'V4', 'V4.1 (info) orders created in the last 24h',
  (select count(*)::text from public.orders where created_at > now() - interval '24 hours')
union all
select 'V4', 'V4.2 (info) of those, how many claim paid',
  (select count(*)::text from public.orders
    where created_at > now() - interval '24 hours' and paid is true)

order by 1, 2;
