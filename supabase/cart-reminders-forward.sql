-- ===========================================================================
--  Automatic cart reminders  --  PR 3 of the automatic-messages project
--
--  About an hour after a customer leaves checkout without ordering, PocketLink
--  sends them ONE WhatsApp (Seniqify template "cart reminder v1", MARKETING):
--
--    Hi {{1}}, you left {{2}} in your cart at {{3}} (₹{{4}}). Your items are
--    still saved — tap below to finish your order in under a minute.
--    [Complete my order]  -> https://www.pocketlink.store/{{5}}  ({{5}} = cart/<token>)
--
--  The shop turns it on in the Abandoned tab and pays Rs 1.50 per message from
--  its wallet (supabase/wallet-forward.sql). The link reopens the shop with the
--  same items in the cart.
--
--  WHO GETS ONE — every rule below is checked when the sweep lists candidates
--  AND again, under a per-customer lock, at the moment one is claimed:
--    * the shop has reminders ON and at least one message in its wallet;
--    * the customer agreed to WhatsApp offers from THIS shop
--      (whatsapp_consent_granted, supabase/whatsapp-consent-forward.sql);
--    * their LATEST abandoned checkout is between 60 minutes and 24 hours old,
--      with a valid Indian mobile;
--    * they have NOT ordered since (any non-abandoned status — the app's rule);
--    * they had no reminder from this shop in the last 7 days;
--    * it is 09:00-21:00 IST. A cart left at 11 pm is reminded the next morning
--      (still inside 24 hours), never at midnight.
--
--  MONEY: claiming a reminder debits the wallet in the same transaction that
--  records it, so two sweeps can never charge twice. A message the provider
--  refuses is refunded (cart_reminder_finish), and one whose result never came
--  back is refunded after 30 minutes (cart_reminders_expire_stuck).
--
--  Nothing that exists is changed: two tables, nine functions, one row in
--  automation_secrets.
--
--  ORDER: wallet-forward.sql and whatsapp-consent-forward.sql first (checked
--  below). Then this, then cart-reminders-verify.sql, then deploy the
--  cart-reminders edge function, then cart-reminders-schedule.sql.
--
--  EMERGENCY STOP (no SQL file needed):
--    select cron.unschedule('pocketlink-cart-reminders');
--
--  RUN: Supabase Dashboard -> SQL Editor -> paste -> Run. Idempotent.
--  UNDO: supabase/cart-reminders-ROLLBACK.sql
-- ===========================================================================

begin;

do $preflight$
begin
  if to_regprocedure('public.verify_store_pin(text,text)') is null then
    raise exception 'preflight: public.verify_store_pin is missing - nothing changed';
  end if;
  if to_regprocedure('public.wallet_debit(text,integer,text,text)') is null
     or to_regprocedure('public.wallet_refund(text,text)') is null
     or to_regprocedure('public.wallet_message_price_paise()') is null then
    raise exception 'preflight: run supabase/wallet-forward.sql first - nothing changed';
  end if;
  if to_regprocedure('public.whatsapp_consent_granted(text,text)') is null then
    raise exception 'preflight: run supabase/whatsapp-consent-forward.sql first - nothing changed';
  end if;
  if to_regclass('public.automation_secrets') is null then
    raise exception 'preflight: public.automation_secrets is missing (payments-automation.sql) - nothing changed';
  end if;
end;
$preflight$;

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------
create table if not exists public.store_message_settings (
  store_slug      text primary key,
  cart_reminders  boolean not null default false,
  updated_at      timestamptz not null default now()
);

create table if not exists public.cart_reminders (
  id                  uuid primary key default gen_random_uuid(),
  store_slug          text not null,
  phone               text not null,
  abandoned_order_id  uuid not null unique,
  token               text not null unique,
  status              text not null check (status in ('sending', 'sent', 'failed')),
  debit_ref           text not null unique,
  provider_status     integer,
  error               text,
  created_at          timestamptz not null default now(),
  sent_at             timestamptz,
  clicked_at          timestamptz
);
create index if not exists cart_reminders_customer_idx on public.cart_reminders (store_slug, phone, created_at desc);
create index if not exists cart_reminders_status_idx   on public.cart_reminders (status, created_at);

alter table public.store_message_settings enable row level security;
alter table public.cart_reminders         enable row level security;
revoke all on public.store_message_settings, public.cart_reminders from public, anon, authenticated;

insert into public.automation_secrets (name, secret)
values ('cart-reminders', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
on conflict (name) do nothing;

-- ---------------------------------------------------------------------------
-- 2. A WhatsApp template value: no line breaks or tabs, no runs of spaces,
--    never empty (Meta rejects both), capped.
-- ---------------------------------------------------------------------------
create or replace function public.cart_reminder_param(p_value text, p_max integer, p_fallback text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $function$
  select coalesce(
    nullif(left(trim(regexp_replace(coalesce(p_value, ''), '\s+', ' ', 'g')), p_max), ''),
    p_fallback)
$function$;

-- ---------------------------------------------------------------------------
-- 3. The sweep's candidate list. service_role only. p_now exists so tests can
--    pin the clock; production never passes it.
-- ---------------------------------------------------------------------------
create or replace function public.cart_reminders_due(p_limit integer default 50, p_now timestamptz default now())
returns table (abandoned_order_id uuid)
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  select x.id
    from (
      select distinct on (a.store_slug, a.customer_phone) a.id, a.store_slug, a.customer_phone, a.created_at
        from public.orders a
       where lower(coalesce(a.status, '')) = 'abandoned'
         and a.created_at > p_now - interval '24 hours'
         and a.customer_phone ~ '^[6-9][0-9]{9}$'
       order by a.store_slug, a.customer_phone, a.created_at desc, a.id desc
    ) x
    join public.store_message_settings s on s.store_slug = x.store_slug and s.cart_reminders
    join public.store_wallets w on w.store_slug = x.store_slug
                               and w.balance_paise >= public.wallet_message_price_paise()
   where extract(hour from p_now at time zone 'Asia/Kolkata') >= 9
     and extract(hour from p_now at time zone 'Asia/Kolkata') < 21
     and x.created_at <= p_now - interval '60 minutes'
     and not exists (select 1 from public.cart_reminders r where r.abandoned_order_id = x.id)
     and not exists (select 1 from public.cart_reminders r
                      where r.store_slug = x.store_slug and r.phone = x.customer_phone
                        and r.created_at > p_now - interval '7 days')
     and not exists (select 1 from public.orders o
                      where o.store_slug = x.store_slug and o.customer_phone = x.customer_phone
                        and lower(coalesce(o.status, '')) <> 'abandoned'
                        and o.created_at >= x.created_at)
     and public.whatsapp_consent_granted(x.store_slug, x.customer_phone)
   order by x.created_at
   limit greatest(1, least(coalesce(p_limit, 50), 200))
$function$;

-- ---------------------------------------------------------------------------
-- 4. Claim one: re-check every rule under a per-customer lock, debit the
--    wallet, record the reminder, and hand back exactly what to send. One
--    transaction: if anything fails, nothing is charged and nothing recorded.
--    service_role only.
-- ---------------------------------------------------------------------------
create or replace function public.cart_reminder_claim(p_abandoned_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
declare
  a        public.orders%rowtype;
  v_id     uuid := gen_random_uuid();
  v_token  text := left(replace(gen_random_uuid()::text, '-', ''), 20);
  v_ref    text;
  v_debit  jsonb;
  v_store  text;
  v_name   text;
  v_first  text;
  v_lines  integer;
  v_items  text;
  v_total  text;
begin
  select * into a from public.orders o where o.id = p_abandoned_id;
  if not found or lower(coalesce(a.status, '')) <> 'abandoned' then
    return jsonb_build_object('ok', false, 'reason', 'not_abandoned');
  end if;
  if coalesce(a.customer_phone, '') !~ '^[6-9][0-9]{9}$' then
    return jsonb_build_object('ok', false, 'reason', 'bad_phone');
  end if;

  -- One customer of one shop at a time: two sweeps cannot both pass the checks.
  perform pg_advisory_xact_lock(hashtext('cart_reminder:' || a.store_slug || ':' || a.customer_phone));

  if not exists (select 1 from public.store_message_settings s where s.store_slug = a.store_slug and s.cart_reminders) then
    return jsonb_build_object('ok', false, 'reason', 'off');
  end if;
  if a.created_at <= now() - interval '24 hours' then
    return jsonb_build_object('ok', false, 'reason', 'too_old');
  end if;
  if exists (select 1 from public.cart_reminders r where r.abandoned_order_id = a.id) then
    return jsonb_build_object('ok', false, 'reason', 'already');
  end if;
  if exists (select 1 from public.cart_reminders r
              where r.store_slug = a.store_slug and r.phone = a.customer_phone
                and r.created_at > now() - interval '7 days') then
    return jsonb_build_object('ok', false, 'reason', 'recent');
  end if;
  if exists (select 1 from public.orders o
              where o.store_slug = a.store_slug and o.customer_phone = a.customer_phone
                and lower(coalesce(o.status, '')) <> 'abandoned'
                and o.created_at >= a.created_at) then
    return jsonb_build_object('ok', false, 'reason', 'ordered');
  end if;
  if not public.whatsapp_consent_granted(a.store_slug, a.customer_phone) then
    return jsonb_build_object('ok', false, 'reason', 'no_consent');
  end if;

  -- The message.
  select coalesce(nullif(trim(st.config->>'businessName'), ''), a.store_slug)
    into v_store from public.stores st where st.slug = a.store_slug;
  v_name := split_part(trim(coalesce(a.customer_name, '')), ' ', 1);
  select count(*)::integer, (array_agg(trim(coalesce(e->>'name', '')) order by n))[1]
    into v_lines, v_first
    from jsonb_array_elements(case when jsonb_typeof(to_jsonb(a.items)) = 'array' then to_jsonb(a.items) else '[]'::jsonb end)
         with ordinality as t(e, n);
  v_items := public.cart_reminder_param(v_first, 60, 'your items')
             || case when v_lines > 1 then ' + ' || (v_lines - 1) || ' more' else '' end;
  v_total := case when a.total is null then '0'
                  when a.total = trunc(a.total) then trunc(a.total)::bigint::text
                  else to_char(a.total, 'FM9999999990.00') end;

  -- Pay for it, then record it. Same transaction.
  v_ref := 'cart_reminder:' || v_id;
  v_debit := public.wallet_debit(a.store_slug, public.wallet_message_price_paise(), v_ref,
                                 public.cart_reminder_param('Cart reminder · ' || coalesce(nullif(v_name, ''), 'customer'), 60, 'Cart reminder'));
  if coalesce((v_debit->>'ok')::boolean, false) is not true then
    return jsonb_build_object('ok', false, 'reason', 'no_balance');
  end if;

  insert into public.cart_reminders (id, store_slug, phone, abandoned_order_id, token, status, debit_ref)
  values (v_id, a.store_slug, a.customer_phone, a.id, v_token, 'sending', v_ref);

  return jsonb_build_object(
    'ok', true,
    'reminder_id', v_id,
    'receiver', '91' || a.customer_phone,
    'values', jsonb_build_object(
      '1', public.cart_reminder_param(v_name, 40, 'there'),
      '2', v_items,
      '3', public.cart_reminder_param(v_store, 60, 'our shop'),
      '4', v_total,
      '5', 'cart/' || v_token));
end;
$function$;

-- ---------------------------------------------------------------------------
-- 5. Record the provider's answer. A refused message is refunded. service_role.
-- ---------------------------------------------------------------------------
create or replace function public.cart_reminder_finish(p_reminder_id uuid, p_sent boolean, p_provider_status integer, p_error text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
declare
  r public.cart_reminders%rowtype;
begin
  select * into r from public.cart_reminders c where c.id = p_reminder_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'unknown');
  end if;
  if r.status <> 'sending' then
    return jsonb_build_object('ok', true, 'already', true, 'status', r.status);
  end if;

  if p_sent is true then
    update public.cart_reminders c
       set status = 'sent', sent_at = now(), provider_status = p_provider_status
     where c.id = r.id;
  else
    update public.cart_reminders c
       set status = 'failed', provider_status = p_provider_status, error = left(coalesce(p_error, ''), 300)
     where c.id = r.id;
    perform public.wallet_refund(r.debit_ref, 'Cart reminder not sent');
  end if;
  return jsonb_build_object('ok', true, 'already', false, 'status', case when p_sent is true then 'sent' else 'failed' end);
end;
$function$;

-- ---------------------------------------------------------------------------
-- 6. A reminder whose result never came back (the sender crashed between the
--    claim and the answer) is refunded after 30 minutes. If it did go out, the
--    shop got one free message; it is never charged for one that did not.
--    service_role only; the sweep calls it first on every run.
-- ---------------------------------------------------------------------------
create or replace function public.cart_reminders_expire_stuck()
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
  for r in select c.id from public.cart_reminders c
            where c.status = 'sending' and c.created_at < now() - interval '30 minutes'
            for update skip locked loop
    perform public.cart_reminder_finish(r.id, false, null, 'no result from the sender');
    n := n + 1;
  end loop;
  return n;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 7. The link in the message: /cart/<token>. Anyone holding it may see which
--    items were in that cart and which shop it was -- nothing else (no name,
--    phone, address or prices). Notes the first click. Links work for 30 days.
-- ---------------------------------------------------------------------------
create or replace function public.get_cart_reminder(p_token text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
declare
  r     public.cart_reminders%rowtype;
  v_raw jsonb;
begin
  if coalesce(p_token, '') !~ '^[0-9a-f]{20}$' then
    return null;
  end if;
  select * into r from public.cart_reminders c
   where c.token = p_token and c.status = 'sent' and c.created_at > now() - interval '30 days';
  if not found then
    return null;
  end if;

  update public.cart_reminders c set clicked_at = now() where c.id = r.id and c.clicked_at is null;

  select to_jsonb(o.items) into v_raw from public.orders o where o.id = r.abandoned_order_id;
  return jsonb_build_object(
    'store_slug', r.store_slug,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'productId', e->>'productId', 'name', e->>'name', 'qty', e->'qty',
               'variant', e->>'variant', 'size', e->>'size', 'unit', e->>'unit') order by n)
        from jsonb_array_elements(case when jsonb_typeof(v_raw) = 'array' then v_raw else '[]'::jsonb end)
             with ordinality as t(e, n)), '[]'::jsonb));
end;
$function$;

-- ---------------------------------------------------------------------------
-- 8. The shop's switch and its results (PIN-checked, like every owner read).
-- ---------------------------------------------------------------------------
create or replace function public.set_cart_reminders(p_slug text, p_hashed_pin text, p_enabled boolean)
returns boolean
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
begin
  if p_enabled is null or not public.verify_store_pin(p_slug, p_hashed_pin) then
    return null;
  end if;
  insert into public.store_message_settings (store_slug, cart_reminders, updated_at)
  values (p_slug, p_enabled, now())
  on conflict (store_slug) do update set cart_reminders = excluded.cart_reminders, updated_at = now();
  return p_enabled;
end;
$function$;

create or replace function public.get_cart_reminder_summary(p_slug text, p_hashed_pin text)
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

  return (
    with sent as (
      select c.* from public.cart_reminders c
       where c.store_slug = p_slug and c.status = 'sent' and c.sent_at > now() - interval '30 days'
    ),
    -- Recovered: the customer placed a real order (not cancelled) within 7 days
    -- of the reminder. Counted once per reminder, at its first such order.
    won as (
      select distinct on (s.id) s.id, o.total
        from sent s
        join public.orders o
          on o.store_slug = s.store_slug and o.customer_phone = s.phone
         and lower(coalesce(o.status, '')) not in ('abandoned', 'cancelled')
         and o.created_at > s.sent_at and o.created_at <= s.sent_at + interval '7 days'
       order by s.id, o.created_at
    )
    select jsonb_build_object(
      'enabled', coalesce((select m.cart_reminders from public.store_message_settings m where m.store_slug = p_slug), false),
      'sent_30d', (select count(*) from sent),
      'clicked_30d', (select count(*) from sent where clicked_at is not null),
      'recovered_30d', (select count(*) from won),
      'recovered_value_30d', coalesce((select sum(total) from won), 0),
      'last_sent_at', (select max(sent_at) from sent))
  );
end;
$function$;

-- ---------------------------------------------------------------------------
-- 9. Who may call what. Revoked from anon and authenticated BY NAME: Supabase's
--    default privileges grant them EXECUTE on every new function directly.
-- ---------------------------------------------------------------------------
revoke all on function public.cart_reminder_param(text, integer, text)          from public, anon, authenticated;
revoke all on function public.cart_reminders_due(integer, timestamptz)          from public, anon, authenticated;
revoke all on function public.cart_reminder_claim(uuid)                         from public, anon, authenticated;
revoke all on function public.cart_reminder_finish(uuid, boolean, integer, text) from public, anon, authenticated;
revoke all on function public.cart_reminders_expire_stuck()                     from public, anon, authenticated;
revoke all on function public.get_cart_reminder(text)                           from public, anon, authenticated;
revoke all on function public.set_cart_reminders(text, text, boolean)           from public, anon, authenticated;
revoke all on function public.get_cart_reminder_summary(text, text)             from public, anon, authenticated;

grant execute on function public.cart_reminder_param(text, integer, text)          to service_role;
grant execute on function public.cart_reminders_due(integer, timestamptz)          to service_role;
grant execute on function public.cart_reminder_claim(uuid)                         to service_role;
grant execute on function public.cart_reminder_finish(uuid, boolean, integer, text) to service_role;
grant execute on function public.cart_reminders_expire_stuck()                     to service_role;
grant execute on function public.get_cart_reminder(text)                           to anon, authenticated, service_role;
grant execute on function public.set_cart_reminders(text, text, boolean)           to anon, authenticated, service_role;
grant execute on function public.get_cart_reminder_summary(text, text)             to anon, authenticated, service_role;

commit;
