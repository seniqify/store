-- ===========================================================================
--  Custom merchant domains -- PR-B: DATABASE FOUNDATION
--  PREPARED FOR REVIEW. NOT APPLIED.
--
--  WHAT THIS ADDS
--   public.store_domains             one row per hostname a store claims.
--                                    An apex claim is a GROUP of two rows
--                                    (brand.com + www.brand.com); a subdomain
--                                    claim is a group of one.
--   public.store_domain_challenges   purpose-bound step-up codes (activate,
--                                    set_primary, disconnect). Hash only.
--   public.store_domain_events       append-only audit trail.
--   2 public read RPCs               resolve_store_host, store_primary_host
--   13 server-only RPCs              domain_* (service_role only)
--   6 internal helpers + 3 triggers  callable by nobody but their owner
--
--  WHAT THIS DOES NOT DO
--   NOTHING CALLS ANY OF THIS YET. No Vercel API, no middleware, no hostname
--   routing, no merchant UI, no OTP sending -- those are PR-C / PR-D / PR-E.
--   No existing table, column, function, grant, policy or row is changed.
--   The only effect on an existing object is the internal FK trigger that any
--   REFERENCES public.stores(slug) adds (plan_entitlements did the same): a
--   store that has domain rows cannot be deleted or have its slug changed.
--   Nothing in the product does either (checked when plan_entitlements
--   shipped). pocketlink.store serving is untouched.
--
--  THE RULES THE DATABASE ENFORCES (not the application)
--   1. A PENDING claim reserves nothing. Any number of stores may hold a
--      pending claim on the same hostname.
--   2. Exclusivity starts at ownership proof. One partial unique index on
--      hostname covers every status from 'verified' on:
--        verified, ready, connected, misconfigured, disconnecting
--      so a hostname can belong to at most ONE such group. The first group to
--      prove ownership wins; see domain_mark_verified.
--   3. One OPEN group per store in v1 (pending included; see "deviation" in
--      the PR description). One partial unique index on store_slug.
--   4. A group is exactly {subdomain} or {apex, www.apex}, with exactly one
--      primary, and its rows agree on store, status, token and lifecycle
--      timestamps. Enforced by a DEFERRED constraint trigger -- see section 3
--      for why deferred.
--   5. Statuses only move along the lifecycle below, and an ended row is
--      frozen. Enforced by a BEFORE UPDATE trigger.
--   6. Vercel is never recorded as holding a name before its TXT proof:
--      a pending row's vercel_state is always 'none'.
--   7. A HOSTNAME IS NEVER FREED WHILE VERCEL MAY STILL HOLD IT. A group can
--      only reach 'expired' or 'disconnected' when every row's vercel_state
--      is 'none' or 'removed' (CHECK), and 'removed' must have settled for
--      2 minutes (see store_domain_vercel_clear). Until then the group sits in
--      'disconnecting' -- still inside the ownership index -- whatever the
--      cause: a merchant, an admin, or a TTL. A Vercel DELETE can only be
--      authorised ('removing') for a group in 'disconnecting', i.e. while that
--      group still owns the name exclusively; an ended group is frozen and
--      can record nothing. So an old group's cleanup can never be authorised
--      once another group could own the name.
--   8. 'ready' MEANS SERVABLE. The server reports Vercel's raw facts
--      (attached to this project / verified / misconfigured) and the database
--      derives vercel_state; only 'configured' -- attached AND verified AND
--      not misconfigured -- passes. A CHECK makes a 'ready' group with any
--      other row state impossible, and a regression demotes it to 'verified'.
--   9. No plaintext OTP is ever stored. code_hash must be 64 hex characters
--      (an HMAC-SHA256 the server computes with a secret the database never
--      sees); a 6-digit code cannot be written into it.
--
--  LIFECYCLE                                   TTL (expires_at)
--    pending --> verified --> ready --> connected <--> misconfigured
--      |            |           |          |                |
--      |            +-----------+----------+-> disconnecting +--> disconnected
--      |            (TTL, Vercel holds a name) -> disconnecting --> expired
--      +--> disconnected (cancel) / expired (TTL; never on Vercel)
--    pending                                   72 hours from claim
--    verified / ready                          7 days from verification
--    misconfigured                             30 days, then auto-release
--    connected / disconnecting                 none
--    expired / disconnected                    terminal; hostname reclaimable
--    OTP challenge                             10 minutes, 5 attempts
--
--  TXT AT ACTIVATION. The record need not stay published once connected, but
--  domain_activate requires the token the server has JUST read from DNS
--  (p_proved_token), exactly as verification does: PR-C must re-check TXT
--  immediately before activating, and a stale or missing proof is refused
--  without spending the merchant's code.
--
--   No partial-index predicate mentions now(). TTLs are expires_at values
--   compared in functions, never in an index.
--
--  ORDER OF OPERATIONS
--   1. supabase/custom-domains-verify.sql (read-only) -- save the output.
--   2. Apply this file.  3. The verifier again: every row PASS.
--   Nothing is deployed with this PR.
--
--  RUN: Supabase Dashboard -> SQL Editor -> paste all -> Run. One transaction.
--  Re-running is safe: tables/indexes are created if absent, triggers only if
--  missing, functions are create or replace, grants are re-asserted.
--  UNDO: supabase/custom-domains-ROLLBACK.sql
--
--  READ BEFORE CHANGING ANY GRANT BELOW: this project's default privileges
--  give anon and authenticated EVERY privilege (TRUNCATE included) on each new
--  table, and EXECUTE on each new function (PUBLIC gets EXECUTE on functions
--  by default as well). Every REVOKE here is load-bearing and runs in the same
--  transaction as the CREATE, so nothing is ever briefly open.
-- ===========================================================================

begin;

-- Fail fast instead of queueing behind a long transaction: the FK below takes
-- a brief SHARE ROW EXCLUSIVE lock on public.stores.
set local lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 0. Preflight -- refuse to overwrite anything that is not ours
-- ---------------------------------------------------------------------------
do $preflight$
declare
  v_clash text;
begin
  if to_regclass('public.stores') is null then
    raise exception 'refusing to run: public.stores does not exist';
  end if;

  -- On a first run none of these names may exist yet. A re-run (our tables
  -- already present) replaces our own functions, which is intended.
  if to_regclass('public.store_domains') is null then
    if to_regclass('public.store_domain_challenges') is not null
       or to_regclass('public.store_domain_events') is not null then
      raise exception 'refusing to run: a store_domain_* table exists without store_domains';
    end if;
    select string_agg(p.proname, ', ' order by p.proname) into v_clash
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in (
         'store_domain_normalize', 'store_domain_hostname_problem',
         'store_domain_log', 'store_domain_expire_if_stale',
         'store_domain_consume_challenge', 'store_domain_vercel_clear',
         'store_domains_guard_update',
         'store_domains_check_group', 'store_domain_events_append_only',
         'resolve_store_host', 'store_primary_host',
         'domain_claim', 'domain_mark_verified', 'domain_vercel_intent',
         'domain_vercel_observe',
         'domain_mark_ready', 'domain_challenge_create', 'domain_activate',
         'domain_set_primary', 'domain_begin_disconnect',
         'domain_finish_disconnect', 'domain_expire_stale',
         'domain_health_update', 'domain_event_append');
    if v_clash is not null then
      raise exception 'refusing to run: public already has function(s) named %', v_clash;
    end if;
  end if;
end
$preflight$;

