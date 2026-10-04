-- ===========================================================================
--  WhatsApp messages v2  --  send reminders now, and know what they earned
--
--  Founder decisions, 2026-10-04:
--    * Cart reminders go to EVERY customer who left a cart -- not only those who
--      ticked "Get offers on WhatsApp" at checkout. They had just started an
--      order at that shop, so it is the message they most expect. Still never
--      to anyone who asked to stop (a "no" in whatsapp_consents: unticked the
--      box, tapped Stop offers, or the shop recorded it).
--    * The shop can send them NOW: one cart, or "Send reminder to all" -- every
--      cart from the last 7 days that has not had a reminder this week and has
--      not ordered since. 09:00-21:00 IST only, like the automatic ones.
--    * Offers (Customers tab) stay for customers who ticked the box.
--    * Know what it earned: every reminder and offer carries its own link
--      (/cart/<token>, /o/<token>). Opening it is recorded; an order placed
--      through it is tagged to that message. "Ordered" = through the link, or
--      any real order from that number within 7 days of the message.
--
--  Replaces four live functions (each md5-checked first: the v1 bodies from
--  cart-reminders-forward.sql / offers-forward.sql, or this file's own):
--    cart_reminders_due, cart_reminder_claim (gains p_manual),
--    get_cart_reminder_summary, offer_claim.
--  Adds columns (nothing removed) and eight functions. Data is untouched.
--
--  RUN: Supabase Dashboard -> SQL Editor -> paste -> Run. Idempotent.
--  VERIFY afterwards: supabase/messages-v2-verify.sql (every C row PASS)
--  UNDO: supabase/messages-v2-ROLLBACK.sql (restores the v1 bodies exactly)
-- ===========================================================================

begin;

do $preflight$
declare
  v record;
begin
  for v in
    select * from (values
      ('public.cart_reminders_due(integer,timestamptz)', 'bb9e712817054a13d132a6526722087b', 'f0cc5503820aaaa0cd6291e3efdc4223'),
      ('public.get_cart_reminder_summary(text,text)',    '6df2b2e0f5612f532a53817b8d77e6c5', '7f14829b0e262265ad8897f4479ccf02'),
      ('public.offer_claim(text,uuid,text,jsonb)',       '90b3f7a4e1a78315fa7be885ce38433d', 'e26ad9fa1fad1bf4e5cb46c286b17ca0')
    ) t(sig, v1, v2)
  loop
    if to_regprocedure(v.sig) is null then
      raise exception 'preflight: % is missing - run the v1 scripts first - nothing changed', v.sig;
    end if;
    if (select md5(replace(p.prosrc, chr(13), '')) from pg_proc p where p.oid = to_regprocedure(v.sig)) not in (v.v1, v.v2) then
      raise exception 'preflight: % is not the reviewed version - nothing changed', v.sig;
    end if;
  end loop;
  -- The claim: the v1 one-argument version, or this file's two-argument one.
  if to_regprocedure('public.cart_reminder_claim(uuid)') is not null then
    if (select md5(replace(p.prosrc, chr(13), '')) from pg_proc p
         where p.oid = to_regprocedure('public.cart_reminder_claim(uuid)')) <> 'd88eca976669ec2c143f7952d1a62cbc' then
      raise exception 'preflight: cart_reminder_claim(uuid) is not the reviewed version - nothing changed';
    end if;
  elsif to_regprocedure('public.cart_reminder_claim(uuid,boolean,timestamptz,text)') is null then
    raise exception 'preflight: cart_reminder_claim is missing - run cart-reminders-forward.sql first - nothing changed';
  elsif (select md5(replace(p.prosrc, chr(13), '')) from pg_proc p
          where p.oid = to_regprocedure('public.cart_reminder_claim(uuid,boolean,timestamptz,text)')) <> '2016c9c5d0a592c0626df562eeee2e94' then
    raise exception 'preflight: cart_reminder_claim(uuid,boolean,timestamptz,text) is not the reviewed version - nothing changed';
  end if;
end;
$preflight$;

-- ---------------------------------------------------------------------------
-- 1. Columns (added, never removed)
-- ---------------------------------------------------------------------------
alter table public.cart_reminders
  add column if not exists source           text not null default 'auto',
  add column if not exists ordered_order_id uuid,
  add column if not exists ordered_at       timestamptz,
  add column if not exists ordered_total    numeric;
do $c$ begin
  if not exists (select 1 from pg_constraint where conname = 'cart_reminders_source_check') then
    alter table public.cart_reminders add constraint cart_reminders_source_check check (source in ('auto', 'manual'));
  end if;
end $c$;

alter table public.offer_sends
  add column if not exists token            text,
  add column if not exists clicked_at       timestamptz,
  add column if not exists ordered_order_id uuid,
  add column if not exists ordered_at       timestamptz,
  add column if not exists ordered_total    numeric;
create unique index if not exists offer_sends_token_key on public.offer_sends (token);

-- ---------------------------------------------------------------------------
-- 2. Asked to stop? The latest consent record for this shop + number is a NO.
--    (No record is not a no.) service_role only.
-- ---------------------------------------------------------------------------
create or replace function public.whatsapp_opted_out(p_slug text, p_phone text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  select coalesce((
    select not c.granted
      from public.whatsapp_consents c
     where c.store_slug = p_slug
       and c.phone = right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 10)
     order by c.id desc
     limit 1), false)
$function$;

-- ---------------------------------------------------------------------------
-- 3. Automatic reminders: same as v1, except "agreed" becomes "did not ask to
--    stop". Same signature.
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
     and not public.whatsapp_opted_out(x.store_slug, x.customer_phone)
   order by x.created_at
   limit greatest(1, least(coalesce(p_limit, 50), 200))
$function$;

-- ---------------------------------------------------------------------------
-- 4. Claim. p_now exists so tests can pin the clock; production never passes it.
--    p_manual = the shop pressed Send (p_slug = that shop; the cart must be its own): no switch needed, carts up to 7
--    days old, 09:00-21:00 IST checked here. Automatic: as v1 (switch on, cart
--    under 24 h). Both: not reminded this cart or this week, not ordered since,
--    not opted out, wallet pays -- under the per-customer lock, one transaction.
-- ---------------------------------------------------------------------------
drop function if exists public.cart_reminder_claim(uuid);

create or replace function public.cart_reminder_claim(p_abandoned_id uuid, p_manual boolean default false, p_now timestamptz default now(), p_slug text default null)
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
  v_hour   numeric := extract(hour from p_now at time zone 'Asia/Kolkata');
begin
  select * into a from public.orders o where o.id = p_abandoned_id;
  if not found or lower(coalesce(a.status, '')) <> 'abandoned' then
    return jsonb_build_object('ok', false, 'reason', 'not_abandoned');
  end if;
  if coalesce(a.customer_phone, '') !~ '^[6-9][0-9]{9}$' then
    return jsonb_build_object('ok', false, 'reason', 'bad_phone');
  end if;

  perform pg_advisory_xact_lock(hashtext('cart_reminder:' || a.store_slug || ':' || a.customer_phone));

  if p_manual is true then
    -- The shop that pressed Send (its PIN was checked by the caller) must own
    -- this cart: no shop can remind, or spend another shop's wallet on, a cart
    -- that is not its own.
    if p_slug is null or a.store_slug is distinct from p_slug then
      return jsonb_build_object('ok', false, 'reason', 'not_yours');
    end if;
    if v_hour < 9 or v_hour >= 21 then
      return jsonb_build_object('ok', false, 'reason', 'night');
    end if;
    if a.created_at <= p_now - interval '7 days' then
      return jsonb_build_object('ok', false, 'reason', 'too_old');
    end if;
  else
    if not exists (select 1 from public.store_message_settings s where s.store_slug = a.store_slug and s.cart_reminders) then
      return jsonb_build_object('ok', false, 'reason', 'off');
    end if;
    if a.created_at <= p_now - interval '24 hours' then
      return jsonb_build_object('ok', false, 'reason', 'too_old');
    end if;
  end if;
  if exists (select 1 from public.cart_reminders r where r.abandoned_order_id = a.id) then
    return jsonb_build_object('ok', false, 'reason', 'already');
  end if;
  if exists (select 1 from public.cart_reminders r
              where r.store_slug = a.store_slug and r.phone = a.customer_phone
                and r.created_at > p_now - interval '7 days') then
    return jsonb_build_object('ok', false, 'reason', 'recent');
  end if;
  if exists (select 1 from public.orders o
              where o.store_slug = a.store_slug and o.customer_phone = a.customer_phone
                and lower(coalesce(o.status, '')) <> 'abandoned'
                and o.created_at >= a.created_at) then
    return jsonb_build_object('ok', false, 'reason', 'ordered');
  end if;
  if public.whatsapp_opted_out(a.store_slug, a.customer_phone) then
    return jsonb_build_object('ok', false, 'reason', 'opted_out');
  end if;

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

  v_ref := 'cart_reminder:' || v_id;
  v_debit := public.wallet_debit(a.store_slug, public.wallet_message_price_paise(), v_ref,
                                 public.cart_reminder_param('Cart reminder · ' || coalesce(nullif(v_name, ''), 'customer'), 60, 'Cart reminder'));
  if coalesce((v_debit->>'ok')::boolean, false) is not true then
    return jsonb_build_object('ok', false, 'reason', 'no_balance');
  end if;

  insert into public.cart_reminders (id, store_slug, phone, abandoned_order_id, token, status, debit_ref, source)
  values (v_id, a.store_slug, a.customer_phone, a.id, v_token, 'sending', v_ref,
          case when p_manual is true then 'manual' else 'auto' end);

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
-- 5. "Send reminder to all": every customer's latest cart from the last 7 days
--    that can get one now. service_role (the send function); the screen asks
--    cart_reminder_preview for the same numbers with the PIN.
-- ---------------------------------------------------------------------------
create or replace function public.cart_reminders_manual_candidates(p_slug text)
returns table (abandoned_order_id uuid)
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  select x.id
    from (
      select distinct on (a.customer_phone) a.id, a.customer_phone, a.created_at
        from public.orders a
       where a.store_slug = p_slug
         and lower(coalesce(a.status, '')) = 'abandoned'
         and a.created_at > now() - interval '7 days'
         and a.customer_phone ~ '^[6-9][0-9]{9}$'
       order by a.customer_phone, a.created_at desc, a.id desc
    ) x
   where not exists (select 1 from public.cart_reminders r where r.abandoned_order_id = x.id)
     and not exists (select 1 from public.cart_reminders r
                      where r.store_slug = p_slug and r.phone = x.customer_phone
                        and r.created_at > now() - interval '7 days')
     and not exists (select 1 from public.orders o
                      where o.store_slug = p_slug and o.customer_phone = x.customer_phone
                        and lower(coalesce(o.status, '')) <> 'abandoned'
                        and o.created_at >= x.created_at)
     and not public.whatsapp_opted_out(p_slug, x.customer_phone)
   order by x.created_at desc
$function$;

create or replace function public.cart_reminder_preview(p_slug text, p_hashed_pin text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
declare
  v_eligible integer;
  v_hour     numeric := extract(hour from now() at time zone 'Asia/Kolkata');
begin
  if not public.verify_store_pin(p_slug, p_hashed_pin) then
    return null;
  end if;
  select count(*) into v_eligible from public.cart_reminders_manual_candidates(p_slug);
  return jsonb_build_object(
    'eligible', v_eligible,
    'reminded_recently', (
      select count(distinct r.phone) from public.cart_reminders r
       where r.store_slug = p_slug and r.status <> 'failed' and r.created_at > now() - interval '7 days'),
    'price_paise', public.wallet_message_price_paise(),
    'cost_paise', v_eligible * public.wallet_message_price_paise(),
    'balance_paise', coalesce((select w.balance_paise from public.store_wallets w where w.store_slug = p_slug), 0),
    'night', v_hour < 9 or v_hour >= 21);
end;
$function$;

-- Each customer's latest reminder in the last 30 days, for the cart list.
create or replace function public.cart_reminder_statuses(p_slug text, p_hashed_pin text)
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
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'phone', r.phone, 'status', r.status, 'source', r.source, 'sent_at', r.sent_at,
             'clicked_at', r.clicked_at, 'ordered_at', r.ordered_at,
             'next_at', r.created_at + interval '7 days'))
      from (select distinct on (c.phone) c.*
              from public.cart_reminders c
             where c.store_slug = p_slug and c.created_at > now() - interval '30 days'
             order by c.phone, c.created_at desc) r), '[]'::jsonb);
