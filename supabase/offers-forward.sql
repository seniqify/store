-- ===========================================================================
--  WhatsApp offers to your customers  --  PRs 4 + 5 of the automatic-messages
--  project: ready-made messages, a shop's own messages (requested, approved by
--  the founder), and sending either to a group of customers, paid per message
--  from the shop's wallet.
--
--  Replaces the old "Connect WhatsApp campaigns" card, which asked a shopkeeper
--  to create a Meta template and paste its API link themselves.
--
--  TEMPLATES (message_templates)
--    * Ready-made: store_slug NULL, created by the founder in the Console after
--      Meta approves it in Seniqify. Every shop can use it.
--    * A shop's own: the shop writes the message in Manage -> "Waiting for
--      approval". The founder creates it in Seniqify, pastes its /process URL in
--      the Console -> "Approved", usable by that shop only. Or rejects it with a
--      reason the shop sees.
--    * The message text may use {name} (customer's first name), {shop} (shop
--      name) and the shop-filled {offer} {item} {code} {date}. Their order of
--      appearance is the template's {{1}}, {{2}}, ...; the "Shop now" button is
--      always the last variable and opens the shop (its slug).
--    * template_url is the credential (anyone holding it can send on the
--      founder's account): the browser never receives it, the Console only
--      learns whether one is set.
--
--  WHO RECEIVES AN OFFER — checked for every customer, under a lock, at send
--    * a customer of THIS shop (has an order or a checkout in it);
--    * agreed to WhatsApp offers from this shop (whatsapp_consent_granted) —
--      today that is only customers who ticked the checkout box (#42), so the
--      first sends are small, and that is the point;
--    * no offer from this shop in the last 3 days;
--    * the shop's wallet pays Rs 1.50; a refused message is refunded.
--
--  The shop-filled values are short (60) and may not contain links: the only
--  link in an offer is the shop's own button.
--
--  ORDER: wallet-forward.sql, whatsapp-consent-forward.sql and
--  cart-reminders-forward.sql first (checked below).
--  RUN: Supabase Dashboard -> SQL Editor -> paste -> Run. Idempotent.
--  VERIFY afterwards: supabase/offers-verify.sql   UNDO: supabase/offers-ROLLBACK.sql
-- ===========================================================================

begin;

do $preflight$
begin
  if to_regprocedure('public.verify_store_pin(text,text)') is null then
    raise exception 'preflight: public.verify_store_pin is missing - nothing changed';
  end if;
  if to_regprocedure('public.wallet_debit(text,integer,text,text)') is null then
    raise exception 'preflight: run supabase/wallet-forward.sql first - nothing changed';
  end if;
  if to_regprocedure('public.whatsapp_consent_granted(text,text)') is null or to_regclass('public.whatsapp_consents') is null then
    raise exception 'preflight: run supabase/whatsapp-consent-forward.sql first - nothing changed';
  end if;
  if to_regprocedure('public.cart_reminder_param(text,integer,text)') is null then
    raise exception 'preflight: run supabase/cart-reminders-forward.sql first (its template-value cleaner is shared) - nothing changed';
  end if;
  if to_regclass('public.crm_team') is null then
    raise exception 'preflight: public.crm_team is missing (the Console admin list) - nothing changed';
  end if;
end;
$preflight$;

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------
create table if not exists public.message_templates (
  id             uuid primary key default gen_random_uuid(),
  store_slug     text,
  name           text not null check (char_length(name) between 2 and 40),
  body           text not null check (char_length(body) between 10 and 600),
  value_map      text[] not null default '{}',
  template_url   text check (template_url is null or template_url ~ '^https://[A-Za-z0-9.-]+/'),
  status         text not null default 'requested' check (status in ('requested', 'approved', 'rejected', 'retired')),
  reject_reason  text check (char_length(reject_reason) <= 200),
  created_at     timestamptz not null default now(),
  decided_at     timestamptz,
  decided_by     uuid,
  check (status <> 'approved' or template_url is not null)
);
create index if not exists message_templates_store_idx on public.message_templates (store_slug, status);

create table if not exists public.offer_sends (
  id               uuid primary key default gen_random_uuid(),
  store_slug       text not null,
  template_id      uuid not null,
  phone            text not null,
  status           text not null check (status in ('sending', 'sent', 'failed')),
  debit_ref        text not null unique,
  provider_status  integer,
  error            text,
  created_at       timestamptz not null default now(),
  sent_at          timestamptz
);
create index if not exists offer_sends_customer_idx on public.offer_sends (store_slug, phone, created_at desc);
create index if not exists offer_sends_status_idx   on public.offer_sends (status, created_at);

alter table public.message_templates enable row level security;
alter table public.offer_sends       enable row level security;
revoke all on public.message_templates, public.offer_sends from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Message text helpers
-- ---------------------------------------------------------------------------
-- The template's variables, in order: every {placeholder} as it appears, then
-- 'link' for the button. Unknown placeholders are an error.
create or replace function public.offer_value_map(p_body text)
returns text[]
language plpgsql
immutable
set search_path = public, pg_temp
as $function$
declare
  v_map text[] := '{}';
  m     text[];
begin
  for m in select regexp_matches(coalesce(p_body, ''), '\{([^{}]*)\}', 'g') loop
    if m[1] not in ('name', 'shop', 'offer', 'item', 'code', 'date') then
      raise exception 'offer: unknown placeholder {%} - use {name}, {shop}, {offer}, {item}, {code} or {date}', m[1];
    end if;
    v_map := v_map || m[1];
  end loop;
  return v_map || 'link'::text;
end;
$function$;

-- A shop-filled value: one line, short, never a link.
create or replace function public.offer_field_ok(p_value text)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $function$
  select coalesce(trim(p_value), '') <> ''
     and char_length(trim(p_value)) <= 60
     -- \y is PostgreSQL's word boundary (\b would be a backspace here).
     and p_value !~* '(https?://|www\.|\.(com|in|net|org|link|ly|me)\y|wa\.me)'
$function$;

-- ---------------------------------------------------------------------------
-- 3. What a shop sees: ready-made approved messages + its own (any status).
--    Never the template_url. PIN-checked.
-- ---------------------------------------------------------------------------
create or replace function public.list_message_templates(p_slug text, p_hashed_pin text)
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
             'id', t.id, 'name', t.name, 'body', t.body, 'status', t.status,
             'own', t.store_slug is not null, 'reject_reason', t.reject_reason,
             'fields', (select coalesce(jsonb_agg(distinct f), '[]'::jsonb)
                          from unnest(t.value_map) f where f in ('offer', 'item', 'code', 'date')),
             'created_at', t.created_at)
           order by (t.store_slug is null), t.created_at desc)
      from public.message_templates t
     where (t.store_slug is null and t.status = 'approved')
        or (t.store_slug = p_slug and t.status <> 'retired')), '[]'::jsonb);
