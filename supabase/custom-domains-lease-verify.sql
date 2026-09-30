-- ===========================================================================
--  Custom merchant domains -- PR-B.1  --  VERIFICATION
--
--  READ-ONLY. One single SELECT; no writes, no transaction. Run it before AND
--  after custom-domains-lease-forward.sql (and after a rollback).
--
--  EXPECTED
--    BEFORE applying:  P1 PASS, P2 PASS; L01-L07 'N/A - not installed';
--                      L08 'N/A - not installed'; L09 the status counts.
--    AFTER applying:   P1 PASS; P2 'N/A - PR-B.1 installed'; L01-L07 PASS;
--                      L08 and L09 are INFORMATION, not PASS:
--                        L08  number of live leases (normally 0)
--                        L09  store_domains rows by status, e.g.
--                             'connected=2, verified=2', or 'no rows'
--    AFTER rollback:   the same as BEFORE.
--
--  PR-B'S VERIFIER AFTER THIS (supabase/custom-domains-verify.sql)
--    Every row as before EXCEPT V10, which is EXPECTED to read
--      FAIL - domain_vercel_intent, domain_vercel_observe, domain_mark_ready,
--             domain_activate, domain_begin_disconnect, domain_finish_disconnect,
--             domain_health_update
--    (PR-B.1 removes service_role's direct EXECUTE on exactly these seven; it
--    calls them through the lease gateways. L06 below checks that state.)
--    V06 stays PASS: PR-B.1 replaces no function. B rows stay identical.
--    V14 prints 'no rows' whatever the table holds -- a known defect of that
--    row (non-forest query_to_xml read with a forest XPath); L09 here is the
--    corrected form.
-- ===========================================================================

with
  installed as (select to_regclass('public.store_domain_reconcile') is not null as yes),
  wrapped(sig, md5) as (values
    ('public.domain_vercel_intent(uuid,text,text,text)',                        '4c09f0f0b16b80b44bad7311a9985c0c'),
    ('public.domain_vercel_observe(uuid,text,text,boolean,boolean,boolean,text)', '2206a341ea63364ece918b74d88935c3'),
    ('public.domain_mark_ready(uuid,text)',                                     '1870f5a37da7297b05b360865cadb912'),
    ('public.domain_activate(uuid,text,text,uuid,text)',                        '5103a8af7950631f4d30e67ee4ddf437'),
    ('public.domain_begin_disconnect(uuid,text,text,uuid,text)',                'f1fa03f912a53d730c14a056a0d23e63'),
    ('public.domain_finish_disconnect(uuid,text)',                              '0483f8fe1b908f0d3e7e60aff6c2c280'),
    ('public.domain_health_update(uuid,text,boolean,text)',                     'fa0d5fd7ebc53344a90534c9def84d1e')),
  w as (select wrapped.sig, wrapped.md5, p.oid, md5(replace(p.prosrc, chr(13), '')) as actual
          from wrapped left join pg_proc p on p.oid = to_regprocedure(wrapped.sig)),
  rpc(sig) as (values
    ('public.domain_reconcile_lease(integer)'),
    ('public.domain_group_lease(uuid,text)'),
    ('public.domain_group_lease_release(uuid,text,uuid)'),
    ('public.domain_leased_vercel_intent(uuid,uuid,text,text,text)'),
    ('public.domain_leased_vercel_observe(uuid,uuid,text,text,boolean,boolean,boolean,text)'),
    ('public.domain_leased_mark_ready(uuid,uuid,text)'),
    ('public.domain_leased_activate(uuid,uuid,text,text,uuid,text)'),
    ('public.domain_leased_begin_disconnect(uuid,uuid,text,text,uuid,text)'),
    ('public.domain_leased_finish_disconnect(uuid,uuid,text)'),
    ('public.domain_leased_health_update(uuid,uuid,text,boolean,text)')),
  r as (select rpc.sig, p.oid, p.prosecdef, p.proconfig, coalesce(p.proacl, acldefault('f', p.proowner)) as acl
          from rpc left join pg_proc p on p.oid = to_regprocedure(rpc.sig)),
  helper(sig) as (values
    ('public.store_domain_lease_refusal(uuid,text,uuid)'),
    ('public.store_domain_health_interval()'),
    ('public.store_domain_lease_seconds()'),
    ('public.store_domain_lease_batch_max()')),
  h as (select helper.sig, p.oid, p.prosecdef, p.proconfig, coalesce(p.proacl, acldefault('f', p.proowner)) as acl
          from helper left join pg_proc p on p.oid = to_regprocedure(helper.sig))

select 'P1' as grp, 'P1 the 7 PR-B functions PR-B.1 wraps are present and exactly the reviewed source (md5)' as check_name,
  case when to_regclass('public.store_domains') is null then 'N/A - PR-B not installed'
       when not exists (select 1 from w where w.oid is null or w.actual <> w.md5) then 'PASS'
       else 'FAIL - ' || (select string_agg(w.sig, ', ' order by w.sig) from w where w.oid is null or w.actual <> w.md5) end
  as result

