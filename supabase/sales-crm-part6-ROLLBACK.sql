-- ===========================================================================
--  PocketLink Sales CRM part 6  --  ROLLBACK (emergency only)
--
--  Attendance goes back to counting logins: the scoreboard and the report
--  data get their part 5 / part 4 texts back and the work functions are
--  dropped. The work_rule setting is removed. Attendance rows, activities
--  and manager marks are not touched. Generated from the part 4 and 5 files.
-- ===========================================================================
begin;

create or replace function public.sales_scoreboard(p_from date, p_to date)
returns table (
  user_id uuid, name text, role text, targets jsonb, daily_target integer, monthly_target integer,
  calls integer, answered integer, answered_noted integer, talk_sec bigint,
  visits integer, visits_owner integer, visits_noted integer,
  demos integer, won integer, pending_wins integer, money bigint, new_leads integer, days_present integer,
  open_followups integer, late_followups integer,
  checked integer, checked_ad integer, checked_fast integer, verified_total integer, verified_demo integer, verified_paid integer
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
#variable_conflict use_column
declare
  v_lo    timestamptz;
  v_hi    timestamptz;
  v_today timestamptz := (public.sales_today()::timestamp at time zone 'Asia/Kolkata');
begin
  if not public.sales_is_staff() then
    raise exception 'not on the sales team' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 400 then
    raise exception 'bad period' using errcode = '22023';
  end if;
  v_lo := (p_from::timestamp at time zone 'Asia/Kolkata');
  v_hi := ((p_to + 1)::timestamp at time zone 'Asia/Kolkata');

  return query
  with a as (
    select x.staff_id, x.lead_id, x.kind, x.outcome, x.note, x.duration_sec, x.created_at
      from public.sales_activities x
     where x.created_at >= v_lo and x.created_at < v_hi
       and x.staff_id is not null
       and x.review is distinct from 'rejected'
  ),
  w as (
    select distinct on (a.lead_id) a.lead_id, a.staff_id, l.won_proof, l.won_amount
      from a join public.sales_leads l on l.id = a.lead_id
     where a.kind = 'stage' and a.outcome = 'won' and l.stage = 'won'
     order by a.lead_id, a.created_at desc
  ),
  v as (
    select l.verified_by, l.source, l.stage, l.won_proof, l.verified_at, l.created_at
      from public.sales_leads l
     where l.verify_status = 'verified' and l.verified_at >= v_lo and l.verified_at < v_hi
  )
  select s.user_id, s.name, s.role, s.targets, s.daily_target, s.monthly_target,
         (select count(*) from a where a.staff_id = s.user_id and a.kind = 'call')::integer,
         (select count(*) from a where a.staff_id = s.user_id and a.kind = 'call'
                                  and coalesce(a.outcome, '') not in ('no_answer', 'wrong_number'))::integer,
         (select count(*) from a where a.staff_id = s.user_id and a.kind = 'call'
                                  and coalesce(a.outcome, '') not in ('no_answer', 'wrong_number')
                                  and a.note is not null)::integer,
         (select coalesce(sum(a.duration_sec), 0) from a where a.staff_id = s.user_id and a.kind = 'call')::bigint,
         (select count(*) from a where a.staff_id = s.user_id and a.kind = 'visit')::integer,
         (select count(*) from a where a.staff_id = s.user_id and a.kind = 'visit'
                                  and split_part(coalesce(a.outcome, ''), '_', 1) = 'owner')::integer,
         (select count(*) from a where a.staff_id = s.user_id and a.kind = 'visit' and a.note is not null)::integer,
         (select count(*) from a where a.staff_id = s.user_id
                                  and ((a.kind = 'call' and a.outcome = 'demo')
                                       or (a.kind = 'visit' and a.outcome in ('owner_demo', 'staff_demo'))))::integer,
         (select count(*) from w where w.staff_id = s.user_id and w.won_proof is not null)::integer,
         (select count(*) from w where w.staff_id = s.user_id and w.won_proof is null)::integer,
         (select coalesce(sum(w.won_amount), 0) from w where w.staff_id = s.user_id and w.won_proof is not null)::bigint,
         (select count(*) from public.sales_leads l
           where l.created_by = s.user_id and l.created_at >= v_lo and l.created_at < v_hi)::integer,
         (select count(*) from public.sales_attendance t
           where t.staff_id = s.user_id and t.day between p_from and p_to
             and (t.status_override in ('present', 'late', 'half')
                  or (t.status_override is null and (t.first_seen_at is not null or t.day_start_at is not null))))::integer,
         (select count(*) from public.sales_leads l
           where l.assigned_to = s.user_id and l.stage not in ('won', 'lost') and l.next_action_at is not null)::integer,
         (select count(*) from public.sales_leads l
           where l.assigned_to = s.user_id and l.stage not in ('won', 'lost') and l.next_action_at < v_today)::integer,
         (select count(*) from a where a.staff_id = s.user_id and a.kind = 'system' and left(coalesce(a.outcome, ''), 8) = 'checked_')::integer,
         (select count(*) from v where v.verified_by = s.user_id and v.source in ('facebook', 'instagram', 'google', 'website', 'whatsapp'))::integer,
         (select count(*) from v where v.verified_by = s.user_id and v.source in ('facebook', 'instagram', 'google', 'website', 'whatsapp')
                                  and v.verified_at <= public.sales_callable_at(v.created_at) + interval '30 minutes')::integer,
         (select count(*) from v where v.verified_by = s.user_id)::integer,
         (select count(*) from v where v.verified_by = s.user_id and v.stage in ('demo', 'interested', 'won'))::integer,
         (select count(*) from v where v.verified_by = s.user_id and v.stage = 'won' and v.won_proof is not null)::integer
    from public.sales_staff s
   where s.active and s.role <> 'manager'
   order by s.name;
end;
$fn$;

create or replace function public.sales_report_data(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_lo   timestamptz;
  v_hi   timestamptz;
  v_role text := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'role', '');
  v_out  jsonb;
begin
  if not (public.sales_is_manager() or v_role = 'service_role') then
    raise exception 'only a manager can see reports' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 62 then
    raise exception 'bad period' using errcode = '22023';
  end if;
  v_lo := (p_from::timestamp at time zone 'Asia/Kolkata');
  v_hi := ((p_to + 1)::timestamp at time zone 'Asia/Kolkata');
  with a as (
    select x.* from public.sales_activities x
     where x.created_at >= v_lo and x.created_at < v_hi and x.review is distinct from 'rejected'
  ), people as (
    select s.user_id, s.name, s.role,
           (select count(*) from a where a.staff_id = s.user_id and a.kind = 'call') as calls,
           (select count(*) from a where a.staff_id = s.user_id and a.kind = 'call' and coalesce(a.outcome, '') not in ('no_answer', 'wrong_number')) as answered,
           (select count(*) from a where a.staff_id = s.user_id and a.kind = 'visit') as visits,
           (select count(*) from a where a.staff_id = s.user_id and ((a.kind = 'call' and a.outcome = 'demo') or (a.kind = 'visit' and a.outcome in ('owner_demo', 'staff_demo')))) as demos,
           (select count(distinct a.lead_id) from a join public.sales_leads l on l.id = a.lead_id
             where a.staff_id = s.user_id and a.kind = 'stage' and a.outcome = 'won' and l.stage = 'won' and l.won_proof is not null) as paid,
           (select count(*) from public.sales_attendance t where t.staff_id = s.user_id and t.day between p_from and p_to
             and (t.status_override in ('present', 'late', 'half') or (t.status_override is null and (t.first_seen_at is not null or t.day_start_at is not null)))) as days_in,
           (select min(t.first_seen_at) from public.sales_attendance t where t.staff_id = s.user_id and t.day = p_to) as first_login,
           (select coalesce(sum(i.incentive), 0) from public.sales_incentives i where i.staff_id = s.user_id and i.status in ('earned', 'paid')
             and i.decided_at >= v_lo and i.decided_at < v_hi) as incentive_earned,
           (select count(*) from public.sales_leads l where l.assigned_to = s.user_id and l.stage not in ('won', 'lost')
             and l.next_action_at < (public.sales_today()::timestamp at time zone 'Asia/Kolkata')) as late
      from public.sales_staff s where s.active and s.role <> 'manager'
  )
  select jsonb_build_object(
    'from', p_from, 'to', p_to,
    'calls', coalesce(sum(calls), 0), 'answered', coalesce(sum(answered), 0), 'visits', coalesce(sum(visits), 0),
    'demos', coalesce(sum(demos), 0), 'paid', coalesce(sum(paid), 0),
    'collected', (select coalesce(sum(l.won_amount), 0) from public.sales_leads l where l.won_proof is not null and l.won_proof_at >= v_lo and l.won_proof_at < v_hi),
    'incentive_earned', coalesce(sum(incentive_earned), 0),
    'late', coalesce(sum(late), 0),
    'new_leads', (select count(*) from public.sales_leads l where l.created_at >= v_lo and l.created_at < v_hi),
    'ad_leads', (select count(*) from public.sales_leads l where l.created_at >= v_lo and l.created_at < v_hi
                  and l.source in ('facebook', 'instagram', 'google', 'website', 'whatsapp')),
    'not_called', (select count(*) from public.sales_leads l where l.stage = 'new' and l.last_activity_at is null
                    and l.assigned_to is not null and l.created_at < v_hi),
    'staff', count(*), 'days', p_to - p_from + 1,
    'people', coalesce(jsonb_agg(jsonb_build_object(
       'name', name, 'role', role, 'calls', calls, 'answered', answered, 'visits', visits, 'demos', demos, 'paid', paid,
       'days_in', days_in, 'first_login', first_login, 'incentive_earned', incentive_earned, 'late', late) order by paid desc, calls + visits desc), '[]'::jsonb)
  ) into v_out from people;
  return v_out;
end;
$fn$;

revoke all on function public.sales_scoreboard(date, date) from public, anon;
revoke all on function public.sales_report_data(date, date) from public, anon;
grant execute on function public.sales_scoreboard(date, date) to authenticated;
grant execute on function public.sales_report_data(date, date) to authenticated, service_role;

drop function if exists public.sales_work_days(date, date);
drop function if exists public.sales_days_worked(uuid, date, date);
drop function if exists public.sales_work_rows(uuid, date, date);
drop function if exists public.sales_work_level(text, integer, integer, integer, integer, jsonb);
drop function if exists public.sales_work_rule();
update public.sales_settings set value = value - 'work_rule' where key = 'work';

commit;
