-- ===========================================================================
--  Security hardening, phase 1  --  VERIFICATION
--
--  READ-ONLY. One single SELECT statement. No create, insert, update, delete,
--  grant, revoke, drop, alter, set role or temporary table. No transaction.
--  Safe to run on production before and after applying the migration.
--
--  Run it BEFORE applying too: every row then reads FAIL, and that is the
--  current state of production. After applying, every row must read PASS
--  except the rows labelled (info).
-- ===========================================================================

with guard as (
  select p.oid, p.prosrc, p.prosecdef,
         coalesce(array_to_string(p.proconfig, ', '), '') as cfg,
         coalesce(array_to_string(p.proacl, ' '), 'default(public)') as acl
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'otp_guard'
),
consumer as (
  select p.oid, p.prosrc, p.prosecdef,
         coalesce(array_to_string(p.proconfig, ', '), '') as cfg,
         coalesce(array_to_string(p.proacl, ' '), 'default(public)') as acl
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'otp_consume'
),
ins_guard as (
  select p.oid, p.prosrc, p.prosecdef,
         coalesce(array_to_string(p.proconfig, ', '), '') as cfg
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'orders_insert_guard'
),
trg as (
  select t.tgname::text as tgname, t.tgtype, t.tgenabled::text as tgenabled
    from pg_trigger t join pg_class c on c.oid = t.tgrelid
   where c.relname = 'orders' and not t.tgisinternal
)

-- -- V1  the OTP ledger ------------------------------------------------------
select 'V1' as grp, 'V1.1 pin_attempts.subject exists' as check_name,
  case when exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'pin_attempts'
                       and column_name = 'subject')
       then 'PASS' else 'FAIL - column missing' end as result
union all
select 'V1', 'V1.2 kind accepts otp_send and otp_verify',
  case when (select pg_get_constraintdef(oid) from pg_constraint
              where conrelid = 'public.pin_attempts'::regclass
                and conname = 'pin_attempts_kind_known') like '%otp_send%'
        and (select pg_get_constraintdef(oid) from pg_constraint
              where conrelid = 'public.pin_attempts'::regclass
                and conname = 'pin_attempts_kind_known') like '%otp_verify%'
       then 'PASS' else 'FAIL - constraint not widened' end
union all
select 'V1', 'V1.3 lookup index on (kind, subject, attempted_at)',
  case when exists (select 1 from pg_indexes where schemaname = 'public'
                     and indexname = 'pin_attempts_kind_subject_time_idx')
       then 'PASS' else 'FAIL - index missing' end

-- -- V2  the guard function --------------------------------------------------
union all
select 'V2', 'V2.1 otp_guard exists',
  case when exists (select 1 from guard) then 'PASS' else 'FAIL - not found' end
union all
select 'V2', 'V2.2 otp_guard is SECURITY DEFINER with a pinned search_path',
  case when exists (select 1 from guard where prosecdef
                      and cfg = 'search_path=public, pg_temp')
       then 'PASS'
       when exists (select 1 from guard) then 'FAIL - ' ||
            (select case when prosecdef then 'definer' else 'invoker' end || ', cfg=' || cfg from guard)
       else 'FAIL - not found' end
union all
select 'V2', 'V2.3 only the service role may call otp_guard',
  -- proacl spells PUBLIC as a leading '=X/owner' entry, so that is checked too:
  -- execute granted to PUBLIC would let the browser clear its own failures.
  case when not exists (select 1 from guard) then 'FAIL - not found'
       when (select acl from guard) = 'default(public)'
         or (select acl from guard) like '%anon=X%'
         or (select acl from guard) like '%authenticated=X%'
         or (select acl from guard) like '=X/%'
         or (select acl from guard) like '% =X/%'
       then 'FAIL - reachable from the browser: ' || (select acl from guard)
       when (select acl from guard) like '%service_role=X%' then 'PASS'
       else 'FAIL - service_role cannot call it: ' || (select acl from guard) end
union all
select 'V2', 'V2.4 otp_guard serializes its decisions',
  -- Counting and then writing is a check-then-act: without a lock, requests
  -- that arrive together all read a count below the limit and all proceed.
  case when exists (select 1 from guard
                     where prosrc like '%pg_advisory_xact_lock%'
                       and prosrc like '%least(v_k_sub, v_k_ip)%'
                       and prosrc like '%greatest(v_k_sub, v_k_ip)%')
       then 'PASS' else 'FAIL - the guard can be overshot in parallel' end
union all
select 'V2', 'V2.5 a guess is spent when it is allowed',
  case when exists (select 1 from guard
                     where prosrc not like '%p_action = ''fail''%'
                       and prosrc like '%''otp_verify'', v_subject%')
       then 'PASS' else 'FAIL - the guess is recorded outside the decision' end
union all
select 'V2', 'V2.6 every limit is still in the body',
  case when exists (select 1 from guard where prosrc like '%c_send_subject_short%'
                      and prosrc like '%c_send_subject_day%'
                      and prosrc like '%c_send_ip_hour%'
                      and prosrc like '%c_fail_subject%'
                      and prosrc like '%c_fail_ip%')
       then 'PASS' else 'FAIL - a limit was removed' end

