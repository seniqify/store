-- ===========================================================================
--  PocketLink Admin (admin.pocketlink.store)  --  PART 1
--
--  The founder's full control center, replacing the /console cockpit step by
--  step. Part 1: the admin team and roles, a 2-step sign-in check on every
--  call, an audit log nobody can change, and stores and billing:
--    * read every store (all of its settings), its numbers and its plan history
--    * change a store's details, its plan (with cash / free / Razorpay), pause
--      it, delete it (hidden and closed, restorable) and restore it
--    * billing lists: renewals that did not come through, plans ending soon,
--      paid sign-ups with no shop, every paying shop, every plan change made here
--
--  Safety:
--    * every function checks the caller's ROLE (admin_team) AND that the
--      session passed 2-step sign-in (JWT aal2) -- on the server, every call
--    * every change is written to admin_audit with before / after, who, from
--      where; admin_audit refuses UPDATE, DELETE and TRUNCATE for everyone
--    * a store's pause / delete state lives in its own column (stores.admin_status),
--      outside config, so the owner's own settings save can never undo it
--
--  Order: this -> admin-part1-verify.sql (every row PASS). Safe to run twice.
--  Undo: admin-part1-ROLLBACK.sql.
--
--  READ BEFORE CHANGING GRANTS: default privileges in schema public give anon
--  and authenticated EVERY privilege on new tables and EXECUTE on new
--  functions. Each revoke below runs in the same transaction as the create.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Who is on the admin team, and the checks
-- ---------------------------------------------------------------------------
create table if not exists public.admin_team (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  name       text not null check (length(btrim(name)) between 1 and 80),
  email      text check (email is null or length(email) <= 160),
  role       text not null check (role in ('owner', 'admin', 'support', 'finance', 'viewer')),
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid
);
alter table public.admin_team enable row level security;
revoke all on public.admin_team from public, anon, authenticated;

-- The founder (crm_team admin today) becomes the Owner.
insert into public.admin_team (user_id, name, email, role)
select t.user_id, coalesce(nullif(btrim(t.name), ''), 'Owner'), u.email, 'owner'
  from public.crm_team t join auth.users u on u.id = t.user_id
 where t.role = 'admin'
on conflict (user_id) do nothing;

create or replace function public.admin_role()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select t.role from public.admin_team t where t.user_id = auth.uid() and t.active
$fn$;

-- Passed 2-step sign-in in this session (Supabase sets aal2 in the JWT).
create or replace function public.admin_mfa_ok()
returns boolean
language sql
stable
set search_path = public, pg_temp
as $fn$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'aal', '') = 'aal2'
$fn$;

-- What a role may do. Unknown actions: no.
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
    when 'see'         then true
    when 'see_private' then v_role in ('owner', 'admin', 'support', 'finance')
    when 'edit_store'  then v_role in ('owner', 'admin', 'support')
    when 'plan'        then v_role in ('owner', 'admin', 'finance')
    when 'pause'       then v_role in ('owner', 'admin')
    when 'delete'      then v_role = 'owner'
    when 'money'       then v_role in ('owner', 'admin', 'finance', 'viewer')
    when 'people'      then v_role in ('owner', 'admin')
    when 'system'      then v_role = 'owner'
    else false
  end;
end;
$fn$;

create or replace function public.admin_require(p_what text)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
begin
  if public.admin_role() is null then
    raise exception 'not on the admin team' using errcode = '42501';
  end if;
  if not public.admin_mfa_ok() then
    raise exception '2-step sign-in needed' using errcode = '42501';
  end if;
  if not public.admin_can(p_what) then
    raise exception 'your role cannot do this' using errcode = '42501';
  end if;
end;
$fn$;

drop policy if exists admin_team_read on public.admin_team;
create policy admin_team_read on public.admin_team
  for select to authenticated using (public.admin_can('see'));
grant select on public.admin_team to authenticated;

-- Who am I (works before 2-step, so the sign-in screen knows what to ask).
create or replace function public.admin_me()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select case when t.user_id is null then null else jsonb_build_object(
    'user_id', t.user_id, 'name', t.name, 'role', t.role, 'mfa', public.admin_mfa_ok()) end
    from (select 1) one
    left join public.admin_team t on t.user_id = auth.uid() and t.active
