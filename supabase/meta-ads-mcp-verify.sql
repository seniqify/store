-- ============================================================================
-- Verify supabase/meta-ads-mcp-forward.sql. Read-only.
-- Runs before the migration too: new objects are looked up with to_regclass /
-- to_regprocedure, so a missing object shows pass = false instead of an error.
-- Expected after the migration: every V row pass = true (I rows show counts that
-- should be the same before and after).
-- ============================================================================

with
  sma as (select to_regclass('public.store_meta_accounts') as oid),
  mc  as (select to_regclass('public.meta_campaigns') as oid),
  maa as (select to_regclass('public.meta_ad_actions') as oid),
  setfn   as (select to_regprocedure('public.meta_campaign_set(uuid,jsonb)') as oid),
  claimfn as (select to_regprocedure('public.meta_campaign_claim(uuid,text,jsonb,integer,integer)') as oid)
select check_id, description, pass, detail
from (
  select 'V1' as check_id, 'store_meta_accounts has the 5 new columns' as description,
         (select count(*) = 5 from information_schema.columns
           where table_schema = 'public' and table_name = 'store_meta_accounts'
             and column_name in ('ad_accounts', 'mcp_checked_at', 'mcp_error', 'token_status', 'last_error')) as pass,
         null::text as detail
  union all
  select 'V2', 'token_status is limited to valid / expiring / expired / revoked',
         exists (select 1 from pg_constraint where conname = 'store_meta_accounts_token_status_check'), null
  union all
  select 'V3', 'meta_campaigns has engine, budget_type, media',
         (select count(*) = 3 from information_schema.columns
           where table_schema = 'public' and table_name = 'meta_campaigns'
             and column_name in ('engine', 'budget_type', 'media')), null
  union all
  select 'V4', 'engine and budget_type are constrained',
         (select count(*) = 2 from pg_constraint where conname in ('meta_campaigns_engine_check', 'meta_campaigns_budget_type_check')), null
  union all
  select 'V5', 'meta_campaign_set writes engine, budget_type and media',
         coalesce((select pg_get_functiondef(oid) like '%budget_type%' and pg_get_functiondef(oid) like '%p_patch->''media''%'
                   from setfn where oid is not null), false), null
  union all
  select 'V6', 'meta_campaign_set clears an id when the patch sets it to null',
         coalesce((select pg_get_functiondef(oid) like '%when p_patch ? ''campaign_id'' then%'
                   from setfn where oid is not null), false), null
  union all
  select 'V7', 'anon cannot run meta_campaign_set',
         coalesce((select not has_function_privilege('anon', oid, 'EXECUTE') from setfn where oid is not null), false), null
  union all
  select 'V8', 'authenticated cannot run meta_campaign_set',
         coalesce((select not has_function_privilege('authenticated', oid, 'EXECUTE') from setfn where oid is not null), false), null
  union all
  select 'V9', 'anon cannot run meta_campaign_claim',
         coalesce((select not has_function_privilege('anon', oid, 'EXECUTE') from claimfn where oid is not null), false), null
  union all
  select 'V10', 'authenticated cannot run meta_campaign_claim',
         coalesce((select not has_function_privilege('authenticated', oid, 'EXECUTE') from claimfn where oid is not null), false), null
  union all
  select 'V11', 'meta_ad_actions exists',
         (select oid is not null from maa), null
  union all
  select 'V12', 'meta_ad_actions has row level security on',
         coalesce((select c.relrowsecurity from pg_class c join maa on c.oid = maa.oid), false), null
  union all
  select 'V13', 'meta_ad_actions has no policies (service role only)',
         coalesce((select (select oid from maa) is not null
                     and not exists (select 1 from pg_policy p where p.polrelid = (select oid from maa))), false), null
  union all
  select 'V14', 'anon and authenticated have no access to meta_ad_actions',
         coalesce((select not (has_table_privilege('anon', oid, 'SELECT') or has_table_privilege('anon', oid, 'INSERT')
                           or has_table_privilege('authenticated', oid, 'SELECT') or has_table_privilege('authenticated', oid, 'INSERT'))
                   from maa where oid is not null), false), null
  union all
  select 'V15', 'store_meta_accounts still RLS-locked with no client access',
         coalesce((select c.relrowsecurity
                     and not has_table_privilege('anon', c.oid, 'SELECT')
                     and not has_table_privilege('authenticated', c.oid, 'SELECT')
                   from pg_class c join sma on c.oid = sma.oid), false), null
  union all
  select 'V16', 'meta_campaigns still RLS-locked with no client access',
         coalesce((select c.relrowsecurity
                     and not has_table_privilege('anon', c.oid, 'SELECT')
                     and not has_table_privilege('authenticated', c.oid, 'SELECT')
                   from pg_class c join mc on c.oid = mc.oid), false), null
  union all
  select 'I1', 'info: connections with a stored token (should not change)', true,
         (select count(*)::text from public.store_meta_accounts where access_token is not null)
  union all
  select 'I2', 'info: launch ledger rows by status (should not change)', true,
         (select string_agg(status || '=' || n::text, ', ' order by status)
            from (select status, count(*) as n from public.meta_campaigns group by status) s)
) checks
order by left(check_id, 1) desc, length(check_id), check_id;
