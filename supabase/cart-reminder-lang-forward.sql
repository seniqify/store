-- ===========================================================================
-- Cart reminders in मराठी, and what the customer did with each one.
-- (2026-11-15, founder: "the marketing message which we send through abandon
--  cart should show what customer did and those message should be in marathi")
--
-- 1. A shop picks its reminder language: store_message_settings.cart_reminder_lang
--    ('en' | 'mr', default 'en'), set with set_cart_reminder_lang (PIN-checked).
-- 2. cart_reminder_claim also returns `lang` (the shop's choice) and `values_mr`
--    (the same five template values, the item line in Marathi). The sender uses
--    the Marathi template only when it exists (SENIQIFY_CART_REMINDER_MR_TEMPLATE_URL);
--    otherwise it sends English, so nobody is charged for a message that can't go.
-- 3. cart_reminders.lang records the language that was actually sent, via
--    cart_reminder_mark_lang (service only).
-- 4. cart_reminder_statuses also returns, per cart: lang, the order the reminder
--    won back (id, total, when, through the link or not) and when the customer
--    asked to stop. Same rule for "won" as get_cart_reminder_summary.
-- 5. get_cart_reminder_summary also returns `lang` and results by language.
--
-- Signatures and grants of the existing functions are unchanged.
--
-- RUN: Supabase Dashboard -> SQL Editor -> paste -> Run. Idempotent.
-- VERIFY afterwards: supabase/cart-reminder-lang-verify.sql (every L row PASS)
-- UNDO: supabase/cart-reminder-lang-ROLLBACK.sql
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Preflight: each function must be exactly the reviewed live version (or
--    already this one, a harmless re-run). Anything else stops, nothing changed.
-- ---------------------------------------------------------------------------
do $preflight$
declare
  r record;
  v_md5 text;
begin
  for r in
    select * from (values
      ('public.cart_reminder_claim(uuid,boolean,timestamptz,text)', '2016c9c5d0a592c0626df562eeee2e94',    'b60b545976e5bd6aa52f559ebdbb6477'),
      ('public.cart_reminder_statuses(text,text)',                  '843ec185703173bee7b9c3da203760f2', '4a8a629bfc63e45a1a9fb2a9747ba605'),
      ('public.get_cart_reminder_summary(text,text)',               '7f14829b0e262265ad8897f4479ccf02',  'db1d37da599f931e7874e9e1c57c5d27')
    ) as t(sig, old_md5, new_md5)
  loop
    select md5(replace(p.prosrc, chr(13), '')) into v_md5
      from pg_proc p where p.oid = to_regprocedure(r.sig);
    if v_md5 is null then
      raise exception 'preflight: % is missing - nothing changed', r.sig;
    end if;
    if v_md5 not in (r.old_md5, r.new_md5) then
      raise exception 'preflight: % is not the reviewed version (md5 %) - nothing changed', r.sig, v_md5;
    end if;
  end loop;
end;
$preflight$;

-- ---------------------------------------------------------------------------
-- 2. The two columns.
-- ---------------------------------------------------------------------------
alter table public.store_message_settings add column if not exists cart_reminder_lang text not null default 'en';
alter table public.cart_reminders         add column if not exists lang               text not null default 'en';

do $cols$
begin
  if not exists (select 1 from pg_constraint where conname = 'store_message_settings_cart_reminder_lang_check') then
    alter table public.store_message_settings
      add constraint store_message_settings_cart_reminder_lang_check check (cart_reminder_lang in ('en', 'mr'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'cart_reminders_lang_check') then
    alter table public.cart_reminders
      add constraint cart_reminders_lang_check check (lang in ('en', 'mr'));
  end if;
end;
$cols$;

-- ---------------------------------------------------------------------------
-- 3. The shop picks its reminder language (same pattern as set_cart_reminders).
-- ---------------------------------------------------------------------------
create or replace function public.set_cart_reminder_lang(p_slug text, p_hashed_pin text, p_lang text)
returns text
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
begin
  if p_lang is null or p_lang not in ('en', 'mr') or not public.verify_store_pin(p_slug, p_hashed_pin) then
    return null;
  end if;
  insert into public.store_message_settings (store_slug, cart_reminders, cart_reminder_lang, updated_at)
  values (p_slug, false, p_lang, now())
  on conflict (store_slug) do update set cart_reminder_lang = excluded.cart_reminder_lang, updated_at = now();
  return p_lang;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 4. The sender records the language it actually used (service only).
-- ---------------------------------------------------------------------------
create or replace function public.cart_reminder_mark_lang(p_reminder_id uuid, p_lang text)
returns boolean
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
begin
  if p_lang is null or p_lang not in ('en', 'mr') then
    return false;
  end if;
  update public.cart_reminders set lang = p_lang where id = p_reminder_id;
  return found;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 5. cart_reminder_claim: unchanged rules; also returns `lang` and `values_mr`.
-- ---------------------------------------------------------------------------
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
  v_items_mr text;
  v_lang   text;
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
  -- The same line for the Marathi message: "Misal Premix + आणखी 2 वस्तू".
  v_items_mr := public.cart_reminder_param(v_first, 60, 'तुमच्या वस्तू')
                || case when v_lines > 1 then ' + आणखी ' || (v_lines - 1) || ' वस्तू' else '' end;
  v_total := case when a.total is null then '0'
                  when a.total = trunc(a.total) then trunc(a.total)::bigint::text
                  else to_char(a.total, 'FM9999999990.00') end;
  v_lang := coalesce((select s.cart_reminder_lang from public.store_message_settings s where s.store_slug = a.store_slug), 'en');

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
    'lang', v_lang,
    'values', jsonb_build_object(
      '1', public.cart_reminder_param(v_name, 40, 'there'),
      '2', v_items,
      '3', public.cart_reminder_param(v_store, 60, 'our shop'),
      '4', v_total,
      '5', 'cart/' || v_token),
    'values_mr', jsonb_build_object(
      '1', public.cart_reminder_param(v_name, 40, 'ग्राहक'),
      '2', v_items_mr,
      '3', public.cart_reminder_param(v_store, 60, 'आमचे दुकान'),
      '4', v_total,
      '5', 'cart/' || v_token));
end;
$function$;

-- ---------------------------------------------------------------------------
-- 6. cart_reminder_statuses: unchanged list, and per cart what the customer did.
-- ---------------------------------------------------------------------------
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
             'cart_id', (select a.id from public.orders a
                          where a.store_slug = p_slug
                            and a.customer_phone = r.phone
                            and lower(coalesce(a.status, '')) = 'abandoned'
                          order by a.created_at desc, a.id desc
                          limit 1),
             'status', r.status, 'source', r.source, 'sent_at', r.sent_at,
             'clicked_at', r.clicked_at, 'ordered_at', r.ordered_at,
             'next_at', r.created_at + interval '7 days',
             'lang', r.lang,
             -- The order it won back: through the link, else a real order from
             -- that number within 7 days (the summary's rule).
             'won_order_id', w.id, 'won_total', w.total, 'won_at', w.created_at,
             'won_via_link', coalesce(w.via_link, false),
             -- Asked to stop: the latest consent record for this number is a no.
             'stopped_at', case when public.whatsapp_opted_out(p_slug, r.phone)
                                then (select max(c.created_at) from public.whatsapp_consents c
                                       where c.store_slug = p_slug and c.phone = r.phone and not c.granted) end))
      from (select distinct on (c.phone) c.*
              from public.cart_reminders c
             where c.store_slug = p_slug and c.created_at > now() - interval '30 days'
             order by c.phone, c.created_at desc) r
      left join lateral (
        select o.id, o.total, o.created_at, (o.id = r.ordered_order_id) as via_link
          from public.orders o
         where r.status = 'sent'
           and o.store_slug = p_slug
           and lower(coalesce(o.status, '')) not in ('abandoned', 'cancelled')
           and (o.id = r.ordered_order_id
                or (o.customer_phone = r.phone
                    and o.created_at > r.sent_at and o.created_at <= r.sent_at + interval '7 days'))
         order by (o.id = r.ordered_order_id) is true desc, o.created_at
         limit 1) w on true), '[]'::jsonb);