-- ---------------------------------------------------------------------------
-- 1. Hostname helpers (internal; used by the CHECK below and by the RPCs)
-- ---------------------------------------------------------------------------
-- Storage form: lowercase ASCII, no trailing dot, no port. IDN names arrive
-- already converted to punycode (xn--) by the server; anything non-ASCII is
-- rejected rather than guessed at.
create or replace function public.store_domain_normalize(p_host text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $fn$
  select nullif(regexp_replace(lower(btrim(coalesce(p_host, ''))), '\.$', ''), '')
$fn$;

-- NULL when the hostname may be stored; otherwise why not. Single source for
-- both the table CHECK and the claim RPC's outcome, so they cannot disagree.
--   * LDH labels of 1-63 characters, no leading/trailing hyphen, at least two
--     labels, a final label that starts with a letter (so no IP literals),
--     253 characters overall.
--   * Never PocketLink's own names, the team's other domains, or platform
--     domains, at any depth.
create or replace function public.store_domain_hostname_problem(p_host text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $fn$
  select case
    when p_host is null or p_host = '' or char_length(p_host) > 253
      then 'invalid_hostname'
    when p_host !~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]([a-z0-9-]{0,61}[a-z0-9])$'
      then 'invalid_hostname'
    when p_host ~ '(^|\.)(pocketlink\.store|poketlink\.app|ordify\.store|seniqify\.store|seniqify\.com|towell\.in|figurot\.com|vercel\.app|vercel\.com|vercel\.sh|vercel-dns\.com|now\.sh|supabase\.co|supabase\.com|supabase\.in)$'
      then 'reserved_hostname'
    else null
  end
$fn$;

-- ---------------------------------------------------------------------------
-- 2. Tables
-- ---------------------------------------------------------------------------
create table if not exists public.store_domains (
  -- A group is one claim: {subdomain} or {apex, www}. The primary key makes a
  -- second row of the same kind in one group impossible outright.
  group_id      uuid        not null,
  store_slug    text        not null references public.stores (slug) on delete restrict,
  hostname      text        not null,
  kind          text        not null,
  role          text        not null,
  status        text        not null default 'pending',

  -- Why a group ended, or (while disconnecting) who asked it to.
  end_reason    text,

  -- The value the merchant publishes as a DNS TXT record. Proven once, at
  -- verification. Never required again while connected; a reconnect, a new
  -- store or an ownership change always starts a new group with a new token.
  txt_token     text        not null,

  -- What Vercel holds for THIS hostname; per row, because apex and www are
  -- separate Vercel domains. Written only by domain_vercel_intent (before a
  -- Vercel call) and domain_vercel_observe (the database derives the state
  -- from Vercel's raw facts):
  --   none                    never sent to Vercel
  --   adding                  add authorised; the POST may be in flight
  --   attached_unverified     in this project, Vercel verified = false
  --   attached_misconfigured  verified, but DNS config misconfigured = true
  --   configured              attached + verified + misconfigured = false.
  --                           The ONLY state that can serve and issue TLS.
  --   removing                DELETE authorised (disconnecting groups only)
  --   removed                 confirmed absent from the project
  vercel_state  text        not null default 'none',
  -- When vercel_state last changed, or a DELETE was last (re)authorised.
  -- A name is not released until 2 minutes after this, so a DELETE that was
  -- authorised earlier cannot still be in flight when another group can own
  -- the name.
  vercel_state_at timestamptz,

  expires_at    timestamptz,

  -- Group-level health for the later hourly check: two consecutive failures
  -- mark the group misconfigured, one success resets the count.
  consecutive_health_failures integer not null default 0,
  last_checked_at timestamptz,
  last_error    text,

  created_at    timestamptz not null default now(),
  verified_at   timestamptz,
  activated_at  timestamptz,
  ended_at      timestamptz,

  constraint store_domains_pkey primary key (group_id, kind),

  constraint store_domains_hostname_valid
    check (public.store_domain_hostname_problem(hostname) is null),
  constraint store_domains_kind_known
    check (kind in ('apex', 'www', 'subdomain')),
  constraint store_domains_role_known
    check (role in ('primary', 'redirect')),
  constraint store_domains_status_known
    check (status in ('pending', 'verified', 'ready', 'connected', 'misconfigured',
                      'disconnecting', 'disconnected', 'expired')),
  constraint store_domains_vercel_state_known
    check (vercel_state in ('none', 'adding', 'attached_unverified', 'attached_misconfigured',
                            'configured', 'removing', 'removed')),
  constraint store_domains_end_reason_known
    check (end_reason is null or end_reason in
            ('pending_ttl', 'verify_ttl', 'misconfigured_ttl', 'lost_race',
             'merchant', 'admin', 'system')),

  -- Shape of a kind.
  constraint store_domains_subdomain_is_primary
    check (kind <> 'subdomain' or role = 'primary'),
  -- A two-label name (brand.com) is always an apex, so never a subdomain row.
  -- Which longer names are apexes (brand.co.in) needs the public suffix list;
  -- the server decides that.
  constraint store_domains_subdomain_depth
    check (kind <> 'subdomain' or hostname ~ '\..*\.'),
  constraint store_domains_www_shape
    check (kind <> 'www' or left(hostname, 4) = 'www.'),
  constraint store_domains_apex_shape
    check (kind <> 'apex' or left(hostname, 4) <> 'www.'),

  constraint store_domains_token_shape
    check (txt_token ~ '^[0-9a-f]{32}$'),
  constraint store_domains_health_nonnegative
    check (consecutive_health_failures >= 0),
  constraint store_domains_last_error_bounded
    check (last_error is null or char_length(last_error) <= 500),

  -- Lifecycle consistency: every status carries exactly the facts it implies.
  constraint store_domains_end_reason_iff_ending
    check ((status in ('disconnecting', 'disconnected', 'expired')) = (end_reason is not null)),
  constraint store_domains_expired_reason
    check (status <> 'expired'
           or end_reason in ('pending_ttl', 'verify_ttl', 'misconfigured_ttl', 'lost_race')),
  -- 'disconnecting' is the one cleanup state, entered by a person (merchant /
  -- admin / system) or by a TTL; end_reason keeps the cause, never conflating
  -- the two. A TTL cleanup ends as 'expired', a requested one 'disconnected'.
  constraint store_domains_disconnect_reason
    check (status <> 'disconnecting'
           or end_reason in ('merchant', 'admin', 'system', 'verify_ttl', 'misconfigured_ttl')),
  constraint store_domains_disconnected_reason
    check (status <> 'disconnected' or end_reason in ('merchant', 'admin', 'system')),
  constraint store_domains_ended_at_iff_terminal
    check ((status in ('disconnected', 'expired')) = (ended_at is not null)),
  constraint store_domains_ttl_statuses_expire
    check (status not in ('pending', 'verified', 'ready', 'misconfigured')
           or expires_at is not null),
  constraint store_domains_live_statuses_do_not_expire
    check (status not in ('connected', 'disconnecting') or expires_at is null),
  constraint store_domains_proven_has_verified_at
    check (status not in ('verified', 'ready', 'connected', 'misconfigured', 'disconnecting')
           or verified_at is not null),
  constraint store_domains_live_has_activated_at
    check (status not in ('connected', 'misconfigured') or activated_at is not null),
  -- Vercel is never asked for a name whose ownership is unproven.
  constraint store_domains_pending_not_on_vercel
    check (status <> 'pending' or vercel_state = 'none'),
  -- A group only leaves the ownership index once Vercel holds none of it.
  constraint store_domains_ended_off_vercel
    check (status not in ('disconnected', 'expired') or vercel_state in ('none', 'removed')),
  -- A Vercel DELETE is only ever authorised by the group that still owns the
  -- name exclusively and is giving it up.
  constraint store_domains_removing_only_when_disconnecting
    check (vercel_state <> 'removing' or status = 'disconnecting'),
  -- 'ready' means every name is attached, verified and correctly configured.
  constraint store_domains_ready_is_configured
    check (status <> 'ready' or vercel_state = 'configured'),
  constraint store_domains_vercel_state_at_set
    check (vercel_state = 'none' or vercel_state_at is not null)
);

comment on table public.store_domains is
  'Custom merchant domains. One row per hostname; a group (group_id) is one claim: '
  '{subdomain} or {apex, www}. Written only by the domain_* RPCs (service_role). '
  'Read publicly only through resolve_store_host / store_primary_host, which expose '
  'connected groups only.';

create table if not exists public.store_domain_challenges (
  id              uuid        primary key default pg_catalog.gen_random_uuid(),
  store_slug      text        not null references public.stores (slug) on delete restrict,
  group_id        uuid        not null,
  action          text        not null,
  target_hostname text        not null,
  -- HMAC-SHA256 hex computed by the server with a secret the database never
  -- sees. The code itself is never stored, and cannot be: see the CHECK.
  code_hash       text        not null,
  expires_at      timestamptz not null,
  attempts        integer     not null default 0,
  consumed_at     timestamptz,
  created_at      timestamptz not null default now(),

  constraint store_domain_challenges_action_known
    check (action in ('activate', 'set_primary', 'disconnect')),
  constraint store_domain_challenges_hash_only
    check (code_hash ~ '^[0-9a-f]{64}$'),
  constraint store_domain_challenges_attempts_bounded
    check (attempts between 0 and 5),
  constraint store_domain_challenges_ten_minutes
    check (expires_at > created_at and expires_at <= created_at + interval '10 minutes'),
  constraint store_domain_challenges_target_valid
    check (public.store_domain_hostname_problem(target_hostname) is null)
);

comment on table public.store_domain_challenges is
  'Step-up codes for activate / set_primary / disconnect. Bound to one store, group, '
  'action and hostname; single use; 10 minutes; 5 attempts. Stores an HMAC only. '
  'No role but the table owner can read or write it.';

create table if not exists public.store_domain_events (
  id          bigint      generated always as identity primary key,
  group_id    uuid        not null,
  store_slug  text        not null references public.stores (slug) on delete restrict,
  event       text        not null,
  actor       text        not null,
  detail      jsonb       not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),

  constraint store_domain_events_event_shape
    check (event ~ '^[a-z][a-z0-9_]{2,47}$'),
  constraint store_domain_events_actor_known
    check (actor in ('merchant', 'admin', 'system')),
  constraint store_domain_events_detail_object
    check (jsonb_typeof(detail) = 'object')
);

comment on table public.store_domain_events is
  'Append-only audit trail for custom domains. Never updated, deleted or truncated '
  '(enforced by trigger). Never contains a TXT token or a code hash.';

-- ---------------------------------------------------------------------------
-- 3. Indexes and triggers
-- ---------------------------------------------------------------------------

-- THE OWNERSHIP RULE. A hostname can be in at most one group that has proved
-- ownership. 'pending' is deliberately absent: a pending claim reserves
-- nothing. 'disconnected' and 'expired' are absent: ending a group frees its
-- names. No now() in the predicate -- only status.
create unique index if not exists store_domains_active_hostname_uidx
  on public.store_domains (hostname)
  where status in ('verified', 'ready', 'connected', 'misconfigured', 'disconnecting');

-- ONE OPEN GROUP PER STORE (v1). Counted on the primary row, and every group
-- has exactly one.
create unique index if not exists store_domains_one_open_group_per_store_uidx
  on public.store_domains (store_slug)
  where role = 'primary'
    and status in ('pending', 'verified', 'ready', 'connected', 'misconfigured', 'disconnecting');

-- The expiry sweep's scan. Still no now(): the comparison happens in the query.
create index if not exists store_domains_expiry_idx
  on public.store_domains (expires_at)
  where role = 'primary' and status in ('pending', 'verified', 'ready', 'misconfigured');

create index if not exists store_domain_challenges_store_created_idx
  on public.store_domain_challenges (store_slug, created_at);
create index if not exists store_domain_challenges_group_idx
  on public.store_domain_challenges (group_id);

create index if not exists store_domain_events_group_idx
  on public.store_domain_events (group_id, created_at);
create index if not exists store_domain_events_store_idx
  on public.store_domain_events (store_slug, created_at);

-- Lifecycle guard: identity never changes, statuses only move along the
-- lifecycle, and an ended row is frozen COMPLETELY -- an ended group left
-- Vercel before it ended (store_domains_ended_off_vercel), so there is nothing
-- left for it to record, and nothing it may authorise.
create or replace function public.store_domains_guard_update()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $fn$
begin
  if (new.group_id, new.store_slug, new.hostname, new.kind, new.txt_token, new.created_at)
     is distinct from
     (old.group_id, old.store_slug, old.hostname, old.kind, old.txt_token, old.created_at) then
    raise exception 'store_domains: group_id, store_slug, hostname, kind, txt_token and created_at never change'
      using errcode = 'check_violation';
  end if;

  if old.status in ('disconnected', 'expired') then
    raise exception 'store_domains: an ended group is frozen'
      using errcode = 'check_violation';
  end if;

  -- ready -> verified: a name regressed on Vercel before activation.
  -- disconnecting -> expired: a TTL cleanup finished.
  if new.status is distinct from old.status and not (
       (old.status = 'pending'       and new.status in ('verified', 'expired', 'disconnected'))
    or (old.status = 'verified'      and new.status in ('ready', 'disconnecting', 'disconnected', 'expired'))
    or (old.status = 'ready'         and new.status in ('verified', 'connected', 'disconnecting', 'disconnected', 'expired'))
    or (old.status = 'connected'     and new.status in ('misconfigured', 'disconnecting', 'disconnected'))
    or (old.status = 'misconfigured' and new.status in ('connected', 'disconnecting', 'disconnected', 'expired'))
    or (old.status = 'disconnecting' and new.status in ('disconnected', 'expired'))
  ) then
    raise exception 'store_domains: % -> % is not a permitted transition', old.status, new.status
      using errcode = 'check_violation';
  end if;

  return new;
end
$fn$;

-- Group invariant, checked at COMMIT.
--
-- WHY DEFERRED. A group's rules are about several rows together, and no single
-- statement can keep them true at every instant:
--   * a new apex group is two rows; after the first is written the group is
--     "one apex with no www", which is exactly what must be refused if it were
--     ever the final state;
--   * swapping the primary within a group passes through zero primaries (the
--     per-store unique index forbids passing through two);
--   * a status change is applied row by row, in kind order, so the ownership
--     index is always entered in the same order (see domain_mark_verified).
-- An immediate check would reject every one of these legitimate steps. A
-- deferred constraint trigger sees only the state the transaction commits,
-- which is the state that matters. The one thing it cannot do is refuse early
-- -- so every RPC below also builds groups correctly on its own, and this is
-- the backstop that makes a mistake (or a hand-written UPDATE) fail loudly
-- instead of committing a half-group.
create or replace function public.store_domains_check_group()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $fn$
declare
  v_group    uuid;
  v_rows     integer;
  v_primary  integer;
  v_apex     integer;
  v_www      integer;
  v_sub      integer;
  v_apex_h   text;
  v_www_h    text;
  v_shared   integer;
begin
  if tg_op = 'DELETE' then
    v_group := old.group_id;
  else
    v_group := new.group_id;
  end if;

  select count(*),
         count(*) filter (where d.role = 'primary'),
         count(*) filter (where d.kind = 'apex'),
         count(*) filter (where d.kind = 'www'),
         count(*) filter (where d.kind = 'subdomain'),
         max(d.hostname) filter (where d.kind = 'apex'),
         max(d.hostname) filter (where d.kind = 'www')
    into v_rows, v_primary, v_apex, v_www, v_sub, v_apex_h, v_www_h
    from public.store_domains d
   where d.group_id = v_group;

  if v_rows = 0 then
    return null;
  end if;

  select count(*) into v_shared
    from (select distinct d.store_slug, d.status, d.txt_token, d.end_reason, d.expires_at,
                          d.created_at, d.verified_at, d.activated_at, d.ended_at,
                          d.consecutive_health_failures, d.last_checked_at
            from public.store_domains d
           where d.group_id = v_group) s;

  if v_shared <> 1 then
    raise exception 'store_domains group %: rows disagree on store, status, token or lifecycle', v_group
      using errcode = 'check_violation';
  end if;
  if v_primary <> 1 then
    raise exception 'store_domains group %: has % primary rows, needs exactly 1', v_group, v_primary
      using errcode = 'check_violation';
  end if;
  if v_rows = 1 and v_sub = 1 then
    return null;
  end if;
  if v_rows = 2 and v_apex = 1 and v_www = 1 and v_www_h = 'www.' || v_apex_h then
    return null;
  end if;
  raise exception 'store_domains group %: must be {subdomain} or {apex, www.apex}', v_group
    using errcode = 'check_violation';
end
$fn$;

create or replace function public.store_domain_events_append_only()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $fn$
begin
  raise exception 'store_domain_events is append-only'
    using errcode = 'insufficient_privilege';
end
$fn$;

do $triggers$
begin
  if not exists (select 1 from pg_trigger
                  where tgrelid = 'public.store_domains'::regclass
                    and tgname = 'store_domains_guard_update') then
    create trigger store_domains_guard_update
      before update on public.store_domains
      for each row execute function public.store_domains_guard_update();
  end if;

  if not exists (select 1 from pg_trigger
                  where tgrelid = 'public.store_domains'::regclass
                    and tgname = 'store_domains_check_group') then
    create constraint trigger store_domains_check_group
      after insert or update or delete on public.store_domains
      deferrable initially deferred
      for each row execute function public.store_domains_check_group();
  end if;

  if not exists (select 1 from pg_trigger
                  where tgrelid = 'public.store_domain_events'::regclass
                    and tgname = 'store_domain_events_no_change') then
    create trigger store_domain_events_no_change
      before update or delete on public.store_domain_events
      for each row execute function public.store_domain_events_append_only();
  end if;

  if not exists (select 1 from pg_trigger
                  where tgrelid = 'public.store_domain_events'::regclass
                    and tgname = 'store_domain_events_no_truncate') then
    create trigger store_domain_events_no_truncate
      before truncate on public.store_domain_events
      for each statement execute function public.store_domain_events_append_only();
  end if;
end
$triggers$;

-- ---------------------------------------------------------------------------
-- 4. Internal helpers (no role may call these; the RPCs run as their owner)
-- ---------------------------------------------------------------------------

-- One audit row. Callers never pass a TXT token or a code hash.
create or replace function public.store_domain_log(
  p_group_id   uuid,
  p_store_slug text,
  p_event      text,
  p_actor      text,
  p_detail     jsonb
)
returns void
language sql
set search_path = public, pg_temp
as $fn$
  insert into public.store_domain_events (group_id, store_slug, event, actor, detail)
  values (p_group_id, p_store_slug, p_event, p_actor, coalesce(p_detail, '{}'::jsonb));
$fn$;

-- TRUE when the group may give up its names: Vercel holds none of them
-- ('none' or 'removed' on every row), AND every 'removed' has settled for
-- 2 minutes. The settle window covers a DELETE authorised earlier by a retried
-- or delayed worker: PR-C's Vercel calls time out well inside it, so by the
-- time the name can pass to another group no DELETE for it can still land.
create or replace function public.store_domain_vercel_clear(p_group_id uuid)
returns boolean
language sql
stable
set search_path = public, pg_temp
as $fn$
  select not exists (
    select 1 from public.store_domains d
     where d.group_id = p_group_id
       and (d.vercel_state not in ('none', 'removed')
            or (d.vercel_state = 'removed'
                and d.vercel_state_at > now() - interval '2 minutes')))
$fn$;

-- Expire a group whose TTL has passed. Locks the group's rows in kind order
-- (the order every RPC uses), re-reads under the lock, and acts only if it is
-- still in a TTL status and still past expires_at. Returns the TTL reason, or
-- NULL if nothing was stale.
--
--   pending                  -> expired at once. A pending group has never
--                               been sent to Vercel (CHECK), so freeing it is
--                               always safe.
--   verified / ready /       -> expired at once ONLY if Vercel holds none of
--   misconfigured               its names (store_domain_vercel_clear).
--                               Otherwise -> 'disconnecting' with the TTL as
--                               end_reason: still inside the ownership index,
--                               so the names stay exclusive until PR-C has
--                               removed them and domain_finish_disconnect
--                               ends the group as 'expired'.
create or replace function public.store_domain_expire_if_stale(p_group_id uuid)
returns text
language plpgsql
set search_path = public, pg_temp
as $fn$
declare
  v_status  text;
  v_expires timestamptz;
  v_slug    text;
  v_reason  text;
  v_vercel  jsonb;
begin
  perform 1 from public.store_domains d
   where d.group_id = p_group_id
   order by d.kind
     for update;

  select d.status, d.expires_at, d.store_slug
    into v_status, v_expires, v_slug
    from public.store_domains d
   where d.group_id = p_group_id and d.role = 'primary';

  if not found
     or v_status not in ('pending', 'verified', 'ready', 'misconfigured')
     or v_expires is null
     or v_expires > now() then
    return null;
  end if;

  v_reason := case v_status
                when 'pending'       then 'pending_ttl'
                when 'misconfigured' then 'misconfigured_ttl'
                else 'verify_ttl'
              end;

  if v_status = 'pending' or public.store_domain_vercel_clear(p_group_id) then
    -- Leaving the ownership index never waits on another group, so one
    -- statement for both rows is safe here.
    update public.store_domains d
       set status = 'expired', end_reason = v_reason, ended_at = now()
     where d.group_id = p_group_id;
    perform public.store_domain_log(p_group_id, v_slug, 'expired', 'system',
      jsonb_build_object('from', v_status, 'reason', v_reason));
    return v_reason;
  end if;

  -- Vercel may still hold a name: keep it exclusive while it is cleaned up.
  update public.store_domains d
     set status = 'disconnecting', end_reason = v_reason, expires_at = null
   where d.group_id = p_group_id;
  select jsonb_object_agg(d.hostname, d.vercel_state) into v_vercel
    from public.store_domains d where d.group_id = p_group_id;
  perform public.store_domain_log(p_group_id, v_slug, 'expiry_cleanup_started', 'system',
    jsonb_build_object('from', v_status, 'reason', v_reason, 'vercel', v_vercel));
  return v_reason;
end
$fn$;

-- Check and (on success) consume a step-up challenge for exactly this store,
-- group, action and hostname. Every failed check is counted; the fifth locks
-- the challenge. Returns 'ok' or the reason it is refused. The caller must
-- have validated the group state FIRST, so a request that could not succeed
-- anyway never burns the merchant's code.
create or replace function public.store_domain_consume_challenge(
  p_challenge_id    uuid,
  p_store_slug      text,
  p_group_id        uuid,
  p_action          text,
  p_target_hostname text,
  p_code_hash       text
)
returns text
language plpgsql
set search_path = public, pg_temp
as $fn$
declare
  v_c        public.store_domain_challenges%rowtype;
  v_attempts integer;
  v_reason   text;
begin
  if p_challenge_id is null or p_code_hash is null then
    return 'challenge_required';
  end if;

  select * into v_c
    from public.store_domain_challenges c
   where c.id = p_challenge_id and c.store_slug = p_store_slug
     for update;

  if not found then
    return 'challenge_not_found';
  end if;
  if v_c.consumed_at is not null then
    return 'challenge_used';
  end if;
  if v_c.attempts >= 5 then
    return 'challenge_locked';
  end if;
  if v_c.expires_at <= now() then
    return 'challenge_expired';
  end if;

  if v_c.group_id <> p_group_id or v_c.action <> p_action
     or v_c.target_hostname <> p_target_hostname then
    v_reason := 'challenge_purpose_mismatch';
  elsif v_c.code_hash <> lower(p_code_hash) then
    v_reason := 'challenge_wrong_code';
  else
    update public.store_domain_challenges c
       set consumed_at = now()
     where c.id = v_c.id;
    perform public.store_domain_log(v_c.group_id, p_store_slug, 'challenge_consumed', 'merchant',
      jsonb_build_object('action', v_c.action, 'challenge_id', v_c.id));
    return 'ok';
  end if;

  update public.store_domain_challenges c
     set attempts = c.attempts + 1
   where c.id = v_c.id
  returning c.attempts into v_attempts;

  perform public.store_domain_log(v_c.group_id, p_store_slug, 'challenge_failed', 'merchant',
    jsonb_build_object('action', v_c.action, 'challenge_id', v_c.id,
                       'reason', v_reason, 'attempts', v_attempts));
  if v_attempts >= 5 then
    return 'challenge_locked';
  end if;
  return v_reason;
end
$fn$;

-- ---------------------------------------------------------------------------
-- 5. Public read RPCs -- the only way a browser role reaches this data
-- ---------------------------------------------------------------------------
-- Both answer ONLY for connected groups and return only a routing answer: no
-- token, status, group id, error or timestamp. A hostname that is pending,
-- verified, ready, misconfigured, disconnecting or ended is indistinguishable
-- from one that was never claimed. Bad input returns nothing, never an error.

-- Host header -> which store to render, and the host to canonicalise to.
-- Case, a trailing dot and a :port are normalised away, as in api/render.js.
create or replace function public.resolve_store_host(p_host text)
returns table (store_slug text, primary_host text)
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select d.store_slug, p.hostname
    from (select public.store_domain_normalize(
                   regexp_replace(lower(btrim(p_host)), ':[0-9]{1,5}$', '')) as host
           where p_host is not null and char_length(p_host) <= 260) h
    join public.store_domains d
      on d.hostname = h.host and d.status = 'connected'
    join public.store_domains p
      on p.group_id = d.group_id and p.role = 'primary'
   limit 1
$fn$;

-- A store's connected primary hostname, or NULL.
create or replace function public.store_primary_host(p_slug text)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select d.hostname
    from public.store_domains d
   where p_slug is not null
     and char_length(p_slug) <= 100
     and d.store_slug = lower(btrim(p_slug))
     and d.role = 'primary'
     and d.status = 'connected'
   limit 1
$fn$;

-- ---------------------------------------------------------------------------
-- 6. Server RPCs (service_role only)
-- ---------------------------------------------------------------------------
-- House style (as claim_shipment_attempt): each returns jsonb with an
-- "outcome", never raises for an expected refusal, and every group-scoped
-- call takes the store slug too -- a group of another store is reported as
-- not_found, indistinguishable from no group at all. Every call that touches a
-- group locks all of its rows in kind order first.

-- 6.1 Claim. Creates a PENDING group with a fresh TXT token. A pending claim
--     reserves nothing, so this never checks other stores' pending claims --
--     but a hostname another store has already PROVED is refused up front.
--     p_kind: 'apex' (brand.com primary, www.brand.com redirect),
--             'www' (www.brand.com primary, brand.com redirect),
--             'subdomain' (one row). Deciding apex vs subdomain needs the
--             public suffix list, so the server decides; the database checks
--             the shape.
create or replace function public.domain_claim(
  p_store_slug text,
  p_hostname   text,
  p_kind       text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_kind    text := lower(btrim(coalesce(p_kind, '')));
  v_host    text := public.store_domain_normalize(p_hostname);
  v_problem text;
  v_apex    text;
  v_www     text;
  v_hosts   text[];
  v_gid     uuid;
  v_open    record;
  v_group   uuid;
  v_token   text;
  v_expires timestamptz := now() + interval '72 hours';
begin
  if v_kind not in ('apex', 'www', 'subdomain') then
    return jsonb_build_object('outcome', 'invalid_kind');
  end if;

  v_problem := public.store_domain_hostname_problem(v_host);
  if v_problem is not null then
    return jsonb_build_object('outcome', v_problem);
  end if;

  if v_kind = 'subdomain' then
    -- A two-label name is always a registrable apex, never a subdomain.
    if v_host !~ '\..*\.' then
      return jsonb_build_object('outcome', 'invalid_hostname');
    end if;
    v_hosts := array[v_host];
  else
    if v_kind = 'apex' then
      if left(v_host, 4) = 'www.' then
        return jsonb_build_object('outcome', 'invalid_hostname');
      end if;
      v_apex := v_host;
      v_www  := 'www.' || v_host;
    else
      if left(v_host, 4) <> 'www.' then
        return jsonb_build_object('outcome', 'invalid_hostname');
      end if;
      v_www  := v_host;
      v_apex := substr(v_host, 5);
    end if;
    v_problem := coalesce(public.store_domain_hostname_problem(v_apex),
                          public.store_domain_hostname_problem(v_www));
    if v_problem is not null then
      return jsonb_build_object('outcome', v_problem);
    end if;
    v_hosts := array[v_apex, v_www];
  end if;

  if not exists (select 1 from public.stores s where s.slug = p_store_slug) then
    return jsonb_build_object('outcome', 'store_not_found');
  end if;

  -- The store's open group. A stale one is expired first so it cannot block.
  for v_gid in
    select d.group_id from public.store_domains d
     where d.store_slug = p_store_slug and d.role = 'primary'
       and d.status in ('pending', 'verified', 'ready', 'misconfigured')
       and d.expires_at <= now()
  loop
    perform public.store_domain_expire_if_stale(v_gid);
  end loop;

  select d.group_id, d.status, d.hostname, d.kind, d.txt_token, d.expires_at
    into v_open
    from public.store_domains d
   where d.store_slug = p_store_slug and d.role = 'primary'
     and d.status in ('pending', 'verified', 'ready', 'connected', 'misconfigured', 'disconnecting');

  if found then
    -- The same claim again: hand back the same group and token (idempotent).
    if v_open.status = 'pending' and v_open.hostname = v_host and v_open.kind = v_kind then
      return jsonb_build_object(
        'outcome', 'already_claimed', 'group_id', v_open.group_id,
        'txt_token', v_open.txt_token, 'expires_at', v_open.expires_at,
        'primary_host', v_host, 'hostnames', to_jsonb(v_hosts));
    end if;
    return jsonb_build_object(
      'outcome', 'store_has_open_group', 'group_id', v_open.group_id,
      'status', v_open.status, 'primary_host', v_open.hostname);
  end if;

  -- Another store has PROVED one of these names. Stale holders are expired
  -- first; a live holder is final until it disconnects or expires.
  for v_gid in
    select distinct d.group_id from public.store_domains d
     where d.hostname = any (v_hosts)
       and d.status in ('verified', 'ready', 'misconfigured')
       and d.expires_at <= now()
  loop
    perform public.store_domain_expire_if_stale(v_gid);
  end loop;

  if exists (select 1 from public.store_domains d
              where d.hostname = any (v_hosts)
                and d.status in ('verified', 'ready', 'connected', 'misconfigured')) then
    return jsonb_build_object('outcome', 'hostname_in_use');
  end if;
  -- The holder is giving the name up but Vercel cleanup is not confirmed yet.
  -- Retryable; nothing is created meanwhile.
  if exists (select 1 from public.store_domains d
              where d.hostname = any (v_hosts) and d.status = 'disconnecting') then
    return jsonb_build_object('outcome', 'hostname_releasing');
  end if;

  v_group := pg_catalog.gen_random_uuid();
  v_token := replace(pg_catalog.gen_random_uuid()::text, '-', '');

  begin
    insert into public.store_domains
      (group_id, store_slug, hostname, kind, role, status, txt_token, expires_at)
    select v_group, p_store_slug, r.hostname, r.kind, r.role, 'pending', v_token, v_expires
      from (values
              (v_host, 'subdomain', 'primary',  v_kind = 'subdomain'),
              (v_apex, 'apex',      case when v_kind = 'apex' then 'primary' else 'redirect' end,
                                                v_kind <> 'subdomain'),
              (v_www,  'www',       case when v_kind = 'www'  then 'primary' else 'redirect' end,
                                                v_kind <> 'subdomain')
           ) as r (hostname, kind, role, wanted)
     where r.wanted;
  exception
    when unique_violation then
      -- A concurrent claim by the same store won the per-store index.
      return jsonb_build_object('outcome', 'store_has_open_group');
  end;

  perform public.store_domain_log(v_group, p_store_slug, 'claimed', 'merchant',
    jsonb_build_object('kind', v_kind, 'primary_host', v_host, 'hostnames', to_jsonb(v_hosts)));

  return jsonb_build_object(
    'outcome', 'claimed', 'group_id', v_group, 'txt_token', v_token,
    'expires_at', v_expires, 'primary_host', v_host, 'hostnames', to_jsonb(v_hosts));
end
$fn$;

-- 6.2 Ownership proven -> verified. FIRST PROOF WINS, decided by the database.
--
--     The server calls this only after it has seen the group's TXT token in
--     DNS, and passes the token it saw; a mismatch is refused. The rows then
--     move pending -> verified, which enters them into
--     store_domains_active_hostname_uidx. If any other group has already
--     proved one of these names, that insert raises unique_violation -- at
--     once if the other group committed, or as soon as it commits if it is
--     mid-flight (PostgreSQL makes the second inserter wait on the first).
--     There is no read-then-write window: the index IS the decision.
--
--     The loser is not left pending (it could never be verified while the
--     winner holds the name). It is ended in the same call as
--     expired / end_reason 'lost_race', and the caller gets outcome
--     'lost_race' -- deterministic, and final: a retry answers 'not_pending'.
--
--     One exception: if the only conflicting holder is 'disconnecting' -- a
--     group giving the name up while Vercel cleanup is confirmed -- nobody has
--     won against this claim. It stays pending, nothing is written, and the
--     outcome is 'hostname_releasing': retry after the cleanup.
--
--     Rows are updated one at a time in kind order (apex before www) so two
--     groups sharing both names always enter the index in the same order and
--     cannot deadlock each other.
create or replace function public.domain_mark_verified(
  p_group_id     uuid,
  p_store_slug   text,
  p_proved_token text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_status  text;
  v_token   text;
  v_hosts   text[];
  v_kind    text;
  v_gid     uuid;
  v_expires timestamptz := now() + interval '7 days';
begin
  perform 1 from public.store_domains d
   where d.group_id = p_group_id and d.store_slug = p_store_slug
   order by d.kind
     for update;
  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;

  if public.store_domain_expire_if_stale(p_group_id) is not null then
    return jsonb_build_object('outcome', 'expired', 'group_id', p_group_id,
      'status', (select d.status from public.store_domains d
                  where d.group_id = p_group_id and d.role = 'primary'));
  end if;

  select d.status, d.txt_token into v_status, v_token
    from public.store_domains d
   where d.group_id = p_group_id and d.role = 'primary';

  if v_status <> 'pending' then
    return jsonb_build_object(
      'outcome', case when v_status in ('verified', 'ready', 'connected', 'misconfigured', 'disconnecting')
                      then 'already_verified' else 'not_pending' end,
      'status', v_status);
  end if;

  if p_proved_token is null or p_proved_token <> v_token then
    perform public.store_domain_log(p_group_id, p_store_slug, 'verify_token_mismatch', 'system', '{}'::jsonb);
    return jsonb_build_object('outcome', 'token_mismatch');
  end if;

  select array_agg(d.hostname order by d.kind) into v_hosts
    from public.store_domains d where d.group_id = p_group_id;

  -- A holder whose own TTL has run out must not block a fresh proof.
  for v_gid in
    select distinct d.group_id from public.store_domains d
     where d.hostname = any (v_hosts) and d.group_id <> p_group_id
       and d.status in ('verified', 'ready', 'misconfigured')
       and d.expires_at <= now()
  loop
    perform public.store_domain_expire_if_stale(v_gid);
  end loop;

  begin
    for v_kind in
      select d.kind from public.store_domains d
       where d.group_id = p_group_id order by d.kind
    loop
      update public.store_domains d
         set status = 'verified', verified_at = now(), expires_at = v_expires
       where d.group_id = p_group_id and d.kind = v_kind;
    end loop;
  exception
    when unique_violation then
      if not exists (select 1 from public.store_domains d
                      where d.hostname = any (v_hosts) and d.group_id <> p_group_id
                        and d.status in ('verified', 'ready', 'connected', 'misconfigured')) then
        perform public.store_domain_log(p_group_id, p_store_slug, 'verify_deferred', 'system',
          jsonb_build_object('hostnames', to_jsonb(v_hosts), 'reason', 'hostname_releasing'));
        return jsonb_build_object('outcome', 'hostname_releasing', 'group_id', p_group_id);
      end if;
      update public.store_domains d
         set status = 'expired', end_reason = 'lost_race', ended_at = now()
       where d.group_id = p_group_id;
      perform public.store_domain_log(p_group_id, p_store_slug, 'lost_race', 'system',
        jsonb_build_object('hostnames', to_jsonb(v_hosts)));
      return jsonb_build_object('outcome', 'lost_race', 'group_id', p_group_id);
  end;

  perform public.store_domain_log(p_group_id, p_store_slug, 'verified', 'system',
    jsonb_build_object('hostnames', to_jsonb(v_hosts)));
  return jsonb_build_object('outcome', 'verified', 'group_id', p_group_id, 'expires_at', v_expires);
end
$fn$;

-- 6.3 Vercel INTENT -- called immediately BEFORE a Vercel call, which PR-C
--     must not make unless this returns outcome 'ok'.
--       'add'    -> 'adding'. Only for a group that has proved ownership and
--                   is not being released. A name already attached is left
--                   alone ('already_attached').
--       'remove' -> 'removing'. Only for a group in 'disconnecting' -- the
--                   one state in which the group still owns the name
--                   exclusively AND is giving it up. Re-authorising renews
--                   vercel_state_at, so every DELETE attempt, retries
--                   included, must come back here first.
--     An ended group can authorise nothing ('group_ended').
create or replace function public.domain_vercel_intent(
  p_group_id   uuid,
  p_store_slug text,
  p_hostname   text,
  p_intent     text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_host   text := public.store_domain_normalize(p_hostname);
  v_intent text := lower(btrim(coalesce(p_intent, '')));
  v_status text;
  v_old    text;
  v_next   text;
begin
  if v_intent not in ('add', 'remove') then
    return jsonb_build_object('outcome', 'invalid_intent');
  end if;

  perform 1 from public.store_domains d
   where d.group_id = p_group_id and d.store_slug = p_store_slug
   order by d.kind
     for update;
  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;

  if v_intent = 'add' and public.store_domain_expire_if_stale(p_group_id) is not null then
    return jsonb_build_object('outcome', 'expired', 'group_id', p_group_id,
      'status', (select d.status from public.store_domains d
                  where d.group_id = p_group_id and d.role = 'primary'));
  end if;

  select d.status, d.vercel_state into v_status, v_old
    from public.store_domains d
   where d.group_id = p_group_id and d.hostname = v_host;
  if not found then
    return jsonb_build_object('outcome', 'hostname_not_in_group');
  end if;

  if v_status in ('disconnected', 'expired') then
    return jsonb_build_object('outcome', 'group_ended', 'status', v_status);
  end if;

  if v_intent = 'add' then
    if v_status not in ('verified', 'ready', 'connected', 'misconfigured') then
      return jsonb_build_object('outcome', 'not_allowed', 'status', v_status);
    end if;
    if v_old in ('attached_unverified', 'attached_misconfigured', 'configured') then
      return jsonb_build_object('outcome', 'already_attached', 'vercel_state', v_old);
    end if;
    v_next := 'adding';
  else
    if v_status <> 'disconnecting' then
      return jsonb_build_object('outcome', 'not_disconnecting', 'status', v_status);
    end if;
    if v_old in ('none', 'removed') then
      return jsonb_build_object('outcome', 'nothing_to_remove', 'vercel_state', v_old);
    end if;
    v_next := 'removing';
  end if;

  update public.store_domains d
     set vercel_state = v_next, vercel_state_at = now(), last_error = null
   where d.group_id = p_group_id and d.hostname = v_host;

  perform public.store_domain_log(p_group_id, p_store_slug, 'vercel_intent', 'system',
    jsonb_build_object('hostname', v_host, 'intent', v_intent, 'from', v_old, 'to', v_next));
  return jsonb_build_object('outcome', 'ok', 'hostname', v_host, 'vercel_state', v_next);
end
$fn$;

-- 6.4 Vercel OBSERVATION -- what Vercel reported for one hostname, as raw
--     facts; the database derives the state, so the server cannot label a
--     merely attached or misconfigured domain as ready:
--       p_attached      the hostname is in THIS PocketLink Vercel project
--                       (false = confirmed absent; NULL = unknown, refused)
--       p_verified      Vercel's "verified" for the project domain
--       p_misconfigured Vercel's "misconfigured" from the config check
--     attached = false                                  -> removed
--     attached, verified not true                       -> attached_unverified
--     attached, verified, misconfigured not false       -> attached_misconfigured
--     attached, verified, misconfigured = false         -> configured
--     Anything other than 'configured' on a 'ready' group demotes the group
--     to 'verified' in the same call (ready is never left stale).
create or replace function public.domain_vercel_observe(
  p_group_id      uuid,
  p_store_slug    text,
  p_hostname      text,
  p_attached      boolean,
  p_verified      boolean,
  p_misconfigured boolean,
  p_error         text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_host   text := public.store_domain_normalize(p_hostname);
  v_status text;
  v_old    text;
  v_next   text;
begin
  if p_attached is null then
    return jsonb_build_object('outcome', 'invalid_observation');
  end if;

  perform 1 from public.store_domains d
   where d.group_id = p_group_id and d.store_slug = p_store_slug
   order by d.kind
     for update;
  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;

  select d.status, d.vercel_state into v_status, v_old
    from public.store_domains d
   where d.group_id = p_group_id and d.hostname = v_host;
  if not found then
    return jsonb_build_object('outcome', 'hostname_not_in_group');
  end if;

  if v_status in ('disconnected', 'expired') then
    return jsonb_build_object('outcome', 'group_ended', 'status', v_status);
  end if;
  if v_status = 'pending' then
    return jsonb_build_object('outcome', 'not_verified', 'status', v_status);
  end if;

  v_next := case
              when not p_attached              then 'removed'
              when p_verified is not true      then 'attached_unverified'
              when p_misconfigured is not false then 'attached_misconfigured'
              else 'configured'
            end;

  -- Demote first: store_domains_ready_is_configured forbids a ready row that
  -- is not configured, even for an instant.
  if v_status = 'ready' and v_next <> 'configured' then
    update public.store_domains d set status = 'verified' where d.group_id = p_group_id;
    perform public.store_domain_log(p_group_id, p_store_slug, 'ready_revoked', 'system',
      jsonb_build_object('hostname', v_host, 'vercel_state', v_next));
  end if;

  update public.store_domains d
     set vercel_state    = v_next,
         vercel_state_at = case when v_next is distinct from v_old then now() else d.vercel_state_at end,
         last_error      = left(nullif(btrim(coalesce(p_error, '')), ''), 500)
   where d.group_id = p_group_id and d.hostname = v_host;

  if v_next is distinct from v_old then
    perform public.store_domain_log(p_group_id, p_store_slug, 'vercel_observed', 'system',
      jsonb_build_object('hostname', v_host, 'from', v_old, 'to', v_next, 'attached', p_attached,
                         'verified', p_verified, 'misconfigured', p_misconfigured));
  end if;
  return jsonb_build_object('outcome', 'ok', 'hostname', v_host, 'vercel_state', v_next,
                            'status', case when v_status = 'ready' and v_next <> 'configured'
                                           then 'verified' else v_status end);
end
$fn$;

-- 6.5 verified -> ready. THE GATE: every hostname of the group must be
--     'configured' -- attached to this project, verified by Vercel and
--     reporting misconfigured = false -- as last observed. Any other state
--     (including a mere successful add, 'adding') is refused.
create or replace function public.domain_mark_ready(
  p_group_id   uuid,
  p_store_slug text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_status text;
  v_states jsonb;
begin
  perform 1 from public.store_domains d
   where d.group_id = p_group_id and d.store_slug = p_store_slug
   order by d.kind
     for update;
  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;

  if public.store_domain_expire_if_stale(p_group_id) is not null then
    return jsonb_build_object('outcome', 'expired', 'group_id', p_group_id,
      'status', (select d.status from public.store_domains d
                  where d.group_id = p_group_id and d.role = 'primary'));
  end if;

  select d.status into v_status
    from public.store_domains d
   where d.group_id = p_group_id and d.role = 'primary';

  if v_status <> 'verified' then
    return jsonb_build_object(
      'outcome', case when v_status in ('ready', 'connected', 'misconfigured')
                      then 'already_ready' else 'not_verified' end,
      'status', v_status);
  end if;

  if exists (select 1 from public.store_domains d
              where d.group_id = p_group_id and d.vercel_state <> 'configured') then
    select jsonb_object_agg(d.hostname, d.vercel_state) into v_states
      from public.store_domains d where d.group_id = p_group_id;
    return jsonb_build_object('outcome', 'vercel_not_ready', 'vercel', v_states);
  end if;

  update public.store_domains d set status = 'ready' where d.group_id = p_group_id;

  perform public.store_domain_log(p_group_id, p_store_slug, 'ready', 'system', '{}'::jsonb);
  return jsonb_build_object('outcome', 'ready', 'group_id', p_group_id);
end
$fn$;

-- 6.6 Create a step-up challenge. The SERVER generates the code, sends it to
--     the store owner's WhatsApp, and passes only HMAC-SHA256(secret, code)
--     here. Refused unless the action is possible right now for exactly this
--     hostname, so a code is never sent for something that cannot happen.
--     At most 5 challenges per store per rolling hour.
create or replace function public.domain_challenge_create(
  p_store_slug      text,
  p_group_id        uuid,
  p_action          text,
  p_target_hostname text,
  p_code_hash       text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_action  text := lower(btrim(coalesce(p_action, '')));
  v_target  text := public.store_domain_normalize(p_target_hostname);
  v_status  text;
  v_rows    integer;
  v_role    text;
  v_recent  integer;
  v_id      uuid;
  v_expires timestamptz := now() + interval '10 minutes';
begin
  if v_action not in ('activate', 'set_primary', 'disconnect') then
    return jsonb_build_object('outcome', 'invalid_action');
  end if;
  if p_code_hash is null or p_code_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('outcome', 'invalid_code_hash');
  end if;

  perform 1 from public.store_domains d
   where d.group_id = p_group_id and d.store_slug = p_store_slug
   order by d.kind
     for update;
  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;

  if public.store_domain_expire_if_stale(p_group_id) is not null then
    return jsonb_build_object('outcome', 'expired', 'group_id', p_group_id,
      'status', (select d.status from public.store_domains d
                  where d.group_id = p_group_id and d.role = 'primary'));
  end if;

  select max(d.status), count(*) into v_status, v_rows
    from public.store_domains d where d.group_id = p_group_id;

  select d.role into v_role
    from public.store_domains d
   where d.group_id = p_group_id and d.hostname = v_target;
  if not found then
    return jsonb_build_object('outcome', 'target_not_in_group');
  end if;

  if not (
       (v_action = 'activate'    and v_status = 'ready' and v_role = 'primary')
    or (v_action = 'set_primary' and v_rows = 2 and v_role = 'redirect'
        and v_status in ('verified', 'ready', 'connected', 'misconfigured'))
    or (v_action = 'disconnect'  and v_role = 'primary'
        and v_status in ('verified', 'ready', 'connected', 'misconfigured'))
  ) then
    return jsonb_build_object('outcome', 'action_not_applicable', 'status', v_status);
  end if;

  -- Serialised by the row locks above: a store has at most one open group,
  -- and every challenge is for it.
  select count(*) into v_recent
    from public.store_domain_challenges c
   where c.store_slug = p_store_slug
     and c.created_at > now() - interval '1 hour';
  if v_recent >= 5 then
    return jsonb_build_object('outcome', 'rate_limited');
  end if;

  insert into public.store_domain_challenges
    (store_slug, group_id, action, target_hostname, code_hash, expires_at)
  values
    (p_store_slug, p_group_id, v_action, v_target, p_code_hash, v_expires)
  returning id into v_id;

  perform public.store_domain_log(p_group_id, p_store_slug, 'challenge_created', 'merchant',
    jsonb_build_object('action', v_action, 'target_hostname', v_target, 'challenge_id', v_id));
  return jsonb_build_object('outcome', 'created', 'challenge_id', v_id, 'expires_at', v_expires);
end
$fn$;

-- 6.7 ready -> connected. Requires, in this order, so a refusal never spends
--     the merchant's code:
--       * status 'ready' and every hostname still 'configured';
--       * p_proved_token: the group's TXT token as the server has JUST read it
--         from DNS. PR-C must re-check TXT immediately before this call; the
--         record need not stay published after connection;
--       * a valid 'activate' challenge for the primary hostname, consumed in
--         the same transaction.
create or replace function public.domain_activate(
  p_group_id     uuid,
  p_store_slug   text,
  p_proved_token text,
  p_challenge_id uuid,
  p_code_hash    text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_status  text;
  v_primary text;
  v_token   text;
  v_check   text;
  v_states  jsonb;
begin
  perform 1 from public.store_domains d
   where d.group_id = p_group_id and d.store_slug = p_store_slug
   order by d.kind
     for update;
  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;

  if public.store_domain_expire_if_stale(p_group_id) is not null then
    return jsonb_build_object('outcome', 'expired', 'group_id', p_group_id,
      'status', (select d.status from public.store_domains d
                  where d.group_id = p_group_id and d.role = 'primary'));
  end if;

  select d.status, d.hostname, d.txt_token into v_status, v_primary, v_token
    from public.store_domains d
   where d.group_id = p_group_id and d.role = 'primary';

  if v_status <> 'ready' then
    return jsonb_build_object(
      'outcome', case when v_status = 'connected' then 'already_connected' else 'not_ready' end,
      'status', v_status);
  end if;

  -- store_domains_ready_is_configured already guarantees this; re-checked
  -- here so the gate reads in one place.
  if exists (select 1 from public.store_domains d
              where d.group_id = p_group_id and d.vercel_state <> 'configured') then
    select jsonb_object_agg(d.hostname, d.vercel_state) into v_states
      from public.store_domains d where d.group_id = p_group_id;
    return jsonb_build_object('outcome', 'vercel_not_ready', 'vercel', v_states);
  end if;

  if p_proved_token is null or p_proved_token <> v_token then
    perform public.store_domain_log(p_group_id, p_store_slug, 'activate_token_mismatch', 'system', '{}'::jsonb);
    return jsonb_build_object('outcome', 'token_mismatch');
  end if;

  v_check := public.store_domain_consume_challenge(
    p_challenge_id, p_store_slug, p_group_id, 'activate', v_primary, p_code_hash);
  if v_check <> 'ok' then
    return jsonb_build_object('outcome', v_check);
  end if;

  update public.store_domains d
     set status = 'connected', activated_at = now(), expires_at = null,
         consecutive_health_failures = 0, last_error = null
   where d.group_id = p_group_id;

  perform public.store_domain_log(p_group_id, p_store_slug, 'activated', 'merchant',
    jsonb_build_object('primary_host', v_primary));
  return jsonb_build_object('outcome', 'connected', 'group_id', p_group_id, 'primary_host', v_primary);
end
$fn$;

-- 6.8 Swap primary and redirect within an apex/www group. Requires a valid
--     'set_primary' challenge naming the hostname that becomes primary. The
--     old primary is demoted first: the per-store unique index never sees two.
create or replace function public.domain_set_primary(
  p_group_id     uuid,
  p_store_slug   text,
  p_hostname     text,
  p_challenge_id uuid,
  p_code_hash    text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_target  text := public.store_domain_normalize(p_hostname);
  v_status  text;
  v_rows    integer;
  v_role    text;
  v_old     text;
  v_check   text;
begin
  perform 1 from public.store_domains d
   where d.group_id = p_group_id and d.store_slug = p_store_slug
   order by d.kind
     for update;
  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;

  if public.store_domain_expire_if_stale(p_group_id) is not null then
    return jsonb_build_object('outcome', 'expired', 'group_id', p_group_id,
      'status', (select d.status from public.store_domains d
                  where d.group_id = p_group_id and d.role = 'primary'));
  end if;

  select max(d.status), count(*), max(d.hostname) filter (where d.role = 'primary')
    into v_status, v_rows, v_old
    from public.store_domains d where d.group_id = p_group_id;

  if v_status not in ('verified', 'ready', 'connected', 'misconfigured') then
    return jsonb_build_object('outcome', 'not_active', 'status', v_status);
  end if;
  if v_rows <> 2 then
    return jsonb_build_object('outcome', 'not_apex_group');
  end if;

  select d.role into v_role
    from public.store_domains d
   where d.group_id = p_group_id and d.hostname = v_target;
  if not found then
    return jsonb_build_object('outcome', 'target_not_in_group');
  end if;
  if v_role = 'primary' then
    return jsonb_build_object('outcome', 'already_primary', 'primary_host', v_target);
  end if;

  v_check := public.store_domain_consume_challenge(
    p_challenge_id, p_store_slug, p_group_id, 'set_primary', v_target, p_code_hash);
  if v_check <> 'ok' then
    return jsonb_build_object('outcome', v_check);
  end if;

  update public.store_domains d set role = 'redirect'
   where d.group_id = p_group_id and d.role = 'primary';
  update public.store_domains d set role = 'primary'
   where d.group_id = p_group_id and d.hostname = v_target;

  perform public.store_domain_log(p_group_id, p_store_slug, 'primary_changed', 'merchant',
    jsonb_build_object('from', v_old, 'to', v_target));
  return jsonb_build_object('outcome', 'ok', 'group_id', p_group_id, 'primary_host', v_target);
end
$fn$;

-- 6.9 Begin a disconnect.
--       pending                          -> disconnected at once. Cancelling
--                                           an unproven claim needs no code:
--                                           it holds nothing.
--       verified/ready/connected/
--       misconfigured                    -> a merchant needs a valid
--                                           'disconnect' challenge; admin and
--                                           system do not.
--                                           If Vercel holds nothing for the
--                                           group and any removal has settled
--                                           (store_domain_vercel_clear):
--                                           disconnected at once.
--                                           Otherwise: disconnecting, and the
--                                           names stay exclusive until PR-C
--                                           has removed them from Vercel and
--                                           called domain_finish_disconnect.
create or replace function public.domain_begin_disconnect(
  p_group_id     uuid,
  p_store_slug   text,
  p_actor        text,
  p_challenge_id uuid default null,
  p_code_hash    text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_actor   text := lower(btrim(coalesce(p_actor, '')));
  v_status  text;
  v_primary text;
  v_check   text;
  v_pending jsonb;
begin
  if v_actor not in ('merchant', 'admin', 'system') then
    return jsonb_build_object('outcome', 'invalid_actor');
  end if;

  perform 1 from public.store_domains d
   where d.group_id = p_group_id and d.store_slug = p_store_slug
   order by d.kind
     for update;
  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;

  if public.store_domain_expire_if_stale(p_group_id) is not null then
    return jsonb_build_object('outcome', 'expired', 'group_id', p_group_id,
      'status', (select d.status from public.store_domains d
                  where d.group_id = p_group_id and d.role = 'primary'));
  end if;

  select d.status, d.hostname into v_status, v_primary
    from public.store_domains d
   where d.group_id = p_group_id and d.role = 'primary';

  if v_status = 'pending' then
    update public.store_domains d
       set status = 'disconnected', end_reason = v_actor, ended_at = now()
     where d.group_id = p_group_id;
    perform public.store_domain_log(p_group_id, p_store_slug, 'disconnected', v_actor,
      jsonb_build_object('from', 'pending'));
    return jsonb_build_object('outcome', 'disconnected', 'group_id', p_group_id);
  end if;

  if v_status = 'disconnecting' then
    return jsonb_build_object('outcome', 'already_disconnecting', 'group_id', p_group_id);
  end if;
  if v_status not in ('verified', 'ready', 'connected', 'misconfigured') then
    return jsonb_build_object('outcome', 'not_active', 'status', v_status);
  end if;

  if v_actor = 'merchant' then
    v_check := public.store_domain_consume_challenge(
      p_challenge_id, p_store_slug, p_group_id, 'disconnect', v_primary, p_code_hash);
    if v_check <> 'ok' then
      return jsonb_build_object('outcome', v_check);
    end if;
  end if;

  if public.store_domain_vercel_clear(p_group_id) then
    update public.store_domains d
       set status = 'disconnected', end_reason = v_actor, ended_at = now()
     where d.group_id = p_group_id;
    perform public.store_domain_log(p_group_id, p_store_slug, 'disconnected', v_actor,
      jsonb_build_object('from', v_status));
    return jsonb_build_object('outcome', 'disconnected', 'group_id', p_group_id);
  end if;

  update public.store_domains d
     set status = 'disconnecting', end_reason = v_actor, expires_at = null
   where d.group_id = p_group_id;

  select jsonb_object_agg(d.hostname, d.vercel_state) into v_pending
    from public.store_domains d
   where d.group_id = p_group_id and d.vercel_state not in ('none', 'removed');

  perform public.store_domain_log(p_group_id, p_store_slug, 'disconnect_started', v_actor,
    jsonb_build_object('from', v_status, 'vercel', v_pending));
  return jsonb_build_object('outcome', 'disconnecting', 'group_id', p_group_id, 'vercel', v_pending);
end
$fn$;

-- 6.10 End a 'disconnecting' group once Vercel holds none of its names and
--      the last change has settled (2 minutes). The cause decides the end:
--      a requested disconnect (merchant / admin / system) -> 'disconnected';
--      a TTL cleanup (verify_ttl / misconfigured_ttl)     -> 'expired'.
--      Only now do the names leave the ownership index.
create or replace function public.domain_finish_disconnect(
  p_group_id   uuid,
  p_store_slug text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_status  text;
  v_reason  text;
  v_end     text;
  v_pending jsonb;
  v_wait    integer;
begin
  perform 1 from public.store_domains d
   where d.group_id = p_group_id and d.store_slug = p_store_slug
   order by d.kind
     for update;
  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;

  select d.status, d.end_reason into v_status, v_reason
    from public.store_domains d
   where d.group_id = p_group_id and d.role = 'primary';

  if v_status <> 'disconnecting' then
    return jsonb_build_object(
      'outcome', case when v_status in ('disconnected', 'expired') then 'already_ended'
                      else 'not_disconnecting' end,
      'status', v_status);
  end if;

  select jsonb_object_agg(d.hostname, d.vercel_state) into v_pending
    from public.store_domains d
   where d.group_id = p_group_id and d.vercel_state not in ('none', 'removed');
  if v_pending is not null then
    return jsonb_build_object('outcome', 'vercel_not_removed', 'vercel', v_pending);
  end if;

  if not public.store_domain_vercel_clear(p_group_id) then
    select ceil(extract(epoch from max(d.vercel_state_at) + interval '2 minutes' - now()))::integer
      into v_wait
      from public.store_domains d where d.group_id = p_group_id;
    return jsonb_build_object('outcome', 'vercel_settling', 'retry_after_seconds', greatest(v_wait, 1));
  end if;

  v_end := case when v_reason in ('verify_ttl', 'misconfigured_ttl') then 'expired' else 'disconnected' end;

  update public.store_domains d
     set status = v_end, ended_at = now()
   where d.group_id = p_group_id;

  perform public.store_domain_log(p_group_id, p_store_slug, v_end,
    case when v_end = 'expired' then 'system' else v_reason end,
    jsonb_build_object('from', 'disconnecting', 'reason', v_reason));
  return jsonb_build_object('outcome', v_end, 'group_id', p_group_id, 'reason', v_reason);
end
$fn$;

-- 6.11 TTL sweep: pending after 72h, verified/ready 7 days after
--      verification, misconfigured after 30 days. Each stale group either
--      ends ('expired') or, if Vercel may still hold a name, moves to
--      'disconnecting' for cleanup; the result says which, and what Vercel
--      holds, for the reconciler. Every RPC that meets a stale group applies
--      the same rule on the spot, so nothing depends on the sweep running.
create or replace function public.domain_expire_stale(p_limit integer default 200)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_g      record;
  v_reason text;
  v_n      integer := 0;
  v_out    jsonb := '[]'::jsonb;
begin
  for v_g in
    select d.group_id, d.store_slug
      from public.store_domains d
     where d.role = 'primary'
       and d.status in ('pending', 'verified', 'ready', 'misconfigured')
       and d.expires_at <= now()
     order by d.expires_at
     limit greatest(1, least(coalesce(p_limit, 200), 1000))
  loop
    v_reason := public.store_domain_expire_if_stale(v_g.group_id);
    if v_reason is not null then
      v_n := v_n + 1;
      v_out := v_out || jsonb_build_array(jsonb_build_object(
        'group_id', v_g.group_id, 'store_slug', v_g.store_slug, 'reason', v_reason,
        'status', (select d.status from public.store_domains d
                    where d.group_id = v_g.group_id and d.role = 'primary'),
        'vercel', (select jsonb_object_agg(d.hostname, d.vercel_state)
                     from public.store_domains d where d.group_id = v_g.group_id)));
    end if;
  end loop;
  return jsonb_build_object('outcome', 'ok', 'expired', v_n, 'groups', v_out);
end
$fn$;

-- 6.12 Record one health check of a connected group. One success resets the
--      count (and restores a misconfigured group); the second consecutive
--      failure marks it misconfigured with the 30-day release clock. The
--      hourly cadence belongs to the PR-C scheduler; this only counts.
create or replace function public.domain_health_update(
  p_group_id   uuid,
  p_store_slug text,
  p_ok         boolean,
  p_error      text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_status text;
  v_fail   integer;
  v_next   text;
begin
  if p_ok is null then
    return jsonb_build_object('outcome', 'invalid_result');
  end if;

  perform 1 from public.store_domains d
   where d.group_id = p_group_id and d.store_slug = p_store_slug
   order by d.kind
     for update;
  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;

  if public.store_domain_expire_if_stale(p_group_id) is not null then
    return jsonb_build_object('outcome', 'expired', 'group_id', p_group_id,
      'status', (select d.status from public.store_domains d
                  where d.group_id = p_group_id and d.role = 'primary'));
  end if;

  select d.status, d.consecutive_health_failures into v_status, v_fail
    from public.store_domains d
   where d.group_id = p_group_id and d.role = 'primary';

  if v_status not in ('connected', 'misconfigured') then
    return jsonb_build_object('outcome', 'not_connected', 'status', v_status);
  end if;

  if p_ok then
    -- A healthy verdict must agree with what Vercel last reported: every name
    -- 'configured'. This is also the gate for a misconfigured group to route
    -- again, the same one activation had to pass.
    if exists (select 1 from public.store_domains d
                where d.group_id = p_group_id and d.vercel_state <> 'configured') then
      return jsonb_build_object('outcome', 'vercel_not_configured',
        'vercel', (select jsonb_object_agg(d.hostname, d.vercel_state)
                     from public.store_domains d where d.group_id = p_group_id));
    end if;
    update public.store_domains d
       set status = 'connected', expires_at = null, consecutive_health_failures = 0,
           last_checked_at = now(), last_error = null
     where d.group_id = p_group_id;
    if v_status = 'misconfigured' then
      perform public.store_domain_log(p_group_id, p_store_slug, 'health_recovered', 'system', '{}'::jsonb);
    end if;
    return jsonb_build_object('outcome', 'connected', 'failures', 0);
  end if;

  v_fail := v_fail + 1;
  v_next := case when v_status = 'connected' and v_fail >= 2 then 'misconfigured' else v_status end;

  update public.store_domains d
     set status = v_next,
         expires_at = case when v_next = 'misconfigured' and v_status = 'connected'
                           then now() + interval '30 days' else d.expires_at end,
         consecutive_health_failures = v_fail,
         last_checked_at = now(),
         last_error = left(nullif(btrim(coalesce(p_error, '')), ''), 500)
   where d.group_id = p_group_id;

  perform public.store_domain_log(p_group_id, p_store_slug,
    case when v_next <> v_status then 'misconfigured' else 'health_failed' end, 'system',
    jsonb_build_object('failures', v_fail));
  return jsonb_build_object('outcome', v_next, 'failures', v_fail);
end
$fn$;

-- 6.13 Let the server record an external step (a Vercel call, a DNS lookup)
--      in the same audit trail. Cannot forge a lifecycle event the RPCs
--      write themselves, and refuses a detail that contains the group's TXT
--      token or any of its code hashes.
create or replace function public.domain_event_append(
  p_group_id   uuid,
  p_store_slug text,
  p_event      text,
  p_actor      text,
  p_detail     jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_event  text := lower(btrim(coalesce(p_event, '')));
  v_actor  text := lower(btrim(coalesce(p_actor, '')));
  v_detail jsonb := coalesce(p_detail, '{}'::jsonb);
  v_token  text;
begin
  if v_event !~ '^[a-z][a-z0-9_]{2,47}$' then
    return jsonb_build_object('outcome', 'invalid_event');
  end if;
  if v_event in ('claimed', 'verified', 'lost_race', 'verify_token_mismatch', 'verify_deferred',
                 'vercel_intent', 'vercel_observed', 'ready', 'ready_revoked',
                 'challenge_created', 'challenge_consumed', 'challenge_failed',
                 'activated', 'activate_token_mismatch', 'primary_changed',
                 'disconnect_started', 'disconnected', 'expiry_cleanup_started', 'expired',
                 'health_failed', 'misconfigured', 'health_recovered') then
    return jsonb_build_object('outcome', 'reserved_event');
  end if;
  if v_actor not in ('merchant', 'admin', 'system') then
    return jsonb_build_object('outcome', 'invalid_actor');
  end if;
  if jsonb_typeof(v_detail) <> 'object' then
    return jsonb_build_object('outcome', 'invalid_detail');
  end if;
  if octet_length(v_detail::text) > 2000 then
    return jsonb_build_object('outcome', 'detail_too_large');
  end if;

  select d.txt_token into v_token
    from public.store_domains d
   where d.group_id = p_group_id and d.store_slug = p_store_slug
   limit 1;
  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;

  if position(v_token in v_detail::text) > 0
     or exists (select 1 from public.store_domain_challenges c
                 where c.group_id = p_group_id
                   and position(c.code_hash in v_detail::text) > 0) then
    return jsonb_build_object('outcome', 'detail_contains_secret');
  end if;

  perform public.store_domain_log(p_group_id, p_store_slug, v_event, v_actor, v_detail);
  return jsonb_build_object('outcome', 'ok');
end
$fn$;

-- ---------------------------------------------------------------------------
-- 7. Access
-- ---------------------------------------------------------------------------
-- Tables: two locks, as plan_entitlements. RLS on with ZERO policies, and
-- every privilege revoked from the browser roles and PUBLIC. service_role is
-- revoked first too (the schema default hands it everything) and granted back
-- only SELECT on the two tables PR-C must read. Nobody but the table owner --
-- that is, the RPCs above -- can write any of them, and nobody at all can read
-- the challenges.
alter table public.store_domains           enable row level security;
alter table public.store_domain_challenges enable row level security;
alter table public.store_domain_events     enable row level security;

revoke all on public.store_domains           from public, anon, authenticated, service_role;
revoke all on public.store_domain_challenges from public, anon, authenticated, service_role;
revoke all on public.store_domain_events     from public, anon, authenticated, service_role;
revoke all on sequence public.store_domain_events_id_seq
  from public, anon, authenticated, service_role;

grant select on public.store_domains       to service_role;
grant select on public.store_domain_events to service_role;

-- Functions. PUBLIC holds EXECUTE on every new function by default and the
-- schema default adds anon, authenticated and service_role, so every function
-- starts from nothing and is granted exactly what it needs.

-- Public routing answers: anon (render.js, the storefront) and authenticated
-- (the same storefront with a signed-in session carries that role; withholding
-- it would hide nothing that anon cannot already ask).
revoke all on function public.resolve_store_host(text) from public, anon, authenticated, service_role;
revoke all on function public.store_primary_host(text) from public, anon, authenticated, service_role;
grant execute on function public.resolve_store_host(text) to anon, authenticated, service_role;
grant execute on function public.store_primary_host(text) to anon, authenticated, service_role;

-- Server RPCs: service_role only.
revoke all on function public.domain_claim(text, text, text)                        from public, anon, authenticated;
revoke all on function public.domain_mark_verified(uuid, text, text)                from public, anon, authenticated;
revoke all on function public.domain_vercel_intent(uuid, text, text, text)          from public, anon, authenticated;
revoke all on function public.domain_vercel_observe(uuid, text, text, boolean, boolean, boolean, text)
  from public, anon, authenticated;
revoke all on function public.domain_mark_ready(uuid, text)                         from public, anon, authenticated;
revoke all on function public.domain_challenge_create(text, uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.domain_activate(uuid, text, text, uuid, text)         from public, anon, authenticated;
revoke all on function public.domain_set_primary(uuid, text, text, uuid, text)      from public, anon, authenticated;
revoke all on function public.domain_begin_disconnect(uuid, text, text, uuid, text) from public, anon, authenticated;
revoke all on function public.domain_finish_disconnect(uuid, text)                  from public, anon, authenticated;
revoke all on function public.domain_expire_stale(integer)                          from public, anon, authenticated;
revoke all on function public.domain_health_update(uuid, text, boolean, text)       from public, anon, authenticated;
revoke all on function public.domain_event_append(uuid, text, text, text, jsonb)    from public, anon, authenticated;

grant execute on function public.domain_claim(text, text, text)                        to service_role;
grant execute on function public.domain_mark_verified(uuid, text, text)                to service_role;
grant execute on function public.domain_vercel_intent(uuid, text, text, text)          to service_role;
grant execute on function public.domain_vercel_observe(uuid, text, text, boolean, boolean, boolean, text)
  to service_role;
grant execute on function public.domain_mark_ready(uuid, text)                         to service_role;
grant execute on function public.domain_challenge_create(text, uuid, text, text, text) to service_role;
grant execute on function public.domain_activate(uuid, text, text, uuid, text)         to service_role;
grant execute on function public.domain_set_primary(uuid, text, text, uuid, text)      to service_role;
grant execute on function public.domain_begin_disconnect(uuid, text, text, uuid, text) to service_role;
grant execute on function public.domain_finish_disconnect(uuid, text)                  to service_role;
grant execute on function public.domain_expire_stale(integer)                          to service_role;
grant execute on function public.domain_health_update(uuid, text, boolean, text)       to service_role;
grant execute on function public.domain_event_append(uuid, text, text, text, jsonb)    to service_role;

-- Internal helpers and trigger functions: nobody. The RPCs run as the owner,
-- and a trigger fires regardless of EXECUTE.
revoke all on function public.store_domain_normalize(text)                  from public, anon, authenticated, service_role;
revoke all on function public.store_domain_hostname_problem(text)           from public, anon, authenticated, service_role;
revoke all on function public.store_domain_log(uuid, text, text, text, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.store_domain_expire_if_stale(uuid)            from public, anon, authenticated, service_role;
revoke all on function public.store_domain_vercel_clear(uuid)               from public, anon, authenticated, service_role;
revoke all on function public.store_domain_consume_challenge(uuid, text, uuid, text, text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.store_domains_guard_update()                  from public, anon, authenticated, service_role;
revoke all on function public.store_domains_check_group()                   from public, anon, authenticated, service_role;
revoke all on function public.store_domain_events_append_only()             from public, anon, authenticated, service_role;

commit;

-- Next: supabase/custom-domains-verify.sql -- every row PASS.
-- Nothing calls any of this until PR-C.
