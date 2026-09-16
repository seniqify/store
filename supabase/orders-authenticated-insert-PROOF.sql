-- ===========================================================================
--  Checkout for a signed-in browser  --  PROOF (writes nothing)
--
--  Everything below runs inside one transaction that ends in ROLLBACK, so no
--  row survives it. It is safe on production, and it is the only way to show
--  the two things that matter, because both depend on RLS and on a trigger
--  that only runs during a real INSERT:
--
--    1. anon CAN insert an order        (unchanged by the fix)
--    2. authenticated CAN insert one    (what the fix restores)
--    3. neither can claim payment       (public.orders_insert_guard strips it)
--
--  RUN IT TWICE:
--    * BEFORE applying the forward file, it stops at step 2 with
--        new row violates row-level security policy for table "orders"
--      which is the production incident, reproduced on demand. The transaction
--      rolls back on the error; nothing is written.
--    * AFTER applying it, both inserts succeed and the last SELECT reports
--      PASS on every row.
--
--  The rows use store_slug '__proof__', which belongs to no store (orders has
--  no foreign key to stores), so even a mistaken commit would be invisible to
--  every merchant dashboard. They are rolled back regardless.
--
--  RUN: Supabase Dashboard -> SQL Editor -> paste -> Run.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. As a signed-OUT customer (role anon). This is how almost every real
--    order arrives, and it worked before the fix too.
--    Everything a forged request would claim is set deliberately: paid, a
--    payment reference, a provider, a paid_at, and a status that would skip
--    the seller entirely.
-- ---------------------------------------------------------------------------
set local role anon;

insert into public.orders
  (id, store_slug, customer_name, customer_phone, destination, pincode,
   payment_method, items, item_count, subtotal, total, status,
   paid, paid_at, paid_via, payment_ref, payment_provider)
values
  ('00000000-0000-4000-8000-0000000000a1', '__proof__', 'proof anon', '0000000000',
   'proof', '400001', 'online', '[]'::jsonb, 0, 100, 100, 'delivered',
   true, now(), 'razorpay', 'pay_forged_anon', 'razorpay');

-- ---------------------------------------------------------------------------
-- 2. As a signed-IN customer (role authenticated). BEFORE the fix this line
--    raises: new row violates row-level security policy for table "orders".
-- ---------------------------------------------------------------------------
set local role authenticated;

insert into public.orders
  (id, store_slug, customer_name, customer_phone, destination, pincode,
   payment_method, items, item_count, subtotal, total, status,
   paid, paid_at, paid_via, payment_ref, payment_provider)
values
  ('00000000-0000-4000-8000-0000000000a2', '__proof__', 'proof authed', '0000000000',
   'proof', '400001', 'online', '[]'::jsonb, 0, 100, 100, 'delivered',
   true, now(), 'razorpay', 'pay_forged_authed', 'razorpay');

-- ---------------------------------------------------------------------------
-- 3. Read the rows back as the owner and check what actually landed.
--    Expect two rows, both PASS: every payment column emptied and the status
--    clamped to 'new', even though both inserts claimed otherwise.
-- ---------------------------------------------------------------------------
reset role;

select
  o.customer_name as inserted_as,
  o.status, o.paid, o.paid_at, o.paid_via, o.payment_ref, o.payment_provider,
  case when o.paid = false
        and o.paid_at is null
        and o.paid_via is null
        and o.payment_ref is null
        and o.payment_provider is null
        and o.status = 'new'
       then 'PASS - the payment claim was stripped'
       else 'FAIL - a payment claim survived the insert' end as guard_result
from public.orders o
where o.store_slug = '__proof__'
order by o.id;

-- Expect: 2 rows. One row means only one role could insert.

rollback;

-- Nothing above is kept. Confirm with:
--   select count(*) from public.orders where store_slug = '__proof__';   -- 0
