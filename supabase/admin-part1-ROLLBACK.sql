-- ===========================================================================
--  PocketLink Admin part 1  --  ROLLBACK (emergency only)
--
--  Removes the admin functions and the admin team. Opens every paused or
--  deleted shop (admin_status is dropped). KEEPS the audit log table and its
--  rows (only its read policy goes): the record of what was done stays.
--  Plan changes made through Admin stay (they are in stores.config and
--  plan_entitlements like any other plan change).
-- ===========================================================================
begin;

drop function if exists public.admin_set_status(text, text, text, text);
drop function if exists public.admin_set_plan(text, text, timestamptz, text, integer, text);
drop function if exists public.admin_store_update(text, jsonb, text);
drop function if exists public.admin_audit_list(text, timestamptz);
drop function if exists public.admin_billing();
drop function if exists public.admin_home();
drop function if exists public.admin_store(text);
drop function if exists public.admin_stores();
drop function if exists public.admin_store_state(jsonb, text, timestamptz);
drop function if exists public.admin_mask_phone(text);
drop function if exists public.admin_log(text, text, text, jsonb, jsonb, text);
drop function if exists public.admin_me();

drop policy if exists admin_audit_read on public.admin_audit;
drop policy if exists admin_team_read on public.admin_team;
drop function if exists public.admin_require(text);
drop function if exists public.admin_can(text);
drop function if exists public.admin_mfa_ok();
drop function if exists public.admin_role();
drop table if exists public.admin_team;

revoke select (admin_status) on public.stores from anon, authenticated;
alter table public.stores drop constraint if exists stores_admin_status_check;
alter table public.stores drop column if exists admin_status_at;
alter table public.stores drop column if exists admin_status;

commit;