union all
select 'P2', 'P2 BEFORE: service_role holds PR-B''s EXECUTE on those 7 (the rollback restores exactly this)',
  case when to_regclass('public.store_domains') is null then 'N/A - PR-B not installed'
       when (select yes from installed) then 'N/A - PR-B.1 installed'
       when not exists (select 1 from w where w.oid is null or not has_function_privilege('service_role', w.oid, 'EXECUTE'))
         then 'PASS'
       else 'FAIL - ' || (select string_agg(w.sig, ', ' order by w.sig) from w
                           where w.oid is null or not has_function_privilege('service_role', w.oid, 'EXECUTE')) end

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
select 'L02', 'L02 the 10 new RPCs (3 lease + 7 gateways) exist: definer, search_path pinned',
  case when not (select yes from installed) then 'N/A - not installed'
       when not exists (select 1 from r where r.oid is null
                           or not r.prosecdef
                           or not coalesce('search_path=public, pg_temp' = any (r.proconfig), false))
         then 'PASS'
       else 'FAIL - ' || (select string_agg(r.sig, ', ' order by r.sig) from r
                           where r.oid is null or not r.prosecdef
                              or not coalesce('search_path=public, pg_temp' = any (r.proconfig), false)) end

union all
select 'L03', 'L03 the 10 new RPCs: EXECUTE for service_role only (not PUBLIC, anon or authenticated)',
  case when not (select yes from installed) then 'N/A - not installed'
       when exists (select 1 from r where r.oid is null) then 'FAIL - missing (see L02)'
       when not exists (select 1 from r
                         where not has_function_privilege('service_role', r.oid, 'EXECUTE')
                            or has_function_privilege('anon', r.oid, 'EXECUTE')
                            or has_function_privilege('authenticated', r.oid, 'EXECUTE')
                            or exists (select 1 from aclexplode(r.acl) a where a.grantee = 0))
         then 'PASS'
       else 'FAIL - ' || (select string_agg(r.sig, ', ' order by r.sig) from r
                           where not has_function_privilege('service_role', r.oid, 'EXECUTE')
                              or has_function_privilege('anon', r.oid, 'EXECUTE')
                              or has_function_privilege('authenticated', r.oid, 'EXECUTE')
                              or exists (select 1 from aclexplode(r.acl) a where a.grantee = 0)) end

union all
select 'L04', 'L04 helpers: invoker, pinned, callable by nobody; interval 1 hour, lease 120 s, batch cap 5',
  case when not (select yes from installed) then 'N/A - not installed'
       when not exists (select 1 from h where h.oid is null or h.prosecdef
                           or not coalesce('search_path=public, pg_temp' = any (h.proconfig), false))
        and not exists (select 1 from h, aclexplode(h.acl) a
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
select 'L06', 'L06 the 7 wrapped PR-B functions: NO direct EXECUTE for service_role, anon, authenticated or PUBLIC',
  case when not (select yes from installed) then 'N/A - not installed'
       when exists (select 1 from w where w.oid is null) then 'FAIL - missing (see P1)'
       when not exists (select 1 from w
                         where has_function_privilege('service_role', w.oid, 'EXECUTE')
                            or has_function_privilege('anon', w.oid, 'EXECUTE')
                            or has_function_privilege('authenticated', w.oid, 'EXECUTE'))
         then 'PASS'
       else 'FAIL - ' || (select string_agg(w.sig, ', ' order by w.sig) from w
                           where has_function_privilege('service_role', w.oid, 'EXECUTE')
                              or has_function_privilege('anon', w.oid, 'EXECUTE')
                              or has_function_privilege('authenticated', w.oid, 'EXECUTE')) end

union all
select 'L07', 'L07 lease table shape: columns and the three lease CHECKs',
  case when not (select yes from installed) then 'N/A - not installed'
       when (select string_agg(a.attname, ',' order by a.attnum) from pg_attribute a
              where a.attrelid = to_regclass('public.store_domain_reconcile') and a.attnum > 0 and not a.attisdropped)
            = 'group_id,last_reconciled_at,lease_until,lease_token,lease_holder,health_pending,updated_at'
        and (select count(*) from pg_constraint c
              where c.conrelid = to_regclass('public.store_domain_reconcile') and c.contype = 'c'
                and c.conname in ('store_domain_reconcile_lease_whole', 'store_domain_reconcile_lease_holder',
                                  'store_domain_reconcile_health_in_lease')) = 3
         then 'PASS' else 'FAIL' end

union all
select 'L08', 'L08 live leases (INFORMATION: a count, normally 0)',
  case when not (select yes from installed) then 'N/A - not installed'
       else (xpath('/row/n/text()', query_to_xml(
              'select count(*) as n from public.store_domain_reconcile where lease_until > now()',
              false, true, '')))[1]::text end

-- PR-B's V14 reads query_to_xml's non-forest output with a forest XPath, so it
-- prints 'no rows' whatever the table holds. This is the corrected form
-- (tableforest = true); the reviewed PR-B verifier is left unchanged.
union all
select 'L09', 'L09 store_domains rows by status (INFORMATION; corrected form of PR-B V14)',
  case when to_regclass('public.store_domains') is null then 'N/A - PR-B not installed'
       else coalesce((xpath('/row/s/text()', query_to_xml(
              'select string_agg(status || ''='' || n, '', '' order by status) as s
                 from (select status, count(*) as n from public.store_domains group by status) x',
              false, true, '')))[1]::text, 'no rows') end;
