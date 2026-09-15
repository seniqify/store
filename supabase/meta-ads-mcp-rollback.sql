-- ============================================================================
-- Roll back supabase/meta-ads-mcp-forward.sql.
--
-- Put the previous code live FIRST: code that writes meta_ad_actions or the
-- new ledger fields fails after this runs.
--
--   * meta_campaign_set goes back to its previous body (ids are not cleared by
--     an explicit null, no engine / budget_type / media)
--   * meta_ad_actions is dropped (its audit rows are lost)
--   * the new constraints are dropped
--   * the new COLUMNS ARE KEPT: dropping them would delete eligibility snapshots
--     and campaign engine data, and old code ignores them
--   * EXECUTE stays revoked from PUBLIC on the ledger functions: that closed a
--     hole, and nothing legitimate needs it back
-- ============================================================================

begin;

create or replace function public.meta_campaign_set(p_launch_id uuid, p_patch jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
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

revoke all on function public.meta_campaign_set(uuid, jsonb) from public, anon, authenticated;

drop table if exists public.meta_ad_actions;

alter table public.meta_campaigns drop constraint if exists meta_campaigns_engine_check;
alter table public.meta_campaigns drop constraint if exists meta_campaigns_budget_type_check;
alter table public.store_meta_accounts drop constraint if exists store_meta_accounts_token_status_check;

commit;
