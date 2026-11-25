-- ===========================================================================
--  PocketLink Sales CRM part 2  --  ROLLBACK (emergency only)
--
--  Removes what sales-crm-part2-forward.sql added: the sign-up triggers, the
--  scoreboard / auto-assign / review functions, team settings and questions
--  (their rows are lost), the visit review columns and the KPI targets.
--  Leads, calls, visits and attendance stay. The lead guard goes back to v1.
-- ===========================================================================

drop trigger if exists sales_capture_signup on public.stores;
drop trigger if exists sales_capture_pending on public.pending_signups;
drop function if exists public.sales_capture_signup();
drop function if exists public.sales_capture_pending();
drop function if exists public.sales_auto_assign(uuid[]);
drop function if exists public.sales_pick_owner(text);
drop function if exists public.sales_scoreboard(date, date);
drop function if exists public.sales_review(uuid, text);

drop policy if exists sales_activities_review on public.sales_activities;
revoke update (review, reviewed_by, reviewed_at) on public.sales_activities from authenticated;
alter table public.sales_activities drop constraint if exists sales_activities_review_check;
alter table public.sales_activities drop column if exists review;
alter table public.sales_activities drop column if exists reviewed_by;
alter table public.sales_activities drop column if exists reviewed_at;

drop table if exists public.sales_questions;
drop table if exists public.sales_settings;
drop function if exists public.sales_settings_stamp();

alter table public.sales_staff drop constraint if exists sales_staff_targets_object;
alter table public.sales_staff drop column if exists targets;

-- Lead guard v1 (as in sales-crm-forward.sql).
create or replace function public.sales_leads_guard()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $fn$
begin
  new.updated_at := now();
  if tg_op = 'UPDATE' and auth.uid() is not null and not public.sales_is_manager() then
    if new.assigned_to is distinct from old.assigned_to then
      raise exception 'only a manager can move a lead' using errcode = '42501';
    end if;
    new.created_by := old.created_by;
    new.hub_lead_id := old.hub_lead_id;
    new.store_slug := old.store_slug;
  end if;
  if tg_op = 'INSERT' and auth.uid() is not null then
    new.created_by := auth.uid();
  end if;
  return new;
end;
$fn$;
