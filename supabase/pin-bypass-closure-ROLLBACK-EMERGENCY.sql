-- ═══════════════════════════════════════════════════════════════════════════
--  EMERGENCY ROLLBACK — pin-bypass-closure-forward.sql
--
--  !! THIS RESTORES THE SECURITY HOLE. !!
--
--  Running this puts back the eleven functions that compare the PIN inline and
--  count nothing, and the reset_store_pin with an unlimited OTP. Anyone can
--  then guess any store's PIN again without limit, and take over a store via
--  the reset flow.
--
--  USE IT ONLY IF the forward migration broke the Manage dashboard for real
--  merchants — orders not loading, the new-order badge dead, settings not
--  saving — and a fix cannot be written quickly. Then re-apply the forward
--  migration, fixed, as soon as possible.
--
--  WHERE THESE BODIES CAME FROM: the live production definitions, dumped with
--  pg_get_functiondef during the audit on 2026-09-13, and for verify_store_pin
--  the body in supabase/pin-attempt-throttle.sql, which the audit confirmed was
--  byte-identical to production. Signatures are unchanged, so every CREATE OR
--  REPLACE below replaces — none creates an overload.
--
--  NOT REVERTED, deliberately: the pin_attempts.kind column and its CHECK
--  constraint. They are additive and harmless to the old functions — the old
--  verify_store_pin inserts without a kind, which defaults to 'pin'.
--
--  RUN: Supabase Dashboard → SQL Editor → paste all → Run. One transaction.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

create or replace function public.verify_store_pin(p_slug text, p_hashed_pin text)
returns boolean
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
declare
  c_window     constant interval := interval '15 minutes';
  c_max_ip     constant integer  := 10;
  c_max_store  constant integer  := 50;
  v_ip         text;
  v_fails_ip   integer := 0;
  v_fails_slug integer := 0;
  v_ok         boolean;
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
    and not success
    and attempted_at > now() - c_window;

  if (v_ip is not null and v_fails_ip >= c_max_ip) or v_fails_slug >= c_max_store then
    insert into public.pin_attempts (slug, ip, success) values (p_slug, v_ip, false);
    return false;
  end if;

  select exists (
    select 1 from public.stores
    where slug = p_slug and pin = p_hashed_pin
  ) into v_ok;

  insert into public.pin_attempts (slug, ip, success) values (p_slug, v_ip, v_ok);

  if v_ok then
    delete from public.pin_attempts
    where slug = p_slug and not success and attempted_at > now() - c_window;
  end if;

  if random() < 0.01 then
    delete from public.pin_attempts where attempted_at < now() - interval '2 days';
  end if;

  return v_ok;
end;
$function$;

create or replace function public.get_store_orders(p_slug text, p_hashed_pin text)
returns setof public.orders
language sql
security definer
set search_path to 'public'
as $function$
  select o.* from public.orders o
  where o.store_slug = p_slug
    and exists (select 1 from public.stores s where s.slug = p_slug and s.pin = p_hashed_pin)
  order by o.created_at desc limit 500;
$function$;

create or replace function public.get_store_reviews(p_slug text, p_hashed_pin text)
returns setof public.reviews
language sql
stable security definer
as $function$
  SELECT r.* FROM public.reviews r
  WHERE r.store_slug = p_slug
    AND EXISTS (SELECT 1 FROM public.stores s WHERE s.slug = p_slug AND s.pin = p_hashed_pin)
  ORDER BY r.created_at DESC;
$function$;

create or replace function public.get_store_ai_searches(p_slug text, p_hashed_pin text)
returns setof public.ai_searches
language sql
security definer
set search_path to 'public'
as $function$
  select *
  from public.ai_searches
  where store_slug = p_slug
    and exists (
      select 1 from public.stores s
      where s.slug = p_slug and s.pin = p_hashed_pin
    )
  order by created_at desc
  limit 3000;
$function$;

create or replace function public.new_orders_since(p_slug text, p_hashed_pin text, p_since timestamp with time zone)
returns table(new_count integer, latest_name text, latest_total numeric, latest_at timestamp with time zone)
language sql
stable security definer
set search_path to 'public'
as $function$
  select
    count(*)::int                                              as new_count,
    (array_agg(o.customer_name order by o.created_at desc))[1] as latest_name,
    (array_agg(o.total        order by o.created_at desc))[1]  as latest_total,
    max(o.created_at)                                          as latest_at
  from public.orders o
  where o.store_slug = p_slug
    and exists (select 1 from public.stores s where s.slug = p_slug and s.pin = p_hashed_pin)
    and o.status = 'new'
    and o.created_at > p_since
    and (
      coalesce(o.payment_method, '') <> 'online'
      or o.paid
      or o.payment_ref is not null
    );
