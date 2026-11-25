-- ===========================================================================
--  PocketLink Sales CRM  --  PART 2
--
--  * Per-person KPI targets and a scoreboard (aggregates only) for Performance.
--  * Team settings: auto-assign rules, the answers only a manager can give
--    (trial, discount, cash, incentive), the incentive per paid shop.
--  * Questions for the manager ("Ask the manager"), which can join the FAQ.
--  * Visit checks: a manager marks a visit fine or "do not count it".
--  * New PocketLink sign-ups (and unfinished sign-ups) arrive as leads by
--    themselves and follow the auto-assign rules. These triggers can never
--    stop a sign-up: any error inside them is swallowed.
--
--  Still shows NO shop, order or admin data to CRM logins.
--  Run after sales-crm-forward.sql. Order: this -> sales-crm-part2-verify.sql
--  (all PASS). Safe to run twice. Undo: sales-crm-part2-ROLLBACK.sql.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Lead guard v2: only a signed-in app user (role "authenticated") is held
--    back. Trusted server work (migrations, SECURITY DEFINER functions such as
--    the sign-up capture below, the service role) may set the owner.
-- ---------------------------------------------------------------------------
create or replace function public.sales_leads_guard()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $fn$
begin
  new.updated_at := now();
  if current_user = 'authenticated' then
    if tg_op = 'UPDATE' and not public.sales_is_manager() then
      if new.assigned_to is distinct from old.assigned_to then
        raise exception 'only a manager can move a lead' using errcode = '42501';
      end if;
      new.created_by := old.created_by;
      new.hub_lead_id := old.hub_lead_id;
      new.store_slug := old.store_slug;
    end if;
    if tg_op = 'INSERT' then
      new.created_by := auth.uid();
    end if;
  end if;
  return new;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 2. KPI targets per person ({} = the role's defaults, set in the app)
-- ---------------------------------------------------------------------------
alter table public.sales_staff add column if not exists targets jsonb not null default '{}'::jsonb;

do $$
begin
  alter table public.sales_staff
    add constraint sales_staff_targets_object check (jsonb_typeof(targets) = 'object' and length(targets::text) <= 2000);
exception when duplicate_object then null;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Team settings (one row per key). Everyone on the team reads them; only a
--    manager changes them.
-- ---------------------------------------------------------------------------
create table if not exists public.sales_settings (
  key        text primary key check (key in ('auto_assign', 'policies', 'incentive')),
  value      jsonb not null default '{}'::jsonb check (jsonb_typeof(value) = 'object' and length(value::text) <= 20000),
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create or replace function public.sales_settings_stamp()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $fn$
begin
  new.updated_at := now();
  if current_user = 'authenticated' then
    new.updated_by := auth.uid();
  end if;
  return new;
end;
$fn$;

drop trigger if exists sales_settings_stamp on public.sales_settings;
create trigger sales_settings_stamp
  before insert or update on public.sales_settings
  for each row execute function public.sales_settings_stamp();

alter table public.sales_settings enable row level security;
revoke all on public.sales_settings from public, anon, authenticated;
grant select, insert, update on public.sales_settings to authenticated;

drop policy if exists sales_settings_read on public.sales_settings;
create policy sales_settings_read on public.sales_settings
  for select to authenticated
  using (public.sales_is_staff());

drop policy if exists sales_settings_add on public.sales_settings;
create policy sales_settings_add on public.sales_settings
  for insert to authenticated
  with check (public.sales_is_manager());

drop policy if exists sales_settings_edit on public.sales_settings;
create policy sales_settings_edit on public.sales_settings
  for update to authenticated
  using (public.sales_is_manager())
  with check (public.sales_is_manager());

-- ---------------------------------------------------------------------------
-- 4. Questions for the manager
-- ---------------------------------------------------------------------------
create table if not exists public.sales_questions (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  asked_by    uuid not null references public.sales_staff (user_id) on delete cascade,
  question    text not null check (length(btrim(question)) between 3 and 500),
  answer      text check (answer is null or length(answer) <= 2000),
  answered_by uuid,
  answered_at timestamptz,
  in_faq      boolean not null default false
);

create index if not exists sales_questions_created_idx on public.sales_questions (created_at desc);

alter table public.sales_questions enable row level security;
revoke all on public.sales_questions from public, anon, authenticated;
grant select, insert, update, delete on public.sales_questions to authenticated;

drop policy if exists sales_questions_read on public.sales_questions;
create policy sales_questions_read on public.sales_questions
  for select to authenticated
  using (public.sales_is_manager()
         or (public.sales_is_staff() and (asked_by = auth.uid() or in_faq)));

drop policy if exists sales_questions_ask on public.sales_questions;
create policy sales_questions_ask on public.sales_questions
  for insert to authenticated
  with check (public.sales_is_staff() and asked_by = auth.uid()
              and answer is null and answered_by is null and answered_at is null and not in_faq);

drop policy if exists sales_questions_answer on public.sales_questions;
create policy sales_questions_answer on public.sales_questions
  for update to authenticated
  using (public.sales_is_manager())
  with check (public.sales_is_manager());

drop policy if exists sales_questions_remove on public.sales_questions;
create policy sales_questions_remove on public.sales_questions
  for delete to authenticated
  using (public.sales_is_manager() or (asked_by = auth.uid() and answer is null));

-- ---------------------------------------------------------------------------
-- 5. Visit checks: a manager marks a visit 'ok' or 'rejected' (not counted)
-- ---------------------------------------------------------------------------
alter table public.sales_activities add column if not exists review text;
alter table public.sales_activities add column if not exists reviewed_by uuid;
alter table public.sales_activities add column if not exists reviewed_at timestamptz;

do $$
begin
  alter table public.sales_activities
    add constraint sales_activities_review_check check (review is null or review in ('ok', 'rejected'));
exception when duplicate_object then null;
end $$;

grant update (review, reviewed_by, reviewed_at) on public.sales_activities to authenticated;

drop policy if exists sales_activities_review on public.sales_activities;
create policy sales_activities_review on public.sales_activities
  for update to authenticated
  using (public.sales_is_manager())
  with check (public.sales_is_manager());

create or replace function public.sales_review(p_activity uuid, p_review text)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $fn$
begin
  if not public.sales_is_manager() then
    raise exception 'only a manager can check visits' using errcode = '42501';
  end if;
  if p_review is not null and p_review not in ('ok', 'rejected') then
    raise exception 'bad review' using errcode = '22023';
  end if;
  update public.sales_activities
     set review = p_review,
         reviewed_by = case when p_review is null then null else auth.uid() end,
         reviewed_at = case when p_review is null then null else now() end
   where id = p_activity and kind = 'visit';
  if not found then
    raise exception 'visit not found' using errcode = 'P0002';
  end if;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 6. Scoreboard: counts per person for a period (India dates). Aggregates
--    only, never a lead. Visits a manager marked 'rejected' do not count.
-- ---------------------------------------------------------------------------
create or replace function public.sales_scoreboard(p_from date, p_to date)
returns table (
  user_id uuid, name text, role text, targets jsonb, daily_target integer, monthly_target integer,
  calls integer, answered integer, answered_noted integer,
  visits integer, visits_owner integer, visits_noted integer,
  demos integer, won integer, money bigint, new_leads integer, days_present integer,
  open_followups integer, late_followups integer
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
    select x.staff_id, x.lead_id, x.kind, x.outcome, x.note, x.created_at
      from public.sales_activities x
     where x.created_at >= v_lo and x.created_at < v_hi
       and x.staff_id is not null
       and x.review is distinct from 'rejected'
  ),
  w as (
    select distinct on (a.lead_id) a.lead_id, a.staff_id
      from a
     where a.kind = 'stage' and a.outcome = 'won'
     order by a.lead_id, a.created_at desc
  )
  select s.user_id, s.name, s.role, s.targets, s.daily_target, s.monthly_target,
         (select count(*) from a where a.staff_id = s.user_id and a.kind = 'call')::integer,
         (select count(*) from a where a.staff_id = s.user_id and a.kind = 'call'
                                  and coalesce(a.outcome, '') not in ('no_answer', 'wrong_number'))::integer,
         (select count(*) from a where a.staff_id = s.user_id and a.kind = 'call'
                                  and coalesce(a.outcome, '') not in ('no_answer', 'wrong_number')
                                  and a.note is not null)::integer,
         (select count(*) from a where a.staff_id = s.user_id and a.kind = 'visit')::integer,
         (select count(*) from a where a.staff_id = s.user_id and a.kind = 'visit'
                                  and split_part(coalesce(a.outcome, ''), '_', 1) = 'owner')::integer,
         (select count(*) from a where a.staff_id = s.user_id and a.kind = 'visit' and a.note is not null)::integer,
         (select count(*) from a where a.staff_id = s.user_id
                                  and ((a.kind = 'call' and a.outcome = 'demo')
                                       or (a.kind = 'visit' and a.outcome in ('owner_demo', 'staff_demo'))))::integer,
         (select count(*) from w where w.staff_id = s.user_id)::integer,
         (select coalesce(sum(l.won_amount), 0) from w join public.sales_leads l on l.id = w.lead_id
           where w.staff_id = s.user_id and l.stage = 'won')::bigint,
         (select count(*) from public.sales_leads l
           where l.created_by = s.user_id and l.created_at >= v_lo and l.created_at < v_hi)::integer,
         (select count(*) from public.sales_attendance t
           where t.staff_id = s.user_id and t.day between p_from and p_to
             and (t.status_override in ('present', 'late', 'half')
                  or (t.status_override is null and (t.first_seen_at is not null or t.day_start_at is not null))))::integer,
         (select count(*) from public.sales_leads l
           where l.assigned_to = s.user_id and l.stage not in ('won', 'lost') and l.next_action_at is not null)::integer,
         (select count(*) from public.sales_leads l
           where l.assigned_to = s.user_id and l.stage not in ('won', 'lost') and l.next_action_at < v_today)::integer
    from public.sales_staff s
   where s.active and s.role <> 'manager'
   order by s.name;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 7. Auto-assign. Settings 'auto_assign' value:
--      on      true / false
--      places  [{ "match": "solapur", "to": "<user id>" }]  first match wins,
--              matched against the lead's city and area
--      pool    ["<user id>", ...]  everyone else is given out between these
--      how     "turns" (one each, in order) or "fewest" (fewest open leads)
--      last    the last person given a lead by turns (kept by the database)
--    sales_pick_owner is internal (no app login may call it directly).
-- ---------------------------------------------------------------------------
create or replace function public.sales_pick_owner(p_where text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_cfg   jsonb;
  v_rule  jsonb;
  v_pool  uuid[];
  v_pick  uuid;
  v_i     integer;
  v_where text := lower(coalesce(p_where, ''));
begin
  select st.value into v_cfg from public.sales_settings st where st.key = 'auto_assign' for update;
  if v_cfg is null or jsonb_typeof(v_cfg->'on') is distinct from 'boolean' or not (v_cfg->>'on')::boolean then
    return null;
  end if;

  if jsonb_typeof(v_cfg->'places') = 'array' then
    for v_rule in select e from jsonb_array_elements(v_cfg->'places') as e loop
      if jsonb_typeof(v_rule) = 'object'
         and length(btrim(coalesce(v_rule->>'match', ''))) >= 2
         and position(lower(btrim(v_rule->>'match')) in v_where) > 0 then
        select s.user_id into v_pick from public.sales_staff s where s.user_id::text = v_rule->>'to' and s.active;
        if v_pick is not null then
          return v_pick;
        end if;
      end if;
    end loop;
  end if;

  if jsonb_typeof(v_cfg->'pool') = 'array' then
    select array_agg(s.user_id order by p.o) into v_pool
      from jsonb_array_elements_text(v_cfg->'pool') with ordinality as p(u, o)
      join public.sales_staff s on s.user_id::text = p.u and s.active;
  end if;
  if v_pool is null or cardinality(v_pool) = 0 then
    return null;
  end if;

  if v_cfg->>'how' = 'fewest' then
    select q.u into v_pick
      from unnest(v_pool) with ordinality as q(u, o)
     order by (select count(*) from public.sales_leads l where l.assigned_to = q.u and l.stage not in ('won', 'lost')), q.o
     limit 1;
  else
    v_i := array_position(v_pool::text[], v_cfg->>'last');
    v_pick := v_pool[coalesce(v_i, 0) % cardinality(v_pool) + 1];
  end if;

  update public.sales_settings set value = jsonb_set(value, '{last}', to_jsonb(v_pick::text)) where key = 'auto_assign';
  return v_pick;
end;
$fn$;

-- Manager: give these unassigned leads out by the rules. Returns how many.
create or replace function public.sales_auto_assign(p_leads uuid[])
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_lead record;
  v_pick uuid;
  v_n    integer := 0;
begin
  if not public.sales_is_manager() then
    raise exception 'only a manager can assign' using errcode = '42501';
  end if;
  if coalesce(cardinality(p_leads), 0) > 5000 then
    raise exception 'too many leads at once' using errcode = '22023';
  end if;
  for v_lead in
    select l.id, l.city, l.area from public.sales_leads l
     where l.id = any (p_leads) and l.assigned_to is null and l.stage not in ('won', 'lost')
     order by l.created_at, l.id
  loop
    v_pick := public.sales_pick_owner(concat_ws(' ', v_lead.city, v_lead.area));
    continue when v_pick is null;
    update public.sales_leads set assigned_to = v_pick where id = v_lead.id;
    insert into public.sales_activities (lead_id, staff_id, kind, outcome, note)
    values (v_lead.id, auth.uid(), 'assign', v_pick::text, 'Given out by the auto-assign rules');
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 8. New sign-ups become leads by themselves. Never blocks a sign-up.
-- ---------------------------------------------------------------------------
create or replace function public.sales_capture_signup()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_p10  text;
  v_id   uuid;
  v_new  boolean;
  v_pick uuid;
  v_city text;
begin
  begin
    v_p10 := right(regexp_replace(coalesce(nullif(new.config->>'ownerPhone', ''), new.config->>'whatsappNumber', ''), '[^0-9]', '', 'g'), 10);
    if length(v_p10) <> 10 or v_p10 !~ '^[6-9]' or v_p10 = '9000000000' then
      return new;
    end if;
    v_city := left(nullif(btrim(new.config->>'city'), ''), 80);

    insert into public.sales_leads (shop_name, phone, business_type, city, source, source_detail, signed_up, store_slug)
    values (left(coalesce(nullif(btrim(new.config->>'businessName'), ''), new.slug), 120), v_p10,
            left(nullif(btrim(new.config->>'businessType'), ''), 60), v_city,
            'signup', 'Signed up on PocketLink', true, new.slug)
    on conflict (phone) do update
       set signed_up     = true,
           stage         = case when sales_leads.stage = 'lost' then 'interested' else sales_leads.stage end,
           store_slug    = coalesce(sales_leads.store_slug, excluded.store_slug),
           shop_name     = case when sales_leads.source = 'pending_signup' and sales_leads.shop_name = 'Sign-up not finished'
                                then excluded.shop_name else sales_leads.shop_name end,
           city          = coalesce(sales_leads.city, excluded.city),
           business_type = coalesce(sales_leads.business_type, excluded.business_type)
    returning id, (xmax = 0) into v_id, v_new;

    insert into public.sales_activities (lead_id, staff_id, kind, outcome, note)
    values (v_id, null, 'system', 'signed_up', 'Signed up on PocketLink');

    if v_new then
      v_pick := public.sales_pick_owner(v_city);
      if v_pick is not null then
        update public.sales_leads set assigned_to = v_pick where id = v_id and assigned_to is null;
        insert into public.sales_activities (lead_id, staff_id, kind, outcome, note)
        values (v_id, null, 'assign', v_pick::text, 'Given out by the auto-assign rules');
      end if;
    end if;
  exception when others then
    raise warning 'sales_capture_signup skipped: %', sqlerrm;
  end;
  return new;
end;
$fn$;

drop trigger if exists sales_capture_signup on public.stores;
create trigger sales_capture_signup
  after insert on public.stores
  for each row execute function public.sales_capture_signup();

create or replace function public.sales_capture_pending()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_p10  text;
  v_id   uuid;
  v_pick uuid;
begin
  begin
    v_p10 := right(regexp_replace(coalesce(new.phone, ''), '[^0-9]', '', 'g'), 10);
    if length(v_p10) <> 10 or v_p10 !~ '^[6-9]' or v_p10 = '9000000000' then
      return new;
    end if;
    insert into public.sales_leads (shop_name, phone, source, source_detail)
    values ('Sign-up not finished', v_p10, 'pending_signup',
            left('Started sign-up for the ' || coalesce(nullif(new.plan, ''), 'paid') || ' plan, did not finish', 200))
    on conflict (phone) do nothing
    returning id into v_id;
    if v_id is not null then
      v_pick := public.sales_pick_owner(null);
      if v_pick is not null then
        update public.sales_leads set assigned_to = v_pick where id = v_id and assigned_to is null;
        insert into public.sales_activities (lead_id, staff_id, kind, outcome, note)
        values (v_id, null, 'assign', v_pick::text, 'Given out by the auto-assign rules');
      end if;
    end if;
  exception when others then
    raise warning 'sales_capture_pending skipped: %', sqlerrm;
  end;
  return new;
end;
$fn$;

drop trigger if exists sales_capture_pending on public.pending_signups;
create trigger sales_capture_pending
  after insert on public.pending_signups
  for each row execute function public.sales_capture_pending();

-- ---------------------------------------------------------------------------
-- 9. Who may call what
-- ---------------------------------------------------------------------------
revoke all on function public.sales_review(uuid, text) from public, anon;
revoke all on function public.sales_scoreboard(date, date) from public, anon;
revoke all on function public.sales_auto_assign(uuid[]) from public, anon;
revoke all on function public.sales_pick_owner(text) from public, anon, authenticated;
revoke all on function public.sales_capture_signup() from public, anon, authenticated;
revoke all on function public.sales_capture_pending() from public, anon, authenticated;
revoke all on function public.sales_settings_stamp() from public, anon;
grant execute on function public.sales_review(uuid, text) to authenticated;
grant execute on function public.sales_scoreboard(date, date) to authenticated;
grant execute on function public.sales_auto_assign(uuid[]) to authenticated;
