-- ===========================================================================
--  PocketLink Salary (Admin + CRM)  --  FORWARD
--
--  Salaries for the sales team, worked out from the CRM and paid by hand:
--    * Admin, Salary setup (Owner only): each person's monthly salary, the
--      day they joined, where they are paid (UPI / bank, typed by you), their
--      Professional Tax, and the month's rules (pay day, lock day, paid leave,
--      field travel, the trial of the work rule, the payslip's company name).
--    * Admin, Salary: after the month locks (the 2nd of the next month), the
--      browser works the month out from the same attendance the CRM shows
--      and saves one draft per person (admin_payroll_save_drafts). The
--      database checks every line it can: base pay not above the salary,
--      incentives rebuilt here from sales_incentives (earned, not paid, not
--      in another salary), advances not above what is left, Professional
--      Tax as set up. Owner and Finance can add a bonus or a deduction with
--      a reason; only the Owner approves.
--    * Nothing is paid by the system. You pay by UPI / bank / cash yourself,
--      then mark it paid with the reference (Owner or Finance). Its
--      incentives become "Paid out" in the CRM at the same moment.
--    * An incentive inside an approved salary cannot be changed in the CRM
--      (a trigger), so nothing is paid twice.
--    * CRM: sales_my_pay() gives each person ONLY their own salary, payslips
--      (approved and paid) and advances. Managers never see other people's
--      salaries.
--    * admin_can: + 'salary' (Owner, Finance) and 'salary_approve' (Owner).
--  Every change is written to admin_audit.
--  Needs: admin-part1..3 and sales-crm parts 1..6. Safe to run twice.
--  Order: this -> salary-verify.sql. Undo: salary-ROLLBACK.sql.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Who may: Owner and Finance handle salaries; only the Owner approves
--    them and changes salaries or rules. (Same table as before, plus 2 rows.)
-- ---------------------------------------------------------------------------
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
    when 'see'            then true
    when 'see_private'    then v_role in ('owner', 'admin', 'support', 'finance')
    when 'edit_store'     then v_role in ('owner', 'admin', 'support')
    when 'plan'           then v_role in ('owner', 'admin', 'finance')
    when 'pause'          then v_role in ('owner', 'admin')
    when 'delete'         then v_role = 'owner'
    when 'money'          then v_role in ('owner', 'admin', 'finance', 'viewer')
    when 'people'         then v_role in ('owner', 'admin')
    when 'system'         then v_role = 'owner'
    when 'salary'         then v_role in ('owner', 'finance')
    when 'salary_approve' then v_role = 'owner'
    else false
  end;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 2. Tables. No foreign key to sales_staff on purpose: salary records stay
--    when a login is removed. Closed to the browser; only the functions
--    below read and write them.
-- ---------------------------------------------------------------------------
create table if not exists public.payroll_settings (
  id         boolean primary key default true check (id),
  value      jsonb not null default '{}'::jsonb check (jsonb_typeof(value) = 'object' and length(value::text) <= 4000),
  updated_at timestamptz not null default now(),
  updated_by uuid
);
insert into public.payroll_settings (id, value) values (true, '{}'::jsonb) on conflict (id) do nothing;

create table if not exists public.payroll_people (
  user_id      uuid primary key,
  base_monthly integer not null check (base_monthly between 0 and 1000000),
  joined_on    date not null,
  employee_no  text check (employee_no is null or length(employee_no) <= 20),
  pay_to       text check (pay_to is null or length(pay_to) <= 120),
  prof_tax     text not null default 'none' check (prof_tax in ('none', '175', '200')),
  active       boolean not null default true,
  updated_at   timestamptz not null default now(),
  updated_by   uuid
);

create table if not exists public.payroll_advances (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null,
  amount     integer not null check (amount between 1 and 1000000),
  given_on   date not null,
  per_month  integer check (per_month is null or per_month between 1 and 1000000),
  note       text not null check (length(btrim(note)) between 1 and 200),
  created_at timestamptz not null default now(),
  created_by uuid
);
create index if not exists payroll_advances_user_idx on public.payroll_advances (user_id, given_on);

create table if not exists public.payroll_slips (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null,
  month        date not null check (extract(day from month) = 1),
  name         text not null check (length(name) <= 80),
  role         text not null check (length(role) <= 20),
  status       text not null default 'draft' check (status in ('draft', 'approved', 'paid')),
  base_monthly integer not null check (base_monthly >= 0),
  days         jsonb not null default '{}'::jsonb check (jsonb_typeof(days) = 'object' and length(days::text) <= 4000),
  lines        jsonb not null check (jsonb_typeof(lines) = 'array' and length(lines::text) <= 20000),
  incentives   jsonb not null default '[]'::jsonb check (jsonb_typeof(incentives) = 'array' and length(incentives::text) <= 20000),
  earnings     integer not null check (earnings >= 0),
  deductions   integer not null check (deductions >= 0),
  net          integer not null check (net >= 0 and net = earnings - deductions),
  made_at      timestamptz not null default now(),
  made_by      uuid,
  approved_at  timestamptz,
  approved_by  uuid,
  paid_at      timestamptz,
  paid_by      uuid,
  paid_on      date,
  paid_method  text check (paid_method is null or paid_method in ('upi', 'bank', 'cash')),
  paid_ref     text check (paid_ref is null or length(paid_ref) <= 60),
  notified_at  timestamptz,
  unique (user_id, month)
);
create index if not exists payroll_slips_month_idx on public.payroll_slips (month, status);

alter table public.payroll_settings enable row level security;
alter table public.payroll_people   enable row level security;
alter table public.payroll_advances enable row level security;
alter table public.payroll_slips    enable row level security;
revoke all on public.payroll_settings from public, anon, authenticated;
revoke all on public.payroll_people   from public, anon, authenticated;
revoke all on public.payroll_advances from public, anon, authenticated;
revoke all on public.payroll_slips    from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Helpers (internal)
-- ---------------------------------------------------------------------------

-- The rules with their defaults filled in.
create or replace function public.payroll_settings_get()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select jsonb_build_object(
    'pay_day', 6, 'sunday_before', true, 'lock_day', 2, 'day_rate', 'month_days',
    'paid_leave', 1, 'leave_carry_max', 6, 'late_cut', false, 'nowork_paid_until', '2026-12-31',
    'travel_per_km', 3, 'travel_cap', 150, 'road_factor', 1.3, 'travel_visit_days_only', true,
    'company_name', '', 'company_address', '', 'whatsapp_on', true)
  || coalesce((select s.value from public.payroll_settings s where s.id), '{}'::jsonb)
$fn$;

