-- ===========================================================================
--  Resume an unconfirmed booking  --  so an order is never locked for good
--
--  The problem (founder, 2026-10-05): when a courier's answer to a booking is
--  not a clear yes or a proven no -- e.g. Shadowfax refusing for low wallet
--  balance in a shape we have not proven -- the attempt stays OPEN, and every
--  later "Book Shipment" is refused with "A booking for this order is already
--  in progress ...". Nothing in the app could ever clear it.
--
--  The fix: the same attempt may be SENT AGAIN, with the SAME courier
--  reference. That reference is a pure function of (order, attempt number)
--  (shipping-book: shadowfaxReference / delhiveryReference), and both couriers
--  refuse a reference they have seen. So re-sending can never make a second
--  parcel:
--    * the first send made nothing  -> the courier books it now;
--    * the first send made a parcel -> the courier answers "already created"
--      (Shadowfax names the AWB, which shipping-book then attaches).
--
--  This function only hands the open attempt back, under the order's row lock
--  (the same serialization point as claim_shipment_attempt), and only when it
--  has been quiet for 2 minutes. claimed_at becomes "last sent at", so two
--  presses can never both re-send, and a send that may still be in flight is
--  never raced (shipping-book gives the courier at most 60 seconds).
--
--  Adds ONE function. Changes no table, no row shape, no existing function.
--  RUN: Supabase Dashboard -> SQL Editor -> paste -> Run. Idempotent.
--  VERIFY afterwards: supabase/shipment-resume-verify.sql (every row PASS)
--  UNDO: supabase/shipment-resume-ROLLBACK.sql (drops the function)
-- ===========================================================================

begin;

do $preflight$
begin
  if to_regclass('public.shipment_attempts') is null
     or to_regprocedure('public.claim_shipment_attempt(text,uuid,text)') is null then
    raise exception 'preflight: the shipment ledger (shipment-attempts / shipment-claim) is missing - nothing changed';
  end if;
end;
$preflight$;

-- Returns jsonb. Always has "outcome". Never contains customer data.
--
--   resumed            -> attempt_id, attempt_no, courier. GO: send this
--                         attempt's reference again.
--   too_soon           -> sent less than 2 minutes ago; retry_in (seconds).
--   other_courier      -> the open attempt is with another courier; courier.
--   nothing_open       -> no open attempt (it just finished: re-read the order).
--   open_with_awb      -> the open attempt holds an AWB: a live parcel.
--   already_booked     -> orders.awb is set.
--   order_not_bookable -> cancelled or abandoned.
--   order_not_found / invalid_courier.
create or replace function public.resume_shipment_attempt(
  p_store_slug text,
  p_order_id   uuid,
  p_courier    text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_courier   text;
  v_order_awb text;
  v_status    text;
  v_quiet     constant interval := interval '2 minutes';
  a           record;
begin
  v_courier := nullif(btrim(lower(coalesce(p_courier, ''))), '');
  if v_courier is null or v_courier not in ('delhivery', 'shadowfax') then
    return jsonb_build_object('outcome', 'invalid_courier');
  end if;

  -- The same lock claim_shipment_attempt takes: a resume and a claim (or two
  -- resumes) for one order are serialized here.
  select o.awb, o.status
    into v_order_awb, v_status
    from public.orders o
   where o.id = p_order_id
     and o.store_slug = p_store_slug
     for update;
  if not found then
    return jsonb_build_object('outcome', 'order_not_found');
  end if;
  if coalesce(v_status, '') in ('cancelled', 'abandoned') then
    return jsonb_build_object('outcome', 'order_not_bookable', 'status', v_status);
  end if;
  if nullif(btrim(coalesce(v_order_awb, '')), '') is not null then
    return jsonb_build_object('outcome', 'already_booked', 'awb', v_order_awb);
  end if;

  select sa.id, sa.attempt_no, sa.courier, sa.awb, sa.claimed_at
    into a
    from public.shipment_attempts sa
   where sa.order_id = p_order_id
     and sa.store_slug = p_store_slug
     and sa.end_reason is null;
  if not found then
    return jsonb_build_object('outcome', 'nothing_open');
  end if;
  if nullif(btrim(coalesce(a.awb, '')), '') is not null then
    return jsonb_build_object('outcome', 'open_with_awb', 'attempt_id', a.id, 'awb', a.awb);
  end if;
  if a.courier <> v_courier then
    return jsonb_build_object('outcome', 'other_courier', 'attempt_id', a.id, 'courier', a.courier);
  end if;
  if a.claimed_at is not null and a.claimed_at > now() - v_quiet then
    return jsonb_build_object(
      'outcome',  'too_soon',
      'attempt_id', a.id,
      'retry_in', greatest(1, ceil(extract(epoch from (a.claimed_at + v_quiet - now())))::integer));
  end if;

  update public.shipment_attempts
     set claimed_at = now()
   where id = a.id;

  return jsonb_build_object(
    'outcome',    'resumed',
    'attempt_id', a.id,
    'attempt_no', a.attempt_no,
    'courier',    a.courier);
end;
$function$;

comment on function public.resume_shipment_attempt(text, uuid, text) is
  'Hands back an order''s OPEN attempt that has no AWB, after 2 quiet minutes, '
  'so shipping-book can send the SAME courier reference again. The courier''s '
  'duplicate-reference check makes a second parcel impossible. Sets claimed_at '
  '(= last sent at); changes nothing else.';

-- Service role only, like the other ledger functions (revoked BY NAME first).
revoke all on function public.resume_shipment_attempt(text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.resume_shipment_attempt(text, uuid, text)
  to service_role;

commit;
