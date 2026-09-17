-- ===========================================================================
--  Phase 3C, PR 1  --  VERIFICATION
--
--  READ-ONLY. One single SELECT. No create, insert, update, delete, grant,
--  revoke, drop, alter, set role or temporary table. No transaction.
--  Safe on production before AND after applying the migration.
--
--  It must execute in BOTH states, so public.plan_entitlements is never named
--  where PostgreSQL would resolve it while parsing. It is reached only through
--
--    to_regclass('public.plan_entitlements')   -- a string, checked at runtime
--    query_to_xml('<sql text>')                -- the query is a STRING, so
--                                                 nothing inside it is parsed
--                                                 until the row is evaluated,
--                                                 and it is only evaluated
--                                                 when the guard says the
--                                                 table exists
--
--  (Phase 2 lost a whole cycle to a verifier that crashed with 42P01 before
--  its migration was applied. This one does not.)
--
--  HOW TO USE IT
--    1. Run it BEFORE applying. Save the output.
--    2. Apply supabase/plan-entitlements-forward.sql
--    3. Run it again. Compare.
--
--  BEFORE: the B rows print today's fingerprints; every E/P/H/A row reads
--          'N/A - ledger not installed'. That is expected, not a failure.
--  AFTER:  every row PASS except the rows labelled (info), AND every B
--          fingerprint IDENTICAL to the before run.
--
--  THE B ROWS ARE THE POINT. This migration's central claim is that it changed
--  nothing that already existed. B1 is a fingerprint over the plan fields of
--  every store; B2..B6 cover the billing functions, their grants, and
--  pending_signups. If any of them moved, the migration did something it
--  promised not to do, and that matters more than any row below it.
-- ===========================================================================

select 'B1' as grp, 'B1 stores plan fingerprint (MUST be identical before/after)' as check_name,
  md5(string_agg(s.slug || '|' || coalesce(s.config->>'plan', '') || '|' ||
                 coalesce(s.config->>'planExpiresAt', '') || '|' ||
                 coalesce(s.config->>'razorpaySubscriptionId', ''), ',' order by s.slug)) as result
  from public.stores s

union all
select 'B2', 'B2 upgrade_store_plan source md5 (MUST be identical: 9f6bbf1eafb22765dc601eb11fc2dfcb)',
  coalesce((select md5(p.prosrc) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = 'upgrade_store_plan'), 'ABSENT')

union all
select 'B3', 'B3 upgrade_store_plan grants (MUST still include anon - this PR does NOT close it)',
  coalesce((select array_to_string(p.proacl, ' ') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = 'upgrade_store_plan'), 'ABSENT')

union all
select 'B4', 'B4 update_store_config source md5 (MUST be identical: c3c6da5207a9561e79f7692383ffab1d)',
  coalesce((select md5(p.prosrc) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = 'update_store_config'), 'ABSENT')

union all
select 'B5', 'B5 console_update_store source md5 (MUST be identical: 9d85170522f1c347d49bb2f0dd65016a)',
  coalesce((select md5(p.prosrc) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = 'console_update_store'), 'ABSENT')

union all
select 'B6', 'B6 pending_signups policies + grants fingerprint (MUST be identical)',
  coalesce((select md5(string_agg(policyname || ':' || cmd || ':' || roles::text || ':' ||
                                  coalesce(qual, '-') || ':' || coalesce(with_check, '-'), ',' order by policyname))
              from pg_policies where schemaname = 'public' and tablename = 'pending_signups'), 'none')
  || ' / ' ||
  coalesce((select md5(string_agg(grantee || ':' || privilege_type, ',' order by grantee, privilege_type))
              from information_schema.role_table_grants
             where table_schema = 'public' and table_name = 'pending_signups'
               and grantee in ('anon', 'authenticated')), 'none')

union all
select 'B7', 'B7 phase 1 and 2 protections still in place',
  case when exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
                     where c.relname = 'orders' and t.tgname = 'orders_insert_guard' and t.tgenabled = 'O')
        and exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
                     where c.relname = 'orders' and t.tgname = 'trg_decrement_stock' and t.tgenabled = 'O')
        and to_regprocedure('public.create_order_secure(text,text,text,text,text,jsonb,text,text,jsonb,jsonb,jsonb,text)') is not null
       then 'PASS' else 'FAIL - an earlier phase was disturbed' end