end;
$function$;

-- ---------------------------------------------------------------------------
-- 6. What reminders earned (last 30 days). Same signature as v1, more fields:
--    ordered = through the link, or a real order (not cancelled) from that
--    number within 7 days of the reminder; via_link counts the first kind;
--    spent = what the messages cost; wins = the latest 10, first names only.
-- ---------------------------------------------------------------------------
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
    won as (
      select s.id,
             coalesce(l.id, f.id) as order_id,
             coalesce(l.created_at, f.created_at) as at,
             coalesce(l.total, f.total) as total,
             (l.id is not null) as via_link,
             -- The name on the order, else the one they typed on the cart.
             split_part(trim(coalesce(nullif(trim(coalesce(l.customer_name, f.customer_name, '')), ''), ab.customer_name, '')), ' ', 1) as name
        from sent s
        left join public.orders ab on ab.id = s.abandoned_order_id
        left join public.orders l
          on l.id = s.ordered_order_id and lower(coalesce(l.status, '')) not in ('abandoned', 'cancelled')
        left join lateral (
          select o.id, o.created_at, o.total, o.customer_name from public.orders o
           where o.store_slug = s.store_slug and o.customer_phone = s.phone
             and lower(coalesce(o.status, '')) not in ('abandoned', 'cancelled')
             and o.created_at > s.sent_at and o.created_at <= s.sent_at + interval '7 days'
           order by o.created_at limit 1) f on true
       where l.id is not null or f.id is not null
    )
    select jsonb_build_object(
      'enabled', coalesce((select m.cart_reminders from public.store_message_settings m where m.store_slug = p_slug), false),
      'sent_30d', (select count(*) from sent),
      'clicked_30d', (select count(*) from sent where clicked_at is not null),
      'recovered_30d', (select count(*) from won),
      'via_link_30d', (select count(*) from won where via_link),
      'recovered_value_30d', coalesce((select sum(total) from won), 0),
      'spent_paise_30d', (select count(*) from sent) * public.wallet_message_price_paise(),
      'last_sent_at', (select max(sent_at) from sent),
      'wins', coalesce((select jsonb_agg(jsonb_build_object(
                 'name', coalesce(nullif(w.name, ''), 'Customer'), 'total', w.total, 'at', w.at, 'via_link', w.via_link)
                 order by w.at desc)
          from (select * from won order by at desc limit 10) w), '[]'::jsonb))
  );
