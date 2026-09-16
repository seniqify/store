-- ===========================================================================
--  Checkout fails for a signed-in browser  --  UNDO
--
--  Restores public.orders' INSERT policy to anon only, exactly as it was
--  before orders-authenticated-insert-forward.sql.
--
--  What comes back: a browser holding a Supabase Auth session cannot place an
--  order. Online checkout stops before Razorpay with "We couldn't save your
--  order, so no payment was taken"; COD appears to work because the safety net
--  re-saves the row server-side.
--
--  Signed-out customers -- almost everybody -- are unaffected either way.
--
--  RUN: Supabase Dashboard -> SQL Editor -> paste -> Run. Idempotent.
--  VERIFY: supabase/orders-authenticated-insert-verify.sql
--          (V1.2 then reads FAIL, which is the point of running this)
-- ===========================================================================

begin;

alter policy orders_anon_insert on public.orders to anon;

commit;