-- -- A  the authority boundary ------------------------------------------------
union all
select 'A1', 'A1 row level security is enabled on the ledger',
  case when to_regclass('public.plan_entitlements') is null then 'N/A - ledger not installed'
       when (select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
              where n.nspname = 'public' and c.relname = 'plan_entitlements')
       then 'PASS' else 'FAIL - RLS is off' end

union all
select 'A2', 'A2 the ledger has NO policies at all',
  case when to_regclass('public.plan_entitlements') is null then 'N/A - ledger not installed'
       when (select count(*) from pg_policies
              where schemaname = 'public' and tablename = 'plan_entitlements') = 0
       then 'PASS - no row is reachable by a role that does not bypass RLS'
       else 'FAIL - ' || (select string_agg(policyname, ', ') from pg_policies
                           where schemaname = 'public' and tablename = 'plan_entitlements') end

union all
select 'A3', 'A3 anon and authenticated hold NO privilege on the ledger',
  -- The schema default grants arwdDxtm to both roles on every new table, so
  -- this row is the one that proves the REVOKE actually ran.
  case when to_regclass('public.plan_entitlements') is null then 'N/A - ledger not installed'
       when not exists (select 1 from information_schema.role_table_grants
                         where table_schema = 'public' and table_name = 'plan_entitlements'
                           and grantee in ('anon', 'authenticated', 'PUBLIC'))
       then 'PASS'
       else 'FAIL - ' || (select string_agg(distinct grantee || ':' || privilege_type, ', ')
                            from information_schema.role_table_grants
                           where table_schema = 'public' and table_name = 'plan_entitlements'
                             and grantee in ('anon', 'authenticated', 'PUBLIC')) end

union all
select 'A4', 'A4 service_role can write but cannot DELETE or TRUNCATE',
  case when to_regclass('public.plan_entitlements') is null then 'N/A - ledger not installed'
       when (select string_agg(distinct privilege_type, ',' order by privilege_type)
               from information_schema.role_table_grants
              where table_schema = 'public' and table_name = 'plan_entitlements'
                and grantee = 'service_role') = 'INSERT,SELECT,UPDATE'
       then 'PASS - entitlements are revoked by status, never erased'
       else 'FAIL - ' || coalesce((select string_agg(distinct privilege_type, ',' order by privilege_type)
                                     from information_schema.role_table_grants
                                    where table_schema = 'public' and table_name = 'plan_entitlements'
                                      and grantee = 'service_role'), 'no grants') end

union all
select 'A5', 'A5 no RPC exists that lets a browser role manufacture an entitlement',
  case when not exists (
         select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public'
            and p.prosrc ilike '%plan_entitlements%'
            and (has_function_privilege('anon', p.oid, 'EXECUTE')
              or has_function_privilege('authenticated', p.oid, 'EXECUTE')))
       then 'PASS' else 'FAIL - ' || (select string_agg(p.proname, ', ')
              from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.prosrc ilike '%plan_entitlements%'
               and (has_function_privilege('anon', p.oid, 'EXECUTE')
                 or has_function_privilege('authenticated', p.oid, 'EXECUTE'))) end

-- -- S  schema shape ----------------------------------------------------------
union all
select 'S1', 'S1 all six CHECK constraints and the idempotency UNIQUE are present',
  case when to_regclass('public.plan_entitlements') is null then 'N/A - ledger not installed'
       when (select count(*) from pg_constraint
              where conrelid = to_regclass('public.plan_entitlements')
                and conname in ('plan_entitlements_plan_known',
                                'plan_entitlements_source_known',
                                'plan_entitlements_status_known',
                                'plan_entitlements_window_ordered',
                                'plan_entitlements_imported_is_never_verified',
                                'plan_entitlements_payment_sources_are_verified',
                                'plan_entitlements_idempotency_key_key')) = 7
       then 'PASS'
       else 'FAIL - found ' || (select string_agg(conname, ', ' order by conname) from pg_constraint
                                 where conrelid = to_regclass('public.plan_entitlements')
                                   and contype in ('c', 'u')) end

union all
select 'S2', 'S2 store_slug is a real foreign key with ON DELETE RESTRICT',
  case when to_regclass('public.plan_entitlements') is null then 'N/A - ledger not installed'
       when exists (select 1 from pg_constraint
                     where conrelid = to_regclass('public.plan_entitlements')
                       and contype = 'f' and confdeltype = 'r')
       then 'PASS' else 'FAIL - the ledger can be orphaned' end