-- -- V2b  a one-time code is used once ----------------------------------------
union all
select 'V2b', 'V2b.1 otp_consume exists, SECURITY DEFINER, pinned',
  case when exists (select 1 from consumer where prosecdef
                      and cfg = 'search_path=public, pg_temp')
       then 'PASS' else 'FAIL - missing or unpinned' end
union all
select 'V2b', 'V2b.2 the code is consumed in one statement, not read then deleted',
  -- A DELETE ... RETURNING holds the row lock, so a second caller finds nothing
  -- left to take. A SELECT first would let two requests spend the same code.
  case when exists (select 1 from consumer
                     where prosrc like '%delete from public.otp_codes%'
                       and prosrc like '%returning 1%'
                       and prosrc like '%expires_at > now()%'
                       and prosrc not like '%select%from public.otp_codes%where%')
       then 'PASS' else 'FAIL - consumption is not atomic' end
union all
select 'V2b', 'V2b.3 only the service role may call otp_consume',
  case when not exists (select 1 from consumer) then 'FAIL - not found'
       when (select acl from consumer) = 'default(public)'
         or (select acl from consumer) like '%anon=X%'
         or (select acl from consumer) like '%authenticated=X%'
         or (select acl from consumer) like '=X/%'
         or (select acl from consumer) like '% =X/%'
       then 'FAIL - reachable from the browser: ' || (select acl from consumer)
       when (select acl from consumer) like '%service_role=X%' then 'PASS'
       else 'FAIL - service_role cannot call it: ' || (select acl from consumer) end

-- -- V3  an order INSERT cannot claim payment --------------------------------
union all
select 'V3', 'V3.1 orders_insert_guard exists and is pinned',
  case when exists (select 1 from ins_guard where prosecdef
                      and cfg = 'search_path=public, pg_temp')
       then 'PASS' else 'FAIL - missing or unpinned' end
union all
select 'V3', 'V3.2 it clears every payment column',
  case when exists (select 1 from ins_guard
                     where prosrc like '%NEW.paid %' and prosrc like '%NEW.paid_at%'
                       and prosrc like '%NEW.paid_via%' and prosrc like '%NEW.payment_ref%'
                       and prosrc like '%NEW.payment_provider%')
       then 'PASS' else 'FAIL - a column is no longer cleared' end
union all
select 'V3', 'V3.3 status is clamped to new / abandoned',
  case when exists (select 1 from ins_guard
                     where prosrc like '%not in (''new'', ''abandoned'')%')
       then 'PASS' else 'FAIL - clamp missing' end
union all
select 'V3', 'V3.4 the trigger is BEFORE INSERT and enabled',
  case when exists (select 1 from trg where tgname = 'orders_insert_guard'
                      and (tgtype & 2) <> 0 and (tgtype & 4) <> 0 and tgenabled = 'O')
       then 'PASS' else 'FAIL - missing, wrong timing, or disabled' end
union all
select 'V3', 'V3.5 it fires before orders_payment_automation',
  case when (select count(*) from trg where tgname = 'orders_insert_guard') = 0
       then 'FAIL - guard trigger missing'
       when (select count(*) from trg where tgname = 'orders_payment_automation') = 0
       then 'PASS - nothing else to order against'
       when 'orders_insert_guard' < 'orders_payment_automation' then 'PASS'
       else 'FAIL - name order would run it second' end

-- -- V4  destructive grants ---------------------------------------------------
union all
select 'V4', 'V4.1 anon and authenticated cannot DELETE stores or orders',
  case when not exists (
         select 1 from information_schema.role_table_grants
          where table_schema = 'public' and table_name in ('stores', 'orders')
            and grantee in ('anon', 'authenticated') and privilege_type = 'DELETE')
       then 'PASS' else 'FAIL - DELETE still granted' end
union all
select 'V4', 'V4.2 anon and authenticated cannot TRUNCATE stores or orders',
  case when not exists (
         select 1 from information_schema.role_table_grants
          where table_schema = 'public' and table_name in ('stores', 'orders')
            and grantee in ('anon', 'authenticated') and privilege_type = 'TRUNCATE')
       then 'PASS' else 'FAIL - TRUNCATE still granted' end
union all
select 'V4', 'V4.3 the browser can still place an order (INSERT kept)',
  case when exists (
         select 1 from information_schema.role_table_grants
          where table_schema = 'public' and table_name = 'orders'
            and grantee = 'anon' and privilege_type = 'INSERT')
       then 'PASS' else 'FAIL - checkout would break' end

-- -- V5  what is on the ledger right now (info) -------------------------------
union all
select 'V5', 'V5.1 (info) attempts by kind, last 24h',
  coalesce((select string_agg(kind || '=' || n::text, ', ' order by kind)
              from (select kind, count(*) as n from public.pin_attempts
                     where attempted_at > now() - interval '24 hours'
                     group by kind) k), 'none')
union all
select 'V5', 'V5.2 (info) orders created in the last 24h that claim paid',
  (select count(*)::text from public.orders
    where created_at > now() - interval '24 hours' and paid is true)

order by 1, 2;
