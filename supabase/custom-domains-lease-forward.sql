-- ===========================================================================
--  Custom merchant domains -- PR-B.1: GROUP LEASES (one writer per group)
--  PREPARED FOR REVIEW. NOT APPLIED. Requires PR-B (custom-domains-forward.sql).
--
--  WHY
--   PR-B records what Vercel reported, but not WHO may report it. Two
--   executions working on one group -- a merchant request and the
--   reconciler, or two reconciler passes -- can each read Vercel, and the
--   slower one's older answer can overwrite the newer one. Reproduced in
--   review: a merchant activation reads "absent" and its answer is delayed;
--   the reconciler attaches the name and records 'configured'; the delayed
--   "absent" then lands as 'removed'. Once the 2-minute release fence has
--   passed, a TTL frees a name Vercel still serves.
--   The reconciler also needs fair, durable continuation (a pass that runs
--   out of time must not always restart in the same place), and health
--   results that count once and never out of order.
--
--  THE RULE: ONE LEASE PER GROUP
--   Every execution that calls Vercel for a group, or records anything Vercel
--   said about it, holds the group's lease: the reconciler (fairly, one group
--   at a time) and every merchant request that does Vercel work. The database
--   ENFORCES it: service_role can no longer call the seven PR-B functions
--   that authorise a Vercel call or record / derive Vercel state. It calls a
--   gateway instead, which, in ONE transaction and under the group's row
--   locks, refuses unless the caller holds the group's CURRENT, UNEXPIRED
--   lease -- then runs the PR-B function unchanged. So a stale execution
--   (lease released, lapsed or replaced) cannot write anything, and nothing
--   can take the lease between the check and the write.
--
--  WHAT THIS ADDS
--   public.store_domain_reconcile         one row per group: the lease, the
--                                         reconciler's fair-queue position, and
--                                         whether this lease's health check is
--                                         still outstanding. store_domains is
--                                         NOT altered.
--   public.domain_reconcile_lease(int)    reconciler: lease up to 5 whole groups
--                                         fairly (service_role)
--   public.domain_group_lease(uuid, text) merchant request: lease its group, or
--                                         'busy' (service_role)
--   public.domain_group_lease_release(uuid, text, uuid)
--                                         give a lease back when done
--   seven gateways, public.domain_leased_*, each taking the lease token first:
--     domain_leased_vercel_intent       -> domain_vercel_intent
--     domain_leased_vercel_observe      -> domain_vercel_observe
--     domain_leased_mark_ready          -> domain_mark_ready
--     domain_leased_activate            -> domain_activate
--     domain_leased_begin_disconnect    -> domain_begin_disconnect
--     domain_leased_finish_disconnect   -> domain_finish_disconnect
--     domain_leased_health_update       -> domain_health_update
--   one internal check (store_domain_lease_refusal) and three constants: the
--   ONE health interval (1 hour), the ONE lease length (120 s), the lease
--   batch cap (5).
--
--  WHAT THIS CHANGES IN PR-B
--   Only EXECUTE: service_role loses it on the seven wrapped functions above
--   (it keeps it on the other six server RPCs). No PR-B function, table,
--   trigger, index or constraint is replaced or altered: the preflight
--   refuses unless all seven wrapped functions are EXACTLY the reviewed PR-B
--   source, and the rollback only re-grants EXECUTE and drops what this adds.
--   Consequence for PR-B's verifier (custom-domains-verify.sql) after this:
--   V10 lists these seven functions -- expected; every other row unchanged.
--
--  THE LEASE
--   * WHOLE GROUPS. A lease locks EVERY row of the group, in the kind order
--     every domain RPC uses (apex, subdomain, www), then the lease row.
--     The reconciler uses NOWAIT inside a subtransaction: all rows, or the
--     subtransaction is rolled back -- releasing whatever it had locked -- and
--     the whole group is skipped. A merchant request waits for the locks (all
--     holders keep them for one short transaction), then gets the lease or
--     'busy'. One lock order everywhere: no deadlock.
--   * ONE HOLDER. A lease is 120 s from when it is granted, or until its
--     holder releases it. While it is live, no other lease is granted.
--   * BOUNDED. 120 s is twice the 60 s maxDuration after which Vercel kills
--     either function, so a lease cannot expire under an execution that can
--     still run; the reconciler also stops 30 s before its lease ends. At
--     most 5 groups per reconciler call (it asks for 1). Neither bound is a
--     caller's choice.
--   * FAIR. The reconciler serves ONE queue for all work (cleanup, health,
--     sync), least-recently-served first, never-served first. Each reconciler
--     lease stamps now(), sending the group to the back, and the reconciler
--     does not take the same group again for one lease length even after
--     releasing it. With N eligible groups each is served within N passes,
--     including one whose worker crashed (its lease lapses after 120 s).
--     Merchant leases do not move a group in this queue.
--   * ONLY REAL WORK. A connected / misconfigured group is eligible for the
--     reconciler only when its health check is due (last_checked_at older
--     than the 1-hour interval). No clock in any index predicate.
--   * HEALTH, ONCE AND IN ORDER. A reconciler lease of a due group marks its
--     health check outstanding. domain_leased_health_update counts a result
--     only under that lease, and only once. A result from an older lease is
--     'lease_lost': it can never overwrite a newer one.
--
--  WHAT THIS DOES NOT DO
--   Nothing calls these until the PR-C code that uses them is deployed.
--   Browser roles get nothing.
--
--  ORDER: custom-domains-lease-verify.sql (save) -> this file -> verify again.
--         Apply BEFORE deploying the PR-C code that calls it.
--  UNDO:  custom-domains-lease-ROLLBACK.sql, only after that code is reverted.
--  RUN:   Supabase SQL Editor, paste all, Run. One transaction; re-runnable.
-- ===========================================================================

