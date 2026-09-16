-- ===========================================================================
--  Security phase 3A  --  PREPARED, NOT APPLIED
-- ===========================================================================
--
--  Four narrow fixes to merchant authentication and the two tables the audit
--  found open. Nothing here touches the PIN format, the hashing scheme, the UI,
--  any RPC signature, order integrity, checkout, payments, shipping or ads.
--
--  1. verify_store_pin cannot be out-run in parallel
--
--     It counts recent failures and then, separately, records one. Requests
--     that arrive together all read the same count, all see room under the cap
--     and all proceed -- so the 10-per-address and 50-per-store limits bound a
--     serial attacker and nobody else. A 4-digit PIN is 10,000 candidates and
--     this throttle is the only thing standing in front of it, so "bounds a
--     serial attacker" is not enough.
--
--     Same remedy as otp_guard, which has been through review and is live:
--     transaction-scoped advisory locks on both budgets, taken in ascending key
--     order so two callers holding one lock each can never wait on the other.
--     Limits, recording rules, return values and the RPC signature are
--     unchanged -- only the parallel case changes.
--
--  2. reset_store_pin consumes its OTP atomically
--
--     It asked `select exists(...)` and then deleted, so two requests carrying
--     one valid code could both pass before either delete landed -- in the
--     account-recovery path, the one that SETS the PIN. It now goes through
--     public.otp_consume, the single-statement DELETE ... RETURNING that phase 2
--     introduced for send-otp, where the row lock picks exactly one winner.
--
--     Matching semantics: otp_consume compares the phone exactly, where this
--     function compared the last ten digits. Both the send and the reset paths
--     build the same string in the same place (ManageStore.jsx: `91` + the last
--     ten digits), and every otp_codes row in production carries twelve digits,
--     so the two agree. The verifier reports any row that does not, so a future
--     format drift is visible rather than silent.
--
--     Everything else about recovery is untouched: the 5-per-address and
--     20-per-store OTP budgets, the WhatsApp-number check, the expiry, the
--     clearing of failures on success, and the signature.
--
--  3. pending_signups stops being readable by anybody
--
--     Policies granted anon SELECT, INSERT, UPDATE and DELETE, each USING
--     (true). The SELECT is the leak: PostgREST will answer an unfiltered
--     select, so the whole table -- phone, plan and Razorpay subscription id --
--     could be dumped by anyone. That policy goes, along with the table grant.
--
--     Onboarding still has to find a paid signup by phone, so it gets a
--     function that answers for ONE phone. It still returns the subscription
--     id: publish writes that into the new store as razorpaySubscriptionId, and
--     withholding it would quietly unlink a recovered signup from its Razorpay
--     subscription -- breaking renewal for exactly the merchants this table
--     exists to protect. What is closed is the dump, which is where the value
--     was: an unfiltered read of every row.
--
--     INSERT, UPDATE and DELETE stay for now, because the live flow needs them:
--     Checkout writes the row after payment (and on the coupon path it is the
--     only writer -- no Razorpay webhook fires for a fully discounted plan), and
--     Onboarding deletes it once the store exists. Removing them would break
--     signup recovery, which this phase must not do.
--
--     KNOWN AND NOT CLOSED HERE: because anyone may still insert, anyone may
--     still write themselves a paid plan and claim it during onboarding. That
--     is a billing bypass, it is the most valuable thing left in this table, and
--     it cannot be closed without a verified merchant identity to write against.
--     It is the first item for the next phase.
--
--  4. console_audit -- the audit's finding was WRONG, and this corrects it
--
--     The audit reported a world-readable policy after reading only the role
--     list. The policy is `to public USING (public.is_crm_admin())`: the
--     predicate filters, so an anonymous reader gets no rows. Nothing to close,
--     and the policy is deliberately left exactly as it is rather than narrowed,
--     which would risk staff access for no gain.
--
--     What IS worth removing is the unused destructive grant: anon and
--     authenticated hold TRUNCATE, which ignores row level security. It is not
--     reachable through PostgREST and nothing uses it.
--
--  RUN: Supabase Dashboard -> SQL Editor -> paste -> Run. Idempotent.
--  VERIFY: supabase/security-phase-3a-verify.sql (read-only, before and after)
--  UNDO:   supabase/security-phase-3a-ROLLBACK.sql
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. The PIN throttle, now safe in parallel
-- ---------------------------------------------------------------------------
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
  c_lock_ns    constant integer  := 774412;  -- this throttle's lock space
  v_ip         text;
  v_fails_ip   integer := 0;
  v_fails_slug integer := 0;
  v_ok         boolean;
  v_k_slug     integer;
  v_k_ip       integer;
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

  -- Serialize the decision. Counting failures and then recording one is a
  -- check-then-act: without this, guesses that arrive together all read the
  -- same count, all find room under the cap, and the limit bounds nothing but a
  -- patient attacker. Both budgets are locked -- one address can hit many
  -- stores and one store is hit from many addresses -- and the keys are always
  -- taken in ascending order, so two callers cannot wait on each other.
  -- Transaction-scoped: released on commit, never leaked by a pooled connection.
  v_k_slug := pg_catalog.hashtext('pin:slug:' || p_slug);
  v_k_ip   := case when v_ip is null then null
                   else pg_catalog.hashtext('pin:ip:' || p_slug || ':' || v_ip) end;
  if v_k_ip is null or v_k_ip = v_k_slug then
    perform pg_catalog.pg_advisory_xact_lock(c_lock_ns, v_k_slug);
  else
    perform pg_catalog.pg_advisory_xact_lock(c_lock_ns, least(v_k_slug, v_k_ip));
    perform pg_catalog.pg_advisory_xact_lock(c_lock_ns, greatest(v_k_slug, v_k_ip));
  end if;

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
  -- A correct PIN does NOT clear earlier failures either -- that clear would
  -- reset an attacker's count four times a minute while the real seller has
  -- Manage open. Failures age out of the 15-minute window on their own.
  if not v_ok then
    insert into public.pin_attempts (slug, ip, success, kind)
    values (p_slug, v_ip, false, 'pin');
  end if;

  -- Opportunistic pruning -- roughly one call in a hundred pays for it, so the
  -- ledger cannot grow without bound and no scheduled job is needed.
  if random() < 0.01 then
    delete from public.pin_attempts where attempted_at < now() - interval '2 days';
  end if;

  return v_ok;
