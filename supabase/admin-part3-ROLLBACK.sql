-- ===========================================================================
--  PocketLink Admin part 3  --  ROLLBACK (emergency only)
--
--  Drops part 3 (switches, the sign-up gate, jobs, remove for good) and puts
--  back the part 2 versions of pause / delete and the edge-function log
--  writer. Shops already removed for good stay removed (their content is
--  gone); the audit log keeps every entry. Scheduled jobs keep whatever
--  paused / running state they had. Generated from admin-part2-forward.sql.
-- ===========================================================================
begin;

drop trigger if exists stores_signup_gate on public.stores;
drop function if exists public.stores_signup_gate();
drop function if exists public.admin_switch_set(text, boolean, text, text);
drop function if exists public.admin_switches();
drop function if exists public.platform_flags();
drop function if exists public.admin_jobs();
drop function if exists public.admin_job_run(bigint, text);
drop function if exists public.admin_job_pause(bigint, boolean, text);
drop function if exists public.admin_purge_list();
drop function if exists public.admin_purge_store(text, text, text);
drop table if exists public.platform_settings;

create or replace function public.admin_set_status(p_slug text, p_status text, p_reason text, p_confirm text default null)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_s record;
  v_new text := nullif(p_status, 'open');
begin
  if p_status not in ('open', 'paused', 'deleted') then
    raise exception 'bad status' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'write a reason' using errcode = '22023';
  end if;
  select s.config, s.admin_status into v_s from public.stores s where s.slug = p_slug for update;
  if not found then
    raise exception 'store not found' using errcode = 'P0002';
  end if;
  if p_status = 'deleted' or v_s.admin_status = 'deleted' then
    perform public.admin_require('delete');
  else
    perform public.admin_require('pause');
  end if;
  if p_status = 'deleted' then
    if p_confirm is distinct from p_slug then
      raise exception 'type the shop link to confirm' using errcode = '22023';
    end if;
    -- auto-pay on = razorpaySubscriptionId set and not stopped here (admin_autopay_on)
    if public.admin_autopay_on(v_s.config)
       and coalesce(v_s.config->>'planExpiresAt', '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
       and (v_s.config->>'planExpiresAt')::timestamptz > now() then
      raise exception 'this shop still pays by auto-pay: stop the Razorpay subscription first' using errcode = 'P0001';
    end if;
  end if;
  if v_s.admin_status is not distinct from v_new then
    return coalesce(v_new, 'open');
  end if;
  update public.stores set admin_status = v_new, admin_status_at = now() where slug = p_slug;
  perform public.admin_log(coalesce(v_new, 'open'), 'store', p_slug,
                           jsonb_build_object('status', coalesce(v_s.admin_status, 'open')),
                           jsonb_build_object('status', coalesce(v_new, 'open')), p_reason);
  return coalesce(v_new, 'open');
end;
$fn$;

create or replace function public.admin_note(p_need text, p_action text, p_kind text, p_target text, p_after jsonb, p_reason text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  perform public.admin_require(p_need);
  if p_action not in ('refund', 'password', 'reset_2step', 'person_added') then
    raise exception 'unknown action' using errcode = '22023';
  end if;
  perform public.admin_log(p_action, p_kind, p_target, null, p_after, p_reason);
end;
$fn$;

revoke all on function public.admin_set_status(text, text, text, text) from public, anon;
revoke all on function public.admin_note(text, text, text, text, jsonb, text) from public, anon;
grant execute on function public.admin_set_status(text, text, text, text) to authenticated;
grant execute on function public.admin_note(text, text, text, text, jsonb, text) to authenticated;

commit;
