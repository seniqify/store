-- ===========================================================================
--  Order integrity, phase 2  --  UNDO
--
--  Removes everything the phase-2 forward file installed. Because that file
--  only ADDED objects and wired none of them to the live path, this undo takes
--  nothing away from the storefront: orders are still written the way they are
--  written today, the orders_anon_insert policy is untouched, and
--  trg_decrement_stock is untouched.
--
--  Run this only while the new writer is unused. Once checkout actually goes
--  through create_order_secure, dropping it stops orders being created at all --
--  at that point the way back is to re-point the client, not to run this.
--
--  order_integrity holds the evidence of what each order was charged and why.
--  It is dropped here because nothing reads it yet; if any order has already
--  been written through the new writer, the DROP will fail on the foreign key
--  rather than quietly discard that evidence, which is the intended outcome.
--
--  RUN: Supabase Dashboard -> SQL Editor -> paste -> Run. Idempotent.
--  VERIFY: supabase/order-integrity-phase2-verify.sql
--          (V1-V3 then read FAIL, which is the point; V5 must still read PASS)
-- ===========================================================================

begin;

drop function if exists public.create_order_secure(
  text, text, text, text, text, jsonb, text, text, jsonb, jsonb, jsonb, text);

drop function if exists public.store_pricing_fingerprint(text);

-- Observation data only.
drop table if exists public.order_pricing_shadow;

-- Idempotency ledger. Dropping it forgets which checkout attempts were already
-- accepted; harmless while nothing uses the new writer.
drop table if exists public.order_requests;

-- Refuses to drop while any order still references it. That is deliberate.
drop table if exists public.order_integrity;

commit;

-- What this does NOT touch, because phase 2 never changed them:
--   public.orders                         no column added or removed
--   policy orders_anon_insert             still present
--   trigger trg_decrement_stock           still present
--   trigger orders_insert_guard           still present (phase 1)
