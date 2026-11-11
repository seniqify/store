-- ===========================================================================
--  Release an unconfirmed booking  --  UNDO
--
--  Drops release_unsent_attempt and read_open_attempt. Attempts it already released stay released:
--  each was released only after the courier said it had no such parcel.
--
--  REVERT shipping-book FIRST (the checking version calls this function;
--  without it, a stuck order simply stays blocked, as before).
--  RUN: Supabase Dashboard -> SQL Editor -> paste -> Run. Idempotent.
-- ===========================================================================

begin;
drop function if exists public.release_unsent_attempt(text, uuid, bigint, timestamptz, text);
drop function if exists public.read_open_attempt(text, uuid, bigint);
commit;
