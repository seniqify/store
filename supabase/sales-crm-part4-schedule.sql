-- ===========================================================================
--  PocketLink Sales CRM part 4  --  SCHEDULE
--    sales-incentive-check   every day 2:30 am India time: incentives past
--                            their hold are earned or cancelled.
--    sales-report-daily      every day 7:00 pm India time (13:30 UTC).
--    sales-report-weekly     every Monday 9:00 am India time (03:30 UTC),
--                            for the 7 days before.
--  The reports go through the sales-report edge function (x-sweep-secret).
--  Run after sales-crm-part4-forward.sql. Undo: the unschedule lines below.
-- ===========================================================================
select cron.unschedule(jobid) from cron.job
 where jobname in ('sales-incentive-check', 'sales-report-daily', 'sales-report-weekly');

select cron.schedule('sales-incentive-check', '0 21 * * *', 'select public.sales_incentive_check()');

select cron.schedule(
  'sales-report-daily',
  '30 13 * * *',
  $job$
    select net.http_post(
      url := 'https://uoyqbexemoheipwrtkcz.supabase.co/functions/v1/sales-report',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-sweep-secret', (select secret from public.automation_secrets where name = 'sales-report')
      ),
      body := '{"kind":"daily"}'::jsonb,
      timeout_milliseconds := 60000
    );
  $job$
);

select cron.schedule(
  'sales-report-weekly',
  '30 3 * * 1',
  $job$
    select net.http_post(
      url := 'https://uoyqbexemoheipwrtkcz.supabase.co/functions/v1/sales-report',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-sweep-secret', (select secret from public.automation_secrets where name = 'sales-report')
      ),
      body := '{"kind":"weekly"}'::jsonb,
      timeout_milliseconds := 60000
    );
  $job$
);

select jobname, schedule, active from cron.job
 where jobname in ('sales-incentive-check', 'sales-report-daily', 'sales-report-weekly') order by jobname;
-- Undo: select cron.unschedule(jobid) from cron.job where jobname in ('sales-incentive-check', 'sales-report-daily', 'sales-report-weekly');
