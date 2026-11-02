-- ===========================================================================
--  Owner phone off the public shop settings  --  VERIFY (read-only)
--
--  Changes nothing. Run after each step; every row should read as below.
--    after step 1:  S1-S6 PASS, S7-S8 FAIL (config still readable: expected)
--    after step 2:  every S row PASS
--  I rows are information only. No phone number is ever shown, only counts.
--
--  RUN: Supabase Dashboard -> SQL Editor -> paste -> Run.
-- ===========================================================================

with
col as (
  select exists (select 1 from pg_attribute
                  where attrelid = 'public.stores'::regclass and attname = 'public_config'
                    and attgenerated = 's' and not attisdropped) as ok
),
-- Which stores columns the marketplace view reads (Postgres's own dependency records).
view_reads as (
  select a.attname
    from pg_depend d
    join pg_rewrite r   on r.oid = d.objid and d.classid = 'pg_rewrite'::regclass
    join pg_attribute a on a.attrelid = d.refobjid and a.attnum = d.refobjsubid
   where r.ev_class = to_regclass('public.marketplace_listing')
     and d.refobjid = 'public.stores'::regclass
),
checks(id, what, result) as (
  select 'S1', 'stores.public_config is a stored generated column',
         case when (select ok from col) then 'PASS' else 'FAIL' end
  union all
  select 'S2', 'no public_config carries ownerPhone',
         case when not (select ok from col) then 'FAIL'
              when (select count(*) from public.stores where (to_jsonb(stores) -> 'public_config') ? 'ownerPhone') = 0 then 'PASS'
              else 'FAIL' end
  union all
  select 'S3', 'public_config = config without ownerPhone, every row',
         case when not (select ok from col) then 'FAIL'
              when (select count(*) from public.stores
                     where (to_jsonb(stores) -> 'public_config') is distinct from (config - 'ownerPhone')) = 0 then 'PASS'
              else 'FAIL' end
  union all
  -- CASE (not AND): the column is checked to exist before its privilege is asked.
  select 'S4', 'anon can read public_config',
         case when not (select ok from col) then 'FAIL'
              when has_column_privilege('anon', 'public.stores', 'public_config', 'SELECT') then 'PASS' else 'FAIL' end
  union all
  select 'S5', 'authenticated can read public_config',
         case when not (select ok from col) then 'FAIL'
              when has_column_privilege('authenticated', 'public.stores', 'public_config', 'SELECT') then 'PASS' else 'FAIL' end
  union all
  select 'S6', 'marketplace_listing reads public_config, not config',
         case when to_regclass('public.marketplace_listing') is null then 'PASS (no view)'
              when exists (select 1 from view_reads where attname = 'config') then 'FAIL' else 'PASS' end
  union all
  select 'S7', 'anon cannot read config (step 2)',
         case when has_column_privilege('anon', 'public.stores', 'config', 'SELECT') then 'FAIL' else 'PASS' end
  union all
  select 'S8', 'authenticated cannot read config (step 2)',
         case when has_column_privilege('authenticated', 'public.stores', 'config', 'SELECT') then 'FAIL' else 'PASS' end
  union all
  select 'S9', 'pin is not readable by anon/authenticated',
         case when has_column_privilege('anon', 'public.stores', 'pin', 'SELECT')
                or has_column_privilege('authenticated', 'public.stores', 'pin', 'SELECT') then 'FAIL' else 'PASS' end
  union all
  select 'S10', 'no row-level policy on stores reads config',
         case when exists (select 1 from pg_policies
                            where schemaname = 'public' and tablename = 'stores'
                              and (coalesce(qual, '') ~ '\mconfig\M' or coalesce(with_check, '') ~ '\mconfig\M'))
              then 'FAIL' else 'PASS' end
  union all
  select 'I1', 'stores whose config has an ownerPhone (count only)',
         (select count(*)::text from public.stores where config ? 'ownerPhone')
  union all
  select 'I2', 'anon table privileges on stores (insert/update/delete)',
         concat_ws(' ',
           case when has_table_privilege('anon', 'public.stores', 'INSERT') then 'INSERT' end,
           case when has_table_privilege('anon', 'public.stores', 'UPDATE') then 'UPDATE' end,
           case when has_table_privilege('anon', 'public.stores', 'DELETE') then 'DELETE' end)
  union all
  select 'I3', 'row-level policies on stores (command: roles)',
         (select string_agg(format('%s %s: %s', policyname, cmd, array_to_string(roles, ',')), ' | ' order by policyname)
            from pg_policies where schemaname = 'public' and tablename = 'stores')
)
select id, what, result from checks order by length(id), id;
