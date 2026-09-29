-- ===========================================================================
--  Custom merchant domains -- PR-B  --  VERIFICATION
--
--  READ-ONLY. One single SELECT. No create, insert, update, delete, grant,
--  revoke, drop, alter, set role or temporary table. No transaction.
--  Safe on production before AND after applying the migration.
--
--  It must run in BOTH states, so the new tables are never named where
--  PostgreSQL would resolve them while parsing: everything is read from the
--  catalogs (pg_class, pg_proc, pg_indexes, pg_trigger, pg_policies) and the
--  one row count goes through query_to_xml, whose query is a string that is
--  only evaluated when the guard says the table exists.
--
--  HOW TO USE IT
--    1. Run it BEFORE applying. Save the output.
--    2. Apply supabase/custom-domains-forward.sql
--    3. Run it again.
--
--  BEFORE: B rows print fingerprints; every V row reads 'N/A - not installed'.
--  AFTER:  every V row PASS (rows marked (info) excepted), AND every B row
--          IDENTICAL to the before run -- the proof that nothing that already
--          existed was changed.
-- ===========================================================================

with
  fn(name, sig, cls) as (values
    ('resolve_store_host',             'public.resolve_store_host(text)',                                  'public_read'),
    ('store_primary_host',             'public.store_primary_host(text)',                                  'public_read'),
    ('domain_claim',                   'public.domain_claim(text,text,text)',                              'server'),
    ('domain_mark_verified',           'public.domain_mark_verified(uuid,text,text)',                      'server'),
    ('domain_vercel_intent',           'public.domain_vercel_intent(uuid,text,text,text)',                 'server'),
    ('domain_vercel_observe',          'public.domain_vercel_observe(uuid,text,text,boolean,boolean,boolean,text)', 'server'),
    ('domain_mark_ready',              'public.domain_mark_ready(uuid,text)',                              'server'),
    ('domain_challenge_create',        'public.domain_challenge_create(text,uuid,text,text,text)',         'server'),
    ('domain_activate',                'public.domain_activate(uuid,text,text,uuid,text)',                 'server'),
    ('domain_set_primary',             'public.domain_set_primary(uuid,text,text,uuid,text)',              'server'),
    ('domain_begin_disconnect',        'public.domain_begin_disconnect(uuid,text,text,uuid,text)',         'server'),
    ('domain_finish_disconnect',       'public.domain_finish_disconnect(uuid,text)',                       'server'),
    ('domain_expire_stale',            'public.domain_expire_stale(integer)',                              'server'),
    ('domain_health_update',           'public.domain_health_update(uuid,text,boolean,text)',              'server'),
    ('domain_event_append',            'public.domain_event_append(uuid,text,text,text,jsonb)',            'server'),
    ('store_domain_normalize',         'public.store_domain_normalize(text)',                              'internal'),
    ('store_domain_hostname_problem',  'public.store_domain_hostname_problem(text)',                       'internal'),
    ('store_domain_log',               'public.store_domain_log(uuid,text,text,text,jsonb)',               'internal'),
    ('store_domain_expire_if_stale',   'public.store_domain_expire_if_stale(uuid)',                        'internal'),
    ('store_domain_consume_challenge', 'public.store_domain_consume_challenge(uuid,text,uuid,text,text,text)', 'internal'),
    ('store_domain_vercel_clear',      'public.store_domain_vercel_clear(uuid)',                           'internal'),
    ('store_domains_guard_update',     'public.store_domains_guard_update()',                              'internal'),
    ('store_domains_check_group',      'public.store_domains_check_group()',                               'internal'),
    ('store_domain_events_append_only','public.store_domain_events_append_only()',                        'internal')),
  f as (
    select fn.name, fn.cls, p.oid, p.prosecdef, p.proconfig,
           coalesce(p.proacl, acldefault('f', p.proowner)) as acl
      from fn
      left join pg_proc p on p.oid = to_regprocedure(fn.sig)),
  tbl(name) as (values ('store_domains'), ('store_domain_challenges'), ('store_domain_events')),
  t as (
    select tbl.name, c.oid, c.relrowsecurity,
           coalesce(c.relacl, acldefault('r', c.relowner)) as acl
      from tbl
      left join pg_class c on c.oid = to_regclass('public.' || tbl.name)),
  installed as (
    select to_regclass('public.store_domains') is not null as yes)

-- B: things that existed before. MUST be identical before and after.
select 'B1' as grp, 'B1 public.stores columns + constraints (MUST be identical before/after)' as check_name,
  (select md5(string_agg(x, ',' order by x)) from (
     select a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull as x
       from pg_attribute a
      where a.attrelid = 'public.stores'::regclass and a.attnum > 0 and not a.attisdropped
     union all
     select 'con:' || c.conname || ':' || pg_get_constraintdef(c.oid)
       from pg_constraint c where c.conrelid = 'public.stores'::regclass) s) as result

