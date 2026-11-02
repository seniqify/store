-- ===========================================================================
--  Owner phone off the public shop settings  --  STEP 1 of 2  --  FORWARD
--
--  stores.config carries the owner's sign-up phone (`ownerPhone`). Only the
--  server uses it (domain codes, plan activation), with the service role.
--  But `config` is one of the columns anon and authenticated may read, so the
--  number went out with every shop page and every public read of the table.
--
--  STEP 1 (this file) ONLY ADDS:
--    * stores.public_config -- `config` without ownerPhone, kept in step by the
--      database itself (a stored generated column), readable by anon and
--      authenticated like `config` is today;
--    * marketplace_listing re-pointed at public_config. It is security_invoker
--      (it reads stores as the CALLER), so it must read the column the caller
--      will keep. Its output columns do not change.
--  Nothing is revoked here: `config` stays readable, so the live site keeps
--  working while the new one (which reads `config:public_config`) deploys.
--
--  STEP 2 (owner-phone-private-revoke.sql) takes `config` away from anon and
--  authenticated -- only once the new site is live.
--
--  Writers are untouched: sign-up still inserts `config`; update_store_config
--  and the console RPCs (security definer) still write `config`, which keeps
--  ownerPhone (update_store_config pins it), and public_config follows.
--
--  RUN: Supabase Dashboard -> SQL Editor -> paste -> Run. Idempotent.
--  VERIFY afterwards: supabase/owner-phone-private-verify.sql (S1-S6 PASS)
--  UNDO: supabase/owner-phone-private-ROLLBACK.sql
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. The public copy of config
-- ---------------------------------------------------------------------------
alter table public.stores
  add column if not exists public_config jsonb
  generated always as (config - 'ownerPhone') stored;

comment on column public.stores.public_config is
  'config without the owner''s sign-up phone (ownerPhone). The only config '
  'anon and authenticated may read; maintained by the database.';

grant select (public_config) on public.stores to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. marketplace_listing reads public_config
-- ---------------------------------------------------------------------------
-- The view's own definition is rewritten: every identifier `config` becomes
-- `public_config`; quoted literals ('...') and quoted identifiers ("...") are
-- copied untouched. That is only safe if `config` can mean nothing but
-- stores.config, so it stops if the view reads any other relation that has a
-- config column. Postgres's own dependency records decide, not the text: the
-- checks below require the view to depend on stores.public_config and no
-- longer on stores.config. Already re-pointed: nothing changes.
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
  if v_view is null then
    raise notice 'public.marketplace_listing does not exist: nothing to re-point';
    return;
  end if;
  if exists (
    select 1
      from pg_depend d
      join pg_rewrite r   on r.oid = d.objid and d.classid = 'pg_rewrite'::regclass
      join pg_attribute a on a.attrelid = d.refobjid and a.attname = 'config' and not a.attisdropped
     where r.ev_class = v_view
       and d.refclassid = 'pg_class'::regclass
       and d.refobjid not in ('public.stores'::regclass, v_view)
  ) then
    raise exception 'marketplace_listing reads another relation with a config column; re-point it by hand';
  end if;

  v_def := pg_get_viewdef(v_view, false);
  while i <= length(v_def) loop
    c := substr(v_def, i, 1);
    if c in ('''', '"') then                       -- a quoted literal or identifier: copy as is
      j := i + 1;
      while j <= length(v_def) loop
        if substr(v_def, j, 1) = c then
          exit when substr(v_def, j + 1, 1) <> c;
          j := j + 1;                              -- a doubled quote: still inside
        end if;
        j := j + 1;
      end loop;
      v_new := v_new || substr(v_def, i, j - i + 1);
      i := j + 1;
    elsif c ~ '[A-Za-z_]' then                     -- a word: rename config only
      j := i;
      while j <= length(v_def) and substr(v_def, j, 1) ~ '[A-Za-z0-9_$]' loop j := j + 1; end loop;
      w := substr(v_def, i, j - i);
      v_new := v_new || case when w = 'config' then 'public_config' else w end;
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

-- ---------------------------------------------------------------------------
-- 3. Checked before committing
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from public.stores where public_config ? 'ownerPhone') then
    raise exception 'public_config still carries ownerPhone';
  end if;
  if exists (select 1 from public.stores where public_config is distinct from (config - 'ownerPhone')) then
    raise exception 'public_config differs from config beyond ownerPhone';
  end if;
  if not has_column_privilege('anon', 'public.stores', 'public_config', 'SELECT')
     or not has_column_privilege('authenticated', 'public.stores', 'public_config', 'SELECT') then
    raise exception 'anon/authenticated cannot read public_config';
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
end $$;

commit;
