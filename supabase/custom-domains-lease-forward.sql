-- ===========================================================================
--  Custom merchant domains -- PR-B.1: RECONCILER LEASES + ORDERED HEALTH
--  PREPARED FOR REVIEW. NOT APPLIED. Requires PR-B (custom-domains-forward.sql).
--
--  WHY
--   The PR-C reconciler needs two things the PR-B schema cannot give it:
--    1. Fair, durable continuation. Without a record of which groups were
--       served last, a pass that runs out of time always restarts from the
--       same place and the groups behind it can wait forever.
--    2. Serialised health results. Two overlapping passes could both judge a
--       group "due", both check it, and count ONE real failure twice; and a
--       slow success could land after a newer failure and erase it.
--
--  WHAT THIS ADDS / CHANGES
--   public.store_domain_reconcile       one row per group: fair-queue position
--                                       (last_reconciled_at), the current lease,
--                                       and the one health-check token in force.
--                                       store_domains itself is NOT altered.
--   public.domain_reconcile_lease(int)  lease up to 5 whole groups, fairly.
--   public.domain_health_update(uuid, text, uuid, boolean, text)
--                                       REPLACES PR-B's 4-argument version: a
--                                       result is accepted only with the token
--                                       its lease issued, and only once.
--   3 helper functions holding the ONE health interval (1 hour), the ONE lease
--   length (120 s) and the lease batch cap (5).
--
--  THE RULES
--   * WHOLE GROUPS. A lease locks EVERY row of a group, in the kind order the
--     domain RPCs use (apex, subdomain, www), with NOWAIT inside a
--     subtransaction: all rows are locked, or the subtransaction is rolled
--     back -- releasing whatever it had locked -- and the whole group is
--     skipped. No wait means no deadlock; no partial group is ever leased.
--   * NO OVERLAP. Eligibility is re-checked under those locks, and the lease is
--     written before they are released; a second worker either fails NOWAIT or
--     sees an unexpired lease. Overlapping workers get disjoint groups.
--   * BOUNDED. At most 5 groups per call (the worker asks for 1). The lease is
--     a fixed 120 s -- twice the 60 s maxDuration after which Vercel kills the
--     function -- so a lease can never expire under a worker that can still
--     run. Neither bound is a caller's choice.
--   * FAIR. One queue for ALL work (cleanup, health, sync), ordered by
--     last_reconciled_at, oldest first, never-served first. Every lease stamps
--     now() on the group, so it goes to the back. With N eligible groups and
--     at least one group served per pass, every group is served within N
--     passes -- including one whose worker crashed or timed out: its stamp
--     stands, its lease expires after 120 s, and it is served again in turn.
--   * ONLY REAL WORK. A connected / misconfigured group is eligible only when
--     its health check is due (last_checked_at older than the 1-hour
--     interval). No clock in any index predicate.
--   * ORDERED HEALTH RESULTS. A lease of a due group issues a fresh
--     health_token (and replaces any older one). domain_health_update accepts
--     a result only with the CURRENT token, consumes it, and refuses a token
--     older than one lease. So: at most one counted result per authorised
--     check; a delayed result from an older check is 'stale_check' and can
--     never overwrite a newer one; and since a token is only issued when a
--     check is due, at most one result counts per hour.
--
--  WHAT THIS DOES NOT DO
--   Nothing calls these until the PR-C code that uses them is deployed.
--   No PR-B table, trigger, index or other function is changed. Browser roles
--   get nothing; service_role gets EXECUTE on the two RPCs only.
--
--  ORDER: custom-domains-lease-verify.sql (save) -> this file -> verify again.
--  UNDO:  custom-domains-lease-ROLLBACK.sql (restores PR-B's exact
--         domain_health_update).
--  RUN:   Supabase SQL Editor, paste all, Run. One transaction; re-runnable.
-- ===========================================================================

begin;

set local lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 0. Preflight
-- ---------------------------------------------------------------------------
do $preflight$
declare
  v_md5 text;
begin
  if to_regclass('public.store_domains') is null then
    raise exception 'refusing to run: PR-B (custom-domains-forward.sql) is not installed';
  end if;

  if to_regclass('public.store_domain_reconcile') is null then
    -- First run: none of our names may exist, and the function being replaced
    -- must be EXACTLY the reviewed PR-B one -- the rollback restores that text.
    if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'public'
                  and p.proname in ('domain_reconcile_lease', 'store_domain_health_interval',
                                    'store_domain_lease_seconds', 'store_domain_lease_batch_max')) then
      raise exception 'refusing to run: a PR-B.1 function name already exists';
    end if;
    if to_regprocedure('public.domain_health_update(uuid,text,uuid,boolean,text)') is not null then
      raise exception 'refusing to run: domain_health_update(uuid,text,uuid,boolean,text) already exists';
    end if;
    select md5(replace(p.prosrc, chr(13), '')) into v_md5
      from pg_proc p
     where p.oid = to_regprocedure('public.domain_health_update(uuid,text,boolean,text)');
    if v_md5 is distinct from 'fa0d5fd7ebc53344a90534c9def84d1e' then
      raise exception 'refusing to run: domain_health_update is not the reviewed PR-B definition (md5 %)', coalesce(v_md5, 'missing');
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

