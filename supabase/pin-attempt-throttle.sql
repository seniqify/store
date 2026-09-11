-- ═══════════════════════════════════════════════════════════════════════════
--  Throttle PIN attempts  —  PREPARED FOR REVIEW, NOT APPLIED
-- ═══════════════════════════════════════════════════════════════════════════
--
--  THE PROBLEM
--
--  verify_store_pin currently is, in full:
--
--    LANGUAGE sql STABLE SECURITY DEFINER
--    SELECT EXISTS (SELECT 1 FROM public.stores
--                   WHERE slug = p_slug AND pin = p_hashed_pin);
--
--  A PocketLink PIN is four digits — 10,000 possibilities — and this RPC is
--  callable by anon with no attempt limit of any kind. Ten thousand HTTPS
--  requests is minutes of work. Whoever wins gets the seller's whole dashboard:
--  orders with customer names and addresses, the customer list, settings, the
--  Meta connection.
--
--  This is PRE-EXISTING and applies to every store today. It is not introduced
--  by putting campaign creation behind the PIN — but that change is a good
--  reason to stop tolerating it.
--
--  Note the function must change from `sql STABLE` to `plpgsql VOLATILE`: a
--  STABLE function cannot write, so it cannot record an attempt. The signature
--  and return type are unchanged, so CREATE OR REPLACE keeps existing grants
--  and every caller keeps working. PostgREST routes VOLATILE functions to POST,
--  which is what both callers already use (supabase.rpc() and api/meta/_meta.js).
--
--  TWO THRESHOLDS, DELIBERATELY
--
--  Per IP+store  — 10 failures / 15 min. Stops the ordinary guesser.
--  Per store     — 50 failures / 15 min. Stops a distributed attempt from many
--                  addresses, which the per-IP limit alone would miss.
--
--  The per-IP limit is the tighter one on purpose: locking on IP means an
--  attacker cannot cheaply lock a real merchant out of their own shop, which a
--  store-only limit would allow. The store-wide ceiling is set high enough that
--  a genuine seller fumbling their PIN never reaches it.
--
--  A successful entry clears that store's recent failures, so a seller who
--  mistypes a few times and then gets it right starts clean.
--
--  RUN: Supabase Dashboard → SQL Editor → paste → Run. Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════


-- ── Attempt ledger ──────────────────────────────────────────────────────────
create table if not exists public.pin_attempts (
  id           bigserial   primary key,
  slug         text        not null,
  ip           text,
  success      boolean     not null,
  attempted_at timestamptz not null default now()
);

comment on table public.pin_attempts is
  'Rate-limit ledger for verify_store_pin. Written only by that SECURITY '
  'DEFINER function; no client can read or write it.';

create index if not exists pin_attempts_slug_time_idx
  on public.pin_attempts (slug, attempted_at desc);
create index if not exists pin_attempts_ip_time_idx
  on public.pin_attempts (slug, ip, attempted_at desc);

-- RLS on with NO policies: the table is unreachable by anon/authenticated. The
-- function reaches it as the owner because it is SECURITY DEFINER. The REVOKEs
-- hold even if RLS were later switched off by mistake.
alter table public.pin_attempts enable row level security;
revoke all on public.pin_attempts from anon, authenticated;
revoke all on sequence public.pin_attempts_id_seq from anon, authenticated;


-- ── The throttled verifier ──────────────────────────────────────────────────
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
    and not success
    and attempted_at > now() - c_window;

  -- Locked out: record the attempt (so the window keeps sliding for a
  -- persistent attacker) and refuse WITHOUT touching the stored PIN.
  if (v_ip is not null and v_fails_ip >= c_max_ip) or v_fails_slug >= c_max_store then
    insert into public.pin_attempts (slug, ip, success) values (p_slug, v_ip, false);
    return false;
  end if;

  select exists (
    select 1 from public.stores
    where slug = p_slug and pin = p_hashed_pin
  ) into v_ok;

  insert into public.pin_attempts (slug, ip, success) values (p_slug, v_ip, v_ok);

  -- A correct PIN clears the slate for that store, so an honest seller who
  -- fumbled a few times is not left near a limit.
  if v_ok then
    delete from public.pin_attempts
    where slug = p_slug and not success and attempted_at > now() - c_window;
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
--  VERIFICATION — run after applying. One result set; every row must read PASS.
-- ═══════════════════════════════════════════════════════════════════════════
-- select n, check_name, result from (
--
--   select 1 as n, 'T1  correct PIN still works' as check_name,
--     case when public.verify_store_pin('showme', encode(digest('snq1_2580','sha256'),'hex'))
--          then 'PASS - verified'
--          else 'FAIL - correct PIN rejected (pgcrypto absent? compute the hash in the app instead)' end::text as result
--
--   union all select 2, 'T2  wrong PIN is rejected',
--     case when public.verify_store_pin('showme', 'deadbeef') then 'FAIL - wrong PIN accepted'
--          else 'PASS - rejected' end
--
--   union all select 3, 'T3  attempts are being recorded',
--     case when (select count(*) from public.pin_attempts where slug='showme') > 0
--          then 'PASS - ledger is writing' else 'FAIL - nothing recorded' end
--
--   union all select 4, 'T4  the ledger is unreachable by clients',
--     case when exists (select 1 from pg_policies
--                       where schemaname='public' and tablename='pin_attempts')
--          then 'CHECK - a policy exists; it was meant to have none'
--          else 'PASS - RLS on, no policy, no client access' end
--
--   union all select 5, 'T5  the function can now write',
--     case when (select provolatile from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--                where n.nspname='public' and p.proname='verify_store_pin') = 'v'
--          then 'PASS - VOLATILE' else 'FAIL - still STABLE, cannot throttle' end
--
-- ) checks order by n;


-- ── Rolling back ────────────────────────────────────────────────────────────
-- create or replace function public.verify_store_pin(p_slug text, p_hashed_pin text)
-- returns boolean language sql stable security definer as $function$
--   SELECT EXISTS (SELECT 1 FROM public.stores WHERE slug = p_slug AND pin = p_hashed_pin);
-- $function$;
