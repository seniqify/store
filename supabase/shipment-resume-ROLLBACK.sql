-- ===========================================================================
--  Resume an unconfirmed booking  --  UNDO
--
--  Drops resume_shipment_attempt. After it, an unconfirmed booking blocks its
--  order again until support releases it. claimed_at values it set are LEFT:
--  they are true "last sent at" times.
--
--  REVERT shipping-book FIRST (the resuming version calls this function; without
--  it, a locked order shows "Could not start this booking" instead).
--  RUN: Supabase Dashboard -> SQL Editor -> paste -> Run. Idempotent.
-- ===========================================================================

begin;
drop function if exists public.resume_shipment_attempt(text, uuid, text);
commit;
