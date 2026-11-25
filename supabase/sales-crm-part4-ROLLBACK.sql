-- ===========================================================================
--  PocketLink Sales CRM part 4  --  ROLLBACK (emergency only)
--
--  Removes what sales-crm-part4-forward.sql added: sign-up codes and
--  referrals, incentives, training and the exam, reports (their rows are
--  lost). Then re-run sales-crm-part3-forward.sql (safe to run twice) to put
--  back the part 3 sign-up capture, win-from-payment and win review.
-- ===========================================================================

select cron.unschedule(jobid) from cron.job
 where jobname in ('sales-incentive-check', 'sales-report-daily', 'sales-report-weekly');

drop function if exists public.sales_report_data(date, date);
drop function if exists public.sales_exam_submit(uuid, jsonb);
drop function if exists public.sales_exam_start();
drop function if exists public.sales_my_link_stats();
drop function if exists public.sales_incentive_set(uuid, text, text);
drop function if exists public.sales_incentive_check(timestamptz);
drop function if exists public.sales_incentive_add(uuid, uuid, text, integer, text, timestamptz);
drop function if exists public.sales_incentive_amount(uuid, text, timestamptz);

drop table if exists public.sales_reports;
drop table if exists public.sales_exam_attempts;
drop table if exists public.sales_exam_questions;
drop table if exists public.sales_training;
drop table if exists public.sales_incentives;
drop table if exists public.sales_referrals;
delete from public.automation_secrets where name = 'sales-report';

drop trigger if exists sales_staff_defaults on public.sales_staff;
drop function if exists public.sales_staff_defaults();
drop index if exists public.sales_staff_ref_code_key;
alter table public.sales_staff drop constraint if exists sales_staff_ref_code_format;
alter table public.sales_staff drop column if exists ref_code;
alter table public.sales_staff drop column if exists must_train;
alter table public.sales_staff drop column if exists qualified_at;
drop function if exists public.sales_new_ref_code();

delete from public.sales_settings where key in ('score', 'work', 'training', 'reports');
alter table public.sales_settings drop constraint if exists sales_settings_key_check;
alter table public.sales_settings add constraint sales_settings_key_check
  check (key in ('auto_assign', 'policies', 'incentive', 'lead_sources', 'ad_spend'));
drop policy if exists sales_settings_read on public.sales_settings;
create policy sales_settings_read on public.sales_settings
  for select to authenticated
  using (public.sales_is_manager()
         or (public.sales_is_staff() and key in ('auto_assign', 'policies', 'incentive')));
