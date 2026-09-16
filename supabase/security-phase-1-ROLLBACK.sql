-- ===========================================================================
--  Security hardening, phase 1  --  EMERGENCY UNDO
--
--  This REOPENS what the forward migration closed. It exists for one case:
--  "checkout or OTP is broken for real merchants right now and we need the old
--  behaviour back while we work out why". It is not a tidy-up script.
--
--  What comes back if you run it:
--    * an order INSERT can once again arrive with paid = true, a forged
--      payment_ref and any status, from anybody, for any store
--    * send-otp loses its rate limit at the database end -- the edge function
--      in this branch calls otp_guard and treats a missing function as a
--      refusal, so ALSO redeploy the previous send-otp, or OTP stops working
--
--  What does NOT come back, deliberately:
--    * DELETE and TRUNCATE for anon and authenticated on stores and orders.
--      Nothing uses them; re-granting them is a decision, not a rollback. The
--      statements are written out at the end, commented, if you truly need it.
--
--  The ledger column and the widened `kind` constraint are left in place: they
--  are additive, they break nothing, and dropping them would lose the PIN
--  throttle's own rows.
--
--  RUN: Supabase Dashboard -> SQL Editor -> paste -> Run. Idempotent.
-- ===========================================================================

begin;

-- 1. An order INSERT may claim payment again.
drop trigger if exists orders_insert_guard on public.orders;
drop function if exists public.orders_insert_guard();

-- 2. The OTP guard is gone; the edge function fails closed without it, so the
--    previous send-otp has to be redeployed alongside this.
drop function if exists public.otp_guard(text, text, text);

commit;

-- 3. Destructive grants stay revoked. If you have a real need, run these by
--    hand and write down why:
--
--    grant delete, truncate on public.stores to anon, authenticated;
--    grant delete, truncate on public.orders to anon, authenticated;
--
--  (Written as comments on purpose: no paste of this file should restore them
--   by accident.)

-- Verify with supabase/security-phase-1-verify.sql: V3 and V2 rows read FAIL
-- afterwards, which is the point, and V4 must still read PASS.
