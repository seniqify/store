-- ===========================================================================
--  PocketLink Admin  --  PART 3
--
--  Adds, on top of parts 1 and 2 (run admin-part1/2-forward.sql first):
--    * Platform switches (platform_settings), changed by the Owner only:
--        signups      off = new shops cannot sign up (a number that already
--                     paid still can); existing shops and renewals are
--                     never affected. Enforced here by a trigger on stores.
--        banner       a line of text on every shop owner's dashboard.
--        maintenance  shop dashboards show "back in a few minutes"; shop
--                     pages stay open.
--      platform_flags() is what the shop app reads (anon may call it).
--    * Scheduled jobs (pg_cron): the list with last run and failures, Run
--      now and Pause / Resume (Owner only).
--    * Removing a deleted shop for good, 30 days or more after it was
--      deleted (Owner only, type the shop link): its content is erased (the
--      row stays as a "Removed shop" placeholder so billing records and old
--      links keep pointing at nothing), its PIN can never match again, and
--      its connected accounts (payment, courier, Meta, WhatsApp keys) and
--      marketing data are deleted. Orders, reviews, parcel records, Coins
--      and plan payments are KEPT: those tables refuse deletes on purpose.
--      Photos are removed by the admin-system edge function afterwards.
--    * admin_set_status: a shop removed for good cannot be opened again.
--    * admin_note: also 'purge_photos'.
--  Every change is in admin_audit. Order: this -> admin-part3-verify.sql.
--  Safe to run twice. Undo: admin-part3-ROLLBACK.sql.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Platform switches
-- ---------------------------------------------------------------------------
create table if not exists public.platform_settings (
  key        text primary key check (key in ('signups', 'banner', 'maintenance')),
  is_on      boolean not null default false,
  note       text check (note is null or length(note) <= 200),
  updated_at timestamptz not null default now(),
  updated_by uuid
);
alter table public.platform_settings enable row level security;
revoke all on public.platform_settings from public, anon, authenticated;
insert into public.platform_settings (key, is_on) values ('signups', true), ('banner', false), ('maintenance', false)
on conflict (key) do nothing;

-- What the shop app needs to know (no names, no history).
create or replace function public.platform_flags()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select jsonb_build_object(
    'signupsOpen', coalesce((select p.is_on from public.platform_settings p where p.key = 'signups'), true),
    'banner', (select case when p.is_on then nullif(btrim(coalesce(p.note, '')), '') end from public.platform_settings p where p.key = 'banner'),
    'maintenance', coalesce((select p.is_on from public.platform_settings p where p.key = 'maintenance'), false),
    'maintenanceText', (select case when p.is_on then nullif(btrim(coalesce(p.note, '')), '') end from public.platform_settings p where p.key = 'maintenance'))
$fn$;

create or replace function public.admin_switches()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
begin
  perform public.admin_require('see');
  return coalesce((
    select jsonb_agg(jsonb_build_object('key', p.key, 'on', p.is_on, 'note', p.note, 'at', p.updated_at, 'by', t.name) order by p.key)
      from public.platform_settings p
      left join public.admin_team t on t.user_id = p.updated_by), '[]'::jsonb);
end;
$fn$;

create or replace function public.admin_switch_set(p_key text, p_on boolean, p_note text, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_old  record;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  perform public.admin_require('system');
  if p_key is null or p_key not in ('signups', 'banner', 'maintenance') then
    raise exception 'unknown switch' using errcode = '22023';
  end if;
  if p_on is null then
    raise exception 'on or off?' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'write a reason' using errcode = '22023';
  end if;
  if v_note is not null and length(v_note) > 200 then
    raise exception 'keep the text under 200 letters' using errcode = '22023';
  end if;
  if p_key = 'signups' then
    v_note := null;
  end if;
  if p_key = 'banner' and p_on and v_note is null then
    raise exception 'write the banner text first' using errcode = '22023';
  end if;
  insert into public.platform_settings (key, is_on) values (p_key, p_key = 'signups') on conflict (key) do nothing;
  select p.is_on, p.note into v_old from public.platform_settings p where p.key = p_key for update;
  if v_old.is_on is not distinct from p_on and v_old.note is not distinct from v_note then
    return public.platform_flags();
  end if;
  update public.platform_settings
     set is_on = p_on, note = v_note, updated_at = now(), updated_by = auth.uid()
   where key = p_key;
  perform public.admin_log(case when v_old.is_on is distinct from p_on then (case when p_on then 'switch_on' else 'switch_off' end) else 'switch_text' end,
                           'switch', p_key,
                           jsonb_build_object('on', v_old.is_on, 'text', v_old.note),
                           jsonb_build_object('on', p_on, 'text', v_note), p_reason);
  return public.platform_flags();
end;
$fn$;

-- New shops while sign-ups are off: refused, unless this number already paid
-- (pending_signups), so nobody who paid is ever left without their shop.
-- Only browser inserts are checked; the service role and SQL are not.
create or replace function public.stores_signup_gate()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_role  text := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'role', '');
  v_phone text := right(regexp_replace(coalesce(new.config->>'ownerPhone', new.config->>'whatsappNumber', ''), '[^0-9]', '', 'g'), 10);
