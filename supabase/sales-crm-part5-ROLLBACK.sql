-- ===========================================================================
--  PocketLink Sales CRM part 5  --  ROLLBACK (emergency only)
--
--  Removes what sales-crm-part5-forward.sql added: the Ads & leads role (anyone
--  with it is switched off and becomes an inactive caller), lead checking
--  (results lost), the lead checker's incentive rows, exam roles and questions
--  33-56, sign-off. Puts back the part 2-4 functions and policies exactly.
--  Generated from those files; nothing else needs re-running.
-- ===========================================================================

-- People and incentives
update public.sales_staff set role = 'caller', active = false where role = 'ads';
alter table public.sales_staff drop constraint if exists sales_staff_role_check;
alter table public.sales_staff add constraint sales_staff_role_check check (role in ('manager', 'caller', 'field'));
alter table public.sales_staff drop column if exists signed_off_at;
alter table public.sales_staff drop column if exists signed_off_by;

delete from public.sales_incentives where basis = 'verified';
alter table public.sales_incentives drop constraint if exists sales_incentives_basis_check;
alter table public.sales_incentives add constraint sales_incentives_basis_check check (basis in ('link', 'worked', 'approved'));
do $$
begin
  if exists (select 1 from pg_constraint where conname = 'sales_incentives_pkey'
             and pg_get_constraintdef(oid) = 'PRIMARY KEY (lead_id, staff_id)') then
    alter table public.sales_incentives drop constraint sales_incentives_pkey;
    alter table public.sales_incentives add constraint sales_incentives_pkey primary key (lead_id);
  end if;
end $$;

-- Functions only part 5 has
drop function if exists public.sales_verify_lead(uuid, text, text, jsonb);
drop function if exists public.sales_signoff(uuid, boolean);
drop function if exists public.sales_incentive_set(uuid, text, text, uuid);

-- Policies back to parts 1-4
drop policy if exists sales_leads_read on public.sales_leads;
create policy sales_leads_read on public.sales_leads
  for select to authenticated
  using (public.sales_is_manager() or (public.sales_is_staff() and assigned_to = auth.uid()));

drop policy if exists sales_leads_add on public.sales_leads;
create policy sales_leads_add on public.sales_leads
  for insert to authenticated
  with check (public.sales_is_manager() or (public.sales_is_staff() and assigned_to = auth.uid()));

drop policy if exists sales_lead_events_read on public.sales_lead_events;
create policy sales_lead_events_read on public.sales_lead_events
  for select to authenticated
  using (public.sales_is_manager());

drop policy if exists sales_settings_read on public.sales_settings;
create policy sales_settings_read on public.sales_settings
  for select to authenticated
  using (public.sales_is_manager()
         or (public.sales_is_staff() and key in ('auto_assign', 'policies', 'incentive', 'score', 'work', 'training')));
drop policy if exists sales_settings_add on public.sales_settings;
create policy sales_settings_add on public.sales_settings
  for insert to authenticated
  with check (public.sales_is_manager());
drop policy if exists sales_settings_edit on public.sales_settings;
create policy sales_settings_edit on public.sales_settings
  for update to authenticated
  using (public.sales_is_manager())
  with check (public.sales_is_manager());

-- Functions back to their part 2-4 text (lead guard v3 first: it reads the columns dropped below)
create or replace function public.sales_leads_guard()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $fn$
begin
  new.updated_at := now();
  if current_user = 'authenticated' then
    if tg_op = 'UPDATE' then
      if not public.sales_is_manager() then
        if new.assigned_to is distinct from old.assigned_to then
          raise exception 'only a manager can move a lead' using errcode = '42501';
        end if;
        new.created_by := old.created_by;
        new.hub_lead_id := old.hub_lead_id;
        new.store_slug := old.store_slug;
      end if;
      new.won_proof := old.won_proof;
      new.won_proof_at := old.won_proof_at;
      new.won_proof_by := old.won_proof_by;
    end if;
    if tg_op = 'INSERT' then
      new.created_by := auth.uid();
      new.won_proof := null;
      new.won_proof_at := null;
      new.won_proof_by := null;
    end if;
  end if;
  return new;
end;
$fn$;

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

