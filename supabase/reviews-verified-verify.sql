-- ═══════════════════════════════════════════════════════════════════════════
--  Verified-purchase reviews — VERIFICATION
--
--  READ-ONLY. One single SELECT. No create, insert, update, delete, grant,
--  revoke, drop, alter or transaction. Safe on production before and after.
--
--  Run AFTER reviews-verified-forward.sql. Every row must read PASS, except the
--  rows labelled (info). Run before applying, rows read "FAIL - not applied yet"
--  instead of erroring: the new tables are only ever reached through
--  to_regclass / to_regprocedure or query_to_xml, never named directly.
-- ═══════════════════════════════════════════════════════════════════════════

with
t as (
  select to_regclass('public.product_reviews')          as pr,
         to_regclass('public.review_invites')           as ri,
         to_regclass('public.review_reports')           as rr,
         to_regclass('public.review_audit')             as ra,
         to_regclass('public.reviews_access_preserved') as ap,
         to_regclass('public.reviews')                  as old
),
fns as (
  select p.oid, p.proname::text as proname, p.prosecdef, p.prosrc,
         coalesce(array_to_string(p.proconfig, ', '), '') as cfg
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('issue_review_invite', 'get_review_invite', 'submit_review',
                       'get_owner_reviews', 'reply_to_review', 'report_review',
                       'admin_list_review_reports', 'admin_resolve_review_report',
                       'review_product_id', 'review_rows_are_permanent')
),
x as (
  select case when (select pr from t) is null or (select ap from t) is null then null
         else query_to_xml($q$
    select (select count(*) from public.product_reviews where status = 'legacy_unpublished') as legacy,
           (select count(*) from public.product_reviews
             where legacy_review_id is not null
               and (status <> 'legacy_unpublished' or verified_purchase)) as legacy_bad,
           (select count(*) from public.product_reviews where status = 'published') as published,
           (select count(*) from public.product_reviews where status = 'removed') as removed,
           (select count(*) from public.review_invites
             where revoked_at is null and expires_at > now()) as live_invites,
           (select count(*) from public.review_reports where resolved_at is null) as open_reports,
           (select count(*) from public.reviews) as old_rows,
           (select coalesce(string_agg(name || ' [' || cmd || ']', ', ' order by name), 'none')
              from public.reviews_access_preserved where kind = 'policy') as saved_policies,
           (select coalesce(string_agg(name || ' ' || cmd, ', ' order by name, cmd), 'none')
              from public.reviews_access_preserved where kind = 'grant') as saved_grants
  $q$, false, true, '') end as doc
),
v as (
  select (xpath('/row/legacy/text()',         doc))[1]::text as legacy,
         (xpath('/row/legacy_bad/text()',     doc))[1]::text as legacy_bad,
         (xpath('/row/published/text()',      doc))[1]::text as published,
         (xpath('/row/removed/text()',        doc))[1]::text as removed,
         (xpath('/row/live_invites/text()',   doc))[1]::text as live_invites,
         (xpath('/row/open_reports/text()',   doc))[1]::text as open_reports,
         (xpath('/row/old_rows/text()',       doc))[1]::text as old_rows,
         (xpath('/row/saved_policies/text()', doc))[1]::text as saved_policies,
         (xpath('/row/saved_grants/text()',   doc))[1]::text as saved_grants
    from x
)

-- ── R1  the new tables ──────────────────────────────────────────────────────
select 'R1' as grp, 'R1.1 the four review tables exist' as check_name,
  case when (select pr is not null and ri is not null and rr is not null and ra is not null from t)
       then 'PASS' else 'FAIL - not applied yet' end as result
union all
select 'R1', 'R1.2 row level security is on, new tables and the old one',
  case when (select pr from t) is null then 'FAIL - not applied yet'
       when not exists (select 1 from pg_class c, t
                         where c.oid in (t.pr, t.ri, t.rr, t.ra, t.ap, t.old)
                           and not c.relrowsecurity)
       then 'PASS'
       else 'FAIL - RLS off: ' || (select string_agg(c.relname::text, ', ') from pg_class c, t
                                    where c.oid in (t.pr, t.ri, t.rr, t.ra, t.ap, t.old)
                                      and not c.relrowsecurity) end
union all
select 'R1', 'R1.3 one review per order item is enforced',
  case when exists (select 1 from pg_indexes
                     where schemaname = 'public' and indexname = 'product_reviews_one_per_order_item')
       then 'PASS' else 'FAIL - not applied yet' end