end;
$function$;

-- A shop asks for its own message. At most 5 waiting at once.
create or replace function public.request_message_template(p_slug text, p_hashed_pin text, p_name text, p_body text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
declare
  v_name text := left(trim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')), 40);
  v_body text := trim(coalesce(p_body, ''));
  v_id   uuid;
begin
  if not public.verify_store_pin(p_slug, p_hashed_pin) then
    return null;
  end if;
  if char_length(v_name) < 2 then
    return jsonb_build_object('ok', false, 'error', 'Give the message a short name.');
  end if;
  if char_length(v_body) < 10 or char_length(v_body) > 600 then
    return jsonb_build_object('ok', false, 'error', 'The message must be 10 to 600 characters.');
  end if;
  if v_body ~* '(https?://|www\.|wa\.me)' then
    return jsonb_build_object('ok', false, 'error', 'Leave links out — every message gets a "Shop now" button to your shop.');
  end if;
  begin
    perform public.offer_value_map(v_body);
  exception when others then
    return jsonb_build_object('ok', false, 'error', 'Use only {name}, {shop}, {offer}, {item}, {code} or {date} in curly brackets.');
  end;
  if (select count(*) from public.message_templates t where t.store_slug = p_slug and t.status = 'requested') >= 5 then
    return jsonb_build_object('ok', false, 'error', 'You already have 5 messages waiting for approval.');
  end if;

  insert into public.message_templates (store_slug, name, body, value_map, status)
  values (p_slug, v_name, v_body, public.offer_value_map(v_body), 'requested')
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$function$;

-- ---------------------------------------------------------------------------
-- 4. Before sending: who of these customers can receive this offer, and what
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

-- ---------------------------------------------------------------------------
-- 5. Sending one: re-check under a lock, build the values, debit, record.
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

create or replace function public.offer_finish(p_send_id uuid, p_sent boolean, p_provider_status integer, p_error text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
declare
  s public.offer_sends%rowtype;
begin
  select * into s from public.offer_sends o where o.id = p_send_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'unknown');
  end if;
  if s.status <> 'sending' then
    return jsonb_build_object('ok', true, 'already', true, 'status', s.status);
  end if;
  if p_sent is true then
    update public.offer_sends o set status = 'sent', sent_at = now(), provider_status = p_provider_status where o.id = s.id;
  else
    update public.offer_sends o set status = 'failed', provider_status = p_provider_status, error = left(coalesce(p_error, ''), 300)
     where o.id = s.id;
    perform public.wallet_refund(s.debit_ref, 'Offer not sent');
  end if;
  return jsonb_build_object('ok', true, 'already', false, 'status', case when p_sent is true then 'sent' else 'failed' end);
end;
$function$;

create or replace function public.offer_sends_expire_stuck()
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
  for r in select o.id from public.offer_sends o
            where o.status = 'sending' and o.created_at < now() - interval '30 minutes'
            for update skip locked loop
    perform public.offer_finish(r.id, false, null, 'no result from the sender');
    n := n + 1;
  end loop;
  return n;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 6. A customer asked the shop to stop: the shop records it (PIN). From then
--    on no offer or cart reminder goes to that number from this shop.
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
  if public.whatsapp_consent_granted(p_slug, v_phone) then
    insert into public.whatsapp_consents (store_slug, phone, granted, source, wording)
    values (p_slug, v_phone, false, 'seller', 'The customer asked the shop to stop WhatsApp offers.');
  end if;
  return true;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 7. The founder's Console (crm_team admin, signed in with Supabase auth).
-- ---------------------------------------------------------------------------
create or replace function public.admin_list_message_templates()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
begin
  if not exists (select 1 from public.crm_team c where c.user_id = auth.uid() and c.role = 'admin') then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', t.id, 'store_slug', t.store_slug,
             'store_name', (select st.config->>'businessName' from public.stores st where st.slug = t.store_slug),
             'name', t.name, 'body', t.body, 'value_map', to_jsonb(t.value_map), 'status', t.status,
             'has_url', t.template_url is not null, 'reject_reason', t.reject_reason,
             'created_at', t.created_at, 'decided_at', t.decided_at)
           order by (t.status = 'requested') desc, t.created_at desc)
      from public.message_templates t), '[]'::jsonb);
