-- ===========================================================================
--  Owner phone off the public shop settings  --  STEP 1  --  ROLLBACK
--
--  Removes stores.public_config and points marketplace_listing back at config.
--
--  ONLY with BOTH of these true, or shop pages break:
--    * step 2 is undone (owner-phone-private-revoke-ROLLBACK.sql), so anon and
--      authenticated can read config again -- this file refuses otherwise;
--    * the site is back on a build that reads `config` (before the
--      `config:public_config` change) -- SQL cannot see that, so check first.
--  To undo only the privacy change, the step-2 rollback alone is enough.
--
--  RUN: Supabase Dashboard -> SQL Editor -> paste -> Run. Idempotent.
-- ===========================================================================

begin;

do $$
begin
  if not has_column_privilege('anon', 'public.stores', 'config', 'SELECT')
     or not has_column_privilege('authenticated', 'public.stores', 'config', 'SELECT') then
    raise exception 'step 2 is still applied: run owner-phone-private-revoke-ROLLBACK.sql first';
  end if;
end $$;

-- The view back on config: every identifier public_config becomes config, as
-- the forward rewrite did the other way (quoted text copied untouched).
do $$
declare
  v_view regclass := to_regclass('public.marketplace_listing');
  v_def  text;
  v_new  text := '';
  i int := 1;
  j int;
  c text;
  w text;
begin
  if v_view is null then return; end if;
  v_def := pg_get_viewdef(v_view, false);
  while i <= length(v_def) loop
    c := substr(v_def, i, 1);
    if c in ('''', '"') then
      j := i + 1;
      while j <= length(v_def) loop
        if substr(v_def, j, 1) = c then
          exit when substr(v_def, j + 1, 1) <> c;
          j := j + 1;
        end if;
        j := j + 1;
      end loop;
      v_new := v_new || substr(v_def, i, j - i + 1);
      i := j + 1;
    elsif c ~ '[A-Za-z_]' then
      j := i;
      while j <= length(v_def) and substr(v_def, j, 1) ~ '[A-Za-z0-9_$]' loop j := j + 1; end loop;
      w := substr(v_def, i, j - i);
      v_new := v_new || case when w = 'public_config' then 'config' else w end;
      i := j;
    else
      v_new := v_new || c;
      i := i + 1;
    end if;
  end loop;
  if v_new <> v_def then
    execute 'create or replace view public.marketplace_listing with (security_invoker = on) as '
            || regexp_replace(v_new, ';\s*$', '');
  end if;
end $$;

alter table public.stores drop column if exists public_config;

commit;