-- ── R2  who can read and write ──────────────────────────────────────────────
union all
select 'R2', 'R2.1 no client role can write any review table, old or new',
  case when (select pr from t) is null then 'FAIL - not applied yet'
       when not exists (
         select 1 from t,
                unnest(array[t.pr, t.ri, t.rr, t.ra, t.ap, t.old]) as tb(rel),
                unnest(array['anon', 'authenticated']) as r(role),
                unnest(array['insert', 'update', 'delete', 'truncate']) as w(verb)
          where tb.rel is not null and has_table_privilege(r.role, tb.rel, w.verb))
       then 'PASS' else 'FAIL - a client role can write a review table' end
union all
select 'R2', 'R2.2 clients cannot read invites, reports, audit or the old table',
  case when (select pr from t) is null then 'FAIL - not applied yet'
       when not exists (
         select 1 from t,
                unnest(array[t.ri, t.rr, t.ra, t.ap, t.old]) as tb(rel),
                unnest(array['anon', 'authenticated']) as r(role)
          where tb.rel is not null and has_table_privilege(r.role, tb.rel, 'select'))
       then 'PASS' else 'FAIL - a client role can read a private review table' end
union all
select 'R2', 'R2.3 private review columns are unreadable by clients',
  case when (select pr from t) is null then 'FAIL - not applied yet'
       when not exists (
         select 1 from t,
                unnest(array['customer_key', 'order_id', 'item_index', 'consent_advertising',
                             'removed_reason', 'removed_at', 'legacy_review_id']) as c(col),
                unnest(array['anon', 'authenticated']) as r(role)
          where has_column_privilege(r.role, t.pr, c.col, 'select'))
       then 'PASS' else 'FAIL - a client can read customer_key, order_id or another private column' end
union all
select 'R2', 'R2.4 the public columns are readable, so storefronts can show reviews',
  case when (select pr from t) is null then 'FAIL - not applied yet'
       when not exists (
         select 1 from t,
                unnest(array['rating', 'status', 'body', 'display_name', 'verified_purchase',
                             'merchant_reply', 'product_id', 'item_name', 'submitted_at']) as c(col)
          where not has_column_privilege('anon', t.pr, c.col, 'select'))
       then 'PASS' else 'FAIL - anon cannot read a column the storefront needs' end
union all
select 'R2', 'R2.5 product_reviews has one policy: read published rows',
  case when (select count(*) from pg_policies
              where schemaname = 'public' and tablename = 'product_reviews') = 1
        and exists (select 1 from pg_policies
                     where schemaname = 'public' and tablename = 'product_reviews'
                       and cmd = 'SELECT' and qual ilike '%published%')
       then 'PASS'
       else 'FAIL - policies: ' || coalesce((select string_agg(policyname || ' [' || cmd || ']', ', ')
                                               from pg_policies
                                              where schemaname = 'public'
                                                and tablename = 'product_reviews'), 'none') end
union all
select 'R2', 'R2.6 no policy left on the old table or the private tables',
  case when not exists (select 1 from pg_policies
                         where schemaname = 'public'
                           and tablename in ('reviews', 'review_invites', 'review_reports',
                                             'review_audit', 'reviews_access_preserved'))
       then 'PASS'
       else 'FAIL - ' || (select string_agg(tablename || '.' || policyname, ', ')
                            from pg_policies
                           where schemaname = 'public'
                             and tablename in ('reviews', 'review_invites', 'review_reports',
                                               'review_audit', 'reviews_access_preserved')) end

-- ── R3  legacy reviews ──────────────────────────────────────────────────────
union all
select 'R3', 'R3.1 every old review was copied',
  case when (select legacy from v) is null then 'FAIL - not applied yet'
       when (select legacy from v) = (select old_rows from v)
       then 'PASS - ' || (select legacy from v) || ' copied'
       else 'FAIL - ' || (select legacy from v) || ' copied of ' || (select old_rows from v) end
union all
select 'R3', 'R3.2 no old review is published or marked verified',
  case when (select legacy_bad from v) is null then 'FAIL - not applied yet'
       when (select legacy_bad from v) = '0' then 'PASS'
       else 'FAIL - ' || (select legacy_bad from v) || ' legacy rows are visible or verified' end
union all
select 'R3', 'R3.3 (info) old table access saved for the rollback',
  coalesce('policies: ' || (select saved_policies from v) ||
           ' | grants: ' || (select saved_grants from v), 'not applied yet')

-- ── R4  functions ───────────────────────────────────────────────────────────
union all
select 'R4', 'R4.1 all ten functions exist',
  case when (select count(*) from fns) = 10 then 'PASS'
       else 'FAIL - found ' || (select count(*) from fns)::text || ' of 10' end
union all
select 'R4', 'R4.2 search_path pinned to public, pg_temp on all of them',
  case when (select count(*) from fns) = 0 then 'FAIL - not applied yet'
       when not exists (select 1 from fns where cfg <> 'search_path=public, pg_temp')
       then 'PASS'
       else 'FAIL - ' || (select string_agg(proname || ' [' || coalesce(nullif(cfg, ''), 'not pinned') || ']', '; ')
                            from fns where cfg <> 'search_path=public, pg_temp') end
