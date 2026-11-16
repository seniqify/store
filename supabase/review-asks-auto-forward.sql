-- ===========================================================================
-- Ask for reviews, part 2: "Ask automatically" and "Ask all" (2026-11-16,
-- founder: "i want exactly how to did in mockup"; mockup 4G4RXkGPxexuUZYPDdwZeH).
--
-- PocketLink sends the review request from its own WhatsApp (a Seniqify
-- template), 1 Coin (Rs 0.50) each from the shop's wallet, like shipping updates:
--
--   Ask automatically  N days (1, 2, 3 or 5) after an order is delivered, from
--                      11:00 IST, for orders delivered after the switch went on.
--   Ask all            the shop ticks delivered orders and taps one button.
--
-- Every rule lives here; the edge functions (review-asks, review-asks-now) only
-- carry the claimed message to Seniqify:
--   review_asks_due          who is due now (automatic only)
--   review_ask_claim         re-check under a lock, debit 1 Coin, make the
--                            review link (review_invites, exactly as
--                            issue_review_invite does), record, return the parts
--   review_ask_finish        record the answer; a refusal is refunded and its
--                            link removed, so the order shows "To ask" again
--   review_asks_expire_stuck refund anything whose answer never came back
-- Never asked: an order already asked (any way), skipped, reviewed, or whose
-- customer asked to stop; cancelled or returned orders; the shop's own number.
--
-- Also: set_review_ask_auto / get_review_ask_auto (the shop's switch, PIN-checked;
-- the read also gives the menu badge its "to ask" count), and get_review_asks
-- gains a `source` column ('auto' | 'all' | null = asked by the shop itself).
--
-- Code is plain ASCII (tests/sql-paste-safety): the Marathi fallback words are
-- added by the sender, not here.
--
-- RUN: Supabase Dashboard -> SQL Editor -> paste -> Run. Idempotent.
-- VERIFY: supabase/review-asks-auto-verify.sql (every B row PASS)
-- THEN: deploy review-asks + review-asks-now, then review-asks-schedule.sql
-- UNDO: supabase/review-asks-auto-ROLLBACK.sql
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Preflight. get_review_asks is replaced below, so it must be the reviewed
--    part-1 version (or already this one). Anything else stops, nothing changed.
-- ---------------------------------------------------------------------------
do $preflight$
declare
  v_md5 text;
begin
  if to_regclass('public.review_ask_skips') is null then
    raise exception 'preflight: apply review-asks-forward.sql first - nothing changed';
  end if;
  if to_regclass('public.store_message_settings') is null or to_regclass('public.store_wallets') is null then
    raise exception 'preflight: store_message_settings / store_wallets missing - nothing changed';
  end if;
  if to_regprocedure('public.wallet_debit(text,integer,text,text)') is null
     or to_regprocedure('public.wallet_refund(text,text)') is null then
    raise exception 'preflight: wallet functions missing - nothing changed';
  end if;
  if to_regprocedure('public.whatsapp_opted_out(text,text)') is null then
    raise exception 'preflight: whatsapp_opted_out missing - nothing changed';
  end if;
  if to_regclass('public.automation_secrets') is null then
    raise exception 'preflight: automation_secrets missing - nothing changed';
  end if;
  if to_regprocedure('extensions.digest(text,text)') is null
     or to_regprocedure('extensions.gen_random_bytes(integer)') is null then
    raise exception 'preflight: pgcrypto is not installed in schema "extensions" - nothing changed';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'orders' and column_name = 'returned_at') then
    raise exception 'preflight: orders.returned_at missing - nothing changed';
  end if;
  select md5(replace(p.prosrc, chr(13), '')) into v_md5
    from pg_proc p where p.oid = to_regprocedure('public.get_review_asks(text,text)');
  if v_md5 is null or v_md5 not in ('71b5b7a41f5fe42762a7121f03967560', '5abaac44b3ffa781b774cf7e68e63767') then
    raise exception 'preflight: get_review_asks is not the reviewed version (md5 %) - nothing changed', v_md5;
  end if;
end;
$preflight$;

