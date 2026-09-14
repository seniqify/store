-- ===========================================================================
--  Automatic payment status -- ROLLBACK
--
--  Stops the schedule and removes the automation trigger, so courier status no
--  longer changes payment state.
--
--  KEPT, deliberately: the new columns and every value already set (orders the
--  automation marked collected stay collected; delivered_at / returned_at stay),
--  the widened paid_via constraint, and automation_secrets. Removing them would
--  lose real data; old code ignores them.
--
--  RUN: Supabase Dashboard -> SQL Editor -> paste all -> Run.
-- ===========================================================================

select cron.unschedule(jobid)
  from cron.job
 where jobname = 'pocketlink-status-sweep';

begin;
drop trigger if exists orders_payment_automation on public.orders;
drop function if exists public.orders_payment_automation();
commit;
