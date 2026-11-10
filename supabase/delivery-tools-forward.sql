-- ===========================================================================
--  Delivery tools  --  the redesigned Delivery section
--
--  1. AUTOMATIC SHIPPING UPDATES ON WHATSAPP. When the shop turns them on,
--     PocketLink messages the buyer when the parcel is shipped (picked up),
--     out for delivery, not delivered (a failed attempt), and delivered. Each
--     message is Rs 0.50 from the shop's WhatsApp wallet (wallet-forward.sql).
--     Only orders placed AFTER the shop turned updates on are messaged, only
--     the parcel's CURRENT step is sent (a parcel that jumps from shipped to
--     delivered gets one message), each step at most once per order, and only
--     08:00-21:00 IST. A buyer who said Stop to the shop gets nothing.
--     MONEY: the same claim -> send -> finish shape as cart reminders. The
--     claim debits the wallet in the transaction that records the message;
--     a refused send is refunded; a send whose answer never came back is
--     refunded after 30 minutes.
--
--  2. COD MONEY CHECK. orders.cod_remitted_at: the courier has paid the shop
--     the cash it collected. The shop marks it (by hand or from the courier's
--     remittance report, matched by AWB in the app).
--
--  3. MISSED DELIVERY. When the courier could not deliver, the buyer's order
--     page asks what to do (deliver tomorrow / change address / cancel). The
--     answer is stored on the order for the shop, which sends it on to the
--     courier from Delivery -> Track.
--
--  4. PAY-ONLINE DISCOUNT (RTO protection). The shop may take Rs N off a
--     risky cash-on-delivery order, once, before it ships, and send a payment
--     link for the new total.
--
--  The step a courier status means (ship_update_event) mirrors classifyBucket
--  in src/utils/deliveryStatus.js; tests/delivery-tools.test.mjs runs both
--  over the same statuses.
--
--  ORDER: wallet-forward, messages-v2-forward (whatsapp_opted_out) and
--  cart-reminders-forward (store_message_settings) first -- checked below.
--  Then this, then delivery-tools-verify.sql, then deploy the ship-updates
--  edge function, then delivery-tools-schedule.sql.
--
--  EMERGENCY STOP: select cron.unschedule('pocketlink-ship-updates');
--  RUN: Supabase Dashboard -> SQL Editor -> paste -> Run. Idempotent.
--  UNDO: supabase/delivery-tools-ROLLBACK.sql
-- ===========================================================================

begin;

do $preflight$
begin
  if to_regprocedure('public.verify_store_pin(text,text)') is null then
    raise exception 'preflight: public.verify_store_pin is missing - nothing changed';
  end if;
  if to_regprocedure('public.wallet_debit(text,integer,text,text)') is null
     or to_regprocedure('public.wallet_refund(text,text)') is null then
    raise exception 'preflight: run supabase/wallet-forward.sql first - nothing changed';
  end if;
  if to_regprocedure('public.whatsapp_opted_out(text,text)') is null then
    raise exception 'preflight: run supabase/messages-v2-forward.sql first - nothing changed';
  end if;
  if to_regclass('public.store_message_settings') is null then
    raise exception 'preflight: run supabase/cart-reminders-forward.sql first - nothing changed';
  end if;
  if to_regclass('public.automation_secrets') is null then
    raise exception 'preflight: public.automation_secrets is missing (payments-automation.sql) - nothing changed';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'orders' and column_name = 'confirm_token')
     or not exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'orders' and column_name = 'shipment_outcome') then
    raise exception 'preflight: orders.confirm_token / orders.shipment_outcome missing - nothing changed';
  end if;
end;
$preflight$;

-- ---------------------------------------------------------------------------
-- 1. Columns and the message ledger
-- ---------------------------------------------------------------------------
alter table public.orders add column if not exists cod_remitted_at          timestamptz;
alter table public.orders add column if not exists delivery_choice          text;
alter table public.orders add column if not exists delivery_choice_at       timestamptz;
alter table public.orders add column if not exists delivery_choice_address  text;
alter table public.orders add column if not exists delivery_choice_sent_at  timestamptz;
alter table public.orders add column if not exists prepay_discount          numeric;

