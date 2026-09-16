-- ===========================================================================
--  Security hardening, phase 1  --  PREPARED, NOT APPLIED
-- ===========================================================================
--
--  Three independent changes, one transaction. Additive: no column is dropped,
--  no function signature changes, no client code has to change with it.
--
--  1. OTP rate limiting (otp_guard)
--     The OTP endpoint accepts any phone number and any number of guesses at a
--     six-digit code. This adds one ledger-backed guard the edge function calls
--     before it acts. It reuses public.pin_attempts -- the table the PIN
--     throttle already writes to -- with two new `kind` values, so there is one
--     attempt ledger on this database, not two.
--
--     OTP rows are keyed by phone, not by store, so they carry:
--       subject = a SHA-256 hex of the phone digits, computed in the edge
--                 function, so no new place stores raw phone numbers
--       slug    = '' (the column is NOT NULL and there is no store here)
--
--  2. An order INSERT may not claim payment (orders_insert_guard)
--     An order row is written from the customer's device, so nothing it says
--     about payment is evidence of payment. This forces the payment columns to
--     their unpaid values on every INSERT, whatever role does it, and clamps
--     `status` to the two values a checkout legitimately writes.
--
--     Payment is recorded by UPDATE, after Razorpay has been asked -- that is
--     what payments-verify, the razorpay webhook and the reconcile tools do,
--     and none of them are touched. No existing INSERT path sets these columns
--     except the client one this closes.
--
--  3. anon and authenticated lose DELETE and TRUNCATE on stores and orders
--     Nothing uses them. RLS already blocks DELETE (no policy allows it) but
--     TRUNCATE is not subject to RLS, so the grant is worth removing.
--
--  BEFORE YOU APPLY -- what breaks if you skip the secrets:
--     supabase/functions/send-otp/index.ts in this same branch stops falling
--     back to the WhatsApp template URLs that were hardcoded in a public
--     repository. Set SENIQIFY_TEMPLATE_URL, SENIQIFY_WELCOME_TEMPLATE_URL and
--     SENIQIFY_ORDER_CONFIRM_TEMPLATE_URL as Supabase secrets BEFORE deploying
--     that function, or OTP, welcome and order-confirm sends fail closed.
--     Full order of operations: docs/security-phase-1-runbook.md
--
--  RUN: Supabase Dashboard -> SQL Editor -> paste -> Run. Idempotent.
--  VERIFY: supabase/security-phase-1-verify.sql (read-only)
--  UNDO:   supabase/security-phase-1-ROLLBACK.sql (re-opens what this closes)
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. OTP rate limiting
-- ---------------------------------------------------------------------------

-- Keyed by phone hash rather than store slug. Nullable, so existing rows and
-- every PIN write are unaffected.
alter table public.pin_attempts
  add column if not exists subject text;

comment on column public.pin_attempts.subject is
  'For otp_send / otp_verify rows: SHA-256 hex of the phone digits, hashed in '
  'the edge function. NULL for pin and otp rows, which are keyed by slug.';

alter table public.pin_attempts
  drop constraint if exists pin_attempts_kind_known;
alter table public.pin_attempts
  add constraint pin_attempts_kind_known
  check (kind in ('pin', 'otp', 'otp_send', 'otp_verify'));

comment on column public.pin_attempts.kind is
  'pin = store PIN attempt (verify_store_pin). otp = PIN-reset OTP attempt '
  '(reset_store_pin). otp_send = an OTP was dispatched. otp_verify = a failed '
  'OTP guess. Separate budgets: flooding one must not lock another, because '
  'the reset flow is the way back in for a merchant locked out of the PIN.';

create index if not exists pin_attempts_kind_subject_time_idx
  on public.pin_attempts (kind, subject, attempted_at desc);

