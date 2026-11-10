-- Run AFTER delivery-tools-forward.sql, its verifier, and deploying the
-- ship-updates edge function (verify_jwt false). Every 10 minutes, the
-- database calls ship-updates with the secret kept in automation_secrets, so
-- the secret never leaves the database. Idempotent.
--
-- EMERGENCY STOP: select cron.unschedule('pocketlink-ship-updates');

select cron.unschedule(jobid)
  from cron.job
 where jobname = 'pocketlink-ship-updates';

select cron.schedule(
  'pocketlink-ship-updates',
  '*/10 * * * *',
  $job$
    select net.http_post(
      url := 'https://uoyqbexemoheipwrtkcz.supabase.co/functions/v1/ship-updates',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-sweep-secret', (select secret from public.automation_secrets where name = 'ship-updates')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 120000
    );
  $job$
);
