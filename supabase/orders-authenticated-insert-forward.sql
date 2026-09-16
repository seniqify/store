-- ===========================================================================
--  Checkout fails for a signed-in browser  --  PREPARED, NOT APPLIED
-- ===========================================================================
--
--  SYMPTOM
--
--  A customer on a browser that holds a Supabase Auth session cannot place an
--  order. Online checkout stops before Razorpay opens, with "We couldn't save
--  your order, so no payment was taken". Cash on delivery looks fine, because
--  the order-notify safety net re-saves the row with the service role about
--  half a second later -- the client write failed there too.
--
--  Production evidence:
--    POST /rest/v1/orders -> 403, twice per attempt (saveOrder retries once)
--    postgres: new row violates row-level security policy for table "orders"
--    the failing requests carry a JWT with "role":"authenticated";
--    every successful insert in the same window carries "role":"anon"
--
--  CAUSE
--
--  public.orders has exactly one INSERT policy and it names one role:
--
--    orders_anon_insert  PERMISSIVE  INSERT  TO anon  WITH CHECK (true)
--
--  PostgREST runs the request as the role in the Authorization JWT. Signed out
--  that is anon and the policy applies; signed in it is authenticated, no
--  policy applies, and RLS refuses the row. This is long-standing and unrelated
--  to the phase-1 hardening -- it surfaced only because testing happened in a
--  browser signed in to the founder console.
--
--  THE CHANGE
--
--  One statement: the existing policy applies to both roles. ALTER POLICY ...
--  TO changes only the roles; the command stays INSERT and the check stays
--  `true`, so nothing else about the policy moves.
--
--  This grants a signed-in browser exactly what a signed-out one already has,
--  and no more. It is not a widening of what an order may claim: the BEFORE
--  INSERT trigger public.orders_insert_guard forces paid, paid_at, paid_via,
--  payment_ref and payment_provider to their unpaid values for EVERY role, and
--  clamps status. That trigger is not touched here.
--
--  Deliberately NOT done: no SELECT, UPDATE or DELETE policy for authenticated,
--  no new grants, no change to the anon path, nothing in payments or ads.
--
--  RUN: Supabase Dashboard -> SQL Editor -> paste -> Run. Idempotent.
--  PROVE:  supabase/orders-authenticated-insert-PROOF.sql (inserts, then rolls
--          back -- it leaves nothing behind, and it fails before this is applied)
--  VERIFY: supabase/orders-authenticated-insert-verify.sql (read-only)
--  UNDO:   supabase/orders-authenticated-insert-ROLLBACK.sql
-- ===========================================================================

begin;

alter policy orders_anon_insert on public.orders to anon, authenticated;

commit;

-- Next: supabase/orders-authenticated-insert-verify.sql (read-only).
