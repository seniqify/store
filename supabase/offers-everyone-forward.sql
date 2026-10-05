-- ===========================================================================
--  Offers to every customer  --  not only those who ticked the box
--
--  Founder decision, 2026-10-04: offers (Customers -> Send an offer) go to
--  every customer of the shop, the same rule cart reminders follow since v2.
--  Never to anyone who asked to stop (whatsapp_opted_out: ticked then
--  unticked the box at checkout, tapped Stop offers, or the shop recorded it).
--  Unchanged: only numbers that ordered (or started an order) at this shop,
--  at most one offer every 3 days per customer, Rs 1.50 from the wallet.
--
--  Also fixes: the shop's "Stop offers" for a customer who never ticked the
--  box saved nothing, so cart reminders kept going to them. Now it always
--  saves the stop (once).
--
--  Replaces three live functions (each md5-checked first: the bodies from
--  offers-forward.sql / messages-v2-forward.sql, or this file's own):
--    offer_audience        verdict 'no_consent' -> 'opted_out'
--    offer_claim           reason  'no_consent' -> 'opted_out'
--    seller_record_optout  records the stop for every customer
--  Same signatures, same grants. Data is untouched.
--
--  RUN: Supabase Dashboard -> SQL Editor -> paste -> Run. Idempotent.
--  VERIFY afterwards: supabase/offers-everyone-verify.sql (every C row PASS)
--  UNDO: supabase/offers-everyone-ROLLBACK.sql (restores the old bodies exactly)
-- ===========================================================================

begin;

do $preflight$
declare
  v record;
begin
  if to_regprocedure('public.whatsapp_opted_out(text,text)') is null then
    raise exception 'preflight: whatsapp_opted_out is missing - run messages-v2-forward.sql first - nothing changed';
  end if;
  for v in
    select * from (values
      ('public.offer_audience(text,text,uuid,text[],jsonb)', 'b3312b3b091f2fa68d5d098acf4716c7', '6de2710c9f26bb3fc87e66712c589ec2'),
      ('public.offer_claim(text,uuid,text,jsonb)',           'e26ad9fa1fad1bf4e5cb46c286b17ca0', '3b9ec7bace212a5f9315641c7d46a465'),
      ('public.seller_record_optout(text,text,text)',        '8ada037494f02bb72b2feaac92d405c8', '711db68335f6d4535a760d5c1a9d9198')
    ) t(sig, old, new)
  loop
    if to_regprocedure(v.sig) is null then
      raise exception 'preflight: % is missing - run offers-forward.sql first - nothing changed', v.sig;
    end if;
    if (select md5(replace(p.prosrc, chr(13), '')) from pg_proc p where p.oid = to_regprocedure(v.sig)) not in (v.old, v.new) then
      raise exception 'preflight: % is not the reviewed version - nothing changed', v.sig;
    end if;
  end loop;
end;
$preflight$;

-- ---------------------------------------------------------------------------
-- 1. Before sending: who of these customers can receive this offer, and what
--    it costs. PIN-checked; changes nothing.
-- ---------------------------------------------------------------------------
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
             when public.whatsapp_opted_out(p_slug, i.phone) then 'opted_out'
             when exists (select 1 from public.offer_sends s where s.store_slug = p_slug and s.phone = i.phone
                            and s.status <> 'failed' and s.created_at > now() - interval '3 days') then 'recent'
             else 'ok'
           end as verdict
      from input i
  )
  select jsonb_build_object(
           'ok', true,
           'eligible', count(*) filter (where verdict = 'ok'),
           'opted_out', count(*) filter (where verdict = 'opted_out'),
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

-- ---------------------------------------------------------------------------
-- 2. Sending one: re-check under a lock, build the values, debit, record.
--    service_role only (the send-offer edge function, after the PIN check).
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
  if public.whatsapp_opted_out(p_slug, v_phone) then
    return jsonb_build_object('ok', false, 'reason', 'opted_out');
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

-- ---------------------------------------------------------------------------
-- 3. A customer asked the shop to stop: the shop records it (PIN). From then
--    on no offer or cart reminder goes to that number from this shop - whether
--    or not they ever ticked the box. Saved once.
-- ---------------------------------------------------------------------------
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
  if not public.whatsapp_opted_out(p_slug, v_phone) then
    insert into public.whatsapp_consents (store_slug, phone, granted, source, wording)
    values (p_slug, v_phone, false, 'seller', 'The customer asked the shop to stop WhatsApp offers.');
  end if;
  return true;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 4. Who may call what - unchanged, restated (revoked BY NAME first).
-- ---------------------------------------------------------------------------
revoke all on function public.offer_audience(text, text, uuid, text[], jsonb) from public, anon, authenticated;
revoke all on function public.offer_claim(text, uuid, text, jsonb)            from public, anon, authenticated;
revoke all on function public.seller_record_optout(text, text, text)          from public, anon, authenticated;
grant execute on function public.offer_audience(text, text, uuid, text[], jsonb) to anon, authenticated, service_role;
grant execute on function public.seller_record_optout(text, text, text)          to anon, authenticated, service_role;
grant execute on function public.offer_claim(text, uuid, text, jsonb)            to service_role;

commit;
