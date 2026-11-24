-- ===========================================================================
--  PocketLink Sales CRM (crm.pocketlink.store)  --  FORWARD, part 1 (additive)
--
--  Founder, 2026-11-23/24: a strong CRM for the sales team (field executives,
--  calling executives, managers) at crm.pocketlink.store, replacing the Hub.
--  It must show NO shop, order or admin data.
--
--  Why new tables instead of the Hub's crm_* ones: every Hub policy keys off
--  is_crm_member(), and crm_team membership also opens ALL orders and
--  store_views (supabase-sales-hub.sql). CRM staff live in sales_staff, which
--  no policy on stores, orders or store_views mentions, so a CRM login can
--  never read shop data -- the database refuses it, not just the screens.
--
--  What this file adds (nothing existing is altered):
--    sales_staff        who works in the CRM and their role
--    sales_leads        one row per phone number
--    sales_activities   calls, visits (location + photo), notes, stage changes
--    sales_attendance   login time, day start / end with location
--    sales_holidays     the manager's holiday list
--    sales_leave        leave requests
--    functions          role helpers, duplicate lookup, logging, assigning,
--                       attendance -- all with a pinned search_path
--    storage bucket     sales-visits (private), one folder per person
--
--  Access:
--    manager            every lead, activity, attendance row; assigns; staff
--    caller / field     only leads assigned to them, and their own activity
--  anon has nothing.
--
--  Run order: this -> sales-crm-verify.sql (all PASS) -> sales-crm-import.sql
--  -> verify again. Undo: sales-crm-ROLLBACK.sql.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Staff
-- ---------------------------------------------------------------------------
create table if not exists public.sales_staff (
  user_id        uuid primary key references auth.users (id) on delete cascade,
  name           text not null check (length(btrim(name)) between 1 and 80),
  email          text,
  role           text not null check (role in ('manager', 'caller', 'field')),
  phone          text check (phone is null or phone ~ '^[0-9]{10}$'),
  area           text check (area is null or length(area) <= 120),
  shift_start    time not null default '09:30',
  shift_end      time not null default '18:30',
  weekly_off     smallint not null default 0 check (weekly_off between 0 and 6),
  daily_target   integer check (daily_target is null or daily_target between 0 and 1000),
  monthly_target integer check (monthly_target is null or monthly_target between 0 and 1000),
  active         boolean not null default true,
  created_at     timestamptz not null default now()
);

comment on column public.sales_staff.weekly_off is '0 = Sunday ... 6 = Saturday (JavaScript getDay).';

-- Role of the signed-in user, or null. SECURITY DEFINER so policies can call it
-- without recursing into sales_staff's own policies.
create or replace function public.sales_role()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select s.role from public.sales_staff s where s.user_id = auth.uid() and s.active
$fn$;

create or replace function public.sales_is_staff()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select exists (select 1 from public.sales_staff s where s.user_id = auth.uid() and s.active)
$fn$;

create or replace function public.sales_is_manager()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select exists (select 1 from public.sales_staff s where s.user_id = auth.uid() and s.active and s.role = 'manager')
$fn$;

revoke all on function public.sales_role() from public, anon;
revoke all on function public.sales_is_staff() from public, anon;
revoke all on function public.sales_is_manager() from public, anon;
grant execute on function public.sales_role() to authenticated;
grant execute on function public.sales_is_staff() to authenticated;
grant execute on function public.sales_is_manager() to authenticated;

alter table public.sales_staff enable row level security;
revoke all on public.sales_staff from public, anon, authenticated;
grant select, update on public.sales_staff to authenticated;

drop policy if exists sales_staff_read on public.sales_staff;
create policy sales_staff_read on public.sales_staff
  for select to authenticated
  using (public.sales_is_staff());

drop policy if exists sales_staff_manage on public.sales_staff;
create policy sales_staff_manage on public.sales_staff
  for update to authenticated
  using (public.sales_is_manager())
  with check (public.sales_is_manager());

