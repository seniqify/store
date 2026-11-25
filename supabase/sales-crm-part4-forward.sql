-- ===========================================================================
--  PocketLink Sales CRM  --  PART 4
--
--  * Own sign-up link / code per person (sales_staff.ref_code). A shop that
--    signs up with it (stores.config.salesRef, read once when the shop is
--    created) is recorded in sales_referrals and its lead goes to that person.
--    When the shop pays, the win is credited to them automatically.
--  * Incentives (sales_incentives): one row per credited paid shop. Earned
--    only if the shop is still paying after the hold period (30 days, checked
--    on day 34 after the renewal), by sales_incentive_check() every day.
--  * Settings keys for the score, work rules, training and reports.
--  * Training: module progress and a server-graded exam (the answers never
--    reach the browser). New people must pass it; people already on the team
--    are not asked to.
--  * Reports: sales_report_data() for the 7 pm daily and Monday weekly
--    WhatsApp reports (edge function sales-report), kept in sales_reports.
--
--  Still shows NO shop, order or admin data to CRM logins: the sign-up a
--  person brought shows only as their lead, with the plan and amount paid.
--  Run after sales-crm-part3-forward.sql. Order: this -> sales-crm-part4-verify.sql
--  (all PASS) -> sales-crm-part4-schedule.sql. Safe to run twice.
--  Undo: sales-crm-part4-ROLLBACK.sql.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Settings keys
-- ---------------------------------------------------------------------------
alter table public.sales_settings drop constraint if exists sales_settings_key_check;
alter table public.sales_settings add constraint sales_settings_key_check
  check (key in ('auto_assign', 'policies', 'incentive', 'lead_sources', 'ad_spend', 'score', 'work', 'training', 'reports'));

drop policy if exists sales_settings_read on public.sales_settings;
create policy sales_settings_read on public.sales_settings
  for select to authenticated
  using (public.sales_is_manager()
         or (public.sales_is_staff() and key in ('auto_assign', 'policies', 'incentive', 'score', 'work', 'training')));

-- ---------------------------------------------------------------------------
-- 2. Own sign-up code per person, training status
-- ---------------------------------------------------------------------------
alter table public.sales_staff add column if not exists ref_code text;
alter table public.sales_staff add column if not exists must_train boolean;
alter table public.sales_staff add column if not exists qualified_at timestamptz;

-- People already on the team are not sent back to training.
update public.sales_staff set must_train = false where must_train is null;
alter table public.sales_staff alter column must_train set default true;
alter table public.sales_staff alter column must_train set not null;

-- 6 letters and digits, no look-alikes (no 0/O, 1/I/L).
create or replace function public.sales_new_ref_code()
returns text
language plpgsql
volatile
set search_path = public, pg_temp
as $fn$
declare
  v_abc  text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_code text;
  v_i    integer;
begin
  loop
    v_code := '';
    for v_i in 1..6 loop
      v_code := v_code || substr(v_abc, 1 + floor(random() * length(v_abc))::integer, 1);
    end loop;
    exit when not exists (select 1 from public.sales_staff s where s.ref_code = v_code);
  end loop;
  return v_code;
end;
$fn$;

update public.sales_staff set ref_code = public.sales_new_ref_code() where ref_code is null;

do $$
begin
  alter table public.sales_staff add constraint sales_staff_ref_code_format check (ref_code is null or ref_code ~ '^[A-Z0-9]{4,10}$');
exception when duplicate_object then null;
end $$;
create unique index if not exists sales_staff_ref_code_key on public.sales_staff (ref_code);

create or replace function public.sales_staff_defaults()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  if new.ref_code is null then
    new.ref_code := public.sales_new_ref_code();
  end if;
  return new;
end;
$fn$;

drop trigger if exists sales_staff_defaults on public.sales_staff;
create trigger sales_staff_defaults
  before insert on public.sales_staff
  for each row execute function public.sales_staff_defaults();