union all
select 'R4', 'R4.3 the eight callable functions are SECURITY DEFINER',
  case when (select count(*) from fns) = 0 then 'FAIL - not applied yet'
       when not exists (select 1 from fns
                         where proname not in ('review_product_id', 'review_rows_are_permanent')
                           and not prosecdef)
       then 'PASS'
       else 'FAIL - invoker: ' || (select string_agg(proname, ', ') from fns
                                   where proname not in ('review_product_id', 'review_rows_are_permanent')
                                     and not prosecdef) end
union all
select 'R4', 'R4.4 every seller function goes through the PIN throttle',
  case when (select count(*) from fns
              where proname in ('issue_review_invite', 'get_owner_reviews',
                                'reply_to_review', 'report_review')) <> 4
       then 'FAIL - not applied yet'
       when not exists (select 1 from fns
                         where proname in ('issue_review_invite', 'get_owner_reviews',
                                           'reply_to_review', 'report_review')
                           and prosrc not ilike '%public.verify_store_pin(p_slug, p_hashed_pin)%')
       then 'PASS'
       else 'FAIL - not PIN-throttled: ' ||
            (select string_agg(proname, ', ') from fns
              where proname in ('issue_review_invite', 'get_owner_reviews',
                                'reply_to_review', 'report_review')
                and prosrc not ilike '%public.verify_store_pin(p_slug, p_hashed_pin)%') end
union all
select 'R4', 'R4.5 both admin functions require a crm_team admin',
  case when (select count(*) from fns where proname like 'admin_%') <> 2 then 'FAIL - not applied yet'
       when not exists (select 1 from fns
                         where proname like 'admin_%'
                           and not (prosrc ilike '%public.crm_team%'
                                    and prosrc ilike '%auth.uid()%'
                                    and prosrc ilike '%role = ''admin''%'))
       then 'PASS' else 'FAIL - an admin function is not gated' end
union all
select 'R4', 'R4.6 who may call what',
  case when (select count(*) from fns) <> 10 then 'FAIL - not applied yet'
       when not exists (
         select 1 from fns f
          where has_function_privilege('anon', f.oid, 'execute')
                <> (f.proname in ('get_review_invite', 'submit_review', 'issue_review_invite',
                                  'get_owner_reviews', 'reply_to_review', 'report_review'))
             or (f.proname like 'admin_%' and not has_function_privilege('authenticated', f.oid, 'execute')))
       then 'PASS - anon: invite, submit, seller functions | admin: signed-in only | helpers: nobody'
       else 'FAIL - ' || (select string_agg(f.proname || ' anon=' ||
                                 case when has_function_privilege('anon', f.oid, 'execute') then 'yes' else 'no' end,
                                 ', ' order by f.proname)
                            from fns f) end
union all
select 'R4', 'R4.7 submit_review cannot be told the store, product or verified flag',
  coalesce((select case when pg_get_function_identity_arguments(oid) =
                             'p_token text, p_item_index integer, p_rating integer, p_body text, p_display_name text, p_consent_advertising boolean'
                        then 'PASS'
                        else 'FAIL - signature is ' || pg_get_function_identity_arguments(oid) end
              from fns where proname = 'submit_review'), 'FAIL - not applied yet')
union all
select 'R4', 'R4.8 the old hard delete, hide and old-table reader are gone',
  case when to_regprocedure('public.delete_review(text,text,uuid)') is null
        and to_regprocedure('public.set_review_status(text,text,uuid,text)') is null
        and to_regprocedure('public.get_store_reviews(text,text)') is null
       then 'PASS'
       else 'FAIL - still present: ' || concat_ws(', ',
              case when to_regprocedure('public.delete_review(text,text,uuid)') is not null then 'delete_review' end,
              case when to_regprocedure('public.set_review_status(text,text,uuid,text)') is not null then 'set_review_status' end,
              case when to_regprocedure('public.get_store_reviews(text,text)') is not null then 'get_store_reviews' end) end

-- ── R5  nothing disappears ──────────────────────────────────────────────────
union all
select 'R5', 'R5.1 delete is refused on reviews and reports; audit is append-only',
  case when (select count(*) from pg_trigger
              where not tgisinternal and tgenabled <> 'D'
                and tgname in ('product_reviews_no_delete', 'review_reports_no_delete',
                               'review_audit_append_only')) = 3
       then 'PASS' else 'FAIL - a protecting trigger is missing or disabled' end

-- ── R6  what is in there now ────────────────────────────────────────────────
union all
select 'R6', 'R6.1 (info) published · removed · live invites · open reports',
  coalesce((select published || ' · ' || removed || ' · ' || live_invites || ' · ' || open_reports from v),
           'not applied yet')

order by grp, check_name;
