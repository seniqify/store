-- ============================================================================
-- Meta ads via Meta's ads MCP server - database changes
--
--   1. store_meta_accounts: per-ad-account eligibility snapshot (is the account
--      enabled for Meta's ads automation?), when it was checked, token health
--   2. meta_campaigns: which engine created the campaign (mcp | graph), budget
--      type (daily | lifetime), uploaded media
--   3. meta_campaign_set: writes the new columns, and an explicit null in the
--      patch now CLEARS an object id (a rolled-back create used to leave the
--      deleted object's id in the ledger)
--   4. meta_ad_actions: audit log of every ads action (never tokens)
--   5. ledger functions: EXECUTE revoked from PUBLIC (revoking only from anon
--      and authenticated leaves the default PUBLIC grant in place)
--
-- Additive: no column is dropped, no row is changed, no token is touched.
-- Safe to re-run. Check with supabase/meta-ads-mcp-verify.sql.
-- Undo with supabase/meta-ads-mcp-rollback.sql.
-- Run in Supabase -> SQL editor.
-- ============================================================================

begin;

-- 1) Connection: eligibility snapshot + token health ------------------------
alter table public.store_meta_accounts
  add column if not exists ad_accounts    jsonb       not null default '[]'::jsonb,
  add column if not exists mcp_checked_at timestamptz,
  add column if not exists mcp_error      text,
  add column if not exists token_status   text        not null default 'valid',
  add column if not exists last_error     text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'store_meta_accounts_token_status_check') then
    alter table public.store_meta_accounts
      add constraint store_meta_accounts_token_status_check
      check (token_status in ('valid', 'expiring', 'expired', 'revoked'));
  end if;
end $$;

comment on column public.store_meta_accounts.ad_accounts is
  'Per ad account, as last read from Meta: id, name, business, automation (available | unavailable | unknown, from is_ads_mcp_enabled), queryable, status, currency. No tokens.';
comment on column public.store_meta_accounts.mcp_checked_at is
  'When ad account eligibility was last read from Meta.';
comment on column public.store_meta_accounts.mcp_error is
  'Why the last eligibility check failed (error code), or null.';
comment on column public.store_meta_accounts.token_status is
  'valid | expiring (within 7 days) | expired | revoked.';

-- 2) Launch ledger: engine, budget type, media --------------------------------
alter table public.meta_campaigns
  add column if not exists engine      text,
  add column if not exists budget_type text,
  add column if not exists media       jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'meta_campaigns_engine_check') then
    alter table public.meta_campaigns
      add constraint meta_campaigns_engine_check check (engine is null or engine in ('mcp', 'graph'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'meta_campaigns_budget_type_check') then
    alter table public.meta_campaigns
      add constraint meta_campaigns_budget_type_check check (budget_type is null or budget_type in ('daily', 'lifetime'));
  end if;
end $$;

-- 3) Ledger setter ---------------------------------------------------------------
create or replace function public.meta_campaign_set(p_launch_id uuid, p_patch jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.meta_campaigns set
    status          = coalesce(p_patch->>'status', status),
    campaign_id     = case when p_patch ? 'campaign_id' then p_patch->>'campaign_id' else campaign_id end,
    adset_id        = case when p_patch ? 'adset_id'    then p_patch->>'adset_id'    else adset_id    end,
    creative_id     = case when p_patch ? 'creative_id' then p_patch->>'creative_id' else creative_id end,
    ad_id           = case when p_patch ? 'ad_id'       then p_patch->>'ad_id'       else ad_id       end,
    page_id         = coalesce(p_patch->>'page_id', page_id),
    objective       = coalesce(p_patch->>'objective', objective),
    daily_budget    = coalesce((p_patch->>'daily_budget')::int, daily_budget),
    days            = coalesce((p_patch->>'days')::int, days),
    lifetime_minor  = coalesce((p_patch->>'lifetime_minor')::bigint, lifetime_minor),
    currency        = coalesce(p_patch->>'currency', currency),
    spend_cap_set   = coalesce((p_patch->>'spend_cap_set')::boolean, spend_cap_set),
    strategy_source = coalesce(p_patch->>'strategy_source', strategy_source),
    experiment_id   = coalesce(p_patch->>'experiment_id', experiment_id),
    config          = coalesce(p_patch->'config', config),
    engine          = coalesce(p_patch->>'engine', engine),
    budget_type     = coalesce(p_patch->>'budget_type', budget_type),
    media           = coalesce(p_patch->'media', media),
    error           = case when p_patch ? 'error' then p_patch->>'error' else error end,
    activated_by    = coalesce(p_patch->>'activated_by', activated_by),
    activated_at    = case when p_patch ? 'activated_at' then now() else activated_at end,
    updated_at      = now()
  where launch_id = p_launch_id;
end $$;

-- 4) Audit log -------------------------------------------------------------------
create table if not exists public.meta_ad_actions (
  id          bigserial   primary key,
  store_slug  text        not null,
  launch_id   uuid,
  action      text        not null,
  engine      text,
  target_id   text,
  ok          boolean     not null,
  error_code  text,
  detail      jsonb,
  actor       text,
  created_at  timestamptz not null default now(),
  constraint meta_ad_actions_action_check check (action in (
    'connect', 'eligibility', 'select', 'create', 'rollback', 'activate', 'pause', 'resume',
    'stop', 'budget', 'targeting', 'upload', 'errors')),
  constraint meta_ad_actions_engine_check check (engine is null or engine in ('mcp', 'graph')),
  constraint meta_ad_actions_actor_check check (actor is null or actor in ('merchant', 'staff', 'system'))
);

create index if not exists meta_ad_actions_store_idx  on public.meta_ad_actions (store_slug, created_at desc);
create index if not exists meta_ad_actions_launch_idx on public.meta_ad_actions (launch_id) where launch_id is not null;

alter table public.meta_ad_actions enable row level security;
revoke all on public.meta_ad_actions from public, anon, authenticated;
revoke all on sequence public.meta_ad_actions_id_seq from public, anon, authenticated;

comment on table public.meta_ad_actions is
  'Every Meta ads action PocketLink performs: what, on which object, through which engine, result. Never stores tokens. RLS-locked; service role only.';

-- 5) Ledger functions: server only ------------------------------------------------
revoke all on function public.meta_campaign_set(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.meta_campaign_claim(uuid, text, jsonb, integer, integer) from public, anon, authenticated;

commit;
