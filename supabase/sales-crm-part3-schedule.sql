-- ===========================================================================
--  PocketLink Sales CRM part 3  --  SCHEDULE
--  Every 5 minutes: move ad leads nobody called in time to the next person.
--  The function does nothing unless the manager set "not called in N minutes"
--  in Assign, and only between 9:30 am and 8 pm India time.
--  Run after sales-crm-part3-forward.sql. Undo: the unschedule line below.
-- ===========================================================================
select cron.unschedule(jobid) from cron.job where jobname = 'sales-rotate-slow-leads';
select cron.schedule('sales-rotate-slow-leads', '*/5 * * * *', 'select public.sales_rotate_slow_leads()');
select jobname, schedule, command, active from cron.job where jobname = 'sales-rotate-slow-leads';
-- Undo: select cron.unschedule('sales-rotate-slow-leads');
