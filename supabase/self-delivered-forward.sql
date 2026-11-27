-- ===========================================================================
--  PocketLink: "Deliver it yourself" marks the order delivered  --  FORWARD
--
--  The founder (2026-11-27): "Deliver it yourself" opened WhatsApp, which was
--  annoying; it should mark the order delivered straight away and note what
--  the delivery cost. mark_self_delivered does that for an order the shop
--  (or its delivery boy) delivered:
--    * owner PIN checked;
--    * only an order of this shop, not cancelled, not with a courier (a
--      courier parcel is marked delivered by the courier's own status);
--    * status 'delivered' (the existing order triggers then mark a COD order
--      paid, exactly as the old "Mark delivered" did);
--    * shipping_cost = what the delivery cost the shop (delivery boy, petrol),
--      so Stats / profit count it like a courier charge. Left empty = unchanged.
--  Order: this -> self-delivered-verify.sql. Undo: self-delivered-ROLLBACK.sql.
--  Safe to run twice.
-- ===========================================================================

begin;

create or replace function public.mark_self_delivered(p_slug text, p_hashed_pin text, p_order_id uuid, p_cost numeric)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $fn$
declare
  o record;
begin
  if not coalesce(public.verify_store_pin(p_slug, p_hashed_pin), false) then
    raise exception 'wrong PIN' using errcode = '42501';
  end if;
  if p_cost is not null and (p_cost < 0 or p_cost > 100000) then
    raise exception 'delivery cost: 0 to 1,00,000' using errcode = '22023';
  end if;
  select * into o from public.orders x where x.id = p_order_id and x.store_slug = p_slug for update;
  if not found then
    raise exception 'order not found' using errcode = 'P0002';
  end if;
  if lower(coalesce(o.status, '')) in ('cancelled', 'abandoned') then
    raise exception 'This order is cancelled.' using errcode = 'P0001';
  end if;
  if o.awb is not null then
    raise exception 'This order is with a courier: it turns delivered when the courier delivers it.' using errcode = 'P0001';
  end if;
  update public.orders
     set status = 'delivered',
         shipping_cost = case when p_cost is null then shipping_cost else round(p_cost, 2) end
   where id = p_order_id;
  select * into o from public.orders x where x.id = p_order_id;
  return jsonb_build_object('status', o.status, 'shipping_cost', o.shipping_cost, 'paid', o.paid);
end;
$fn$;

revoke all on function public.mark_self_delivered(text, text, uuid, numeric) from public, anon, authenticated;
grant execute on function public.mark_self_delivered(text, text, uuid, numeric) to anon, authenticated, service_role;

commit;
