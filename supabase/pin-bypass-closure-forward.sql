-- ═══════════════════════════════════════════════════════════════════════════
--  Close the PIN-throttle bypasses  —  APPLIED TO PRODUCTION 2026-09-13
-- ═══════════════════════════════════════════════════════════════════════════
--
--  WHAT IS WRONG
--
--  verify_store_pin is throttled and works. Eleven other functions ask the same
--  question themselves:
--
--      exists (select 1 from public.stores s
--               where s.slug = p_slug and s.pin = p_hashed_pin)
--
--  and count nothing. An attacker has no reason to ever call the one function
--  that enforces a limit. The lockout guards a door nobody needs to use.
--
--  A PocketLink PIN is four digits. hashPin() (src/utils/pinHash.js) is
--  SHA-256('snq1_' || pin) with a constant salt shipped in browser JS, so the
--  complete table of 10,000 valid hashes is computed once, offline, and works
--  against every store on the platform.
--
--  get_store_orders is the cheapest way in: anon-executable, unlimited, and the
--  call that confirms a guess returns 500 rows of customer names, phone numbers
--  and delivery addresses in the same response. update_store_config is a purer
--  oracle still -- it returns boolean, true only on a correct PIN.
--
--  reset_store_pin is worse and needs no PIN at all. It takes the store slug
--  (the storefront URL), the store's WhatsApp number (printed on every
--  storefront) and a six-digit OTP -- 900,000 values, ten-minute window, no
--  attempt limit of any kind -- and then SETS the PIN to whatever the caller
--  passes. The attacker can trigger a fresh OTP whenever the window closes; the
--  merchant just receives a message they ignore. That is full account takeover
--  plus lockout, from public information.
--
--  WHAT THIS DOES
--
--   1. pin_attempts gains `kind`, so PIN failures and OTP failures have
--      separate budgets. Without it, someone hammering the reset flow could
--      lock a merchant out of PIN entry as well -- and the reset flow is what a
--      locked-out merchant uses.
--   2. verify_store_pin records FAILURES ONLY, and a correct PIN no longer
--      wipes them (see (b)).
--   3. All eleven PIN-gated functions delegate to verify_store_pin.
--   4. reset_store_pin throttles its OTP through the same ledger.
--   5. search_path is pinned as `public, pg_temp` on all twelve.
--
--  Signatures, return types and grants are unchanged throughout, so every
--  existing caller keeps working and no client change is needed.
--
--  TWO THINGS THAT ARE NOT OBVIOUS
--
--  (a) Four of these were LANGUAGE sql with the check inside a WHERE clause.
--      verify_store_pin is VOLATILE, so the planner cannot hoist it out of a row
--      filter -- a naive swap would have made get_store_orders record 500
--      attempts per call. Those four become plpgsql with one check before the
--      query runs.
--
--  (b) new_orders_since is polled every 15 seconds by every open dashboard
--      (src/hooks/useNewOrders.js:24). verify_store_pin currently writes a row on
--      SUCCESS too, which on that path is ~4 writes/minute/seller forever. The
--      limit only ever counts failures (`and not success`), so the success rows
--      buy nothing. They are dropped.
--
--      It also DELETES the store's failures on every success. On a 15-second
--      poll that resets an attacker's count four times a minute while the
--      seller has the dashboard open. That clear is removed; failures expire
--      after 15 minutes on their own.
--
--  WHY `public, pg_temp` AND NOT `public`
--
--  Seven of these already carry SET search_path TO 'public'. That is weaker than
--  it looks: PostgreSQL searches the session's temporary schema FIRST -- before
--  pg_catalog -- whenever pg_temp is not named explicitly in the path. Listing
--  it last is what stops a caller's temporary objects from shadowing anything,
--  and is what the PostgreSQL manual prescribes for SECURITY DEFINER functions.
--  verify_store_pin already does this correctly; the other eleven now match it.
--
--  BEFORE YOU APPLY: capture the current definitions. They are your rollback,
--  and this file deliberately ships no rollback of its own, because reverting
--  means restoring the bypasses.
--
--    select p.proname, pg_get_functiondef(p.oid)
--    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public'
--      and p.proname in ('verify_store_pin','delete_review','get_store_ai_searches',
--                        'get_store_orders','get_store_reviews','get_store_whatsapp',
--                        'new_orders_since','reset_store_pin','set_order_paid',
--                        'set_review_status','set_store_whatsapp',
--                        'update_order_status','update_store_config');
--
--  RUN: Supabase Dashboard → SQL Editor → paste → Run. Idempotent.
--  Verify with supabase/pin-bypass-closure-verify.sql (read-only).
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- ── 1. Separate budgets for PIN and OTP attempts ────────────────────────────
-- Additive, with a default, so it is a metadata-only change on PG11+.
alter table public.pin_attempts
  add column if not exists kind text not null default 'pin';