-- ---------------------------------------------------------------------------
-- 2. Leads
-- ---------------------------------------------------------------------------
create table if not exists public.sales_leads (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  shop_name        text not null check (length(btrim(shop_name)) between 1 and 120),
  owner_name       text check (owner_name is null or length(owner_name) <= 80),
  phone            text not null check (phone ~ '^[0-9]{10}$'),
  business_type    text check (business_type is null or length(business_type) <= 60),
  city             text check (city is null or length(city) <= 80),
  area             text check (area is null or length(area) <= 120),
  source           text not null default 'manual' check (source in (
                     'manual', 'field', 'calling_list', 'referral', 'walk_in', 'import', 'hub',
                     'signup', 'pending_signup', 'facebook', 'instagram', 'google', 'whatsapp', 'website')),
  source_detail    text check (source_detail is null or length(source_detail) <= 200),
  stage            text not null default 'new' check (stage in ('new', 'contacted', 'demo', 'interested', 'won', 'lost')),
  heat             text check (heat is null or heat in ('hot', 'warm', 'cold')),
  won_plan         text check (won_plan is null or length(won_plan) <= 40),
  won_amount       integer check (won_amount is null or won_amount between 0 and 10000000),
  lost_reason      text check (lost_reason is null or length(lost_reason) <= 200),
  signed_up        boolean not null default false,
  store_slug       text,
  next_action_at   timestamptz,
  next_action      text check (next_action is null or length(next_action) <= 200),
  assigned_to      uuid references public.sales_staff (user_id) on delete set null,
  created_by       uuid,
  last_activity_at timestamptz,
  call_attempts    integer not null default 0,
  hub_lead_id      uuid unique
);

create unique index if not exists sales_leads_phone_key on public.sales_leads (phone);
create index if not exists sales_leads_assigned_idx on public.sales_leads (assigned_to, next_action_at);
create index if not exists sales_leads_stage_idx on public.sales_leads (stage);
create index if not exists sales_leads_created_idx on public.sales_leads (created_at desc);

comment on column public.sales_leads.store_slug is
  'Internal link to a PocketLink shop for win checks. Never shown in the CRM.';

-- Keep updated_at honest, and stop non-managers from moving a lead to someone
-- else or rewriting who created it.
create or replace function public.sales_leads_guard()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $fn$
begin
  new.updated_at := now();
  -- auth.uid() is null for trusted server work (this migration, the service
  -- role); only a signed-in non-manager is held back.
  if tg_op = 'UPDATE' and auth.uid() is not null and not public.sales_is_manager() then
    if new.assigned_to is distinct from old.assigned_to then
      raise exception 'only a manager can move a lead' using errcode = '42501';
    end if;
    new.created_by := old.created_by;
    new.hub_lead_id := old.hub_lead_id;
    new.store_slug := old.store_slug;
  end if;
  if tg_op = 'INSERT' and auth.uid() is not null then
    new.created_by := auth.uid();
  end if;
  return new;
end;
$fn$;

drop trigger if exists sales_leads_guard on public.sales_leads;
create trigger sales_leads_guard
  before insert or update on public.sales_leads
  for each row execute function public.sales_leads_guard();

alter table public.sales_leads enable row level security;
revoke all on public.sales_leads from public, anon, authenticated;
grant select, insert, update, delete on public.sales_leads to authenticated;

drop policy if exists sales_leads_read on public.sales_leads;
create policy sales_leads_read on public.sales_leads
  for select to authenticated
  using (public.sales_is_manager() or (public.sales_is_staff() and assigned_to = auth.uid()));

drop policy if exists sales_leads_add on public.sales_leads;
create policy sales_leads_add on public.sales_leads
  for insert to authenticated
  with check (public.sales_is_manager() or (public.sales_is_staff() and assigned_to = auth.uid()));

drop policy if exists sales_leads_edit on public.sales_leads;
create policy sales_leads_edit on public.sales_leads
  for update to authenticated
  using (public.sales_is_manager() or (public.sales_is_staff() and assigned_to = auth.uid()))
  with check (public.sales_is_manager() or (public.sales_is_staff() and assigned_to = auth.uid()));

drop policy if exists sales_leads_remove on public.sales_leads;
create policy sales_leads_remove on public.sales_leads
  for delete to authenticated
  using (public.sales_is_manager());

-- ---------------------------------------------------------------------------
-- 3. Activities (calls, visits, notes, stage changes, assignments)
-- ---------------------------------------------------------------------------
create table if not exists public.sales_activities (
  id           uuid primary key default gen_random_uuid(),
  lead_id      uuid not null references public.sales_leads (id) on delete cascade,
  staff_id     uuid references public.sales_staff (user_id) on delete set null,
  kind         text not null check (kind in ('call', 'visit', 'note', 'stage', 'assign', 'system')),
  outcome      text check (outcome is null or length(outcome) <= 60),
  note         text check (note is null or length(note) <= 2000),
  duration_sec integer check (duration_sec is null or duration_sec between 0 and 86400),
  lat          double precision check (lat is null or lat between -90 and 90),
  lng          double precision check (lng is null or lng between -180 and 180),
  accuracy_m   integer check (accuracy_m is null or accuracy_m between 0 and 100000),
  photo_path   text check (photo_path is null or length(photo_path) <= 300),
  created_at   timestamptz not null default now()
);

