-- ===========================================================================
--  PocketLink Sales CRM  --  PART 6: attendance counts work, not logins
--
--  Until now a day was Present if the person opened the CRM once. From the
--  start date in Settings (set to the day after this runs) a day needs real
--  work:
--    * Work = calls, visits, notes, stage changes, lead assignments, lead
--      checks (Ads & leads), and leads added by hand (imports and automatic
--      leads do not count). Visits or calls a manager rejected do not count.
--    * Active time: gaps of up to 30 minutes between actions count as
--      working time; a longer gap is quiet time. Each fresh start counts
--      5 minutes (or the call's length, if longer). The login is a starting
--      point, never an action.
--    * Each role has a daily minimum (Settings, Work hours): callers 20 calls
--      and 4.5 h active, Ads & leads 15 checks and 4.5 h, field 3 visits,
--      managers none. Met = full day; at least half of both = half day;
--      less = "Logged in, no work". A manager's mark by hand still wins.
--  Days before the start date keep the old rule, so past months do not
--  change. sales_days_worked() is the one count of days in, used by the
--  scoreboard and the 7 pm / Monday report (which also gets active and quiet
--  time per person).
--  Order: this -> sales-crm-part6-verify.sql. Safe to run twice.
--  Undo: sales-crm-part6-ROLLBACK.sql.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. The rule (defaults, then whatever Settings saved under work.work_rule)
-- ---------------------------------------------------------------------------
create or replace function public.sales_work_rule()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select jsonb_build_object(
           'on', true, 'from', null, 'gap_min', 30, 'idle_alert_min', 60, 'field_gap_min', 180,
           'min', jsonb_build_object(
             'caller', jsonb_build_object('calls', 20, 'hours', 4.5),
             'ads', jsonb_build_object('checks', 15, 'hours', 4.5),
             'field', jsonb_build_object('visits', 3, 'hours', 0),
             'manager', jsonb_build_object('hours', 0)))
         || coalesce((select s.value->'work_rule' from public.sales_settings s
                       where s.key = 'work' and jsonb_typeof(s.value->'work_rule') = 'object'), '{}'::jsonb)
$fn$;

-- The day's level for a role: 'full', 'half' or 'none'.
create or replace function public.sales_work_level(p_role text, p_calls integer, p_visits integer, p_checks integer, p_active integer, p_rule jsonb)
returns text
language plpgsql
immutable
set search_path = public, pg_temp
as $fn$
declare
  m       jsonb := coalesce(p_rule->'min'->coalesce(p_role, 'caller'), '{}'::jsonb);
  v_need  integer;
  v_got   integer;
  v_hours numeric;
  v_key   text := case p_role when 'field' then 'visits' when 'ads' then 'checks' when 'manager' then null else 'calls' end;
begin
  v_need := case when v_key is null then 0
                 when coalesce(m->>v_key, '') ~ '^[0-9]{1,4}$' then (m->>v_key)::integer
                 when p_role = 'field' then 3 when p_role = 'ads' then 15 else 20 end;
  v_got := case p_role when 'field' then p_visits when 'ads' then p_checks when 'manager' then 0 else p_calls end;
  v_hours := case when coalesce(m->>'hours', '') ~ '^[0-9]{1,2}(\.[0-9]+)?$' then least((m->>'hours')::numeric, 12)
                  when p_role in ('field', 'manager') then 0 else 4.5 end;
  if coalesce(v_got, 0) >= v_need and coalesce(p_active, 0) >= v_hours * 60 then
    return 'full';
  end if;
  if coalesce(v_got, 0) * 2 >= v_need and coalesce(p_active, 0) * 2 >= v_hours * 60 then
    return 'half';
  end if;
  return 'none';
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 2. Each person's work per India day (internal: no access check here)
-- ---------------------------------------------------------------------------
create or replace function public.sales_work_rows(p_staff uuid, p_from date, p_to date)
returns table (staff_id uuid, day date, actions integer, calls integer, visits integer, checks integer, added integer,
               active_min integer, quiet_min integer, first_work_at timestamptz, last_work_at timestamptz, last_visit_at timestamptz,
               longest_gap_min integer, gap_from timestamptz, gap_to timestamptz,
               visit_gap_min integer, visit_gap_from timestamptz, visit_gap_to timestamptz, level text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
#variable_conflict use_column
declare
  v_rule jsonb := public.sales_work_rule();
  v_gap  numeric := case when coalesce(v_rule->>'gap_min', '') ~ '^[0-9]{1,3}$' then least(240, greatest(5, (v_rule->>'gap_min')::numeric)) else 30 end;
  v_on   boolean := coalesce(v_rule->>'on', 'true') <> 'false';
  v_from date := case when coalesce(v_rule->>'from', '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then (v_rule->>'from')::date else date '1900-01-01' end;
  v_lo   timestamptz := (p_from::timestamp at time zone 'Asia/Kolkata');
  v_hi   timestamptz := ((p_to + 1)::timestamp at time zone 'Asia/Kolkata');
begin
  return query
  with ev as (
    select a.staff_id as sid, a.created_at as at,
           case when a.kind = 'system' then 'check' else a.kind end as k, a.duration_sec as dur
      from public.sales_activities a
     where a.created_at >= v_lo and a.created_at < v_hi
       and a.staff_id is not null and (p_staff is null or a.staff_id = p_staff)
       and a.review is distinct from 'rejected'
       and (a.kind in ('call', 'visit', 'note', 'stage', 'assign')
            or (a.kind = 'system' and left(coalesce(a.outcome, ''), 8) = 'checked_'))
    union all
    select l.created_by, l.created_at, 'added', null::integer
      from public.sales_leads l
     where l.created_at >= v_lo and l.created_at < v_hi
       and l.created_by is not null and (p_staff is null or l.created_by = p_staff)
       and l.source not in ('import', 'hub', 'signup', 'pending_signup')
    union all
    select t.staff_id, coalesce(t.day_start_at, t.first_seen_at), 'login', null::integer
      from public.sales_attendance t
     where t.day between p_from and p_to and (p_staff is null or t.staff_id = p_staff)
       and coalesce(t.day_start_at, t.first_seen_at) >= v_lo and coalesce(t.day_start_at, t.first_seen_at) < v_hi
  ), evd as (
    select e.sid, e.at, e.k, e.dur, (e.at at time zone 'Asia/Kolkata')::date as d,
           lag(e.at) over w as prev_at,
           extract(epoch from (e.at - lag(e.at) over w)) / 60.0 as gap
      from ev e
    window w as (partition by e.sid, (e.at at time zone 'Asia/Kolkata')::date order by e.at, e.k)
  ), agg as (
    select e.sid, e.d,
           (count(*) filter (where e.k <> 'login'))::integer as n_actions,
           (count(*) filter (where e.k = 'call'))::integer as n_calls,
           (count(*) filter (where e.k = 'visit'))::integer as n_visits,
           (count(*) filter (where e.k = 'check'))::integer as n_checks,
           (count(*) filter (where e.k = 'added'))::integer as n_added,
           round(coalesce(sum(case when e.gap is not null and e.gap <= v_gap then e.gap
                                   when e.k = 'login' then 0
                                   else greatest(5, coalesce(e.dur, 0) / 60.0) end), 0))::integer as n_active,
           round(coalesce(sum(e.gap) filter (where e.gap > v_gap), 0))::integer as n_quiet,
           min(e.at) filter (where e.k <> 'login') as w_first,
           max(e.at) filter (where e.k <> 'login') as w_last,
           max(e.at) filter (where e.k = 'visit') as w_visit
      from evd e
     group by e.sid, e.d
  ), lg as (
    select distinct on (e.sid, e.d) e.sid, e.d, e.gap, e.prev_at, e.at
      from evd e
     where e.gap is not null
     order by e.sid, e.d, e.gap desc
  ), vx as (
    select e.sid, e.d, e.at,
           lag(e.at) over (partition by e.sid, e.d order by e.at) as prev_at
      from evd e
     where e.k in ('visit', 'login')
  ), vg as (
    select distinct on (x.sid, x.d) x.sid, x.d, extract(epoch from (x.at - x.prev_at)) / 60.0 as g, x.prev_at, x.at
      from vx x
     where x.prev_at is not null
     order by x.sid, x.d, (x.at - x.prev_at) desc
  )
  select s.user_id, a.d, a.n_actions, a.n_calls, a.n_visits, a.n_checks, a.n_added,
         a.n_active, a.n_quiet, a.w_first, a.w_last, a.w_visit,
         round(lg.gap)::integer, lg.prev_at, lg.at,
         round(vg.g)::integer, vg.prev_at, vg.at,
         case when not v_on or a.d < v_from then null
              else public.sales_work_level(s.role, a.n_calls, a.n_visits, a.n_checks + a.n_added, a.n_active, v_rule) end
    from agg a
    join public.sales_staff s on s.user_id = a.sid
    left join lg on lg.sid = a.sid and lg.d = a.d
    left join vg on vg.sid = a.sid and vg.d = a.d
   order by a.sid, a.d;
end;
$fn$;

-- What the CRM reads: a manager sees everyone, anyone else only themselves.
create or replace function public.sales_work_days(p_from date, p_to date)
returns table (staff_id uuid, day date, actions integer, calls integer, visits integer, checks integer, added integer,
               active_min integer, quiet_min integer, first_work_at timestamptz, last_work_at timestamptz, last_visit_at timestamptz,
               longest_gap_min integer, gap_from timestamptz, gap_to timestamptz,
               visit_gap_min integer, visit_gap_from timestamptz, visit_gap_to timestamptz, level text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_role text := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'role', '');
  v_all  boolean := public.sales_is_manager() or v_role = 'service_role';
begin
  if not v_all and not public.sales_is_staff() then
    raise exception 'not on the sales team' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 62 then
    raise exception 'bad period' using errcode = '22023';
  end if;
  return query select * from public.sales_work_rows(case when v_all then null else auth.uid() end, p_from, p_to);
end;
$fn$;

-- Days in for one person: a manager's present / late / half mark, or a login
-- on a day whose work was not 'none' (days before the rule: any login).
create or replace function public.sales_days_worked(p_staff uuid, p_from date, p_to date)
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select count(*)::integer
    from public.sales_attendance t
    left join public.sales_work_rows(p_staff, p_from, p_to) w on w.day = t.day
   where t.staff_id = p_staff and t.day between p_from and p_to
     and (t.status_override in ('present', 'late', 'half')
          or (t.status_override is null and (t.first_seen_at is not null or t.day_start_at is not null)
              and w.level is distinct from 'none'))
$fn$;

-- ---------------------------------------------------------------------------
-- 3. The rule starts tomorrow (India date), so nobody is judged on a day
--    they were not told about. Settings can move it.
-- ---------------------------------------------------------------------------
insert into public.sales_settings (key, value) values ('work', '{}'::jsonb) on conflict (key) do nothing;
update public.sales_settings
   set value = value || jsonb_build_object('work_rule', jsonb_build_object('on', true, 'from', (public.sales_today() + 1)::text)),
       updated_at = now()
 where key = 'work' and not (value ? 'work_rule');

-- ---------------------------------------------------------------------------
-- 4. Scoreboard (part 5 text) and report data (part 4 text), with days in
--    from sales_days_worked(); the report also gets active / quiet time.
-- ---------------------------------------------------------------------------
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
         public.sales_days_worked(s.user_id, p_from, p_to),
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
           public.sales_days_worked(s.user_id, p_from, p_to) as days_in,
           (select coalesce(sum(w.active_min), 0) from public.sales_work_rows(s.user_id, p_from, p_to) w) as active_min,
           (select coalesce(sum(w.quiet_min), 0) from public.sales_work_rows(s.user_id, p_from, p_to) w) as quiet_min,
           (select w.level from public.sales_work_rows(s.user_id, p_to, p_to) w) as level,
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
    'idle_min', (select case when coalesce(r->>'idle_alert_min', '') ~ '^[0-9]{1,3}$' then (r->>'idle_alert_min')::integer else 60 end
                   from public.sales_work_rule() r),
    'people', coalesce(jsonb_agg(jsonb_build_object(
       'name', name, 'role', role, 'calls', calls, 'answered', answered, 'visits', visits, 'demos', demos, 'paid', paid,
       'days_in', days_in, 'first_login', first_login, 'active_min', active_min, 'quiet_min', quiet_min, 'level', level, 'incentive_earned', incentive_earned, 'late', late) order by paid desc, calls + visits desc), '[]'::jsonb)
  ) into v_out from people;
  return v_out;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 5. Who may call what. Supabase gives every new function to anon and
--    authenticated by default, so each is closed and opened on purpose.
-- ---------------------------------------------------------------------------
revoke all on function public.sales_work_rule() from public, anon, authenticated;
revoke all on function public.sales_work_level(text, integer, integer, integer, integer, jsonb) from public, anon, authenticated;
revoke all on function public.sales_work_rows(uuid, date, date) from public, anon, authenticated;
revoke all on function public.sales_days_worked(uuid, date, date) from public, anon, authenticated;
revoke all on function public.sales_work_days(date, date) from public, anon;
revoke all on function public.sales_scoreboard(date, date) from public, anon;
revoke all on function public.sales_report_data(date, date) from public, anon;
grant execute on function public.sales_work_days(date, date) to authenticated, service_role;
grant execute on function public.sales_scoreboard(date, date) to authenticated;
grant execute on function public.sales_report_data(date, date) to authenticated, service_role;

commit;