union all
select 'B2', 'B2 public.stores policies + grants + non-internal triggers (MUST be identical)',
  md5(coalesce((select string_agg(p.policyname || ':' || p.cmd, ',' order by p.policyname)
                  from pg_policies p where p.schemaname = 'public' and p.tablename = 'stores'), '') || '|' ||
      coalesce((select array_to_string(c.relacl, ',') from pg_class c
                 where c.oid = 'public.stores'::regclass), '') || '|' ||
      coalesce((select string_agg(tg.tgname, ',' order by tg.tgname) from pg_trigger tg
                 where tg.tgrelid = 'public.stores'::regclass and not tg.tgisinternal), ''))

union all
select 'B3', 'B3 store count (info; MUST be identical)', (select count(*)::text from public.stores)

-- V: the new objects.
union all
select 'V01', 'V01 three tables exist',
  case when not (select yes from installed) then 'N/A - not installed'
       when (select count(*) from t where t.oid is not null) = 3 then 'PASS'
       else 'FAIL - ' || (select string_agg(t.name, ', ') from t where t.oid is null) || ' missing' end

union all
select 'V02', 'V02 RLS enabled on all three',
  case when not (select yes from installed) then 'N/A - not installed'
       when (select bool_and(t.relrowsecurity) from t) then 'PASS'
       else 'FAIL - RLS off on ' || (select string_agg(t.name, ', ') from t where not t.relrowsecurity) end

union all
select 'V03', 'V03 zero policies (no browser access path)',
  case when not (select yes from installed) then 'N/A - not installed'
       when not exists (select 1 from pg_policies p
                         where p.schemaname = 'public'
                           and p.tablename in ('store_domains', 'store_domain_challenges', 'store_domain_events'))
         then 'PASS'
       else 'FAIL - ' || (select string_agg(p.tablename || '.' || p.policyname, ', ') from pg_policies p
                           where p.schemaname = 'public'
                             and p.tablename in ('store_domains', 'store_domain_challenges', 'store_domain_events')) end

union all
select 'V04', 'V04 PUBLIC / anon / authenticated hold NO privilege on the tables or the sequence',
  case when not (select yes from installed) then 'N/A - not installed'
       when not exists (
         select 1
           from (select acl from t
                 union all
                 select coalesce(c.relacl, acldefault('s', c.relowner))
                   from pg_class c where c.oid = to_regclass('public.store_domain_events_id_seq')) x,
                aclexplode(x.acl) a
          where a.grantee in (0, coalesce(to_regrole('anon')::oid, 0), coalesce(to_regrole('authenticated')::oid, 0)))
         then 'PASS'
       else 'FAIL - a browser role or PUBLIC holds a table privilege' end

union all
select 'V05', 'V05 service_role: SELECT on store_domains and store_domain_events, nothing else',
  case when not (select yes from installed) then 'N/A - not installed'
       when (select coalesce(string_agg(t.name || ':' || a.privilege_type, ',' order by t.name, a.privilege_type), '')
               from t, aclexplode(t.acl) a
              where a.grantee = to_regrole('service_role'))
            = 'store_domain_events:SELECT,store_domains:SELECT'
        and not exists (select 1 from pg_class c, aclexplode(coalesce(c.relacl, acldefault('s', c.relowner))) a
                         where c.oid = to_regclass('public.store_domain_events_id_seq')
                           and a.grantee = to_regrole('service_role'))
         then 'PASS'
       else 'FAIL - ' || (select coalesce(string_agg(t.name || ':' || a.privilege_type, ',' order by t.name, a.privilege_type), 'none')
                            from t, aclexplode(t.acl) a where a.grantee = to_regrole('service_role')) end

union all
select 'V06', 'V06 all 24 functions exist',
  case when not (select yes from installed) then 'N/A - not installed'
       when (select count(*) from f where f.oid is not null) = 24 then 'PASS'
       else 'FAIL - missing ' || (select string_agg(f.name, ', ') from f where f.oid is null) end

union all
select 'V07', 'V07 SECURITY DEFINER on exactly the 15 RPCs; helpers and triggers are INVOKER',
  case when not (select yes from installed) then 'N/A - not installed'
       when not exists (select 1 from f where f.oid is not null
                          and f.prosecdef <> (f.cls in ('public_read', 'server')))
         then 'PASS'
       else 'FAIL - ' || (select string_agg(f.name, ', ') from f
                           where f.oid is not null and f.prosecdef <> (f.cls in ('public_read', 'server'))) end

union all
select 'V08', 'V08 every function pins search_path = public, pg_temp',
  case when not (select yes from installed) then 'N/A - not installed'
       when not exists (select 1 from f where f.oid is not null
                          and not coalesce('search_path=public, pg_temp' = any (f.proconfig), false))
         then 'PASS'
       else 'FAIL - ' || (select string_agg(f.name, ', ') from f where f.oid is not null
                           and not coalesce('search_path=public, pg_temp' = any (f.proconfig), false)) end