begin;

set local lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 0. Preflight
-- ---------------------------------------------------------------------------
do $preflight$
declare
  v_bad text;
begin
  if to_regclass('public.store_domains') is null then
    raise exception 'refusing to run: PR-B (custom-domains-forward.sql) is not installed';
  end if;

  -- The gateways run these PR-B functions unchanged: each must be EXACTLY the
  -- reviewed source (md5 of prosrc, carriage returns stripped).
  select string_agg(w.sig, ', ' order by w.sig) into v_bad
    from (values
      ('public.domain_vercel_intent(uuid,text,text,text)',                        '4c09f0f0b16b80b44bad7311a9985c0c'),
      ('public.domain_vercel_observe(uuid,text,text,boolean,boolean,boolean,text)', '2206a341ea63364ece918b74d88935c3'),
      ('public.domain_mark_ready(uuid,text)',                                     '1870f5a37da7297b05b360865cadb912'),
      ('public.domain_activate(uuid,text,text,uuid,text)',                        '5103a8af7950631f4d30e67ee4ddf437'),
      ('public.domain_begin_disconnect(uuid,text,text,uuid,text)',                'f1fa03f912a53d730c14a056a0d23e63'),
      ('public.domain_finish_disconnect(uuid,text)',                              '0483f8fe1b908f0d3e7e60aff6c2c280'),
      ('public.domain_health_update(uuid,text,boolean,text)',                     'fa0d5fd7ebc53344a90534c9def84d1e')
    ) as w(sig, md5)
    left join pg_proc p on p.oid = to_regprocedure(w.sig)
   where p.oid is null or md5(replace(p.prosrc, chr(13), '')) <> w.md5;
  if v_bad is not null then
    raise exception 'refusing to run: not the reviewed PR-B definition: %', v_bad;
  end if;

  if to_regclass('public.store_domain_reconcile') is null then
    -- First run: none of our names may exist yet, and service_role must hold
    -- EXECUTE on the seven wrapped functions exactly as PR-B granted it --
    -- the rollback restores that grant and nothing else.
    if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'public'
                  and (p.proname like 'domain\_leased\_%'
                       or p.proname in ('domain_reconcile_lease', 'domain_group_lease', 'domain_group_lease_release',
                                        'store_domain_lease_refusal', 'store_domain_health_interval',
                                        'store_domain_lease_seconds', 'store_domain_lease_batch_max'))) then
      raise exception 'refusing to run: a PR-B.1 function name already exists';
    end if;
    select string_agg(w.sig, ', ' order by w.sig) into v_bad
      from (values
        ('public.domain_vercel_intent(uuid,text,text,text)'),
        ('public.domain_vercel_observe(uuid,text,text,boolean,boolean,boolean,text)'),
        ('public.domain_mark_ready(uuid,text)'),
        ('public.domain_activate(uuid,text,text,uuid,text)'),
        ('public.domain_begin_disconnect(uuid,text,text,uuid,text)'),
        ('public.domain_finish_disconnect(uuid,text)'),
        ('public.domain_health_update(uuid,text,boolean,text)')
      ) as w(sig)
     where not has_function_privilege('service_role', to_regprocedure(w.sig), 'EXECUTE');
    if v_bad is not null then
      raise exception 'refusing to run: service_role does not hold PR-B''s EXECUTE on %', v_bad;
    end if;
  end if;
