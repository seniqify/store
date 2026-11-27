-- ===========================================================================
--  PocketLink India Post (Speed Post) sheet  --  FORWARD
--
--  India Post's office did not take up the API, so shops book Speed Post by
--  uploading India Post's bulk-booking Excel on the India Post portal. The
--  sheet is made in the shop's browser (Delivery -> Ship). This adds what the
--  database must do afterwards:
--    * indiapost_mark_shipped: the shop marks the parcels it uploaded as
--      shipped. Each order gets courier 'indiapost', its India Post barcode as
--      the AWB (tracking number) and shipment status 'In Transit', so Track,
--      COD money and the automatic WhatsApp "shipped" message work as for any
--      courier. Owner PIN checked. A barcode must be well formed (India Post
--      check digit) and never used by another order; an order already booked,
--      cancelled or delivered is skipped.
--    * indiapost_set_state: without India Post's API PocketLink cannot see the
--      parcel, so the shop marks it Delivered or Came back (from In Transit
--      only). The existing order triggers then do the rest (a delivered COD
--      order becomes paid, as for every courier).
--    * ship_update_claim: the WhatsApp message names "India Post Speed Post"
--      (it said Delhivery for any courier but Shadowfax).
--  Nothing here talks to India Post. Status syncing already skips this courier
--  (it asks Delhivery and Shadowfax only about their own parcels).
--  Order: this -> indiapost-sheet-verify.sql. Undo: indiapost-sheet-ROLLBACK.sql.
--  Safe to run twice.
-- ===========================================================================

begin;

-- India Post barcode: 2 letters, 8-digit serial, a check digit, "IN".
-- Check digit: serial digits x 8 6 4 2 3 5 9 7, sum mod 11 = r;
-- r = 0 -> 5, r = 1 -> 0, else 11 - r.
create or replace function public.indiapost_barcode_ok(p text)
returns boolean
language plpgsql
immutable
set search_path = public, pg_temp
as $fn$
declare
  m text[];
  w integer[] := array[8, 6, 4, 2, 3, 5, 9, 7];
  s integer := 0;
  r integer;
  i integer;
begin
  m := regexp_match(upper(coalesce(p, '')), '^([A-Z]{2})([0-9]{8})([0-9])IN$');
  if m is null then
    return false;
  end if;
  for i in 1..8 loop
    s := s + substr(m[2], i, 1)::integer * w[i];
  end loop;
  r := s % 11;
  return (case when r = 0 then 5 when r = 1 then 0 else 11 - r end) = m[3]::integer;
end;
$fn$;

create index if not exists orders_indiapost_awb_idx on public.orders (awb) where courier = 'indiapost';

