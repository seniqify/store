-- Per-order payment status (Paid / Unpaid).  Applied to production 2026-07-23.
--
-- The owner marks an order paid once they've received the money (cash collected
-- for COD, or a UPI/bank credit for prepaid). Only the PIN-gated owner can set
-- it; reads flow through get_store_orders (RETURNS SETOF orders → the new column
-- is included automatically, no read-RPC change needed). The `paid` column has
-- no public policy, so it's only touched via the SECURITY DEFINER RPC below —
-- consistent with update_order_status.

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS paid boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.set_order_paid(p_slug text, p_hashed_pin text, p_order_id uuid, p_paid boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
begin
  if exists (select 1 from public.stores s where s.slug = p_slug and s.pin = p_hashed_pin) then
    update public.orders set paid = p_paid where id = p_order_id and store_slug = p_slug;
  end if;
end;
$function$;

GRANT EXECUTE ON FUNCTION public.set_order_paid(text, text, uuid, boolean) TO anon, authenticated;
