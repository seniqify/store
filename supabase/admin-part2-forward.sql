-- ===========================================================================
--  PocketLink Admin  --  PART 2
--
--  Adds, on top of part 1 (run admin-part1-forward.sql first):
--    * People and access: the admin team (add, change role, switch off,
--      remove) with rules -- nobody changes their own role or switches
--      themselves off, an Admin cannot touch Owners or Admins, the last
--      Owner can never go. CRM staff and old Hub logins are listed; old Hub
--      sales logins can be removed.
--    * Orders and delivery: every order across shops (read only), order
--      numbers, stuck parcel bookings, parcels coming back.
--    * Reviews: the reported-reviews queue, keep or remove (as the Console).
--    * Coins: give or take back Coins with a reason (wallet_adjust), Coins
--      sold and used.
--    * Shop PIN reset (a new PIN the admin tells the owner).
--    * Auto-pay stopped in Razorpay (by the admin-billing edge function) is
--      recorded, so the shop is no longer treated as paying by auto-pay and
--      can be deleted.
--    * admin_note(): the edge functions (admin-people, admin-billing) write
--      their actions to the audit log AS the signed-in person, after the
--      same role and 2-step checks.
--  Every change is in admin_audit. Order: this -> admin-part2-verify.sql.
--  Safe to run twice. Undo: admin-part2-ROLLBACK.sql.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Auto-pay: on when a Razorpay subscription id is set and not stopped here
-- ---------------------------------------------------------------------------
create or replace function public.admin_autopay_on(p_cfg jsonb)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $fn$
  select coalesce(p_cfg->>'razorpaySubscriptionId', '') like 'sub\_%'
     and coalesce(p_cfg->'autopayStopped'->>'sub', '') is distinct from (p_cfg->>'razorpaySubscriptionId')
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
      case when public.admin_autopay_on(p_cfg) then 'renewal_missing' else 'ended' end
    when (p_cfg->>'planExpiresAt')::timestamptz <= p_now + interval '14 days' then 'ending'
    else 'active'
  end
$fn$;

-- The list of stores (as part 1, auto-pay from admin_autopay_on).
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
         public.admin_autopay_on(s.config),
         case when public.admin_autopay_on(s.config) then 'razorpay'
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
            'autopay', public.admin_autopay_on(config), 'autopay_stopped', config->'autopayStopped',
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
      'changes', coalesce((select jsonb_agg(jsonb_build_object('at', a.at, 'who', a.actor_name, 'action', a.action, 'target', a.target, 'after', a.after, 'reason', a.reason) order by a.at desc)
                             from (select * from public.admin_audit x where x.action in ('plan', 'autopay_stopped', 'refund') order by x.at desc limit 100) a), '[]'::jsonb),
      'cash_notes', coalesce((select jsonb_agg(jsonb_build_object('slug', slug, 'name', name, 'note', config->'billingNote') order by config->'billingNote'->>'startedAt' desc)
                                from st where jsonb_typeof(config->'billingNote') = 'object'), '[]'::jsonb)
    )
  );
end;
$fn$;

-- Delete (as part 1): still refused while auto-pay is on, now meaning "not
-- stopped here" -- stop it in Admin (Razorpay) first.
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