end;
$function$;

-- ---------------------------------------------------------------------------
-- 7. Offers: each send gets its own link (/o/<token>) instead of the bare shop
--    page, so opens and orders can be counted. Otherwise exactly v1 (opt-in
--    only, 3 days, under the lock, debit in the same transaction).
-- ---------------------------------------------------------------------------
create or replace function public.offer_claim(p_slug text, p_template_id uuid, p_phone text, p_fields jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
declare
  t        public.message_templates%rowtype;
  v_phone  text := right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 10);
  v_id     uuid := gen_random_uuid();
  v_token  text := left(replace(gen_random_uuid()::text, '-', ''), 20);
  v_ref    text;
  v_debit  jsonb;
  v_store  text;
  v_name   text;
  v_values jsonb := '{}'::jsonb;
  v_src    text;
  v_i      integer := 0;
begin
  select * into t from public.message_templates m
   where m.id = p_template_id and m.status = 'approved' and (m.store_slug is null or m.store_slug = p_slug);
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_approved');
  end if;
  if v_phone !~ '^[6-9][0-9]{9}$' then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;

  perform pg_advisory_xact_lock(hashtext('offer:' || p_slug || ':' || v_phone));

  if not exists (select 1 from public.orders o where o.store_slug = p_slug and o.customer_phone = v_phone) then
    return jsonb_build_object('ok', false, 'reason', 'not_customer');
  end if;
  if not public.whatsapp_consent_granted(p_slug, v_phone) then
    return jsonb_build_object('ok', false, 'reason', 'no_consent');
  end if;
  if exists (select 1 from public.offer_sends s where s.store_slug = p_slug and s.phone = v_phone
               and s.status <> 'failed' and s.created_at > now() - interval '3 days') then
    return jsonb_build_object('ok', false, 'reason', 'recent');
  end if;

  select coalesce(nullif(trim(st.config->>'businessName'), ''), p_slug) into v_store from public.stores st where st.slug = p_slug;
  select split_part(trim(coalesce(o.customer_name, '')), ' ', 1) into v_name
    from public.orders o
   where o.store_slug = p_slug and o.customer_phone = v_phone and coalesce(trim(o.customer_name), '') <> ''
   order by o.created_at desc limit 1;

  foreach v_src in array t.value_map loop
    v_i := v_i + 1;
    if v_src in ('offer', 'item', 'code', 'date') and not public.offer_field_ok(p_fields->>v_src) then
      return jsonb_build_object('ok', false, 'reason', 'bad_field', 'field', v_src);
    end if;
    v_values := v_values || jsonb_build_object(v_i::text, case v_src
      when 'name' then public.cart_reminder_param(v_name, 40, 'there')
      when 'shop' then public.cart_reminder_param(v_store, 60, 'our shop')
      when 'link' then 'o/' || v_token
      else public.cart_reminder_param(p_fields->>v_src, 60, '-') end);
  end loop;

  v_ref := 'offer:' || v_id;
  v_debit := public.wallet_debit(p_slug, public.wallet_message_price_paise(), v_ref,
                                 public.cart_reminder_param(t.name || ' · ' || coalesce(nullif(v_name, ''), 'customer'), 60, 'Offer'));
  if coalesce((v_debit->>'ok')::boolean, false) is not true then
    return jsonb_build_object('ok', false, 'reason', 'no_balance');
  end if;

  insert into public.offer_sends (id, store_slug, template_id, phone, status, debit_ref, token)
  values (v_id, p_slug, t.id, v_phone, 'sending', v_ref, v_token);

  return jsonb_build_object('ok', true, 'send_id', v_id, 'template_url', t.template_url,
                            'receiver', '91' || v_phone, 'values', v_values);