union all
select 'S3', 'S3 razorpay_subscription_id is deliberately NOT unique',
  -- Renewals legitimately reuse a subscription id. Production has zero
  -- duplicates today, which is exactly why adding the constraint would be an
  -- easy silent mistake -- this row exists so nobody "fixes" it later.
  case when to_regclass('public.plan_entitlements') is null then 'N/A - ledger not installed'
       when not exists (select 1 from pg_index i
                         where i.indrelid = to_regclass('public.plan_entitlements')
                           and i.indisunique
                           and pg_get_indexdef(i.indexrelid) ilike '%razorpay_subscription_id%')
       then 'PASS - uniqueness lives on idempotency_key'
       else 'FAIL - a unique index on razorpay_subscription_id will reject renewals' end

union all
select 'S4', 'S4 the three lookup indexes exist',
  case when to_regclass('public.plan_entitlements') is null then 'N/A - ledger not installed'
       when (select count(*) from pg_indexes
              where schemaname = 'public' and tablename = 'plan_entitlements'
                and indexname in ('plan_entitlements_store_slug_idx',
                                  'plan_entitlements_store_active_idx',
                                  'plan_entitlements_subscription_idx')) = 3
       then 'PASS' else 'FAIL - an index is missing' end

-- -- E  coverage --------------------------------------------------------------
union all
select 'E1', 'E1 exactly one entitlement per store, and one store per entitlement',
  case when to_regclass('public.plan_entitlements') is null then 'N/A - ledger not installed'
       else coalesce((xpath('/row/c/text()', query_to_xml(
              'select case when (select count(*) from public.stores) '
              || '            = (select count(*) from public.plan_entitlements) '
              || '       and not exists (select 1 from public.stores s '
              || '             where not exists (select 1 from public.plan_entitlements e '
              || '                   where e.store_slug = s.slug)) '
              || '       then ''PASS - '' || (select count(*)::text from public.plan_entitlements) '
              || '            || '' entitlements for '' '
              || '            || (select count(*)::text from public.stores) || '' stores'' '
              || '       else ''FAIL - '' || (select count(*)::text from public.stores) || '' stores vs '' '
              || '            || (select count(*)::text from public.plan_entitlements) || '' entitlements'' '
              || '  end as c',
              false, true, '')))[1]::text, 'FAIL - could not read') end

union all
select 'E2', 'E2 no store was imported twice',
  case when to_regclass('public.plan_entitlements') is null then 'N/A - ledger not installed'
       else coalesce((xpath('/row/c/text()', query_to_xml(
              'select case when (select count(*) from (select store_slug from public.plan_entitlements '
              || '       where source = ''migration_backfill'' group by store_slug having count(*) > 1) d) = 0 '
              || '       then ''PASS'' else ''FAIL - a rerun created duplicates'' end as c',
              false, true, '')))[1]::text, 'FAIL - could not read') end

union all
select 'E3', 'E3 every imported row carries source=migration_backfill',
  case when to_regclass('public.plan_entitlements') is null then 'N/A - ledger not installed'
       else coalesce((xpath('/row/c/text()', query_to_xml(
              'select case when (select count(*) from public.plan_entitlements '
              || '       where source <> ''migration_backfill'') = 0 '
              || '       then ''PASS - nothing but imported state exists yet'' '
              || '       else ''FAIL - this PR should write no other source'' end as c',
              false, true, '')))[1]::text, 'FAIL - could not read') end

-- -- H  honesty ---------------------------------------------------------------
union all
select 'H1', 'H1 NO imported row is labelled as verified payment',
  -- The single most important row in this file. Legacy state must never be
  -- presentable as proof that someone paid.
  case when to_regclass('public.plan_entitlements') is null then 'N/A - ledger not installed'
       else coalesce((xpath('/row/c/text()', query_to_xml(
              'select case when (select count(*) from public.plan_entitlements '
              || '       where verified_at is not null) = 0 '
              || '       then ''PASS - every row is honestly unverified'' '
              || '       else ''FAIL - '' || (select count(*)::text from public.plan_entitlements '
              || '            where verified_at is not null) || '' rows claim a payment proof'' end as c',
              false, true, '')))[1]::text, 'FAIL - could not read') end

union all
select 'H2', '(info) H2 the console-billed stores, imported with no payment evidence',
  -- Five stores carry a billingNote (cash / manual). None of them carries a
  -- Razorpay payment reference, and this migration invents none.
  (select 'billingNote stores: ' || count(*)::text
     || ' / of those, with a subscription id: '
     || count(*) filter (where coalesce(config->>'razorpaySubscriptionId','') <> '')::text
     || ' / with a Razorpay payment reference: 0 (none exists to import)'
     from public.stores where config ? 'billingNote')

