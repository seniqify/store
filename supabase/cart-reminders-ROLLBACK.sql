-- ===========================================================================
--  Automatic cart reminders  --  UNDO
--
--  To STOP sending right now, this is enough (and it is the first step below):
--    select cron.unschedule('pocketlink-cart-reminders');
--
--  This file then removes the feature: the nine functions, both tables and the
--  sweep secret. It REFUSES if any reminder was ever recorded -- those rows are
--  the record of messages the shops paid for (their wallet ledger points at
--  them). Export them first, on purpose.
--
--  REVERT THE APP AND UNDEPLOY cart-reminders FIRST.
--
--  RUN: Supabase Dashboard -> SQL Editor -> paste -> Run. Idempotent.
-- ===========================================================================

-- Stop first, OUTSIDE the transaction below, so sending stops even when the
-- removal itself refuses.
do $stop$
begin
  if to_regclass('cron.job') is not null then
    perform cron.unschedule(j.jobid) from cron.job j where j.jobname = 'pocketlink-cart-reminders';
  end if;
end;
$stop$;

begin;

do $guard$
declare
  v_rows bigint := 0;
begin
  if to_regclass('public.cart_reminders') is not null then
    execute 'select count(*) from public.cart_reminders' into v_rows;
    if v_rows > 0 then
      raise exception 'REFUSED - cart_reminders holds % reminders the shops paid for. The schedule is stopped; export the rows before removing the tables.', v_rows;
    end if;
  end if;
end;
$guard$;

drop function if exists public.get_cart_reminder_summary(text, text);
drop function if exists public.set_cart_reminders(text, text, boolean);
drop function if exists public.get_cart_reminder(text);
drop function if exists public.cart_reminders_expire_stuck();
drop function if exists public.cart_reminder_finish(uuid, boolean, integer, text);
drop function if exists public.cart_reminder_claim(uuid);
drop function if exists public.cart_reminders_due(integer, timestamptz);
drop function if exists public.cart_reminder_param(text, integer, text);

drop table if exists public.cart_reminders;
drop table if exists public.store_message_settings;

delete from public.automation_secrets where name = 'cart-reminders';

commit;
