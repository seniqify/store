-- ===========================================================================
--  PocketLink Sales CRM  --  PART 5: the Ads & leads executive, training by role
--
--  * A new role 'ads' (Ads & leads executive). They check leads that arrive
--    from ads and the website, add and import leads, and see lead sources and
--    ad spend. They cannot give leads to a person (the auto-assign rules do),
--    see other people's leads, scores, incentives or attendance, or change
--    Settings or Team. Hot ad leads still go to callers at once; leads they
--    import wait for their check.
--  * Checking a lead: sales_verify_lead() marks it verified (and may fix the
--    name, type and place) or spam / duplicate / wrong number / not a business
--    (the lead is then lost). Lead guard v4: no app login sets these directly.
--  * Their incentive: a small amount for each paid shop from a lead they
--    checked (settings 'incentive'.verifier_monthly / verifier_yearly, 50 / 250),
--    with the same 30-day rule. sales_incentives is now one row per lead and
--    person.
--  * Exams by role: questions carry roles; an exam is up to 9 questions for
--    the person's role and the rest from the common part. Manager sign-off.
--  * Scoreboard v3: adds lead-checking numbers for the new role.
--
--  Still shows NO shop, order or admin data to CRM logins.
--  Run after sales-crm-part4-forward.sql and sales-crm-training-v2.sql.
--  Order: this -> sales-crm-part5-verify.sql (all PASS). Safe to run twice.
--  Undo: sales-crm-part5-ROLLBACK.sql.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. The role
-- ---------------------------------------------------------------------------
alter table public.sales_staff drop constraint if exists sales_staff_role_check;
alter table public.sales_staff add constraint sales_staff_role_check check (role in ('manager', 'caller', 'field', 'ads'));
alter table public.sales_staff add column if not exists signed_off_at timestamptz;
alter table public.sales_staff add column if not exists signed_off_by uuid;

create or replace function public.sales_is_ads()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select exists (select 1 from public.sales_staff s where s.user_id = auth.uid() and s.active and s.role = 'ads')
$fn$;

-- ---------------------------------------------------------------------------
-- 2. Checking leads
-- ---------------------------------------------------------------------------
alter table public.sales_leads add column if not exists verify_status text;
alter table public.sales_leads add column if not exists verified_by uuid;
alter table public.sales_leads add column if not exists verified_at timestamptz;
alter table public.sales_leads add column if not exists verify_note text;

do $$
begin
  alter table public.sales_leads add constraint sales_leads_verify_check
    check ((verify_status is null or verify_status in ('verified', 'spam', 'duplicate', 'wrong_number', 'not_business'))
           and (verify_note is null or length(verify_note) <= 300));
exception when duplicate_object then null;
end $$;
create index if not exists sales_leads_verify_idx on public.sales_leads (verify_status, created_at desc);

-- Lead guard v4: as v3, and checking results only through sales_verify_lead.
create or replace function public.sales_leads_guard()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $fn$
begin
  new.updated_at := now();
  -- Nobody (any login, any function) gives a lead to the Ads & leads team.
  if new.assigned_to is not null and (tg_op = 'INSERT' or new.assigned_to is distinct from old.assigned_to)
     and exists (select 1 from public.sales_staff s where s.user_id = new.assigned_to and s.role = 'ads') then
    raise exception 'leads are not given to the Ads & leads team' using errcode = '22023';
  end if;
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
      new.verify_status := old.verify_status;
      new.verified_by := old.verified_by;
      new.verified_at := old.verified_at;
      new.verify_note := old.verify_note;
    end if;
    if tg_op = 'INSERT' then
      new.created_by := auth.uid();
      new.won_proof := null;
      new.won_proof_at := null;
      new.won_proof_by := null;
      new.verify_status := null;
      new.verified_by := null;
      new.verified_at := null;
      new.verify_note := null;
    end if;
  end if;
  return new;
end;
$fn$;