-- -- P  parity with the application's current view --------------------------
union all
select 'P1', 'P1 plan parity: imported plan = stores.config plan, every store',
  case when to_regclass('public.plan_entitlements') is null then 'N/A - ledger not installed'
       else coalesce((xpath('/row/c/text()', query_to_xml(
              'select case when (select count(*) from public.plan_entitlements e '
              || '       join public.stores s on s.slug = e.store_slug '
              || '       where e.plan is distinct from coalesce(s.config->>''plan'', ''free'')) = 0 '
              || '       then ''PASS'' else ''FAIL - a plan was altered in import'' end as c',
              false, true, '')))[1]::text, 'FAIL - could not read') end

union all
select 'P2', 'P2 expiry parity, including the stores with no expiry at all',
  case when to_regclass('public.plan_entitlements') is null then 'N/A - ledger not installed'
       else coalesce((xpath('/row/c/text()', query_to_xml(
              'select case when (select count(*) from public.plan_entitlements e '
              || '       join public.stores s on s.slug = e.store_slug '
              || '       where e.expires_at is distinct from '
              || '             (case when jsonb_typeof(s.config->''planExpiresAt'') = ''string'' '
              || '                    and s.config->>''planExpiresAt'' <> '''' '
              || '                   then (s.config->>''planExpiresAt'')::timestamptz end)) = 0 '
              || '       then ''PASS'' else ''FAIL - an expiry was altered in import'' end as c',
              false, true, '')))[1]::text, 'FAIL - could not read') end

union all
select 'P3', 'P3 subscription-id parity',
  case when to_regclass('public.plan_entitlements') is null then 'N/A - ledger not installed'
       else coalesce((xpath('/row/c/text()', query_to_xml(
              'select case when (select count(*) from public.plan_entitlements e '
              || '       join public.stores s on s.slug = e.store_slug '
              || '       where e.razorpay_subscription_id is distinct from '
              || '             (case when jsonb_typeof(s.config->''razorpaySubscriptionId'') = ''string'' '
              || '                    and s.config->>''razorpaySubscriptionId'' <> '''' '
              || '                   then s.config->>''razorpaySubscriptionId'' end)) = 0 '
              || '       then ''PASS'' else ''FAIL - a subscription link was altered in import'' end as c',
              false, true, '')))[1]::text, 'FAIL - could not read') end

union all
select 'P4', 'P4 in-force parity: the ledger derives the same answer as effectivePlan()',
  -- effectivePlan(config) in src/utils/planLimits.js:
  --   plan !== free && exp && new Date(exp) < now()  ->  free   (lapsed)
  --   otherwise                                      ->  plan   (in force)
  -- A store with a paid plan and NO expiry is in force. Two stores are in that
  -- state, and this row is what stops an import from quietly lapsing them.
  case when to_regclass('public.plan_entitlements') is null then 'N/A - ledger not installed'
       else coalesce((xpath('/row/c/text()', query_to_xml(
              'select case when (select count(*) from public.plan_entitlements e '
              || '       join public.stores s on s.slug = e.store_slug '
              || '       where (e.plan <> ''free'' and (e.expires_at is null or e.expires_at > now())) '
              || '          is distinct from '
              || '             (coalesce(s.config->>''plan'', ''free'') <> ''free'' '
              || '              and (coalesce(s.config->>''planExpiresAt'', '''') = '''' '
              || '                   or (s.config->>''planExpiresAt'')::timestamptz > now()))) = 0 '
              || '       then ''PASS - every store keeps exactly the entitlement it has today'' '
              || '       else ''FAIL - the import changed who is entitled'' end as c',
              false, true, '')))[1]::text, 'FAIL - could not read') end

union all
select 'P5', '(info) P5 in-force breakdown as the application sees it right now',
  (select string_agg(st || '=' || n::text, ', ' order by st) from (
     select case when coalesce(config->>'plan', 'free') = 'free' then 'free'
                 when coalesce(config->>'planExpiresAt', '') = '' then 'paid_no_expiry_in_force'
                 when (config->>'planExpiresAt')::timestamptz > now() then 'paid_in_force'
                 else 'lapsed_to_free' end as st,
            count(*) as n
       from public.stores group by 1) t)

order by 1, 2;
