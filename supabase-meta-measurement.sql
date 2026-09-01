-- ══════════════════════════════════════════════════════════════════════════════
-- Stage 2E-2 — Measurement. RLS-locked; service-role only.
--
-- 1) Recommendation/config SNAPSHOT on the launch ledger (captured at creation,
--    before any spend). The full snapshot lives in meta_campaigns.config (already
--    present); we add strategy_source + experiment_id as first-class columns for
--    experiments (2E-4).
-- 2) meta_campaign_outcomes — per-campaign daily outcome snapshots. Meta-reported
--    metrics and PocketLink's own order/revenue truth are kept in SEPARATE columns
--    so they stay reconcilable, never blended.
-- 3) A daily scheduled snapshot (Supabase pg_cron → the meta-insights-snapshot edge
--    function). This is Supabase-side, so it does NOT count toward Vercel's
--    12-serverless-function limit.
-- ══════════════════════════════════════════════════════════════════════════════

-- ── 1) Snapshot columns ────────────────────────────────────────────────────────
alter table public.meta_campaigns add column if not exists strategy_source text not null default 'pocketlink_reco';
alter table public.meta_campaigns add column if not exists experiment_id   text;

-- Extend the ledger setter to persist the new columns + let config be updated.
create or replace function public.meta_campaign_set(p_launch_id uuid, p_patch jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.meta_campaigns set
    status          = coalesce(p_patch->>'status', status),
    campaign_id     = coalesce(p_patch->>'campaign_id', campaign_id),
    adset_id        = coalesce(p_patch->>'adset_id', adset_id),
    creative_id     = coalesce(p_patch->>'creative_id', creative_id),
    ad_id           = coalesce(p_patch->>'ad_id', ad_id),
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
    error           = case when p_patch ? 'error' then p_patch->>'error' else error end,
    activated_by    = coalesce(p_patch->>'activated_by', activated_by),
    activated_at    = case when p_patch ? 'activated_at' then now() else activated_at end,
    updated_at      = now()
  where launch_id = p_launch_id;
end $$;
revoke all on function public.meta_campaign_set(uuid, jsonb) from anon, authenticated;

-- ── 2) Outcomes time-series ────────────────────────────────────────────────────
create table if not exists public.meta_campaign_outcomes (
  campaign_id           text        not null,
  store_slug            text        not null,
  launch_id             uuid,
  snapshot_date         date        not null,
  -- Meta-reported (Insights actions/action_values) — the ad platform's view
  spend                 numeric,
  impressions           bigint,
  reach                 bigint,
  cpm                   numeric,
  clicks                bigint,
  ctr                   numeric,
  cpc                   numeric,
  lpv                   bigint,        -- landing page views
  atc                   bigint,        -- add to cart
  checkout              bigint,        -- initiate checkout
  purchases_meta        bigint,        -- Meta-attributed purchases
  revenue_meta          numeric,       -- Meta-attributed purchase value
  -- PocketLink truth (our orders table, in the campaign's live window) — business view
  orders_pl             int,           -- placed orders (excludes abandoned/cancelled)
  revenue_pl            numeric,        -- their order totals
  delivered_orders_pl   int,           -- delivered subset
  delivered_revenue_pl  numeric,        -- delivered revenue
  currency              text,
  captured_at           timestamptz not null default now(),
  primary key (campaign_id, snapshot_date)
);
alter table public.meta_campaign_outcomes enable row level security;
revoke all on public.meta_campaign_outcomes from anon, authenticated;
create index if not exists idx_mco_store on public.meta_campaign_outcomes (store_slug, snapshot_date);
comment on table public.meta_campaign_outcomes is
  '2E-2 measurement: per-campaign daily outcome snapshots. Meta-reported metrics and PocketLink order/revenue truth in SEPARATE columns, reconcilable. RLS-locked; service-role only.';

-- ── 3) Daily scheduled snapshot (Supabase-side; independent of Vercel) ──────────
create extension if not exists pg_cron;

create or replace function public.meta_snapshot_tick()
returns void language plpgsql security definer set search_path = public as $$
declare v_secret text;
begin
  select secret into v_secret from public.meta_capi_config limit 1;
  perform net.http_post(
    url     := 'https://uoyqbexemoheipwrtkcz.supabase.co/functions/v1/meta-insights-snapshot',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-capi-secret', coalesce(v_secret, '')),
    body    := '{}'::jsonb
  );
end $$;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'meta-insights-daily') then
    perform cron.unschedule('meta-insights-daily');
  end if;
  perform cron.schedule('meta-insights-daily', '30 1 * * *', $c$select public.meta_snapshot_tick();$c$);
end $$;
