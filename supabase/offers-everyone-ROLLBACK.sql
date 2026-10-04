-- ===========================================================================
--  Offers to every customer  --  UNDO
--
--  Puts back the previous bodies of offer_audience and seller_record_optout
--  (byte for byte from offers-forward.sql) and offer_claim (from
--  messages-v2-forward.sql). After it, offers go only to customers who ticked
--  "Get offers on WhatsApp" again, and the shop's Stop only saves for them.
--  Stops the shop already recorded are LEFT in place (they are real requests).
--
--  REVERT THE APP FIRST (it reads 'opted_out'; the old one reads 'no_consent').
--  RUN: Supabase Dashboard -> SQL Editor -> paste -> Run. Idempotent.
-- ===========================================================================

begin;

do $preflight$
declare
  v record;
begin
  for v in
    select * from (values
      ('public.offer_audience(text,text,uuid,text[],jsonb)', 'b3312b3b091f2fa68d5d098acf4716c7', '6de2710c9f26bb3fc87e66712c589ec2'),
      ('public.offer_claim(text,uuid,text,jsonb)',           'e26ad9fa1fad1bf4e5cb46c286b17ca0', '3b9ec7bace212a5f9315641c7d46a465'),
      ('public.seller_record_optout(text,text,text)',        '8ada037494f02bb72b2feaac92d405c8', '711db68335f6d4535a760d5c1a9d9198')
    ) t(sig, old, new)
  loop
    if to_regprocedure(v.sig) is null then
      raise exception 'preflight: % is missing - nothing to roll back - nothing changed', v.sig;
    end if;
    if (select md5(replace(p.prosrc, chr(13), '')) from pg_proc p where p.oid = to_regprocedure(v.sig)) not in (v.old, v.new) then
      raise exception 'preflight: % is not a reviewed version - nothing changed', v.sig;
    end if;
  end loop;
end;
$preflight$;

create or replace function public.offer_audience(p_slug text, p_hashed_pin text, p_template_id uuid, p_phones text[], p_fields jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
declare
  t        public.message_templates%rowtype;
  v_bad    text;
  v_res    jsonb;
begin
  if not public.verify_store_pin(p_slug, p_hashed_pin) then
    return null;
  end if;
  select * into t from public.message_templates m
   where m.id = p_template_id and m.status = 'approved' and (m.store_slug is null or m.store_slug = p_slug);
  if not found then
    return jsonb_build_object('ok', false, 'error', 'This message is not approved yet.');
  end if;
  select f into v_bad from unnest(t.value_map) f
   where f in ('offer', 'item', 'code', 'date') and not public.offer_field_ok(p_fields->>f) limit 1;
  if v_bad is not null then
    return jsonb_build_object('ok', false, 'error', 'Fill in {' || v_bad || '} — up to 60 characters, no links.', 'field', v_bad);
  end if;

  with input as (
    select distinct right(regexp_replace(coalesce(p, ''), '\D', '', 'g'), 10) as phone
      from unnest(coalesce(p_phones, '{}')) p
  ),
  judged as (
    select i.phone,
           case
             when i.phone !~ '^[6-9][0-9]{9}$' then 'invalid'
             when not exists (select 1 from public.orders o where o.store_slug = p_slug and o.customer_phone = i.phone) then 'not_customer'
             when not public.whatsapp_consent_granted(p_slug, i.phone) then 'no_consent'
             when exists (select 1 from public.offer_sends s where s.store_slug = p_slug and s.phone = i.phone
                            and s.status <> 'failed' and s.created_at > now() - interval '3 days') then 'recent'
             else 'ok'
           end as verdict
      from input i
  )
  select jsonb_build_object(
           'ok', true,
           'eligible', count(*) filter (where verdict = 'ok'),
           'no_consent', count(*) filter (where verdict = 'no_consent'),
           'recent', count(*) filter (where verdict = 'recent'),
           'other', count(*) filter (where verdict in ('invalid', 'not_customer')),
           'price_paise', public.wallet_message_price_paise(),
           'cost_paise', count(*) filter (where verdict = 'ok') * public.wallet_message_price_paise(),
           'balance_paise', coalesce((select w.balance_paise from public.store_wallets w where w.store_slug = p_slug), 0))
    into v_res
    from judged;
  return v_res;
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

create or replace function public.seller_record_optout(p_slug text, p_hashed_pin text, p_phone text)
returns boolean
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
declare
  v_phone text := right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 10);
begin
  if not public.verify_store_pin(p_slug, p_hashed_pin) then
    return null;
  end if;
  if v_phone !~ '^[6-9][0-9]{9}$' then
    return false;
  end if;
  if public.whatsapp_consent_granted(p_slug, v_phone) then
    insert into public.whatsapp_consents (store_slug, phone, granted, source, wording)
    values (p_slug, v_phone, false, 'seller', 'The customer asked the shop to stop WhatsApp offers.');
  end if;
  return true;
end;
$function$;

revoke all on function public.offer_audience(text, text, uuid, text[], jsonb) from public, anon, authenticated;
revoke all on function public.offer_claim(text, uuid, text, jsonb)            from public, anon, authenticated;
revoke all on function public.seller_record_optout(text, text, text)          from public, anon, authenticated;
grant execute on function public.offer_audience(text, text, uuid, text[], jsonb) to anon, authenticated, service_role;
grant execute on function public.seller_record_optout(text, text, text)          to anon, authenticated, service_role;
grant execute on function public.offer_claim(text, uuid, text, jsonb)            to service_role;

commit;