create index if not exists sales_activities_lead_idx on public.sales_activities (lead_id, created_at desc);
create index if not exists sales_activities_staff_idx on public.sales_activities (staff_id, created_at desc);

alter table public.sales_activities enable row level security;
revoke all on public.sales_activities from public, anon, authenticated;
grant select, insert, delete on public.sales_activities to authenticated;

drop policy if exists sales_activities_read on public.sales_activities;
create policy sales_activities_read on public.sales_activities
  for select to authenticated
  using (
    public.sales_is_manager()
    or (public.sales_is_staff() and (
      staff_id = auth.uid()
      or exists (select 1 from public.sales_leads l where l.id = lead_id and l.assigned_to = auth.uid())
    ))
  );

drop policy if exists sales_activities_add on public.sales_activities;
create policy sales_activities_add on public.sales_activities
  for insert to authenticated
  with check (
    public.sales_is_staff() and staff_id = auth.uid()
    and (public.sales_is_manager()
         or exists (select 1 from public.sales_leads l where l.id = lead_id and l.assigned_to = auth.uid()))
  );

drop policy if exists sales_activities_remove on public.sales_activities;
create policy sales_activities_remove on public.sales_activities
  for delete to authenticated
  using (public.sales_is_manager());

-- ---------------------------------------------------------------------------
-- 4. Attendance, holidays, leave
-- ---------------------------------------------------------------------------
create table if not exists public.sales_attendance (
  staff_id      uuid not null references public.sales_staff (user_id) on delete cascade,
  day           date not null,
  first_seen_at timestamptz,
  last_seen_at  timestamptz,
  day_start_at  timestamptz,
  start_lat     double precision,
  start_lng     double precision,
  start_acc     integer,
  day_end_at    timestamptz,
  end_lat       double precision,
  end_lng       double precision,
  end_acc       integer,
  status_override text check (status_override is null or status_override in ('present', 'late', 'half', 'absent', 'leave')),
  note          text check (note is null or length(note) <= 300),
  primary key (staff_id, day)
);

alter table public.sales_attendance enable row level security;
revoke all on public.sales_attendance from public, anon, authenticated;
grant select, insert, update on public.sales_attendance to authenticated;

drop policy if exists sales_attendance_read on public.sales_attendance;
create policy sales_attendance_read on public.sales_attendance
  for select to authenticated
  using (public.sales_is_manager() or (public.sales_is_staff() and staff_id = auth.uid()));

-- Only a manager edits a row by hand (an override or a note); everyone else
-- writes through sales_touch() / sales_day().
drop policy if exists sales_attendance_manage on public.sales_attendance;
create policy sales_attendance_manage on public.sales_attendance
  for update to authenticated
  using (public.sales_is_manager())
  with check (public.sales_is_manager());

-- A manager may also mark a day that has no login yet (leave, absent).
drop policy if exists sales_attendance_mark on public.sales_attendance;
create policy sales_attendance_mark on public.sales_attendance
  for insert to authenticated
  with check (public.sales_is_manager());

create table if not exists public.sales_holidays (
  day  date primary key,
  name text not null check (length(btrim(name)) between 1 and 80)
);

alter table public.sales_holidays enable row level security;
revoke all on public.sales_holidays from public, anon, authenticated;
grant select, insert, delete on public.sales_holidays to authenticated;

drop policy if exists sales_holidays_read on public.sales_holidays;
create policy sales_holidays_read on public.sales_holidays
  for select to authenticated using (public.sales_is_staff());

drop policy if exists sales_holidays_add on public.sales_holidays;
create policy sales_holidays_add on public.sales_holidays
  for insert to authenticated with check (public.sales_is_manager());

drop policy if exists sales_holidays_remove on public.sales_holidays;
create policy sales_holidays_remove on public.sales_holidays
  for delete to authenticated using (public.sales_is_manager());

