-- ===========================================================================
--  Paying stores keep their plan  --  SCHEDULE (daily, 09:00 IST)
--
--  Run AFTER subscription-sync-forward.sql (+ verify, all PASS), AFTER the
--  subscription-sync edge function is deployed, and after a dry run looked
--  right. The shared secret is read from public.automation_secrets at run
--  time; it is never written into this file or the job text.
--
--  Re-running replaces the job. EMERGENCY STOP:
--    select cron.unschedule('pocketlink-subscription-sync');
-- ===========================================================================

select cron.unschedule(jobid)
  from cron.job
 where jobname = 'pocketlink-subscription-sync';

select cron.schedule(
  'pocketlink-subscription-sync',
  '30 3 * * *',
  $job$
    select net.http_post(
      url := 'https://uoyqbexemoheipwrtkcz.supabase.co/functions/v1/subscription-sync',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-sweep-secret', (select secret from public.automation_secrets where name = 'subscription-sync')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 120000
    );
  $job$
);