-- Checks a new set of rules; returns only the known keys. Raises on a bad value.
create or replace function public.payroll_settings_clean(p jsonb)
returns jsonb
language plpgsql
immutable
set search_path = public, pg_temp
as $fn$
declare
  v jsonb := '{}'::jsonb;
  k text;
  n numeric;
begin
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'bad rules' using errcode = '22023';
  end if;
  foreach k in array array['pay_day', 'lock_day', 'paid_leave', 'leave_carry_max', 'travel_per_km', 'travel_cap', 'road_factor'] loop
    if p ? k then
      if jsonb_typeof(p->k) <> 'number' then
        raise exception '% must be a number', k using errcode = '22023';
      end if;
      n := (p->>k)::numeric;
      if (k = 'pay_day' and (n < 1 or n > 28 or n <> trunc(n)))
         or (k = 'lock_day' and (n < 1 or n > 10 or n <> trunc(n)))
         or (k = 'paid_leave' and (n < 0 or n > 5 or n <> trunc(n)))
         or (k = 'leave_carry_max' and (n < 0 or n > 30 or n <> trunc(n)))
         or (k = 'travel_per_km' and (n < 0 or n > 50))
         or (k = 'travel_cap' and (n < 0 or n > 5000 or n <> trunc(n)))
         or (k = 'road_factor' and (n < 1 or n > 2)) then
        raise exception '% is out of range', k using errcode = '22023';
      end if;
      v := v || jsonb_build_object(k, case when k in ('travel_per_km', 'road_factor') then to_jsonb(n) else to_jsonb(trunc(n)::integer) end);
    end if;
  end loop;
  foreach k in array array['sunday_before', 'late_cut', 'travel_visit_days_only', 'whatsapp_on'] loop
    if p ? k then
      if jsonb_typeof(p->k) <> 'boolean' then
        raise exception '% must be on or off', k using errcode = '22023';
      end if;
      v := v || jsonb_build_object(k, p->k);
    end if;
  end loop;
  if p ? 'day_rate' then
    if coalesce(p->>'day_rate', '') not in ('month_days', '30', 'working') then
      raise exception 'day_rate is not one of the choices' using errcode = '22023';
    end if;
    v := v || jsonb_build_object('day_rate', p->>'day_rate');
  end if;
  if p ? 'nowork_paid_until' then
    if jsonb_typeof(p->'nowork_paid_until') = 'null' then
      v := v || jsonb_build_object('nowork_paid_until', null);
    elsif coalesce(p->>'nowork_paid_until', '') ~ '^\d{4}-\d{2}-\d{2}$' then
      perform (p->>'nowork_paid_until')::date;
      v := v || jsonb_build_object('nowork_paid_until', p->>'nowork_paid_until');
    else
      raise exception 'the trial end must be a date' using errcode = '22023';
    end if;
  end if;
  if p ? 'company_name' then
    if jsonb_typeof(p->'company_name') <> 'string' or length(p->>'company_name') > 120 then
      raise exception 'company name: up to 120 letters' using errcode = '22023';
    end if;
    v := v || jsonb_build_object('company_name', btrim(p->>'company_name'));
  end if;
  if p ? 'company_address' then
    if jsonb_typeof(p->'company_address') <> 'string' or length(p->>'company_address') > 200 then
      raise exception 'company address: up to 200 letters' using errcode = '22023';
    end if;
    v := v || jsonb_build_object('company_address', btrim(p->>'company_address'));
  end if;
  return v;
end;
$fn$;

