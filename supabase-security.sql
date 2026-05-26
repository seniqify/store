-- ══════════════════════════════════════════════════════════════════════════
-- ORDIFY — SECURITY HARDENING
-- Run this in: Supabase Dashboard → SQL Editor
-- ══════════════════════════════════════════════════════════════════════════

-- ── 1. Hash the existing plaintext PIN for the radhakirana store ──────────
--    SHA-256("snq1_2343") — the salt+PIN our app now uses
UPDATE public.stores
SET pin = 'b2bfff959addb7ed8e2abcf3469912d9176fa16709b055d7340716877b8b47cb'
WHERE slug = 'radhakirana';


-- ── 2. Create a secure RPC function for PIN verification ──────────────────
--    security definer = runs as postgres role, bypassing RLS on pin column
CREATE OR REPLACE FUNCTION public.verify_store_pin(p_slug TEXT, p_hashed_pin TEXT)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.stores
    WHERE slug = p_slug AND pin = p_hashed_pin
  );
$$;

-- Allow anon and authenticated roles to call this function
GRANT EXECUTE ON FUNCTION public.verify_store_pin(TEXT, TEXT) TO anon, authenticated;


-- ── 3. Column-level security: hide the pin column from public API ─────────
--    After this, calling /rest/v1/stores?select=pin returns an empty column.
REVOKE SELECT ON public.stores FROM anon, authenticated;
GRANT  SELECT (id, slug, config, created_at, updated_at)
       ON public.stores TO anon, authenticated;


-- ── 4. Create Supabase Storage bucket for product images ─────────────────
--    (Do this in Supabase Dashboard → Storage → New bucket instead,
--     or uncomment the line below if using Supabase CLI / service role)
-- INSERT INTO storage.buckets (id, name, public) VALUES ('product-images', 'product-images', true);

-- ══════════════════════════════════════════════════════════════════════════
-- DONE. Verify with:
--   SELECT slug, (pin IS NOT NULL) as has_pin FROM stores;
-- ══════════════════════════════════════════════════════════════════════════