create table if not exists public.sales_leave (
  id         uuid primary key default gen_random_uuid(),
  staff_id   uuid not null references public.sales_staff (user_id) on delete cascade,
  from_day   date not null,
  to_day     date not null,
  reason     text check (reason is null or length(reason) <= 300),
  status     text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  decided_by uuid,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  check (to_day >= from_day and to_day - from_day <= 60)
);

create index if not exists sales_leave_staff_idx on public.sales_leave (staff_id, from_day);

alter table public.sales_leave enable row level security;
revoke all on public.sales_leave from public, anon, authenticated;
grant select, insert, update on public.sales_leave to authenticated;

drop policy if exists sales_leave_read on public.sales_leave;
create policy sales_leave_read on public.sales_leave
  for select to authenticated
  using (public.sales_is_manager() or (public.sales_is_staff() and staff_id = auth.uid()));

drop policy if exists sales_leave_ask on public.sales_leave;
create policy sales_leave_ask on public.sales_leave
  for insert to authenticated
  with check (public.sales_is_staff() and staff_id = auth.uid() and status = 'pending');

drop policy if exists sales_leave_decide on public.sales_leave;
create policy sales_leave_decide on public.sales_leave
  for update to authenticated
  using (public.sales_is_manager())
  with check (public.sales_is_manager());

-- ---------------------------------------------------------------------------
-- 5. Functions the app calls
-- ---------------------------------------------------------------------------

