-- Seller new-order alert: never fire for an online order that was never paid.
--
-- Checkout writes the order row BEFORE opening the payment screen, deliberately,
-- so an order can never be lost if the browser dies mid-payment (see
-- src/components/form/CustomerDetailsForm.jsx and the order-notify safety net).
-- The side effect: a customer who picks "online" and then closes the Razorpay
-- window leaves behind a row with status 'new' and paid = false.
--
-- new_orders_since drives the dashboard badge, toast and chime, and it filtered
-- on status = 'new' alone — so the seller was alerted to a payment that never
-- happened, and the order sat in the list looking exactly like a real one. With
-- live keys that risks a seller shipping goods they were never paid for.
--
-- Fix: an ONLINE order only counts once there is evidence Razorpay actually took
-- the money. Everything else (cod / upi / qr / bank, and any legacy row with a
-- blank payment_method) is unaffected and alerts exactly as before.
--
--   paid            → set by payments-verify when the signature checks out
--   payment_ref     → also required, so a captured payment whose signature could
--                     not be verified is never silenced. Belt and braces: today
--                     all four connected stores have a key AND secret on file, so
--                     verification succeeds and paid is set.
--
-- Verified against live data before applying: of royalfoodsmasale's 10 online
-- orders, 9 carry paid + payment_ref (real payments are unaffected); exactly one
-- ghost row platform-wide stops alerting.

create or replace function public.new_orders_since(
  p_slug       text,
  p_hashed_pin text,
  p_since      timestamp with time zone
)
returns table(
  new_count    integer,
  latest_name  text,
  latest_total numeric,
  latest_at    timestamp with time zone
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select
    count(*)::int                                              as new_count,
    (array_agg(o.customer_name order by o.created_at desc))[1] as latest_name,
    (array_agg(o.total        order by o.created_at desc))[1]  as latest_total,
    max(o.created_at)                                          as latest_at
  from public.orders o
  where o.store_slug = p_slug
    and exists (select 1 from public.stores s where s.slug = p_slug and s.pin = p_hashed_pin)
    and o.status = 'new'
    and o.created_at > p_since
    and (
      coalesce(o.payment_method, '') <> 'online'   -- cod / upi / qr / bank: unchanged
      or o.paid                                     -- verified payment
      or o.payment_ref is not null                  -- captured but unverified
    );
$function$;
