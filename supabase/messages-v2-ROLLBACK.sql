-- ===========================================================================
--  WhatsApp messages v2  --  UNDO
--
--  Puts back the v1 bodies of cart_reminders_due, cart_reminder_claim (one
--  argument again), get_cart_reminder_summary and offer_claim -- byte for byte
--  from cart-reminders-forward.sql and offers-forward.sql -- and drops the
--  functions v2 added. After it, reminders go only to customers who agreed
--  again, and nothing can be sent by hand.
--
--  The columns v2 added (cart_reminders.source / ordered_*, offer_sends.token /
--  clicked_at / ordered_*) are LEFT in place: they hold which orders the
--  messages earned, and v1 ignores them.
--
--  REVERT THE APP AND UNDEPLOY cart-reminders-now FIRST.
--  RUN: Supabase Dashboard -> SQL Editor -> paste -> Run. Idempotent.
-- ===========================================================================

begin;

do $preflight$
begin
  if to_regprocedure('public.cart_reminder_claim(uuid,boolean,timestamptz,text)') is null and to_regprocedure('public.cart_reminder_claim(uuid)') is null then
    raise exception 'preflight: no cart_reminder_claim at all - nothing to roll back to';
  end if;
end;
$preflight$;

drop function if exists public.attribute_message_order(text, text, uuid);
drop function if exists public.get_offer_summary(text, text);
drop function if exists public.get_offer_link(text);
drop function if exists public.cart_reminder_statuses(text, text);
drop function if exists public.cart_reminder_preview(text, text);
drop function if exists public.cart_reminders_manual_candidates(text);
drop function if exists public.cart_reminder_claim(uuid, boolean, timestamptz, text);

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
      when 'link' then p_slug
      else public.cart_reminder_param(p_fields->>v_src, 60, '-') end);
  end loop;

  v_ref := 'offer:' || v_id;
  v_debit := public.wallet_debit(p_slug, public.wallet_message_price_paise(), v_ref,
                                 public.cart_reminder_param(t.name || ' · ' || coalesce(nullif(v_name, ''), 'customer'), 60, 'Offer'));
  if coalesce((v_debit->>'ok')::boolean, false) is not true then
    return jsonb_build_object('ok', false, 'reason', 'no_balance');
  end if;

  insert into public.offer_sends (id, store_slug, template_id, phone, status, debit_ref)
  values (v_id, p_slug, t.id, v_phone, 'sending', v_ref);

  return jsonb_build_object('ok', true, 'send_id', v_id, 'template_url', t.template_url,
                            'receiver', '91' || v_phone, 'values', v_values);
end;
$function$;

drop function if exists public.whatsapp_opted_out(text, text);

revoke all on function public.cart_reminders_due(integer, timestamptz)   from public, anon, authenticated;
revoke all on function public.cart_reminder_claim(uuid)                  from public, anon, authenticated;
revoke all on function public.get_cart_reminder_summary(text, text)      from public, anon, authenticated;
revoke all on function public.offer_claim(text, uuid, text, jsonb)       from public, anon, authenticated;
grant execute on function public.cart_reminders_due(integer, timestamptz) to service_role;
grant execute on function public.cart_reminder_claim(uuid)                to service_role;
grant execute on function public.get_cart_reminder_summary(text, text)    to anon, authenticated, service_role;
grant execute on function public.offer_claim(text, uuid, text, jsonb)     to service_role;

commit;