alter table public.orders drop constraint if exists orders_delivery_choice_known;
alter table public.orders add constraint orders_delivery_choice_known
  check (delivery_choice is null or delivery_choice in ('reattempt', 'address', 'cancel'));
alter table public.orders drop constraint if exists orders_delivery_choice_address_len;
alter table public.orders add constraint orders_delivery_choice_address_len
  check (delivery_choice_address is null or length(delivery_choice_address) <= 300);
alter table public.orders drop constraint if exists orders_prepay_discount_positive;
alter table public.orders add constraint orders_prepay_discount_positive
  check (prepay_discount is null or prepay_discount > 0);

alter table public.store_message_settings add column if not exists ship_updates       boolean not null default false;
alter table public.store_message_settings add column if not exists ship_events        text[]  not null default array['shipped', 'ofd', 'failed', 'delivered'];
alter table public.store_message_settings add column if not exists ship_updates_since timestamptz;

create table if not exists public.shipping_messages (
  id               uuid primary key default gen_random_uuid(),
  store_slug       text not null,
  order_id         uuid not null,
  event            text not null check (event in ('shipped', 'ofd', 'failed', 'delivered')),
  status           text not null check (status in ('sending', 'sent', 'failed')),
  debit_ref        text not null unique,
  provider_status  integer,
  error            text,
  created_at       timestamptz not null default now(),
  sent_at          timestamptz,
  unique (order_id, event)
);
create index if not exists shipping_messages_store_idx on public.shipping_messages (store_slug, created_at desc);
alter table public.shipping_messages enable row level security;
revoke all on public.shipping_messages from public, anon, authenticated;