-- ---------------------------------------------------------------------------
-- 3. Who brought a shop (by link or code). Read only by database functions.
-- ---------------------------------------------------------------------------
create table if not exists public.sales_referrals (
  store_slug text primary key references public.stores (slug) on delete cascade,
  staff_id   uuid not null references public.sales_staff (user_id) on delete cascade,
  code       text not null,
  created_at timestamptz not null default now()
);
create index if not exists sales_referrals_staff_idx on public.sales_referrals (staff_id, created_at desc);
alter table public.sales_referrals enable row level security;
revoke all on public.sales_referrals from public, anon, authenticated;

-- Sign-up capture v3: as part 2, plus the person whose code the shop used.
-- The lead goes to them, unless someone else worked it in the last 14 days
-- (then it stays, and the history says whose link was used).
create or replace function public.sales_capture_signup()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_p10   text;
  v_id    uuid;
  v_new   boolean;
  v_pick  uuid;
  v_city  text;
  v_code  text;
  v_ref   uuid;
  v_refnm text;
  v_owner uuid;
  v_busy  boolean;
begin
  begin
    v_p10 := right(regexp_replace(coalesce(nullif(new.config->>'ownerPhone', ''), new.config->>'whatsappNumber', ''), '[^0-9]', '', 'g'), 10);
    v_code := upper(btrim(coalesce(new.config->>'salesRef', '')));
    if v_code ~ '^[A-Z0-9]{4,10}$' then
      select s.user_id, s.name into v_ref, v_refnm from public.sales_staff s where s.ref_code = v_code and s.active;
      if v_ref is not null then
        insert into public.sales_referrals (store_slug, staff_id, code) values (new.slug, v_ref, v_code)
        on conflict (store_slug) do nothing;
      end if;
    end if;
    if length(v_p10) <> 10 or v_p10 !~ '^[6-9]' or v_p10 = '9000000000' then
      return new;
    end if;
    v_city := left(nullif(btrim(new.config->>'city'), ''), 80);

    insert into public.sales_leads (shop_name, phone, business_type, city, source, source_detail, signed_up, store_slug)
    values (left(coalesce(nullif(btrim(new.config->>'businessName'), ''), new.slug), 120), v_p10,
            left(nullif(btrim(new.config->>'businessType'), ''), 60), v_city,
            'signup', case when v_ref is not null then left('Signed up with the link of ' || v_refnm, 200) else 'Signed up on PocketLink' end,
            true, new.slug)
    on conflict (phone) do update
       set signed_up     = true,
           stage         = case when sales_leads.stage = 'lost' then 'interested' else sales_leads.stage end,
           store_slug    = coalesce(sales_leads.store_slug, excluded.store_slug),
           shop_name     = case when sales_leads.source = 'pending_signup' and sales_leads.shop_name = 'Sign-up not finished'
                                then excluded.shop_name else sales_leads.shop_name end,
           city          = coalesce(sales_leads.city, excluded.city),
           business_type = coalesce(sales_leads.business_type, excluded.business_type)
    returning id, (xmax = 0), assigned_to into v_id, v_new, v_owner;

    insert into public.sales_activities (lead_id, staff_id, kind, outcome, note)
    values (v_id, null, 'system', 'signed_up',
            case when v_ref is not null then left('Signed up on PocketLink with the link of ' || v_refnm, 2000) else 'Signed up on PocketLink' end);

    if v_ref is not null then
      v_busy := v_owner is not null and v_owner <> v_ref and exists (
        select 1 from public.sales_activities a
         where a.lead_id = v_id and a.staff_id = v_owner and a.kind in ('call', 'visit') and a.created_at > now() - interval '14 days');
      if not v_busy and v_owner is distinct from v_ref then
        update public.sales_leads set assigned_to = v_ref where id = v_id;
        insert into public.sales_activities (lead_id, staff_id, kind, outcome, note)
        values (v_id, null, 'assign', v_ref::text, 'Given to the person whose link the shop used');
      elsif v_busy then
        insert into public.sales_activities (lead_id, staff_id, kind, outcome, note)
        values (v_id, null, 'system', 'link_conflict',
                left('Used the link of ' || v_refnm || ', but the lead stays with its owner, who worked it in the last 14 days', 2000));
      end if;
    elsif v_new then
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

