-- ===========================================================================
--  Ask for reviews automatically  --  SCHEDULE (every 15 minutes)
--
--  Run AFTER review-asks-auto-forward.sql (+ verify, all PASS) and AFTER the
--  review-asks edge function is deployed. Until its template secret is set
--  (SENIQIFY_REVIEW_ASK_TEMPLATE_URL) the function claims nothing and charges
--  nobody, so scheduling it early is safe.
--
--  The shared secret is read from public.automation_secrets at run time; it is
--  never written into this file or the job text.
--
--  Re-running replaces the job. EMERGENCY STOP:
--    select cron.unschedule('pocketlink-review-asks');
-- ===========================================================================

select cron.unschedule(jobid)
  from cron.job
 where jobname = 'pocketlink-review-asks';

select cron.schedule(
  'pocketlink-review-asks',
  '*/15 * * * *',
  $job$
    select net.http_post(
      url := 'https://uoyqbexemoheipwrtkcz.supabase.co/functions/v1/review-asks',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-sweep-secret', (select secret from public.automation_secrets where name = 'review-asks')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 120000
    );
  $job$
);
