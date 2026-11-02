-- ===========================================================================
--  Owner phone off the public shop settings  --  STEP 2  --  ROLLBACK
--
--  Gives anon and authenticated their read of stores.config back, exactly as
--  before step 2. Instant and always safe: the site reads public_config, which
--  step 1 keeps; this only re-opens the old column.
--
--  RUN: Supabase Dashboard -> SQL Editor -> paste -> Run. Idempotent.
-- ===========================================================================

begin;

grant select (config) on public.stores to anon, authenticated;

commit;
