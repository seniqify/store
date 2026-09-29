-- ===========================================================================
--  Custom merchant domains -- PR-B.1  --  UNDO
--
--  Returns the database to exactly the reviewed PR-B state:
--    * drops domain_reconcile_lease, the three constant helpers and the
--      store_domain_reconcile table;
--    * drops the 5-argument domain_health_update;
--    * RECREATES PR-B's 4-argument domain_health_update, verbatim (copied from
--      supabase/custom-domains-forward.sql at the reviewed head 27535a4), with
--      exactly its grants.
--  store_domains, store_domain_challenges, store_domain_events and every other
--  PR-B object are not touched.
--
--  ONLY AFTER the PR-C code that calls domain_reconcile_lease or the 5-argument
--  domain_health_update has been reverted: dropping them under running code
--  makes every reconciler pass fail (safely -- it fails closed, changing
--  nothing -- but it stops cleanup and health checks).
--
--  Refuses while any lease is still running (a worker may be mid-pass); wait
--  two minutes and re-run.
--
--  RUN: Supabase SQL Editor, paste all, Run. One transaction; idempotent.
-- ===========================================================================

begin;

set local lock_timeout = '5s';

do $preflight$
declare
  v_live integer := 0;
begin
  if to_regclass('public.store_domain_reconcile') is not null then
    execute 'select count(*) from public.store_domain_reconcile where lease_until > now()' into v_live;
    if v_live > 0 then
      raise exception 'refusing to run: % reconciler lease(s) still running; wait two minutes and re-run', v_live;
    end if;
  end if;
end
$preflight$;

drop function if exists public.domain_reconcile_lease(integer);
drop function if exists public.domain_health_update(uuid, text, uuid, boolean, text);
drop table if exists public.store_domain_reconcile;
drop function if exists public.store_domain_health_interval();
drop function if exists public.store_domain_lease_seconds();
drop function if exists public.store_domain_lease_batch_max();

-- ---------------------------------------------------------------------------
-- PR-B's domain_health_update, verbatim.
-- ---------------------------------------------------------------------------
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

revoke all on function public.domain_health_update(uuid, text, boolean, text)       from public, anon, authenticated;
grant execute on function public.domain_health_update(uuid, text, boolean, text)       to service_role;

commit;
