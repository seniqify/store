-- ===========================================================================
--  Automatic cart reminders  --  SCHEDULE (every 15 minutes)
--
--  Run AFTER cart-reminders-forward.sql (+ verify, all PASS) and AFTER the
--  cart-reminders edge function is deployed with its template secret.
--
--  Every 15 minutes the database calls cart-reminders, which sends the
--  reminders that are due (only between 09:00 and 21:00 IST -- outside those
--  hours the function finds nothing to send).
--
--  The shared secret is read from public.automation_secrets at run time; it is
--  never written into this file or the job text.
--
--  Re-running replaces the job. EMERGENCY STOP:
--    select cron.unschedule('pocketlink-cart-reminders');
-- ===========================================================================

select cron.unschedule(jobid)
  from cron.job
 where jobname = 'pocketlink-cart-reminders';

select cron.schedule(
  'pocketlink-cart-reminders',
  '*/15 * * * *',
  $job$
    select net.http_post(
      url := 'https://uoyqbexemoheipwrtkcz.supabase.co/functions/v1/cart-reminders',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-sweep-secret', (select secret from public.automation_secrets where name = 'cart-reminders')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 120000
    );
  $job$
);