-- Actions, all called with the service role from supabase/functions/send-otp:
--   send    may a code go out now?   Records the send when it may.
--   verify  may a guess be made now?  Records the guess when it may.
--   clear   the code was right: drop that phone's guesses. Always true.
--
-- send and verify decide and record inside one locked transaction, so requests
-- that arrive together cannot overshoot a limit between them.
--
-- Limits. A real person asks for at most two or three codes; these caps stop a
-- flood of WhatsApp messages (which cost money and burn the sender's standing)
-- and stop a six-digit code being guessed inside its ten-minute life.
create or replace function public.otp_guard(
  p_action text, p_subject text, p_ip text default null)
returns boolean
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
declare
  c_send_subject_short constant integer  := 3;   -- per phone, per 15 minutes
  c_send_subject_day   constant integer  := 10;  -- per phone, per 24 hours
  c_send_ip_hour       constant integer  := 15;  -- per address, per hour
  c_fail_subject       constant integer  := 5;   -- wrong guesses, per 15 minutes
  c_fail_ip            constant integer  := 30;  -- wrong guesses, per hour
  c_short              constant interval := interval '15 minutes';
  c_hour               constant interval := interval '1 hour';
  c_day                constant interval := interval '24 hours';
  c_lock_ns            constant integer  := 774411;  -- this guard's lock space
  v_subject text := nullif(btrim(coalesce(p_subject, '')), '');
  v_ip      text := nullif(btrim(coalesce(p_ip, '')), '');
  v_n_short integer := 0;
  v_n_day   integer := 0;
  v_n_ip    integer := 0;
  v_k_sub   integer;
  v_k_ip    integer;
begin
  -- No subject means the caller could not identify the phone. Refuse rather
  -- than let an unkeyed request through the limit.
  if v_subject is null then
    return false;
  end if;

  -- Serialize the deciding actions. Counting rows and then writing one is a
  -- check-then-act: without this, requests that arrive together all read a
  -- count below the limit and all proceed, and the cap means nothing against
  -- exactly the parallel flood it exists to stop.
  --
  -- Transaction-scoped advisory locks, released on commit. Both budgets are
  -- locked -- a subject can arrive from many addresses and an address can carry
  -- many subjects -- and they are always taken in ascending key order, so two
  -- callers holding one lock each can never wait on the other's.
  if p_action in ('send', 'verify') then
    v_k_sub := pg_catalog.hashtext('otp:subject:' || v_subject);
    v_k_ip  := case when v_ip is null then null
                    else pg_catalog.hashtext('otp:ip:' || v_ip) end;
    if v_k_ip is null or v_k_ip = v_k_sub then
      perform pg_catalog.pg_advisory_xact_lock(c_lock_ns, v_k_sub);
    else
      perform pg_catalog.pg_advisory_xact_lock(c_lock_ns, least(v_k_sub, v_k_ip));
      perform pg_catalog.pg_advisory_xact_lock(c_lock_ns, greatest(v_k_sub, v_k_ip));
    end if;
  end if;

  if p_action = 'send' then
    select
      count(*) filter (where attempted_at > now() - c_short and subject = v_subject),
      count(*) filter (where subject = v_subject),
      count(*) filter (where attempted_at > now() - c_hour and v_ip is not null and ip = v_ip)
    into v_n_short, v_n_day, v_n_ip
    from public.pin_attempts
    where kind = 'otp_send'
      and attempted_at > now() - c_day;

    if v_n_short >= c_send_subject_short
       or v_n_day >= c_send_subject_day
       or (v_ip is not null and v_n_ip >= c_send_ip_hour) then
      return false;
    end if;

    -- Recorded only when the send is allowed, so a refused caller cannot push
    -- their own window further out.
    insert into public.pin_attempts (slug, ip, success, kind, subject)
    values ('', v_ip, true, 'otp_send', v_subject);

    -- Opportunistic pruning, as verify_store_pin does: about one call in a
    -- hundred pays for it, so the ledger cannot grow without bound.
    if random() < 0.01 then
      delete from public.pin_attempts where attempted_at < now() - interval '2 days';
    end if;

    return true;
  end if;

  -- A guess is counted when it is ALLOWED, not after it turns out wrong. The
  -- caller cannot record the failure for us: between its check and its report
  -- any number of other guesses would pass, and the limit would count one guess
  -- per round trip instead of five in total. So the row goes in here, inside
  -- the same locked transaction that decided, and a correct code removes it
  -- again through 'clear'.
  if p_action = 'verify' then
    select
      count(*) filter (where subject = v_subject and attempted_at > now() - c_short),
      count(*) filter (where v_ip is not null and ip = v_ip)
    into v_n_short, v_n_ip
    from public.pin_attempts
    where kind = 'otp_verify'
      and not success
      and attempted_at > now() - c_hour;

    if v_n_short >= c_fail_subject
       or (v_ip is not null and v_n_ip >= c_fail_ip) then
      return false;
    end if;

    insert into public.pin_attempts (slug, ip, success, kind, subject)
    values ('', v_ip, false, 'otp_verify', v_subject);

    return true;
  end if;

  if p_action = 'clear' then
    delete from public.pin_attempts
     where kind = 'otp_verify' and not success and subject = v_subject;
    return true;
  end if;

  -- Unknown action: refuse. A typo must not read as permission.
  return false;
end;
$function$;

-- Only the service role may call it. If the browser could, it could clear its
-- own failures and the limit would count nothing.
revoke all on function public.otp_guard(text, text, text) from public;
revoke all on function public.otp_guard(text, text, text) from anon, authenticated;
grant execute on function public.otp_guard(text, text, text) to service_role;


-- ---------------------------------------------------------------------------
-- 2. An order INSERT may not claim payment
-- ---------------------------------------------------------------------------
-- Runs for every role, not only anon: the order-notify safety net writes a
-- client-supplied object with the service role, so a role test here would leave
-- the widest path in unguarded. Payment is set by UPDATE after verification.
--
-- The name matters: BEFORE triggers fire in name order, and this one has to
-- run before orders_payment_automation reads the row.
create or replace function public.orders_insert_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  NEW.paid             := false;
  NEW.paid_at          := null;
  NEW.paid_via         := null;
  NEW.payment_ref      := null;
  NEW.payment_provider := null;

  -- payment_method is the customer's CHOICE (cod / online / upi), not evidence
  -- that money moved, so it is left as sent.

  -- A checkout writes exactly two statuses. Anything else -- 'delivered',
  -- 'confirmed', a value that skips the seller entirely -- becomes 'new'.
  if NEW.status is null or NEW.status not in ('new', 'abandoned') then
    NEW.status := 'new';
  end if;

  return NEW;
end;
$function$;

drop trigger if exists orders_insert_guard on public.orders;
create trigger orders_insert_guard
  before insert on public.orders
  for each row execute function public.orders_insert_guard();


-- ---------------------------------------------------------------------------
-- 3. Remove unused destructive grants
-- ---------------------------------------------------------------------------
-- RLS already blocks anon DELETE (no policy allows it) and PostgREST exposes no
-- TRUNCATE verb -- but TRUNCATE ignores RLS, so the grant should not exist.
-- Nothing in the app deletes a store or an order from the browser.
revoke delete, truncate on public.stores from anon, authenticated;
revoke delete, truncate on public.orders from anon, authenticated;

commit;

-- Next: supabase/security-phase-1-verify.sql (read-only, production-safe).