$fn$;

-- ---------------------------------------------------------------------------
-- 2. The audit log: append-only for everyone
-- ---------------------------------------------------------------------------
create table if not exists public.admin_audit (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  actor       uuid,
  actor_name  text,
  actor_role  text,
  action      text not null check (length(action) <= 60),
  target_kind text check (target_kind is null or length(target_kind) <= 30),
  target      text check (target is null or length(target) <= 120),
  before      jsonb check (before is null or length(before::text) <= 20000),
  after       jsonb check (after is null or length(after::text) <= 20000),
  reason      text check (reason is null or length(reason) <= 300),
  ip          text check (ip is null or length(ip) <= 100),
  agent       text check (agent is null or length(agent) <= 200)
);
create index if not exists admin_audit_at_idx on public.admin_audit (at desc);
create index if not exists admin_audit_target_idx on public.admin_audit (target_kind, target, at desc);
alter table public.admin_audit enable row level security;
revoke all on public.admin_audit from public, anon, authenticated;
grant select on public.admin_audit to authenticated;
drop policy if exists admin_audit_read on public.admin_audit;
create policy admin_audit_read on public.admin_audit
  for select to authenticated using (public.admin_can('see'));

create or replace function public.admin_audit_frozen()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $fn$
begin
  raise exception 'the audit log cannot be changed' using errcode = '42501';
end;
$fn$;
drop trigger if exists admin_audit_no_change on public.admin_audit;
create trigger admin_audit_no_change before update or delete on public.admin_audit
  for each row execute function public.admin_audit_frozen();
drop trigger if exists admin_audit_no_truncate on public.admin_audit;
create trigger admin_audit_no_truncate before truncate on public.admin_audit
  for each statement execute function public.admin_audit_frozen();