union all
select 'V09', 'V09 PUBLIC holds EXECUTE on none of them',
  case when not (select yes from installed) then 'N/A - not installed'
       when not exists (select 1 from f, aclexplode(f.acl) a where f.oid is not null and a.grantee = 0)
         then 'PASS'
       else 'FAIL - ' || (select string_agg(distinct f.name, ', ') from f, aclexplode(f.acl) a
                           where f.oid is not null and a.grantee = 0) end

union all
select 'V10', 'V10 EXECUTE matrix: read RPCs anon+authenticated+service_role; server RPCs service_role only; helpers nobody',
  case when not (select yes from installed) then 'N/A - not installed'
       when not exists (
         select 1 from f
          where f.oid is not null
            and (   has_function_privilege('anon', f.oid, 'EXECUTE')          <> (f.cls = 'public_read')
                 or has_function_privilege('authenticated', f.oid, 'EXECUTE') <> (f.cls = 'public_read')
                 or has_function_privilege('service_role', f.oid, 'EXECUTE')  <> (f.cls in ('public_read', 'server'))))
         then 'PASS'
       else 'FAIL - ' || (select string_agg(f.name, ', ') from f
                           where f.oid is not null
                             and (   has_function_privilege('anon', f.oid, 'EXECUTE')          <> (f.cls = 'public_read')
                                  or has_function_privilege('authenticated', f.oid, 'EXECUTE') <> (f.cls = 'public_read')
                                  or has_function_privilege('service_role', f.oid, 'EXECUTE')  <> (f.cls in ('public_read', 'server')))) end

union all
select 'V11', 'V11 ownership + one-open-group unique indexes present, predicates free of now()',
  case when not (select yes from installed) then 'N/A - not installed'
       when (select count(*) from pg_indexes i
              where i.schemaname = 'public'
                and i.indexname in ('store_domains_active_hostname_uidx',
                                    'store_domains_one_open_group_per_store_uidx')
                and i.indexdef like 'CREATE UNIQUE INDEX%') = 2
        and not exists (select 1 from pg_indexes i
                         where i.schemaname = 'public'
                           and i.tablename in ('store_domains', 'store_domain_challenges', 'store_domain_events')
                           and (i.indexdef ilike '%now()%' or i.indexdef ilike '%current_timestamp%'))
        and (select i.indexdef from pg_indexes i where i.indexname = 'store_domains_active_hostname_uidx')
              not like '%pending%'
         then 'PASS'
       else 'FAIL - check pg_indexes for store_domains' end

union all
select 'V12', 'V12 group check is a DEFERRABLE INITIALLY DEFERRED constraint trigger; guard + append-only triggers present',
  case when not (select yes from installed) then 'N/A - not installed'
       when exists (select 1 from pg_trigger tg
                     where tg.tgrelid = to_regclass('public.store_domains')
                       and tg.tgname = 'store_domains_check_group'
                       and tg.tgconstraint <> 0 and tg.tgdeferrable and tg.tginitdeferred)
        and exists (select 1 from pg_trigger tg
                     where tg.tgrelid = to_regclass('public.store_domains')
                       and tg.tgname = 'store_domains_guard_update')
        and (select count(*) from pg_trigger tg
              where tg.tgrelid = to_regclass('public.store_domain_events')
                and tg.tgname in ('store_domain_events_no_change', 'store_domain_events_no_truncate')) = 2
         then 'PASS'
       else 'FAIL - a trigger is missing or not deferred' end

union all
select 'V13', 'V13 store_domain_challenges has no column that could hold a plaintext code',
  case when not (select yes from installed) then 'N/A - not installed'
       when (select string_agg(a.attname, ',' order by a.attnum) from pg_attribute a
              where a.attrelid = to_regclass('public.store_domain_challenges')
                and a.attnum > 0 and not a.attisdropped)
            = 'id,store_slug,group_id,action,target_hostname,code_hash,expires_at,attempts,consumed_at,created_at'
        and exists (select 1 from pg_constraint c
                     where c.conrelid = to_regclass('public.store_domain_challenges')
                       and c.conname = 'store_domain_challenges_hash_only')
         then 'PASS'
       else 'FAIL - challenge columns changed' end

union all
select 'V15', 'V15 Vercel-safety CHECKs present: ended_off_vercel, removing_only_when_disconnecting, ready_is_configured',
  case when not (select yes from installed) then 'N/A - not installed'
       when (select count(*) from pg_constraint c
              where c.conrelid = to_regclass('public.store_domains')
                and c.contype = 'c'
                and c.conname in ('store_domains_ended_off_vercel',
                                  'store_domains_removing_only_when_disconnecting',
                                  'store_domains_ready_is_configured')) = 3
         then 'PASS'
       else 'FAIL - a Vercel-safety CHECK is missing' end

union all
select 'V14', 'V14 rows by status (info; empty until PR-C)',
  case when not (select yes from installed) then 'N/A - not installed'
       else coalesce((xpath('/row/s/text()', query_to_xml(
              'select coalesce(string_agg(status || ''='' || n, '', '' order by status), ''no rows'') as s
                 from (select status, count(*) as n from public.store_domains group by status) x',
              false, false, '')))[1]::text, 'no rows') end;