end;
$function$;

-- The offer link: which shop to open (nothing else), and the first click.
create or replace function public.get_offer_link(p_token text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
declare
  s public.offer_sends%rowtype;
begin
  if coalesce(p_token, '') !~ '^[0-9a-f]{20}$' then
    return null;
  end if;
  select * into s from public.offer_sends o
   where o.token = p_token and o.status = 'sent' and o.created_at > now() - interval '30 days';
  if not found then
    return null;
  end if;
  update public.offer_sends o set clicked_at = now() where o.id = s.id and o.clicked_at is null;
  return jsonb_build_object('store_slug', s.store_slug);
end;
$function$;

create or replace function public.get_offer_summary(p_slug text, p_hashed_pin text)
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
      select s.* from public.offer_sends s
       where s.store_slug = p_slug and s.status = 'sent' and s.sent_at > now() - interval '30 days'
    ),
    won as (
      select s.id, coalesce(l.created_at, f.created_at) as at, coalesce(l.total, f.total) as total,
             (l.id is not null) as via_link,
             split_part(trim(coalesce(coalesce(l.customer_name, f.customer_name), '')), ' ', 1) as name
        from sent s
        left join public.orders l
          on l.id = s.ordered_order_id and lower(coalesce(l.status, '')) not in ('abandoned', 'cancelled')
        left join lateral (
          select o.id, o.created_at, o.total, o.customer_name from public.orders o
           where o.store_slug = s.store_slug and o.customer_phone = s.phone
             and lower(coalesce(o.status, '')) not in ('abandoned', 'cancelled')
             and o.created_at > s.sent_at and o.created_at <= s.sent_at + interval '7 days'
           order by o.created_at limit 1) f on true
       where l.id is not null or f.id is not null
    )
    select jsonb_build_object(
      'sent_30d', (select count(*) from sent),
      'clicked_30d', (select count(*) from sent where clicked_at is not null),
      'ordered_30d', (select count(*) from won),
      'via_link_30d', (select count(*) from won where via_link),
      'ordered_value_30d', coalesce((select sum(total) from won), 0),
      'spent_paise_30d', (select count(*) from sent) * public.wallet_message_price_paise(),
      'wins', coalesce((select jsonb_agg(jsonb_build_object(
                 'name', coalesce(nullif(w.name, ''), 'Customer'), 'total', w.total, 'at', w.at, 'via_link', w.via_link)
                 order by w.at desc)
          from (select * from won order by at desc limit 10) w), '[]'::jsonb))
  );
