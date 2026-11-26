-- ===========================================================================
--  PocketLink Admin part 2  --  ROLLBACK (emergency only)
--
--  Drops part 2's functions and puts back the part 1 versions of the four it
--  replaced (store state, the stores list, billing, pause / delete). Data is
--  not touched: Coins given, PINs reset, people added and review decisions
--  stay as they are; the audit log keeps every entry. Generated from
--  admin-part1-forward.sql.
-- ===========================================================================
begin;

drop function if exists public.admin_reset_pin(text, text, text);
drop function if exists public.admin_store_coins(text);
drop function if exists public.admin_coins_summary();
drop function if exists public.admin_coins(text, integer, text);
drop function if exists public.admin_review_decide(bigint, text, text);
drop function if exists public.admin_review_reports();
drop function if exists public.admin_orders_summary();
drop function if exists public.admin_orders(integer, text, text);
drop function if exists public.admin_hub_remove(uuid, text);
drop function if exists public.admin_team_remove(uuid, text);
drop function if exists public.admin_team_save(uuid, text, text, boolean, text);
drop function if exists public.admin_people();
drop function if exists public.admin_may_manage(uuid);
drop function if exists public.admin_note(text, text, text, text, jsonb, text);
drop function if exists public.admin_autopay_stopped(text, text, boolean, text);

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

drop function if exists public.admin_autopay_on(jsonb);

revoke all on function public.admin_store_state(jsonb, text, timestamptz) from public, anon, authenticated;
revoke all on function public.admin_stores() from public, anon;
revoke all on function public.admin_billing() from public, anon;
revoke all on function public.admin_set_status(text, text, text, text) from public, anon;
grant execute on function public.admin_stores() to authenticated;
grant execute on function public.admin_billing() to authenticated;
grant execute on function public.admin_set_status(text, text, text, text) to authenticated;

commit;
