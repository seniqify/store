-- ===========================================================================
--  Security phase 3A  --  VERIFICATION
--
--  READ-ONLY. One single SELECT statement. No create, insert, update, delete,
--  grant, revoke, drop, alter, set role or temporary table. No transaction.
--  Safe to run on production before and after applying the migration.
--
--  It must execute in BOTH states, so anything the migration creates is reached
--  through to_regprocedure and query_to_xml -- never named where PostgreSQL
--  would resolve it while parsing. (That lesson cost phase 2 a whole cycle.)
--
--  BEFORE: V1.1, V2.1 and V2.4 read FAIL; everything else already passes.
--          That is today's production.
--  AFTER:  every row PASS except the rows labelled (info).
-- ===========================================================================

with fn as (
  select p.proname::text as name, p.prosrc, p.prosecdef as definer,
         coalesce(array_to_string(p.proconfig, ', '), '') as cfg,
         coalesce(array_to_string(p.proacl, ' '), 'default(public)') as acl
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('verify_store_pin', 'reset_store_pin', 'otp_consume', 'get_pending_signup')
),
pol as (
  select tablename::text as tbl, policyname::text as name, cmd::text as cmd,
         roles::text as roles, coalesce(qual, '') as using_expr
    from pg_policies
   where schemaname = 'public' and tablename in ('pending_signups', 'console_audit')
),
grants as (
  select table_name::text as tbl, grantee::text as grantee, privilege_type::text as priv
    from information_schema.role_table_grants
   where table_schema = 'public'
     and table_name in ('pending_signups', 'console_audit')
     and grantee in ('anon', 'authenticated')
)

-- -- V1  the PIN throttle holds under parallel requests ------------------------
select 'V1' as grp, 'V1.1 verify_store_pin serializes before it counts' as check_name,
  case when not exists (select 1 from fn where name = 'verify_store_pin') then 'FAIL - not found'
       when (select prosrc from fn where name = 'verify_store_pin') like '%pg_advisory_xact_lock%'
        and (select prosrc from fn where name = 'verify_store_pin') like '%least(v_k_slug, v_k_ip)%'
        and (select prosrc from fn where name = 'verify_store_pin') like '%greatest(v_k_slug, v_k_ip)%'
       then 'PASS' else 'FAIL - the throttle can still be out-run in parallel' end as result
union all
select 'V1', 'V1.2 it locks BOTH budgets, address and store',
  case when (select prosrc from fn where name = 'verify_store_pin') like '%pin:slug:%'
        and (select prosrc from fn where name = 'verify_store_pin') like '%pin:ip:%'
       then 'PASS' else 'FAIL - a budget is unprotected' end
union all
select 'V1', 'V1.3 the limits are unchanged (10 per address, 50 per store)',
  case when (select prosrc from fn where name = 'verify_store_pin') like '%c_max_ip     constant integer  := 10%'
        and (select prosrc from fn where name = 'verify_store_pin') like '%c_max_store  constant integer  := 50%'
       then 'PASS' else 'FAIL - a limit moved' end
union all
select 'V1', 'V1.4 successes are still not recorded, failures still are',
  case when (select prosrc from fn where name = 'verify_store_pin') like '%if not v_ok then%'
        and (select prosrc from fn where name = 'verify_store_pin') not like '%values (p_slug, v_ip, true%'
       then 'PASS' else 'FAIL - recording behaviour changed' end
union all
select 'V1', 'V1.5 still SECURITY DEFINER with a pinned search_path',
  case when (select definer from fn where name = 'verify_store_pin')
        and (select cfg from fn where name = 'verify_store_pin') = 'search_path=public, pg_temp'
       then 'PASS' else 'FAIL - definer or search_path changed' end

-- -- V2  recovery spends the code once ----------------------------------------
union all
select 'V2', 'V2.1 reset_store_pin consumes the OTP through otp_consume',
  case when not exists (select 1 from fn where name = 'reset_store_pin') then 'FAIL - not found'
       when (select prosrc from fn where name = 'reset_store_pin') like '%public.otp_consume(p_whatsapp, p_code)%'
        and (select prosrc from fn where name = 'reset_store_pin') not like '%select exists (%from public.otp_codes%'
       then 'PASS' else 'FAIL - still checks and deletes separately' end
union all
select 'V2', 'V2.2 otp_consume is still the single-statement claim',
  case when not exists (select 1 from fn where name = 'otp_consume') then 'FAIL - not found'
       when (select prosrc from fn where name = 'otp_consume') like '%delete from public.otp_codes%'
        and (select prosrc from fn where name = 'otp_consume') like '%returning 1%'
        and (select prosrc from fn where name = 'otp_consume') like '%expires_at > now()%'
       then 'PASS' else 'FAIL - the consumer changed' end
