-- ===========================================================================
--  Checkout for a signed-in browser  --  PROOF
--
--  Everything below runs inside one transaction that ends in ROLLBACK, so no
--  row survives it. It is the only way to show the two things that matter,
--  because both depend on RLS and on a trigger that only runs during a real
--  INSERT:
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
--  ---------------------------------------------------------------------------
--  WHY NO TRIGGER CAN EMIT ANYTHING FOR THESE ROWS
--  ---------------------------------------------------------------------------
--
--  ROLLBACK only promises the rows do not persist. Triggers still FIRE while
--  they exist, and one of them can make an outbound HTTP call, so each of the
--  four triggers that fire on an orders INSERT is accounted for here. The
--  transaction re-checks that list before inserting anything and aborts if it
--  has changed, so this reasoning cannot go stale.
--
--  orders_insert_guard        BEFORE, and the thing being proved. It only
--                             assigns to NEW. No table is read or written.
--
--  orders_payment_automation  BEFORE. Calls public.shipment_outcome_of, which
--                             is IMMUTABLE and a pure CASE over two strings.
--                             For status 'new' with no shipment_status it
--                             returns null, so the trigger returns NEW at once.
--                             It only ever assigns to NEW.
--
--  trg_decrement_stock        AFTER. Returns immediately when items is not a
--                             non-empty array; these rows carry '[]'. Even if
--                             it ran, it updates public.stores WHERE slug =
--                             '__proof__', which matches no store, and the
--                             update would roll back with everything else.
--
--  trg_meta_capi              AFTER, and the only one that can reach outside.
--                             It sends a Purchase event to Meta. Three
--                             independent reasons it cannot here:
--
--      (a) it returns at `coalesce(NEW.total, 0) <= 0`, and these rows carry
--          total 0 -- which is why the amounts below are zero;
--      (b) even past that, it posts only when the row looks paid or shipped
--          (paid is true, or status in confirmed/dispatched/delivered).
--          orders_insert_guard has already forced paid = false and status =
--          'new', so that condition is false by construction;
--      (c) even if it posted, net.http_post does not make the call. It runs
--          `insert into net.http_request_queue (...) returning id` -- a plain
--          table -- and a background worker sends what it finds committed.
--          The ROLLBACK removes the queued row, so nothing is ever sent.
--
--  The rows use store_slug '__proof__', which belongs to no store (orders has
--  no foreign key to stores), so even a mistaken commit would be invisible to
--  every merchant dashboard. They are rolled back regardless.
--
--  RUN: Supabase Dashboard -> SQL Editor -> paste -> Run.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 0. Refuse to insert anything if the trigger set is not the one reasoned
--    about above. A new INSERT trigger on orders may have side effects nobody
--    here has checked.
-- ---------------------------------------------------------------------------
do $preflight$
declare
  v_found text;
  c_expected constant text :=
    'orders_insert_guard, orders_payment_automation, trg_decrement_stock, trg_meta_capi';
begin
  select coalesce(string_agg(t.tgname, ', ' order by t.tgname), '(none)')
    into v_found
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname = 'orders'
     and not t.tgisinternal
     and (t.tgtype & 4) <> 0          -- fires on INSERT
     and t.tgenabled <> 'D';          -- and is not disabled

  if v_found <> c_expected then
    raise exception
      'refusing to run: the INSERT triggers on public.orders have changed'
      using hint = 'expected: ' || c_expected || ' / found: ' || v_found ||
        '. Re-check what each new trigger does on INSERT before running this '
        'proof -- the safety argument in the header covers the expected set only.';
  end if;
end;
$preflight$;

-- ---------------------------------------------------------------------------
-- 1. As a signed-OUT customer (role anon). This is how almost every real
--    order arrives, and it worked before the fix too.
--    Everything a forged request would claim is set deliberately: paid, a
--    payment reference, a provider, a paid_at, and a status that would skip
--    the seller entirely. Amounts are zero on purpose (see (a) above).
-- ---------------------------------------------------------------------------
set local role anon;

insert into public.orders
  (id, store_slug, customer_name, customer_phone, destination, pincode,
   payment_method, items, item_count, subtotal, total, status,
   paid, paid_at, paid_via, payment_ref, payment_provider)
values
  ('00000000-0000-4000-8000-0000000000a1', '__proof__', 'proof anon', '0000000000',
   'proof', '400001', 'online', '[]'::jsonb, 0, 0, 0, 'delivered',
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
   'proof', '400001', 'online', '[]'::jsonb, 0, 0, 0, 'delivered',
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

-- Nothing was queued for Meta either, by (a) and (b) above. If you want to see
-- that rather than trust it, this reads 0 both before and after:
select count(*) as queued_http_requests
  from net.http_request_queue
 where body::text like '%00000000-0000-4000-8000-0000000000a%';

rollback;

-- Nothing above is kept. Confirm with:
--   select count(*) from public.orders where store_slug = '__proof__';   -- 0