end;
$function$;

-- Approve (with the Seniqify /process URL), reject (with a reason the shop
-- sees) or retire. A ready-made message is created here directly.
create or replace function public.admin_decide_message_template(p_id uuid, p_decision text, p_template_url text, p_reason text)
returns boolean
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
begin
  if not exists (select 1 from public.crm_team c where c.user_id = auth.uid() and c.role = 'admin') then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  if p_decision = 'approved' then
    if coalesce(p_template_url, '') !~ '^https://[A-Za-z0-9.-]+/' then
      raise exception 'paste the template''s https /process URL from Seniqify';
    end if;
    update public.message_templates t
       set status = 'approved', template_url = trim(p_template_url), reject_reason = null,
           decided_at = now(), decided_by = auth.uid()
     where t.id = p_id;
  elsif p_decision = 'rejected' then
    update public.message_templates t
       set status = 'rejected', reject_reason = left(coalesce(nullif(trim(p_reason), ''), 'Not approved'), 200),
           decided_at = now(), decided_by = auth.uid()
     where t.id = p_id;
  elsif p_decision = 'retired' then
    update public.message_templates t set status = 'retired', decided_at = now(), decided_by = auth.uid() where t.id = p_id;
  else
    raise exception 'decision must be approved, rejected or retired';
  end if;
  return found;