union all
select 'V2', 'V2.3 the recovery budgets and the number check are unchanged',
  case when (select prosrc from fn where name = 'reset_store_pin') like '%c_max_ip     constant integer  := 5%'
        and (select prosrc from fn where name = 'reset_store_pin') like '%c_max_store  constant integer  := 20%'
        and (select prosrc from fn where name = 'reset_store_pin') like '%stored10 <> input10%'
       then 'PASS' else 'FAIL - recovery behaviour moved' end
union all
select 'V2', 'V2.4 its throttle is serialized too',
  case when (select prosrc from fn where name = 'reset_store_pin') like '%pg_advisory_xact_lock%'
       then 'PASS' else 'FAIL - the OTP throttle can be out-run' end
union all
select 'V2', 'V2.5 (info) stored OTP phone formats — exact matching depends on this',
  coalesce((select string_agg(dl || ' digits: ' || n::text, ', ' order by dl)
              from (select length(regexp_replace(phone, '\D', '', 'g')) as dl, count(*) as n
                      from public.otp_codes group by 1) t), 'no codes outstanding')

-- -- V3  pending_signups is deliberately untouched ---------------------------
-- It is open -- anon can read the whole table and write itself a paid plan --
-- and closing it needs reads and writes tied to server-verified payment
-- authority, not to knowing a phone number. That is its own design and its own
-- PR. These rows exist so this migration cannot quietly change it.
union all
select 'V3', 'V3.1 its four policies are exactly as they were',
  case when (select count(*) from pol where tbl = 'pending_signups') = 4
       then 'PASS - unchanged, closure is a separate PR'
       else 'FAIL - this phase must not touch pending_signups (found ' ||
            (select count(*)::text from pol where tbl = 'pending_signups') || ' policies)' end
union all
select 'V3', 'V3.2 no phase-3A function was added for it',
  case when to_regprocedure('public.get_pending_signup(text)') is null
       then 'PASS - not introduced'
       else 'FAIL - a phone-keyed lookup exists - it was removed in review' end

-- -- V4  console_audit ---------------------------------------------------------
union all
select 'V4', 'V4.1 the read policy still filters by console admin',
  -- The audit wrongly called this world-readable after reading only the role
  -- list. The predicate is what matters, and it is deliberately unchanged.
  case when exists (select 1 from pol where tbl = 'console_audit' and cmd = 'SELECT'
                      and using_expr like '%is_crm_admin%')
       then 'PASS' else 'FAIL - staff read model changed' end
union all
select 'V4', 'V4.2 anon and authenticated cannot TRUNCATE or write it',
  case when exists (select 1 from grants where tbl = 'console_audit'
                      and priv in ('TRUNCATE', 'INSERT', 'UPDATE', 'DELETE'))
       then 'FAIL - ' || (select string_agg(distinct grantee || ':' || priv, ', ')
                            from grants where tbl = 'console_audit'
                             and priv in ('TRUNCATE','INSERT','UPDATE','DELETE'))
       else 'PASS' end

-- -- V5  nothing else moved ----------------------------------------------------
union all
select 'V5', 'V5.1 every PIN-gated RPC still delegates to verify_store_pin',
  case when exists (
         select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public'
            and pg_get_function_arguments(p.oid) ilike '%p_hashed_pin%'
            -- reset_store_pin takes p_new_hashed_pin to SET the PIN and is gated
            -- by the OTP, not by the PIN, so it is not expected to delegate.
            and p.proname not in ('verify_store_pin', 'reset_store_pin')
            and p.prosrc not ilike '%verify_store_pin%')
       then 'FAIL - something compares the PIN itself'
       else 'PASS' end
union all
select 'V5', 'V5.2 phase 1 and phase 2 protections are untouched',
  case when exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
                     where c.relname = 'orders' and t.tgname = 'orders_insert_guard' and t.tgenabled = 'O')
        and exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
                     where c.relname = 'orders' and t.tgname = 'trg_decrement_stock' and t.tgenabled = 'O')
        and exists (select 1 from pg_policies where schemaname = 'public'
                     and tablename = 'orders' and cmd = 'INSERT')
       then 'PASS' else 'FAIL - an earlier phase was disturbed' end
union all
select 'V5', 'V5.3 (info) PIN and OTP attempts recorded in the last 24h',
  coalesce((select string_agg(kind || '=' || n::text, ', ' order by kind)
              from (select kind, count(*) as n from public.pin_attempts
                     where attempted_at > now() - interval '24 hours' group by kind) k),
           'none')

order by 1, 2;
