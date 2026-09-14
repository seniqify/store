-- ═══════════════════════════════════════════════════════════════════════════
--  Verified-purchase reviews — READ-ONLY INSPECTION (run BEFORE the migration)
--
--  One single SELECT, so Supabase's editor shows everything at once. Nothing
--  here writes. Paste the whole result back.
--
--  I1–I5  what the old review system exposes today
--  I6–I7  the legacy rows the migration will carry over
--  I8–I13 facts reviews-verified-forward.sql relies on
-- ═══════════════════════════════════════════════════════════════════════════

select 'I1' as grp, 'I1 functions that touch reviews: name · security · search_path · anon can run' as item,
  coalesce((select string_agg(p.proname::text || ' · ' ||
                              case when p.prosecdef then 'definer' else 'invoker' end || ' · ' ||
                              coalesce(array_to_string(p.proconfig, ','), 'unpinned') || ' · anon=' ||
                              case when has_function_privilege('anon', p.oid, 'execute') then 'yes' else 'no' end,
                              ' | ' order by p.proname)
              from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.prokind = 'f' and p.prosrc ilike '%reviews%'),
           'none') as value
union all
select 'I2', 'I2 triggers on public.reviews',
  coalesce((select string_agg(pg_get_triggerdef(tg.oid), ' | ')
              from pg_trigger tg
             where tg.tgrelid = 'public.reviews'::regclass and not tg.tgisinternal), 'none')
union all
select 'I3', 'I3 policies on public.reviews: name [command] roles · using · with check',
  coalesce((select string_agg(policyname || ' [' || cmd || '] ' || array_to_string(roles, ',') ||
                              ' · using ' || coalesce(qual, '-') ||
                              ' · check ' || coalesce(with_check, '-'), ' | ' order by policyname)
              from pg_policies where schemaname = 'public' and tablename = 'reviews'), 'none')
union all
select 'I4', 'I4 client table grants on public.reviews',
  coalesce((select string_agg(grantee || ' ' || privilege_type, ', ' order by grantee, privilege_type)
              from information_schema.role_table_grants
             where table_schema = 'public' and table_name = 'reviews'
               and grantee in ('anon', 'authenticated', 'PUBLIC')), 'none')
union all
select 'I5', 'I5 orders columns anon may INSERT (count · includes status/paid/total)',
  (select count(*)::text || ' · status=' || bool_or(column_name = 'status')::text ||
          ' paid=' || bool_or(column_name = 'paid')::text ||
          ' total=' || bool_or(column_name = 'total')::text
     from information_schema.column_privileges
    where table_schema = 'public' and table_name = 'orders'
      and grantee in ('anon', 'PUBLIC') and privilege_type = 'INSERT')
union all
select 'I6', 'I6 legacy reviews: total · approved · stores · oldest · newest',
  (select count(*)::text || ' · ' || count(*) filter (where status = 'approved')::text || ' · ' ||
          count(distinct store_slug)::text || ' · ' || coalesce(min(created_at)::date::text, '-') ||
          ' · ' || coalesce(max(created_at)::date::text, '-')
     from public.reviews)
union all
select 'I7', 'I7 legacy rows the copy must cope with: null/out-of-range rating · no store · no name',
  (select count(*) filter (where rating is null or rating not between 1 and 5)::text || ' · ' ||
          count(*) filter (where store_slug is null)::text || ' · ' ||
          count(*) filter (where nullif(btrim(customer_name), '') is null)::text
     from public.reviews)
union all
select 'I8', 'I8 public.reviews columns',
  (select string_agg(column_name || ' ' || data_type || case when is_nullable = 'NO' then ' not null' else '' end,
                     ', ' order by ordinal_position)
     from information_schema.columns where table_schema = 'public' and table_name = 'reviews')
union all
select 'I9', 'I9 orders columns the migration reads',
  (select string_agg(column_name || ' ' || data_type, ', ' order by column_name)
     from information_schema.columns
    where table_schema = 'public' and table_name = 'orders'
      and column_name in ('id', 'store_slug', 'status', 'items', 'customer_name', 'customer_phone',
                          'total', 'paid', 'payment_ref', 'payment_method'))
union all
select 'I10', 'I10 pgcrypto schema (must be extensions)',
  coalesce((select n.nspname::text from pg_extension e join pg_namespace n on n.oid = e.extnamespace
             where e.extname = 'pgcrypto'), 'NOT INSTALLED')
union all
select 'I11', 'I11 crm_team admins (who can decide reported reviews)',
  case when to_regclass('public.crm_team') is null then 'crm_team MISSING'
       else (xpath('/row/n/text()', query_to_xml(
              'select count(*) as n from public.crm_team where role = ''admin''', false, true, '')))[1]::text end
union all
select 'I12', 'I12 delivered orders with an amount (could be reviewed straight away)',
  (select count(*)::text from public.orders where status = 'delivered' and coalesce(total, 0) > 0)
union all
select 'I13', 'I13 already present? (must all be no) · PIN fix applied? (must be yes)',
  'product_reviews=' || (to_regclass('public.product_reviews') is not null)::text ||
  ' review_invites=' || (to_regclass('public.review_invites') is not null)::text ||
  ' review_reports=' || (to_regclass('public.review_reports') is not null)::text ||
  ' review_audit=' || (to_regclass('public.review_audit') is not null)::text ||
  ' · pin_attempts.kind=' || exists (select 1 from information_schema.columns
                                      where table_schema = 'public' and table_name = 'pin_attempts'
                                        and column_name = 'kind')::text

order by 1;