-- ---------------------------------------------------------------------------
-- 2. The shop's settings (one row per shop, shared with the other messages).
-- ---------------------------------------------------------------------------
alter table public.store_message_settings add column if not exists review_ask_auto     boolean not null default false;
alter table public.store_message_settings add column if not exists review_ask_days     integer not null default 2;
alter table public.store_message_settings add column if not exists review_ask_lang     text    not null default 'en';
alter table public.store_message_settings add column if not exists review_ask_couriers boolean not null default true;
alter table public.store_message_settings add column if not exists review_ask_manual   boolean not null default true;
alter table public.store_message_settings add column if not exists review_ask_since    timestamptz;

do $cols$
begin
  if not exists (select 1 from pg_constraint where conname = 'store_message_settings_review_ask_days_check') then
    alter table public.store_message_settings
      add constraint store_message_settings_review_ask_days_check check (review_ask_days in (1, 2, 3, 5));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'store_message_settings_review_ask_lang_check') then
    alter table public.store_message_settings
      add constraint store_message_settings_review_ask_lang_check check (review_ask_lang in ('en', 'mr'));
  end if;
end;
$cols$;

-- ---------------------------------------------------------------------------
-- 3. Every message PocketLink sent (or tried to). One live row per order: a
--    failed one does not block a later try.
-- ---------------------------------------------------------------------------
create table if not exists public.review_ask_sends (
  id               uuid        primary key default gen_random_uuid(),
  store_slug       text        not null,
  order_id         uuid        not null,
  phone            text        not null,
  source           text        not null check (source in ('auto', 'all')),
  lang             text        not null default 'en' check (lang in ('en', 'mr')),
  status           text        not null check (status in ('sending', 'sent', 'failed')),
  debit_ref        text        not null unique,
  token_hash       text,
  provider_status  integer,
  error            text,
  created_at       timestamptz not null default now(),
  sent_at          timestamptz
);
create unique index if not exists review_ask_sends_one_live_per_order
  on public.review_ask_sends (order_id) where status <> 'failed';
create index if not exists review_ask_sends_store_idx  on public.review_ask_sends (store_slug, created_at desc);
create index if not exists review_ask_sends_status_idx on public.review_ask_sends (status, created_at);

alter table public.review_ask_sends enable row level security;
revoke all on public.review_ask_sends from public, anon, authenticated;