alter table public.pin_attempts
  drop constraint if exists pin_attempts_kind_known;
alter table public.pin_attempts
  add constraint pin_attempts_kind_known check (kind in ('pin', 'otp'));

comment on column public.pin_attempts.kind is
  'pin = a store PIN attempt via verify_store_pin. otp = a PIN-reset OTP attempt '
  'via reset_store_pin. Separate budgets: flooding one must not lock the other, '
  'because the reset flow is the way back in for a merchant locked out of the PIN.';

create index if not exists pin_attempts_kind_slug_time_idx
  on public.pin_attempts (kind, slug, attempted_at desc);


-- ── 2. The throttled verifier — failures only ───────────────────────────────
create or replace function public.verify_store_pin(p_slug text, p_hashed_pin text)
returns boolean
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
declare
  c_window     constant interval := interval '15 minutes';
  c_max_ip     constant integer  := 10;   -- per address, per store
  c_max_store  constant integer  := 50;   -- store-wide ceiling
  v_ip         text;
  v_fails_ip   integer := 0;
  v_fails_slug integer := 0;
  v_ok         boolean;
begin
  -- Caller address, when PostgREST forwards one. Absent (or malformed) simply
  -- means the per-IP limit cannot apply; the store-wide ceiling still does.
  begin
    v_ip := nullif(btrim(split_part(
      coalesce(current_setting('request.headers', true)::json ->> 'x-forwarded-for', ''),
      ',', 1)), '');
  exception when others then
    v_ip := null;
  end;

  select
    count(*) filter (where v_ip is not null and ip = v_ip),
    count(*)
  into v_fails_ip, v_fails_slug
  from public.pin_attempts
  where slug = p_slug
    and kind = 'pin'
    and not success
    and attempted_at > now() - c_window;

  -- Locked out: record the attempt (so the window keeps sliding for a
  -- persistent attacker) and refuse WITHOUT touching the stored PIN.
  if (v_ip is not null and v_fails_ip >= c_max_ip) or v_fails_slug >= c_max_store then
    insert into public.pin_attempts (slug, ip, success, kind)
    values (p_slug, v_ip, false, 'pin');
    return false;
  end if;

  select exists (
    select 1 from public.stores
    where slug = p_slug and pin = p_hashed_pin
  ) into v_ok;

  -- Successes are NOT recorded: the limit counts only failures, and
  -- new_orders_since calls this every 15 seconds from every open dashboard.
  --
  -- A correct PIN does NOT clear earlier failures either. It used to, when only
  -- the login screen called this. Now the 15-second poll does too, so a clear
  -- would wipe an attacker's count four times a minute for as long as the real
  -- seller has Manage open, and the limit would stop nothing. Failures simply
  -- age out of the 15-minute window.
  if not v_ok then
    insert into public.pin_attempts (slug, ip, success, kind)
    values (p_slug, v_ip, false, 'pin');
  end if;

  -- Opportunistic pruning — roughly one call in a hundred pays for it, so the
  -- ledger cannot grow without bound and no scheduled job is needed.
  if random() < 0.01 then
    delete from public.pin_attempts where attempted_at < now() - interval '2 days';
  end if;

  return v_ok;
end;
$function$;


-- ═══════════════════════════════════════════════════════════════════════════
--  3. The four readers that were LANGUAGE sql
-- ═══════════════════════════════════════════════════════════════════════════
-- Each had `and exists (select 1 from public.stores s ...)` inside a WHERE
-- clause. verify_store_pin is VOLATILE and cannot be hoisted out of a row
-- filter, so the check moves to a single statement before the query.

create or replace function public.get_store_orders(p_slug text, p_hashed_pin text)
returns setof public.orders
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
begin
  if not public.verify_store_pin(p_slug, p_hashed_pin) then
    return;                       -- empty set, exactly as before
  end if;
  return query
    select o.* from public.orders o
    where o.store_slug = p_slug
    order by o.created_at desc
    limit 500;
end;
$function$;

create or replace function public.get_store_reviews(p_slug text, p_hashed_pin text)
returns setof public.reviews
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
begin
  if not public.verify_store_pin(p_slug, p_hashed_pin) then
    return;
  end if;
  return query
    select r.* from public.reviews r
    where r.store_slug = p_slug
    order by r.created_at desc;
end;
$function$;

create or replace function public.get_store_ai_searches(p_slug text, p_hashed_pin text)
returns setof public.ai_searches
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
begin
  if not public.verify_store_pin(p_slug, p_hashed_pin) then
    return;
  end if;
  return query
    select a.* from public.ai_searches a
    where a.store_slug = p_slug
    order by a.created_at desc
    limit 3000;
end;
$function$;