insert into public.automation_secrets (name, secret)
values ('ship-updates', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
on conflict (name) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Which buyer message a courier status means. NULL = none (booked, waiting
--    for pickup, cancelled, returning). Mirrors classifyBucket: returns first,
--    then cancelled, delivered, a failed attempt, out for delivery, pickup,
--    and everything in between is "shipped". \y is a word boundary here
--    (\b is backspace in PostgreSQL).
-- ---------------------------------------------------------------------------
create or replace function public.ship_update_event(p_status text)
returns text
language plpgsql
immutable
set search_path = public, pg_temp
as $function$
declare
  raw text := lower(trim(coalesce(p_status, '')));
begin
  if raw = '' then return null; end if;
  if raw ~ '(rto|rts|return|\ylost\y)' then return null; end if;
  if raw ~ 'cancel' then return null; end if;
  if raw ~ '\ydelivered\y' and raw !~ '(undeliver|not deliver)' then return 'delivered'; end if;
  if raw ~ '(not contactable|\ync\y|undeliver|not deliver|unreachable|reattempt|re-attempt|not available|\ycnr\y|\ynpr\y|address|refus|failed|\yhold\y|held|\ypending\y|exception)' then
    return 'failed';
  end if;
  if raw ~ '(out for deliver|\yofd\y|assigned for deliver|dispatch)' then return 'ofd'; end if;
  if raw ~ '(\ynew\y|manifest|seller pickup|out for pickup|\yofp\y|not picked|awaiting pickup|scheduled|assigned for seller)' then
    return null;
  end if;
  return 'shipped';
end;
$function$;

create or replace function public.ship_update_price_paise()
returns integer
language sql
immutable
set search_path = public, pg_temp
as $function$ select 50 $function$;

-- ---------------------------------------------------------------------------
-- 3. The sweep's list: orders whose CURRENT step has a message not yet sent.
--    service_role only. p_now exists so tests can pin the clock.
-- ---------------------------------------------------------------------------
create or replace function public.ship_updates_due(p_limit integer default 200, p_now timestamptz default now())
returns table (order_id uuid, event text)
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  select o.id, e.event
    from public.store_message_settings s
    join public.store_wallets w on w.store_slug = s.store_slug and w.balance_paise >= public.ship_update_price_paise()
    join public.orders o on o.store_slug = s.store_slug
    cross join lateral (select public.ship_update_event(o.shipment_status) as event) e
   where s.ship_updates
     and s.ship_updates_since is not null
     and extract(hour from p_now at time zone 'Asia/Kolkata') between 8 and 20
     and o.awb is not null
     and o.created_at >= s.ship_updates_since
     and o.created_at > p_now - interval '30 days'
     and lower(coalesce(o.status, '')) not in ('cancelled', 'abandoned')
     and coalesce(o.customer_phone, '') ~ '^[6-9][0-9]{9}$'
     and e.event is not null
     and e.event = any (s.ship_events)
     and not exists (select 1 from public.shipping_messages m where m.order_id = o.id and m.event = e.event)
   order by o.created_at
   limit greatest(coalesce(p_limit, 200), 0)
$function$;

-- ---------------------------------------------------------------------------
-- 4. Claim one: re-check under a per-order lock, debit Rs 0.50, record, and
--    hand back exactly what to send. One transaction. service_role only.
-- ---------------------------------------------------------------------------
create or replace function public.ship_update_claim(p_order_id uuid, p_event text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
declare
  a        public.orders%rowtype;
  s        public.store_message_settings%rowtype;
  v_id     uuid := gen_random_uuid();
  v_ref    text;
  v_debit  jsonb;
  v_store  text;
  v_name   text;
  v_link   text;
  v_amount text;
  v_values jsonb;
begin
  perform pg_advisory_xact_lock(hashtext('ship_update:' || coalesce(p_order_id::text, '')));

  select * into a from public.orders o where o.id = p_order_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_order');
  end if;
  select * into s from public.store_message_settings m where m.store_slug = a.store_slug;
  if not found or not s.ship_updates or s.ship_updates_since is null or not (p_event = any (s.ship_events)) then
    return jsonb_build_object('ok', false, 'reason', 'off');
  end if;
  if a.created_at < s.ship_updates_since then
    return jsonb_build_object('ok', false, 'reason', 'before_on');
  end if;
  if a.awb is null or lower(coalesce(a.status, '')) in ('cancelled', 'abandoned') then
    return jsonb_build_object('ok', false, 'reason', 'not_shipping');
  end if;
  if public.ship_update_event(a.shipment_status) is distinct from p_event then
    return jsonb_build_object('ok', false, 'reason', 'moved_on');
  end if;
  if coalesce(a.customer_phone, '') !~ '^[6-9][0-9]{9}$' then
    return jsonb_build_object('ok', false, 'reason', 'bad_phone');
  end if;
  if a.confirm_token is null then
    return jsonb_build_object('ok', false, 'reason', 'no_link');
  end if;
  if exists (select 1 from public.shipping_messages m where m.order_id = a.id and m.event = p_event) then
    return jsonb_build_object('ok', false, 'reason', 'already');
  end if;
  if public.whatsapp_opted_out(a.store_slug, a.customer_phone) then
    return jsonb_build_object('ok', false, 'reason', 'opted_out');
  end if;

  select coalesce(nullif(trim(st.config->>'businessName'), ''), a.store_slug)
    into v_store from public.stores st where st.slug = a.store_slug;
  v_store := left(trim(regexp_replace(coalesce(v_store, a.store_slug), '\s+', ' ', 'g')), 60);
  v_name := left(split_part(trim(regexp_replace(coalesce(a.customer_name, ''), '\s+', ' ', 'g')), ' ', 1), 40);
  v_name := coalesce(nullif(v_name, ''), 'there');
  v_link := 'order/' || a.confirm_token::text;
  v_amount := case
    when lower(coalesce(a.payment_method, '')) = 'cod' and not coalesce(a.paid, false) and coalesce(a.total, 0) > 0
      then '₹' || case when a.total = trunc(a.total) then trunc(a.total)::bigint::text else to_char(a.total, 'FM9999999990.00') end
    else '₹0 (already paid)' end;

  v_values := case p_event
    when 'shipped' then jsonb_build_object('1', v_name, '2', v_store,
                          '3', case when lower(coalesce(a.courier, '')) = 'shadowfax' then 'Shadowfax' else 'Delhivery' end,
                          '4', left(a.awb, 40), '5', v_link)
    when 'ofd'     then jsonb_build_object('1', v_name, '2', v_store, '3', v_amount, '4', v_link)
    else                jsonb_build_object('1', v_name, '2', v_store, '3', v_link)
  end;

  v_ref := 'ship_update:' || v_id;
  v_debit := public.wallet_debit(a.store_slug, public.ship_update_price_paise(), v_ref,
                                 left('Shipping update · ' || p_event || ' · ' || v_name, 60));
  if coalesce((v_debit->>'ok')::boolean, false) is not true then
    return jsonb_build_object('ok', false, 'reason', 'no_balance');
  end if;

  insert into public.shipping_messages (id, store_slug, order_id, event, status, debit_ref)
  values (v_id, a.store_slug, a.id, p_event, 'sending', v_ref);

  return jsonb_build_object('ok', true, 'message_id', v_id, 'event', p_event,
                            'receiver', '91' || a.customer_phone, 'values', v_values);
end;
$function$;

-- ---------------------------------------------------------------------------
-- 5. Record the provider's answer; a refused message is refunded. service_role.
-- ---------------------------------------------------------------------------
create or replace function public.ship_update_finish(p_message_id uuid, p_sent boolean, p_provider_status integer, p_error text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
declare
  r public.shipping_messages%rowtype;
begin
  select * into r from public.shipping_messages m where m.id = p_message_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'unknown');
  end if;
  if r.status <> 'sending' then
    return jsonb_build_object('ok', true, 'already', true, 'status', r.status);
  end if;
  if p_sent is true then
    update public.shipping_messages m set status = 'sent', sent_at = now(), provider_status = p_provider_status where m.id = r.id;
  else
    update public.shipping_messages m
       set status = 'failed', provider_status = p_provider_status, error = left(coalesce(p_error, ''), 300)
     where m.id = r.id;
    perform public.wallet_refund(r.debit_ref, 'Shipping update not sent');
  end if;
  return jsonb_build_object('ok', true, 'already', false, 'status', case when p_sent is true then 'sent' else 'failed' end);
end;
$function$;

create or replace function public.ship_updates_expire_stuck()
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
  for r in select m.id from public.shipping_messages m
            where m.status = 'sending' and m.created_at < now() - interval '30 minutes'
            for update skip locked loop
    perform public.ship_update_finish(r.id, false, null, 'no result from the sender');
    n := n + 1;
  end loop;
  return n;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 6. The shop's switch and its results (PIN-checked).
-- ---------------------------------------------------------------------------
create or replace function public.set_ship_updates(p_slug text, p_hashed_pin text, p_enabled boolean, p_events text[])
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
declare
  v_events text[];
begin
  if not public.verify_store_pin(p_slug, p_hashed_pin) then
    return null;
  end if;
  if p_enabled is null then
    return jsonb_build_object('ok', false, 'reason', 'bad_input');
  end if;
  select coalesce(array_agg(distinct e order by e), '{}') into v_events
    from unnest(coalesce(p_events, array['shipped', 'ofd', 'failed', 'delivered'])) e
   where e in ('shipped', 'ofd', 'failed', 'delivered');

  insert into public.store_message_settings (store_slug, ship_updates, ship_events, ship_updates_since, updated_at)
  values (p_slug, p_enabled, v_events, case when p_enabled then now() end, now())
  on conflict (store_slug) do update
     set ship_updates = excluded.ship_updates,
         ship_events = excluded.ship_events,
         -- Turning it on starts a new "since": orders placed while it was off
         -- are never messaged later.
         ship_updates_since = case when excluded.ship_updates and not public.store_message_settings.ship_updates
                                   then now()
                                   else public.store_message_settings.ship_updates_since end,
         updated_at = now();
  return jsonb_build_object('ok', true, 'enabled', p_enabled, 'events', to_jsonb(v_events));
end;
$function$;

create or replace function public.get_ship_updates(p_slug text, p_hashed_pin text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
declare
  s public.store_message_settings%rowtype;
begin
  if not public.verify_store_pin(p_slug, p_hashed_pin) then
    return null;
  end if;
  select * into s from public.store_message_settings m where m.store_slug = p_slug;
  return jsonb_build_object(
    'enabled', coalesce(s.ship_updates, false),
    'events', to_jsonb(coalesce(s.ship_events, array['shipped', 'ofd', 'failed', 'delivered'])),
    'since', s.ship_updates_since,
    'price_paise', public.ship_update_price_paise(),
    'sent_30d', (select count(*) from public.shipping_messages m
                  where m.store_slug = p_slug and m.status = 'sent' and m.created_at > now() - interval '30 days'),
    'recent', coalesce((select jsonb_agg(jsonb_build_object('order_id', x.order_id, 'event', x.event, 'status', x.status, 'at', x.created_at)
                                         order by x.created_at desc)
                          from (select m.order_id, m.event, m.status, m.created_at from public.shipping_messages m
                                 where m.store_slug = p_slug order by m.created_at desc limit 300) x), '[]'::jsonb));
end;
$function$;

-- ---------------------------------------------------------------------------
-- 7. COD money: what the couriers still owe, and marking it received.
-- ---------------------------------------------------------------------------
create or replace function public.get_cod_remittance(p_slug text, p_hashed_pin text)
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
    'owed', coalesce((select jsonb_agg(jsonb_build_object(
                         'id', o.id, 'name', o.customer_name, 'courier', lower(coalesce(o.courier, 'delhivery')),
                         'awb', o.awb, 'amount', o.total, 'delivered_at', o.paid_at) order by o.paid_at)
                        from public.orders o
                       where o.store_slug = p_slug and o.paid_via = 'cod_delivery' and o.awb is not null
                         and o.cod_remitted_at is null and o.paid_at > now() - interval '45 days'), '[]'::jsonb),
    'received_month', coalesce((select sum(o.total) from public.orders o
                                 where o.store_slug = p_slug and o.cod_remitted_at is not null
                                   and o.cod_remitted_at >= date_trunc('month', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata'), 0),
    'received_month_count', (select count(*) from public.orders o
                              where o.store_slug = p_slug and o.cod_remitted_at is not null
                                and o.cod_remitted_at >= date_trunc('month', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata'));
end;
$function$;

create or replace function public.mark_cod_remitted(p_slug text, p_hashed_pin text, p_order_ids uuid[], p_received boolean default true)
returns integer
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
declare
  n integer;
begin
  if not public.verify_store_pin(p_slug, p_hashed_pin) then
    return null;
  end if;
  update public.orders o
     set cod_remitted_at = case when coalesce(p_received, true) then now() else null end
   where o.store_slug = p_slug
     and o.id = any (coalesce(p_order_ids, '{}'))
     and o.paid_via = 'cod_delivery' and o.awb is not null
     and (o.cod_remitted_at is null) = coalesce(p_received, true);
  get diagnostics n = row_count;
  return n;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 8. Missed delivery: the buyer's answer, from the order page. The token is
--    the credential (as for confirm_order_by_token). Only while the courier's
--    latest word is a failed attempt.
-- ---------------------------------------------------------------------------
create or replace function public.set_delivery_choice(p_token uuid, p_choice text, p_address text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
declare
  a       public.orders%rowtype;
  v_addr  text := nullif(left(trim(regexp_replace(coalesce(p_address, ''), '\s+', ' ', 'g')), 300), '');
begin
  if p_token is null or p_choice is null or p_choice not in ('reattempt', 'address', 'cancel') then
    return jsonb_build_object('ok', false, 'reason', 'bad_input');
  end if;
  if p_choice = 'address' and (v_addr is null or length(v_addr) < 10) then
    return jsonb_build_object('ok', false, 'reason', 'need_address');
  end if;
  select * into a from public.orders o where o.confirm_token = p_token for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if a.awb is null or a.shipment_outcome is not null or lower(coalesce(a.status, '')) in ('cancelled', 'abandoned')
     or public.ship_update_event(a.shipment_status) is distinct from 'failed' then
    return jsonb_build_object('ok', false, 'reason', 'not_now');
  end if;
  update public.orders o
     set delivery_choice = p_choice, delivery_choice_at = now(),
         delivery_choice_address = case when p_choice = 'address' then v_addr end,
         delivery_choice_sent_at = null
   where o.id = a.id;
  return jsonb_build_object('ok', true, 'choice', p_choice);
end;
$function$;

create or replace function public.get_delivery_choice(p_token uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  select jsonb_build_object(
           'can_choose', o.awb is not null and o.shipment_outcome is null
                         and lower(coalesce(o.status, '')) not in ('cancelled', 'abandoned')
                         and public.ship_update_event(o.shipment_status) is not distinct from 'failed',
           'choice', o.delivery_choice, 'at', o.delivery_choice_at, 'sent', o.delivery_choice_sent_at is not null)
    from public.orders o where o.confirm_token = p_token
$function$;

-- ---------------------------------------------------------------------------
-- 9. Pay-online discount: once per order, cash on delivery, unpaid, not
--    shipped. Lowers the total, so the payment link asks for the new amount.
-- ---------------------------------------------------------------------------
create or replace function public.seller_prepay_discount(p_slug text, p_hashed_pin text, p_order_id uuid, p_discount numeric)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
declare
  a public.orders%rowtype;
begin
  if not public.verify_store_pin(p_slug, p_hashed_pin) then
    return null;
  end if;
  select * into a from public.orders o where o.id = p_order_id and o.store_slug = p_slug for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if a.prepay_discount is not null then
    return jsonb_build_object('ok', true, 'already', true, 'total', a.total, 'discount', a.prepay_discount);
  end if;
  if lower(coalesce(a.payment_method, '')) <> 'cod' or coalesce(a.paid, false) or a.awb is not null
     or lower(coalesce(a.status, '')) in ('cancelled', 'abandoned', 'delivered') then
    return jsonb_build_object('ok', false, 'reason', 'not_allowed');
  end if;
  if p_discount is null or p_discount < 1 or p_discount <> trunc(p_discount) or p_discount > 500
     or coalesce(a.total, 0) - p_discount < 1 then
    return jsonb_build_object('ok', false, 'reason', 'bad_amount');
  end if;
  update public.orders o set total = a.total - p_discount, prepay_discount = p_discount where o.id = a.id;
  return jsonb_build_object('ok', true, 'already', false, 'total', a.total - p_discount, 'discount', p_discount);
end;
$function$;

-- ---------------------------------------------------------------------------
-- 10. Who may call what. Revoked from anon/authenticated BY NAME: Supabase's
--     default privileges grant them EXECUTE on every new function.
-- ---------------------------------------------------------------------------
revoke all on function public.ship_update_event(text)                         from public, anon, authenticated;
revoke all on function public.ship_update_price_paise()                       from public, anon, authenticated;
revoke all on function public.ship_updates_due(integer, timestamptz)          from public, anon, authenticated;
revoke all on function public.ship_update_claim(uuid, text)                   from public, anon, authenticated;
revoke all on function public.ship_update_finish(uuid, boolean, integer, text) from public, anon, authenticated;
revoke all on function public.ship_updates_expire_stuck()                     from public, anon, authenticated;
revoke all on function public.set_ship_updates(text, text, boolean, text[])   from public, anon, authenticated;
revoke all on function public.get_ship_updates(text, text)                    from public, anon, authenticated;
revoke all on function public.get_cod_remittance(text, text)                  from public, anon, authenticated;
revoke all on function public.mark_cod_remitted(text, text, uuid[], boolean)  from public, anon, authenticated;
revoke all on function public.set_delivery_choice(uuid, text, text)           from public, anon, authenticated;
revoke all on function public.get_delivery_choice(uuid)                       from public, anon, authenticated;
revoke all on function public.seller_prepay_discount(text, text, uuid, numeric) from public, anon, authenticated;

grant execute on function public.ship_update_event(text)                         to service_role;
grant execute on function public.ship_update_price_paise()                       to service_role;
grant execute on function public.ship_updates_due(integer, timestamptz)          to service_role;
grant execute on function public.ship_update_claim(uuid, text)                   to service_role;
grant execute on function public.ship_update_finish(uuid, boolean, integer, text) to service_role;
grant execute on function public.ship_updates_expire_stuck()                     to service_role;
grant execute on function public.set_ship_updates(text, text, boolean, text[])   to anon, authenticated, service_role;
grant execute on function public.get_ship_updates(text, text)                    to anon, authenticated, service_role;
grant execute on function public.get_cod_remittance(text, text)                  to anon, authenticated, service_role;
grant execute on function public.mark_cod_remitted(text, text, uuid[], boolean)  to anon, authenticated, service_role;
grant execute on function public.set_delivery_choice(uuid, text, text)           to anon, authenticated, service_role;
grant execute on function public.get_delivery_choice(uuid)                       to anon, authenticated, service_role;
grant execute on function public.seller_prepay_discount(text, text, uuid, numeric) to anon, authenticated, service_role;

commit;