end;
$function$;


-- ---------------------------------------------------------------------------
-- 2. Recovery: the OTP is spent exactly once
-- ---------------------------------------------------------------------------
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
  c_lock_ns    constant integer  := 774413;  -- this throttle's lock space
  v_ip         text;
  v_fails_ip   integer := 0;
  v_fails_slug integer := 0;
  stored10     text;
  input10      text;
  n            integer;
  v_k_slug     integer;
  v_k_ip       integer;
begin
  begin
    v_ip := nullif(btrim(split_part(
      coalesce(current_setting('request.headers', true)::json ->> 'x-forwarded-for', ''),
      ',', 1)), '');
  exception when others then
    v_ip := null;
  end;

  -- The same check-then-act as the PIN throttle, and the same remedy.
  v_k_slug := pg_catalog.hashtext('otpreset:slug:' || p_slug);
  v_k_ip   := case when v_ip is null then null
                   else pg_catalog.hashtext('otpreset:ip:' || p_slug || ':' || v_ip) end;
  if v_k_ip is null or v_k_ip = v_k_slug then
    perform pg_catalog.pg_advisory_xact_lock(c_lock_ns, v_k_slug);
  else
    perform pg_catalog.pg_advisory_xact_lock(c_lock_ns, least(v_k_slug, v_k_ip));
    perform pg_catalog.pg_advisory_xact_lock(c_lock_ns, greatest(v_k_slug, v_k_ip));
  end if;

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

  -- The number on the storefront must be the number asking. Unchanged.
  select right(regexp_replace(coalesce(config->>'whatsappNumber', ''), '\D', '', 'g'), 10)
    into stored10
    from public.stores where slug = p_slug;

  input10 := right(regexp_replace(coalesce(p_whatsapp, ''), '\D', '', 'g'), 10);

  if stored10 is null or stored10 = '' or stored10 <> input10 then
    insert into public.pin_attempts (slug, ip, success, kind)
    values (p_slug, v_ip, false, 'otp');
    return false;
  end if;

  -- The code is checked and spent in one statement, inside otp_consume: the row
  -- lock there means exactly one caller can ever be told yes, so a code cannot
  -- be replayed into a second PIN reset. It also checks the expiry and burns
  -- every remaining code for that number, which is what this function used to
  -- do for itself, non-atomically.
  if not public.otp_consume(p_whatsapp, p_code) then
    insert into public.pin_attempts (slug, ip, success, kind)
    values (p_slug, v_ip, false, 'otp');
    return false;
  end if;

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


-- ---------------------------------------------------------------------------
-- 3. pending_signups: nobody may read the table
-- ---------------------------------------------------------------------------
-- The whole table could be fetched by anyone: phone, plan and the Razorpay
-- subscription id. The read goes behind a function that answers for one phone.
drop policy if exists "pending select" on public.pending_signups;
revoke select on public.pending_signups from anon, authenticated;

-- One phone, one answer. This closes the real exposure -- PostgREST would
-- answer an unfiltered select and hand over every row -- without changing what
-- onboarding can do.
--
-- subscription_id IS returned, deliberately. Onboarding writes it into the new
-- store as razorpaySubscriptionId, which is how a recovered signup stays linked
-- to its Razorpay subscription for renewal and cancellation. Withholding it
-- would silently break that link for exactly the merchants this table exists to
-- protect: the ones who paid, left, and came back on another device.
create or replace function public.get_pending_signup(p_phone text)
returns table (plan text, plan_expires_at timestamptz, subscription_id text)
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  select s.plan, s.plan_expires_at, s.subscription_id
    from public.pending_signups s
   where s.phone = right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 10)
     and coalesce(btrim(p_phone), '') <> ''
   limit 1;
$function$;

revoke all on function public.get_pending_signup(text) from public;
grant execute on function public.get_pending_signup(text) to anon, authenticated, service_role;

-- INSERT, UPDATE and DELETE policies are deliberately left in place: Checkout
-- writes the row after payment (and is the only writer on the coupon path) and
-- Onboarding clears it once the store exists. See the header for the billing
-- bypass this leaves open and why it needs merchant identity to close.


-- ---------------------------------------------------------------------------
-- 4. console_audit: remove the destructive grant nothing uses
-- ---------------------------------------------------------------------------
-- The read policy is `to public USING (public.is_crm_admin())` and is LEFT
-- ALONE: the predicate already refuses everyone who is not a console admin.
-- TRUNCATE, though, ignores row level security. Nothing in the app uses it.
revoke truncate, delete, insert, update on public.console_audit from anon, authenticated;

commit;

-- Next: supabase/security-phase-3a-verify.sql (read-only, production-safe).
