-- ===========================================================================
--  Release an unconfirmed booking the courier says it never made
--
--  The problem (founder, 2026-11-11): Delhivery refused a booking (wallet low,
--  PIN not served). shipping-book cannot prove a Delhivery refusal means
--  "nothing was created", so the attempt stays OPEN -- correctly. But then the
--  order may only be re-sent to Delhivery, which keeps refusing, and every
--  other courier is turned away with "An earlier Delhivery booking for this
--  order was never confirmed". The order is stuck until support steps in.
--
--  The fix: before turning another courier away, shipping-book ASKS Delhivery
--  by the attempt's reference (a pure function of order + attempt number).
--  Only on Delhivery's explicit "No such waybill or Order Id found" does it
--  call this function, which closes the attempt as failed -- under the order's
--  row lock (the same one claim / resume take) and ONLY when:
--    * the attempt is still open, still without an AWB, and
--    * its claimed_at (= last sent at) is EXACTLY the value shipping-book read
--      before asking Delhivery -- so a re-send that happened meanwhile (resume
--      moves claimed_at) is never released, and
--    * it has been quiet for 10 minutes -- far past the 60 s a create may take.
--
--  read_open_attempt hands shipping-book the attempt number (for the
--  reference) and claimed_at, without it ever reading the ledger table.
--
--  Adds TWO functions. Changes no table, no row shape, no existing function.
--  RUN: Supabase Dashboard -> SQL Editor -> paste -> Run. Idempotent.
--  VERIFY afterwards: supabase/shipment-release-verify.sql (every C row PASS)
--  UNDO: supabase/shipment-release-ROLLBACK.sql (drops the function)
-- ===========================================================================

begin;

do $preflight$
begin
  if to_regclass('public.shipment_attempts') is null
     or to_regprocedure('public.resume_shipment_attempt(text,uuid,text)') is null then
    raise exception 'preflight: the shipment ledger (shipment-attempts / shipment-resume) is missing - nothing changed';
  end if;
end;
$preflight$;

-- Returns jsonb. Always has "outcome". Never contains customer data.
--
--   open          -> attempt_id, attempt_no, courier, claimed_at (exact).
--   not_open      -> it has ended, holds an AWB, or is not this order's.
create or replace function public.read_open_attempt(
  p_store_slug text,
  p_order_id   uuid,
  p_attempt_id bigint
)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  select coalesce(
    (select jsonb_build_object(
              'outcome',    'open',
              'attempt_id', sa.id,
              'attempt_no', sa.attempt_no,
              'courier',    sa.courier,
              'claimed_at', sa.claimed_at)
       from public.shipment_attempts sa
      where sa.id = p_attempt_id
        and sa.order_id = p_order_id
        and sa.store_slug = p_store_slug
        and sa.end_reason is null
        and nullif(btrim(coalesce(sa.awb, '')), '') is null),
    jsonb_build_object('outcome', 'not_open'));
$function$;

-- Returns jsonb. Always has "outcome". Never contains customer data.
--
--   released          -> attempt_id. The attempt is closed as failed; the
--                        order may be claimed again, with any courier.
--   sent_again        -> claimed_at moved since it was read: a re-send may be
--                        in flight. Nothing changed.
--   too_soon          -> sent less than 10 minutes ago. Nothing changed.
--   attempt_terminal / attempt_has_awb / attempt_not_found / order_not_found.
create or replace function public.release_unsent_attempt(
  p_store_slug   text,
  p_order_id     uuid,
  p_attempt_id   bigint,
  p_claimed_at   timestamptz,
  p_final_status text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_quiet constant interval := interval '10 minutes';
  a       record;
begin
  -- The same lock claim_shipment_attempt and resume_shipment_attempt take: a
  -- release can never interleave with a claim or a re-send for this order.
  perform 1
     from public.orders o
    where o.id = p_order_id
      and o.store_slug = p_store_slug
      for update;
  if not found then
    return jsonb_build_object('outcome', 'order_not_found');
  end if;

  select sa.id, sa.awb, sa.end_reason, sa.claimed_at
    into a
    from public.shipment_attempts sa
   where sa.id = p_attempt_id
     and sa.order_id = p_order_id
     and sa.store_slug = p_store_slug
     for update;
  if not found then
    return jsonb_build_object('outcome', 'attempt_not_found');
  end if;
  if a.end_reason is not null then
    return jsonb_build_object('outcome', 'attempt_terminal', 'end_reason', a.end_reason);
  end if;
  if nullif(btrim(coalesce(a.awb, '')), '') is not null then
    return jsonb_build_object('outcome', 'attempt_has_awb', 'awb', a.awb);
  end if;
  if a.claimed_at is null or p_claimed_at is null or a.claimed_at <> p_claimed_at then
    return jsonb_build_object('outcome', 'sent_again');
  end if;
  if a.claimed_at > now() - v_quiet then
    return jsonb_build_object(
      'outcome',  'too_soon',
      'retry_in', greatest(1, ceil(extract(epoch from (a.claimed_at + v_quiet - now())))::integer));
  end if;

  update public.shipment_attempts sa
     set end_reason   = 'failed',
         ended_at     = now(),
         final_status = left(nullif(btrim(coalesce(p_final_status, '')), ''), 200)
   where sa.id = a.id
     and sa.end_reason is null
     and sa.awb is null;

  return jsonb_build_object('outcome', 'released', 'attempt_id', a.id);
end;
$function$;

comment on function public.release_unsent_attempt(text, uuid, bigint, timestamptz, text) is
  'Closes an order''s OPEN attempt without an AWB as failed -- only when its '
  'claimed_at is unchanged since shipping-book read it and 10 minutes old. '
  'Called only after the courier said explicitly that it has no parcel under '
  'the attempt''s reference.';

-- Service role only, like the other ledger functions (revoked BY NAME first).
revoke all on function public.read_open_attempt(text, uuid, bigint)
  from public, anon, authenticated;
grant execute on function public.read_open_attempt(text, uuid, bigint)
  to service_role;
revoke all on function public.release_unsent_attempt(text, uuid, bigint, timestamptz, text)
  from public, anon, authenticated;
grant execute on function public.release_unsent_attempt(text, uuid, bigint, timestamptz, text)
  to service_role;

commit;
