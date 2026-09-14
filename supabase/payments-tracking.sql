-- ===========================================================================
--  Payments section -- record WHEN and HOW an order was paid
--  PREPARED FOR REVIEW. NOT APPLIED.
--
--  WHY
--   Orders only knew paid = true/false. "COD collected per day" and "money
--   received today" need the moment the money arrived and who confirmed it.
--
--  WHAT THIS DOES (additive; nothing is removed or rewritten)
--   orders.paid_at                  when the order became paid
--   orders.paid_via                 razorpay | payment_link | seller
--   orders.payment_link_id / _url / _created_at
--                                   the Razorpay payment link sent for a COD
--                                   order (created only by the payments-link
--                                   edge function, with the service role)
--   set_order_paid                  same signature, same PIN throttle; now also
--                                   stamps paid_at and paid_via = 'seller', and
--                                   keeps an earlier Razorpay stamp if present
--
--  Existing paid orders keep paid_at = NULL: their payment time was never
--  recorded, so the Payments tab shows them under their order date.
--
--  ORDER OF OPERATIONS
--   1. Apply this.  2. Run payments-tracking-verify.sql (read-only, all PASS).
--   3. Only then deploy payments-verify and payments-link: they write paid_at,
--      paid_via and payment_link_*, which do not exist until step 1.
--   4. Deploy the website.
--
--  RUN: Supabase Dashboard -> SQL Editor -> paste all -> Run. One transaction.
--  Re-running is safe.
-- ===========================================================================

begin;

alter table public.orders add column if not exists paid_at                 timestamptz;
alter table public.orders add column if not exists paid_via                text;
alter table public.orders add column if not exists payment_link_id         text;
alter table public.orders add column if not exists payment_link_url        text;
alter table public.orders add column if not exists payment_link_created_at timestamptz;

alter table public.orders drop constraint if exists orders_paid_via_known;
alter table public.orders add constraint orders_paid_via_known
  check (paid_via is null or paid_via in ('razorpay', 'payment_link', 'seller'));

comment on column public.orders.paid_at  is 'When the order became paid. NULL for orders paid before 2026-09-15 (time never recorded) and for unpaid orders.';
comment on column public.orders.paid_via is 'razorpay = checkout payment verified; payment_link = Razorpay link confirmed; seller = marked paid in Manage.';

-- Same body as pin-bypass-closure-forward.sql, plus the two stamps.
create or replace function public.set_order_paid(
  p_slug text, p_hashed_pin text, p_order_id uuid, p_paid boolean)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
begin
  if public.verify_store_pin(p_slug, p_hashed_pin) then
    update public.orders
       set paid     = p_paid,
           -- Marking paid keeps an earlier time and source (a Razorpay payment
           -- the seller taps again stays 'razorpay'); unmarking clears both.
           paid_at  = case when p_paid then coalesce(paid_at, now()) else null end,
           paid_via = case when p_paid then coalesce(paid_via, 'seller') else null end
     where id = p_order_id and store_slug = p_slug;
  end if;
end;
$function$;

commit;

-- Next: supabase/payments-tracking-verify.sql (read-only). Every row must PASS.
