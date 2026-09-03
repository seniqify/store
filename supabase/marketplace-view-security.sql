-- Harden the public marketplace view (Supabase linter: "Security Definer View").
--
-- Postgres views run as their OWNER unless security_invoker is set. This one is
-- owned by `postgres`, so every read of marketplace_listing bypassed both RLS
-- and the column grants on `stores`.
--
-- Nothing was actually exposed by that:
--   * stores.pin is NOT granted to anon/authenticated (their column grants are
--     config, created_at, id, slug, updated_at) and the view never selects it;
--   * RLS on stores is `SELECT USING (true)` for public, so bypassing it
--     revealed no rows that weren't already world-readable;
--   * the view projects only curated config fields that are already public on
--     each storefront (name, tagline, category, city, logo, theme, hours).
--
-- The risk was latent rather than live: the day anyone tightens RLS on `stores`
-- to hide suspended / unpaid / unlisted shops, a definer view keeps serving all
-- of them and silently bypasses the new policy. Switching to invoker semantics
-- makes that protection automatic instead of something to remember.
--
-- Safe to apply: the view needs only slug, created_at and config from `stores`,
-- and anon already holds SELECT on all three — so the marketplace keeps working
-- and row visibility is unchanged. Requires PG 15+; this project is on 17.6.

alter view public.marketplace_listing set (security_invoker = on);

-- Supabase grants every role full CRUD on new relations by default. The view is
-- read-only by nature (computed columns + a subquery make it non-updatable, so
-- writes would fail anyway) — drop the grants rather than rely on that.
revoke insert, update, delete, truncate, references, trigger
  on public.marketplace_listing from anon, authenticated;