-- Is this number already a lead? Any staff member may ask, so two people never
-- work the same shop; the answer names the owner but nothing else of the lead.
create or replace function public.sales_phone_lookup(p_phone text)
returns table (lead_id uuid, shop_name text, stage text, owner_name text, mine boolean)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_phone text := right(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'), 10);
begin
  if not public.sales_is_staff() or length(v_phone) <> 10 then
    return;
  end if;
  return query
    select l.id, l.shop_name, l.stage, s.name, coalesce(l.assigned_to = auth.uid(), false)
      from public.sales_leads l
      left join public.sales_staff s on s.user_id = l.assigned_to
     where l.phone = v_phone;
end;
$fn$;

-- Log a call, visit or note and move the lead on, in one step. SECURITY
-- INVOKER: the caller's own row-level rules decide what they may touch.
create or replace function public.sales_log(
  p_lead      uuid,
  p_kind      text,
  p_outcome   text default null,
  p_note      text default null,
  p_stage     text default null,
  p_next_at   timestamptz default null,
  p_next      text default null,
  p_lat       double precision default null,
  p_lng       double precision default null,
  p_acc       integer default null,
  p_photo     text default null,
  p_duration  integer default null,
  p_lost      text default null
)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $fn$
declare
  v_id    uuid;
  v_found boolean;
begin
  if p_kind not in ('call', 'visit', 'note') then
    raise exception 'bad kind' using errcode = '22023';
  end if;
  if p_kind = 'visit' and (p_photo is null or p_lat is null or p_lng is null) then
    raise exception 'a visit needs a photo and a location' using errcode = '22023';
  end if;
  if p_photo is not null and split_part(p_photo, '/', 1) <> auth.uid()::text then
    raise exception 'photo must be your own upload' using errcode = '42501';
  end if;

  update public.sales_leads
     set stage            = coalesce(p_stage, stage),
         next_action_at   = case when p_next_at is not null or p_stage in ('won', 'lost') then p_next_at else next_action_at end,
         next_action      = case when p_next_at is not null or p_stage in ('won', 'lost') then p_next else next_action end,
         lost_reason      = case when p_stage = 'lost' then coalesce(p_lost, lost_reason) else lost_reason end,
         last_activity_at = now(),
         call_attempts    = case when p_kind = 'call' and p_outcome = 'no_answer' then call_attempts + 1
                                 when p_kind = 'call' then 0 else call_attempts end
   where id = p_lead
  returning true into v_found;

  if not coalesce(v_found, false) then
    raise exception 'lead not found' using errcode = 'P0002';
  end if;

  -- A note with no text is only a stage change: no empty note in the history.
  if p_kind <> 'note' or nullif(btrim(coalesce(p_note, '')), '') is not null then
    insert into public.sales_activities (lead_id, staff_id, kind, outcome, note, lat, lng, accuracy_m, photo_path, duration_sec)
    values (p_lead, auth.uid(), p_kind, p_outcome, nullif(btrim(coalesce(p_note, '')), ''), p_lat, p_lng, p_acc, p_photo, p_duration)
    returning id into v_id;
  end if;

  if p_stage is not null then
    insert into public.sales_activities (lead_id, staff_id, kind, outcome)
    values (p_lead, auth.uid(), 'stage', p_stage)
    returning coalesce(v_id, id) into v_id;
  end if;
  return v_id;
end;
$fn$;

-- Give leads to a person (manager only). Writes one 'assign' activity per lead.
create or replace function public.sales_assign(p_leads uuid[], p_to uuid)
returns integer
language plpgsql
security invoker
set search_path = public, pg_temp
as $fn$
declare
  v_n integer;
begin
  if not public.sales_is_manager() then
    raise exception 'only a manager can assign' using errcode = '42501';
  end if;
  if p_to is not null and not exists (select 1 from public.sales_staff s where s.user_id = p_to and s.active) then
    raise exception 'no such person' using errcode = '22023';
  end if;
  with moved as (
    update public.sales_leads set assigned_to = p_to
     where id = any (p_leads) and assigned_to is distinct from p_to
    returning id
  )
  insert into public.sales_activities (lead_id, staff_id, kind, outcome)
  select id, auth.uid(), 'assign', coalesce(p_to::text, 'nobody') from moved;
  get diagnostics v_n = row_count;
  return v_n;
end;
$fn$;

-- Today's date in India.
create or replace function public.sales_today()
returns date
language sql
stable
set search_path = public, pg_temp
as $fn$ select (now() at time zone 'Asia/Kolkata')::date $fn$;

-- Called when the app opens and every few minutes: the first call of the day is
-- the login time; the latest is "last active".
create or replace function public.sales_touch()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  if not public.sales_is_staff() then
    return;
  end if;
  insert into public.sales_attendance (staff_id, day, first_seen_at, last_seen_at)
  values (auth.uid(), public.sales_today(), now(), now())
  on conflict (staff_id, day) do update set last_seen_at = now();
end;
$fn$;

-- Start or end the working day, with the phone's location.
create or replace function public.sales_day(p_action text, p_lat double precision, p_lng double precision, p_acc integer)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  if not public.sales_is_staff() then
    raise exception 'not on the sales team' using errcode = '42501';
  end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception 'location needed' using errcode = '22023';
  end if;
  insert into public.sales_attendance (staff_id, day, first_seen_at, last_seen_at)
  values (auth.uid(), public.sales_today(), now(), now())
  on conflict (staff_id, day) do update set last_seen_at = now();
  if p_action = 'start' then
    update public.sales_attendance
       set day_start_at = coalesce(day_start_at, now()), start_lat = coalesce(start_lat, p_lat),
           start_lng = coalesce(start_lng, p_lng), start_acc = coalesce(start_acc, p_acc)
     where staff_id = auth.uid() and day = public.sales_today();
  elsif p_action = 'end' then
    update public.sales_attendance
       set day_end_at = now(), end_lat = p_lat, end_lng = p_lng, end_acc = p_acc
     where staff_id = auth.uid() and day = public.sales_today();
  else
    raise exception 'bad action' using errcode = '22023';
  end if;
end;
$fn$;

revoke all on function public.sales_phone_lookup(text) from public, anon;
revoke all on function public.sales_log(uuid, text, text, text, text, timestamptz, text, double precision, double precision, integer, text, integer, text) from public, anon;
revoke all on function public.sales_assign(uuid[], uuid) from public, anon;
revoke all on function public.sales_touch() from public, anon;
revoke all on function public.sales_day(text, double precision, double precision, integer) from public, anon;
grant execute on function public.sales_phone_lookup(text) to authenticated;
grant execute on function public.sales_log(uuid, text, text, text, text, timestamptz, text, double precision, double precision, integer, text, integer, text) to authenticated;
grant execute on function public.sales_assign(uuid[], uuid) to authenticated;
grant execute on function public.sales_touch() to authenticated;
grant execute on function public.sales_day(text, double precision, double precision, integer) to authenticated;
grant execute on function public.sales_today() to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Visit photos: a private bucket, one folder per person (<user id>/...)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('sales-visits', 'sales-visits', false)
on conflict (id) do nothing;

drop policy if exists sales_visits_upload on storage.objects;
create policy sales_visits_upload on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'sales-visits'
    and public.sales_is_staff()
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists sales_visits_view on storage.objects;
create policy sales_visits_view on storage.objects
  for select to authenticated
  using (
    bucket_id = 'sales-visits'
    and (public.sales_is_manager()
         or (public.sales_is_staff() and (storage.foldername(name))[1] = auth.uid()::text))
  );
