-- ===========================================================================
--  UNDO supabase/whatsapp-coins-forward.sql
--
--  Puts wallet_credit_topup back exactly as wallet-forward.sql wrote it (no
--  bonus), and removes the order-message ledger, its functions and the new
--  columns. REFUSES while order_messages holds Coins a shop paid (charged
--  rows): export them first. Run the old send-otp, wallet-topup and
--  ship-updates FIRST, so nothing calls the removed functions.
-- ===========================================================================

begin;

do $guard$
declare
  v_paid bigint := 0;
begin
  if to_regclass('public.order_messages') is not null then
    execute 'select count(*) from public.order_messages where charged' into v_paid;
    if v_paid > 0 then
      raise exception 'REFUSED - order_messages holds % messages shops paid Coins for. Export the rows before removing the table.', v_paid;
    end if;
  end if;
end;
$guard$;

create or replace function public.wallet_credit_topup(p_order_id text, p_payment_id text, p_amount_paise integer)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
declare
  v_topup   public.wallet_topups%rowtype;
  v_balance bigint;
begin
  if coalesce(p_payment_id, '') = '' then
    raise exception 'wallet: a payment id is required';
  end if;

  select * into v_topup from public.wallet_topups t where t.razorpay_order_id = p_order_id for update;
  if not found then
    raise exception 'wallet: unknown top-up order %', p_order_id;
  end if;

  if v_topup.status = 'paid' then
    select w.balance_paise into v_balance from public.store_wallets w where w.store_slug = v_topup.store_slug;
    return jsonb_build_object('ok', true, 'already', true, 'balance_paise', coalesce(v_balance, 0));
  end if;

  if p_amount_paise is distinct from v_topup.amount_paise then
    raise exception 'wallet: paid amount % does not match the top-up amount %', p_amount_paise, v_topup.amount_paise;
  end if;

  insert into public.store_wallets (store_slug) values (v_topup.store_slug) on conflict (store_slug) do nothing;
  update public.store_wallets w
     set balance_paise = w.balance_paise + v_topup.amount_paise, updated_at = now()
   where w.store_slug = v_topup.store_slug
  returning w.balance_paise into v_balance;

  insert into public.wallet_ledger (store_slug, kind, amount_paise, balance_after_paise, ref, note)
  values (v_topup.store_slug, 'topup', v_topup.amount_paise, v_balance, p_payment_id,
          v_topup.messages || ' messages');

  update public.wallet_topups t
     set status = 'paid', razorpay_payment_id = p_payment_id, paid_at = now()
   where t.id = v_topup.id;

  return jsonb_build_object('ok', true, 'already', false, 'balance_paise', v_balance);
end;
$function$;
revoke all on function public.wallet_credit_topup(text, text, integer) from public, anon, authenticated;
grant execute on function public.wallet_credit_topup(text, text, integer) to service_role;

drop function if exists public.get_order_message_usage(text, text);
drop function if exists public.order_messages_expire_stuck();
drop function if exists public.order_message_finish(uuid, boolean, text);
drop function if exists public.order_message_claim(uuid, text);
drop function if exists public.order_message_free_limit();
drop table if exists public.order_messages;

alter table public.orders drop constraint if exists orders_confirm_msg_known;
alter table public.orders drop column if exists confirm_msg;
alter table public.wallet_topups drop constraint if exists wallet_topups_bonus_nonnegative;
alter table public.wallet_topups drop column if exists bonus_paise;

commit;