insert into public.automation_secrets (name, secret)
values ('review-asks', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
on conflict (name) do nothing;

-- ---------------------------------------------------------------------------
-- 4. Price and the two shared checks.
-- ---------------------------------------------------------------------------
create or replace function public.review_ask_price_paise()
returns integer
language sql
immutable
set search_path = public, pg_temp
as $function$ select 50 $function$;

-- Can this order be reviewed at all? The same rules as issue_review_invite, plus
-- "not returned". Pure: no table reads.
create or replace function public.review_ask_ok(p_order public.orders, p_config jsonb)
returns boolean
language sql
stable
set search_path = public, pg_temp
as $function$
  select coalesce(p_order.status, '') = 'delivered'
     and p_order.returned_at is null
     and coalesce(p_order.total, 0) > 0
     and jsonb_typeof(to_jsonb(p_order.items)) = 'array'
     and jsonb_array_length(to_jsonb(p_order.items)) > 0
     and not (lower(coalesce(p_order.payment_method, '')) = 'online'
              and not coalesce(p_order.paid, false) and p_order.payment_ref is null)
     and right(regexp_replace(coalesce(p_order.customer_phone, ''), '\D', '', 'g'), 10) ~ '^[6-9][0-9]{9}$'
     and right(regexp_replace(coalesce(p_order.customer_phone, ''), '\D', '', 'g'), 10) not in (
           right(regexp_replace(coalesce(p_config ->> 'whatsappNumber', ''), '\D', '', 'g'), 10),
           right(regexp_replace(coalesce(p_config ->> 'ownerPhone', ''), '\D', '', 'g'), 10))
$function$;

-- Never asked in any way, not skipped, not reviewed.
create or replace function public.review_ask_fresh(p_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  select not exists (select 1 from public.review_invites i where i.order_id = p_order_id)
     and not exists (select 1 from public.review_ask_sends s where s.order_id = p_order_id and s.status <> 'failed')
     and not exists (select 1 from public.review_ask_skips k where k.order_id = p_order_id)
     and not exists (select 1 from public.product_reviews r where r.order_id = p_order_id)
$function$;

-- ---------------------------------------------------------------------------
-- 5. The sweep's list (automatic only). service_role only. p_now is for tests.
-- ---------------------------------------------------------------------------
create or replace function public.review_asks_due(p_limit integer default 100, p_now timestamptz default now())
returns table (order_id uuid)
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  select o.id
    from public.store_message_settings s
    join public.store_wallets w on w.store_slug = s.store_slug
                               and w.balance_paise >= public.review_ask_price_paise()
    join public.stores st on st.slug = s.store_slug
    join public.orders o on o.store_slug = s.store_slug
   where s.review_ask_auto
     and s.review_ask_since is not null
     and extract(hour from p_now at time zone 'Asia/Kolkata') >= 11
     and extract(hour from p_now at time zone 'Asia/Kolkata') < 20
     and o.delivered_at is not null
     and o.delivered_at >= s.review_ask_since
     and o.delivered_at > p_now - interval '30 days'
     and (o.delivered_at at time zone 'Asia/Kolkata')::date + s.review_ask_days
         <= (p_now at time zone 'Asia/Kolkata')::date
     and (case when o.awb is not null then s.review_ask_couriers else s.review_ask_manual end)
     and public.review_ask_ok(o, st.config)
     and public.review_ask_fresh(o.id)
     and not public.whatsapp_opted_out(o.store_slug, o.customer_phone)
   order by o.delivered_at
   limit greatest(1, least(coalesce(p_limit, 100), 500))
$function$;

-- ---------------------------------------------------------------------------
-- 6. Claim one: re-check under a per-order lock, debit 1 Coin, make the review
--    link, record, and hand back what to send. One transaction: if anything
--    fails, nothing is charged and nothing recorded. service_role only.
--    p_source 'all' (the shop's button) must name the shop (p_slug).
--    Returns the parts (name, store, item may be empty; the sender fills in
--    the English or Marathi fallback) and the link for the button.
-- ---------------------------------------------------------------------------
create or replace function public.review_ask_claim(
  p_order_id uuid, p_source text default 'auto', p_slug text default null, p_lang text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
declare
  a        public.orders%rowtype;
  s        public.store_message_settings%rowtype;
  v_has_s  boolean;
  v_config jsonb;
  v_id     uuid := gen_random_uuid();
  v_ref    text;
  v_debit  jsonb;
  v_raw    text;
  v_hash   text;
  v_phone  text;
  v_store  text;
  v_name   text;
  v_item   text;
  v_lang   text;
  v_hour   numeric;
begin
  if coalesce(p_source, '') not in ('auto', 'all') then
    return jsonb_build_object('ok', false, 'reason', 'bad_source');
  end if;
  if p_source = 'all' and p_slug is null then
    return jsonb_build_object('ok', false, 'reason', 'no_store');
  end if;

  perform pg_advisory_xact_lock(hashtext('review_ask:' || coalesce(p_order_id::text, '')));

  select * into a from public.orders o where o.id = p_order_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_order');
  end if;
  if p_slug is not null and a.store_slug <> p_slug then
    return jsonb_build_object('ok', false, 'reason', 'not_this_store');
  end if;

  select st.config into v_config from public.stores st where st.slug = a.store_slug;
  select * into s from public.store_message_settings m where m.store_slug = a.store_slug;
  v_has_s := found;

  if p_source = 'auto' then
    if not v_has_s or not s.review_ask_auto or s.review_ask_since is null then
      return jsonb_build_object('ok', false, 'reason', 'off');
    end if;
    if a.delivered_at is null or a.delivered_at < s.review_ask_since then
      return jsonb_build_object('ok', false, 'reason', 'before_on');
    end if;
  end if;

  v_hour := extract(hour from now() at time zone 'Asia/Kolkata');
  if v_hour < 9 or v_hour >= 21 then
    return jsonb_build_object('ok', false, 'reason', 'night');
  end if;
  if not public.review_ask_ok(a, v_config) then
    return jsonb_build_object('ok', false, 'reason', 'not_eligible');
  end if;
  if not public.review_ask_fresh(a.id) then
    return jsonb_build_object('ok', false, 'reason', 'already');
  end if;
  if public.whatsapp_opted_out(a.store_slug, a.customer_phone) then
    return jsonb_build_object('ok', false, 'reason', 'opted_out');
  end if;

  -- The message parts. Meta rejects line breaks, so whitespace is folded.
  v_phone := right(regexp_replace(coalesce(a.customer_phone, ''), '\D', '', 'g'), 10);
  v_store := left(trim(regexp_replace(coalesce(nullif(trim(v_config ->> 'businessName'), ''), a.store_slug), '\s+', ' ', 'g')), 60);
  v_name  := left(split_part(trim(regexp_replace(coalesce(a.customer_name, ''), '\s+', ' ', 'g')), ' ', 1), 40);
  select left(trim(regexp_replace(coalesce(t.e ->> 'name', ''), '\s+', ' ', 'g')), 60)
    into v_item
    from jsonb_array_elements(to_jsonb(a.items)) with ordinality as t(e, n)
   order by t.n
   limit 1;

  v_lang := case when p_source = 'all' then coalesce(nullif(p_lang, ''), case when v_has_s then s.review_ask_lang end, 'en')
                 else coalesce(case when v_has_s then s.review_ask_lang end, 'en') end;
  if v_lang not in ('en', 'mr') then
    v_lang := 'en';
  end if;

  -- Pay for it.
  v_ref := 'review_ask:' || v_id;
  v_debit := public.wallet_debit(a.store_slug, public.review_ask_price_paise(), v_ref,
                                 left('Review request ' || chr(183) || ' ' || coalesce(nullif(v_name, ''), 'customer'), 60));
  if coalesce((v_debit ->> 'ok')::boolean, false) is not true then
    return jsonb_build_object('ok', false, 'reason', 'no_balance');
  end if;

  -- The review link, exactly as issue_review_invite makes it.
  v_raw  := encode(extensions.gen_random_bytes(24), 'hex');
  v_hash := encode(extensions.digest(v_raw, 'sha256'), 'hex');
  update public.review_invites i set revoked_at = now() where i.order_id = a.id and i.revoked_at is null;
  insert into public.review_invites (token_hash, store_slug, order_id, customer_key, expires_at)
  values (v_hash, a.store_slug, a.id,
          encode(extensions.digest(lower(a.store_slug) || ':' || v_phone, 'sha256'), 'hex'),
          now() + interval '60 days');
  insert into public.review_audit (order_id, store_slug, action, actor)
  values (a.id, a.store_slug, 'invite_issued', 'system');

  insert into public.review_ask_sends (id, store_slug, order_id, phone, source, lang, status, debit_ref, token_hash)
  values (v_id, a.store_slug, a.id, v_phone, p_source, v_lang, 'sending', v_ref, v_hash);

  return jsonb_build_object(
    'ok', true,
    'send_id', v_id,
    'lang', v_lang,
    'receiver', '91' || v_phone,
    'name', coalesce(v_name, ''),
    'store', coalesce(v_store, ''),
    'item', coalesce(v_item, ''),
    'link', 'review/' || v_raw);
end;
$function$;

-- ---------------------------------------------------------------------------
-- 7. Record the answer. A refused message is refunded and its link removed, so
--    the order is "To ask" again. p_lang = the language that actually went.
--    service_role only.
-- ---------------------------------------------------------------------------
create or replace function public.review_ask_finish(
  p_send_id uuid, p_sent boolean, p_provider_status integer, p_error text, p_lang text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
declare
  r public.review_ask_sends%rowtype;
begin
  select * into r from public.review_ask_sends x where x.id = p_send_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'unknown');
  end if;
  if r.status <> 'sending' then
    return jsonb_build_object('ok', true, 'already', true, 'status', r.status);
  end if;

  if p_sent is true then
    update public.review_ask_sends x
       set status = 'sent', sent_at = now(), provider_status = p_provider_status,
           lang = case when p_lang in ('en', 'mr') then p_lang else x.lang end
     where x.id = r.id;
  else
    update public.review_ask_sends x
       set status = 'failed', provider_status = p_provider_status, error = left(coalesce(p_error, ''), 300)
     where x.id = r.id;
    perform public.wallet_refund(r.debit_ref, 'Review request not sent');
    delete from public.review_invites i where i.token_hash = r.token_hash;
  end if;
  return jsonb_build_object('ok', true, 'already', false, 'status', case when p_sent is true then 'sent' else 'failed' end);
end;
$function$;

-- ---------------------------------------------------------------------------
-- 8. A send whose answer never came back is refunded after 30 minutes.
--    service_role only; both senders call it first.
-- ---------------------------------------------------------------------------
create or replace function public.review_asks_expire_stuck()
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
  for r in select x.id from public.review_ask_sends x
            where x.status = 'sending' and x.created_at < now() - interval '30 minutes'
            for update skip locked loop
    perform public.review_ask_finish(r.id, false, null, 'no result from the sender');
    n := n + 1;
  end loop;
  return n;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 9. The shop's switch (PIN-checked). Turning it on starts from now: orders
--    delivered earlier are left to "Ask all", never a surprise bill.
-- ---------------------------------------------------------------------------
create or replace function public.set_review_ask_auto(
  p_slug text, p_hashed_pin text, p_on boolean, p_days integer, p_lang text,
  p_couriers boolean, p_manual boolean)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
declare
  v_was_on boolean;
  v_since  timestamptz;
begin
  if not public.verify_store_pin(p_slug, p_hashed_pin) then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  if p_on is null or p_couriers is null or p_manual is null
     or coalesce(p_days, 0) not in (1, 2, 3, 5) or coalesce(p_lang, '') not in ('en', 'mr') then
    raise exception 'invalid settings' using errcode = '22023';
  end if;

  select m.review_ask_auto, m.review_ask_since into v_was_on, v_since
    from public.store_message_settings m where m.store_slug = p_slug;
  v_since := case when not p_on then null
                  when coalesce(v_was_on, false) and v_since is not null then v_since
                  else now() end;

  insert into public.store_message_settings
    (store_slug, review_ask_auto, review_ask_days, review_ask_lang, review_ask_couriers, review_ask_manual, review_ask_since, updated_at)
  values (p_slug, p_on, p_days, p_lang, p_couriers, p_manual, v_since, now())
  on conflict (store_slug) do update
    set review_ask_auto     = excluded.review_ask_auto,
        review_ask_days     = excluded.review_ask_days,
        review_ask_lang     = excluded.review_ask_lang,
        review_ask_couriers = excluded.review_ask_couriers,
        review_ask_manual   = excluded.review_ask_manual,
        review_ask_since    = excluded.review_ask_since,
        updated_at          = now();

  return jsonb_build_object('on', p_on, 'days', p_days, 'lang', p_lang,
                            'couriers', p_couriers, 'manual', p_manual, 'since', v_since);
end;
$function$;

-- ---------------------------------------------------------------------------
-- 10. The switch, the wallet, the last 30 days, and how many delivered orders
--     are waiting to be asked (the menu badge). Wrong PIN: null.
-- ---------------------------------------------------------------------------
create or replace function public.get_review_ask_auto(p_slug text, p_hashed_pin text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
declare
  s        public.store_message_settings%rowtype;
  v_has_s  boolean;
  v_config jsonb;
begin
  if not public.verify_store_pin(p_slug, p_hashed_pin) then
    return null;
  end if;
  select * into s from public.store_message_settings m where m.store_slug = p_slug;
  v_has_s := found;
  select st.config into v_config from public.stores st where st.slug = p_slug;

  return jsonb_build_object(
    'on',       v_has_s and s.review_ask_auto,
    'days',     case when v_has_s then s.review_ask_days else 2 end,
    'lang',     case when v_has_s then s.review_ask_lang else 'en' end,
    'couriers', case when v_has_s then s.review_ask_couriers else true end,
    'manual',   case when v_has_s then s.review_ask_manual else true end,
    'since',    case when v_has_s then s.review_ask_since end,
    'price_paise',   public.review_ask_price_paise(),
    'balance_paise', coalesce((select w.balance_paise from public.store_wallets w where w.store_slug = p_slug), 0),
    'to_ask', (select count(*) from public.orders o
                where o.store_slug = p_slug
                  and coalesce(o.delivered_at, o.created_at) > now() - interval '30 days'
                  and public.review_ask_ok(o, v_config)
                  and public.review_ask_fresh(o.id)),
    'auto_30d', (select count(*) from public.review_ask_sends x
                  where x.store_slug = p_slug and x.source = 'auto' and x.status = 'sent'
                    and x.created_at > now() - interval '30 days'),
    'auto_reviewed_30d', (select count(*) from public.review_ask_sends x
                           where x.store_slug = p_slug and x.source = 'auto' and x.status = 'sent'
                             and x.created_at > now() - interval '30 days'
                             and exists (select 1 from public.product_reviews r where r.order_id = x.order_id)));
end;
$function$;

-- ---------------------------------------------------------------------------
-- 11. get_review_asks gains `source`: how the latest ask went out ('auto',
--     'all', or null when the shop sent it from its own WhatsApp). The return
--     type changes, so it is dropped and made again in this transaction.
-- ---------------------------------------------------------------------------
drop function if exists public.get_review_asks(text, text);
create function public.get_review_asks(p_slug text, p_hashed_pin text)
returns table (
  order_id uuid, asked_at timestamptz, first_asked_at timestamptz,
  ask_count integer, skipped_at timestamptz, source text)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
#variable_conflict use_column
begin
  if not public.verify_store_pin(p_slug, p_hashed_pin) then
    return;
  end if;
  return query
    with asks as (
      select i.order_id as oid, max(i.issued_at) as last_at, min(i.issued_at) as first_at,
             count(*)::integer as n
        from public.review_invites i
       where i.store_slug = p_slug
       group by i.order_id
    ), skips as (
      select k.order_id as oid, k.skipped_at as at
        from public.review_ask_skips k
       where k.store_slug = p_slug
    ), sends as (
      select distinct on (x.order_id) x.order_id as oid, x.source as src
        from public.review_ask_sends x
       where x.store_slug = p_slug and x.status <> 'failed'
       order by x.order_id, x.created_at desc
    )
    select coalesce(a.oid, s.oid), a.last_at, a.first_at, coalesce(a.n, 0), s.at, d.src
      from asks a
      full join skips s on s.oid = a.oid
      left join sends d on d.oid = coalesce(a.oid, s.oid)
     limit 20000;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 12. Who may call what (revoked BY NAME first: Supabase's default privileges
--     grant EXECUTE on every new function).
-- ---------------------------------------------------------------------------
revoke all on function public.review_ask_price_paise()                                           from public, anon, authenticated;
revoke all on function public.review_ask_ok(public.orders, jsonb)                               from public, anon, authenticated;
revoke all on function public.review_ask_fresh(uuid)                                            from public, anon, authenticated;
revoke all on function public.review_asks_due(integer, timestamptz)                             from public, anon, authenticated;
revoke all on function public.review_ask_claim(uuid, text, text, text)                           from public, anon, authenticated;
revoke all on function public.review_ask_finish(uuid, boolean, integer, text, text)              from public, anon, authenticated;
revoke all on function public.review_asks_expire_stuck()                                        from public, anon, authenticated;
revoke all on function public.set_review_ask_auto(text, text, boolean, integer, text, boolean, boolean) from public, anon, authenticated;
revoke all on function public.get_review_ask_auto(text, text)                                   from public, anon, authenticated;
revoke all on function public.get_review_asks(text, text)                                       from public, anon, authenticated;

grant execute on function public.review_ask_price_paise()                                         to service_role;
grant execute on function public.review_ask_ok(public.orders, jsonb)                             to service_role;
grant execute on function public.review_ask_fresh(uuid)                                          to service_role;
grant execute on function public.review_asks_due(integer, timestamptz)                           to service_role;
grant execute on function public.review_ask_claim(uuid, text, text, text)                         to service_role;
grant execute on function public.review_ask_finish(uuid, boolean, integer, text, text)            to service_role;
grant execute on function public.review_asks_expire_stuck()                                      to service_role;
grant execute on function public.set_review_ask_auto(text, text, boolean, integer, text, boolean, boolean) to anon, authenticated, service_role;
grant execute on function public.get_review_ask_auto(text, text)                                 to anon, authenticated, service_role;
grant execute on function public.get_review_asks(text, text)                                     to anon, authenticated, service_role;

commit;
