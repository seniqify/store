-- ===========================================================================
--  Custom merchant domains -- PR-B.1  --  VERIFICATION
--
--  READ-ONLY. One single SELECT; no writes, no transaction. Runs before AND
--  after custom-domains-lease-forward.sql: before, the L rows read
--  'N/A - not installed' and P1 must read PASS (PR-B's function in place);
--  after, every L row must read PASS.
--
--  Also re-run supabase/custom-domains-verify.sql (PR-B) after applying: V06
--  and V10 name the 4-argument domain_health_update, which PR-B.1 replaces, so
--  those two rows are EXPECTED to report it missing; every other PR-B row must
--  still PASS and its B rows must be unchanged.
--
--  L04, L06 and L07 read query_to_xml with tableforest = true, whose single
--  <row> root matches the '/row/...' XPath.
-- ===========================================================================

with
  installed as (select to_regclass('public.store_domain_reconcile') is not null as yes),
  lease as (select p.oid, p.prosecdef, p.proconfig, coalesce(p.proacl, acldefault('f', p.proowner)) as acl
              from pg_proc p where p.oid = to_regprocedure('public.domain_reconcile_lease(integer)')),
  health as (select p.oid, p.prosecdef, p.proconfig, coalesce(p.proacl, acldefault('f', p.proowner)) as acl
               from pg_proc p where p.oid = to_regprocedure('public.domain_health_update(uuid,text,uuid,boolean,text)')),
  consts as (select p.oid, p.proconfig, coalesce(p.proacl, acldefault('f', p.proowner)) as acl
               from pg_proc p
              where p.oid in (to_regprocedure('public.store_domain_health_interval()'),
                              to_regprocedure('public.store_domain_lease_seconds()'),
                              to_regprocedure('public.store_domain_lease_batch_max()')))

select 'P1' as grp, 'P1 PR-B 4-arg domain_health_update present and unmodified (BEFORE: PASS; AFTER: replaced)' as check_name,
  case when (select yes from installed) and to_regprocedure('public.domain_health_update(uuid,text,boolean,text)') is null
         then 'N/A - replaced by PR-B.1'
       when (select md5(replace(p.prosrc, chr(13), '')) from pg_proc p
              where p.oid = to_regprocedure('public.domain_health_update(uuid,text,boolean,text)'))
            = 'fa0d5fd7ebc53344a90534c9def84d1e' then 'PASS'
       else 'FAIL - missing or modified' end as result

union all
select 'L01', 'L01 store_domain_reconcile: RLS on, zero policies, no privilege for any role',
  case when not (select yes from installed) then 'N/A - not installed'
       when (select relrowsecurity from pg_class where oid = to_regclass('public.store_domain_reconcile'))
        and not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'store_domain_reconcile')
        and not exists (select 1 from pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
                         where c.oid = to_regclass('public.store_domain_reconcile')
                           and a.grantee in (0, coalesce(to_regrole('anon')::oid, 0),
                                             coalesce(to_regrole('authenticated')::oid, 0),
                                             coalesce(to_regrole('service_role')::oid, 0)))
         then 'PASS' else 'FAIL' end

union all
select 'L02', 'L02 domain_reconcile_lease: definer, search_path pinned, EXECUTE service_role only',
  case when not (select yes from installed) then 'N/A - not installed'
       when (select prosecdef and 'search_path=public, pg_temp' = any (proconfig) from lease)
        and has_function_privilege('service_role', (select oid from lease), 'EXECUTE')
        and not has_function_privilege('anon', (select oid from lease), 'EXECUTE')
        and not has_function_privilege('authenticated', (select oid from lease), 'EXECUTE')
        and not exists (select 1 from lease, aclexplode(lease.acl) a where a.grantee = 0)
         then 'PASS' else 'FAIL' end

union all
select 'L03', 'L03 domain_health_update(uuid,text,uuid,boolean,text): definer, pinned, service_role only; 4-arg gone',
  case when not (select yes from installed) then 'N/A - not installed'
       when to_regprocedure('public.domain_health_update(uuid,text,boolean,text)') is null
        and (select prosecdef and 'search_path=public, pg_temp' = any (proconfig) from health)
        and has_function_privilege('service_role', (select oid from health), 'EXECUTE')
        and not has_function_privilege('anon', (select oid from health), 'EXECUTE')
        and not has_function_privilege('authenticated', (select oid from health), 'EXECUTE')
        and not exists (select 1 from health, aclexplode(health.acl) a where a.grantee = 0)
         then 'PASS' else 'FAIL' end

union all
select 'L04', 'L04 one health interval (1 hour), lease 120 s, batch cap 5; helpers callable by nobody',
  case when not (select yes from installed) then 'N/A - not installed'
       when (select count(*) from consts) = 3
        and not exists (select 1 from consts where not coalesce('search_path=public, pg_temp' = any (proconfig), false))
        and not exists (select 1 from consts, aclexplode(consts.acl) a
                         where a.grantee in (0, coalesce(to_regrole('anon')::oid, 0),
                                             coalesce(to_regrole('authenticated')::oid, 0),
                                             coalesce(to_regrole('service_role')::oid, 0)))
        and (xpath('/row/v/text()', query_to_xml(
               'select public.store_domain_health_interval()::text || ''|'' || public.store_domain_lease_seconds()
                       || ''|'' || public.store_domain_lease_batch_max() as v', false, true, '')))[1]::text
            = '01:00:00|120|5'
         then 'PASS' else 'FAIL' end

union all
select 'L05', 'L05 fair-queue index present, predicate free of now()',
  case when not (select yes from installed) then 'N/A - not installed'
       when exists (select 1 from pg_indexes i
                     where i.schemaname = 'public' and i.indexname = 'store_domain_reconcile_fair_idx'
                       and i.indexdef not ilike '%now()%')
         then 'PASS' else 'FAIL' end

union all
select 'L06', 'L06 active leases (info)',
  case when not (select yes from installed) then 'N/A - not installed'
       else (xpath('/row/n/text()', query_to_xml(
              'select count(*) as n from public.store_domain_reconcile where lease_until > now()',
              false, true, '')))[1]::text end

-- PR-B's V14 reads query_to_xml's non-forest output with a forest XPath, so it
-- prints 'no rows' whatever the table holds. This is the corrected form
-- (tableforest = true); the reviewed PR-B verifier is left unchanged.
union all
select 'L07', 'L07 store_domains rows by status (info; corrected form of PR-B V14)',
  case when to_regclass('public.store_domains') is null then 'N/A - PR-B not installed'
       else coalesce((xpath('/row/s/text()', query_to_xml(
              'select string_agg(status || ''='' || n, '', '' order by status) as s
                 from (select status, count(*) as n from public.store_domains group by status) x',
              false, true, '')))[1]::text, 'no rows') end;