begin
  if v_role not in ('anon', 'authenticated') then
    return new;
  end if;
  if coalesce((select p.is_on from public.platform_settings p where p.key = 'signups'), true) then
    return new;
  end if;
  if public.admin_role() is not null then
    return new;
  end if;
  if length(v_phone) = 10 and exists (
       select 1 from public.pending_signups s
        where right(regexp_replace(coalesce(s.phone, ''), '[^0-9]', '', 'g'), 10) = v_phone) then
    return new;
  end if;
  raise exception 'New sign-ups are paused for a short while. Please try again later.' using errcode = 'P0001';
end;
$fn$;
drop trigger if exists stores_signup_gate on public.stores;
create trigger stores_signup_gate
  before insert on public.stores
  for each row execute function public.stores_signup_gate();

-- ---------------------------------------------------------------------------
-- 2. Scheduled jobs (pg_cron). Times in cron are UTC.
-- ---------------------------------------------------------------------------
create or replace function public.admin_jobs()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
declare
  v jsonb;
begin
  perform public.admin_require('see');
  if to_regclass('cron.job') is null or to_regclass('cron.job_run_details') is null then
    return '[]'::jsonb;
  end if;
  -- One pass over the last 8 days of runs (the weekly job runs every 7).
  with recent as (
    select r.jobid, r.start_time, r.end_time, r.status, r.return_message
      from cron.job_run_details r
     where r.start_time > now() - interval '8 days'
  ), last_run as (
    select distinct on (r.jobid) r.jobid, r.start_time, r.end_time, r.status, r.return_message
      from recent r
     order by r.jobid, r.start_time desc
  ), day_counts as (
    select r.jobid,
           count(*) filter (where r.start_time > now() - interval '24 hours') as runs,
           count(*) filter (where r.start_time > now() - interval '24 hours' and r.status = 'failed') as fails
      from recent r
     group by r.jobid
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', j.jobid, 'name', j.jobname, 'schedule', j.schedule, 'active', j.active,
           'last_start', l.start_time, 'last_end', l.end_time, 'last_status', l.status,
           'last_message', left(l.return_message, 200),
           'runs_24h', coalesce(c.runs, 0), 'fails_24h', coalesce(c.fails, 0)) order by j.jobname), '[]'::jsonb)
    into v
    from cron.job j
    left join last_run l on l.jobid = j.jobid
    left join day_counts c on c.jobid = j.jobid;
  return v;
end;
$fn$;

-- Run a job once, now, exactly as the scheduler would (its own command).
create or replace function public.admin_job_run(p_job bigint, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_cmd  text;
  v_name text;
  v_err  text;
begin
  perform public.admin_require('system');
  if length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'write a reason' using errcode = '22023';
  end if;
  if to_regclass('cron.job') is null then
    raise exception 'scheduled jobs are not set up here' using errcode = 'P0002';
  end if;
  select j.command, j.jobname into v_cmd, v_name from cron.job j where j.jobid = p_job;
  if v_cmd is null then
    raise exception 'job not found' using errcode = 'P0002';
  end if;
  begin
    execute regexp_replace(v_cmd, ';\s*$', '');
  exception when others then
    v_err := left(sqlerrm, 200);
  end;
  perform public.admin_log('job_run', 'job', coalesce(v_name, p_job::text), null,
                           jsonb_build_object('result', case when v_err is null then 'started' else 'failed' end, 'error', v_err), p_reason);
  return jsonb_build_object('ok', v_err is null, 'error', v_err);
end;
$fn$;

create or replace function public.admin_job_pause(p_job bigint, p_active boolean, p_reason text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_name text;
  v_was  boolean;
begin
  perform public.admin_require('system');
  if p_active is null then
    raise exception 'pause or resume?' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'write a reason' using errcode = '22023';
  end if;
  if to_regclass('cron.job') is null then
    raise exception 'scheduled jobs are not set up here' using errcode = 'P0002';
  end if;
  select j.jobname, j.active into v_name, v_was from cron.job j where j.jobid = p_job;
  if v_was is null then
    raise exception 'job not found' using errcode = 'P0002';
  end if;
  if v_was = p_active then
    return p_active;
  end if;
  perform cron.alter_job(job_id := p_job, active := p_active);
  perform public.admin_log(case when p_active then 'job_resumed' else 'job_paused' end, 'job', coalesce(v_name, p_job::text),
                           jsonb_build_object('active', v_was), jsonb_build_object('active', p_active), p_reason);
  return p_active;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 3. Removing a deleted shop for good (30 days after delete)
-- ---------------------------------------------------------------------------
create or replace function public.admin_purge_list()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
begin
  perform public.admin_require('see');
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'slug', s.slug,
             'name', s.config->>'businessName',
             'deleted_at', s.admin_status_at,
             'ready_at', coalesce(s.admin_status_at, now()) + interval '30 days',
             'purged_at', s.config->>'purgedAt') order by s.admin_status_at desc nulls last)
      from public.stores s
     where s.admin_status = 'deleted'), '[]'::jsonb);