end
$preflight$;

-- ---------------------------------------------------------------------------
-- 1. The constants -- one place each
-- ---------------------------------------------------------------------------
create or replace function public.store_domain_health_interval()
returns interval language sql immutable set search_path = public, pg_temp
as $fn$ select interval '1 hour' $fn$;

-- Twice the 60 s Vercel maxDuration of api/domains/manage.js and reconcile.js.
create or replace function public.store_domain_lease_seconds()
returns integer language sql immutable set search_path = public, pg_temp
as $fn$ select 120 $fn$;

create or replace function public.store_domain_lease_batch_max()
returns integer language sql immutable set search_path = public, pg_temp
as $fn$ select 5 $fn$;

-- ---------------------------------------------------------------------------
-- 2. The lease table (store_domains is not altered)
-- ---------------------------------------------------------------------------
create table if not exists public.store_domain_reconcile (
  group_id           uuid        primary key,
  last_reconciled_at timestamptz,
  lease_until        timestamptz,
  lease_token        uuid,
  lease_holder       text,
  health_pending     boolean     not null default false,
  updated_at         timestamptz not null default now(),

  constraint store_domain_reconcile_lease_whole
    check ((lease_until is null) = (lease_token is null)
           and (lease_token is null) = (lease_holder is null)),
  constraint store_domain_reconcile_lease_holder
    check (lease_holder in ('reconciler', 'merchant')),
  constraint store_domain_reconcile_health_in_lease
    check (not health_pending or lease_holder = 'reconciler')
);

comment on table public.store_domain_reconcile is
  'Per custom-domain group: the ONE lease every Vercel-touching execution must hold '
  '(reconciler or merchant request), the reconciler''s fair-queue position, and whether '
  'the current lease''s health check is outstanding. Written only by the domain lease '
  'functions and gateways. No role may read or write it directly.';

create index if not exists store_domain_reconcile_fair_idx
  on public.store_domain_reconcile (last_reconciled_at nulls first, group_id);

alter table public.store_domain_reconcile enable row level security;
revoke all on public.store_domain_reconcile from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. The lease check (internal)
-- ---------------------------------------------------------------------------
-- NULL when p_lease_token is the group's current, unexpired lease; otherwise
-- the refusal ('not_found' | 'lease_lost'). Locks the group's rows in kind
-- order, then the lease row -- the order every lease function uses -- and the
-- locks are held to the end of the calling transaction: no lease can be
-- released, granted or replaced between this check and the caller's write.
create or replace function public.store_domain_lease_refusal(
  p_group_id    uuid,
  p_store_slug  text,
  p_lease_token uuid
)
returns text
language plpgsql
set search_path = public, pg_temp
as $fn$
declare
  v_token uuid;
  v_until timestamptz;
