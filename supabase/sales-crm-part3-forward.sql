-- ===========================================================================
--  PocketLink Sales CRM  --  PART 3
--
--  * Leads straight from ads and the website: sales_lead_in() takes a lead
--    from the sales-lead-in edge function (Google Ads lead forms, Facebook /
--    Instagram lead ads, the "call me back" form on pocketlink.store), skips
--    repeats, reopens a number that comes back, queues night leads for 9:30
--    and gives them out by the auto-assign rules. Every arrival is logged in
--    sales_lead_events for the Lead sources screen.
--  * Not called in time: sales_rotate_slow_leads() (pg_cron, every 5 min,
--    see sales-crm-part3-schedule.sql) moves an ad lead nobody called to the
--    next person, once. Off unless the manager sets the minutes.
--  * Win proof: a win counts when PocketLink sees the payment (a Razorpay
--    entitlement for the lead's shop) or the manager approves it. The
--    scoreboard counts only proven wins and reports the rest as pending,
--    and adds talk time from the call timer.
--
--  Still shows NO shop, order or admin data to CRM logins.
--  Run after sales-crm-part2-forward.sql. Order: this -> sales-crm-part3-verify.sql
--  (all PASS) -> sales-crm-part3-schedule.sql. Safe to run twice.
--  Undo: sales-crm-part3-ROLLBACK.sql.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Settings: two manager-only keys (lead source keys, ad spend)
-- ---------------------------------------------------------------------------
alter table public.sales_settings drop constraint if exists sales_settings_key_check;
alter table public.sales_settings add constraint sales_settings_key_check
  check (key in ('auto_assign', 'policies', 'incentive', 'lead_sources', 'ad_spend'));

drop policy if exists sales_settings_read on public.sales_settings;
create policy sales_settings_read on public.sales_settings
  for select to authenticated
  using (public.sales_is_manager()
         or (public.sales_is_staff() and key in ('auto_assign', 'policies', 'incentive')));

-- Server-only values (the Facebook Page token). No policy: no app login can
-- read or write it; only the service role (edge functions) can.
create table if not exists public.sales_private (
  key        text primary key check (key ~ '^[a-z_]{2,40}$'),
  value      text not null check (length(value) <= 4000),
  updated_at timestamptz not null default now()
);
alter table public.sales_private enable row level security;
revoke all on public.sales_private from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Win proof columns, and lead guard v3 (proof can only be set by the
--    database functions below, never by an app login directly)
-- ---------------------------------------------------------------------------
alter table public.sales_leads add column if not exists won_proof text;
alter table public.sales_leads add column if not exists won_proof_at timestamptz;
alter table public.sales_leads add column if not exists won_proof_by uuid;

do $$
begin
  alter table public.sales_leads
    add constraint sales_leads_won_proof_check check (won_proof is null or won_proof in ('payment', 'manager'));
exception when duplicate_object then null;
end $$;

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

-- ---------------------------------------------------------------------------
-- 3. Leads that arrive by themselves
-- ---------------------------------------------------------------------------
create table if not exists public.sales_lead_events (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  source      text not null check (source in ('facebook', 'instagram', 'google', 'website', 'whatsapp')),
  external_id text check (external_id is null or length(external_id) <= 200),
  outcome     text not null check (outcome in ('new', 'again', 'test', 'bad_phone', 'rate_limited', 'fetch_failed')),
  phone       text check (phone is null or phone ~ '^[0-9]{10}$'),
  name        text check (name is null or length(name) <= 120),
  shop        text check (shop is null or length(shop) <= 120),
  city        text check (city is null or length(city) <= 80),
  campaign    text check (campaign is null or length(campaign) <= 200),
  form        text check (form is null or length(form) <= 200),
  lead_id     uuid references public.sales_leads (id) on delete set null,
  ip_hash     text check (ip_hash is null or length(ip_hash) <= 80),
  raw         jsonb check (raw is null or length(raw::text) <= 8000)
);

create unique index if not exists sales_lead_events_external_key on public.sales_lead_events (source, external_id) where external_id is not null;
create index if not exists sales_lead_events_created_idx on public.sales_lead_events (created_at desc);
create index if not exists sales_lead_events_ip_idx on public.sales_lead_events (ip_hash, created_at) where ip_hash is not null;

alter table public.sales_lead_events enable row level security;
revoke all on public.sales_lead_events from public, anon, authenticated;
grant select on public.sales_lead_events to authenticated;

drop policy if exists sales_lead_events_read on public.sales_lead_events;
create policy sales_lead_events_read on public.sales_lead_events
  for select to authenticated
  using (public.sales_is_manager());

-- When to call a lead that arrives now: now in the day (9 am - 8 pm India
-- time), else 9:30 am on the next working morning.
create or replace function public.sales_callable_at(p_at timestamptz)
returns timestamptz
language sql
stable
set search_path = public, pg_temp
as $fn$
  select case
    when (p_at at time zone 'Asia/Kolkata')::time between time '09:00' and time '20:00' then p_at
    when (p_at at time zone 'Asia/Kolkata')::time < time '09:00'
      then ((p_at at time zone 'Asia/Kolkata')::date + time '09:30') at time zone 'Asia/Kolkata'
    else (((p_at at time zone 'Asia/Kolkata')::date + 1) + time '09:30') at time zone 'Asia/Kolkata'
  end
$fn$;

-- One lead in. Called by the sales-lead-in edge function (service role only).
create or replace function public.sales_lead_in(
  p_source      text,
  p_external_id text,
  p_name        text,
  p_phone       text,
  p_shop        text,
  p_city        text,
  p_campaign    text,
  p_form        text,
  p_is_test     boolean default false,
  p_ip_hash     text default null,
  p_raw         jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_p10    text := right(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'), 10);
  v_label  text;
  v_detail text := left(nullif(concat_ws(' - ', nullif(btrim(p_campaign), ''), nullif(btrim(p_form), '')), ''), 200);
  v_raw    jsonb := case when p_raw is null or length(p_raw::text) > 8000 then null else p_raw end;
  v_at     timestamptz := public.sales_callable_at(now());
  v_lead   record;
  v_id     uuid;
  v_pick   uuid;
  v_name   text := left(nullif(btrim(p_name), ''), 120);
  v_shop   text := left(nullif(btrim(p_shop), ''), 120);
  v_city   text := left(nullif(btrim(p_city), ''), 80);
  v_ext    text := left(nullif(btrim(p_external_id), ''), 200);
begin
  if p_source is null or p_source not in ('facebook', 'instagram', 'google', 'website', 'whatsapp') then
    raise exception 'bad source' using errcode = '22023';
  end if;
  v_label := case p_source when 'facebook' then 'Facebook ad' when 'instagram' then 'Instagram ad'
                           when 'google' then 'Google ad' when 'whatsapp' then 'WhatsApp ad'
                           else 'Website call-back form' end;

  -- The same lead delivered twice (webhook retries).
  if v_ext is not null then
    select e.lead_id into v_id from public.sales_lead_events e where e.source = p_source and e.external_id = v_ext limit 1;
    if found then
      return jsonb_build_object('outcome', 'duplicate', 'lead_id', v_id);
    end if;
  end if;

  if coalesce(p_is_test, false) then
    insert into public.sales_lead_events (source, external_id, outcome, phone, name, shop, city, campaign, form, raw)
    values (p_source, v_ext, 'test', case when v_p10 ~ '^[0-9]{10}$' then v_p10 end, v_name, v_shop, v_city, left(p_campaign, 200), left(p_form, 200), v_raw);
    return jsonb_build_object('outcome', 'test');
  end if;

  -- The website form: at most 5 a hour from one address.
  if p_ip_hash is not null
     and (select count(*) from public.sales_lead_events e where e.ip_hash = p_ip_hash and e.created_at > now() - interval '1 hour') >= 5 then
    insert into public.sales_lead_events (source, outcome, ip_hash) values (p_source, 'rate_limited', left(p_ip_hash, 80));
    return jsonb_build_object('outcome', 'rate_limited');
  end if;

  if v_p10 !~ '^[6-9][0-9]{9}$' then
    insert into public.sales_lead_events (source, external_id, outcome, name, shop, city, campaign, form, ip_hash, raw)
    values (p_source, v_ext, 'bad_phone', v_name, v_shop, v_city, left(p_campaign, 200), left(p_form, 200), left(p_ip_hash, 80), v_raw);
    return jsonb_build_object('outcome', 'bad_phone');
  end if;

  select l.id, l.stage, l.city, l.area, l.assigned_to into v_lead from public.sales_leads l where l.phone = v_p10 for update;
  if found then
    -- A number that is already a lead: call it again now (a lost one reopens).
    update public.sales_leads l
       set heat           = 'hot',
           stage          = case when l.stage = 'lost' then 'new' else l.stage end,
           next_action_at = case when l.stage = 'won' then l.next_action_at else least(coalesce(l.next_action_at, v_at), v_at) end,
           next_action    = case when l.stage = 'won' then l.next_action else left('Came back (' || v_label || ') - call now', 200) end,
           city           = coalesce(l.city, v_city),
           owner_name     = coalesce(l.owner_name, left(v_name, 80))
     where l.id = v_lead.id;
    insert into public.sales_activities (lead_id, staff_id, kind, outcome, note)
    values (v_lead.id, null, 'system', 'came_again', left('Came again: ' || v_label || coalesce(' - ' || v_detail, ''), 2000));
    v_id := v_lead.id;
    if v_lead.assigned_to is null then
      v_pick := public.sales_pick_owner(concat_ws(' ', coalesce(v_lead.city, v_city), v_lead.area));
      if v_pick is not null then
        update public.sales_leads set assigned_to = v_pick where id = v_id;
        insert into public.sales_activities (lead_id, staff_id, kind, outcome, note)
        values (v_id, null, 'assign', v_pick::text, 'Given out by the auto-assign rules');
      end if;
    end if;
    insert into public.sales_lead_events (source, external_id, outcome, phone, name, shop, city, campaign, form, lead_id, ip_hash, raw)
    values (p_source, v_ext, 'again', v_p10, v_name, v_shop, v_city, left(p_campaign, 200), left(p_form, 200), v_id, left(p_ip_hash, 80), v_raw);
    return jsonb_build_object('outcome', 'again', 'lead_id', v_id);
  end if;

  insert into public.sales_leads (shop_name, owner_name, phone, city, source, source_detail, heat, next_action_at, next_action)
  values (coalesce(v_shop, v_name, v_label || ' lead'), left(v_name, 80), v_p10, v_city, p_source, v_detail, 'hot', v_at,
          case when p_source = 'website' then 'Asked for a call back - call within 5 min' else 'New ad lead - call within 5 min' end)
  returning id into v_id;
  insert into public.sales_activities (lead_id, staff_id, kind, outcome, note)
  values (v_id, null, 'system', 'lead_in', left(v_label || coalesce(' - ' || v_detail, ''), 2000));
  v_pick := public.sales_pick_owner(v_city);
  if v_pick is not null then
    update public.sales_leads set assigned_to = v_pick where id = v_id;
    insert into public.sales_activities (lead_id, staff_id, kind, outcome, note)
    values (v_id, null, 'assign', v_pick::text, 'Given out by the auto-assign rules');
  end if;
  insert into public.sales_lead_events (source, external_id, outcome, phone, name, shop, city, campaign, form, lead_id, ip_hash, raw)
  values (p_source, v_ext, 'new', v_p10, v_name, v_shop, v_city, left(p_campaign, 200), left(p_form, 200), v_id, left(p_ip_hash, 80), v_raw);
  return jsonb_build_object('outcome', 'new', 'lead_id', v_id, 'assigned', v_pick is not null);
end;
$fn$;

-- A lead the edge function could not read (Facebook lead not fetched).
create or replace function public.sales_lead_failed(p_source text, p_external_id text, p_campaign text, p_raw jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  insert into public.sales_lead_events (source, external_id, outcome, campaign, raw)
  values (p_source, left(p_external_id, 200), 'fetch_failed', left(p_campaign, 200),
          case when p_raw is null or length(p_raw::text) > 8000 then null else p_raw end)
  on conflict do nothing;
end;
$fn$;

-- Manager: what came in since an instant, with how fast it was first called.
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

-- ---------------------------------------------------------------------------
-- 4. Not called in time: move an ad lead to the next person (once)
-- ---------------------------------------------------------------------------
create or replace function public.sales_rotate_slow_leads(p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_cfg  jsonb;
  v_min  integer := 0;
  v_now  time := (p_now at time zone 'Asia/Kolkata')::time;
  v_lead record;
  v_pick uuid;
  v_i    integer;
  v_n    integer := 0;
begin
  select st.value into v_cfg from public.sales_settings st where st.key = 'auto_assign';
  if v_cfg is null or jsonb_typeof(v_cfg->'on') is distinct from 'boolean' or not (v_cfg->>'on')::boolean then
    return 0;
  end if;
  if jsonb_typeof(v_cfg->'rotate_min') = 'number' then
    v_min := least(greatest((v_cfg->>'rotate_min')::numeric, 0), 240)::integer;
  end if;
  if v_min < 5 or v_now < time '09:30' or v_now > time '20:00' then
    return 0;
  end if;
  for v_lead in
    select l.id, l.city, l.area, l.assigned_to from public.sales_leads l
     where l.source in ('facebook', 'instagram', 'google', 'website', 'whatsapp')
       and l.stage = 'new' and l.last_activity_at is null and l.assigned_to is not null
       and l.next_action_at <= p_now - make_interval(mins => v_min)
       and l.created_at > p_now - interval '2 days'
       and not exists (select 1 from public.sales_activities a
                        where a.lead_id = l.id and a.kind = 'assign' and a.note like 'Not called in%')
     order by l.created_at
     limit 200
  loop
    v_pick := null;
    for v_i in 1..6 loop
      v_pick := public.sales_pick_owner(concat_ws(' ', v_lead.city, v_lead.area));
      exit when v_pick is null or v_pick <> v_lead.assigned_to;
    end loop;
    continue when v_pick is null or v_pick = v_lead.assigned_to;
    update public.sales_leads set assigned_to = v_pick where id = v_lead.id;
    insert into public.sales_activities (lead_id, staff_id, kind, outcome, note)
    values (v_lead.id, null, 'assign', v_pick::text, 'Not called in ' || v_min || ' min, moved to the next person');
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 5. Win proof
-- ---------------------------------------------------------------------------
-- A verified payment for a shop: the lead for that shop (by its link, else by
-- the owner's mobile) is won with proof. The lead's owner gets the credit
-- only if they called or visited it before the payment (a shop that paid by
-- itself is still recorded as won, without credit).
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
         won_amount = case when v_yearly then 14999 else 1499 end,
         store_slug = coalesce(l.store_slug, p_slug), signed_up = true,
         next_action_at = null, next_action = null, lost_reason = null
   where l.id = v_lead.id;
  insert into public.sales_activities (lead_id, staff_id, kind, outcome, note)
  values (v_lead.id, null, 'system', 'payment_verified',
          case when v_yearly then 'Paid the yearly PocketLink plan. Payment verified.' else 'Paid the monthly PocketLink plan. Payment verified.' end);

  if p_credit and v_lead.assigned_to is not null
     and not exists (select 1 from public.sales_activities a where a.lead_id = v_lead.id and a.kind = 'stage' and a.outcome = 'won')
     and exists (select 1 from public.sales_activities a where a.lead_id = v_lead.id and a.staff_id = v_lead.assigned_to
                  and a.kind in ('call', 'visit') and a.created_at <= v_at) then
    insert into public.sales_activities (lead_id, staff_id, kind, outcome, note)
    values (v_lead.id, v_lead.assigned_to, 'stage', 'won', 'Credited: the shop paid after your calls or visits');
  end if;
  return v_lead.id;
end;
$fn$;

create or replace function public.sales_capture_payment()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  begin
    if new.source in ('razorpay_subscription', 'razorpay_payment') and new.status = 'active' and new.plan <> 'free'
       and (tg_op = 'INSERT' or old.status is distinct from new.status) then
      perform public.sales_win_from_payment(new.store_slug, new.starts_at, new.expires_at, coalesce(new.verified_at, now()), true);
    end if;
  exception when others then
    raise warning 'sales_capture_payment skipped: %', sqlerrm;
  end;
  return new;
end;
$fn$;

do $$
begin
  if to_regclass('public.plan_entitlements') is not null then
    execute 'drop trigger if exists sales_capture_payment on public.plan_entitlements';
    execute 'create trigger sales_capture_payment after insert or update of status on public.plan_entitlements
             for each row execute function public.sales_capture_payment()';
  end if;
end $$;

-- Shops that already paid: their leads are won with proof (no credit to
-- anyone today; the wins happened before).
do $$
declare
  r record;
begin
  if to_regclass('public.plan_entitlements') is not null then
    for r in execute
      'select distinct on (store_slug) store_slug, starts_at, expires_at, verified_at
         from public.plan_entitlements
        where source in (''razorpay_subscription'', ''razorpay_payment'') and status = ''active'' and plan <> ''free''
        order by store_slug, verified_at desc nulls last'
    loop
      perform public.sales_win_from_payment(r.store_slug, r.starts_at, r.expires_at, r.verified_at, false);
    end loop;
  end if;
end $$;

-- Manager: approve a win with no payment seen (paid another way), or say it
-- is not a win yet (back to Interested).
create or replace function public.sales_win_review(p_lead uuid, p_ok boolean)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  if not public.sales_is_manager() then
    raise exception 'only a manager can approve wins' using errcode = '42501';
  end if;
  if p_ok then
    update public.sales_leads set won_proof = 'manager', won_proof_at = now(), won_proof_by = auth.uid()
     where id = p_lead and stage = 'won' and won_proof is null;
    if not found then
      raise exception 'no win waiting for proof' using errcode = 'P0002';
    end if;
    insert into public.sales_activities (lead_id, staff_id, kind, outcome, note)
    values (p_lead, auth.uid(), 'system', 'win_approved', 'Win approved by the manager');
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

-- Manager: wins someone marked that have no proof yet.
create or replace function public.sales_pending_wins()
returns table (lead_id uuid, shop_name text, staff_id uuid, won_at timestamptz, won_plan text, won_amount integer, signed_up boolean)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
#variable_conflict use_column
begin
  if not public.sales_is_manager() then
    raise exception 'only a manager can see this' using errcode = '42501';
  end if;
  return query
  select distinct on (l.id) l.id, l.shop_name, a.staff_id, a.created_at, l.won_plan, l.won_amount, l.signed_up
    from public.sales_leads l
    join public.sales_activities a on a.lead_id = l.id and a.kind = 'stage' and a.outcome = 'won' and a.staff_id is not null
   where l.stage = 'won' and l.won_proof is null
   order by l.id, a.created_at desc;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 6. Scoreboard v2: only proven wins count; pending wins and talk time added
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 7. Who may call what
-- ---------------------------------------------------------------------------
revoke all on function public.sales_callable_at(timestamptz) from public, anon;
revoke all on function public.sales_lead_in(text, text, text, text, text, text, text, text, boolean, text, jsonb) from public, anon, authenticated;
revoke all on function public.sales_lead_failed(text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.sales_lead_feed(timestamptz) from public, anon;
revoke all on function public.sales_rotate_slow_leads(timestamptz) from public, anon, authenticated;
revoke all on function public.sales_win_from_payment(text, timestamptz, timestamptz, timestamptz, boolean) from public, anon, authenticated;
revoke all on function public.sales_capture_payment() from public, anon, authenticated;
revoke all on function public.sales_win_review(uuid, boolean) from public, anon;
revoke all on function public.sales_pending_wins() from public, anon;
grant execute on function public.sales_pending_wins() to authenticated;
revoke all on function public.sales_scoreboard(date, date) from public, anon;
grant execute on function public.sales_callable_at(timestamptz) to authenticated;
grant execute on function public.sales_lead_feed(timestamptz) to authenticated;
grant execute on function public.sales_win_review(uuid, boolean) to authenticated;
grant execute on function public.sales_scoreboard(date, date) to authenticated;
grant execute on function public.sales_lead_in(text, text, text, text, text, text, text, text, boolean, text, jsonb) to service_role;
grant execute on function public.sales_lead_failed(text, text, text, jsonb) to service_role;
