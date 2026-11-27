-- ===========================================================================
--  "Deliver it yourself"  --  ROLLBACK
--  Removes mark_self_delivered. Orders already marked keep their status and
--  delivery cost. The app's old WhatsApp-only flow needs no database function.
-- ===========================================================================
begin;
drop function if exists public.mark_self_delivered(text, text, uuid, numeric);
commit;