-- ---------------------------------------------------------------------------
-- 4. Incentives
-- ---------------------------------------------------------------------------
create table if not exists public.sales_incentives (
  lead_id     uuid primary key references public.sales_leads (id) on delete cascade,
  staff_id    uuid not null references public.sales_staff (user_id) on delete cascade,
  plan        text not null check (plan in ('monthly', 'yearly')),
  paid_amount integer not null check (paid_amount >= 0),
  incentive   integer not null check (incentive >= 0),
  basis       text not null check (basis in ('link', 'worked', 'approved')),
  won_at      timestamptz not null,
  due_at      timestamptz not null,
  status      text not null default 'waiting' check (status in ('waiting', 'earned', 'cancelled', 'check', 'paid')),
  decided_at  timestamptz,
  paid_at     timestamptz,
  paid_by     uuid,
  note        text check (note is null or length(note) <= 300)
);
create index if not exists sales_incentives_staff_idx on public.sales_incentives (staff_id, won_at desc);
create index if not exists sales_incentives_due_idx on public.sales_incentives (status, due_at);

alter table public.sales_incentives enable row level security;
revoke all on public.sales_incentives from public, anon, authenticated;
grant select on public.sales_incentives to authenticated;

drop policy if exists sales_incentives_read on public.sales_incentives;
create policy sales_incentives_read on public.sales_incentives
  for select to authenticated
  using (public.sales_is_manager() or (public.sales_is_staff() and staff_id = auth.uid()));

-- The rule (sales_settings 'incentive'), with the recommended defaults:
--   monthly 300, yearly 1500 per paid shop; from the (slab_after + 1)th shop
--   in a month: slab_monthly 400, slab_yearly 2000; hold_days 30.
create or replace function public.sales_incentive_amount(p_staff uuid, p_plan text, p_at timestamptz)
returns integer
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_cfg   jsonb;
  v_num   numeric;
  v_after integer;
  v_count integer;
  v_month date := date_trunc('month', p_at at time zone 'Asia/Kolkata')::date;
begin
  select st.value into v_cfg from public.sales_settings st where st.key = 'incentive';
  v_cfg := coalesce(v_cfg, '{}'::jsonb);
  v_after := case when jsonb_typeof(v_cfg->'slab_after') = 'number' then (v_cfg->>'slab_after')::numeric::integer else 10 end;
  select count(*) into v_count from public.sales_incentives i
   where i.staff_id = p_staff and i.status <> 'cancelled'
     and date_trunc('month', i.won_at at time zone 'Asia/Kolkata')::date = v_month;
  if v_after > 0 and v_count >= v_after then
    v_num := case when p_plan = 'yearly'
                  then case when jsonb_typeof(v_cfg->'slab_yearly') = 'number' then (v_cfg->>'slab_yearly')::numeric else 2000 end
                  else case when jsonb_typeof(v_cfg->'slab_monthly') = 'number' then (v_cfg->>'slab_monthly')::numeric else 400 end end;
  else
    v_num := case when p_plan = 'yearly'
                  then case when jsonb_typeof(v_cfg->'yearly') = 'number' then (v_cfg->>'yearly')::numeric else 1500 end
                  else case when jsonb_typeof(v_cfg->'monthly') = 'number' then (v_cfg->>'monthly')::numeric
                            when jsonb_typeof(v_cfg->'per_paid') = 'number' then (v_cfg->>'per_paid')::numeric else 300 end end;
  end if;
  return greatest(0, least(v_num, 1000000))::integer;
end;
$fn$;

-- One incentive row for a credited win (once per lead).
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

-- Win from a payment v2: the person whose link the shop used gets the credit
-- (when the lead is theirs); otherwise the owner who called or visited before
-- the payment, as in part 3. A credited win adds an incentive row.
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

-- Manager approval v2: an approved win also gets an incentive row, which the
-- manager confirms after the hold (status 'check'), since no shop is linked.
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

-- Every day: incentives past their check date. Still paying -> earned;
-- stopped -> cancelled; no shop linked (manager-approved) -> manager checks.
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

-- Manager: set an incentive by hand (earned / cancelled / paid).
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

