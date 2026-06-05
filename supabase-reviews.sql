-- ══════════════════════════════════════════════════════════════════════════════
-- POCKETLINK — Customer Reviews & Ratings
-- Run this in: Supabase Dashboard → SQL Editor
--
-- Mirrors the `orders` security model: customers may INSERT a review and the
-- public may SELECT only *approved* reviews, while the owner reads/moderates
-- everything through PIN-checked SECURITY DEFINER RPCs (PIN never sent raw).
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.reviews (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  store_slug    TEXT        NOT NULL,
  customer_name TEXT        NOT NULL,
  rating        INT         NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment       TEXT        DEFAULT '',
  status        TEXT        NOT NULL DEFAULT 'approved',  -- approved | hidden
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reviews_store ON public.reviews(store_slug, status);

ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;

-- Anyone may leave a review (1–5 stars, non-empty name). No spoofing the status.
DROP POLICY IF EXISTS "Public insert reviews" ON public.reviews;
CREATE POLICY "Public insert reviews" ON public.reviews
  FOR INSERT
  WITH CHECK (
    rating BETWEEN 1 AND 5
    AND char_length(customer_name) BETWEEN 1 AND 60
    AND status = 'approved'
  );

-- The public can read only approved reviews.
DROP POLICY IF EXISTS "Public read approved reviews" ON public.reviews;
CREATE POLICY "Public read approved reviews" ON public.reviews
  FOR SELECT
  USING (status = 'approved');

-- ── Owner moderation RPCs (PIN-checked, security definer) ───────────────────

-- List every review for a store (any status), newest first.
CREATE OR REPLACE FUNCTION public.get_store_reviews(p_slug TEXT, p_hashed_pin TEXT)
RETURNS SETOF public.reviews
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT r.* FROM public.reviews r
  WHERE r.store_slug = p_slug
    AND EXISTS (SELECT 1 FROM public.stores s WHERE s.slug = p_slug AND s.pin = p_hashed_pin)
  ORDER BY r.created_at DESC;
$$;

-- Hide / re-approve a single review.
CREATE OR REPLACE FUNCTION public.set_review_status(p_slug TEXT, p_hashed_pin TEXT, p_review_id UUID, p_status TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.stores s WHERE s.slug = p_slug AND s.pin = p_hashed_pin) THEN
    RETURN;
  END IF;
  IF p_status NOT IN ('approved', 'hidden') THEN
    RETURN;
  END IF;
  UPDATE public.reviews SET status = p_status
  WHERE id = p_review_id AND store_slug = p_slug;
END;
$$;

-- Permanently delete a review.
CREATE OR REPLACE FUNCTION public.delete_review(p_slug TEXT, p_hashed_pin TEXT, p_review_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.stores s WHERE s.slug = p_slug AND s.pin = p_hashed_pin) THEN
    RETURN;
  END IF;
  DELETE FROM public.reviews WHERE id = p_review_id AND store_slug = p_slug;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_store_reviews(TEXT, TEXT)              TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_review_status(TEXT, TEXT, UUID, TEXT)  TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_review(TEXT, TEXT, UUID)            TO anon, authenticated;

-- ══════════════════════════════════════════════════════════════════════════════
-- DONE.
-- ══════════════════════════════════════════════════════════════════════════════
