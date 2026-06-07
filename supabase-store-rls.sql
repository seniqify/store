-- ══════════════════════════════════════════════════════════════════════════════
-- POCKETLINK — Lock down store writes (close the "anyone can edit any store" hole)
--
-- Before: the `stores` table had `Public update USING (true)`, so any anonymous
-- caller could overwrite ANY store's config (products, WhatsApp number → steal
-- orders), reset its PIN, or self-upgrade its plan — the PIN gate was UI-only.
--
-- After: all writes go through PIN-/ownership-checked SECURITY DEFINER RPCs,
-- mirroring the orders/reviews model. Roll out in two phases (no downtime):
--   PHASE 1 (this file): create the RPCs + grants. Additive — nothing breaks.
--   PHASE 2 (after the app is deployed to use them): run the REVOKE/DROP block
--           at the bottom to actually close the door.
-- ══════════════════════════════════════════════════════════════════════════════

-- ── 1. Owner config edits (PIN-checked) ────────────────────────────────────────
-- Writes the new config but FORCES the server-managed plan/billing/owner fields
-- to their existing values, so an owner can't self-upgrade by editing their saved
-- config. Returns true only when the PIN matched and a row was updated.
CREATE OR REPLACE FUNCTION public.update_store_config(p_slug TEXT, p_hashed_pin TEXT, p_config JSONB)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE n INTEGER;
BEGIN
  UPDATE public.stores s
     SET config = p_config || jsonb_build_object(
                    'plan',                   s.config->'plan',
                    'planExpiresAt',          s.config->'planExpiresAt',
                    'razorpaySubscriptionId', s.config->'razorpaySubscriptionId',
                    'ownerPhone',             s.config->'ownerPhone'
                  ),
         updated_at = now()
   WHERE s.slug = p_slug AND s.pin = p_hashed_pin;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n > 0;
END;
$$;

-- ── 2. Forgot-PIN reset (ownership = matching WhatsApp number, checked here) ────
CREATE OR REPLACE FUNCTION public.reset_store_pin(p_slug TEXT, p_whatsapp TEXT, p_new_hashed_pin TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE stored10 TEXT; input10 TEXT; n INTEGER;
BEGIN
  SELECT right(regexp_replace(coalesce(config->>'whatsappNumber',''), '\D', '', 'g'), 10)
    INTO stored10 FROM public.stores WHERE slug = p_slug;
  IF stored10 IS NULL OR stored10 = '' THEN RETURN false; END IF;
  input10 := right(regexp_replace(coalesce(p_whatsapp,''), '\D', '', 'g'), 10);
  IF stored10 <> input10 THEN RETURN false; END IF;
  UPDATE public.stores SET pin = p_new_hashed_pin, updated_at = now() WHERE slug = p_slug;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n > 0;
END;
$$;

-- ── 3. Plan upgrade (post-payment / coupon). Touches ONLY plan/billing fields ───
-- so even though it isn't PIN-gated, it can't deface a store. (Tightening this to
-- be payment-verified server-side is the follow-up billing pass.)
CREATE OR REPLACE FUNCTION public.upgrade_store_plan(p_slug TEXT, p_plan TEXT, p_expires TEXT, p_sub_id TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.stores s
     SET config = s.config || jsonb_build_object(
                    'plan', to_jsonb(p_plan),
                    'planExpiresAt',          CASE WHEN p_expires IS NULL THEN s.config->'planExpiresAt' ELSE to_jsonb(p_expires) END,
                    'razorpaySubscriptionId', CASE WHEN p_sub_id  IS NULL THEN s.config->'razorpaySubscriptionId' ELSE to_jsonb(p_sub_id) END
                  ),
         plan = p_plan,
         updated_at = now()
   WHERE s.slug = p_slug;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_store_config(TEXT, TEXT, JSONB) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reset_store_pin(TEXT, TEXT, TEXT)       TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upgrade_store_plan(TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;

-- ══════════════════════════════════════════════════════════════════════════════
-- PHASE 2 — run ONLY after the app is deployed to use the RPCs above.
-- This is what actually closes the hole. (Kept commented so PHASE 1 is safe.)
--
--   REVOKE UPDATE ON public.stores FROM anon, authenticated;
--   DROP POLICY IF EXISTS "Public update" ON public.stores;
--
-- Verify after: a direct PATCH to /rest/v1/stores with the anon key must fail,
-- while update_store_config(slug, correct_pin, config) still succeeds.
-- ══════════════════════════════════════════════════════════════════════════════