-- My own link numbers this month (no shop data).
create or replace function public.sales_my_link_stats()
returns table (ref_code text, signups integer, paid integer)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
#variable_conflict use_column
declare
  v_lo timestamptz := (date_trunc('month', now() at time zone 'Asia/Kolkata')) at time zone 'Asia/Kolkata';
begin
  if not public.sales_is_staff() then
    raise exception 'not on the sales team' using errcode = '42501';
  end if;
  return query
  select s.ref_code,
         (select count(*) from public.sales_referrals r where r.staff_id = s.user_id and r.created_at >= v_lo)::integer,
         (select count(*) from public.sales_incentives i where i.staff_id = s.user_id and i.basis = 'link' and i.won_at >= v_lo)::integer
    from public.sales_staff s where s.user_id = auth.uid();
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 5. Training and the exam
-- ---------------------------------------------------------------------------
create table if not exists public.sales_training (
  staff_id uuid not null references public.sales_staff (user_id) on delete cascade,
  module   text not null check (module ~ '^[a-z0-9_]{2,40}$'),
  done_at  timestamptz not null default now(),
  primary key (staff_id, module)
);
alter table public.sales_training enable row level security;
revoke all on public.sales_training from public, anon, authenticated;
grant select, insert on public.sales_training to authenticated;
drop policy if exists sales_training_read on public.sales_training;
create policy sales_training_read on public.sales_training
  for select to authenticated using (public.sales_is_manager() or staff_id = auth.uid());
drop policy if exists sales_training_add on public.sales_training;
create policy sales_training_add on public.sales_training
  for insert to authenticated with check (public.sales_is_staff() and staff_id = auth.uid());

create table if not exists public.sales_exam_questions (
  id       integer primary key,
  topic    text not null,
  question text not null,
  options  jsonb not null check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) between 2 and 5),
  answer   smallint not null,
  active   boolean not null default true
);
alter table public.sales_exam_questions enable row level security;
revoke all on public.sales_exam_questions from public, anon, authenticated;

create table if not exists public.sales_exam_attempts (
  id           uuid primary key default gen_random_uuid(),
  staff_id     uuid not null references public.sales_staff (user_id) on delete cascade,
  started_at   timestamptz not null default now(),
  question_ids integer[] not null,
  answers      jsonb,
  score        integer,
  total        integer,
  passed       boolean,
  submitted_at timestamptz
);
create index if not exists sales_exam_attempts_staff_idx on public.sales_exam_attempts (staff_id, started_at desc);
alter table public.sales_exam_attempts enable row level security;
revoke all on public.sales_exam_attempts from public, anon, authenticated;
grant select on public.sales_exam_attempts to authenticated;
drop policy if exists sales_exam_attempts_read on public.sales_exam_attempts;
create policy sales_exam_attempts_read on public.sales_exam_attempts
  for select to authenticated using (public.sales_is_manager() or staff_id = auth.uid());