end;
$function$;

create or replace function public.admin_create_ready_template(p_name text, p_body text, p_template_url text)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
declare
  v_id uuid;
begin
  if not exists (select 1 from public.crm_team c where c.user_id = auth.uid() and c.role = 'admin') then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  if coalesce(p_template_url, '') !~ '^https://[A-Za-z0-9.-]+/' then
    raise exception 'paste the template''s https /process URL from Seniqify';
  end if;
  insert into public.message_templates (store_slug, name, body, value_map, template_url, status, decided_at, decided_by)
  values (null, left(trim(p_name), 40), trim(p_body), public.offer_value_map(trim(p_body)), trim(p_template_url),
          'approved', now(), auth.uid())
  returning id into v_id;
  return v_id;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 8. Who may call what (revoked from anon/authenticated BY NAME first).
-- ---------------------------------------------------------------------------
revoke all on function public.offer_value_map(text)                                       from public, anon, authenticated;
revoke all on function public.offer_field_ok(text)                                        from public, anon, authenticated;
revoke all on function public.list_message_templates(text, text)                          from public, anon, authenticated;
revoke all on function public.request_message_template(text, text, text, text)            from public, anon, authenticated;
revoke all on function public.offer_audience(text, text, uuid, text[], jsonb)             from public, anon, authenticated;
revoke all on function public.offer_claim(text, uuid, text, jsonb)                        from public, anon, authenticated;
revoke all on function public.offer_finish(uuid, boolean, integer, text)                  from public, anon, authenticated;
revoke all on function public.offer_sends_expire_stuck()                                  from public, anon, authenticated;
revoke all on function public.seller_record_optout(text, text, text)                      from public, anon, authenticated;
revoke all on function public.admin_list_message_templates()                              from public, anon, authenticated;
revoke all on function public.admin_decide_message_template(uuid, text, text, text)       from public, anon, authenticated;
revoke all on function public.admin_create_ready_template(text, text, text)               from public, anon, authenticated;

-- Shops (PIN holders, no login): anon.
grant execute on function public.list_message_templates(text, text)                       to anon, authenticated, service_role;
grant execute on function public.request_message_template(text, text, text, text)         to anon, authenticated, service_role;
grant execute on function public.offer_audience(text, text, uuid, text[], jsonb)          to anon, authenticated, service_role;
grant execute on function public.seller_record_optout(text, text, text)                   to anon, authenticated, service_role;
-- The sender (send-offer edge function).
grant execute on function public.offer_value_map(text)                                    to service_role;
grant execute on function public.offer_field_ok(text)                                     to service_role;
grant execute on function public.offer_claim(text, uuid, text, jsonb)                     to service_role;
grant execute on function public.offer_finish(uuid, boolean, integer, text)               to service_role;
grant execute on function public.offer_sends_expire_stuck()                               to service_role;
-- The Console signs in with Supabase auth; each function checks crm_team admin.
grant execute on function public.admin_list_message_templates()                           to authenticated;
grant execute on function public.admin_decide_message_template(uuid, text, text, text)    to authenticated;
grant execute on function public.admin_create_ready_template(text, text, text)            to authenticated;

commit;