end;
$function$;

-- ---------------------------------------------------------------------------
-- 7. get_cart_reminder_summary: unchanged numbers, plus the language and the
--    results by language.
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
             s.lang,
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
      'lang', coalesce((select m.cart_reminder_lang from public.store_message_settings m where m.store_slug = p_slug), 'en'),
      'sent_30d', (select count(*) from sent),
      'clicked_30d', (select count(*) from sent where clicked_at is not null),
      'recovered_30d', (select count(*) from won),
      'via_link_30d', (select count(*) from won where via_link),
      'recovered_value_30d', coalesce((select sum(total) from won), 0),
      'spent_paise_30d', (select count(*) from sent) * public.wallet_message_price_paise(),
      'last_sent_at', (select max(sent_at) from sent),
      'by_lang', jsonb_build_object(
        'en', jsonb_build_object('sent', (select count(*) from sent where lang = 'en'), 'won', (select count(*) from won where lang = 'en')),
        'mr', jsonb_build_object('sent', (select count(*) from sent where lang = 'mr'), 'won', (select count(*) from won where lang = 'mr'))),
      'wins', coalesce((select jsonb_agg(jsonb_build_object(
                 'name', coalesce(nullif(w.name, ''), 'Customer'), 'total', w.total, 'at', w.at, 'via_link', w.via_link)
                 order by w.at desc)
          from (select * from won order by at desc limit 10) w), '[]'::jsonb))
  );
end;
$function$;

-- ---------------------------------------------------------------------------
-- 8. Who may call the new functions (revoked from anon/authenticated BY NAME:
--    Supabase's default privileges grant EXECUTE on every new function).
-- ---------------------------------------------------------------------------
revoke all on function public.set_cart_reminder_lang(text, text, text)  from public, anon, authenticated;
revoke all on function public.cart_reminder_mark_lang(uuid, text)       from public, anon, authenticated;
grant execute on function public.set_cart_reminder_lang(text, text, text) to anon, authenticated, service_role;
grant execute on function public.cart_reminder_mark_lang(uuid, text)      to service_role;

commit;