-- The question bank (prices as on pocketlink.store/plans; edit here when they change).
insert into public.sales_exam_questions (id, topic, question, options, answer) values
 (1, 'Product', 'How much is the PocketLink plan a month?', '["Rs 699","Rs 1,099","Rs 1,499","Rs 2,999"]', 2),
 (2, 'Product', 'How much is the yearly plan?', '["Rs 9,999","Rs 14,999 (two months free)","Rs 17,988","Rs 24,999"]', 1),
 (3, 'Product', 'What commission does PocketLink take on a shop''s sales?', '["0%","2%","5%","10% on online orders only"]', 0),
 (4, 'Product', 'Where does the money from online payments go?', '["To PocketLink, paid out weekly","Straight into the shop''s own Razorpay account","To the courier","It stays in the PocketLink wallet"]', 1),
 (5, 'Product', 'How many WhatsApp order confirmations are free every month?', '["50","100","500","Unlimited"]', 2),
 (6, 'Product', 'Which couriers are built in?', '["India Post only","Delhivery and Shadowfax","Blue Dart","None, the shop arranges it"]', 1),
 (7, 'Product', 'Do the shop''s customers need to download an app?', '["Yes, the PocketLink app","Only for paying online","No. The page opens in any browser and orders come on WhatsApp","Only on iPhone"]', 2),
 (8, 'Product', 'Can a shop cancel the plan?', '["Only after 12 months","Anytime, with no lock-in; the page stays online","Only by visiting the office","No"]', 1),
 (9, 'Product', 'What are Coins?', '["Discount points for buyers","They pay for WhatsApp messages; 1 Coin = Rs 0.50","A loyalty card","Free plan credits"]', 1),
 (10, 'Calls', 'What is the goal of the first call to a new lead?', '["Take the payment","Book a 10-minute demo","Send the price list","Ask for a referral"]', 1),
 (11, 'Calls', 'A new lead from an ad or the website arrives. When should you call?', '["The same week","Within 5 minutes","After lunch","Only if they message again"]', 1),
 (12, 'Calls', 'The customer says "It is too costly". The best answer:', '["Offer a big discount","About Rs 50 a day; one extra order a day pays for it, and there is no commission","Say other apps cost more","End the call"]', 1),
 (13, 'Calls', 'The customer says "I already sell on WhatsApp". The best answer:', '["Tell them to stop using WhatsApp","Keep WhatsApp: every order still comes there, without sending photos and prices one by one","Say WhatsApp is not safe","Offer a free month"]', 1),
 (14, 'Calls', 'The lead did not pick up 3 times. What does the CRM do?', '["Deletes the lead","Marks it lost","Sets it to try again in 3 days","Gives it to the manager"]', 2),
 (15, 'Calls', 'A shop you met is someone else''s lead. What do you do?', '["Call them yourself","Ask the manager to move it to you","Add it again with another number","Ignore it"]', 1),
 (16, 'Field', 'What must a shop visit check-in have?', '["Only a note","A photo of the shop front and the location, taken at the shop","The owner''s signature","A selfie"]', 1),
 (17, 'Field', 'Your location says it is accurate to 400 m only. What do you do?', '["Save anyway","Step outside and press Again until it is accurate","Use a photo from the gallery","Skip the check-in"]', 1),
 (18, 'Wins', 'When does a win count in your score?', '["When you tap Won","When PocketLink sees the shop''s payment, or the manager approves it","When the shop says yes","At the end of the month"]', 1),
 (19, 'Wins', 'How do you get credit for a shop that signs up by itself later?', '["You cannot","Share your own sign-up link or code; when the shop pays, the win is yours","Tell the manager on WhatsApp","Mark it won yourself"]', 1),
 (20, 'Wins', 'When is the incentive for a paid shop earned?', '["On the day it pays","When the shop is still paying after 30 days","After 12 months","When the manager decides"]', 1),
 (21, 'Rules', 'A customer asks for a discount that is not on pocketlink.store/plans. What do you do?', '["Promise it to close the sale","Never promise it; follow the rule your manager set","Give your own money back","Say yes and tell the manager later"]', 1),
 (22, 'Rules', 'A customer wants to pay you in cash. The safest way:', '["Take the cash","Send the Razorpay payment link, which gives them a GST invoice","Ask them to transfer to your UPI","Ask a friend to collect"]', 1),
 (23, 'Rules', 'How is your score made?', '["Only calls","Five areas: Activity, Reach, Conversion, Revenue, Discipline","Only paid shops","Attendance only"]', 1),
 (24, 'Rules', 'A follow-up is late when:', '["Its day has passed and it was not done","It is in the evening","The customer is busy","You are on leave"]', 0),
 (25, 'Rules', 'What may you share with a customer?', '["Another shop''s orders","Other customers'' numbers","Only PocketLink''s own facts, prices and example shops","Your CRM password"]', 2)
on conflict (id) do update set topic = excluded.topic, question = excluded.question, options = excluded.options, answer = excluded.answer;

-- Start (or continue) an exam: 15 random questions, no answers sent.
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

