-- ===========================================================================
--  PocketLink Salary  --  ROLLBACK
--
--  Turns the salary feature off: removes its functions and the incentive
--  guard, and puts admin_can back as it was (no 'salary' rows).
--  The four payroll_* TABLES ARE KEPT, so no salary record, advance or
--  payslip is lost; running salary-forward.sql again brings everything back
--  as it was. To delete the records too (cannot be undone), run the lines
--  at the very end by hand.
-- ===========================================================================

begin;

drop trigger if exists payroll_incentive_guard on public.sales_incentives;

drop function if exists public.sales_my_pay();
drop function if exists public.admin_payroll_notified(uuid);
drop function if exists public.admin_payroll_notify_data(uuid);
drop function if exists public.admin_payroll_advance_remove(uuid, text);
drop function if exists public.admin_payroll_advance_add(uuid, integer, date, integer, text);
drop function if exists public.admin_payroll_person_save(uuid, integer, date, text, text, text, boolean, text);
drop function if exists public.admin_payroll_settings_save(jsonb, text);
drop function if exists public.admin_payroll_undo_paid(uuid, text);
drop function if exists public.admin_payroll_mark_paid(uuid, text, text, date, text);
drop function if exists public.admin_payroll_unapprove(uuid, text);
drop function if exists public.admin_payroll_approve(date, uuid[], text);
drop function if exists public.admin_payroll_line_remove(uuid, integer, text);
drop function if exists public.admin_payroll_line_add(uuid, text, integer, text);
drop function if exists public.admin_payroll_draft_remove(uuid, text);
drop function if exists public.admin_payroll_save_drafts(date, jsonb, text);
drop function if exists public.admin_payroll_inputs(date);
drop function if exists public.payroll_incentive_guard();
drop function if exists public.payroll_tax(text, date);
drop function if exists public.payroll_lock_on(date);
drop function if exists public.payroll_totals(jsonb);
drop function if exists public.payroll_check_lines(jsonb, boolean);
drop function if exists public.payroll_incentive_taken(uuid, uuid);
drop function if exists public.payroll_advance_taken(uuid);
drop function if exists public.payroll_mask(text);
drop function if exists public.payroll_settings_clean(jsonb);
drop function if exists public.payroll_settings_get();

-- admin_can exactly as admin-part1-forward.sql made it.
create or replace function public.admin_can(p_what text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_role text := public.admin_role();
begin
  if v_role is null or not public.admin_mfa_ok() then
    return false;
  end if;
  return case p_what
    when 'see'         then true
    when 'see_private' then v_role in ('owner', 'admin', 'support', 'finance')
    when 'edit_store'  then v_role in ('owner', 'admin', 'support')
    when 'plan'        then v_role in ('owner', 'admin', 'finance')
    when 'pause'       then v_role in ('owner', 'admin')
    when 'delete'      then v_role = 'owner'
    when 'money'       then v_role in ('owner', 'admin', 'finance', 'viewer')
    when 'people'      then v_role in ('owner', 'admin')
    when 'system'      then v_role = 'owner'
    else false
  end;
end;
$fn$;

-- The audit log read rule, Audit log page and Home exactly as admin-part1-forward.sql made them.
drop policy if exists admin_audit_read on public.admin_audit;
create policy admin_audit_read on public.admin_audit
  for select to authenticated using (public.admin_can('see'));

create or replace function public.admin_audit_list(p_kind text default null, p_before timestamptz default null)
returns setof public.admin_audit
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
begin
  perform public.admin_require('see');
  return query
  select * from public.admin_audit a
   where (p_kind is null or a.target_kind = p_kind or a.action = p_kind)
     and (p_before is null or a.at < p_before)
   order by a.at desc
   limit 200;
end;
$fn$;

create or replace function public.admin_home()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_now   timestamptz := now();
  v_today timestamptz := date_trunc('day', v_now at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata';
begin
  perform public.admin_require('see');
  return (
    with st as (
      select s.slug, s.created_at, coalesce(nullif(s.config->>'businessName', ''), s.slug) as name,
             public.admin_store_state(s.config, s.admin_status, v_now) as state,
             s.config->>'planExpiresAt' as exp
        from public.stores s
    ), od as (
      select count(*) as n, coalesce(round(sum(coalesce(o.total, 0))), 0) as amt, count(distinct o.store_slug) as shops
        from public.orders o where o.created_at >= v_today and coalesce(o.status, '') <> 'abandoned'
    )
    select jsonb_build_object(
      'stores', (select count(*) from st where state <> 'deleted'),
      'paying', (select count(*) from st where state in ('active', 'ending')),
      'ending', (select count(*) from st where state = 'ending'),
      'renewal_missing', (select count(*) from st where state = 'renewal_missing'),
      'ended', (select count(*) from st where state = 'ended'),
      'paused', (select count(*) from st where state = 'paused'),
      'new_7d', (select count(*) from st where created_at >= v_now - interval '7 days' and state <> 'deleted'),
      'orders_today', (select n from od), 'sales_today', (select amt from od), 'shops_today', (select shops from od),
      'unclaimed', (select count(*) from public.pending_signups p
                     where coalesce(p.plan, 'free') <> 'free'
                       and not exists (select 1 from public.stores s
                                        where right(regexp_replace(coalesce(s.config->>'ownerPhone', s.config->>'whatsappNumber', ''), '[^0-9]', '', 'g'), 10)
                                              = right(regexp_replace(coalesce(p.phone, ''), '[^0-9]', '', 'g'), 10))),
      'needs', coalesce((select jsonb_agg(x order by x->>'sort') from (
          select jsonb_build_object('kind', state, 'slug', slug, 'name', name, 'exp', exp,
                                    'sort', case state when 'renewal_missing' then '1' else '2' end || coalesce(exp, '')) as x
            from st where state in ('renewal_missing', 'ending') order by exp limit 12) n), '[]'::jsonb),
      'new_shops', coalesce((select jsonb_agg(jsonb_build_object('slug', slug, 'name', name, 'at', created_at) order by created_at desc)
                               from (select * from st where state <> 'deleted' order by created_at desc limit 6) z), '[]'::jsonb),
      'recent', coalesce((select jsonb_agg(jsonb_build_object('at', a.at, 'who', a.actor_name, 'action', a.action, 'kind', a.target_kind, 'target', a.target, 'reason', a.reason) order by a.at desc)
                            from (select * from public.admin_audit order by at desc limit 8) a), '[]'::jsonb)
    )
  );
end;
$fn$;

revoke all on function public.admin_audit_list(text, timestamptz) from public, anon;
revoke all on function public.admin_home() from public, anon;
grant execute on function public.admin_audit_list(text, timestamptz) to authenticated;
grant execute on function public.admin_home() to authenticated;

revoke all on function public.admin_can(text) from public, anon;
grant execute on function public.admin_can(text) to authenticated;

commit;

-- To delete every salary record as well (cannot be undone):
--   drop table if exists public.payroll_slips;
--   drop table if exists public.payroll_advances;
--   drop table if exists public.payroll_people;
--   drop table if exists public.payroll_settings;
