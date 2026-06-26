-- ════════════════════════════════════════════════════════════════════════
--  AI Insights — Phase 1 capture layer
--  Logs every question asked to the storefront AI Search Bar so the merchant
--  dashboard can show what customers want. Mirrors the reviews security model:
--  anyone (anon) may INSERT a log; only the owner may read, via a PIN-checked
--  SECURITY DEFINER RPC. Run once in the Supabase SQL editor.
-- ════════════════════════════════════════════════════════════════════════

create table if not exists public.ai_searches (
  id          bigint generated always as identity primary key,
  store_slug  text not null,
  question    text not null,
  reply       text,
  answered    boolean not null default true,   -- did the AI give a confident answer?
  matched     boolean not null default true,   -- did the query map to a product we stock?
  intent      text,                            -- budget | category | availability | delivery | feature
  created_at  timestamptz not null default now()
);

create index if not exists ai_searches_store_idx
  on public.ai_searches (store_slug, created_at desc);

alter table public.ai_searches enable row level security;

-- Public (anon) may log a search; nobody may SELECT the raw table.
drop policy if exists ai_searches_insert on public.ai_searches;
create policy ai_searches_insert on public.ai_searches
  for insert to anon, authenticated
  with check (true);

-- Owner-only read, PIN-checked server-side (same pattern as get_store_reviews).
create or replace function public.get_store_ai_searches(p_slug text, p_hashed_pin text)
returns setof public.ai_searches
language sql
security definer
set search_path = public
as $$
  select *
  from public.ai_searches
  where store_slug = p_slug
    and exists (
      select 1 from public.stores s
      where s.slug = p_slug and s.pin = p_hashed_pin
    )
  order by created_at desc
  limit 3000;
$$;

grant execute on function public.get_store_ai_searches(text, text) to anon, authenticated;