begin
  perform 1 from public.store_domains d
   where d.group_id = p_group_id and d.store_slug = p_store_slug
   order by d.kind
     for update;
  if not found then
    return 'not_found';
  end if;

  select r.lease_token, r.lease_until into v_token, v_until
    from public.store_domain_reconcile r
   where r.group_id = p_group_id
     for update;
  if p_lease_token is null or v_token is null or v_token <> p_lease_token or v_until <= now() then
    return 'lease_lost';
  end if;
  return null;
end
$fn$;

-- ---------------------------------------------------------------------------
-- 4. Leases
-- ---------------------------------------------------------------------------
-- 4.1 Reconciler. Returns one row per leased group:
--   work          'cleanup' (disconnecting) | 'health' (due check) | 'sync'
--   lease_token   the token every gateway call for this group needs
--   lease_seconds how long it holds unless released (the fixed 120)
create or replace function public.domain_reconcile_lease(p_limit integer default 1)
returns table (group_id uuid, store_slug text, status text, work text,
               lease_token uuid, lease_seconds integer)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_limit   integer := least(greatest(coalesce(p_limit, 1), 1), public.store_domain_lease_batch_max());
  v_secs    integer := public.store_domain_lease_seconds();
  v_got     integer := 0;
  v_cand    record;
  v_status  text;
  v_slug    text;
  v_checked timestamptz;
  v_until   timestamptz;
  v_served  timestamptz;
  v_work    text;
  v_lease   uuid;