-- Polled every 15 seconds per open dashboard. On a refused PIN the original
-- returned ONE row of zeros -- an aggregate with no GROUP BY always does -- and
-- useNewOrders reads data[0], so that shape is preserved deliberately.
create or replace function public.new_orders_since(
  p_slug text, p_hashed_pin text, p_since timestamp with time zone)
returns table(new_count integer, latest_name text, latest_total numeric,
              latest_at timestamp with time zone)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
begin
  if not public.verify_store_pin(p_slug, p_hashed_pin) then
    return query select 0, null::text, null::numeric, null::timestamptz;
    return;
  end if;
  return query
    select
      count(*)::int,
      (array_agg(o.customer_name order by o.created_at desc))[1],
      (array_agg(o.total        order by o.created_at desc))[1],
      max(o.created_at)
    from public.orders o
    where o.store_slug = p_slug
      and o.status = 'new'
      and o.created_at > p_since
      and (
        coalesce(o.payment_method, '') <> 'online'   -- cod / upi / qr / bank: unchanged
        or o.paid                                     -- verified payment
        or o.payment_ref is not null                  -- captured but unverified
      );
end;
$function$;


-- ═══════════════════════════════════════════════════════════════════════════
--  4. The six that already checked once, at the top
-- ═══════════════════════════════════════════════════════════════════════════
-- Bodies unchanged apart from the auth line and the pinned search_path.

create or replace function public.get_store_whatsapp(p_slug text, p_hashed_pin text)
returns table(configured boolean, template_url text, api_key_masked text, var_templates jsonb)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
begin
  if not public.verify_store_pin(p_slug, p_hashed_pin) then
    raise exception 'unauthorized';
  end if;

  return query
    select
      (w.template_url is not null and w.template_url <> '') as configured,
      coalesce(w.template_url, '') as template_url,
      case when w.api_key is null or w.api_key = '' then ''
           else '••••' || right(w.api_key, 4) end as api_key_masked,
      coalesce(w.var_templates, '["{name}"]'::jsonb) as var_templates
    from public.store_whatsapp w
    where w.store_slug = p_slug;
end;
$function$;