-- UPI id or bank account shown with the middle hidden.
create or replace function public.payroll_mask(p text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $fn$
  select case
    when p is null or btrim(p) = '' then null
    when position('@' in p) > 1 then left(p, least(4, position('@' in p) - 1)) || repeat(chr(8226), 4) || substr(p, position('@' in p))
    when length(regexp_replace(p, '\D', '', 'g')) >= 4 then repeat(chr(8226), 4) || right(regexp_replace(p, '\D', '', 'g'), 4)
    else repeat(chr(8226), 4)
  end
$fn$;

-- How much of an advance approved or paid salaries have taken back.
create or replace function public.payroll_advance_taken(p_id uuid)
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select coalesce(sum(-(l->>'amount')::integer), 0)::integer
    from public.payroll_slips s, jsonb_array_elements(s.lines) l
   where s.status in ('approved', 'paid') and l->>'kind' = 'advance' and l->>'advance_id' = p_id::text
$fn$;

-- Is this incentive already inside an approved or paid salary?
create or replace function public.payroll_incentive_taken(p_lead uuid, p_staff uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select exists (
    select 1 from public.payroll_slips s
     where s.status in ('approved', 'paid')
       and s.incentives @> jsonb_build_array(jsonb_build_object('lead_id', p_lead, 'staff_id', p_staff)))
$fn$;

-- Each line is { kind, label, how, amount } (+ advance_id on an advance).
-- Money in is >= 0 (base, incentive, travel, bonus); money out is <= 0
-- (advance, tax, deduction). Bonus and deduction lines come only from
-- admin_payroll_line_add (p_manual_ok).
create or replace function public.payroll_check_lines(p_lines jsonb, p_manual_ok boolean)
returns void
language plpgsql
immutable
set search_path = public, pg_temp
as $fn$
declare
  l jsonb;
  k text;
  a integer;
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) > 40 then
    raise exception 'bad salary lines' using errcode = '22023';
  end if;
  for l in select x from jsonb_array_elements(p_lines) x loop
    if jsonb_typeof(l) <> 'object' then
      raise exception 'bad salary line' using errcode = '22023';
    end if;
    k := coalesce(l->>'kind', '');
    if k not in ('base', 'incentive', 'travel', 'advance', 'tax') and not (p_manual_ok and k in ('bonus', 'deduction')) then
      raise exception 'a salary line of an unknown kind' using errcode = '22023';
    end if;
    if jsonb_typeof(l->'amount') <> 'number' or (l->>'amount') !~ '^-?[0-9]{1,7}$' then
      raise exception 'a salary line amount must be whole rupees' using errcode = '22023';
    end if;
    a := (l->>'amount')::integer;
    if (k in ('base', 'incentive', 'travel', 'bonus') and a < 0) or (k in ('advance', 'tax', 'deduction') and a > 0) then
      raise exception 'a salary line has the wrong sign' using errcode = '22023';
    end if;
    if length(coalesce(l->>'label', '')) > 60 or length(coalesce(l->>'how', '')) > 300 or length(coalesce(l->>'by', '')) > 80 then
      raise exception 'a salary line text is too long' using errcode = '22023';
    end if;
    if k = 'advance' and coalesce(l->>'advance_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'an advance line needs its advance' using errcode = '22023';
    end if;
  end loop;
end;
$fn$;

create or replace function public.payroll_totals(p_lines jsonb, out earnings integer, out deductions integer)
language sql
immutable
set search_path = public, pg_temp
as $fn$
  select coalesce(sum(greatest((l->>'amount')::integer, 0)), 0)::integer,
         coalesce(sum(greatest(-(l->>'amount')::integer, 0)), 0)::integer
    from jsonb_array_elements(p_lines) l
$fn$;

-- The day after which a month is locked and drafts may be saved.
create or replace function public.payroll_lock_on(p_month date)
returns date
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select (date_trunc('month', p_month) + interval '1 month')::date + ((public.payroll_settings_get()->>'lock_day')::integer - 1)
$fn$;

create or replace function public.payroll_tax(p_kind text, p_month date)
returns integer
language sql
immutable
set search_path = public, pg_temp
as $fn$
  select case p_kind when '175' then 175 when '200' then (case when extract(month from p_month) = 2 then 300 else 200 end) else 0 end
$fn$;

-- ---------------------------------------------------------------------------
-- 4. An incentive inside an approved (or paid) salary cannot change in the
--    CRM. Paying the salary sets it to 'paid' through this guard on purpose.
-- ---------------------------------------------------------------------------
create or replace function public.payroll_incentive_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  if new.status is not distinct from old.status then
    return new;
  end if;
  if coalesce(current_setting('payroll.paying', true), '') = 'on' then
    return new;
  end if;
  if public.payroll_incentive_taken(old.lead_id, old.staff_id) then
    raise exception 'This incentive is in an approved salary. Change it in PocketLink Admin, Salary.' using errcode = '42501';
  end if;
  return new;
end;
$fn$;

drop trigger if exists payroll_incentive_guard on public.sales_incentives;
create trigger payroll_incentive_guard
  before update of status on public.sales_incentives
  for each row execute function public.payroll_incentive_guard();

-- ---------------------------------------------------------------------------
-- 5. Admin: everything the Salary page needs for one month
-- ---------------------------------------------------------------------------
create or replace function public.admin_payroll_inputs(p_month date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_from date := date_trunc('month', p_month)::date;
  v_to   date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
  v_set  jsonb;
  v_lock date;
  v_today date := public.sales_today();
begin
  perform public.admin_require('salary');
  if p_month is null or v_from < date '2024-01-01' or v_from > v_today + 31 then
    raise exception 'pick a month' using errcode = '22023';
  end if;
  v_set := public.payroll_settings_get();
  v_lock := public.payroll_lock_on(v_from);
  return jsonb_build_object(
    'month', v_from, 'from', v_from, 'to', v_to, 'today', v_today, 'lock_on', v_lock, 'locked', v_today > v_lock,
    'settings', v_set,
    'work_rules', coalesce((select s.value from public.sales_settings s where s.key = 'work'), '{}'::jsonb),
    'staff', coalesce((
      select jsonb_agg(jsonb_build_object('user_id', s.user_id, 'name', s.name, 'role', s.role, 'shift_start', s.shift_start,
               'shift_end', s.shift_end, 'weekly_off', s.weekly_off, 'active', s.active, 'created_at', s.created_at,
               'has_phone', s.phone is not null) order by s.name)
        from public.sales_staff s
       where s.active
          or exists (select 1 from public.payroll_people p where p.user_id = s.user_id and p.active)
          or exists (select 1 from public.payroll_slips x where x.user_id = s.user_id and x.month = v_from)), '[]'::jsonb),
    'people', coalesce((select jsonb_agg(to_jsonb(p) - 'updated_by') from public.payroll_people p), '[]'::jsonb),
    'attendance', coalesce((
      select jsonb_agg(jsonb_build_object('staff_id', a.staff_id, 'day', a.day, 'first_seen_at', a.first_seen_at,
               'last_seen_at', a.last_seen_at, 'day_start_at', a.day_start_at, 'day_end_at', a.day_end_at,
               'status_override', a.status_override, 'start_lat', a.start_lat, 'start_lng', a.start_lng,
               'end_lat', a.end_lat, 'end_lng', a.end_lng))
        from public.sales_attendance a where a.day between v_from and v_to), '[]'::jsonb),
    'holidays', coalesce((select jsonb_agg(jsonb_build_object('day', h.day, 'name', h.name) order by h.day)
                            from public.sales_holidays h where h.day between v_from and v_to), '[]'::jsonb),
    'leaves', coalesce((select jsonb_agg(jsonb_build_object('staff_id', l.staff_id, 'from_day', l.from_day, 'to_day', l.to_day, 'status', l.status))
                          from public.sales_leave l where l.status = 'approved' and l.from_day <= v_to and l.to_day >= v_from), '[]'::jsonb),
    'works', case when v_from > v_today then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object('staff_id', w.staff_id, 'day', w.day, 'level', w.level, 'active_min', w.active_min))
        from public.sales_work_rows(null, v_from, least(v_to, v_today)) w), '[]'::jsonb) end,
    'visits', coalesce((
      select jsonb_agg(jsonb_build_object('staff_id', v.staff_id, 'at', v.created_at, 'lat', v.lat, 'lng', v.lng) order by v.created_at)
        from public.sales_activities v
       where v.kind = 'visit' and v.lat is not null and v.lng is not null and v.review is distinct from 'rejected'
         and v.created_at >= (v_from::timestamp at time zone 'Asia/Kolkata')
         and v.created_at <  ((v_to + 1)::timestamp at time zone 'Asia/Kolkata')), '[]'::jsonb),
    'incentives', coalesce((
      select jsonb_agg(jsonb_build_object('lead_id', i.lead_id, 'staff_id', i.staff_id, 'shop', coalesce(ld.shop_name, 'A shop'),
               'plan', i.plan, 'amount', i.incentive, 'won_at', i.won_at, 'due_at', i.due_at, 'decided_at', i.decided_at,
               'status', i.status) order by i.decided_at)
        from public.sales_incentives i left join public.sales_leads ld on ld.id = i.lead_id
       where (i.status = 'earned' and not public.payroll_incentive_taken(i.lead_id, i.staff_id))
          or (i.status = 'cancelled' and i.decided_at >= (v_from::timestamp at time zone 'Asia/Kolkata')
              and i.decided_at < ((v_lock + 1)::timestamp at time zone 'Asia/Kolkata'))), '[]'::jsonb),
    'advances', coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id, 'user_id', a.user_id, 'amount', a.amount, 'given_on', a.given_on,
               'per_month', a.per_month, 'note', a.note, 'left', a.amount - public.payroll_advance_taken(a.id)) order by a.given_on)
        from public.payroll_advances a), '[]'::jsonb),
    'leave_left', coalesce((
      select jsonb_object_agg(x.user_id, x.days->'leave_left')
        from (select distinct on (s.user_id) s.user_id, s.days from public.payroll_slips s
               where s.month < v_from and s.status in ('approved', 'paid') order by s.user_id, s.month desc) x), '{}'::jsonb),
    'slips', coalesce((select jsonb_agg(to_jsonb(x) || jsonb_build_object(
                         'approved_by_name', (select t.name from public.admin_team t where t.user_id = x.approved_by),
                         'paid_by_name', (select t.name from public.admin_team t where t.user_id = x.paid_by)) order by x.name)
                         from public.payroll_slips x where x.month = v_from), '[]'::jsonb),
    'past', coalesce((
      select jsonb_agg(jsonb_build_object('month', m.month, 'people', m.n, 'net', m.net, 'paid', m.paid, 'approved', m.approved, 'paid_on', m.paid_on) order by m.month desc)
        from (select s.month, count(*) as n, sum(s.net) as net, count(*) filter (where s.status = 'paid') as paid,
                     count(*) filter (where s.status <> 'draft') as approved, max(s.paid_on) as paid_on
                from public.payroll_slips s where s.month <> v_from group by s.month order by s.month desc limit 12) m), '[]'::jsonb)
  );
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 6. Admin: drafts, lines, approve, paid
-- ---------------------------------------------------------------------------
create or replace function public.admin_payroll_save_drafts(p_month date, p_slips jsonb, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_from    date := date_trunc('month', p_month)::date;
  v_set     jsonb := public.payroll_settings_get();
  v_lock    date := public.payroll_lock_on(p_month);
  r         jsonb;
  l         jsonb;
  v_user    uuid;
  p         record;
  st        record;
  v_old     record;
  v_lines   jsonb;
  v_keys    jsonb;
  v_inc     jsonb;
  v_inc_n   integer;
  v_inc_sum integer;
  v_left    integer;
  v_e       integer;
  v_d       integer;
  v_saved   integer := 0;
  v_total   integer := 0;
  v_skipped jsonb := '[]'::jsonb;
begin
  perform public.admin_require('salary');
  if p_month is null then
    raise exception 'pick a month' using errcode = '22023';
  end if;
  if public.sales_today() <= v_lock then
    raise exception 'This month locks on %. Drafts can be saved after that.', to_char(v_lock, 'FMDD Mon') using errcode = 'P0001';
  end if;
  if p_slips is null or jsonb_typeof(p_slips) <> 'array' or jsonb_array_length(p_slips) = 0 or jsonb_array_length(p_slips) > 200 then
    raise exception 'nothing to save' using errcode = '22023';
  end if;
  for r in select x from jsonb_array_elements(p_slips) x loop
    if coalesce(r->>'user_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'bad person' using errcode = '22023';
    end if;
    v_user := (r->>'user_id')::uuid;
    select * into st from public.sales_staff s where s.user_id = v_user;
    if not found then
      raise exception 'one person is not on the sales team' using errcode = 'P0002';
    end if;
    select * into p from public.payroll_people pp where pp.user_id = v_user and pp.active;
    if not found then
      raise exception 'No salary is set for %. Add it in Salary setup.', st.name using errcode = 'P0001';
    end if;
    select * into v_old from public.payroll_slips s where s.user_id = v_user and s.month = v_from;
    if found and v_old.status <> 'draft' then
      v_skipped := v_skipped || to_jsonb(st.name);
      continue;
    end if;

    v_lines := r->'lines';
    perform public.payroll_check_lines(v_lines, false);
    if (select count(*) from jsonb_array_elements(v_lines) x where x->>'kind' = 'base') <> 1 then
      raise exception 'one base pay line is needed for %', st.name using errcode = '22023';
    end if;
    if (select (x->>'amount')::integer from jsonb_array_elements(v_lines) x where x->>'kind' = 'base') > p.base_monthly then
      raise exception 'Base pay for % is more than the monthly salary.', st.name using errcode = '22023';
    end if;
    if coalesce((select sum(-(x->>'amount')::integer) from jsonb_array_elements(v_lines) x where x->>'kind' = 'tax'), 0)
       <> public.payroll_tax(p.prof_tax, v_from) then
      raise exception 'Professional Tax for % does not match Salary setup.', st.name using errcode = '22023';
    end if;
    if exists (select 1 from jsonb_array_elements(v_lines) x where x->>'kind' = 'travel' and (x->>'amount')::integer > 0)
       and (st.role <> 'field'
            or (select sum((x->>'amount')::integer) from jsonb_array_elements(v_lines) x where x->>'kind' = 'travel')
               > (v_set->>'travel_cap')::numeric * 31) then
      raise exception 'Travel for % is not allowed or is above the daily limit.', st.name using errcode = '22023';
    end if;

    -- Incentives: rebuilt here from the CRM, never taken from the browser.
    v_keys := coalesce(r->'incentive_keys', '[]'::jsonb);
    if jsonb_typeof(v_keys) <> 'array' then
      raise exception 'bad incentives' using errcode = '22023';
    end if;
    select coalesce(jsonb_agg(jsonb_build_object('lead_id', i.lead_id, 'staff_id', i.staff_id, 'shop', coalesce(ld.shop_name, 'A shop'),
             'plan', i.plan, 'amount', i.incentive, 'won_at', i.won_at, 'due_at', i.due_at, 'decided_at', i.decided_at) order by i.decided_at), '[]'::jsonb),
           count(*), coalesce(sum(i.incentive), 0)
      into v_inc, v_inc_n, v_inc_sum
      from public.sales_incentives i left join public.sales_leads ld on ld.id = i.lead_id
     where i.staff_id = v_user and i.status = 'earned'
       and exists (select 1 from jsonb_array_elements(v_keys) k where k->>'lead_id' = i.lead_id::text)
       and not public.payroll_incentive_taken(i.lead_id, i.staff_id);
    if v_inc_n <> jsonb_array_length(v_keys)
       or v_inc_sum <> coalesce((select sum((x->>'amount')::integer) from jsonb_array_elements(v_lines) x where x->>'kind' = 'incentive'), 0) then
      raise exception 'Incentives for % changed since the page loaded. Reload and make the drafts again.', st.name using errcode = 'P0001';
    end if;

    for l in select x from jsonb_array_elements(v_lines) x where x->>'kind' = 'advance' loop
      select a.amount - public.payroll_advance_taken(a.id) into v_left
        from public.payroll_advances a where a.id = (l->>'advance_id')::uuid and a.user_id = v_user;
      if v_left is null or -(l->>'amount')::integer > v_left then
        raise exception 'An advance line for % is more than what is left of that advance.', st.name using errcode = 'P0001';
      end if;
    end loop;

    -- A bonus or deduction added to the old draft stays.
    if v_old.id is not null then
      v_lines := v_lines || coalesce((select jsonb_agg(x) from jsonb_array_elements(v_old.lines) x where x->>'kind' in ('bonus', 'deduction')), '[]'::jsonb);
    end if;
    select t.earnings, t.deductions into v_e, v_d from public.payroll_totals(v_lines) t;
    if v_e - v_d < 0 then
      raise exception 'Pay for % would be below zero.', st.name using errcode = 'P0001';
    end if;

    insert into public.payroll_slips (user_id, month, name, role, status, base_monthly, days, lines, incentives, earnings, deductions, net, made_at, made_by)
    values (v_user, v_from, st.name, st.role, 'draft', p.base_monthly, coalesce(r->'days', '{}'::jsonb), v_lines, v_inc, v_e, v_d, v_e - v_d, now(), auth.uid())
    on conflict (user_id, month) do update
       set name = excluded.name, role = excluded.role, base_monthly = excluded.base_monthly, days = excluded.days,
           lines = excluded.lines, incentives = excluded.incentives, earnings = excluded.earnings,
           deductions = excluded.deductions, net = excluded.net, made_at = now(), made_by = auth.uid()
     where public.payroll_slips.status = 'draft';
    v_saved := v_saved + 1;
    v_total := v_total + (v_e - v_d);
  end loop;
  perform public.admin_log('salary_drafts', 'salary', to_char(v_from, 'YYYY-MM'), null,
    jsonb_build_object('saved', v_saved, 'total', v_total, 'skipped', v_skipped), p_reason);
  return jsonb_build_object('saved', v_saved, 'total', v_total, 'skipped', v_skipped);
end;
$fn$;

create or replace function public.admin_payroll_draft_remove(p_slip uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  s record;
begin
  perform public.admin_require('salary');
  if length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'write a reason' using errcode = '22023';
  end if;
  select * into s from public.payroll_slips x where x.id = p_slip for update;
  if not found then
    raise exception 'salary not found' using errcode = 'P0002';
  end if;
  if s.status <> 'draft' then
    raise exception 'Only a draft can be removed.' using errcode = 'P0001';
  end if;
  delete from public.payroll_slips where id = p_slip;
  perform public.admin_log('salary_draft_removed', 'salary', s.name || ' ' || to_char(s.month, 'YYYY-MM'), jsonb_build_object('net', s.net), null, p_reason);
end;
$fn$;

create or replace function public.admin_payroll_line_add(p_slip uuid, p_kind text, p_amount integer, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  s     record;
  v_why text := btrim(coalesce(p_reason, ''));
  v_me  text;
  v_lines jsonb;
  v_e   integer;
  v_d   integer;
begin
  perform public.admin_require('salary');
  if p_kind not in ('bonus', 'deduction') then
    raise exception 'a bonus or a deduction' using errcode = '22023';
  end if;
  if p_amount is null or p_amount < 1 or p_amount > 1000000 then
    raise exception 'amount: 1 to 10,00,000' using errcode = '22023';
  end if;
  if length(v_why) < 3 or length(v_why) > 120 then
    raise exception 'write a reason (3 to 120 letters); the person sees it' using errcode = '22023';
  end if;
  select * into s from public.payroll_slips x where x.id = p_slip for update;
  if not found then
    raise exception 'salary not found' using errcode = 'P0002';
  end if;
  if s.status <> 'draft' then
    raise exception 'Lines can be added only before it is approved.' using errcode = 'P0001';
  end if;
  select t.name into v_me from public.admin_team t where t.user_id = auth.uid();
  v_lines := s.lines || jsonb_build_array(jsonb_build_object(
    'kind', p_kind, 'label', case when p_kind = 'bonus' then 'Bonus' else 'Deduction' end, 'how', v_why,
    'amount', case when p_kind = 'bonus' then p_amount else -p_amount end, 'by', coalesce(v_me, 'Admin')));
  perform public.payroll_check_lines(v_lines, true);
  select t.earnings, t.deductions into v_e, v_d from public.payroll_totals(v_lines) t;
  if v_e - v_d < 0 then
    raise exception 'Pay would be below zero.' using errcode = 'P0001';
  end if;
  update public.payroll_slips set lines = v_lines, earnings = v_e, deductions = v_d, net = v_e - v_d where id = p_slip;
  perform public.admin_log('salary_line_added', 'salary', s.name || ' ' || to_char(s.month, 'YYYY-MM'),
    jsonb_build_object('net', s.net), jsonb_build_object('kind', p_kind, 'amount', p_amount, 'net', v_e - v_d), v_why);
  return jsonb_build_object('net', v_e - v_d);
end;
$fn$;

create or replace function public.admin_payroll_line_remove(p_slip uuid, p_index integer, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  s     record;
  v_l   jsonb;
  v_lines jsonb;
  v_e   integer;
  v_d   integer;
begin
  perform public.admin_require('salary');
  select * into s from public.payroll_slips x where x.id = p_slip for update;
  if not found then
    raise exception 'salary not found' using errcode = 'P0002';
  end if;
  if s.status <> 'draft' then
    raise exception 'Lines can be removed only before it is approved.' using errcode = 'P0001';
  end if;
  v_l := s.lines -> p_index;
  if v_l is null or coalesce(v_l->>'kind', '') not in ('bonus', 'deduction') then
    raise exception 'Only a bonus or a deduction can be removed.' using errcode = 'P0001';
  end if;
  v_lines := s.lines - p_index;
  select t.earnings, t.deductions into v_e, v_d from public.payroll_totals(v_lines) t;
  if v_e - v_d < 0 then
    raise exception 'Pay would be below zero.' using errcode = 'P0001';
  end if;
  update public.payroll_slips set lines = v_lines, earnings = v_e, deductions = v_d, net = v_e - v_d where id = p_slip;
  perform public.admin_log('salary_line_removed', 'salary', s.name || ' ' || to_char(s.month, 'YYYY-MM'),
    v_l, jsonb_build_object('net', v_e - v_d), p_reason);
  return jsonb_build_object('net', v_e - v_d);
end;
$fn$;

create or replace function public.admin_payroll_approve(p_month date, p_ids uuid[], p_reason text default null)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_from date := date_trunc('month', p_month)::date;
  s      record;
  l      jsonb;
  v_left integer;
  n      integer := 0;
  v_sum  integer := 0;
begin
  perform public.admin_require('salary_approve');
  for s in select * from public.payroll_slips x
            where x.month = v_from and x.status = 'draft' and (p_ids is null or x.id = any(p_ids))
            order by x.name for update loop
    if exists (select 1 from jsonb_array_elements(s.incentives) k
                where not exists (select 1 from public.sales_incentives i
                                   where i.lead_id::text = k->>'lead_id' and i.staff_id::text = k->>'staff_id' and i.status = 'earned')
                   or public.payroll_incentive_taken((k->>'lead_id')::uuid, (k->>'staff_id')::uuid)) then
      raise exception 'An incentive in the salary of % changed in the CRM. Make the drafts again.', s.name using errcode = 'P0001';
    end if;
    for l in select x from jsonb_array_elements(s.lines) x where x->>'kind' = 'advance' loop
      select a.amount - public.payroll_advance_taken(a.id) into v_left from public.payroll_advances a where a.id = (l->>'advance_id')::uuid;
      if v_left is null or -(l->>'amount')::integer > v_left then
        raise exception 'An advance in the salary of % changed. Make the drafts again.', s.name using errcode = 'P0001';
      end if;
    end loop;
    update public.payroll_slips set status = 'approved', approved_at = now(), approved_by = auth.uid() where id = s.id;
    n := n + 1;
    v_sum := v_sum + s.net;
  end loop;
  if n = 0 then
    raise exception 'Nothing waiting for approval.' using errcode = 'P0001';
  end if;
  perform public.admin_log('salary_approved', 'salary', to_char(v_from, 'YYYY-MM'), null, jsonb_build_object('count', n, 'total', v_sum), p_reason);
  return n;
end;
$fn$;

create or replace function public.admin_payroll_unapprove(p_slip uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  s record;
begin
  perform public.admin_require('salary_approve');
  if length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'write a reason' using errcode = '22023';
  end if;
  select * into s from public.payroll_slips x where x.id = p_slip for update;
  if not found then
    raise exception 'salary not found' using errcode = 'P0002';
  end if;
  if s.status <> 'approved' then
    raise exception 'Only an approved salary that is not paid can go back to draft.' using errcode = 'P0001';
  end if;
  update public.payroll_slips set status = 'draft', approved_at = null, approved_by = null where id = p_slip;
  perform public.admin_log('salary_unapproved', 'salary', s.name || ' ' || to_char(s.month, 'YYYY-MM'), null, jsonb_build_object('net', s.net), p_reason);
end;
$fn$;

create or replace function public.admin_payroll_mark_paid(p_slip uuid, p_method text, p_ref text, p_paid_on date, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  s     record;
  v_ref text := nullif(btrim(coalesce(p_ref, '')), '');
  v_n   integer;
begin
  perform public.admin_require('salary');
  select * into s from public.payroll_slips x where x.id = p_slip for update;
  if not found then
    raise exception 'salary not found' using errcode = 'P0002';
  end if;
  if s.status = 'paid' then
    raise exception 'This salary is already marked paid.' using errcode = 'P0001';
  end if;
  if s.status <> 'approved' then
    raise exception 'The Owner approves it first.' using errcode = 'P0001';
  end if;
  if coalesce(p_method, '') not in ('upi', 'bank', 'cash') then
    raise exception 'paid by UPI, bank transfer or cash' using errcode = '22023';
  end if;
  if p_method <> 'cash' and v_ref is null then
    raise exception 'Type the reference number from your bank app.' using errcode = '22023';
  end if;
  if v_ref is not null and length(v_ref) > 60 then
    raise exception 'reference: up to 60 letters' using errcode = '22023';
  end if;
  if p_paid_on is null or p_paid_on > public.sales_today() or p_paid_on < s.month then
    raise exception 'pick the day you paid' using errcode = '22023';
  end if;
  perform set_config('payroll.paying', 'on', true);
  update public.sales_incentives i
     set status = 'paid', paid_at = now(), paid_by = auth.uid()
   where i.status = 'earned'
     and exists (select 1 from jsonb_array_elements(s.incentives) k where k->>'lead_id' = i.lead_id::text and k->>'staff_id' = i.staff_id::text);
  get diagnostics v_n = row_count;
  perform set_config('payroll.paying', 'off', true);
  update public.payroll_slips
     set status = 'paid', paid_at = now(), paid_by = auth.uid(), paid_on = p_paid_on, paid_method = p_method, paid_ref = v_ref
   where id = p_slip;
  perform public.admin_log('salary_paid', 'salary', s.name || ' ' || to_char(s.month, 'YYYY-MM'), null,
    jsonb_build_object('net', s.net, 'method', p_method, 'paid_on', p_paid_on, 'incentives_paid', v_n), p_reason);
  return jsonb_build_object('net', s.net, 'incentives_paid', v_n);
end;
$fn$;

-- A payment marked by mistake: back to approved, its incentives back to earned.
create or replace function public.admin_payroll_undo_paid(p_slip uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  s record;
begin
  perform public.admin_require('salary_approve');
  if length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'write a reason' using errcode = '22023';
  end if;
  select * into s from public.payroll_slips x where x.id = p_slip for update;
  if not found then
    raise exception 'salary not found' using errcode = 'P0002';
  end if;
  if s.status <> 'paid' then
    raise exception 'This salary is not marked paid.' using errcode = 'P0001';
  end if;
  perform set_config('payroll.paying', 'on', true);
  update public.sales_incentives i
     set status = 'earned', paid_at = null, paid_by = null
   where i.status = 'paid'
     and exists (select 1 from jsonb_array_elements(s.incentives) k where k->>'lead_id' = i.lead_id::text and k->>'staff_id' = i.staff_id::text);
  perform set_config('payroll.paying', 'off', true);
  update public.payroll_slips
     set status = 'approved', paid_at = null, paid_by = null, paid_on = null, paid_method = null, paid_ref = null, notified_at = null
   where id = p_slip;
  perform public.admin_log('salary_unpaid', 'salary', s.name || ' ' || to_char(s.month, 'YYYY-MM'),
    jsonb_build_object('paid_on', s.paid_on, 'method', s.paid_method), null, p_reason);
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 7. Admin: setup (Owner) and advances (Owner, Finance)
-- ---------------------------------------------------------------------------
create or replace function public.admin_payroll_settings_save(p_value jsonb, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_old jsonb := public.payroll_settings_get();
  v_new jsonb;
begin
  perform public.admin_require('salary_approve');
  v_new := public.payroll_settings_clean(p_value);
  update public.payroll_settings
     set value = value || v_new, updated_at = now(), updated_by = auth.uid()
   where id;
  perform public.admin_log('salary_rules', 'salary', 'rules', v_old, public.payroll_settings_get(), p_reason);
  return public.payroll_settings_get();
end;
$fn$;

create or replace function public.admin_payroll_person_save(p_user uuid, p_base integer, p_joined date, p_employee_no text,
                                                            p_pay_to text, p_prof_tax text, p_active boolean, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  st    record;
  v_old jsonb;
begin
  perform public.admin_require('salary_approve');
  select * into st from public.sales_staff s where s.user_id = p_user;
  if not found then
    raise exception 'not on the sales team' using errcode = 'P0002';
  end if;
  if p_base is null or p_base < 0 or p_base > 1000000 then
    raise exception 'salary: 0 to 10,00,000 a month' using errcode = '22023';
  end if;
  if p_joined is null or p_joined < date '2000-01-01' or p_joined > public.sales_today() + 60 then
    raise exception 'pick the day they joined' using errcode = '22023';
  end if;
  if coalesce(p_prof_tax, '') not in ('none', '175', '200') then
    raise exception 'Professional Tax: none, 175 or 200' using errcode = '22023';
  end if;
  if length(coalesce(p_employee_no, '')) > 20 or length(coalesce(p_pay_to, '')) > 120 then
    raise exception 'too long' using errcode = '22023';
  end if;
  select to_jsonb(pp) - 'updated_at' - 'updated_by' into v_old from public.payroll_people pp where pp.user_id = p_user;
  insert into public.payroll_people (user_id, base_monthly, joined_on, employee_no, pay_to, prof_tax, active, updated_at, updated_by)
  values (p_user, p_base, p_joined, nullif(btrim(coalesce(p_employee_no, '')), ''), nullif(btrim(coalesce(p_pay_to, '')), ''),
          p_prof_tax, coalesce(p_active, true), now(), auth.uid())
  on conflict (user_id) do update
     set base_monthly = excluded.base_monthly, joined_on = excluded.joined_on, employee_no = excluded.employee_no,
         pay_to = excluded.pay_to, prof_tax = excluded.prof_tax, active = excluded.active, updated_at = now(), updated_by = auth.uid();
  perform public.admin_log('salary_person', 'salary', st.name,
    case when v_old is null then null else v_old - 'pay_to' || jsonb_build_object('pay_to', public.payroll_mask(v_old->>'pay_to')) end,
    jsonb_build_object('base_monthly', p_base, 'joined_on', p_joined, 'prof_tax', p_prof_tax, 'active', coalesce(p_active, true),
                       'pay_to', public.payroll_mask(p_pay_to)), p_reason);
end;
$fn$;

create or replace function public.admin_payroll_advance_add(p_user uuid, p_amount integer, p_given_on date, p_per_month integer, p_note text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_name text;
  v_id   uuid;
  v_note text := btrim(coalesce(p_note, ''));
begin
  perform public.admin_require('salary');
  select s.name into v_name from public.sales_staff s join public.payroll_people p on p.user_id = s.user_id where s.user_id = p_user;
  if v_name is null then
    raise exception 'Set their salary first.' using errcode = 'P0002';
  end if;
  if p_amount is null or p_amount < 1 or p_amount > 1000000 then
    raise exception 'amount: 1 to 10,00,000' using errcode = '22023';
  end if;
  if p_per_month is not null and (p_per_month < 1 or p_per_month > p_amount) then
    raise exception 'taken back each month: 1 to the amount' using errcode = '22023';
  end if;
  if p_given_on is null or p_given_on > public.sales_today() or p_given_on < public.sales_today() - 366 then
    raise exception 'pick the day it was given' using errcode = '22023';
  end if;
  if length(v_note) < 1 or length(v_note) > 200 then
    raise exception 'write what it was for' using errcode = '22023';
  end if;
  insert into public.payroll_advances (user_id, amount, given_on, per_month, note, created_by)
  values (p_user, p_amount, p_given_on, p_per_month, v_note, auth.uid()) returning id into v_id;
  perform public.admin_log('salary_advance', 'salary', v_name, null,
    jsonb_build_object('amount', p_amount, 'given_on', p_given_on, 'per_month', p_per_month), v_note);
  return v_id;
end;
$fn$;

create or replace function public.admin_payroll_advance_remove(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  a record;
begin
  perform public.admin_require('salary');
  if length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'write a reason' using errcode = '22023';
  end if;
  select * into a from public.payroll_advances x where x.id = p_id for update;
  if not found then
    raise exception 'advance not found' using errcode = 'P0002';
  end if;
  if public.payroll_advance_taken(p_id) > 0 then
    raise exception 'Part of it was already taken back in an approved salary, so it stays on record.' using errcode = 'P0001';
  end if;
  delete from public.payroll_advances where id = p_id;
  perform public.admin_log('salary_advance_removed', 'salary', (select s.name from public.sales_staff s where s.user_id = a.user_id),
    jsonb_build_object('amount', a.amount, 'given_on', a.given_on), null, p_reason);
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 8. WhatsApp message when paid (the admin-salary edge function asks these
--    as the signed-in person; nothing is sent when the template is not set)
-- ---------------------------------------------------------------------------
create or replace function public.admin_payroll_notify_data(p_slip uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
declare
  s record;
begin
  perform public.admin_require('salary');
  select x.*, st.phone into s from public.payroll_slips x left join public.sales_staff st on st.user_id = x.user_id where x.id = p_slip;
  if not found then
    raise exception 'salary not found' using errcode = 'P0002';
  end if;
  if s.status <> 'paid' then
    raise exception 'not paid yet' using errcode = 'P0001';
  end if;
  return jsonb_build_object('name', split_part(btrim(s.name), ' ', 1), 'month', to_char(s.month, 'FMMonth YYYY'), 'net', s.net,
    'method', s.paid_method, 'phone', s.phone, 'notified_at', s.notified_at,
    'whatsapp_on', coalesce((public.payroll_settings_get()->>'whatsapp_on')::boolean, true));
end;
$fn$;

create or replace function public.admin_payroll_notified(p_slip uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  perform public.admin_require('salary');
  update public.payroll_slips set notified_at = now() where id = p_slip and status = 'paid';
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 9. CRM: my own pay, and nobody else's
-- ---------------------------------------------------------------------------
create or replace function public.sales_my_pay()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_me uuid := auth.uid();
  p    record;
begin
  if v_me is null or not public.sales_is_staff() then
    raise exception 'not on the sales team' using errcode = '42501';
  end if;
  select * into p from public.payroll_people pp where pp.user_id = v_me;
  return jsonb_build_object(
    'person', case when p.user_id is null then null else jsonb_build_object('base_monthly', p.base_monthly, 'joined_on', p.joined_on,
                'employee_no', p.employee_no, 'prof_tax', p.prof_tax, 'pay_to', public.payroll_mask(p.pay_to), 'active', p.active) end,
    'settings', public.payroll_settings_get(),
    'slips', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'month', s.month, 'status', s.status, 'name', s.name, 'role', s.role,
               'base_monthly', s.base_monthly, 'days', s.days, 'lines', s.lines, 'incentives', s.incentives,
               'earnings', s.earnings, 'deductions', s.deductions, 'net', s.net, 'approved_at', s.approved_at,
               'paid_on', s.paid_on, 'paid_method', s.paid_method, 'paid_ref', s.paid_ref,
               'approved_by_name', (select t.name from public.admin_team t where t.user_id = s.approved_by)) order by s.month desc)
        from (select * from public.payroll_slips x where x.user_id = v_me and x.status in ('approved', 'paid') order by x.month desc limit 24) s), '[]'::jsonb),
    'advances', coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id, 'amount', a.amount, 'given_on', a.given_on, 'per_month', a.per_month,
               'left', a.amount - public.payroll_advance_taken(a.id)) order by a.given_on)
        from public.payroll_advances a where a.user_id = v_me), '[]'::jsonb),
    'leave_left', (select s.days->'leave_left' from public.payroll_slips s
                    where s.user_id = v_me and s.status in ('approved', 'paid') order by s.month desc limit 1)
  );
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 10. Salary rows in the audit log: every Admin role sees that something
--     changed (who, when, whose salary), but amounts and reasons only reach
--     the Owner and Finance. The same in the table's own read rule, the Audit
--     log page and Home's "Changes made in Admin". (Both functions are as
--     admin-part1-forward.sql made them, plus this.)
-- ---------------------------------------------------------------------------
drop policy if exists admin_audit_read on public.admin_audit;
create policy admin_audit_read on public.admin_audit
  for select to authenticated using (public.admin_can('see')
    and (target_kind is distinct from 'salary' or public.admin_can('salary')));

create or replace function public.admin_audit_list(p_kind text default null, p_before timestamptz default null)
returns setof public.admin_audit
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_pay boolean;
begin
  perform public.admin_require('see');
  v_pay := public.admin_can('salary');
  return query
  select a.id, a.at, a.actor, a.actor_name, a.actor_role, a.action, a.target_kind, a.target,
         case when a.target_kind = 'salary' and not v_pay then null else a.before end,
         case when a.target_kind = 'salary' and not v_pay then null else a.after end,
         case when a.target_kind = 'salary' and not v_pay then null else a.reason end,
         a.ip, a.agent
    from public.admin_audit a
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
      'recent', coalesce((select jsonb_agg(jsonb_build_object('at', a.at, 'who', a.actor_name, 'action', a.action, 'kind', a.target_kind, 'target', a.target,
                                                 'reason', case when a.target_kind = 'salary' and not public.admin_can('salary') then null else a.reason end) order by a.at desc)
                            from (select * from public.admin_audit order by at desc limit 8) a), '[]'::jsonb)
    )
  );
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 11. Access: Supabase gives anon and authenticated EXECUTE on every new
--     function by default, so each one is closed and opened again on purpose.
-- ---------------------------------------------------------------------------
revoke all on function public.admin_can(text) from public, anon;
grant execute on function public.admin_can(text) to authenticated;

revoke all on function public.payroll_settings_get() from public, anon, authenticated;
revoke all on function public.payroll_settings_clean(jsonb) from public, anon, authenticated;
revoke all on function public.payroll_mask(text) from public, anon, authenticated;
revoke all on function public.payroll_advance_taken(uuid) from public, anon, authenticated;
revoke all on function public.payroll_incentive_taken(uuid, uuid) from public, anon, authenticated;
revoke all on function public.payroll_check_lines(jsonb, boolean) from public, anon, authenticated;
revoke all on function public.payroll_totals(jsonb) from public, anon, authenticated;
revoke all on function public.payroll_lock_on(date) from public, anon, authenticated;
revoke all on function public.payroll_tax(text, date) from public, anon, authenticated;
revoke all on function public.payroll_incentive_guard() from public, anon, authenticated;

revoke all on function public.admin_payroll_inputs(date) from public, anon;
revoke all on function public.admin_payroll_save_drafts(date, jsonb, text) from public, anon;
revoke all on function public.admin_payroll_draft_remove(uuid, text) from public, anon;
revoke all on function public.admin_payroll_line_add(uuid, text, integer, text) from public, anon;
revoke all on function public.admin_payroll_line_remove(uuid, integer, text) from public, anon;
revoke all on function public.admin_payroll_approve(date, uuid[], text) from public, anon;
revoke all on function public.admin_payroll_unapprove(uuid, text) from public, anon;
revoke all on function public.admin_payroll_mark_paid(uuid, text, text, date, text) from public, anon;
revoke all on function public.admin_payroll_undo_paid(uuid, text) from public, anon;
revoke all on function public.admin_payroll_settings_save(jsonb, text) from public, anon;
revoke all on function public.admin_payroll_person_save(uuid, integer, date, text, text, text, boolean, text) from public, anon;
revoke all on function public.admin_payroll_advance_add(uuid, integer, date, integer, text) from public, anon;
revoke all on function public.admin_payroll_advance_remove(uuid, text) from public, anon;
revoke all on function public.admin_payroll_notify_data(uuid) from public, anon;
revoke all on function public.admin_payroll_notified(uuid) from public, anon;
revoke all on function public.sales_my_pay() from public, anon;
revoke all on function public.admin_audit_list(text, timestamptz) from public, anon;
revoke all on function public.admin_home() from public, anon;

grant execute on function public.admin_payroll_inputs(date) to authenticated;
grant execute on function public.admin_payroll_save_drafts(date, jsonb, text) to authenticated;
grant execute on function public.admin_payroll_draft_remove(uuid, text) to authenticated;
grant execute on function public.admin_payroll_line_add(uuid, text, integer, text) to authenticated;
grant execute on function public.admin_payroll_line_remove(uuid, integer, text) to authenticated;
grant execute on function public.admin_payroll_approve(date, uuid[], text) to authenticated;
grant execute on function public.admin_payroll_unapprove(uuid, text) to authenticated;
grant execute on function public.admin_payroll_mark_paid(uuid, text, text, date, text) to authenticated;
grant execute on function public.admin_payroll_undo_paid(uuid, text) to authenticated;
grant execute on function public.admin_payroll_settings_save(jsonb, text) to authenticated;
grant execute on function public.admin_payroll_person_save(uuid, integer, date, text, text, text, boolean, text) to authenticated;
grant execute on function public.admin_payroll_advance_add(uuid, integer, date, integer, text) to authenticated;
grant execute on function public.admin_payroll_advance_remove(uuid, text) to authenticated;
grant execute on function public.admin_payroll_notify_data(uuid) to authenticated;
grant execute on function public.admin_payroll_notified(uuid) to authenticated;
grant execute on function public.sales_my_pay() to authenticated;
grant execute on function public.admin_audit_list(text, timestamptz) to authenticated;
grant execute on function public.admin_home() to authenticated;

commit;
