-- ══════════════════════════════════════════════════════════════════════════════
-- POCKETLINK — Close the "Forgot PIN" store-takeover hole
--
-- BEFORE: reset_store_pin(slug, whatsapp, newPin) reset the PIN if the supplied
-- WhatsApp number matched the store's number. But that number is PUBLIC (it's in
-- the storefront config / wa.me links), so anyone could read it and reset any
-- store's PIN → edit the catalog, change the order-receiving number, read all
-- customer orders. Trivially exploitable.
--
-- AFTER: the reset additionally requires a valid, unexpired one-time code from
-- `otp_codes` (the same table the send-otp edge function writes to). The code is
-- delivered over WhatsApp to the store's real number, so the caller must CONTROL
-- the number, not merely know it. The code is consumed (deleted) on success.
--
-- Run this whole file in: Supabase Dashboard → SQL Editor.
-- ══════════════════════════════════════════════════════════════════════════════

-- 1. New OTP-checked reset (4 args). Number format is normalised to the last 10
--    digits everywhere, so "91XXXXXXXXXX" vs "XXXXXXXXXX" both match.
CREATE OR REPLACE FUNCTION public.reset_store_pin(
  p_slug TEXT, p_whatsapp TEXT, p_code TEXT, p_new_hashed_pin TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  stored10 TEXT;
  input10  TEXT;
  otp_ok   BOOLEAN;
  n        INTEGER;
BEGIN
  -- The store's own number (proof target)
  SELECT right(regexp_replace(coalesce(config->>'whatsappNumber',''), '\D', '', 'g'), 10)
    INTO stored10 FROM public.stores WHERE slug = p_slug;
  IF stored10 IS NULL OR stored10 = '' THEN RETURN false; END IF;

  input10 := right(regexp_replace(coalesce(p_whatsapp,''), '\D', '', 'g'), 10);
  IF stored10 <> input10 THEN RETURN false; END IF;

  -- Require a fresh OTP that was sent to this number
  SELECT EXISTS (
    SELECT 1 FROM public.otp_codes
    WHERE right(regexp_replace(phone, '\D', '', 'g'), 10) = input10
      AND code = p_code
      AND expires_at > now()
  ) INTO otp_ok;
  IF NOT otp_ok THEN RETURN false; END IF;

  -- Consume every OTP for this number (one-time use) and reset the PIN
  DELETE FROM public.otp_codes WHERE right(regexp_replace(phone, '\D', '', 'g'), 10) = input10;
  UPDATE public.stores SET pin = p_new_hashed_pin, updated_at = now() WHERE slug = p_slug;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n > 0;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reset_store_pin(TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;

-- 2. Remove the OLD number-only version so the insecure path is gone for good.
DROP FUNCTION IF EXISTS public.reset_store_pin(TEXT, TEXT, TEXT);

-- Verify:
--   SELECT public.reset_store_pin('your-slug','9999999999','000000','x') ;  -- expect false (bad OTP)

-- ══════════════════════════════════════════════════════════════════════════════
-- FOLLOW-UPS (recommended, run/verify separately — NOT required for the fix above)
--
--  A. RLS "Phase 2" — confirm direct writes are closed. A direct anon PATCH to
--     /rest/v1/stores must FAIL. If it succeeds, run (from supabase-store-rls.sql):
--       REVOKE UPDATE ON public.stores FROM anon, authenticated;
--       DROP POLICY IF EXISTS "Public update" ON public.stores;
--
--  B. Brute-force throttle on PIN checks — a 4-digit PIN is only 10,000 values
--     and verify_store_pin can be called unlimited times. Add a per-store attempt
--     limit (and apply the same guard to update_store_config / get_store_orders).
--     Sketch:
--       CREATE TABLE IF NOT EXISTS public.pin_attempts (
--         slug TEXT PRIMARY KEY, fails INT NOT NULL DEFAULT 0, locked_until TIMESTAMPTZ
--       );
--     …then in verify_store_pin: if locked_until > now() → return false;
--       on success reset fails=0; on failure fails=fails+1 and set locked_until
--       when fails crosses a threshold (e.g. 5 → +15 min).
-- ══════════════════════════════════════════════════════════════════════════════
