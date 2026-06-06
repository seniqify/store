-- ══════════════════════════════════════════════════════════════════════════════
-- POCKETLINK — Per-store page views (owner-facing "Reach")
-- Run this in: Supabase Dashboard → SQL Editor
--
-- Anonymous visitors INSERT one view per store per device per day (deduped by a
-- random localStorage id). Raw rows are never publicly readable; owners read
-- only aggregate counts through a SECURITY DEFINER RPC. Dates are IST so "today"
-- and "this week" match the merchant's clock.
-- ══════════════════════════════════════════════════════════════════════════════

-- UUID PK (no sequence) so the anon role can INSERT without a sequence grant —
-- matches the stores/orders/reviews tables.
CREATE TABLE IF NOT EXISTS public.store_views (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  store_slug  TEXT        NOT NULL,
  visitor     TEXT        NOT NULL,                                    -- anon per-device id
  viewed_on   DATE        NOT NULL DEFAULT (now() AT TIME ZONE 'Asia/Kolkata')::date,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- One row per store + device + day → natural dedup (and caps bot/owner inflation).
CREATE UNIQUE INDEX IF NOT EXISTS uq_store_views_daily
  ON public.store_views (store_slug, visitor, viewed_on);
CREATE INDEX IF NOT EXISTS idx_store_views_slug
  ON public.store_views (store_slug, viewed_on);

ALTER TABLE public.store_views ENABLE ROW LEVEL SECURITY;

-- Anyone may log a view (sane length bounds). No public SELECT — counts via RPC.
DROP POLICY IF EXISTS "Public insert views" ON public.store_views;
CREATE POLICY "Public insert views" ON public.store_views
  FOR INSERT
  WITH CHECK (
    char_length(store_slug) BETWEEN 1 AND 80
    AND char_length(visitor) BETWEEN 1 AND 64
  );

-- Aggregate counts for a store (public — counts only, no PII). Rolling windows:
-- this_week = last 7 days, last_week = the 7 days before that.
CREATE OR REPLACE FUNCTION public.get_store_view_stats(p_slug TEXT)
RETURNS TABLE(today INT, this_week INT, last_week INT, total INT)
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  WITH d AS (SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date AS today)
  SELECT
    count(*) FILTER (WHERE v.viewed_on = d.today)::int,
    count(*) FILTER (WHERE v.viewed_on >  d.today - 7)::int,
    count(*) FILTER (WHERE v.viewed_on >  d.today - 14 AND v.viewed_on <= d.today - 7)::int,
    count(*)::int
  FROM public.store_views v, d
  WHERE v.store_slug = p_slug;
$$;

-- Explicit insert grant (defensive — counts/reads stay RPC-only).
GRANT INSERT ON public.store_views TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_store_view_stats(TEXT) TO anon, authenticated;

-- ══════════════════════════════════════════════════════════════════════════════
-- DONE.
-- ══════════════════════════════════════════════════════════════════════════════
