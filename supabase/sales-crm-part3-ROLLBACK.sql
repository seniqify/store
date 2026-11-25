-- ===========================================================================
--  PocketLink Sales CRM part 3  --  ROLLBACK (emergency only)
--
--  Removes what sales-crm-part3-forward.sql added: lead intake, the lead
--  events log (its rows are lost), the private values table, rotation, win
--  proof (the proof columns and their values are lost; won leads stay won),
--  and puts back lead guard v2. Then re-run sales-crm-part2-forward.sql.
--  Run the unschedule first if sales-crm-part3-schedule.sql was applied.
-- ===========================================================================

select cron.unschedule(jobid) from cron.job where jobname = 'sales-rotate-slow-leads';

do $$
begin
  if to_regclass('public.plan_entitlements') is not null then
    execute 'drop trigger if exists sales_capture_payment on public.plan_entitlements';
  end if;
end $$;

drop function if exists public.sales_capture_payment();
drop function if exists public.sales_win_review(uuid, boolean);
drop function if exists public.sales_pending_wins();
drop function if exists public.sales_win_from_payment(text, timestamptz, timestamptz, timestamptz, boolean);
drop function if exists public.sales_rotate_slow_leads(timestamptz);
drop function if exists public.sales_lead_feed(timestamptz);
drop function if exists public.sales_lead_failed(text, text, text, jsonb);
drop function if exists public.sales_lead_in(text, text, text, text, text, text, text, text, boolean, text, jsonb);
drop function if exists public.sales_callable_at(timestamptz);
drop table if exists public.sales_lead_events;
drop table if exists public.sales_private;

-- Lead guard v2 (as in sales-crm-part2-forward.sql), then the proof columns.
create or replace function public.sales_leads_guard()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $fn$
begin
  new.updated_at := now();
  if current_user = 'authenticated' then
    if tg_op = 'UPDATE' and not public.sales_is_manager() then
      if new.assigned_to is distinct from old.assigned_to then
        raise exception 'only a manager can move a lead' using errcode = '42501';
      end if;
      new.created_by := old.created_by;
      new.hub_lead_id := old.hub_lead_id;
      new.store_slug := old.store_slug;
    end if;
    if tg_op = 'INSERT' then
      new.created_by := auth.uid();
    end if;
  end if;
  return new;
end;
$fn$;

alter table public.sales_leads drop constraint if exists sales_leads_won_proof_check;
alter table public.sales_leads drop column if exists won_proof;
alter table public.sales_leads drop column if exists won_proof_at;
alter table public.sales_leads drop column if exists won_proof_by;

-- Settings back to the part 2 keys (rows with the new keys go first).
delete from public.sales_settings where key in ('lead_sources', 'ad_spend');
alter table public.sales_settings drop constraint if exists sales_settings_key_check;
alter table public.sales_settings add constraint sales_settings_key_check check (key in ('auto_assign', 'policies', 'incentive'));
drop policy if exists sales_settings_read on public.sales_settings;
create policy sales_settings_read on public.sales_settings
  for select to authenticated
  using (public.sales_is_staff());

-- Scoreboard: dropped here. Then run sales-crm-part2-forward.sql again (safe
-- to run twice) to put back the part 2 scoreboard.
drop function if exists public.sales_scoreboard(date, date);