-- Hand in: graded here. Pass mark from settings 'training'.pass_pct (80).
create or replace function public.sales_exam_submit(p_attempt uuid, p_answers jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_a     record;
  v_score integer := 0;
  v_total integer;
  v_pass  integer;
  v_cfg   jsonb;
  v_ok    boolean;
  v_wrong jsonb := '[]'::jsonb;
  q       record;
begin
  select * into v_a from public.sales_exam_attempts a where a.id = p_attempt and a.staff_id = auth.uid() for update;
  if not found then
    raise exception 'exam not found' using errcode = 'P0002';
  end if;
  if v_a.submitted_at is not null then
    raise exception 'already handed in' using errcode = 'P0001';
  end if;
  if v_a.started_at < now() - interval '60 minutes' then
    raise exception 'time is up; start again' using errcode = 'P0001';
  end if;
  select st.value into v_cfg from public.sales_settings st where st.key = 'training';
  v_pass := case when jsonb_typeof(v_cfg->'pass_pct') = 'number' then least(greatest((v_cfg->>'pass_pct')::numeric, 50), 100)::integer else 80 end;
  v_total := cardinality(v_a.question_ids);
  for q in select id, topic, answer from public.sales_exam_questions where id = any (v_a.question_ids) loop
    if jsonb_typeof(p_answers->(q.id::text)) = 'number' and (p_answers->>(q.id::text))::integer = q.answer then
      v_score := v_score + 1;
    else
      v_wrong := v_wrong || jsonb_build_object('id', q.id, 'topic', q.topic);
    end if;
  end loop;
  v_ok := v_total > 0 and v_score * 100 >= v_pass * v_total;
  update public.sales_exam_attempts
     set answers = p_answers, score = v_score, total = v_total, passed = v_ok, submitted_at = now()
   where id = p_attempt;
  if v_ok then
    update public.sales_staff set qualified_at = coalesce(qualified_at, now()) where user_id = auth.uid();
  end if;
  return jsonb_build_object('score', v_score, 'total', v_total, 'passed', v_ok, 'pass_pct', v_pass, 'wrong', v_wrong);
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 6. Reports (7 pm daily, Monday weekly)
-- ---------------------------------------------------------------------------
create table if not exists public.sales_reports (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('daily', 'weekly')),
  period_from date not null,
  period_to   date not null,
  created_at  timestamptz not null default now(),
  data        jsonb not null,
  sent        jsonb
);
create index if not exists sales_reports_created_idx on public.sales_reports (created_at desc);
alter table public.sales_reports enable row level security;
revoke all on public.sales_reports from public, anon, authenticated;
grant select on public.sales_reports to authenticated;
drop policy if exists sales_reports_read on public.sales_reports;
create policy sales_reports_read on public.sales_reports
  for select to authenticated using (public.sales_is_manager());

-- The numbers for a period (managers, or the service role for the sender).
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

insert into public.automation_secrets (name, secret)
values ('sales-report', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
on conflict (name) do nothing;

-- ---------------------------------------------------------------------------
-- 7. Who may call what
-- ---------------------------------------------------------------------------
revoke all on function public.sales_new_ref_code() from public, anon, authenticated;
revoke all on function public.sales_staff_defaults() from public, anon, authenticated;
revoke all on function public.sales_incentive_amount(uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function public.sales_incentive_add(uuid, uuid, text, integer, text, timestamptz) from public, anon, authenticated;
revoke all on function public.sales_incentive_check(timestamptz) from public, anon, authenticated;
revoke all on function public.sales_incentive_set(uuid, text, text) from public, anon;
revoke all on function public.sales_my_link_stats() from public, anon;
revoke all on function public.sales_exam_start() from public, anon;
revoke all on function public.sales_exam_submit(uuid, jsonb) from public, anon;
revoke all on function public.sales_report_data(date, date) from public, anon;
revoke all on function public.sales_win_review(uuid, boolean) from public, anon;
revoke all on function public.sales_win_from_payment(text, timestamptz, timestamptz, timestamptz, boolean) from public, anon, authenticated;
revoke all on function public.sales_capture_signup() from public, anon, authenticated;
grant execute on function public.sales_incentive_set(uuid, text, text) to authenticated;
grant execute on function public.sales_my_link_stats() to authenticated;
grant execute on function public.sales_exam_start() to authenticated;
grant execute on function public.sales_exam_submit(uuid, jsonb) to authenticated;
grant execute on function public.sales_report_data(date, date) to authenticated, service_role;
grant execute on function public.sales_win_review(uuid, boolean) to authenticated;