end;
$fn$;

create or replace function public.admin_purge_store(p_slug text, p_confirm text, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_s      record;
  v_t      text;
  v_col    text;
  v_n      bigint;
  v_busy   boolean := false;
  v_counts jsonb := '{}'::jsonb;
  -- Connected accounts and marketing data. Orders, reviews, parcels, Coins and
  -- plan payments are deliberately NOT here: they are kept.
  c_tables constant text[] := array[
    'store_payment_accounts', 'store_shipping_accounts', 'store_meta_accounts', 'store_whatsapp',
    'meta_capi_config', 'meta_capi_events', 'cart_reminders', 'offer_sends', 'message_templates',
    'review_ask_skips', 'store_views', 'marketplace_listing', 'store_message_settings',
    'store_expenses', 'store_sales_goals', 'ads_testers', 'pin_attempts'];
begin
  perform public.admin_require('delete');
  if length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'write a reason' using errcode = '22023';
  end if;
  if p_confirm is distinct from p_slug then
    raise exception 'type the shop link to confirm' using errcode = '22023';
  end if;
  select s.slug, s.config, s.admin_status, s.admin_status_at into v_s
    from public.stores s where s.slug = p_slug for update;
  if not found then
    raise exception 'store not found' using errcode = 'P0002';
  end if;
  if v_s.admin_status is distinct from 'deleted' then
    raise exception 'delete the shop first; it can be removed for good 30 days later' using errcode = 'P0001';
  end if;
  if v_s.config ? 'purgedAt' then
    return jsonb_build_object('already', true, 'purged_at', v_s.config->>'purgedAt');
  end if;
  if coalesce(v_s.admin_status_at, now()) > now() - interval '30 days' then
    raise exception 'a deleted shop is kept for 30 days: this one can be removed for good from %',
      to_char((coalesce(v_s.admin_status_at, now()) + interval '30 days') at time zone 'Asia/Kolkata', 'DD Mon YYYY')
      using errcode = 'P0001';
  end if;
  if to_regclass('public.store_domains') is not null then
    execute 'select exists (select 1 from public.store_domains d where d.store_slug = $1 and d.status not in (''disconnected'', ''expired''))'
      into v_busy using p_slug;
    if v_busy then
      raise exception 'this shop still has its own web address: disconnect it first' using errcode = 'P0001';
    end if;
  end if;

  foreach v_t in array c_tables loop
    v_col := null;
    if to_regclass('public.' || v_t) is null then
      continue;
    end if;
    select a.attname into v_col
      from pg_attribute a
     where a.attrelid = ('public.' || v_t)::regclass
       and a.attname in ('store_slug', 'slug')
       and a.attnum > 0 and not a.attisdropped
     order by (a.attname = 'store_slug') desc
     limit 1;
    if v_col is null then
      continue;
    end if;
    execute format('delete from public.%I where %I = $1', v_t, v_col) using p_slug;
    get diagnostics v_n = row_count;
    if v_n > 0 then
      v_counts := v_counts || jsonb_build_object(v_t, v_n);
    end if;
  end loop;

  -- The row stays (billing records point at it, and the link stays taken),
  -- with nothing of the shop in it. The PIN becomes a hash nobody knows.
  update public.stores
     set config = jsonb_build_object('slug', p_slug, 'businessName', 'Removed shop', 'plan', 'free', 'purgedAt', now()),
         pin = encode(sha256(convert_to(gen_random_uuid()::text || clock_timestamp()::text, 'UTF8')), 'hex')
   where slug = p_slug;

  perform public.admin_log('purged', 'store', p_slug,
                           jsonb_build_object('name', v_s.config->>'businessName',
                                              'products', coalesce(jsonb_array_length(case when jsonb_typeof(v_s.config->'products') = 'array' then v_s.config->'products' end), 0)),
                           jsonb_build_object('removed', v_counts), p_reason);
  return jsonb_build_object('already', false, 'removed', v_counts);
end;
$fn$;

-- A shop removed for good cannot be opened again (part 2 version + that rule).
create or replace function public.admin_set_status(p_slug text, p_status text, p_reason text, p_confirm text default null)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_s record;
  v_new text := nullif(p_status, 'open');
begin
  if p_status not in ('open', 'paused', 'deleted') then
    raise exception 'bad status' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'write a reason' using errcode = '22023';
  end if;
  select s.config, s.admin_status into v_s from public.stores s where s.slug = p_slug for update;
  if not found then
    raise exception 'store not found' using errcode = 'P0002';
  end if;
  if p_status = 'deleted' or v_s.admin_status = 'deleted' then
    perform public.admin_require('delete');
  else
    perform public.admin_require('pause');
  end if;
  if v_s.config ? 'purgedAt' and p_status <> 'deleted' then
    raise exception 'this shop was removed for good and cannot be opened again' using errcode = 'P0001';
  end if;
  if p_status = 'deleted' then
    if p_confirm is distinct from p_slug then
      raise exception 'type the shop link to confirm' using errcode = '22023';
    end if;
    -- auto-pay on = razorpaySubscriptionId set and not stopped here (admin_autopay_on)
    if public.admin_autopay_on(v_s.config)
       and coalesce(v_s.config->>'planExpiresAt', '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
       and (v_s.config->>'planExpiresAt')::timestamptz > now() then
      raise exception 'this shop still pays by auto-pay: stop the Razorpay subscription first' using errcode = 'P0001';
    end if;
  end if;
  if v_s.admin_status is not distinct from v_new then
    return coalesce(v_new, 'open');
  end if;
  update public.stores set admin_status = v_new, admin_status_at = now() where slug = p_slug;
  perform public.admin_log(coalesce(v_new, 'open'), 'store', p_slug,
                           jsonb_build_object('status', coalesce(v_s.admin_status, 'open')),
                           jsonb_build_object('status', coalesce(v_new, 'open')), p_reason);
  return coalesce(v_new, 'open');
end;
$fn$;

-- The edge functions' log writer: part 2's actions plus 'purge_photos'.
create or replace function public.admin_note(p_need text, p_action text, p_kind text, p_target text, p_after jsonb, p_reason text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  perform public.admin_require(p_need);
  if p_action not in ('refund', 'password', 'reset_2step', 'person_added', 'purge_photos') then
    raise exception 'unknown action' using errcode = '22023';
  end if;
  if p_action = 'purge_photos' and p_need is distinct from 'delete' then
    raise exception 'unknown action' using errcode = '22023';
  end if;
  perform public.admin_log(p_action, p_kind, p_target, null, p_after, p_reason);
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 4. Access: Supabase gives anon and authenticated EXECUTE on every new
--    function by default, so each one is closed and opened again on purpose.
-- ---------------------------------------------------------------------------
revoke all on function public.platform_flags() from public, anon, authenticated;
revoke all on function public.admin_switches() from public, anon;
revoke all on function public.admin_switch_set(text, boolean, text, text) from public, anon;
revoke all on function public.stores_signup_gate() from public, anon, authenticated;
revoke all on function public.admin_jobs() from public, anon;
revoke all on function public.admin_job_run(bigint, text) from public, anon;
revoke all on function public.admin_job_pause(bigint, boolean, text) from public, anon;
revoke all on function public.admin_purge_list() from public, anon;
revoke all on function public.admin_purge_store(text, text, text) from public, anon;
revoke all on function public.admin_set_status(text, text, text, text) from public, anon;
revoke all on function public.admin_note(text, text, text, text, jsonb, text) from public, anon;
grant execute on function public.platform_flags() to anon, authenticated;
grant execute on function public.admin_switches() to authenticated;
grant execute on function public.admin_switch_set(text, boolean, text, text) to authenticated;
grant execute on function public.admin_jobs() to authenticated;
grant execute on function public.admin_job_run(bigint, text) to authenticated;
grant execute on function public.admin_job_pause(bigint, boolean, text) to authenticated;
grant execute on function public.admin_purge_list() to authenticated;
grant execute on function public.admin_purge_store(text, text, text) to authenticated;
grant execute on function public.admin_set_status(text, text, text, text) to authenticated;
grant execute on function public.admin_note(text, text, text, text, jsonb, text) to authenticated;

commit;
