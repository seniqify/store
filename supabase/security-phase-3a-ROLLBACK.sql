-- ===========================================================================
--  Security phase 3A  --  UNDO
--
--  This REOPENS what the forward file closed. It exists for "merchants cannot
--  sign in / cannot recover their PIN / cannot finish signup right now", not
--  for tidying up.
--
--  What comes back if you run it:
--    * the PIN throttle can be out-run by parallel guesses again
--    * a recovery OTP can be spent more than once again
--
--  What does NOT come back, deliberately:
--    * TRUNCATE/INSERT/UPDATE/DELETE on console_audit for anon and
--      authenticated. Nothing uses them; re-granting is a decision, not an undo.
--      The statement is written out at the end, commented, if you truly need it.
--
--  pending_signups is not mentioned here because this phase never touched it.
--
--  RUN: Supabase Dashboard -> SQL Editor -> paste -> Run. Idempotent.
--  VERIFY: supabase/security-phase-3a-verify.sql
--          (V1.1, V2.1 and V2.4 read FAIL afterwards, which is the point;
--           V3.1, V3.2, V4.1 and V4.2 must still read PASS.)
-- ===========================================================================

begin;

-- 1. The PIN throttle, back to the version that counts and then records.
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
    and kind = 'pin'
    and not success
    and attempted_at > now() - c_window;

  if (v_ip is not null and v_fails_ip >= c_max_ip) or v_fails_slug >= c_max_store then
    insert into public.pin_attempts (slug, ip, success, kind)
    values (p_slug, v_ip, false, 'pin');
    return false;
  end if;

  select exists (
    select 1 from public.stores
    where slug = p_slug and pin = p_hashed_pin
  ) into v_ok;

  if not v_ok then
    insert into public.pin_attempts (slug, ip, success, kind)
    values (p_slug, v_ip, false, 'pin');
  end if;

  if random() < 0.01 then
    delete from public.pin_attempts where attempted_at < now() - interval '2 days';
  end if;

  return v_ok;
end;
$function$;

-- 2. Recovery, back to checking and deleting the OTP separately.
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
  c_max_ip     constant integer  := 5;
  c_max_store  constant integer  := 20;
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

-- 3. console_audit grants stay revoked. If you have a real need, run this by
--    hand and write down why:
--
--    grant insert, update, delete, truncate on public.console_audit to anon, authenticated;
--
--  (Commented on purpose: no paste of this file should restore them by accident.)
