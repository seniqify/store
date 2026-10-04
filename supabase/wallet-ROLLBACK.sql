-- ===========================================================================
--  WhatsApp message wallet  --  UNDO
--
--  Drops the wallet's six functions and three tables.
--
--  REFUSES if any wallet table holds a row. A row means a shop started or made
--  a payment, or has a balance: that is money and its history, and it is not
--  deleted by a rollback. Settle it first (refund in Razorpay, record it), then
--  clear the rows on purpose.
--
--  REVERT THE APP AND UNDEPLOY wallet-topup FIRST: once they are gone nothing
--  calls these functions.
--
--  RUN: Supabase Dashboard -> SQL Editor -> paste -> Run. Idempotent.
-- ===========================================================================

begin;

do $guard$
declare
  v_rows bigint := 0;
begin
  if to_regclass('public.wallet_ledger') is not null then
    execute 'select count(*) from public.wallet_ledger' into v_rows;
    if v_rows > 0 then
      raise exception 'REFUSED - wallet_ledger has % rows: money has moved. Settle it before removing the wallet.', v_rows;
    end if;
  end if;
  if to_regclass('public.wallet_topups') is not null then
    execute 'select count(*) from public.wallet_topups' into v_rows;
    if v_rows > 0 then
      raise exception 'REFUSED - wallet_topups has % rows: a shop has started a payment. Check each in Razorpay first.', v_rows;
    end if;
  end if;
  if to_regclass('public.store_wallets') is not null then
    execute 'select count(*) from public.store_wallets where balance_paise <> 0' into v_rows;
    if v_rows > 0 then
      raise exception 'REFUSED - % wallets hold a balance.', v_rows;
    end if;
  end if;
end;
$guard$;

drop function if exists public.get_store_wallet(text, text);
drop function if exists public.wallet_adjust(text, integer, text);
drop function if exists public.wallet_refund(text, text);
drop function if exists public.wallet_debit(text, integer, text, text);
drop function if exists public.wallet_credit_topup(text, text, integer);
drop function if exists public.wallet_message_price_paise();

drop table if exists public.wallet_ledger;
drop table if exists public.wallet_topups;
drop table if exists public.store_wallets;

commit;