-- Who sees and adds which leads. The Ads & leads executive sees leads from
-- ads and the website, and the leads they added or checked; they add leads
-- without an owner (they never own leads).
drop policy if exists sales_leads_read on public.sales_leads;
create policy sales_leads_read on public.sales_leads
  for select to authenticated
  using (public.sales_is_manager()
         or (public.sales_is_staff() and assigned_to = auth.uid())
         or (public.sales_is_ads() and (source in ('facebook', 'instagram', 'google', 'website', 'whatsapp')
                                        or created_by = auth.uid() or verified_by = auth.uid())));

drop policy if exists sales_leads_add on public.sales_leads;
create policy sales_leads_add on public.sales_leads
  for insert to authenticated
  with check (public.sales_is_manager()
              or (public.sales_is_staff() and not public.sales_is_ads() and assigned_to = auth.uid())
              or (public.sales_is_ads() and assigned_to is null));

create or replace function public.sales_verify_lead(p_lead uuid, p_status text, p_note text default null, p_fix jsonb default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_lead   record;
  v_reason text;
  v_fix    jsonb := case when jsonb_typeof(p_fix) = 'object' then p_fix else '{}'::jsonb end;
begin
  if not (public.sales_is_ads() or public.sales_is_manager()) then
    raise exception 'only the Ads & leads team or a manager can check leads' using errcode = '42501';
  end if;
  if p_status is null or p_status not in ('verified', 'spam', 'duplicate', 'wrong_number', 'not_business') then
    raise exception 'bad status' using errcode = '22023';
  end if;
  select l.id, l.stage, l.source, l.created_by, l.verified_by into v_lead from public.sales_leads l where l.id = p_lead for update;
  if not found then
    raise exception 'lead not found' using errcode = 'P0002';
  end if;
  if not public.sales_is_manager()
     and not coalesce(v_lead.source in ('facebook', 'instagram', 'google', 'website', 'whatsapp')
                      or v_lead.created_by = auth.uid() or v_lead.verified_by = auth.uid(), false) then
    raise exception 'not a lead you can check' using errcode = '42501';
  end if;
  v_reason := case p_status when 'spam' then 'Spam' when 'duplicate' then 'Duplicate' when 'wrong_number' then 'Wrong number'
                            when 'not_business' then 'Not a business' end;

  update public.sales_leads l
     set verify_status  = p_status,
         verified_by    = auth.uid(),
         verified_at    = now(),
         verify_note    = left(nullif(btrim(coalesce(p_note, '')), ''), 300),
         shop_name      = case when p_status = 'verified' and length(btrim(coalesce(v_fix->>'shop_name', ''))) between 1 and 120
                               then btrim(v_fix->>'shop_name') else l.shop_name end,
         owner_name     = case when p_status = 'verified' and v_fix ? 'owner_name' then left(nullif(btrim(v_fix->>'owner_name'), ''), 80) else l.owner_name end,
         business_type  = case when p_status = 'verified' and v_fix ? 'business_type' then left(nullif(btrim(v_fix->>'business_type'), ''), 60) else l.business_type end,
         city           = case when p_status = 'verified' and v_fix ? 'city' then left(nullif(btrim(v_fix->>'city'), ''), 80) else l.city end,
         area           = case when p_status = 'verified' and v_fix ? 'area' then left(nullif(btrim(v_fix->>'area'), ''), 120) else l.area end,
         stage          = case when p_status <> 'verified' and l.stage <> 'won' then 'lost' else l.stage end,
         lost_reason    = case when p_status <> 'verified' and l.stage <> 'won' then v_reason else l.lost_reason end,
         next_action_at = case when p_status <> 'verified' and l.stage <> 'won' then null else l.next_action_at end,
         next_action    = case when p_status <> 'verified' and l.stage <> 'won' then null else l.next_action end
   where l.id = p_lead;

  insert into public.sales_activities (lead_id, staff_id, kind, outcome, note)
  values (p_lead, auth.uid(), 'system', 'checked_' || p_status,
          left(coalesce(v_reason, 'Checked: a real person and a real business')
               || coalesce(' - ' || nullif(btrim(coalesce(p_note, '')), ''), ''), 2000));
end;
$fn$;

-- The auto-assign rules never pick someone from the Ads & leads team (as
-- part 2, with that one filter).
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
        select s.user_id into v_pick from public.sales_staff s where s.user_id::text = v_rule->>'to' and s.active and s.role <> 'ads';
        if v_pick is not null then
          return v_pick;
        end if;
      end if;
    end loop;
  end if;

  if jsonb_typeof(v_cfg->'pool') = 'array' then
    select array_agg(s.user_id order by p.o) into v_pool
      from jsonb_array_elements_text(v_cfg->'pool') with ordinality as p(u, o)
      join public.sales_staff s on s.user_id::text = p.u and s.active and s.role <> 'ads';
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

-- Give out by the rules: a manager, or the Ads & leads executive for leads
-- they checked (or added and checked).
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
  v_mgr  boolean := public.sales_is_manager();
begin
  if not (v_mgr or public.sales_is_ads()) then
    raise exception 'only a manager can assign' using errcode = '42501';
  end if;
  if coalesce(cardinality(p_leads), 0) > 5000 then
    raise exception 'too many leads at once' using errcode = '22023';
  end if;
  for v_lead in
    select l.id, l.city, l.area from public.sales_leads l
     where l.id = any (p_leads) and l.assigned_to is null and l.stage not in ('won', 'lost')
       and (v_mgr or (l.verify_status = 'verified' and (l.verified_by = auth.uid() or l.created_by = auth.uid())))
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

-- Lead sources: the feed and the events are for managers and the Ads & leads team.
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
  if not (public.sales_is_manager() or public.sales_is_ads()) then
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

drop policy if exists sales_lead_events_read on public.sales_lead_events;
create policy sales_lead_events_read on public.sales_lead_events
  for select to authenticated using (public.sales_is_manager() or public.sales_is_ads());

-- Settings: the Ads & leads executive reads the common keys and keeps ad spend.
drop policy if exists sales_settings_read on public.sales_settings;
create policy sales_settings_read on public.sales_settings
  for select to authenticated
  using (public.sales_is_manager()
         or (public.sales_is_staff() and key in ('auto_assign', 'policies', 'incentive', 'score', 'work', 'training'))
         or (public.sales_is_ads() and key = 'ad_spend'));
drop policy if exists sales_settings_add on public.sales_settings;
create policy sales_settings_add on public.sales_settings
  for insert to authenticated with check (public.sales_is_manager() or (public.sales_is_ads() and key = 'ad_spend'));
drop policy if exists sales_settings_edit on public.sales_settings;
create policy sales_settings_edit on public.sales_settings
  for update to authenticated
  using (public.sales_is_manager() or (public.sales_is_ads() and key = 'ad_spend'))
  with check (public.sales_is_manager() or (public.sales_is_ads() and key = 'ad_spend'));

-- ---------------------------------------------------------------------------
-- 3. Incentives: one row per lead and person; the lead checker's small amount
-- ---------------------------------------------------------------------------
alter table public.sales_incentives drop constraint if exists sales_incentives_basis_check;
alter table public.sales_incentives add constraint sales_incentives_basis_check check (basis in ('link', 'worked', 'approved', 'verified'));
do $$
begin
  if exists (select 1 from pg_constraint where conname = 'sales_incentives_pkey'
             and pg_get_constraintdef(oid) = 'PRIMARY KEY (lead_id)') then
    alter table public.sales_incentives drop constraint sales_incentives_pkey;
    alter table public.sales_incentives add constraint sales_incentives_pkey primary key (lead_id, staff_id);
  end if;
end $$;

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
  v_amt  integer;
begin
  if p_lead is null or p_staff is null then
    return;
  end if;
  select st.value into v_cfg from public.sales_settings st where st.key = 'incentive';
  v_hold := case when jsonb_typeof(v_cfg->'hold_days') = 'number' then least(greatest((v_cfg->>'hold_days')::numeric, 0), 120)::integer else 30 end;
  if p_basis = 'verified' then
    v_amt := case when v_plan = 'yearly'
                  then case when jsonb_typeof(v_cfg->'verifier_yearly') = 'number' then (v_cfg->>'verifier_yearly')::numeric else 250 end
                  else case when jsonb_typeof(v_cfg->'verifier_monthly') = 'number' then (v_cfg->>'verifier_monthly')::numeric else 50 end end;
    v_amt := greatest(0, least(v_amt, 1000000));
  else
    v_amt := public.sales_incentive_amount(p_staff, v_plan, coalesce(p_at, now()));
  end if;
  insert into public.sales_incentives (lead_id, staff_id, plan, paid_amount, incentive, basis, won_at, due_at)
  values (p_lead, p_staff, v_plan, coalesce(p_amount, 0), v_amt, p_basis, coalesce(p_at, now()),
          coalesce(p_at, now()) + make_interval(days => v_hold + 4))
  on conflict (lead_id, staff_id) do nothing;
end;
$fn$;

-- Win from a payment v3: as v2, and the person who checked the lead (Ads &
-- leads) gets their small amount.
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
  select l.id, l.won_proof, l.assigned_to, l.verify_status, l.verified_by into v_lead
    from public.sales_leads l where l.store_slug = p_slug order by l.created_at limit 1 for update;
  if not found then
    select right(regexp_replace(coalesce(nullif(s.config->>'ownerPhone', ''), s.config->>'whatsappNumber', ''), '[^0-9]', '', 'g'), 10)
      into v_p10 from public.stores s where s.slug = p_slug;
    if v_p10 is null or length(v_p10) <> 10 then
      return null;
    end if;
    select l.id, l.won_proof, l.assigned_to, l.verify_status, l.verified_by into v_lead from public.sales_leads l where l.phone = v_p10 for update;
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
    if v_lead.verify_status = 'verified' and v_lead.verified_by is not null
       and exists (select 1 from public.sales_staff s where s.user_id = v_lead.verified_by and s.role = 'ads') then
      perform public.sales_incentive_add(v_lead.id, v_lead.verified_by, case when v_yearly then 'yearly' else 'monthly' end, v_amount, 'verified', v_at);
    end if;
  end if;
  return v_lead.id;
end;
$fn$;

-- Manager approval v3: as v2, and the lead checker's small amount.
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
    returning won_plan, won_amount, verify_status, verified_by into v_lead;
    if not found then
      raise exception 'no win waiting for proof' using errcode = 'P0002';
    end if;
    insert into public.sales_activities (lead_id, staff_id, kind, outcome, note)
    values (p_lead, auth.uid(), 'system', 'win_approved', 'Win approved by the manager');
    select a.staff_id into v_staff from public.sales_activities a
     where a.lead_id = p_lead and a.kind = 'stage' and a.outcome = 'won' and a.staff_id is not null
     order by a.created_at desc limit 1;
    perform public.sales_incentive_add(p_lead, v_staff, coalesce(v_lead.won_plan, 'monthly'), coalesce(v_lead.won_amount, 1499), 'approved', now());
    if v_lead.verify_status = 'verified' and v_lead.verified_by is not null
       and exists (select 1 from public.sales_staff s where s.user_id = v_lead.verified_by and s.role = 'ads') then
      perform public.sales_incentive_add(p_lead, v_lead.verified_by, coalesce(v_lead.won_plan, 'monthly'), coalesce(v_lead.won_amount, 1499), 'verified', now());
    end if;
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

-- Every day v2: as part 4, one row at a time (a lead can now have two rows:
-- the seller's and the lead checker's).
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
    select i.lead_id, i.staff_id, l.store_slug from public.sales_incentives i join public.sales_leads l on l.id = i.lead_id
     where i.status = 'waiting' and i.due_at <= p_now
     for update of i
  loop
    if r.store_slug is null then
      update public.sales_incentives set status = 'check', decided_at = p_now where lead_id = r.lead_id and staff_id = r.staff_id;
    else
      select s.config into v_cfg from public.stores s where s.slug = r.store_slug;
      v_ok := v_cfg is not null and coalesce(v_cfg->>'plan', 'free') <> 'free'
              and coalesce(v_cfg->>'planExpiresAt', '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
              and (v_cfg->>'planExpiresAt')::timestamptz > p_now;
      update public.sales_incentives
         set status = case when v_ok then 'earned' else 'cancelled' end, decided_at = p_now,
             note = case when v_ok then 'Still paying after the hold period' else 'The shop stopped paying within the hold period' end
       where lead_id = r.lead_id and staff_id = r.staff_id;
    end if;
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$fn$;

-- Manager: set an incentive by hand. v2: p_staff picks one person's row on
-- the lead; without it, every row on the lead (the part 4 call still works).
drop function if exists public.sales_incentive_set(uuid, text, text);
create or replace function public.sales_incentive_set(p_lead uuid, p_status text, p_note text default null, p_staff uuid default null)
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
   where lead_id = p_lead and (p_staff is null or staff_id = p_staff)
     and (p_status <> 'paid' or status = 'earned');
  if not found then
    raise exception 'incentive not found, or not earned yet' using errcode = 'P0002';
  end if;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 4. Manager sign-off after the exam
-- ---------------------------------------------------------------------------
create or replace function public.sales_signoff(p_staff uuid, p_on boolean)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  if not public.sales_is_manager() then
    raise exception 'only a manager can sign off' using errcode = '42501';
  end if;
  update public.sales_staff
     set signed_off_at = case when p_on then now() else null end,
         signed_off_by = case when p_on then auth.uid() else null end
   where user_id = p_staff and (not p_on or qualified_at is not null);
  if not found then
    raise exception 'they need to pass the exam first' using errcode = 'P0001';
  end if;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 5. Exams by role
-- ---------------------------------------------------------------------------
alter table public.sales_exam_questions add column if not exists roles text[] not null default '{all}';

-- 'all' (everyone): the product questions 1-9 and 25. The rest by role.
update public.sales_exam_questions set roles = '{all}' where id in (1, 2, 3, 4, 5, 6, 7, 8, 9, 25);
update public.sales_exam_questions set roles = '{caller}' where id in (10, 11, 28);
update public.sales_exam_questions set roles = '{field}' where id in (16, 17, 31);
update public.sales_exam_questions set roles = '{caller,field}' where id in (14, 15, 19, 27, 29, 30, 32);
update public.sales_exam_questions set roles = '{caller,field,ads}' where id = 26;
update public.sales_exam_questions set roles = '{caller,field,manager}' where id in (12, 13, 18, 20, 21, 22, 23, 24);

-- The plan is paid by the shop at pocketlink.store/plans (there is no
-- payment link for executives to send).
update public.sales_exam_questions
   set question = 'A customer wants to pay you in cash for the plan. What do you do?',
       options = '["Take the cash","Ask them to pay at pocketlink.store/plans by UPI, card or net banking (GST invoice)","Ask them to pay to your own UPI","Ask a friend to collect it"]',
       answer = 1
 where id = 22;

insert into public.sales_exam_questions (id, topic, question, options, answer, roles) values
 (33, 'Payment', 'How does a shop pay for PocketLink?', '["At pocketlink.store/plans: pick monthly or yearly, pay by UPI, card or net banking","Cash to the executive","A bank transfer to the manager","A payment link from the CRM"]', 0, '{caller,field}'),
 (34, 'First 30 days', 'A shop paid 10 days ago and has no orders yet. What do you do?', '["Nothing, it is paid","Help them share the link: WhatsApp status, Instagram bio, a QR at the counter, a first offer","Offer a refund","Tell them to wait"]', 1, '{caller,field}'),
 (35, 'Calls', 'After a demo the owner wants to think. What do you save?', '["Not interested","Interested, with a follow-up date","Won","Nothing"]', 1, '{caller}'),
 (36, 'Calls', 'On a video-call demo, what makes the owner decide?', '["A long feature list","Seeing their own shop live with their products","A discount","Other shops'' sales"]', 1, '{caller}'),
 (37, 'Calls', 'A lead says "Do not call me again". What do you do?', '["Call next week","Save Not interested with the reason, and do not call again","Give it to a colleague","Send WhatsApp messages instead"]', 1, '{caller}'),
 (38, 'Field', 'Where do you set up the shop during a visit?', '["On your own phone","On the owner''s phone, with your own sign-up link","Later at the office","You do not; they do it alone"]', 1, '{field}'),
 (39, 'Field', 'The shop is closed when you arrive. What do you do?', '["Nothing","Check in with Shop closed and plan another visit","Mark it lost","Call the manager"]', 1, '{field}'),
 (40, 'Field', 'When do you press Start my day and End my day?', '["Never","When you start work and when you finish","Only on Mondays","When the manager asks"]', 1, '{field}'),
 (41, 'Field', 'A visit is saved only when it has:', '["A note","A photo of the shop front and the location, at the shop","The owner''s signature","A selfie"]', 1, '{field}'),
 (42, 'Manager', 'A caller marked a shop Won, but no payment is seen. What do you do?', '["Count it anyway","Check: approve it if they paid another way, else mark Not paid yet","Delete the lead","Pay the incentive"]', 1, '{manager}'),
 (43, 'Manager', 'When is an incentive earned?', '["The day the shop pays","When the shop is still paying at the check after the hold (30 days)","At the end of the year","When the caller asks"]', 1, '{manager}'),
 (44, 'Manager', 'A field visit is flagged as far from where the shop was first checked in. What do you do?', '["Ignore it","Ask the person, then mark it fine or do not count it","Fire them","Delete the visit"]', 1, '{manager}'),
 (45, 'Manager', 'How do new ad and website leads reach callers?', '["You forward them on WhatsApp","The auto-assign rules give them out; turn them on in Assign","Callers pick them","They wait for the weekly report"]', 1, '{manager}'),
 (46, 'Manager', 'A new hire passed the exam. What is the next step?', '["Nothing","Listen to their calls or join their visits, then sign them off in Team","Give them all the leads","Change their password"]', 1, '{manager}'),
 (47, 'Manager', 'Where do you change targets, area weights and the incentive rule?', '["Team","Settings","Reports","FAQ & help"]', 1, '{manager}'),
 (48, 'Manager', 'Someone is on leave tomorrow with many follow-ups. What do you do?', '["Nothing","In Assign, show their leads and give them to someone else","Delete the follow-ups","Ask them to work anyway"]', 1, '{manager}'),
 (49, 'Ads & leads', 'A new Facebook lead arrives. Who calls it first?', '["You, before anyone","The caller the rules give it to, within 5 minutes; you check it at the same time","The manager","Nobody until it is checked"]', 1, '{ads}'),
 (50, 'Ads & leads', 'When do you mark a lead Verified?', '["Always","When it is a real person with a real business and a working number, not already in the CRM","When the ad was expensive","When the caller asks"]', 1, '{ads}'),
 (51, 'Ads & leads', 'The name is random letters and the number does not exist. What do you mark?', '["Verified","Spam","Duplicate","Leave it"]', 1, '{ads}'),
 (52, 'Ads & leads', 'You import a list from Facebook Leads Center. When does the team get it?', '["At once","After you check the leads and give them out by the rules","Next month","Never"]', 1, '{ads}'),
 (53, 'Ads & leads', 'Which number shows best that a campaign is good?', '["Likes","Leads","Cost per paid shop","Reach"]', 2, '{ads}'),
 (54, 'Ads & leads', 'Where do you enter the money spent on ads?', '["Settings","Lead sources, Enter ad spend","Team","Nowhere"]', 1, '{ads}'),
 (55, 'Ads & leads', 'What do you earn for a lead you checked?', '["Nothing","A small amount when that shop pays and still pays after 30 days","The caller''s incentive","A fixed salary bonus"]', 1, '{ads}'),
 (56, 'Ads & leads', 'May you give a lead to a person yourself?', '["Yes, to anyone","No: you give checked leads out by the auto-assign rules","Only to friends","Only on weekends"]', 1, '{ads}')
on conflict (id) do update set topic = excluded.topic, question = excluded.question, options = excluded.options,
                               answer = excluded.answer, roles = excluded.roles;

-- Start (or continue) an exam: up to 9 questions for the person's role, the
-- rest from the common part, 15 in all; no answers sent.
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
  v_role  text;
begin
  if not public.sales_is_staff() then
    raise exception 'not on the sales team' using errcode = '42501';
  end if;
  select s.role into v_role from public.sales_staff s where s.user_id = auth.uid();
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
    with mine as (
      select id from public.sales_exam_questions where active and v_role = any (roles) order by random() limit 9
    ), common as (
      select id from public.sales_exam_questions
       where active and 'all' = any (roles) and id not in (select id from mine)
       order by random() limit greatest(0, 15 - (select count(*) from mine))
    )
    select array_agg(id) into v_ids from (select id from mine union all select id from common) q;
    insert into public.sales_exam_attempts (staff_id, question_ids) values (auth.uid(), v_ids) returning id into v_id;
  end if;
  return jsonb_build_object(
    'attempt_id', v_id,
    'questions', (select jsonb_agg(jsonb_build_object('id', q.id, 'topic', q.topic, 'question', q.question, 'options', q.options) order by array_position(v_ids, q.id))
                    from public.sales_exam_questions q where q.id = any (v_ids)));
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 6. Scoreboard v3: adds checking numbers for the Ads & leads executive
-- ---------------------------------------------------------------------------
drop function if exists public.sales_scoreboard(date, date);
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

-- ---------------------------------------------------------------------------
-- 7. Who may call what
-- ---------------------------------------------------------------------------
revoke all on function public.sales_is_ads() from public, anon;
revoke all on function public.sales_verify_lead(uuid, text, text, jsonb) from public, anon;
revoke all on function public.sales_pick_owner(text) from public, anon, authenticated;
revoke all on function public.sales_incentive_check(timestamptz) from public, anon, authenticated;
revoke all on function public.sales_auto_assign(uuid[]) from public, anon;
revoke all on function public.sales_lead_feed(timestamptz) from public, anon;
revoke all on function public.sales_incentive_add(uuid, uuid, text, integer, text, timestamptz) from public, anon, authenticated;
revoke all on function public.sales_win_from_payment(text, timestamptz, timestamptz, timestamptz, boolean) from public, anon, authenticated;
revoke all on function public.sales_win_review(uuid, boolean) from public, anon;
revoke all on function public.sales_incentive_set(uuid, text, text, uuid) from public, anon;
revoke all on function public.sales_signoff(uuid, boolean) from public, anon;
revoke all on function public.sales_exam_start() from public, anon;
revoke all on function public.sales_scoreboard(date, date) from public, anon;
grant execute on function public.sales_is_ads() to authenticated;
grant execute on function public.sales_verify_lead(uuid, text, text, jsonb) to authenticated;
grant execute on function public.sales_auto_assign(uuid[]) to authenticated;
grant execute on function public.sales_lead_feed(timestamptz) to authenticated;
grant execute on function public.sales_win_review(uuid, boolean) to authenticated;
grant execute on function public.sales_incentive_set(uuid, text, text, uuid) to authenticated;
grant execute on function public.sales_signoff(uuid, boolean) to authenticated;
grant execute on function public.sales_exam_start() to authenticated;
grant execute on function public.sales_scoreboard(date, date) to authenticated;