$function$;

create or replace function public.get_store_whatsapp(p_slug text, p_hashed_pin text)
returns table(configured boolean, template_url text, api_key_masked text, var_templates jsonb)
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not exists (select 1 from public.stores s where s.slug = p_slug and s.pin = p_hashed_pin) then
    raise exception 'unauthorized';
  end if;

  return query
    select
      (w.template_url is not null and w.template_url <> '') as configured,
      coalesce(w.template_url, '') as template_url,
      case when w.api_key is null or w.api_key = '' then ''
           else repeat(chr(8226), 4) || right(w.api_key, 4) end as api_key_masked,  -- four bullets, ASCII-safe to paste
      coalesce(w.var_templates, '["{name}"]'::jsonb) as var_templates
    from public.store_whatsapp w
    where w.store_slug = p_slug;
end;
$function$;

create or replace function public.set_store_whatsapp(p_slug text, p_hashed_pin text, p_template_url text, p_api_key text, p_var_templates jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not exists (select 1 from public.stores s where s.slug = p_slug and s.pin = p_hashed_pin) then
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

create or replace function public.update_order_status(p_slug text, p_hashed_pin text, p_order_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if exists (select 1 from public.stores s where s.slug = p_slug and s.pin = p_hashed_pin) then
    update public.orders set status = p_status where id = p_order_id and store_slug = p_slug;
  end if;
end;
$function$;

create or replace function public.set_order_paid(p_slug text, p_hashed_pin text, p_order_id uuid, p_paid boolean)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if exists (select 1 from public.stores s where s.slug = p_slug and s.pin = p_hashed_pin) then
    update public.orders set paid = p_paid where id = p_order_id and store_slug = p_slug;
  end if;
end;
$function$;

create or replace function public.set_review_status(p_slug text, p_hashed_pin text, p_review_id uuid, p_status text)
returns void
language plpgsql
security definer
as $function$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.stores s WHERE s.slug = p_slug AND s.pin = p_hashed_pin) THEN
    RETURN;
  END IF;
  IF p_status NOT IN ('approved', 'hidden') THEN
    RETURN;
  END IF;
  UPDATE public.reviews SET status = p_status
  WHERE id = p_review_id AND store_slug = p_slug;
END;
$function$;

create or replace function public.delete_review(p_slug text, p_hashed_pin text, p_review_id uuid)
returns void
language plpgsql
security definer
as $function$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.stores s WHERE s.slug = p_slug AND s.pin = p_hashed_pin) THEN
    RETURN;
  END IF;
  DELETE FROM public.reviews WHERE id = p_review_id AND store_slug = p_slug;
END;
$function$;

create or replace function public.update_store_config(p_slug text, p_hashed_pin text, p_config jsonb)
returns boolean
language plpgsql
security definer
as $function$
DECLARE n INTEGER;
BEGIN
  UPDATE public.stores s
     SET config = p_config || jsonb_build_object(
                    'plan',                   s.config->'plan',
                    'planExpiresAt',          s.config->'planExpiresAt',
                    'razorpaySubscriptionId', s.config->'razorpaySubscriptionId',
                    'ownerPhone',             s.config->'ownerPhone'
                  ),
         updated_at = now()
   WHERE s.slug = p_slug AND s.pin = p_hashed_pin;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n > 0;
END;
$function$;

create or replace function public.reset_store_pin(p_slug text, p_whatsapp text, p_code text, p_new_hashed_pin text)
returns boolean
language plpgsql
security definer
as $function$
DECLARE
  stored10 TEXT;
  input10  TEXT;
  otp_ok   BOOLEAN;
  n        INTEGER;
BEGIN
  SELECT right(regexp_replace(coalesce(config->>'whatsappNumber',''), '\D', '', 'g'), 10)
    INTO stored10 FROM public.stores WHERE slug = p_slug;
  IF stored10 IS NULL OR stored10 = '' THEN RETURN false; END IF;

  input10 := right(regexp_replace(coalesce(p_whatsapp,''), '\D', '', 'g'), 10);
  IF stored10 <> input10 THEN RETURN false; END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.otp_codes
    WHERE right(regexp_replace(phone, '\D', '', 'g'), 10) = input10
      AND code = p_code
      AND expires_at > now()
  ) INTO otp_ok;
  IF NOT otp_ok THEN RETURN false; END IF;

  DELETE FROM public.otp_codes WHERE right(regexp_replace(phone, '\D', '', 'g'), 10) = input10;
  UPDATE public.stores SET pin = p_new_hashed_pin, updated_at = now() WHERE slug = p_slug;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n > 0;
END;
$function$;

commit;