create or replace function public.sales_lead_feed(p_since timestamptz)
returns table (
  id uuid, created_at timestamptz, source text, outcome text, name text, phone text, campaign text, form text,
  lead_id uuid, shop_name text, assigned_to uuid, stage text, first_touch_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
#variable_conflict use_column
begin
  if not public.sales_is_manager() then
    raise exception 'only a manager can see lead sources' using errcode = '42501';
  end if;
  return query
  select e.id, e.created_at, e.source, e.outcome, e.name, e.phone, e.campaign, e.form, e.lead_id,
         l.shop_name, l.assigned_to, l.stage,
         (select min(a.created_at) from public.sales_activities a
           where a.lead_id = e.lead_id and a.kind in ('call', 'visit') and a.created_at >= e.created_at)
    from public.sales_lead_events e
    left join public.sales_leads l on l.id = e.lead_id
   where e.created_at >= coalesce(p_since, now() - interval '31 days')
   order by e.created_at desc
   limit 500;
end;
$fn$;

create or replace function public.sales_incentive_add(p_lead uuid, p_staff uuid, p_plan text, p_amount integer, p_basis text, p_at timestamptz)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_cfg  jsonb;
  v_hold integer;
  v_plan text := case when p_plan = 'yearly' then 'yearly' else 'monthly' end;
begin
  if p_lead is null or p_staff is null then
    return;
  end if;
  select st.value into v_cfg from public.sales_settings st where st.key = 'incentive';
  v_hold := case when jsonb_typeof(v_cfg->'hold_days') = 'number' then least(greatest((v_cfg->>'hold_days')::numeric, 0), 120)::integer else 30 end;
  insert into public.sales_incentives (lead_id, staff_id, plan, paid_amount, incentive, basis, won_at, due_at)
  values (p_lead, p_staff, v_plan, coalesce(p_amount, 0), public.sales_incentive_amount(p_staff, v_plan, coalesce(p_at, now())),
          p_basis, coalesce(p_at, now()),
          -- Checked after the first renewal (+4 days: Razorpay's retry window and the daily sync).
          coalesce(p_at, now()) + make_interval(days => v_hold + 4))
  on conflict (lead_id) do nothing;
end;
$fn$;

create or replace function public.sales_win_from_payment(
  p_slug text, p_starts timestamptz, p_expires timestamptz, p_at timestamptz, p_credit boolean
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_lead   record;
  v_p10    text;
  v_yearly boolean := coalesce(p_expires - p_starts > interval '200 days', false);
  v_at     timestamptz := coalesce(p_at, now());
  v_ref    uuid;
  v_credit uuid;
  v_basis  text;
  v_amount integer := case when coalesce(p_expires - p_starts > interval '200 days', false) then 14999 else 1499 end;
begin
  select l.id, l.won_proof, l.assigned_to into v_lead
    from public.sales_leads l where l.store_slug = p_slug order by l.created_at limit 1 for update;
  if not found then
    select right(regexp_replace(coalesce(nullif(s.config->>'ownerPhone', ''), s.config->>'whatsappNumber', ''), '[^0-9]', '', 'g'), 10)
      into v_p10 from public.stores s where s.slug = p_slug;
    if v_p10 is null or length(v_p10) <> 10 then
      return null;
    end if;
    select l.id, l.won_proof, l.assigned_to into v_lead from public.sales_leads l where l.phone = v_p10 for update;
    if not found then
      return null;
    end if;
  end if;
  if v_lead.won_proof = 'payment' then
    return v_lead.id;
  end if;

  update public.sales_leads l
     set stage = 'won', won_proof = 'payment', won_proof_at = v_at, won_proof_by = null,
         won_plan = case when v_yearly then 'yearly' else 'monthly' end,
         won_amount = v_amount,
         store_slug = coalesce(l.store_slug, p_slug), signed_up = true,
         next_action_at = null, next_action = null, lost_reason = null
   where l.id = v_lead.id;
  insert into public.sales_activities (lead_id, staff_id, kind, outcome, note)
  values (v_lead.id, null, 'system', 'payment_verified',
          case when v_yearly then 'Paid the yearly PocketLink plan. Payment verified.' else 'Paid the monthly PocketLink plan. Payment verified.' end);

  if p_credit then
    select r.staff_id into v_ref from public.sales_referrals r where r.store_slug = p_slug;
    if v_ref is not null and (v_lead.assigned_to is null or v_lead.assigned_to = v_ref) then
      v_credit := v_ref; v_basis := 'link';
      if v_lead.assigned_to is null then
        update public.sales_leads set assigned_to = v_ref where id = v_lead.id;
      end if;
    elsif v_lead.assigned_to is not null
          and exists (select 1 from public.sales_activities a where a.lead_id = v_lead.id and a.staff_id = v_lead.assigned_to
                       and a.kind in ('call', 'visit') and a.created_at <= v_at) then
      v_credit := v_lead.assigned_to; v_basis := 'worked';
    end if;
    if v_credit is not null then
      if not exists (select 1 from public.sales_activities a where a.lead_id = v_lead.id and a.kind = 'stage' and a.outcome = 'won') then
        insert into public.sales_activities (lead_id, staff_id, kind, outcome, note)
        values (v_lead.id, v_credit, 'stage', 'won',
                case when v_basis = 'link' then 'Credited: the shop signed up with your link and paid' else 'Credited: the shop paid after your calls or visits' end);
      end if;
      perform public.sales_incentive_add(v_lead.id, v_credit, case when v_yearly then 'yearly' else 'monthly' end, v_amount, v_basis, v_at);
    end if;
  end if;
  return v_lead.id;
end;
$fn$;

create or replace function public.sales_win_review(p_lead uuid, p_ok boolean)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_staff uuid;
  v_lead  record;
begin
  if not public.sales_is_manager() then
    raise exception 'only a manager can approve wins' using errcode = '42501';
  end if;
  if p_ok then
    update public.sales_leads set won_proof = 'manager', won_proof_at = now(), won_proof_by = auth.uid()
     where id = p_lead and stage = 'won' and won_proof is null
    returning won_plan, won_amount into v_lead;
    if not found then
      raise exception 'no win waiting for proof' using errcode = 'P0002';
    end if;
    insert into public.sales_activities (lead_id, staff_id, kind, outcome, note)
    values (p_lead, auth.uid(), 'system', 'win_approved', 'Win approved by the manager');
    select a.staff_id into v_staff from public.sales_activities a
     where a.lead_id = p_lead and a.kind = 'stage' and a.outcome = 'won' and a.staff_id is not null
     order by a.created_at desc limit 1;
    perform public.sales_incentive_add(p_lead, v_staff, coalesce(v_lead.won_plan, 'monthly'),
                                       coalesce(v_lead.won_amount, 1499), 'approved', now());
  else
    update public.sales_leads set stage = 'interested', won_plan = null, won_amount = null
     where id = p_lead and stage = 'won' and won_proof is null;
    if not found then
      raise exception 'no win waiting for proof' using errcode = 'P0002';
    end if;
    insert into public.sales_activities (lead_id, staff_id, kind, outcome, note)
    values (p_lead, auth.uid(), 'system', 'win_rejected', 'Not counted as a win yet: no payment seen');
  end if;
end;
$fn$;

create or replace function public.sales_incentive_check(p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  r     record;
  v_n   integer := 0;
  v_ok  boolean;
  v_cfg jsonb;
begin
  for r in
    select i.lead_id, l.store_slug from public.sales_incentives i join public.sales_leads l on l.id = i.lead_id
     where i.status = 'waiting' and i.due_at <= p_now
     for update of i
  loop
    if r.store_slug is null then
      update public.sales_incentives set status = 'check', decided_at = p_now where lead_id = r.lead_id;
    else
      select s.config into v_cfg from public.stores s where s.slug = r.store_slug;
      v_ok := v_cfg is not null and coalesce(v_cfg->>'plan', 'free') <> 'free'
              and coalesce(v_cfg->>'planExpiresAt', '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
              and (v_cfg->>'planExpiresAt')::timestamptz > p_now;
      update public.sales_incentives
         set status = case when v_ok then 'earned' else 'cancelled' end, decided_at = p_now,
             note = case when v_ok then 'Still paying after the hold period' else 'The shop stopped paying within the hold period' end
       where lead_id = r.lead_id;
    end if;
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$fn$;

create or replace function public.sales_incentive_set(p_lead uuid, p_status text, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  if not public.sales_is_manager() then
    raise exception 'only a manager can change incentives' using errcode = '42501';
  end if;
  if p_status not in ('earned', 'cancelled', 'paid', 'waiting') then
    raise exception 'bad status' using errcode = '22023';
  end if;
  update public.sales_incentives
     set status = p_status,
         decided_at = case when p_status in ('earned', 'cancelled') then now() else decided_at end,
         paid_at = case when p_status = 'paid' then now() else null end,
         paid_by = case when p_status = 'paid' then auth.uid() else null end,
         note = coalesce(left(nullif(btrim(p_note), ''), 300), note)
   where lead_id = p_lead
     and (p_status <> 'paid' or status = 'earned');
  if not found then
    raise exception 'incentive not found, or not earned yet' using errcode = 'P0002';
  end if;
end;
$fn$;

create or replace function public.sales_exam_start()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_open  record;
  v_ids   integer[];
  v_today integer;
  v_id    uuid;
begin
  if not public.sales_is_staff() then
    raise exception 'not on the sales team' using errcode = '42501';
  end if;
  select a.id, a.question_ids into v_open from public.sales_exam_attempts a
   where a.staff_id = auth.uid() and a.submitted_at is null and a.started_at > now() - interval '60 minutes'
   order by a.started_at desc limit 1;
  if found then
    v_id := v_open.id; v_ids := v_open.question_ids;
  else
    select count(*) into v_today from public.sales_exam_attempts a
     where a.staff_id = auth.uid() and a.submitted_at is not null
       and (a.submitted_at at time zone 'Asia/Kolkata')::date = public.sales_today();
    if v_today >= 3 then
      raise exception 'three tries today already; try again tomorrow' using errcode = 'P0001';
    end if;
    select array_agg(q.id) into v_ids from (select id from public.sales_exam_questions where active order by random() limit 15) q;
    insert into public.sales_exam_attempts (staff_id, question_ids) values (auth.uid(), v_ids) returning id into v_id;
  end if;
  return jsonb_build_object(
    'attempt_id', v_id,
    'questions', (select jsonb_agg(jsonb_build_object('id', q.id, 'topic', q.topic, 'question', q.question, 'options', q.options) order by array_position(v_ids, q.id))
                    from public.sales_exam_questions q where q.id = any (v_ids)));
end;
$fn$;

drop function if exists public.sales_scoreboard(date, date);
create or replace function public.sales_scoreboard(p_from date, p_to date)
returns table (
  user_id uuid, name text, role text, targets jsonb, daily_target integer, monthly_target integer,
  calls integer, answered integer, answered_noted integer, talk_sec bigint,
  visits integer, visits_owner integer, visits_noted integer,
  demos integer, won integer, pending_wins integer, money bigint, new_leads integer, days_present integer,
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
           where l.assigned_to = s.user_id and l.stage not in ('won', 'lost') and l.next_action_at < v_today)::integer
    from public.sales_staff s
   where s.active and s.role <> 'manager'
   order by s.name;
end;
$fn$;

drop function if exists public.sales_is_ads();

-- Lead checking columns
drop index if exists public.sales_leads_verify_idx;
alter table public.sales_leads drop constraint if exists sales_leads_verify_check;
alter table public.sales_leads drop column if exists verify_status;
alter table public.sales_leads drop column if exists verified_by;
alter table public.sales_leads drop column if exists verified_at;
alter table public.sales_leads drop column if exists verify_note;

-- Exam
delete from public.sales_exam_questions where id between 33 and 56;
alter table public.sales_exam_questions drop column if exists roles;
insert into public.sales_exam_questions (id, topic, question, options, answer) values
 (22, 'Rules', 'A customer wants to pay you in cash. The safest way:', '["Take the cash","Send the Razorpay payment link, which gives them a GST invoice","Ask them to transfer to your UPI","Ask a friend to collect"]', 1)
on conflict (id) do update set topic = excluded.topic, question = excluded.question, options = excluded.options, answer = excluded.answer;

-- Who may call what (as parts 2-4)
revoke all on function public.sales_pick_owner(text) from public, anon, authenticated;
revoke all on function public.sales_auto_assign(uuid[]) from public, anon;
revoke all on function public.sales_lead_feed(timestamptz) from public, anon;
revoke all on function public.sales_incentive_add(uuid, uuid, text, integer, text, timestamptz) from public, anon, authenticated;
revoke all on function public.sales_win_from_payment(text, timestamptz, timestamptz, timestamptz, boolean) from public, anon, authenticated;
revoke all on function public.sales_win_review(uuid, boolean) from public, anon;
revoke all on function public.sales_incentive_check(timestamptz) from public, anon, authenticated;
revoke all on function public.sales_incentive_set(uuid, text, text) from public, anon;
revoke all on function public.sales_exam_start() from public, anon;
revoke all on function public.sales_scoreboard(date, date) from public, anon;
grant execute on function public.sales_auto_assign(uuid[]) to authenticated;
grant execute on function public.sales_lead_feed(timestamptz) to authenticated;
grant execute on function public.sales_win_review(uuid, boolean) to authenticated;
grant execute on function public.sales_incentive_set(uuid, text, text) to authenticated;
grant execute on function public.sales_exam_start() to authenticated;
grant execute on function public.sales_scoreboard(date, date) to authenticated;
