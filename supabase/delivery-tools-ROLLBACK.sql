-- ===========================================================================
--  UNDO supabase/delivery-tools-forward.sql
--
--  Stops the schedule, then removes the functions, the message ledger and the
--  new columns. REFUSES (and changes nothing) while any of them holds data a
--  shop relies on: messages it paid for, COD marked received, a buyer's
--  missed-delivery answer or a pay-online discount. Export those first.
--  The automation_secrets row 'ship-updates' is left (harmless).
-- ===========================================================================

do $stop$
begin
  if to_regclass('cron.job') is not null then
    perform cron.unschedule(j.jobid) from cron.job j where j.jobname = 'pocketlink-ship-updates';
  end if;
end;
$stop$;

begin;

do $guard$
declare
  v_msgs bigint := 0;
  v_rows bigint := 0;
begin
  if to_regclass('public.shipping_messages') is not null then
    execute 'select count(*) from public.shipping_messages' into v_msgs;
    if v_msgs > 0 then
      raise exception 'REFUSED - shipping_messages holds % messages the shops paid for. The schedule is stopped; export the rows before removing the table.', v_msgs;
    end if;
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'orders' and column_name = 'cod_remitted_at') then
    execute 'select count(*) from public.orders where cod_remitted_at is not null or delivery_choice is not null or prepay_discount is not null'
      into v_rows;
    if v_rows > 0 then
      raise exception 'REFUSED - % orders carry COD-received marks, buyer delivery answers or pay-online discounts. Export them first.', v_rows;
    end if;
  end if;
end;
$guard$;

drop function if exists public.ship_updates_due(integer, timestamptz);
drop function if exists public.ship_update_claim(uuid, text);
drop function if exists public.ship_update_finish(uuid, boolean, integer, text);
drop function if exists public.ship_updates_expire_stuck();
drop function if exists public.set_ship_updates(text, text, boolean, text[]);
drop function if exists public.get_ship_updates(text, text);
drop function if exists public.get_cod_remittance(text, text);
drop function if exists public.mark_cod_remitted(text, text, uuid[], boolean);
drop function if exists public.set_delivery_choice(uuid, text, text);
drop function if exists public.get_delivery_choice(uuid);
drop function if exists public.seller_prepay_discount(text, text, uuid, numeric);
drop function if exists public.ship_update_price_paise();
drop function if exists public.ship_update_event(text);

drop table if exists public.shipping_messages;

alter table public.store_message_settings drop column if exists ship_updates;
alter table public.store_message_settings drop column if exists ship_events;
alter table public.store_message_settings drop column if exists ship_updates_since;

alter table public.orders drop constraint if exists orders_delivery_choice_known;
alter table public.orders drop constraint if exists orders_delivery_choice_address_len;
alter table public.orders drop constraint if exists orders_prepay_discount_positive;
alter table public.orders drop column if exists cod_remitted_at;
alter table public.orders drop column if exists delivery_choice;
alter table public.orders drop column if exists delivery_choice_at;
alter table public.orders drop column if exists delivery_choice_address;
alter table public.orders drop column if exists delivery_choice_sent_at;
alter table public.orders drop column if exists prepay_discount;

commit;
