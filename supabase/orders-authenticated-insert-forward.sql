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
--  THE GUARD IS A PRECONDITION, AND IT IS ENFORCED
--
--  That last paragraph is the whole safety argument, so this file refuses to
--  run without it. The guard ships on a different branch (PR #2, already
--  applied to production) and this file is based on main, so the repository
--  history cannot promise it is there -- the database has to be asked.
--
--  The check below raises, inside this transaction, unless public.orders
--  carries an ENABLED BEFORE INSERT ... FOR EACH ROW trigger named
--  orders_insert_guard, running public.orders_insert_guard(), whose body still
--  clears all five payment columns and clamps status. Anything else and the
--  policy is left alone: widening INSERT to authenticated while orders can be
--  born "paid" is the one combination that must not exist.
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

-- ---------------------------------------------------------------------------
-- Precondition: the payment guard must be live. Read-only -- it inspects the
-- catalog and either raises or does nothing.
-- ---------------------------------------------------------------------------
do $precondition$
declare
  v_guard_ok boolean;
begin
  select exists (
    select 1
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
      join pg_proc p on p.oid = t.tgfoid
      join pg_namespace fn on fn.oid = p.pronamespace
     where n.nspname = 'public'
       and c.relname = 'orders'
       and t.tgname = 'orders_insert_guard'
       and not t.tgisinternal
       and (t.tgtype & 1) <> 0          -- FOR EACH ROW
       and (t.tgtype & 2) <> 0          -- BEFORE
       and (t.tgtype & 4) <> 0          -- INSERT
       and t.tgenabled = 'O'            -- enabled, not disabled or replica-only
       and fn.nspname = 'public'
       and p.proname = 'orders_insert_guard'
       and p.prosrc like '%NEW.paid %'
       and p.prosrc like '%NEW.paid_at%'
       and p.prosrc like '%NEW.paid_via%'
       and p.prosrc like '%NEW.payment_ref%'
       and p.prosrc like '%NEW.payment_provider%'
       and p.prosrc like '%not in (''new'', ''abandoned'')%'
  ) into v_guard_ok;

  if not v_guard_ok then
    raise exception
      'refusing to widen the orders INSERT policy: the payment guard is not live'
      using hint =
        'public.orders needs an enabled BEFORE INSERT FOR EACH ROW trigger '
        'orders_insert_guard running public.orders_insert_guard(), which clears '
        'paid, paid_at, paid_via, payment_ref and payment_provider and clamps '
        'status. Apply supabase/security-phase-1-forward.sql first, then re-run '
        'this file. Nothing has been changed.';
  end if;
end;
$precondition$;

alter policy orders_anon_insert on public.orders to anon, authenticated;

commit;

-- Next: supabase/orders-authenticated-insert-verify.sql (read-only).