create or replace function public.admin_log(p_action text, p_kind text, p_target text, p_before jsonb, p_after jsonb, p_reason text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_h  jsonb;
  v_me record;
begin
  begin
    v_h := nullif(current_setting('request.headers', true), '')::jsonb;
  exception when others then
    v_h := null;
  end;
  select t.name, t.role into v_me from public.admin_team t where t.user_id = auth.uid();
  insert into public.admin_audit (actor, actor_name, actor_role, action, target_kind, target, before, after, reason, ip, agent)
  values (auth.uid(), v_me.name, v_me.role, p_action, p_kind, p_target, p_before, p_after,
          left(nullif(btrim(coalesce(p_reason, '')), ''), 300),
          left(btrim(split_part(coalesce(v_h->>'x-forwarded-for', v_h->>'x-real-ip', ''), ',', 1)), 100),
          left(v_h->>'user-agent', 200));
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 3. A store's pause / delete state (outside config)
-- ---------------------------------------------------------------------------
alter table public.stores add column if not exists admin_status text;
alter table public.stores add column if not exists admin_status_at timestamptz;
do $$
begin
  alter table public.stores add constraint stores_admin_status_check check (admin_status is null or admin_status in ('paused', 'deleted'));
exception when duplicate_object then null;
end $$;
-- Shop pages need to know a shop is closed (the column holds no private data).
grant select (admin_status) on public.stores to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Reading
-- ---------------------------------------------------------------------------
-- A phone number for a role that may not see it: last 2 digits only.
create or replace function public.admin_mask_phone(p text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $fn$
  select case when p is null or p = '' then null
              when length(regexp_replace(p, '[^0-9]', '', 'g')) < 4 then repeat(chr(8226), 2)
              else repeat(chr(8226), 8) || right(regexp_replace(p, '[^0-9]', '', 'g'), 2) end
$fn$;

create or replace function public.admin_store_state(p_cfg jsonb, p_admin_status text, p_now timestamptz)
returns text
language sql
stable
set search_path = public, pg_temp
as $fn$
  select case
    when p_admin_status = 'deleted' then 'deleted'
    when p_admin_status = 'paused' then 'paused'
    when coalesce(p_cfg->>'plan', 'free') not in ('starter', 'pro', 'business', 'premium', 'premium_plus') then 'free'
    when coalesce(p_cfg->>'planExpiresAt', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' then 'active'
    when (p_cfg->>'planExpiresAt')::timestamptz <= p_now then
      case when coalesce(p_cfg->>'razorpaySubscriptionId', '') like 'sub\_%' then 'renewal_missing' else 'ended' end
    when (p_cfg->>'planExpiresAt')::timestamptz <= p_now + interval '14 days' then 'ending'
    else 'active'
  end
$fn$;

create or replace function public.admin_stores()
returns table (
  slug text, created_at timestamptz, updated_at timestamptz, name text, plan text, plan_expires_at text,
  autopay boolean, pays_by text, business_type text, city text, theme_mode text, state text,
  admin_status text, admin_status_at timestamptz, owner_phone text, whatsapp text,
  orders_30 integer, sales_30 bigint, last_order_at timestamptz, coins integer, managed_by text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
#variable_conflict use_column
declare
  v_private boolean;
  v_now     timestamptz := now();
begin
  perform public.admin_require('see');
  v_private := public.admin_can('see_private');
  return query
  with o as (
    select x.store_slug, count(*)::integer as n, coalesce(round(sum(coalesce(x.total, 0))), 0)::bigint as amt, max(x.created_at) as last_at
      from public.orders x
     where x.created_at >= v_now - interval '30 days' and coalesce(x.status, '') <> 'abandoned'
     group by x.store_slug
  ), lo as (
    select x.store_slug, max(x.created_at) as last_at from public.orders x where coalesce(x.status, '') <> 'abandoned' group by x.store_slug
  )
  select s.slug, s.created_at, s.updated_at,
         coalesce(nullif(s.config->>'businessName', ''), s.slug),
         coalesce(s.config->>'plan', 'free'),
         s.config->>'planExpiresAt',
         coalesce(s.config->>'razorpaySubscriptionId', '') like 'sub\_%',
         case when coalesce(s.config->>'razorpaySubscriptionId', '') like 'sub\_%' then 'razorpay'
              else nullif(s.config->'billingNote'->>'method', '') end,
         s.config->>'businessType', s.config->>'city', coalesce(s.config->'theme'->>'mode', 'light'),
         public.admin_store_state(s.config, s.admin_status, v_now),
         s.admin_status, s.admin_status_at,
         case when v_private then nullif(s.config->>'ownerPhone', '') else public.admin_mask_phone(s.config->>'ownerPhone') end,
         case when v_private then nullif(s.config->>'whatsappNumber', '') else public.admin_mask_phone(s.config->>'whatsappNumber') end,
         coalesce(o.n, 0), coalesce(o.amt, 0), lo.last_at,
         coalesce((select (w.balance_paise / 50)::integer from public.store_wallets w where w.store_slug = s.slug), 0),
         s.config->>'managedBy'
    from public.stores s
    left join o on o.store_slug = s.slug
    left join lo on lo.store_slug = s.slug
   order by s.created_at desc, s.slug;
end;
$fn$;

create or replace function public.admin_store(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_s       record;
  v_cfg     jsonb;
  v_private boolean;
  v_now     timestamptz := now();
begin
  perform public.admin_require('see');
  v_private := public.admin_can('see_private');
  select s.slug, s.config, s.created_at, s.updated_at, s.admin_status, s.admin_status_at into v_s
    from public.stores s where s.slug = p_slug;
  if not found then
    raise exception 'store not found' using errcode = 'P0002';
  end if;
  v_cfg := v_s.config;
  if not v_private then
    v_cfg := v_cfg || jsonb_build_object('ownerPhone', public.admin_mask_phone(v_cfg->>'ownerPhone'),
                                         'whatsappNumber', public.admin_mask_phone(v_cfg->>'whatsappNumber'));
  end if;
  return jsonb_build_object(
    'slug', v_s.slug, 'created_at', v_s.created_at, 'updated_at', v_s.updated_at,
    'admin_status', v_s.admin_status, 'admin_status_at', v_s.admin_status_at,
    'state', public.admin_store_state(v_s.config, v_s.admin_status, v_now),
    'config', v_cfg,
    'can', jsonb_build_object('edit', public.admin_can('edit_store'), 'plan', public.admin_can('plan'),
                              'pause', public.admin_can('pause'), 'delete', public.admin_can('delete'),
                              'private', v_private),
    'stats', (select jsonb_build_object(
                'orders_30', count(*) filter (where o.created_at >= v_now - interval '30 days'),
                'sales_30', coalesce(round(sum(coalesce(o.total, 0)) filter (where o.created_at >= v_now - interval '30 days')), 0),
                'online_30', count(*) filter (where o.created_at >= v_now - interval '30 days' and o.paid is true),
                'orders_all', count(*),
                'last_order_at', max(o.created_at))
                from public.orders o where o.store_slug = p_slug and coalesce(o.status, '') <> 'abandoned'),
    'coins', coalesce((select (w.balance_paise / 50)::integer from public.store_wallets w where w.store_slug = p_slug), 0),
    'plans', coalesce((select jsonb_agg(jsonb_build_object('plan', e.plan, 'source', e.source, 'status', e.status,
                                                          'starts_at', e.starts_at, 'expires_at', e.expires_at,
                                                          'verified', e.verified_at is not null, 'created_at', e.created_at)
                                        order by e.created_at desc)
                         from (select * from public.plan_entitlements pe where pe.store_slug = p_slug order by pe.created_at desc limit 50) e), '[]'::jsonb),
    'log', coalesce((select jsonb_agg(jsonb_build_object('at', a.at, 'who', a.actor_name, 'action', a.action,
                                                        'before', a.before, 'after', a.after, 'reason', a.reason) order by a.at desc)
                       from (select * from public.admin_audit x where x.target_kind = 'store' and x.target = p_slug order by x.at desc limit 50) a), '[]'::jsonb)
  );
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
      'recent', coalesce((select jsonb_agg(jsonb_build_object('at', a.at, 'who', a.actor_name, 'action', a.action, 'kind', a.target_kind, 'target', a.target, 'reason', a.reason) order by a.at desc)
                            from (select * from public.admin_audit order by at desc limit 8) a), '[]'::jsonb)
    )
  );
end;
$fn$;

create or replace function public.admin_billing()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_now     timestamptz := now();
  v_private boolean;
begin
  perform public.admin_require('money');
  v_private := public.admin_can('see_private');
  return (
    with st as (
      select s.slug, coalesce(nullif(s.config->>'businessName', ''), s.slug) as name, s.config,
             public.admin_store_state(s.config, s.admin_status, v_now) as state
        from public.stores s
    )
    select jsonb_build_object(
      'subscriptions', coalesce((select jsonb_agg(jsonb_build_object(
            'slug', slug, 'name', name, 'plan', config->>'plan', 'expires', config->>'planExpiresAt', 'state', state,
            'autopay', coalesce(config->>'razorpaySubscriptionId', '') like 'sub\_%',
            'method', nullif(config->'billingNote'->>'method', ''), 'amount', config->'billingNote'->'amount') order by config->>'planExpiresAt')
          from st where state in ('active', 'ending', 'renewal_missing', 'ended', 'paused')
                    and coalesce(config->>'plan', 'free') <> 'free'), '[]'::jsonb),
      'unclaimed', coalesce((select jsonb_agg(jsonb_build_object(
            'phone', case when v_private then p.phone else public.admin_mask_phone(p.phone) end,
            'plan', p.plan, 'expires', p.plan_expires_at, 'at', p.created_at,
            'autopay', coalesce(p.subscription_id, '') like 'sub\_%') order by p.created_at desc)
          from public.pending_signups p
         where coalesce(p.plan, 'free') <> 'free'
           and not exists (select 1 from public.stores s
                            where right(regexp_replace(coalesce(s.config->>'ownerPhone', s.config->>'whatsappNumber', ''), '[^0-9]', '', 'g'), 10)
                                  = right(regexp_replace(coalesce(p.phone, ''), '[^0-9]', '', 'g'), 10))), '[]'::jsonb),
      'changes', coalesce((select jsonb_agg(jsonb_build_object('at', a.at, 'who', a.actor_name, 'target', a.target, 'after', a.after, 'reason', a.reason) order by a.at desc)
                             from (select * from public.admin_audit x where x.action = 'plan' order by x.at desc limit 100) a), '[]'::jsonb),
      'cash_notes', coalesce((select jsonb_agg(jsonb_build_object('slug', slug, 'name', name, 'note', config->'billingNote') order by config->'billingNote'->>'startedAt' desc)
                                from st where jsonb_typeof(config->'billingNote') = 'object'), '[]'::jsonb)
    )
  );
end;
$fn$;

create or replace function public.admin_audit_list(p_kind text default null, p_before timestamptz default null)
returns setof public.admin_audit
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
begin
  perform public.admin_require('see');
  return query
  select * from public.admin_audit a
   where (p_kind is null or a.target_kind = p_kind or a.action = p_kind)
     and (p_before is null or a.at < p_before)
   order by a.at desc
   limit 200;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 5. Changing a store
-- ---------------------------------------------------------------------------
-- Shop details, only these keys, each checked.
create or replace function public.admin_store_update(p_slug text, p_patch jsonb, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_cfg    jsonb;
  v_key    text;
  v_val    jsonb;
  v_before jsonb := '{}'::jsonb;
  v_after  jsonb := '{}'::jsonb;
  v_allowed text[] := array['businessName', 'tagline', 'whatsappNumber', 'businessType', 'city', 'area', 'address', 'theme'];
begin
  perform public.admin_require('edit_store');
  if jsonb_typeof(p_patch) is distinct from 'object' or p_patch = '{}'::jsonb then
    raise exception 'nothing to change' using errcode = '22023';
  end if;
  select s.config into v_cfg from public.stores s where s.slug = p_slug for update;
  if not found then
    raise exception 'store not found' using errcode = 'P0002';
  end if;
  for v_key, v_val in select * from jsonb_each(p_patch) loop
    if not (v_key = any (v_allowed)) then
      raise exception 'this cannot be changed here: %', v_key using errcode = '22023';
    end if;
    if v_key = 'theme' then
      if jsonb_typeof(v_val) <> 'object' or length(v_val::text) > 4000
         or (v_val ? 'mode' and coalesce(v_val->>'mode', '') not in ('light', 'dark')) then
        raise exception 'bad look' using errcode = '22023';
      end if;
    elsif v_key = 'whatsappNumber' then
      if jsonb_typeof(v_val) <> 'string' or (v_val #>> '{}') !~ '^[0-9]{10,13}$' then
        raise exception 'WhatsApp number: 10 to 13 digits' using errcode = '22023';
      end if;
    elsif v_key = 'businessName' then
      if jsonb_typeof(v_val) <> 'string' or length(btrim(v_val #>> '{}')) not between 1 and 80 then
        raise exception 'shop name: 1 to 80 characters' using errcode = '22023';
      end if;
    elsif jsonb_typeof(v_val) not in ('string', 'null') or length(coalesce(v_val #>> '{}', '')) > 300 then
      raise exception 'too long: %', v_key using errcode = '22023';
    end if;
    if v_cfg->v_key is distinct from v_val then
      v_before := v_before || jsonb_build_object(v_key, v_cfg->v_key);
      v_after := v_after || jsonb_build_object(v_key, v_val);
    end if;
  end loop;
  if v_after = '{}'::jsonb then
    return v_cfg;
  end if;
  update public.stores set config = config || v_after, updated_at = now() where slug = p_slug returning config into v_cfg;
  perform public.admin_log('edit', 'store', p_slug, v_before, v_after, p_reason);
  return v_cfg;
end;
$fn$;

-- Plan: set, extend, give free days, log a cash payment, or move to free.
create or replace function public.admin_set_plan(
  p_slug text, p_plan text, p_expires_at timestamptz, p_paid_by text, p_amount integer, p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_cfg    jsonb;
  v_patch  jsonb;
  v_before jsonb;
begin
  perform public.admin_require('plan');
  if p_plan not in ('free', 'premium') then
    raise exception 'plan must be free or premium' using errcode = '22023';
  end if;
  if p_paid_by not in ('razorpay', 'cash', 'bank', 'free') then
    raise exception 'paid by must be razorpay, cash, bank or free' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'write a reason' using errcode = '22023';
  end if;
  if p_amount is not null and (p_amount < 0 or p_amount > 1000000) then
    raise exception 'bad amount' using errcode = '22023';
  end if;
  if p_plan <> 'free' and (p_expires_at is null or p_expires_at <= now() or p_expires_at > now() + interval '6 years') then
    raise exception 'pick an end date in the future (up to 6 years)' using errcode = '22023';
  end if;
  select s.config into v_cfg from public.stores s where s.slug = p_slug for update;
  if not found then
    raise exception 'store not found' using errcode = 'P0002';
  end if;
  v_before := jsonb_build_object('plan', v_cfg->'plan', 'planExpiresAt', v_cfg->'planExpiresAt');
  if p_plan = 'free' then
    v_patch := jsonb_build_object('plan', 'free', 'planExpiresAt', null);
  else
    v_patch := jsonb_build_object('plan', 'premium',
                                  'planExpiresAt', to_char(p_expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
    if coalesce(p_amount, 0) > 0 and p_paid_by in ('cash', 'bank') then
      v_patch := v_patch || jsonb_build_object('billingNote', jsonb_build_object(
        'plan', 'premium', 'planName', 'PocketLink', 'amount', p_amount, 'currency', 'INR', 'method', p_paid_by,
        'collected', true, 'startedAt', to_char(now() at time zone 'Asia/Kolkata', 'YYYY-MM-DD'),
        'expiresAt', to_char(p_expires_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD'), 'setBy', 'admin'));
    end if;
    insert into public.plan_entitlements (store_slug, plan, source, status, starts_at, expires_at, idempotency_key)
    values (p_slug, 'premium', 'console', 'active', now(), p_expires_at, 'admin:' || pg_catalog.gen_random_uuid()::text);
  end if;
  update public.stores set config = config || v_patch, updated_at = now() where slug = p_slug returning config into v_cfg;
  perform public.admin_log('plan', 'store', p_slug, v_before,
                           v_patch - 'billingNote' || jsonb_build_object('paid_by', p_paid_by, 'amount', p_amount), p_reason);
  return v_cfg;
end;
$fn$;

-- Pause, delete (hidden and closed, restorable) or open again.
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
  if p_status = 'deleted' then
    if p_confirm is distinct from p_slug then
      raise exception 'type the shop link to confirm' using errcode = '22023';
    end if;
    if coalesce(v_s.config->>'razorpaySubscriptionId', '') like 'sub\_%'
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

-- ---------------------------------------------------------------------------
-- 6. Who may call what
-- ---------------------------------------------------------------------------
revoke all on function public.admin_role() from public, anon, authenticated;
revoke all on function public.admin_mfa_ok() from public, anon, authenticated;
revoke all on function public.admin_can(text) from public, anon;
revoke all on function public.admin_require(text) from public, anon, authenticated;
revoke all on function public.admin_me() from public, anon;
revoke all on function public.admin_audit_frozen() from public, anon, authenticated;
revoke all on function public.admin_log(text, text, text, jsonb, jsonb, text) from public, anon, authenticated;
revoke all on function public.admin_mask_phone(text) from public, anon, authenticated;
revoke all on function public.admin_store_state(jsonb, text, timestamptz) from public, anon, authenticated;
revoke all on function public.admin_stores() from public, anon;
revoke all on function public.admin_store(text) from public, anon;
revoke all on function public.admin_home() from public, anon;
revoke all on function public.admin_billing() from public, anon;
revoke all on function public.admin_audit_list(text, timestamptz) from public, anon;
revoke all on function public.admin_store_update(text, jsonb, text) from public, anon;
revoke all on function public.admin_set_plan(text, text, timestamptz, text, integer, text) from public, anon;
revoke all on function public.admin_set_status(text, text, text, text) from public, anon;
grant execute on function public.admin_can(text) to authenticated;
grant execute on function public.admin_me() to authenticated;
grant execute on function public.admin_stores() to authenticated;
grant execute on function public.admin_store(text) to authenticated;
grant execute on function public.admin_home() to authenticated;
grant execute on function public.admin_billing() to authenticated;
grant execute on function public.admin_audit_list(text, timestamptz) to authenticated;
grant execute on function public.admin_store_update(text, jsonb, text) to authenticated;
grant execute on function public.admin_set_plan(text, text, timestamptz, text, integer, text) to authenticated;
grant execute on function public.admin_set_status(text, text, text, text) to authenticated;

commit;
