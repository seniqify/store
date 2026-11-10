-- ===========================================================================
--  WhatsApp Coins  --  the WhatsApp tab
--
--  1. ORDER MESSAGES: 500 FREE A MONTH, THEN 1 COIN. The buyer's order message
--     (COD "Confirm my order", or "Payment received" for paid-online orders,
--     sent by send-otp's order-notify) is free for a shop's first 500 each
--     calendar month (IST). After that each one is 1 Coin = Rs 0.50 from the
--     WhatsApp wallet. With no Coins left the message is skipped (never the
--     order) and the order is marked confirm_msg = 'skipped', so the shop sees
--     it and can confirm by hand. Same claim -> send -> finish shape as cart
--     reminders: a charged message that is not sent is refunded; one whose
--     answer never came back is refunded after 30 minutes. Each order gets at
--     most one such message (order-notify called twice no longer sends twice).
--
--  2. BONUS COINS. A top-up carries bonus_paise (set by the wallet-topup edge
--     function from its own pack table, never by the browser). Crediting a
--     paid top-up adds the payment AND the bonus in the same transaction, once.
--
--  Coins are display only: 1 Coin = 50 paise of the existing wallet.
--
--  ORDER: wallet-forward.sql first (checked below). Then this, then
--  whatsapp-coins-verify.sql, then deploy wallet-topup, send-otp, ship-updates.
--  RUN: Supabase Dashboard -> SQL Editor -> paste -> Run. Idempotent.
--  UNDO: supabase/whatsapp-coins-ROLLBACK.sql
-- ===========================================================================

begin;

do $preflight$
begin
  if to_regprocedure('public.verify_store_pin(text,text)') is null then
    raise exception 'preflight: public.verify_store_pin is missing - nothing changed';
  end if;
  if to_regprocedure('public.wallet_debit(text,integer,text,text)') is null
     or to_regprocedure('public.wallet_refund(text,text)') is null
     or to_regprocedure('public.wallet_credit_topup(text,text,integer)') is null then
    raise exception 'preflight: run supabase/wallet-forward.sql first - nothing changed';
  end if;
end;
$preflight$;

-- ---------------------------------------------------------------------------
-- 1. Columns and the order-message ledger
-- ---------------------------------------------------------------------------
alter table public.wallet_topups add column if not exists bonus_paise integer not null default 0;
alter table public.wallet_topups drop constraint if exists wallet_topups_bonus_nonnegative;
alter table public.wallet_topups add constraint wallet_topups_bonus_nonnegative check (bonus_paise >= 0);

alter table public.orders add column if not exists confirm_msg text;
alter table public.orders drop constraint if exists orders_confirm_msg_known;
alter table public.orders add constraint orders_confirm_msg_known
  check (confirm_msg is null or confirm_msg in ('sent', 'failed', 'skipped'));

create table if not exists public.order_messages (
  id               uuid primary key default gen_random_uuid(),
  store_slug       text not null,
  order_id         uuid not null,
  kind             text not null check (kind in ('confirm', 'paid')),
  month            text not null check (month ~ '^[0-9]{4}-[0-9]{2}$'),
  charged          boolean not null default false,
  status           text not null check (status in ('sending', 'sent', 'failed', 'skipped')),
  debit_ref        text unique,
  error            text,
  created_at       timestamptz not null default now(),
  sent_at          timestamptz,
  unique (order_id, kind)
);
create index if not exists order_messages_store_month_idx on public.order_messages (store_slug, month);
alter table public.order_messages enable row level security;
revoke all on public.order_messages from public, anon, authenticated;

create or replace function public.order_message_free_limit()
returns integer
language sql
immutable
set search_path = public, pg_temp
as $function$ select 500 $function$;

-- ---------------------------------------------------------------------------
-- 2. Claim the buyer's order message: free while this month's 500 last, then
--    1 Coin. service_role only (send-otp). One transaction.
-- ---------------------------------------------------------------------------
create or replace function public.order_message_claim(p_order_id uuid, p_kind text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
declare
  a        public.orders%rowtype;
  v_id     uuid := gen_random_uuid();
  v_month  text := to_char(now() at time zone 'Asia/Kolkata', 'YYYY-MM');
  v_used   integer;
  v_ref    text;
  v_debit  jsonb;
begin
  if p_order_id is null or p_kind is null or p_kind not in ('confirm', 'paid') then
    return jsonb_build_object('ok', false, 'reason', 'bad_input');
  end if;
  select * into a from public.orders o where o.id = p_order_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if lower(coalesce(a.status, '')) = 'abandoned' then
    return jsonb_build_object('ok', false, 'reason', 'not_an_order');
  end if;
  -- order-notify runs right after checkout; an old order is never re-messaged.
  if a.created_at < now() - interval '2 hours' then
    return jsonb_build_object('ok', false, 'reason', 'too_old');
  end if;

  -- One shop-month at a time, so two orders cannot both take the 500th free one.
  perform pg_advisory_xact_lock(hashtext('order_msg:' || a.store_slug || ':' || v_month));

  if exists (select 1 from public.order_messages m where m.order_id = a.id) then
    return jsonb_build_object('ok', false, 'reason', 'already');
  end if;

  select count(*)::integer into v_used from public.order_messages m
   where m.store_slug = a.store_slug and m.month = v_month and not m.charged and m.status in ('sending', 'sent');

  if v_used < public.order_message_free_limit() then
    insert into public.order_messages (id, store_slug, order_id, kind, month, charged, status)
    values (v_id, a.store_slug, a.id, p_kind, v_month, false, 'sending');
    return jsonb_build_object('ok', true, 'id', v_id, 'charged', false, 'free_left', public.order_message_free_limit() - v_used - 1);
  end if;

  v_ref := 'order_msg:' || v_id;
  v_debit := public.wallet_debit(a.store_slug, 50, v_ref,
               case p_kind when 'confirm' then 'Order confirmation' else 'Payment received' end
               || ' · ' || left(coalesce(nullif(split_part(trim(coalesce(a.customer_name, '')), ' ', 1), ''), 'customer'), 30));
  if coalesce((v_debit->>'ok')::boolean, false) is not true then
    insert into public.order_messages (id, store_slug, order_id, kind, month, charged, status)
    values (v_id, a.store_slug, a.id, p_kind, v_month, false, 'skipped');
    update public.orders o set confirm_msg = 'skipped' where o.id = a.id;
    return jsonb_build_object('ok', false, 'reason', 'no_coins');
  end if;

  insert into public.order_messages (id, store_slug, order_id, kind, month, charged, status, debit_ref)
  values (v_id, a.store_slug, a.id, p_kind, v_month, true, 'sending', v_ref);
  return jsonb_build_object('ok', true, 'id', v_id, 'charged', true, 'free_left', 0);
end;
$function$;

create or replace function public.order_message_finish(p_id uuid, p_sent boolean, p_error text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
declare
  r public.order_messages%rowtype;
begin
  select * into r from public.order_messages m where m.id = p_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'unknown');
  end if;
  if r.status <> 'sending' then
    return jsonb_build_object('ok', true, 'already', true, 'status', r.status);
  end if;
  if p_sent is true then
    update public.order_messages m set status = 'sent', sent_at = now() where m.id = r.id;
    update public.orders o set confirm_msg = 'sent' where o.id = r.order_id;
  else
    update public.order_messages m set status = 'failed', error = left(coalesce(p_error, ''), 300) where m.id = r.id;
    update public.orders o set confirm_msg = 'failed' where o.id = r.order_id;
    if r.charged and r.debit_ref is not null then
      perform public.wallet_refund(r.debit_ref, 'Order message not sent');
    end if;
  end if;
  return jsonb_build_object('ok', true, 'already', false);
end;
$function$;

create or replace function public.order_messages_expire_stuck()
returns integer
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
declare
  r record;
  n integer := 0;
begin
  for r in select m.id from public.order_messages m
            where m.status = 'sending' and m.created_at < now() - interval '30 minutes'
            for update skip locked loop
    perform public.order_message_finish(r.id, false, 'no result from the sender');
    n := n + 1;
  end loop;
  return n;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 3. The shop's view (PIN-checked): this month's free count and pauses.
-- ---------------------------------------------------------------------------
create or replace function public.get_order_message_usage(p_slug text, p_hashed_pin text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
declare
  v_month text := to_char(now() at time zone 'Asia/Kolkata', 'YYYY-MM');
begin
  if not public.verify_store_pin(p_slug, p_hashed_pin) then
    return null;
  end if;
  return (
    select jsonb_build_object(
      'month', v_month,
      'free_limit', public.order_message_free_limit(),
      'free_used', count(*) filter (where not m.charged and m.status in ('sending', 'sent')),
      'paid', count(*) filter (where m.charged and m.status in ('sending', 'sent')),
      'skipped', count(*) filter (where m.status = 'skipped'),
      'last_skipped_at', max(m.created_at) filter (where m.status = 'skipped'),
      'balance_paise', coalesce((select w.balance_paise from public.store_wallets w where w.store_slug = p_slug), 0))
      from public.order_messages m
     where m.store_slug = p_slug and m.month = v_month);
end;
$function$;

-- ---------------------------------------------------------------------------
-- 4. Crediting a paid top-up now adds its bonus too (same transaction, once).
--    Unchanged otherwise: same checks, same idempotency, same ledger row.
-- ---------------------------------------------------------------------------
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
  v_credit  bigint;
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

  v_credit := v_topup.amount_paise::bigint + coalesce(v_topup.bonus_paise, 0);

  insert into public.store_wallets (store_slug) values (v_topup.store_slug) on conflict (store_slug) do nothing;
  update public.store_wallets w
     set balance_paise = w.balance_paise + v_credit, updated_at = now()
   where w.store_slug = v_topup.store_slug
  returning w.balance_paise into v_balance;

  insert into public.wallet_ledger (store_slug, kind, amount_paise, balance_after_paise, ref, note)
  values (v_topup.store_slug, 'topup', v_credit, v_balance, p_payment_id,
          '₹' || (v_topup.amount_paise / 100) || ' paid'
          || case when coalesce(v_topup.bonus_paise, 0) > 0 then ' · incl. ' || (v_topup.bonus_paise / 50) || ' bonus Coins' else '' end);

  update public.wallet_topups t
     set status = 'paid', razorpay_payment_id = p_payment_id, paid_at = now()
   where t.id = v_topup.id;

  return jsonb_build_object('ok', true, 'already', false, 'balance_paise', v_balance);
end;
$function$;

-- ---------------------------------------------------------------------------
-- 5. Who may call what (by name: Supabase grants new functions to anon).
-- ---------------------------------------------------------------------------
revoke all on function public.order_message_free_limit()                 from public, anon, authenticated;
revoke all on function public.order_message_claim(uuid, text)             from public, anon, authenticated;
revoke all on function public.order_message_finish(uuid, boolean, text)   from public, anon, authenticated;
revoke all on function public.order_messages_expire_stuck()               from public, anon, authenticated;
revoke all on function public.get_order_message_usage(text, text)         from public, anon, authenticated;
revoke all on function public.wallet_credit_topup(text, text, integer)    from public, anon, authenticated;

grant execute on function public.order_message_free_limit()               to service_role;
grant execute on function public.order_message_claim(uuid, text)           to service_role;
grant execute on function public.order_message_finish(uuid, boolean, text) to service_role;
grant execute on function public.order_messages_expire_stuck()             to service_role;
grant execute on function public.get_order_message_usage(text, text)       to anon, authenticated, service_role;
grant execute on function public.wallet_credit_topup(text, text, integer)  to service_role;

commit;
