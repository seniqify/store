-- ══════════════════════════════════════════════════════════════════════════════
-- ORDIFY — Plan & OTP Migration
-- Run this in: Supabase Dashboard → SQL Editor
-- ══════════════════════════════════════════════════════════════════════════════

-- 1. Add plan + owner_phone to stores table
ALTER TABLE stores
  ADD COLUMN IF NOT EXISTS plan        TEXT    DEFAULT 'free',
  ADD COLUMN IF NOT EXISTS owner_phone TEXT;

-- 2. OTP codes table (used by the send-otp edge function)
CREATE TABLE IF NOT EXISTS otp_codes (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  phone      TEXT        NOT NULL,
  code       TEXT        NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  attempts   INTEGER     DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_otp_codes_phone ON otp_codes(phone);

-- 3. Enable Row Level Security on otp_codes
--    Only the service role (edge function) can read/write — never the anon key
ALTER TABLE otp_codes ENABLE ROW LEVEL SECURITY;

-- Drop default open policies if they exist, then lock down
DROP POLICY IF EXISTS "Allow all" ON otp_codes;

CREATE POLICY "Service role only"
  ON otp_codes
  USING (false);        -- anon/authenticated users: no access

-- 4. Helper RPC to increment attempts (called on wrong OTP)
CREATE OR REPLACE FUNCTION increment_otp_attempts(p_phone TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE otp_codes SET attempts = attempts + 1 WHERE phone = p_phone;
END;
$$;

-- 5. Auto-clean expired OTPs (run as a cron job or manually)
--    You can schedule this in Supabase Cron (pg_cron):
--    SELECT cron.schedule('cleanup-otp', '*/10 * * * *',
--      'DELETE FROM otp_codes WHERE expires_at < NOW()');
