-- ===========================================================================
--  WhatsApp message wallet  --  PR 1 of the automatic-messages project
--
--  A shop tops up a prepaid balance with PocketLink (Razorpay, PocketLink's own
--  account -- the same one that bills plans) and every automatic WhatsApp
--  message PocketLink sends for it is paid from that balance. Founder pricing
--  (2026-10-04): Rs 1.50 per marketing message; packs of 100 / 500 / 1,000.
--
--  MONEY RULES, enforced HERE rather than in any client or edge function:
--    * The balance can never go below zero (CHECK), and every change to it is
--      one row in wallet_ledger written in the same transaction, with the
--      balance after it. Sum of the ledger = the balance, always.
--    * A top-up is credited only for a server-created wallet_topups row, only
--      for exactly its amount, and only once (unique Razorpay payment id).
--    * A debit is all-or-nothing (insufficient balance -> nothing changes) and
--      idempotent per message reference; a refund returns exactly that debit,
--      once.
--    * The browser can READ its own wallet with the store PIN and nothing else.
--      Credit, debit, refund and adjust are service_role only: the wallet-topup
--      edge function (after Razorpay confirms the payment) and, from PR 3, the
--      message sender. RLS is on and the tables have no policies, so anon and
--      authenticated cannot touch a row directly.
--
--  Nothing that exists is changed: three new tables, six new functions.
--
--  RUN: Supabase Dashboard -> SQL Editor -> paste -> Run. Idempotent.
--  VERIFY afterwards: supabase/wallet-verify.sql (every C row PASS)
--  UNDO: supabase/wallet-ROLLBACK.sql (refuses once any money is in a wallet)
-- ===========================================================================

begin;

do $preflight$
begin
  if to_regprocedure('public.verify_store_pin(text,text)') is null then
    raise exception 'preflight: public.verify_store_pin(text,text) is missing - nothing changed';
  end if;
end;
$preflight$;

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------
create table if not exists public.store_wallets (
  store_slug     text primary key,
  balance_paise  bigint not null default 0 check (balance_paise >= 0),
  updated_at     timestamptz not null default now()
);

create table if not exists public.wallet_topups (
  id                   uuid primary key default gen_random_uuid(),
  store_slug           text not null,
  razorpay_order_id    text not null unique,
  amount_paise         integer not null check (amount_paise > 0),
  messages             integer not null check (messages > 0),
  status               text not null default 'created' check (status in ('created', 'paid')),
  razorpay_payment_id  text unique,
  created_at           timestamptz not null default now(),
  paid_at              timestamptz
);
create index if not exists wallet_topups_store_idx on public.wallet_topups (store_slug, created_at desc);

create table if not exists public.wallet_ledger (
  id                   bigserial primary key,
  store_slug           text not null,
  kind                 text not null check (kind in ('topup', 'debit', 'refund', 'adjust')),
  amount_paise         bigint not null check (amount_paise <> 0),
  balance_after_paise  bigint not null check (balance_after_paise >= 0),
  ref                  text,
  note                 text,
  created_at           timestamptz not null default now(),
  -- One top-up per payment, one debit per message, one refund per debit.
  unique (kind, ref),
  check (kind = 'adjust' or ref is not null),
  check ((kind in ('topup', 'refund') and amount_paise > 0) or (kind = 'debit' and amount_paise < 0) or kind = 'adjust')
);
create index if not exists wallet_ledger_store_idx on public.wallet_ledger (store_slug, id desc);

alter table public.store_wallets enable row level security;
alter table public.wallet_topups enable row level security;
alter table public.wallet_ledger enable row level security;
revoke all on public.store_wallets, public.wallet_topups, public.wallet_ledger from anon, authenticated;
revoke all on sequence public.wallet_ledger_id_seq from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. The price, in one place. Rs 1.50 per marketing message.
-- ---------------------------------------------------------------------------
create or replace function public.wallet_message_price_paise()
returns integer
language sql
immutable
set search_path = public, pg_temp
as $function$ select 150 $function$;

-- ---------------------------------------------------------------------------
-- 3. Credit a paid top-up. service_role only (the wallet-topup edge function,
--    after Razorpay itself reports the payment captured for this order at this
--    amount). Idempotent: a second call for the same order is a no-op.
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