begin
  for v_cand in
    select d.group_id
      from public.store_domains d
      left join public.store_domain_reconcile r on r.group_id = d.group_id
     where d.role = 'primary'
       and (d.status in ('verified', 'ready', 'disconnecting')
            or (d.status in ('connected', 'misconfigured')
                and (d.last_checked_at is null
                     or d.last_checked_at <= now() - public.store_domain_health_interval())))
       and (r.lease_until is null or r.lease_until <= now())
       and (r.last_reconciled_at is null or r.last_reconciled_at <= now() - make_interval(secs => v_secs))
     order by r.last_reconciled_at asc nulls first, d.group_id
     limit v_limit * 10              -- bounded scan: locked groups cannot make a call unbounded
  loop
    exit when v_got >= v_limit;

    -- Whole group or nothing. Rows in kind order (the domain RPCs' order),
    -- NOWAIT: on any conflict the subtransaction is rolled back, releasing
    -- every lock it took, and the group is skipped entirely.
    begin
      perform 1 from public.store_domains d
       where d.group_id = v_cand.group_id
       order by d.kind
         for update nowait;
      insert into public.store_domain_reconcile as r (group_id) values (v_cand.group_id)
        on conflict on constraint store_domain_reconcile_pkey do nothing;
      perform 1 from public.store_domain_reconcile r
       where r.group_id = v_cand.group_id
         for update nowait;
    exception
      when lock_not_available then
        continue;
    end;

    -- Eligibility again, now that nothing can change underneath us.
    select d.status, d.store_slug, d.last_checked_at into v_status, v_slug, v_checked
      from public.store_domains d
     where d.group_id = v_cand.group_id and d.role = 'primary';
    select r.lease_until, r.last_reconciled_at into v_until, v_served
      from public.store_domain_reconcile r where r.group_id = v_cand.group_id;

    if (v_until is not null and v_until > now())
       or (v_served is not null and v_served > now() - make_interval(secs => v_secs))
       or not coalesce(v_status in ('verified', 'ready', 'disconnecting')
                       or (v_status in ('connected', 'misconfigured')
                           and (v_checked is null or v_checked <= now() - public.store_domain_health_interval())),
                       false) then
      continue;
    end if;

    v_work := case
                when v_status = 'disconnecting' then 'cleanup'
                when v_status in ('connected', 'misconfigured') then 'health'
                else 'sync'
              end;
    v_lease := pg_catalog.gen_random_uuid();

    update public.store_domain_reconcile r
       set last_reconciled_at = now(),
           lease_until        = now() + make_interval(secs => v_secs),
           lease_token        = v_lease,
           lease_holder       = 'reconciler',
           health_pending     = (v_work = 'health'),
           updated_at         = now()
     where r.group_id = v_cand.group_id;

    v_got := v_got + 1;
    group_id := v_cand.group_id; store_slug := v_slug; status := v_status; work := v_work;
    lease_token := v_lease; lease_seconds := v_secs;
    return next;
  end loop;
end
$fn$;

-- 4.2 Merchant request. Waits for the group's rows (kind order), then the
--     lease row -- every holder keeps them for one short transaction -- and:
--       leased       lease_token, lease_seconds
--       busy         another execution holds the group; retry_after_seconds
--                    is when its lease ends at the latest
--       group_ended  | not_found
--     A merchant lease does not move the group in the reconciler's queue.
create or replace function public.domain_group_lease(
  p_group_id   uuid,
  p_store_slug text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_secs   integer := public.store_domain_lease_seconds();
  v_status text;
  v_until  timestamptz;
  v_lease  uuid;
begin
  perform 1 from public.store_domains d
   where d.group_id = p_group_id and d.store_slug = p_store_slug
   order by d.kind
     for update;
  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;

  select d.status into v_status
    from public.store_domains d
   where d.group_id = p_group_id and d.role = 'primary';
  if v_status in ('disconnected', 'expired') then
    return jsonb_build_object('outcome', 'group_ended', 'status', v_status);
  end if;

  insert into public.store_domain_reconcile as r (group_id) values (p_group_id)
    on conflict on constraint store_domain_reconcile_pkey do nothing;
  select r.lease_until into v_until
    from public.store_domain_reconcile r
   where r.group_id = p_group_id
     for update;

  if v_until is not null and v_until > now() then
    return jsonb_build_object('outcome', 'busy',
      'retry_after_seconds', greatest(ceil(extract(epoch from v_until - now()))::integer, 1));
  end if;

  v_lease := pg_catalog.gen_random_uuid();
  update public.store_domain_reconcile r
     set lease_until    = now() + make_interval(secs => v_secs),
         lease_token    = v_lease,
         lease_holder   = 'merchant',
         health_pending = false,
         updated_at     = now()
   where r.group_id = p_group_id;
  return jsonb_build_object('outcome', 'leased', 'lease_token', v_lease, 'lease_seconds', v_secs);
end
$fn$;

-- 4.3 Give a lease back as soon as the work is done. Only the holder's token
--     releases it; anything else changes nothing ('not_holder'). Takes only
--     the lease row, which no one holds while waiting for a group row: no
--     deadlock. The reconciler's queue position is kept.
create or replace function public.domain_group_lease_release(
  p_group_id    uuid,
  p_store_slug  text,
  p_lease_token uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  if not exists (select 1 from public.store_domains d
                  where d.group_id = p_group_id and d.store_slug = p_store_slug) then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  update public.store_domain_reconcile r
     set lease_until = null, lease_token = null, lease_holder = null,
         health_pending = false, updated_at = now()
   where r.group_id = p_group_id and r.lease_token = p_lease_token;
  if not found then
    return jsonb_build_object('outcome', 'not_holder');
  end if;
  return jsonb_build_object('outcome', 'released');
end
$fn$;

-- ---------------------------------------------------------------------------
-- 5. Gateways: the lease check, then the PR-B function, unchanged, in the
--    same transaction and under the same locks. A refusal returns before the
--    PR-B function runs, so it writes nothing and spends no step-up code.
-- ---------------------------------------------------------------------------
create or replace function public.domain_leased_vercel_intent(
  p_lease_token uuid,
  p_group_id    uuid,
  p_store_slug  text,
  p_hostname    text,
  p_intent      text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_refusal text;
begin
  v_refusal := public.store_domain_lease_refusal(p_group_id, p_store_slug, p_lease_token);
  if v_refusal is not null then
    return jsonb_build_object('outcome', v_refusal);
  end if;
  return public.domain_vercel_intent(p_group_id, p_store_slug, p_hostname, p_intent);
end
$fn$;

create or replace function public.domain_leased_vercel_observe(
  p_lease_token   uuid,
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
  v_refusal text;
begin
  v_refusal := public.store_domain_lease_refusal(p_group_id, p_store_slug, p_lease_token);
  if v_refusal is not null then
    return jsonb_build_object('outcome', v_refusal);
  end if;
  return public.domain_vercel_observe(p_group_id, p_store_slug, p_hostname,
                                      p_attached, p_verified, p_misconfigured, p_error);
end
$fn$;

create or replace function public.domain_leased_mark_ready(
  p_lease_token uuid,
  p_group_id    uuid,
  p_store_slug  text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_refusal text;
begin
  v_refusal := public.store_domain_lease_refusal(p_group_id, p_store_slug, p_lease_token);
  if v_refusal is not null then
    return jsonb_build_object('outcome', v_refusal);
  end if;
  return public.domain_mark_ready(p_group_id, p_store_slug);
end
$fn$;

create or replace function public.domain_leased_activate(
  p_lease_token  uuid,
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
  v_refusal text;
begin
  v_refusal := public.store_domain_lease_refusal(p_group_id, p_store_slug, p_lease_token);
  if v_refusal is not null then
    return jsonb_build_object('outcome', v_refusal);
  end if;
  return public.domain_activate(p_group_id, p_store_slug, p_proved_token, p_challenge_id, p_code_hash);
end
$fn$;

create or replace function public.domain_leased_begin_disconnect(
  p_lease_token  uuid,
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
  v_refusal text;
begin
  v_refusal := public.store_domain_lease_refusal(p_group_id, p_store_slug, p_lease_token);
  if v_refusal is not null then
    return jsonb_build_object('outcome', v_refusal);
  end if;
  return public.domain_begin_disconnect(p_group_id, p_store_slug, p_actor, p_challenge_id, p_code_hash);
end
$fn$;

create or replace function public.domain_leased_finish_disconnect(
  p_lease_token uuid,
  p_group_id    uuid,
  p_store_slug  text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_refusal text;
begin
  v_refusal := public.store_domain_lease_refusal(p_group_id, p_store_slug, p_lease_token);
  if v_refusal is not null then
    return jsonb_build_object('outcome', v_refusal);
  end if;
  return public.domain_finish_disconnect(p_group_id, p_store_slug);
end
$fn$;

-- Health: also requires the lease's check to be outstanding, and consumes it,
-- so one authorised check counts at most once. A result under an older lease
-- is 'lease_lost'; a second result under the same lease is 'stale_check'.
create or replace function public.domain_leased_health_update(
  p_lease_token uuid,
  p_group_id    uuid,
  p_store_slug  text,
  p_ok          boolean,
  p_error       text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_refusal text;
  v_pending boolean;
begin
  if p_ok is null then
    return jsonb_build_object('outcome', 'invalid_result');
  end if;
  v_refusal := public.store_domain_lease_refusal(p_group_id, p_store_slug, p_lease_token);
  if v_refusal is not null then
    return jsonb_build_object('outcome', v_refusal);
  end if;
  select r.health_pending into v_pending
    from public.store_domain_reconcile r where r.group_id = p_group_id;
  if not coalesce(v_pending, false) then
    return jsonb_build_object('outcome', 'stale_check');
  end if;
  update public.store_domain_reconcile r
     set health_pending = false, updated_at = now()
   where r.group_id = p_group_id;
  return public.domain_health_update(p_group_id, p_store_slug, p_ok, p_error);
end
$fn$;

-- ---------------------------------------------------------------------------
-- 6. Access
-- ---------------------------------------------------------------------------
-- The new RPCs: service_role only.
revoke all on function public.domain_reconcile_lease(integer)                                  from public, anon, authenticated;
revoke all on function public.domain_group_lease(uuid, text)                                   from public, anon, authenticated;
revoke all on function public.domain_group_lease_release(uuid, text, uuid)                     from public, anon, authenticated;
revoke all on function public.domain_leased_vercel_intent(uuid, uuid, text, text, text)        from public, anon, authenticated;
revoke all on function public.domain_leased_vercel_observe(uuid, uuid, text, text, boolean, boolean, boolean, text)
  from public, anon, authenticated;
revoke all on function public.domain_leased_mark_ready(uuid, uuid, text)                       from public, anon, authenticated;
revoke all on function public.domain_leased_activate(uuid, uuid, text, text, uuid, text)       from public, anon, authenticated;
revoke all on function public.domain_leased_begin_disconnect(uuid, uuid, text, text, uuid, text) from public, anon, authenticated;
revoke all on function public.domain_leased_finish_disconnect(uuid, uuid, text)                from public, anon, authenticated;
revoke all on function public.domain_leased_health_update(uuid, uuid, text, boolean, text)     from public, anon, authenticated;

grant execute on function public.domain_reconcile_lease(integer)                               to service_role;
grant execute on function public.domain_group_lease(uuid, text)                                to service_role;
grant execute on function public.domain_group_lease_release(uuid, text, uuid)                  to service_role;
grant execute on function public.domain_leased_vercel_intent(uuid, uuid, text, text, text)     to service_role;
grant execute on function public.domain_leased_vercel_observe(uuid, uuid, text, text, boolean, boolean, boolean, text)
  to service_role;
grant execute on function public.domain_leased_mark_ready(uuid, uuid, text)                    to service_role;
grant execute on function public.domain_leased_activate(uuid, uuid, text, text, uuid, text)    to service_role;
grant execute on function public.domain_leased_begin_disconnect(uuid, uuid, text, text, uuid, text) to service_role;
grant execute on function public.domain_leased_finish_disconnect(uuid, uuid, text)             to service_role;
grant execute on function public.domain_leased_health_update(uuid, uuid, text, boolean, text)  to service_role;

-- Internal: callable by nobody (the gateways run as their owner).
revoke all on function public.store_domain_lease_refusal(uuid, text, uuid) from public, anon, authenticated, service_role;
revoke all on function public.store_domain_health_interval()               from public, anon, authenticated, service_role;
revoke all on function public.store_domain_lease_seconds()                 from public, anon, authenticated, service_role;
revoke all on function public.store_domain_lease_batch_max()               from public, anon, authenticated, service_role;

-- The seven wrapped PR-B functions: service_role reaches them ONLY through a
-- gateway from now on. (The rollback grants this back, exactly as PR-B did.)
revoke execute on function public.domain_vercel_intent(uuid, text, text, text)                         from service_role;
revoke execute on function public.domain_vercel_observe(uuid, text, text, boolean, boolean, boolean, text) from service_role;
revoke execute on function public.domain_mark_ready(uuid, text)                                        from service_role;
revoke execute on function public.domain_activate(uuid, text, text, uuid, text)                        from service_role;
revoke execute on function public.domain_begin_disconnect(uuid, text, text, uuid, text)                from service_role;
revoke execute on function public.domain_finish_disconnect(uuid, text)                                 from service_role;
revoke execute on function public.domain_health_update(uuid, text, boolean, text)                      from service_role;

commit;

-- Next: supabase/custom-domains-lease-verify.sql -- L01..L07 must read PASS;
-- L08 and L09 are information (a count, a list), not PASS.