end;
$function$;

-- ---------------------------------------------------------------------------
-- 8. An order placed through a message's link is tagged to that message. The
--    checkout calls this right after saving the order, with the link's token.
--    Anyone holding both the token and the order id could only re-tag that
--    shop's order to that message within its 7 days -- a statistic, nothing
--    more -- and a message keeps its FIRST order.
-- ---------------------------------------------------------------------------
create or replace function public.attribute_message_order(p_kind text, p_token text, p_order_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
declare
  v_store text;
  v_sent  timestamptz;
  v_done  uuid;
  o       public.orders%rowtype;
begin
  if coalesce(p_token, '') !~ '^[0-9a-f]{20}$' or p_order_id is null or p_kind not in ('cart', 'offer') then
    return false;
  end if;
  if p_kind = 'cart' then
    select r.store_slug, r.sent_at, r.ordered_order_id into v_store, v_sent, v_done
      from public.cart_reminders r where r.token = p_token and r.status = 'sent' for update;
  else
    select s.store_slug, s.sent_at, s.ordered_order_id into v_store, v_sent, v_done
      from public.offer_sends s where s.token = p_token and s.status = 'sent' for update;
  end if;
  if v_store is null then
    return false;
  end if;
  if v_done is not null then
    return v_done = p_order_id;
  end if;

  select * into o from public.orders x
   where x.id = p_order_id and x.store_slug = v_store
     and lower(coalesce(x.status, '')) <> 'abandoned'
     and x.created_at >= v_sent and x.created_at <= v_sent + interval '7 days';
  if not found then
    return false;
  end if;

  if p_kind = 'cart' then
    update public.cart_reminders r set ordered_order_id = o.id, ordered_at = o.created_at, ordered_total = o.total
     where r.token = p_token;
  else
    update public.offer_sends s set ordered_order_id = o.id, ordered_at = o.created_at, ordered_total = o.total
     where s.token = p_token;
  end if;
  return true;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 9. Who may call what (revoked from anon/authenticated BY NAME first).
-- ---------------------------------------------------------------------------
revoke all on function public.whatsapp_opted_out(text, text)                      from public, anon, authenticated;
revoke all on function public.cart_reminders_due(integer, timestamptz)            from public, anon, authenticated;
revoke all on function public.cart_reminder_claim(uuid, boolean, timestamptz, text) from public, anon, authenticated;
revoke all on function public.cart_reminders_manual_candidates(text)              from public, anon, authenticated;
revoke all on function public.cart_reminder_preview(text, text)                   from public, anon, authenticated;
revoke all on function public.cart_reminder_statuses(text, text)                  from public, anon, authenticated;
revoke all on function public.get_cart_reminder_summary(text, text)               from public, anon, authenticated;
revoke all on function public.offer_claim(text, uuid, text, jsonb)                from public, anon, authenticated;
revoke all on function public.get_offer_link(text)                                from public, anon, authenticated;
revoke all on function public.get_offer_summary(text, text)                       from public, anon, authenticated;
revoke all on function public.attribute_message_order(text, text, uuid)           from public, anon, authenticated;

grant execute on function public.whatsapp_opted_out(text, text)                   to service_role;
grant execute on function public.cart_reminders_due(integer, timestamptz)         to service_role;
grant execute on function public.cart_reminder_claim(uuid, boolean, timestamptz, text) to service_role;
grant execute on function public.cart_reminders_manual_candidates(text)           to service_role;
grant execute on function public.offer_claim(text, uuid, text, jsonb)             to service_role;
grant execute on function public.cart_reminder_preview(text, text)                to anon, authenticated, service_role;
grant execute on function public.cart_reminder_statuses(text, text)               to anon, authenticated, service_role;
grant execute on function public.get_cart_reminder_summary(text, text)            to anon, authenticated, service_role;
grant execute on function public.get_offer_link(text)                             to anon, authenticated, service_role;
grant execute on function public.get_offer_summary(text, text)                    to anon, authenticated, service_role;
grant execute on function public.attribute_message_order(text, text, uuid)        to anon, authenticated, service_role;

commit;
