-- ===========================================================================
--  PocketLink India Post sheet  --  ROLLBACK
--  Removes the two actions and the barcode check, and puts the WhatsApp
--  message function back exactly as delivery-tools-forward.sql made it.
--  Orders already marked keep courier 'indiapost' and their barcode: Track
--  still lists them (as Delhivery-coloured rows until the app is rolled back).
-- ===========================================================================
begin;

drop function if exists public.indiapost_set_state(text, text, uuid, text);
drop function if exists public.indiapost_mark_shipped(text, text, jsonb);
drop function if exists public.indiapost_barcode_ok(text);
drop index if exists public.orders_indiapost_awb_idx;

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
                          '3', case when lower(coalesce(a.courier, '')) = 'shadowfax' then 'Shadowfax' else 'Delhivery' end,
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

revoke all on function public.ship_update_claim(uuid, text) from public, anon, authenticated;
grant execute on function public.ship_update_claim(uuid, text) to service_role;

commit;
