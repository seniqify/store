-- ===========================================================================
--  Automatic payment status -- SCHEDULE (every 30 minutes)
--
--  Run AFTER payments-automation.sql and AFTER the status-sweep edge function
--  is deployed. Every 30 minutes the database calls status-sweep, which
--  refreshes courier statuses and Razorpay payments for every store, so COD
--  turns collected or returned and online payments confirm even when nobody
--  opens Manage.
--
--  The shared secret is read from public.automation_secrets at run time; it is
--  never written into this file or the job text.
--
--  Re-running replaces the job. To stop it:
--    select cron.unschedule('pocketlink-status-sweep');
-- ===========================================================================

select cron.unschedule(jobid)
  from cron.job
 where jobname = 'pocketlink-status-sweep';

select cron.schedule(
  'pocketlink-status-sweep',
  '*/30 * * * *',
  $job$
    select net.http_post(
      url := 'https://uoyqbexemoheipwrtkcz.supabase.co/functions/v1/status-sweep',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-sweep-secret', (select secret from public.automation_secrets where name = 'status-sweep')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 120000
    );
  $job$
);
