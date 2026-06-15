-- ══════════════════════════════════════════════════════════════════════════════
-- POCKETLINK — Marketplace search by ITEM, not just store name
--
-- Problem: the marketplace only loads slim card fields (name, tagline, category,
-- city) — never the products — so searching "dryfruits" / "snacks" / "dress"
-- returns nothing; only words that appear in a store's NAME or CATEGORY match.
--
-- Fix: a read-only view that adds a `search_text` column = store name + category
-- + tagline + city/area + every product's name & category, lower-cased. The
-- marketplace queries this view and matches the customer's query against it, so
-- a store selling "Dried Kiwi" now surfaces for "dryfruit". Only the small
-- concatenated text is sent to the browser — not the full product objects.
--
-- Run this whole file in: Supabase Dashboard → SQL Editor.
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW public.marketplace_listing AS
SELECT
  s.slug,
  s.created_at,
  s.config->>'businessName'   AS "businessName",
  s.config->>'tagline'        AS tagline,
  s.config->>'category'       AS category,
  s.config->>'businessType'   AS "businessType",
  s.config->>'city'           AS city,
  s.config->>'state'          AS state,
  s.config->>'area'           AS area,
  s.config->>'address'        AS address,
  s.config->>'logo'           AS logo,
  s.config->>'logoEmoji'      AS "logoEmoji",
  s.config->>'coverImage'     AS "coverImage",
  s.config->>'whatsappNumber' AS "whatsappNumber",
  s.config->'theme'           AS theme,
  s.config->'hours'           AS hours,
  lower(
    coalesce(s.config->>'businessName','') || ' ' ||
    coalesce(s.config->>'category','')     || ' ' ||
    coalesce(s.config->>'tagline','')      || ' ' ||
    coalesce(s.config->>'city','')         || ' ' ||
    coalesce(s.config->>'area','')         || ' ' ||
    coalesce((
      SELECT string_agg(coalesce(p->>'name','') || ' ' || coalesce(p->>'category',''), ' ')
      FROM jsonb_array_elements(s.config->'products') AS p
    ), '')
  ) AS search_text
FROM public.stores s
WHERE s.config->>'businessName' IS NOT NULL;

-- The view runs as the caller (security invoker), so anon already needs (and has)
-- column SELECT on stores. Also grant SELECT on the view itself.
GRANT SELECT ON public.marketplace_listing TO anon, authenticated;

-- Verify:
--   SELECT "businessName", left(search_text, 80) FROM public.marketplace_listing LIMIT 5;