-- Twice the 60 s Vercel maxDuration of api/domains/reconcile.js.
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
  health_token       uuid,
  health_token_at    timestamptz,
  updated_at         timestamptz not null default now(),

  constraint store_domain_reconcile_lease_pair
    check ((lease_until is null) = (lease_token is null)),
  constraint store_domain_reconcile_health_pair
    check ((health_token is null) = (health_token_at is null))
);

comment on table public.store_domain_reconcile is
  'Reconciler bookkeeping per custom-domain group: fair-queue position, the current '
  'lease, and the one health-check token in force. Written only by '
  'domain_reconcile_lease and domain_health_update. No role may read or write it directly.';

create index if not exists store_domain_reconcile_fair_idx
  on public.store_domain_reconcile (last_reconciled_at nulls first, group_id);

alter table public.store_domain_reconcile enable row level security;
revoke all on public.store_domain_reconcile from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Lease
-- ---------------------------------------------------------------------------
-- Returns one row per leased group:
--   work          'cleanup' (disconnecting) | 'health' (due check) | 'sync'
--   lease_token   identifies this lease
--   lease_seconds how long it holds (the fixed 120)
--   health_token  for 'health' work only: the token domain_health_update needs
create or replace function public.domain_reconcile_lease(p_limit integer default 1)
returns table (group_id uuid, store_slug text, status text, work text,
               lease_token uuid, lease_seconds integer, health_token uuid)
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
  v_work    text;
  v_lease   uuid;
  v_health  uuid;
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
    select r.lease_until into v_until
      from public.store_domain_reconcile r where r.group_id = v_cand.group_id;

    if (v_until is not null and v_until > now())
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
    v_lease  := pg_catalog.gen_random_uuid();
    v_health := case when v_work = 'health' then pg_catalog.gen_random_uuid() end;

    update public.store_domain_reconcile r
       set last_reconciled_at = now(),
           lease_until        = now() + make_interval(secs => v_secs),
           lease_token        = v_lease,
           health_token       = v_health,
           health_token_at    = case when v_health is null then null else now() end,
           updated_at         = now()
     where r.group_id = v_cand.group_id;

    v_got := v_got + 1;
    group_id := v_cand.group_id; store_slug := v_slug; status := v_status; work := v_work;
    lease_token := v_lease; lease_seconds := v_secs; health_token := v_health;
    return next;
  end loop;
end
$fn$;

-- ---------------------------------------------------------------------------
-- 4. domain_health_update -- replaced (new signature: + p_check_token)
-- ---------------------------------------------------------------------------
-- Identical to PR-B's version except the token rule, applied after the group
-- rows are locked and before anything is written:
--   p_check_token must equal the group's CURRENT health_token, issued by a
--   lease no older than one lease length; it is consumed here. Anything else
--   -> 'stale_check', and nothing changes.
drop function if exists public.domain_health_update(uuid, text, boolean, text);

create or replace function public.domain_health_update(
  p_group_id    uuid,
  p_store_slug  text,
  p_check_token uuid,
  p_ok          boolean,
  p_error       text default null
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
  v_token  uuid;
  v_issued timestamptz;
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

  -- The token, under the reconcile row lock (taken after the group rows: the
  -- same order as domain_reconcile_lease).
  select r.health_token, r.health_token_at into v_token, v_issued
    from public.store_domain_reconcile r
   where r.group_id = p_group_id
     for update;
  if p_check_token is null or v_token is null or v_token <> p_check_token
     or v_issued <= now() - make_interval(secs => public.store_domain_lease_seconds()) then
    return jsonb_build_object('outcome', 'stale_check');
  end if;
  update public.store_domain_reconcile r
     set health_token = null, health_token_at = null, updated_at = now()
   where r.group_id = p_group_id;

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

-- ---------------------------------------------------------------------------
-- 5. Access
-- ---------------------------------------------------------------------------
revoke all on function public.domain_reconcile_lease(integer) from public, anon, authenticated;
grant execute on function public.domain_reconcile_lease(integer) to service_role;

revoke all on function public.domain_health_update(uuid, text, uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.domain_health_update(uuid, text, uuid, boolean, text) to service_role;

revoke all on function public.store_domain_health_interval()  from public, anon, authenticated, service_role;
revoke all on function public.store_domain_lease_seconds()    from public, anon, authenticated, service_role;
revoke all on function public.store_domain_lease_batch_max()  from public, anon, authenticated, service_role;

commit;

-- Next: supabase/custom-domains-lease-verify.sql -- every L row PASS.