-- ---------------------------------------------------------------------------
-- 4. Debit one message. service_role only. All or nothing: if the balance
--    cannot cover it, nothing changes and the caller must not send. The same
--    p_ref twice is charged once.
-- ---------------------------------------------------------------------------
create or replace function public.wallet_debit(p_slug text, p_amount_paise integer, p_ref text, p_note text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
declare
  v_balance bigint;
begin
  if coalesce(p_amount_paise, 0) <= 0 then
    raise exception 'wallet: a debit must be a positive amount';
  end if;
  if coalesce(p_ref, '') = '' then
    raise exception 'wallet: a debit needs a message reference';
  end if;

  select w.balance_paise into v_balance from public.store_wallets w where w.store_slug = p_slug for update;

  if exists (select 1 from public.wallet_ledger l where l.kind = 'debit' and l.ref = p_ref) then
    return jsonb_build_object('ok', true, 'already', true, 'balance_paise', coalesce(v_balance, 0));
  end if;

  if v_balance is null or v_balance < p_amount_paise then
    return jsonb_build_object('ok', false, 'reason', 'insufficient', 'balance_paise', coalesce(v_balance, 0));
  end if;

  update public.store_wallets w
     set balance_paise = w.balance_paise - p_amount_paise, updated_at = now()
   where w.store_slug = p_slug
  returning w.balance_paise into v_balance;

  insert into public.wallet_ledger (store_slug, kind, amount_paise, balance_after_paise, ref, note)
  values (p_slug, 'debit', -p_amount_paise, v_balance, p_ref, p_note);

  return jsonb_build_object('ok', true, 'already', false, 'balance_paise', v_balance);
end;
$function$;

-- ---------------------------------------------------------------------------
-- 5. Refund a debit (the message could not be sent). service_role only.
--    Returns exactly what that debit took, once.
-- ---------------------------------------------------------------------------
create or replace function public.wallet_refund(p_ref text, p_note text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
declare
  v_debit   public.wallet_ledger%rowtype;
  v_balance bigint;
begin
  select * into v_debit from public.wallet_ledger l where l.kind = 'debit' and l.ref = p_ref;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_debit');
  end if;

  select w.balance_paise into v_balance from public.store_wallets w where w.store_slug = v_debit.store_slug for update;

  if exists (select 1 from public.wallet_ledger l where l.kind = 'refund' and l.ref = p_ref) then
    return jsonb_build_object('ok', true, 'already', true, 'balance_paise', v_balance);
  end if;

  update public.store_wallets w
     set balance_paise = w.balance_paise - v_debit.amount_paise, updated_at = now()   -- amount is negative
   where w.store_slug = v_debit.store_slug
  returning w.balance_paise into v_balance;

  insert into public.wallet_ledger (store_slug, kind, amount_paise, balance_after_paise, ref, note)
  values (v_debit.store_slug, 'refund', -v_debit.amount_paise, v_balance, p_ref, p_note);

  return jsonb_build_object('ok', true, 'already', false, 'balance_paise', v_balance);
end;
$function$;

-- ---------------------------------------------------------------------------
-- 6. Founder adjustment (free credits, corrections). service_role only, which
--    includes the SQL editor. Cannot take the balance below zero.
-- ---------------------------------------------------------------------------
create or replace function public.wallet_adjust(p_slug text, p_amount_paise integer, p_note text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
declare
  v_balance bigint;
begin
  if coalesce(p_amount_paise, 0) = 0 then
    raise exception 'wallet: an adjustment needs a non-zero amount';
  end if;
  if coalesce(trim(p_note), '') = '' then
    raise exception 'wallet: an adjustment needs a note saying why';
  end if;
  if not exists (select 1 from public.stores s where s.slug = p_slug) then
    raise exception 'wallet: no store %', p_slug;
  end if;

  insert into public.store_wallets (store_slug) values (p_slug) on conflict (store_slug) do nothing;
  update public.store_wallets w
     set balance_paise = w.balance_paise + p_amount_paise, updated_at = now()
   where w.store_slug = p_slug
  returning w.balance_paise into v_balance;            -- the CHECK refuses a negative result

  insert into public.wallet_ledger (store_slug, kind, amount_paise, balance_after_paise, ref, note)
  values (p_slug, 'adjust', p_amount_paise, v_balance, null, p_note);

  return jsonb_build_object('ok', true, 'balance_paise', v_balance);
end;
$function$;

-- ---------------------------------------------------------------------------
-- 7. What the shop sees. PIN-checked like every owner read: a wrong PIN gets
--    null, never an error. Balance, price, the last 20 movements, and how many
--    top-ups are still waiting for Razorpay (the screen then asks the edge
--    function to check them).
-- ---------------------------------------------------------------------------
create or replace function public.get_store_wallet(p_slug text, p_hashed_pin text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
begin
  if not public.verify_store_pin(p_slug, p_hashed_pin) then
    return null;
  end if;

  return jsonb_build_object(
    'balance_paise', coalesce((select w.balance_paise from public.store_wallets w where w.store_slug = p_slug), 0),
    'price_paise',   public.wallet_message_price_paise(),
    'pending_topups', (select count(*) from public.wallet_topups t
                        where t.store_slug = p_slug and t.status = 'created'
                          and t.created_at > now() - interval '7 days'),
    'recent', coalesce((
      select jsonb_agg(jsonb_build_object('kind', l.kind, 'amount_paise', l.amount_paise,
                                          'balance_after_paise', l.balance_after_paise,
                                          'note', l.note, 'created_at', l.created_at) order by l.id desc)
        from (select * from public.wallet_ledger l2 where l2.store_slug = p_slug order by l2.id desc limit 20) l
    ), '[]'::jsonb)
  );
end;
$function$;

-- ---------------------------------------------------------------------------
-- 8. Who may call what
--
-- Revoked from anon and authenticated BY NAME, not only from PUBLIC: Supabase's
-- default privileges grant EXECUTE on every new function in public directly to
-- anon and authenticated, so `revoke ... from public` alone would leave the
-- browser able to call wallet_adjust and print itself money.
-- ---------------------------------------------------------------------------
revoke all on function public.wallet_message_price_paise()                   from public, anon, authenticated;
revoke all on function public.wallet_credit_topup(text, text, integer)       from public, anon, authenticated;
revoke all on function public.wallet_debit(text, integer, text, text)        from public, anon, authenticated;
revoke all on function public.wallet_refund(text, text)                      from public, anon, authenticated;
revoke all on function public.wallet_adjust(text, integer, text)             from public, anon, authenticated;
revoke all on function public.get_store_wallet(text, text)                   from public, anon, authenticated;

grant execute on function public.wallet_message_price_paise()                to anon, authenticated, service_role;
grant execute on function public.wallet_credit_topup(text, text, integer)    to service_role;
grant execute on function public.wallet_debit(text, integer, text, text)     to service_role;
grant execute on function public.wallet_refund(text, text)                   to service_role;
grant execute on function public.wallet_adjust(text, integer, text)          to service_role;
grant execute on function public.get_store_wallet(text, text)                to anon, authenticated, service_role;

commit;