-- The edge function stopped auto-pay in Razorpay: record it on the store.
create or replace function public.admin_autopay_stopped(p_slug text, p_sub text, p_at_end boolean, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_cfg jsonb;
begin
  perform public.admin_require('plan');
  select s.config into v_cfg from public.stores s where s.slug = p_slug for update;
  if not found then
    raise exception 'store not found' using errcode = 'P0002';
  end if;
  if coalesce(v_cfg->>'razorpaySubscriptionId', '') <> coalesce(p_sub, '-') then
    raise exception 'this is not the shop''s subscription' using errcode = '22023';
  end if;
  update public.stores
     set config = config || jsonb_build_object('autopayStopped', jsonb_build_object(
           'sub', p_sub, 'at', now(), 'at_cycle_end', coalesce(p_at_end, true), 'by', auth.uid())),
         updated_at = now()
   where slug = p_slug returning config into v_cfg;
  perform public.admin_log('autopay_stopped', 'store', p_slug, null,
                           jsonb_build_object('sub', p_sub, 'at_cycle_end', coalesce(p_at_end, true)), p_reason);
  return v_cfg;
end;
$fn$;

-- An edge function writes its action to the log as the signed-in person.
create or replace function public.admin_note(p_need text, p_action text, p_kind text, p_target text, p_after jsonb, p_reason text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  perform public.admin_require(p_need);
  if p_action not in ('refund', 'password', 'reset_2step', 'person_added') then
    raise exception 'unknown action' using errcode = '22023';
  end if;
  perform public.admin_log(p_action, p_kind, p_target, null, p_after, p_reason);
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 2. People and access
-- ---------------------------------------------------------------------------
-- May the caller manage this person? (role rules, not the people right itself)
create or replace function public.admin_may_manage(p_user uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_me  text := public.admin_role();
  v_tgt text;
begin
  if not public.admin_can('people') or p_user is null or p_user = auth.uid() then
    return false;
  end if;
  select t.role into v_tgt from public.admin_team t where t.user_id = p_user;
  return v_me = 'owner' or v_tgt is null or v_tgt not in ('owner', 'admin');
end;
$fn$;

create or replace function public.admin_people()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
begin
  perform public.admin_require('see');
  return jsonb_build_object(
    'team', coalesce((select jsonb_agg(jsonb_build_object(
        'user_id', t.user_id, 'name', t.name, 'email', u.email, 'role', t.role, 'active', t.active, 'created_at', t.created_at,
        'last_sign_in_at', u.last_sign_in_at,
        'two_step', exists (select 1 from auth.mfa_factors f where f.user_id = t.user_id and f.status = 'verified'),
        'may_manage', public.admin_may_manage(t.user_id)) order by t.active desc, t.role, t.name)
      from public.admin_team t left join auth.users u on u.id = t.user_id), '[]'::jsonb),
    'sales', coalesce((select jsonb_agg(jsonb_build_object('name', s.name, 'role', s.role, 'active', s.active, 'email', u.email,
                                                           'last_sign_in_at', u.last_sign_in_at) order by s.active desc, s.name)
      from public.sales_staff s left join auth.users u on u.id = s.user_id), '[]'::jsonb),
    'hub', coalesce((select jsonb_agg(jsonb_build_object('user_id', c.user_id, 'name', c.name, 'role', c.role, 'email', u.email,
                                                         'last_sign_in_at', u.last_sign_in_at) order by c.role, c.name)
      from public.crm_team c left join auth.users u on u.id = c.user_id), '[]'::jsonb),
    'me', auth.uid()
  );
end;
$fn$;

-- Add or change a person on the admin team.
create or replace function public.admin_team_save(p_user uuid, p_name text, p_role text, p_active boolean, p_reason text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_me     text;
  v_old    record;
  v_email  text;
  v_owners integer;
begin
  perform public.admin_require('people');
  v_me := public.admin_role();
  if p_role not in ('owner', 'admin', 'support', 'finance', 'viewer') then
    raise exception 'bad role' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_name, ''))) not between 1 and 80 then
    raise exception 'write their name' using errcode = '22023';
  end if;
  if p_user = auth.uid() then
    raise exception 'you cannot change your own role or switch yourself off' using errcode = '42501';
  end if;
  if v_me <> 'owner' and p_role in ('owner', 'admin') then
    raise exception 'only the Owner can make someone an Owner or Admin' using errcode = '42501';
  end if;
  select u.email into v_email from auth.users u where u.id = p_user;
  if not found then
    raise exception 'no login with that id' using errcode = 'P0002';
  end if;
  select t.role, t.active, t.name into v_old from public.admin_team t where t.user_id = p_user for update;
  if found and v_me <> 'owner' and v_old.role in ('owner', 'admin') then
    raise exception 'only the Owner can change an Owner or Admin' using errcode = '42501';
  end if;
  if found and v_old.role = 'owner' and (p_role <> 'owner' or not coalesce(p_active, true)) then
    select count(*) into v_owners from public.admin_team where role = 'owner' and active and user_id <> p_user;
    if v_owners = 0 then
      raise exception 'there must always be one active Owner' using errcode = '42501';
    end if;
  end if;
  insert into public.admin_team (user_id, name, email, role, active, created_by)
  values (p_user, btrim(p_name), v_email, p_role, coalesce(p_active, true), auth.uid())
  on conflict (user_id) do update set name = excluded.name, email = excluded.email, role = excluded.role, active = excluded.active;
  perform public.admin_log(case when v_old is null then 'person_added' else 'person_changed' end, 'person', coalesce(v_email, p_user::text),
                           case when v_old is null then null else jsonb_build_object('name', v_old.name, 'role', v_old.role, 'active', v_old.active) end,
                           jsonb_build_object('name', btrim(p_name), 'role', p_role, 'active', coalesce(p_active, true)), p_reason);
end;
$fn$;

create or replace function public.admin_team_remove(p_user uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_old    record;
  v_owners integer;
begin
  perform public.admin_require('people');
  if length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'write a reason' using errcode = '22023';
  end if;
  if not public.admin_may_manage(p_user) then
    raise exception 'you cannot remove this person' using errcode = '42501';
  end if;
  select t.role, t.name, t.email into v_old from public.admin_team t where t.user_id = p_user for update;
  if not found then
    raise exception 'not on the admin team' using errcode = 'P0002';
  end if;
  if v_old.role = 'owner' then
    select count(*) into v_owners from public.admin_team where role = 'owner' and active and user_id <> p_user;
    if v_owners = 0 then
      raise exception 'there must always be one active Owner' using errcode = '42501';
    end if;
  end if;
  delete from public.admin_team where user_id = p_user;
  perform public.admin_log('person_removed', 'person', coalesce(v_old.email, p_user::text),
                           jsonb_build_object('name', v_old.name, 'role', v_old.role), null, p_reason);
end;
$fn$;

-- Old Sales Hub: remove a sales login (never the Hub admin).
create or replace function public.admin_hub_remove(p_user uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_old record;
begin
  perform public.admin_require('people');
  if length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'write a reason' using errcode = '22023';
  end if;
  select c.name, c.role into v_old from public.crm_team c where c.user_id = p_user for update;
  if not found then
    raise exception 'not an old Hub login' using errcode = 'P0002';
  end if;
  if v_old.role = 'admin' then
    raise exception 'the Hub admin login is not removed here' using errcode = '42501';
  end if;
  delete from public.crm_team where user_id = p_user;
  perform public.admin_log('hub_removed', 'person', v_old.name, jsonb_build_object('name', v_old.name, 'role', v_old.role), null, p_reason);
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 3. Orders and delivery (read only)
-- ---------------------------------------------------------------------------
create or replace function public.admin_orders(p_days integer, p_status text, p_slug text)
returns table (
  id uuid, created_at timestamptz, store_slug text, store_name text, total numeric, status text, paid boolean,
  payment_method text, customer text, item_count integer, courier text, awb text, ship_end text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
#variable_conflict use_column
begin
  perform public.admin_require('see');
  return query
  select o.id, o.created_at, o.store_slug, coalesce(nullif(s.config->>'businessName', ''), o.store_slug),
         o.total, o.status, o.paid, o.payment_method,
         nullif(btrim(split_part(coalesce(o.customer_name, ''), ' ', 1) || ' ' || left(split_part(coalesce(o.customer_name, ''), ' ', 2), 1)), ''),
         o.item_count::integer, a.courier, a.awb, coalesce(a.end_reason, a.final_status)
    from public.orders o
    left join public.stores s on s.slug = o.store_slug
    left join lateral (select x.courier, x.awb, x.end_reason, x.final_status from public.shipment_attempts x
                        where x.order_id = o.id order by x.attempt_no desc limit 1) a on true
   where o.created_at >= now() - make_interval(days => least(greatest(coalesce(p_days, 7), 1), 92))
     and coalesce(o.status, '') <> 'abandoned'
     and (p_status is null or o.status = p_status)
     and (p_slug is null or o.store_slug = p_slug)
   order by o.created_at desc
   limit 300;
end;
$fn$;

create or replace function public.admin_orders_summary()
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
    with o as (
      select * from public.orders x where x.created_at >= v_now - interval '30 days' and coalesce(x.status, '') <> 'abandoned'
    ), sh as (
      select * from public.shipment_attempts y where y.claimed_at >= v_now - interval '30 days' or y.booked_at >= v_now - interval '30 days'
    )
    select jsonb_build_object(
      'today', (select jsonb_build_object('n', count(*), 'amt', coalesce(round(sum(coalesce(total, 0))), 0), 'shops', count(distinct store_slug)) from o where created_at >= v_today),
      'week', (select jsonb_build_object('n', count(*), 'amt', coalesce(round(sum(coalesce(total, 0))), 0)) from o where created_at >= v_now - interval '7 days'),
      'month', (select jsonb_build_object('n', count(*), 'amt', coalesce(round(sum(coalesce(total, 0))), 0)) from o),
      'by_status', coalesce((select jsonb_agg(jsonb_build_object('status', st, 'n', n) order by n desc) from (select coalesce(status, 'none') st, count(*) n from o group by 1) z), '[]'::jsonb),
      'by_method', coalesce((select jsonb_agg(jsonb_build_object('method', m, 'n', n, 'paid', p) order by n desc) from (select coalesce(payment_method, 'none') m, count(*) n, count(*) filter (where paid is true) p from o group by 1) z), '[]'::jsonb),
      'parcels', (select jsonb_build_object('delivered', count(*) filter (where end_reason = 'delivered'), 'returned', count(*) filter (where end_reason = 'returned'),
                                            'moving', count(*) filter (where end_reason is null and booked_at is not null)) from sh),
      'stuck', coalesce((select jsonb_agg(jsonb_build_object('store_slug', y.store_slug, 'order_id', y.order_id, 'courier', y.courier, 'claimed_at', y.claimed_at) order by y.claimed_at)
                           from public.shipment_attempts y
                          where y.end_reason is null and y.booked_at is null and y.claimed_at < v_now - interval '10 minutes'
                            and y.claimed_at > v_now - interval '30 days'), '[]'::jsonb)
    )
  );
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 4. Reported reviews (same decision as the Console, with the admin checks)
-- ---------------------------------------------------------------------------
create or replace function public.admin_review_reports()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
begin
  perform public.admin_require('see');
  return coalesce((select jsonb_agg(jsonb_build_object(
      'report_id', rr.id, 'reported_at', rr.created_at, 'reason', rr.reason, 'store_slug', rr.store_slug,
      'store_name', coalesce(nullif(s.config->>'businessName', ''), rr.store_slug), 'rating', r.rating, 'body', r.body,
      'name', r.display_name, 'item', r.item_name, 'reply', r.merchant_reply, 'verified', r.verified_purchase) order by rr.created_at)
    from public.review_reports rr
    join public.product_reviews r on r.id = rr.review_id
    left join public.stores s on s.slug = rr.store_slug
   where rr.resolved_at is null), '[]'::jsonb);
end;
$fn$;

create or replace function public.admin_review_decide(p_report bigint, p_decision text, p_note text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_rep  record;
  v_note text := left(nullif(btrim(coalesce(p_note, '')), ''), 300);
begin
  perform public.admin_require('edit_store');
  if p_decision not in ('kept', 'removed') then
    raise exception 'decision must be kept or removed' using errcode = '22023';
  end if;
  if p_decision = 'removed' and v_note is null then
    raise exception 'give the reason for removing a review' using errcode = '22023';
  end if;
  select rr.id, rr.review_id, rr.store_slug, rr.resolved_at into v_rep from public.review_reports rr where rr.id = p_report for update;
  if not found or v_rep.resolved_at is not null then
    raise exception 'report not found or already decided' using errcode = 'P0002';
  end if;
  update public.review_reports
     set resolved_at = now(), decision = p_decision, admin_note = v_note, resolved_by = auth.uid()
   where id = p_report;
  if p_decision = 'removed' then
    update public.product_reviews
       set status = 'removed', removed_reason = v_note, removed_at = now()
     where id = v_rep.review_id and status = 'published';
  end if;
  insert into public.review_audit (review_id, store_slug, action, actor, reason, after)
  values (v_rep.review_id, v_rep.store_slug, p_decision, 'admin', v_note, jsonb_build_object('report_id', p_report, 'by', auth.uid()));
  perform public.admin_log('review_' || p_decision, 'store', v_rep.store_slug, null, jsonb_build_object('report_id', p_report), v_note);
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 5. Coins
-- ---------------------------------------------------------------------------
create or replace function public.admin_coins(p_slug text, p_coins integer, p_reason text)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_res jsonb;
  v_before bigint;
begin
  perform public.admin_require('plan');
  if p_coins is null or p_coins = 0 or abs(p_coins) > 100000 then
    raise exception 'give between 1 and 100,000 Coins (minus to take back)' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'write a reason' using errcode = '22023';
  end if;
  select w.balance_paise into v_before from public.store_wallets w where w.store_slug = p_slug;
  if p_coins < 0 and coalesce(v_before, 0) + p_coins * 50 < 0 then
    raise exception 'the shop has only % Coins', coalesce(v_before, 0) / 50 using errcode = '22023';
  end if;
  v_res := public.wallet_adjust(p_slug, p_coins * 50, left('Admin: ' || btrim(p_reason), 300));
  perform public.admin_log('coins', 'store', p_slug, jsonb_build_object('coins', coalesce(v_before, 0) / 50),
                           jsonb_build_object('coins', (v_res->>'balance_paise')::bigint / 50, 'change', p_coins), p_reason);
  return ((v_res->>'balance_paise')::bigint / 50)::integer;
end;
$fn$;

create or replace function public.admin_coins_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_month timestamptz := date_trunc('month', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata';
begin
  perform public.admin_require('money');
  return jsonb_build_object(
    'sold_month', (select jsonb_build_object('paise', coalesce(sum(t.amount_paise), 0), 'n', count(*))
                     from public.wallet_topups t where t.status = 'paid' and coalesce(t.paid_at, t.created_at) >= v_month),
    'used_month', (select jsonb_build_object('messages', count(*), 'paise', coalesce(-sum(l.amount_paise), 0))
                     from public.wallet_ledger l where l.kind = 'debit' and l.created_at >= v_month),
    'total_balance', (select coalesce(sum(w.balance_paise), 0) from public.store_wallets w),
    'shops', coalesce((select jsonb_agg(jsonb_build_object('slug', w.store_slug, 'name', coalesce(nullif(s.config->>'businessName', ''), w.store_slug),
                                                           'coins', w.balance_paise / 50, 'updated_at', w.updated_at) order by w.balance_paise desc)
                         from public.store_wallets w left join public.stores s on s.slug = w.store_slug), '[]'::jsonb),
    'adjustments', coalesce((select jsonb_agg(jsonb_build_object('slug', l.store_slug, 'coins', l.amount_paise / 50, 'after', l.balance_after_paise / 50,
                                                                 'note', l.note, 'at', l.created_at) order by l.id desc)
                               from (select * from public.wallet_ledger x where x.kind = 'adjust' order by x.id desc limit 30) l), '[]'::jsonb)
  );
end;
$fn$;

create or replace function public.admin_store_coins(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
begin
  perform public.admin_require('money');
  return coalesce((select jsonb_agg(jsonb_build_object('kind', l.kind, 'coins', l.amount_paise / 50.0, 'after', l.balance_after_paise / 50,
                                                       'note', l.note, 'at', l.created_at) order by l.id desc)
                     from (select * from public.wallet_ledger x where x.store_slug = p_slug order by x.id desc limit 40) l), '[]'::jsonb);
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 6. A new shop PIN (hashed in the browser exactly like the owner's own)
-- ---------------------------------------------------------------------------
create or replace function public.admin_reset_pin(p_slug text, p_new_hashed_pin text, p_reason text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  perform public.admin_require('edit_store');
  if coalesce(p_new_hashed_pin, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'bad PIN' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'write a reason' using errcode = '22023';
  end if;
  update public.stores set pin = p_new_hashed_pin where slug = p_slug;
  if not found then
    raise exception 'store not found' using errcode = 'P0002';
  end if;
  -- Recent wrong PINs no longer lock the owner out.
  delete from public.pin_attempts where slug = p_slug and not success and attempted_at > now() - interval '1 day';
  perform public.admin_log('pin_reset', 'store', p_slug, null, null, p_reason);
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 7. Who may call what
-- ---------------------------------------------------------------------------
revoke all on function public.admin_autopay_on(jsonb) from public, anon, authenticated;
revoke all on function public.admin_store_state(jsonb, text, timestamptz) from public, anon, authenticated;
revoke all on function public.admin_stores() from public, anon;
revoke all on function public.admin_billing() from public, anon;
revoke all on function public.admin_set_status(text, text, text, text) from public, anon;
revoke all on function public.admin_autopay_stopped(text, text, boolean, text) from public, anon;
revoke all on function public.admin_note(text, text, text, text, jsonb, text) from public, anon;
revoke all on function public.admin_may_manage(uuid) from public, anon;
revoke all on function public.admin_people() from public, anon;
revoke all on function public.admin_team_save(uuid, text, text, boolean, text) from public, anon;
revoke all on function public.admin_team_remove(uuid, text) from public, anon;
revoke all on function public.admin_hub_remove(uuid, text) from public, anon;
revoke all on function public.admin_orders(integer, text, text) from public, anon;
revoke all on function public.admin_orders_summary() from public, anon;
revoke all on function public.admin_review_reports() from public, anon;
revoke all on function public.admin_review_decide(bigint, text, text) from public, anon;
revoke all on function public.admin_coins(text, integer, text) from public, anon;
revoke all on function public.admin_coins_summary() from public, anon;
revoke all on function public.admin_store_coins(text) from public, anon;
revoke all on function public.admin_reset_pin(text, text, text) from public, anon;
grant execute on function public.admin_stores() to authenticated;
grant execute on function public.admin_billing() to authenticated;
grant execute on function public.admin_set_status(text, text, text, text) to authenticated;
grant execute on function public.admin_autopay_stopped(text, text, boolean, text) to authenticated;
grant execute on function public.admin_note(text, text, text, text, jsonb, text) to authenticated;
grant execute on function public.admin_may_manage(uuid) to authenticated;
grant execute on function public.admin_people() to authenticated;
grant execute on function public.admin_team_save(uuid, text, text, boolean, text) to authenticated;
grant execute on function public.admin_team_remove(uuid, text) to authenticated;
grant execute on function public.admin_hub_remove(uuid, text) to authenticated;
grant execute on function public.admin_orders(integer, text, text) to authenticated;
grant execute on function public.admin_orders_summary() to authenticated;
grant execute on function public.admin_review_reports() to authenticated;
grant execute on function public.admin_review_decide(bigint, text, text) to authenticated;
grant execute on function public.admin_coins(text, integer, text) to authenticated;
grant execute on function public.admin_coins_summary() to authenticated;
grant execute on function public.admin_store_coins(text) to authenticated;
grant execute on function public.admin_reset_pin(text, text, text) to authenticated;

commit;
