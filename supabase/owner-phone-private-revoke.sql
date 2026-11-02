-- ===========================================================================
--  Owner phone off the public shop settings  --  STEP 2 of 2  --  FORWARD
--
--  Takes stores.config away from anon and authenticated. From here on the
--  only config they can read is public_config (step 1), which has no ownerPhone.
--
--  RUN ONLY AFTER both of these:
--    * owner-phone-private-forward.sql (step 1) is applied and verified;
--    * the site that reads `config:public_config` is LIVE (an older build
--      still reading `config` would lose every shop page).
--
--  It refuses, and changes nothing, unless step 1 is in place, the marketplace
--  view no longer reads config, and no row-level policy on stores reads config.
--  After the revoke it checks config really is unreadable (a table-level or
--  PUBLIC grant would keep it readable) and rolls back if not.
--
--  RUN: Supabase Dashboard -> SQL Editor -> paste -> Run. Idempotent.
--  VERIFY afterwards: supabase/owner-phone-private-verify.sql (every S row PASS)
--  UNDO (instant): supabase/owner-phone-private-revoke-ROLLBACK.sql
-- ===========================================================================

begin;

do $$
begin
  if not exists (select 1 from pg_attribute
                  where attrelid = 'public.stores'::regclass and attname = 'public_config'
                    and attgenerated = 's' and not attisdropped) then
    raise exception 'step 1 is not applied: run owner-phone-private-forward.sql first';
  end if;
  if not has_column_privilege('anon', 'public.stores', 'public_config', 'SELECT')
     or not has_column_privilege('authenticated', 'public.stores', 'public_config', 'SELECT') then
    raise exception 'anon/authenticated cannot read public_config yet';
  end if;
  if exists (
    select 1
      from pg_depend d
      join pg_rewrite r   on r.oid = d.objid and d.classid = 'pg_rewrite'::regclass
      join pg_attribute a on a.attrelid = d.refobjid and a.attnum = d.refobjsubid
     where r.ev_class = to_regclass('public.marketplace_listing')
       and d.refobjid = 'public.stores'::regclass
       and a.attname = 'config'
  ) then
    raise exception 'marketplace_listing still reads stores.config';
  end if;
  if exists (select 1 from pg_policies
              where schemaname = 'public' and tablename = 'stores'
                and (coalesce(qual, '') ~ '\mconfig\M' or coalesce(with_check, '') ~ '\mconfig\M')) then
    raise exception 'a row-level policy on stores reads config: review it before revoking';
  end if;
end $$;

revoke select (config) on public.stores from anon, authenticated;

do $$
begin
  if has_column_privilege('anon', 'public.stores', 'config', 'SELECT')
     or has_column_privilege('authenticated', 'public.stores', 'config', 'SELECT') then
    raise exception 'config is still readable by anon/authenticated (a table-level or PUBLIC grant?): nothing changed';
  end if;
end $$;

commit;
