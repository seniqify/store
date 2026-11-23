-- ===========================================================================
--  Paying stores keep their plan  --  ROLLBACK
--  Stops the daily job and removes what subscription-sync-forward.sql added.
--  Plan dates it already moved forward stay as they are (they were paid for).
-- ===========================================================================

select cron.unschedule(jobid)
  from cron.job
 where jobname = 'pocketlink-subscription-sync';

drop function if exists public.extend_store_plan_from_razorpay(text, text, text, text);

delete from public.automation_secrets where name = 'subscription-sync';
