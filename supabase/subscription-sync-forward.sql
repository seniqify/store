-- ===========================================================================
--  Paying stores keep their plan  --  FORWARD (additive)
--
--  Problem (2026-11-11, again 2026-11-23): a paying store's planExpiresAt is
--  set at sign-up and should move forward on every Razorpay renewal through
--  razorpay-webhook. It never has, so monthly payers drop to Free on their
--  renewal date while Razorpay keeps charging them.
--
--  Fix: the subscription-sync edge function asks Razorpay once a day for every
--  store that records a razorpaySubscriptionId, and calls the function below
--  to move the date forward when Razorpay says the mandate is active.
--
--  What this file adds:
--    1. public.extend_store_plan_from_razorpay(slug, subscription id, plan,
--       expires at). service_role only. It can only EXTEND, only for the
--       subscription the store already records, and it merges two keys
--       (plan, planExpiresAt) instead of rewriting the store's settings.
--    2. The shared secret the daily job sends (public.automation_secrets).
--
--  It changes no table, no policy, no existing function. public_config is a
--  generated column, so the shop page follows on its own.
--
--  Run order: this -> subscription-sync-verify.sql (all PASS) -> deploy the
--  subscription-sync function -> dry run -> subscription-sync-schedule.sql.
--  Undo: subscription-sync-ROLLBACK.sql.
-- ===========================================================================

create or replace function public.extend_store_plan_from_razorpay(
  p_slug            text,
  p_subscription_id text,
  p_plan            text,
  p_expires_at      text
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_cfg  jsonb;
  v_new  timestamptz;
  v_prev timestamptz;
begin
  if p_slug is null or length(p_slug) = 0
     or p_subscription_id is null or p_subscription_id !~ '^sub_[A-Za-z0-9]+$'
     or p_expires_at is null then
    return 'bad_input';
  end if;

  if p_plan is null or p_plan not in ('starter', 'pro', 'business', 'premium', 'premium_plus') then
    return 'bad_plan';
  end if;

  begin
    v_new := p_expires_at::timestamptz;
  exception when others then
    return 'bad_date';
  end;

  -- A renewal is at most one yearly cycle (368 days) plus grace away.
  if v_new <= now() or v_new > now() + interval '400 days' then
    return 'date_out_of_range';
  end if;

  select config into v_cfg from public.stores where slug = p_slug for update;
  if not found then
    return 'not_found';
  end if;

  if coalesce(v_cfg->>'razorpaySubscriptionId', '') <> p_subscription_id then
    return 'subscription_mismatch';
  end if;

  begin
    v_prev := nullif(v_cfg->>'planExpiresAt', '')::timestamptz;
  exception when others then
    v_prev := null;
  end;

  if v_prev is not null and v_new <= v_prev then
    return 'not_later';
  end if;

  update public.stores
     set config = config || jsonb_build_object('plan', p_plan, 'planExpiresAt', p_expires_at),
         updated_at = now()
   where slug = p_slug;

  return 'extended';
end;
$fn$;

comment on function public.extend_store_plan_from_razorpay(text, text, text, text) is
  'Daily Razorpay sync: moves a paying store''s planExpiresAt forward. Extend-only, '
  'same-subscription-only, merges plan + planExpiresAt. service_role only.';

revoke all on function public.extend_store_plan_from_razorpay(text, text, text, text) from public, anon, authenticated;
grant execute on function public.extend_store_plan_from_razorpay(text, text, text, text) to service_role;

insert into public.automation_secrets (name, secret)
values ('subscription-sync', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
on conflict (name) do nothing;
