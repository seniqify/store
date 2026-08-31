-- ══════════════════════════════════════════════════════════════════════════════
-- Meta campaign launch ledger (Stage 2D). RLS-locked; service-role only.
--
-- One row per launch attempt, keyed by a client-minted launch_id (idempotency
-- key). Records the Meta object ids as each is created (resume-forward) and the
-- launch status. A safe lease (like meta_capi_claim) makes a crashed/timed-out
-- create RE-CLAIMABLE and never permanently stuck, while never creating a second
-- campaign for the same launch_id. Everything is created PAUSED, so a partial
-- launch has spent nothing.
--
-- FINANCIAL PROTECTION lives in the server (campaign-launch fn): hard caps
-- ₹5000/day · ₹25000 total · 30 days, plus lifetime_budget+end_time (Meta's true
-- total cap) and a conditional spend_cap. This table is the idempotency/audit
-- ledger, not the money gate.
--
-- Run ONCE in Supabase → SQL editor.
-- ══════════════════════════════════════════════════════════════════════════════

create table if not exists public.meta_campaigns (
  launch_id      uuid        primary key,
  store_slug     text        not null,
  status         text        not null default 'creating',
    -- creating | created | partial | failed | active | paused | stopped | rolled_back
  campaign_id    text,
  adset_id       text,
  creative_id    text,
  ad_id          text,
  page_id        text,
  objective      text,
  daily_budget   int,                        -- rupees (display)
  days           int,
  lifetime_minor bigint,                      -- paise actually sent to Meta
  currency       text,
  spend_cap_set  boolean     not null default false,
  config         jsonb,                       -- snapshot of the approved config
  attempts       int         not null default 0,
  claimed_at     timestamptz,
  error          text,
  activated_by   text,                        -- crm_team user id (founder) who activated
  activated_at   timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
alter table public.meta_campaigns enable row level security;
revoke all on public.meta_campaigns from anon, authenticated;
comment on table public.meta_campaigns is
  'Meta campaign launch ledger + idempotency lease (Stage 2D). RLS-locked; service-role only. Campaigns are created PAUSED; activation is founder-only.';

-- ── Atomic claim/lease for the create step ──────────────────────────────────────
-- 'claimed' → proceed (create missing objects); 'already_created' → done, return
-- existing ids; 'locked' → a live create lease is held elsewhere; 'exhausted' →
-- too many attempts. A stale 'creating' lease (crash/timeout) is re-claimable.
create or replace function public.meta_campaign_claim(
  p_launch_id uuid, p_store_slug text, p_config jsonb, p_lease_seconds int default 120, p_max_attempts int default 6
) returns text
language plpgsql security definer set search_path = public as $$
declare v_attempts int; v_status text;
begin
  insert into meta_campaigns (launch_id, store_slug, status, config, attempts, claimed_at, created_at, updated_at)
  values (p_launch_id, p_store_slug, 'creating', p_config, 1, now(), now(), now())
  on conflict (launch_id) do update
    set status = 'creating', attempts = meta_campaigns.attempts + 1, claimed_at = now(), updated_at = now()
    where meta_campaigns.status in ('creating', 'partial', 'failed')
      and (meta_campaigns.status <> 'creating'
           or meta_campaigns.claimed_at < now() - make_interval(secs => p_lease_seconds))
  returning attempts into v_attempts;

  if v_attempts is not null then
    if v_attempts > p_max_attempts then
      update meta_campaigns set status = 'failed', error = 'max attempts', updated_at = now() where launch_id = p_launch_id;
      return 'exhausted';
    end if;
    return 'claimed';
  end if;

  select status into v_status from meta_campaigns where launch_id = p_launch_id;
  if v_status in ('created', 'active', 'paused', 'stopped') then return 'already_created'; end if;
  return 'locked';
end $$;

-- Persist created ids / status transitions.
create or replace function public.meta_campaign_set(
  p_launch_id uuid, p_patch jsonb
) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.meta_campaigns set
    status         = coalesce(p_patch->>'status', status),
    campaign_id    = coalesce(p_patch->>'campaign_id', campaign_id),
    adset_id       = coalesce(p_patch->>'adset_id', adset_id),
    creative_id    = coalesce(p_patch->>'creative_id', creative_id),
    ad_id          = coalesce(p_patch->>'ad_id', ad_id),
    page_id        = coalesce(p_patch->>'page_id', page_id),
    objective      = coalesce(p_patch->>'objective', objective),
    daily_budget   = coalesce((p_patch->>'daily_budget')::int, daily_budget),
    days           = coalesce((p_patch->>'days')::int, days),
    lifetime_minor = coalesce((p_patch->>'lifetime_minor')::bigint, lifetime_minor),
    currency       = coalesce(p_patch->>'currency', currency),
    spend_cap_set  = coalesce((p_patch->>'spend_cap_set')::boolean, spend_cap_set),
    error          = case when p_patch ? 'error' then p_patch->>'error' else error end,
    activated_by   = coalesce(p_patch->>'activated_by', activated_by),
    activated_at   = case when p_patch ? 'activated_at' then now() else activated_at end,
    updated_at     = now()
  where launch_id = p_launch_id;
end $$;

revoke all on function public.meta_campaign_claim(uuid, text, jsonb, int, int) from anon, authenticated;
revoke all on function public.meta_campaign_set(uuid, jsonb) from anon, authenticated;