create or replace function public.indiapost_mark_shipped(p_slug text, p_hashed_pin text, p_items jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $fn$
declare
  it     jsonb;
  v_id   uuid;
  v_bc   text;
  o      record;
  v_done integer := 0;
  v_skip jsonb := '[]'::jsonb;
begin
  if not coalesce(public.verify_store_pin(p_slug, p_hashed_pin), false) then
    raise exception 'wrong PIN' using errcode = '42501';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 300 then
    raise exception 'nothing to mark' using errcode = '22023';
  end if;
  for it in select x from jsonb_array_elements(p_items) x loop
    if coalesce(it->>'order_id', '') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
      v_skip := v_skip || jsonb_build_object('order_id', it->>'order_id', 'reason', 'bad order');
      continue;
    end if;
    v_id := (it->>'order_id')::uuid;
    v_bc := upper(regexp_replace(coalesce(it->>'barcode', ''), '\s', '', 'g'));
    if not public.indiapost_barcode_ok(v_bc) then
      v_skip := v_skip || jsonb_build_object('order_id', v_id, 'reason', 'barcode');
      continue;
    end if;
    select * into o from public.orders x where x.id = v_id and x.store_slug = p_slug for update;
    if not found then
      v_skip := v_skip || jsonb_build_object('order_id', v_id, 'reason', 'not found');
      continue;
    end if;
    if lower(coalesce(o.status, '')) in ('cancelled', 'abandoned', 'delivered') then
      v_skip := v_skip || jsonb_build_object('order_id', v_id, 'reason', 'not to ship');
      continue;
    end if;
    if o.awb is not null then
      v_skip := v_skip || jsonb_build_object('order_id', v_id, 'reason', case when o.awb = v_bc then 'already marked' else 'already booked' end);
      continue;
    end if;
    if exists (select 1 from public.orders x where x.courier = 'indiapost' and x.awb = v_bc and x.id <> v_id) then
      v_skip := v_skip || jsonb_build_object('order_id', v_id, 'reason', 'barcode used');
      continue;
    end if;
    update public.orders set awb = v_bc, courier = 'indiapost', shipment_status = 'In Transit' where id = v_id;
    v_done := v_done + 1;
  end loop;
  return jsonb_build_object('shipped', v_done, 'skipped', v_skip);
end;
$fn$;

create or replace function public.indiapost_set_state(p_slug text, p_hashed_pin text, p_order_id uuid, p_state text)
returns text
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $fn$
declare
  o     record;
  v_new text;
begin
  if not coalesce(public.verify_store_pin(p_slug, p_hashed_pin), false) then
    raise exception 'wrong PIN' using errcode = '42501';
  end if;
  v_new := case p_state when 'delivered' then 'Delivered' when 'returned' then 'RTO Delivered' else null end;
  if v_new is null then
    raise exception 'delivered or returned' using errcode = '22023';
  end if;
  select * into o from public.orders x where x.id = p_order_id and x.store_slug = p_slug for update;
  if not found or lower(coalesce(o.courier, '')) <> 'indiapost' then
    raise exception 'not an India Post parcel of this shop' using errcode = 'P0002';
  end if;
  if o.shipment_status = v_new then
    return v_new;
  end if;
  if o.shipment_status is distinct from 'In Transit' then
    raise exception 'This parcel is already marked %.', lower(coalesce(o.shipment_status, 'done')) using errcode = 'P0001';
  end if;
  update public.orders set shipment_status = v_new where id = p_order_id;
  return v_new;
end;
$fn$;

-- The WhatsApp shipping message: courier name for India Post.
create or replace function public.ship_update_claim(p_order_id uuid, p_event text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
declare
  a        public.orders%rowtype;
  s        public.store_message_settings%rowtype;
  v_id     uuid := gen_random_uuid();
  v_ref    text;
  v_debit  jsonb;
  v_store  text;
  v_name   text;
  v_link   text;
  v_amount text;
  v_values jsonb;
begin
  perform pg_advisory_xact_lock(hashtext('ship_update:' || coalesce(p_order_id::text, '')));

  select * into a from public.orders o where o.id = p_order_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_order');
  end if;
  select * into s from public.store_message_settings m where m.store_slug = a.store_slug;
  if not found or not s.ship_updates or s.ship_updates_since is null or not (p_event = any (s.ship_events)) then
    return jsonb_build_object('ok', false, 'reason', 'off');
  end if;
  if a.created_at < s.ship_updates_since then
    return jsonb_build_object('ok', false, 'reason', 'before_on');
  end if;
  if a.awb is null or lower(coalesce(a.status, '')) in ('cancelled', 'abandoned') then
    return jsonb_build_object('ok', false, 'reason', 'not_shipping');
  end if;
  if public.ship_update_event(a.shipment_status) is distinct from p_event then
    return jsonb_build_object('ok', false, 'reason', 'moved_on');
  end if;
  if coalesce(a.customer_phone, '') !~ '^[6-9][0-9]{9}$' then
    return jsonb_build_object('ok', false, 'reason', 'bad_phone');
  end if;
  if a.confirm_token is null then
    return jsonb_build_object('ok', false, 'reason', 'no_link');
  end if;
  if exists (select 1 from public.shipping_messages m where m.order_id = a.id and m.event = p_event) then
    return jsonb_build_object('ok', false, 'reason', 'already');
  end if;
  if public.whatsapp_opted_out(a.store_slug, a.customer_phone) then
    return jsonb_build_object('ok', false, 'reason', 'opted_out');
  end if;

  select coalesce(nullif(trim(st.config->>'businessName'), ''), a.store_slug)
    into v_store from public.stores st where st.slug = a.store_slug;
  v_store := left(trim(regexp_replace(coalesce(v_store, a.store_slug), '\s+', ' ', 'g')), 60);
  v_name := left(split_part(trim(regexp_replace(coalesce(a.customer_name, ''), '\s+', ' ', 'g')), ' ', 1), 40);
  v_name := coalesce(nullif(v_name, ''), 'there');
  v_link := 'order/' || a.confirm_token::text;
  v_amount := case
    when lower(coalesce(a.payment_method, '')) = 'cod' and not coalesce(a.paid, false) and coalesce(a.total, 0) > 0
      then chr(8377) || case when a.total = trunc(a.total) then trunc(a.total)::bigint::text else to_char(a.total, 'FM9999999990.00') end
    else chr(8377) || '0 (already paid)' end;

  v_values := case p_event
    when 'shipped' then jsonb_build_object('1', v_name, '2', v_store,
                          '3', case lower(coalesce(a.courier, '')) when 'shadowfax' then 'Shadowfax' when 'indiapost' then 'India Post Speed Post' else 'Delhivery' end,
                          '4', left(a.awb, 40), '5', v_link)
    when 'ofd'     then jsonb_build_object('1', v_name, '2', v_store, '3', v_amount, '4', v_link)
    else                jsonb_build_object('1', v_name, '2', v_store, '3', v_link)
  end;

  v_ref := 'ship_update:' || v_id;
  v_debit := public.wallet_debit(a.store_slug, public.ship_update_price_paise(), v_ref,
                                 left('Shipping update ' || chr(183) || ' ' || p_event || ' ' || chr(183) || ' ' || v_name, 60));
  if coalesce((v_debit->>'ok')::boolean, false) is not true then
    return jsonb_build_object('ok', false, 'reason', 'no_balance');
  end if;

  insert into public.shipping_messages (id, store_slug, order_id, event, status, debit_ref)
  values (v_id, a.store_slug, a.id, p_event, 'sending', v_ref);

  return jsonb_build_object('ok', true, 'message_id', v_id, 'event', p_event,
                            'receiver', '91' || a.customer_phone, 'values', v_values);
end;
$function$;

revoke all on function public.indiapost_barcode_ok(text) from public, anon, authenticated;
revoke all on function public.indiapost_mark_shipped(text, text, jsonb) from public, anon, authenticated;
revoke all on function public.indiapost_set_state(text, text, uuid, text) from public, anon, authenticated;
revoke all on function public.ship_update_claim(uuid, text) from public, anon, authenticated;
grant execute on function public.indiapost_mark_shipped(text, text, jsonb) to anon, authenticated, service_role;
grant execute on function public.indiapost_set_state(text, text, uuid, text) to anon, authenticated, service_role;
grant execute on function public.ship_update_claim(uuid, text) to service_role;

commit;
