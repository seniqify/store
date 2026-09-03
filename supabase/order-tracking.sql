-- Buyer order tracking — Phase 3 of the confirm/track flow.
--
-- The buyer's WhatsApp confirm message carries /confirm/<confirm_token>. That page
-- used to be a dead end after one tap; it now doubles as the order's permanent
-- home at /order/<confirm_token>. This RPC is what that page reads.
--
-- Design notes:
--  * READ-ONLY. Confirmation still goes through confirm_order_by_token(), which
--    is unchanged — a page view must never mutate the order.
--  * The token IS the credential (there is no login), and a buyer may forward
--    their WhatsApp message to anyone. So this returns only what the buyer
--    already knows: their own items, total, status and delivery city.
--    Deliberately withheld: customer_phone, pincode, notes, fbp/fbc/client_ua.
--  * orders.destination is the COMPOSED address ("<street>, <City> - <pincode>"),
--    NOT a city — composeDeliveryAddress() in CustomerDetailsForm.jsx builds it.
--    order_city() peels the city back out, and returns NULL when it cannot do so
--    confidently (customer ran the whole address into one box). Returning the raw
--    column would put a buyer's street address on a page anyone holding a
--    forwarded WhatsApp link can open.
--  * Store branding comes back too (name, logo, colour, WhatsApp) so the page
--    looks like the shop the buyer ordered from, not a generic PocketLink page.
--  * SECURITY DEFINER because RLS lets customers INSERT an order but never
--    SELECT it back — see saveOrder() in src/utils/orderService.js.

create or replace function public.order_city(p_destination text)
returns text
language plpgsql
immutable
as $$
declare
  v text;
begin
  v := trim(coalesce(p_destination, ''));
  if v = '' then return null; end if;
  if v like '%Pickup%' then return 'Pickup from shop'; end if;

  -- Drop a trailing pincode ("… - 411051" or "…, 586203"), then keep only the
  -- segment after the last comma — that is where the city lands.
  v := regexp_replace(v, '\s*[-,]\s*[0-9]{6}\s*$', '');
  v := trim(regexp_replace(v, '^.*,\s*', ''));

  -- Guard: a real city name is short. Anything long, numeric, or more than three
  -- words means the customer typed the whole address into one field — show
  -- nothing rather than leak it.
  if v = '' or v ~ '^[0-9]*$' or length(v) > 30
     or coalesce(array_length(regexp_split_to_array(v, '\s+'), 1), 0) > 3 then
    return null;
  end if;
  return v;
end;
$$;

create or replace function public.get_order_by_token(p_token uuid)
returns json
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  o   public.orders%rowtype;
  cfg jsonb;
begin
  select * into o from public.orders where confirm_token = p_token limit 1;
  if not found then
    return json_build_object('ok', false, 'reason', 'invalid');
  end if;

  select config into cfg from public.stores where slug = o.store_slug;

  return json_build_object(
    'ok', true,
    'store', json_build_object(
      'name',     coalesce(cfg->>'businessName', o.store_slug),
      'slug',     o.store_slug,
      'logo',     cfg->>'logo',
      'color',    coalesce(cfg->'theme'->>'primary', '#0d9488'),
      'whatsapp', cfg->>'whatsappNumber'
    ),
    'order', json_build_object(
      -- Short human reference — the same first-5-of-id the buyer already saw on
      -- the order-placed screen, so the two agree.
      'ref',            upper(substring(replace(o.id::text, '-', '') for 5)),
      'status',         o.status,
      'shipmentStatus', o.shipment_status,
      'awb',            o.awb,
      'courier',        o.courier,
      'items',          o.items,
      'itemCount',      o.item_count,
      'total',          o.total,
      'paymentMethod',  o.payment_method,
      'paid',           o.paid,
      'city',           public.order_city(o.destination),  -- never street or pincode
      'placedAt',       o.created_at,
      'confirmedAt',    o.customer_confirmed_at
    )
  );
end;
$$;

grant execute on function public.order_city(text)          to anon, authenticated;
grant execute on function public.get_order_by_token(uuid)  to anon, authenticated;