create or replace function public.set_store_whatsapp(
  p_slug text, p_hashed_pin text, p_template_url text, p_api_key text, p_var_templates jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
begin
  if not public.verify_store_pin(p_slug, p_hashed_pin) then
    raise exception 'unauthorized';
  end if;

  insert into public.store_whatsapp (store_slug, template_url, api_key, var_templates, updated_at)
  values (p_slug, p_template_url, nullif(p_api_key, ''),
          coalesce(p_var_templates, '["{name}"]'::jsonb), now())
  on conflict (store_slug) do update set
    template_url  = excluded.template_url,
    api_key       = coalesce(nullif(p_api_key, ''), public.store_whatsapp.api_key),
    var_templates = excluded.var_templates,
    updated_at    = now();
end;
$function$;

create or replace function public.update_order_status(
  p_slug text, p_hashed_pin text, p_order_id uuid, p_status text)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
begin
  if public.verify_store_pin(p_slug, p_hashed_pin) then
    update public.orders set status = p_status
    where id = p_order_id and store_slug = p_slug;
  end if;
end;
$function$;

create or replace function public.set_order_paid(
  p_slug text, p_hashed_pin text, p_order_id uuid, p_paid boolean)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
begin
  if public.verify_store_pin(p_slug, p_hashed_pin) then
    update public.orders set paid = p_paid
    where id = p_order_id and store_slug = p_slug;
  end if;
end;
$function$;

create or replace function public.set_review_status(
  p_slug text, p_hashed_pin text, p_review_id uuid, p_status text)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
begin
  -- PIN first, as before, so every call costs an attempt and the status
  -- whitelist cannot be used to probe for free.
  if not public.verify_store_pin(p_slug, p_hashed_pin) then
    return;
  end if;

  -- `is null or` is new, and fixes a pre-existing bug rather than a new one:
  -- with p_status NULL, `NULL not in ('approved','hidden')` evaluates to NULL,
  -- the IF does not fire, and the original fell through to set status = NULL.
  if p_status is null or p_status not in ('approved', 'hidden') then
    return;
  end if;

  update public.reviews set status = p_status
  where id = p_review_id and store_slug = p_slug;
end;
$function$;

-- NOTE: this is still a hard DELETE with no tombstone. Retiring merchant
-- hard-delete belongs to the verified-review redesign, not here. This change
-- only stops an anonymous caller reaching it by guessing.
create or replace function public.delete_review(
  p_slug text, p_hashed_pin text, p_review_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
begin
  if not public.verify_store_pin(p_slug, p_hashed_pin) then
    return;
  end if;
  delete from public.reviews where id = p_review_id and store_slug = p_slug;
end;
$function$;


-- ═══════════════════════════════════════════════════════════════════════════
--  5. update_store_config — the check leaves the UPDATE's WHERE clause
-- ═══════════════════════════════════════════════════════════════════════════
-- It used to read `where s.slug = p_slug and s.pin = p_hashed_pin`, which made
-- the boolean return value a clean oracle: true on a correct PIN, false
-- otherwise, unlimited. The server-managed keys are preserved exactly as before.

create or replace function public.update_store_config(
  p_slug text, p_hashed_pin text, p_config jsonb)
returns boolean
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
declare n integer;
begin
  if not public.verify_store_pin(p_slug, p_hashed_pin) then
    return false;
  end if;

  update public.stores s
     set config = p_config || jsonb_build_object(
                    'plan',                   s.config->'plan',
                    'planExpiresAt',          s.config->'planExpiresAt',
                    'razorpaySubscriptionId', s.config->'razorpaySubscriptionId',
                    'ownerPhone',             s.config->'ownerPhone'
                  ),
         updated_at = now()
   where s.slug = p_slug;

  get diagnostics n = row_count;
  return n > 0;
end;
$function$;


-- ═══════════════════════════════════════════════════════════════════════════
--  6. reset_store_pin — throttle the OTP
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Tighter limits than the PIN path, deliberately: 900,000 codes is a bigger
-- space than 10,000 PINs, but a successful guess here does not merely READ the
-- store, it takes ownership of it and locks the merchant out. Five failures per
-- address and twenty per store in fifteen minutes leaves a fumbling seller
-- plenty of room and makes the search space unreachable.
--
-- Every refusal costs an attempt -- including a wrong WhatsApp number -- so the
-- number cannot be probed for free either.
--
-- Still outstanding, and NOT fixed here: the OTP is generated with
-- Math.random() (supabase/functions/send-otp/index.ts:48), which is not a
-- cryptographic RNG. That belongs with the send-otp function, not this file.

create or replace function public.reset_store_pin(
  p_slug text, p_whatsapp text, p_code text, p_new_hashed_pin text)
returns boolean
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
declare
  c_window     constant interval := interval '15 minutes';
  c_max_ip     constant integer  := 5;    -- per address, per store
  c_max_store  constant integer  := 20;   -- store-wide ceiling
  v_ip         text;
  v_fails_ip   integer := 0;
  v_fails_slug integer := 0;
  stored10     text;
  input10      text;
  otp_ok       boolean;
  n            integer;
begin
  begin
    v_ip := nullif(btrim(split_part(
      coalesce(current_setting('request.headers', true)::json ->> 'x-forwarded-for', ''),
      ',', 1)), '');
  exception when others then
    v_ip := null;
  end;

  select
    count(*) filter (where v_ip is not null and ip = v_ip),
    count(*)
  into v_fails_ip, v_fails_slug
  from public.pin_attempts
  where slug = p_slug
    and kind = 'otp'
    and not success
    and attempted_at > now() - c_window;

  if (v_ip is not null and v_fails_ip >= c_max_ip) or v_fails_slug >= c_max_store then
    insert into public.pin_attempts (slug, ip, success, kind)
    values (p_slug, v_ip, false, 'otp');
    return false;
  end if;

  select right(regexp_replace(coalesce(config->>'whatsappNumber', ''), '\D', '', 'g'), 10)
    into stored10
    from public.stores where slug = p_slug;

  input10 := right(regexp_replace(coalesce(p_whatsapp, ''), '\D', '', 'g'), 10);

  if stored10 is null or stored10 = '' or stored10 <> input10 then
    insert into public.pin_attempts (slug, ip, success, kind)
    values (p_slug, v_ip, false, 'otp');
    return false;
  end if;

  select exists (
    select 1 from public.otp_codes
    where right(regexp_replace(phone, '\D', '', 'g'), 10) = input10
      and code = p_code
      and expires_at > now()
  ) into otp_ok;

  if not otp_ok then
    insert into public.pin_attempts (slug, ip, success, kind)
    values (p_slug, v_ip, false, 'otp');
    return false;
  end if;

  delete from public.otp_codes
   where right(regexp_replace(phone, '\D', '', 'g'), 10) = input10;

  update public.stores set pin = p_new_hashed_pin, updated_at = now()
   where slug = p_slug;
  get diagnostics n = row_count;

  if n > 0 then
    delete from public.pin_attempts
     where slug = p_slug and kind = 'otp' and not success
       and attempted_at > now() - c_window;
  end if;

  return n > 0;
end;
$function$;

commit;

-- Grants are untouched: CREATE OR REPLACE preserves them, and every signature
-- above is byte-identical to the one it replaces. Nothing in the client changes.
--
-- Next: supabase/pin-bypass-closure-verify.sql (read-only, production-safe).
