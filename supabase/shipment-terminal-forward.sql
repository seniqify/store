-- ===========================================================================
--  Terminal shipment transitions -- PR B2A.1 (PR1 of 2)
--  PREPARED FOR REVIEW. NOT APPLIED.
--
--  WHY
--   B1 gave every booking a ledger row. B2A gave the booking path a claim, a
--   finalize and a definitive-failure close. Two terminal transitions are
--   still missing, and B2B cannot ship without them:
--
--   1. A CONFIRMED courier cancellation. shipping-ops clears orders.awb today
--      and never touches the ledger, so the attempt stays OPEN holding its
--      AWB. Under B2B the next claim would read that as open_with_awb and
--      refuse forever -- a working cancel-then-rebook flow would become a
--      permanent lockout.
--
--   2. A SUPERSEDED booking. B2B creates AWB-X, finalize refuses with
--      order_awb_conflict because another shipment won, AWB-X is cancelled at
--      the courier -- and nothing can record that. 'superseded' is already in
--      B1's vocabulary; no RPC could write it.
--
--  WHAT THIS DOES
--   public.cancel_current_shipment       close the current attempt as
--                                        'cancelled' AND clear the order's
--                                        shipment pointer, in one transaction
--   public.supersede_shipment_attempt    record a losing AWB and close the
--                                        attempt as 'superseded'
--
--  WHAT THIS DOES NOT DO
--   NOTHING CALLS THESE YET. No edge function is touched in this PR;
--   shipping-ops still cancels exactly the way it does today and shipping-book
--   still books the way it does today. Applying this changes no runtime
--   behaviour at all. PR2 wires shipping-ops up, and ships separately.
--
--   No table is created, altered or dropped. No index, trigger, policy or
--   grant on public.shipment_attempts changes. B2A's three RPCs are untouched.
--
--  THE TRUST BOUNDARY -- READ THIS BEFORE CHANGING ANYTHING
--   The database has no network. It CANNOT prove a courier cancelled anything.
--   Calling one of these functions IS the service-role caller's assertion that
--   the provider explicitly confirmed the cancellation. That assertion is the
--   one fact trusted here, and it is deliberately not passed as a boolean
--   argument -- a "cancelled => true" parameter would look like evidence while
--   being nothing more than the same assertion, badly disguised.
--
--   Everything else is proved here: store, order, courier, AWB, the attempt's
--   relationship to the order, its open/terminal state, and the order's
--   current pointer. A caller that is wrong about any of those is refused.
--
--   PR2 MUST tighten shipping-ops' success detection before it calls
--   cancel_current_shipment. Today it accepts /cancel/i against the provider
--   message, so "Order cannot be cancelled" reads as success. See the note at
--   the foot of this file.
--
--  THE GUARD THE PRODUCTION DATA ASKED FOR
--   171 orders carry an AWB. Only 49 have an OPEN attempt; 122 are terminal --
--   88 delivered, 33 returned, 1 lost. The Orders screen offers Cancel on all
--   171, because it gates on awb alone. So the common case for a cancel click
--   on a delivered parcel must be a REFUSAL that leaves the pointer intact,
--   not a tolerant fallback that clears it. Clearing awb from a delivered
--   order would destroy its tracking link and its cost attribution in
--   Stats -> Profit. See shipment_already_terminal below.
--
--  ORDER OF OPERATIONS
--   1. Apply this. 2. shipment-terminal-verify.sql (read-only, all PASS).
--   Then, separately, PR2 (shipping-ops) and only then B2B.
--
--  RUN: Supabase Dashboard -> SQL Editor -> paste all -> Run. One transaction.
--  Re-running is safe: every function is create or replace.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. CANCEL -- the current shipment is gone, pointer and ledger together
-- ---------------------------------------------------------------------------
-- Called only after the provider has explicitly confirmed the cancellation of
-- p_awb. Performs BOTH halves of what must happen next, in one transaction:
-- the attempt becomes terminal and the order stops pointing at the parcel.
--
-- Splitting those two is what produces the states this whole programme exists
-- to remove, so they are not splittable here.
--
-- THE ATTEMPT IS LOCATED BY (order, store, AWB) -- NOT by "the open one".
-- Searching for an open attempt and reading "none" as "no attempt" would map
-- all 122 delivered/returned/lost rows onto the same answer as a genuinely
-- missing ledger row, and those need opposite handling.
--
--   cancelled                    -> attempt closed, orders.awb cleared
--   cancelled_pointer_was_clear  -> attempt closed; the order already had no
--                                   AWB. See the note at that branch.
--   already_cancelled            -> this attempt is already closed as
--                                   'cancelled' with this AWB. No writes.
--   shipment_already_terminal    -> delivered / returned / lost. REFUSED, and
--                                   the pointer is left completely alone.
--   attempt_state_mismatch       -> failed / superseded / unknown: none of
--                                   these can be the order's current shipment.
--   attempt_not_found            -> no attempt on this order holds this AWB.
--   courier_mismatch             -> it does, but under the other courier.
--   awb_mismatch                 -> the order points at a DIFFERENT AWB.
--   order_not_found              -> no such order in this store.
--   transition_race              -> the closing UPDATE moved no row, so the
--                                   attempt changed underneath us. The pointer
--                                   is NOT cleared. Shared with supersede.
--   invalid_awb / invalid_courier
create or replace function public.cancel_current_shipment(
  p_store_slug   text,
  p_order_id     uuid,
  p_courier      text,
  p_awb          text,
  p_final_status text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_courier   text;
  v_awb       text;
  v_order_awb text;
  v_att_id    bigint;
  v_att_cour  text;
  v_end       text;
  v_status    text;
  v_rows      integer;
begin
  v_courier := nullif(btrim(lower(coalesce(p_courier, ''))), '');
  v_awb     := nullif(btrim(coalesce(p_awb, '')), '');
  if v_awb is null then
    return jsonb_build_object('outcome', 'invalid_awb');
  end if;
  if v_courier is null or v_courier not in ('delhivery', 'shadowfax') then
    return jsonb_build_object('outcome', 'invalid_courier');
  end if;

  -- The same lock claim_shipment_attempt and finalize_shipment_attempt take,
  -- on the same row, so all four serialize against each other per order.
  select o.awb
    into v_order_awb
    from public.orders o
   where o.id = p_order_id
     and o.store_slug = p_store_slug
     for update;

  -- FOUND, not a flag: SELECT INTO assigns NULL when nothing matches.
  if not found then
    return jsonb_build_object('outcome', 'order_not_found');
  end if;
  v_order_awb := nullif(btrim(coalesce(v_order_awb, '')), '');

  -- Locate the attempt that holds THIS AWB on THIS order, whatever state it is
  -- in. shipment_attempts_courier_awb_idx makes (courier, awb) unique, so at
  -- most one row can match per courier.
  select sa.id, sa.courier, sa.end_reason
    into v_att_id, v_att_cour, v_end
    from public.shipment_attempts sa
   where sa.order_id   = p_order_id
     and sa.store_slug = p_store_slug
     and sa.courier    = v_courier
     and nullif(btrim(coalesce(sa.awb, '')), '') = v_awb;

  if v_att_id is null then
    -- Nothing under the courier the caller named. Distinguish "this order has
    -- no such AWB at all" from "it does, but the other courier carries it" --
    -- the courier is filtered in the query above precisely so a same-AWB row
    -- under the other provider cannot mask a correct match.
    if exists (
      select 1 from public.shipment_attempts sa
       where sa.order_id   = p_order_id
         and sa.store_slug = p_store_slug
         and nullif(btrim(coalesce(sa.awb, '')), '') = v_awb
    ) then
      return jsonb_build_object('outcome', 'courier_mismatch', 'courier', v_courier);
    end if;

    -- Deliberately NOT tolerated by clearing the pointer anyway. Production
    -- has zero orders in this shape (every one of the 171 AWB-bearing orders
    -- has a ledger row), so a permissive branch here would serve nobody and
    -- would quietly erase a shipment pointer on the strength of an assertion
    -- the ledger cannot corroborate.
    return jsonb_build_object('outcome', 'attempt_not_found');
  end if;

  -- ── Terminal attempts: refuse, and touch nothing ────────────────────────
  if v_end is not null then
    if v_end = 'cancelled' then
      -- Idempotent. A double-click, or a retry after the reply was lost.
      return jsonb_build_object(
        'outcome', 'already_cancelled', 'attempt_id', v_att_id, 'awb', v_awb);
    end if;

    if v_end in ('delivered', 'returned', 'lost') then
      -- THE GUARD. 122 of the 171 cancellable orders are in this state and the
      -- Cancel button is offered on every one of them. A parcel that already
      -- reached its end cannot be un-sent, and clearing orders.awb here would
      -- strip a delivered order of its tracking link and its shipping_cost
      -- attribution. The database can prove this one, so it does -- it does not
      -- depend on the provider's reply having been parsed correctly.
      return jsonb_build_object(
        'outcome', 'shipment_already_terminal',
        'attempt_id', v_att_id, 'end_reason', v_end);
    end if;

    -- failed / superseded / unknown. None of these can be the order's current
    -- shipment: 'failed' means no parcel was created, 'superseded' means this
    -- attempt lost to another, 'unknown' is an unresolved human close.
    return jsonb_build_object(
      'outcome', 'attempt_state_mismatch',
      'attempt_id', v_att_id, 'end_reason', v_end);
  end if;

  -- ── The attempt is open ─────────────────────────────────────────────────
  if v_order_awb is not null and v_order_awb <> v_awb then
    -- The order has moved on to a different shipment. Cancelling that one is
    -- not what the caller asked for, and this function will not guess.
    return jsonb_build_object('outcome', 'awb_mismatch', 'awb', v_order_awb);
  end if;

  v_status := left(coalesce(nullif(btrim(coalesce(p_final_status, '')), ''), 'Cancelled'), 200);

  -- ONE update, because B1 freezes the row the instant end_reason is set.
  -- Every field a terminal attempt needs is written here; there is no second
  -- pass, and there cannot be.
  --
  -- awb, booked_at and shipping_cost are deliberately NOT in the SET list.
  -- The AWB is the evidence of what was cancelled; booked_at records when the
  -- courier issued it; shipping_cost is the quote that was paid for it. A
  -- cancellation does not make any of those untrue.
  update public.shipment_attempts sa
     set end_reason   = 'cancelled',
         ended_at     = now(),
         final_status = v_status
   where sa.id = v_att_id
     and sa.end_reason is null;

  -- The predicate above is not decoration: it is re-checked by the database at
  -- write time, so if anything closed this attempt between the read and here,
  -- ZERO rows move. Reading row_count is what turns that into a refusal rather
  -- than a silent success -- and, critically, it is checked BEFORE the order's
  -- pointer is cleared. Clearing a pointer whose attempt did not close is the
  -- exact half-applied shape this programme exists to eliminate.
  --
  -- The row lock should make this unreachable. "Should be unreachable" is not
  -- "is unreachable", and the cost of being wrong here is a live parcel that
  -- nothing points at.
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    return jsonb_build_object(
      'outcome', 'transition_race', 'attempt_id', v_att_id, 'rows', v_rows);
  end if;

  if v_order_awb is null then
    -- The pointer was already clear but the ledger was still open. This is the
    -- PR2 ROLLOUT-WINDOW RECOVERY: an old shipping-ops instance cancels at the
    -- courier and clears orders.awb without closing the attempt, exactly as it
    -- does today. Left alone, that attempt blocks every future booking for the
    -- order -- the precise lockout this PR exists to prevent. There is nothing
    -- to clear, so the attempt is closed and the order is not written at all.
    return jsonb_build_object(
      'outcome', 'cancelled_pointer_was_clear',
      'attempt_id', v_att_id, 'awb', v_awb, 'order_id', p_order_id);
  end if;

  -- Exactly the write shipping-ops performs today (index.ts lines 122 and
  -- 178): the AWB is cleared and shipment_status becomes 'Cancelled'. courier
  -- and shipping_cost are left alone, as they are today.
  update public.orders o
     set awb             = null,
         shipment_status = 'Cancelled'
   where o.id = p_order_id
     and o.store_slug = p_store_slug;

  return jsonb_build_object(
    'outcome', 'cancelled',
    'attempt_id', v_att_id, 'awb', v_awb, 'order_id', p_order_id);
end;
$function$;

comment on function public.cancel_current_shipment(text, uuid, text, text, text) is
  'Completes a CONFIRMED external courier cancellation: closes the matching '
  'attempt as end_reason = cancelled and clears the order''s shipment pointer, '
  'in one transaction. Refuses a delivered/returned/lost shipment outright and '
  'leaves the pointer untouched. The database cannot prove the courier '
  'cancelled anything -- invoking this IS the service-role caller''s assertion '
  'that the provider explicitly confirmed it.';

-- ---------------------------------------------------------------------------
-- 2. SUPERSEDE -- a booking that was created, lost, and cancelled
-- ---------------------------------------------------------------------------
-- The B2B loser path, and only that:
--
--   claim -> courier creates AWB-X -> finalize returns order_awb_conflict
--         -> cancelAtCourier(AWB-X) CONFIRMED -> here.
--
-- finalize deliberately refused to write AWB-X on conflict, so the attempt is
-- still open with no AWB. This is where AWB-X is recorded -- in the SAME
-- statement that closes the attempt, because B1 permits no second write.
--
-- public.orders is NEVER touched. The order points at the WINNING shipment and
-- that pointer belongs to another attempt entirely.
--
-- IF THE CANCELLATION WAS UNCERTAIN, DO NOT CALL THIS. A timeout, a 5xx or an
-- unparseable reply is not confirmation. The attempt must stay open and
-- blocking until a person resolves it -- there is no primitive here or in B2A
-- that closes an unconfirmed outcome, deliberately.
--
--   superseded             -> AWB recorded, attempt closed.
--   already_superseded     -> already closed as superseded with this AWB.
--   attempt_not_found      -> no such attempt in this store.
--   attempt_terminal       -> already closed some other way.
--   attempt_awb_conflict   -> closed, or open, holding a DIFFERENT AWB.
--   attempt_has_awb        -> open and already holding an AWB. finalize never
--                             writes one, so something else did: surface it.
--   order_still_points_here-> orders.awb IS this AWB. We did not lose; closing
--                             as superseded would be false.
--   awb_already_recorded   -> another attempt already owns (courier, awb).
--   transition_race        -> the closing UPDATE moved no row. Nothing is
--                             reported as superseded. Shared with cancel.
--   courier_mismatch / invalid_awb / invalid_courier
create or replace function public.supersede_shipment_attempt(
  p_attempt_id   bigint,
  p_store_slug   text,
  p_courier      text,
  p_awb          text,
  p_final_status text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_courier   text;
  v_awb       text;
  v_order_id  uuid;
  v_order_awb text;
  v_att_awb   text;
  v_att_cour  text;
  v_end       text;
  v_status    text;
  v_rows      integer;
begin
  v_courier := nullif(btrim(lower(coalesce(p_courier, ''))), '');
  v_awb     := nullif(btrim(coalesce(p_awb, '')), '');
  if v_awb is null then
    return jsonb_build_object('outcome', 'invalid_awb');
  end if;
  if v_courier is null or v_courier not in ('delhivery', 'shadowfax') then
    return jsonb_build_object('outcome', 'invalid_courier');
  end if;

  select sa.order_id
    into v_order_id
    from public.shipment_attempts sa
   where sa.id = p_attempt_id
     and sa.store_slug = p_store_slug;

  if v_order_id is null then
    return jsonb_build_object('outcome', 'attempt_not_found');
  end if;

  -- Lock the order, not the attempt, so this queues behind claim / finalize /
  -- cancel on the same row rather than deadlocking against them.
  select o.awb
    into v_order_awb
    from public.orders o
   where o.id = v_order_id
     and o.store_slug = p_store_slug
     for update;

  if not found then
    return jsonb_build_object('outcome', 'attempt_not_found');
  end if;
  v_order_awb := nullif(btrim(coalesce(v_order_awb, '')), '');

  -- Re-read the attempt under the lock.
  select nullif(btrim(coalesce(sa.awb, '')), ''), sa.courier, sa.end_reason
    into v_att_awb, v_att_cour, v_end
    from public.shipment_attempts sa
   where sa.id = p_attempt_id;

  if v_att_cour is distinct from v_courier then
    return jsonb_build_object('outcome', 'courier_mismatch', 'courier', v_att_cour);
  end if;

  -- ── We did not lose ─────────────────────────────────────────────────────
  -- Checked before the terminal tests: if the order points at this AWB then
  -- this attempt WON, and no reading of its state makes 'superseded' true.
  if v_order_awb is not null and v_order_awb = v_awb then
    return jsonb_build_object(
      'outcome', 'order_still_points_here', 'awb', v_awb, 'order_id', v_order_id);
  end if;

  -- ── Already closed ──────────────────────────────────────────────────────
  if v_end is not null then
    if v_end = 'superseded' and v_att_awb is not distinct from v_awb then
      return jsonb_build_object(
        'outcome', 'already_superseded', 'attempt_id', p_attempt_id, 'awb', v_awb);
    end if;
    if v_att_awb is not null and v_att_awb <> v_awb then
      return jsonb_build_object(
        'outcome', 'attempt_awb_conflict', 'awb', v_att_awb, 'end_reason', v_end);
    end if;
    return jsonb_build_object(
      'outcome', 'attempt_terminal', 'end_reason', v_end);
  end if;

  -- ── Open, but already carrying an AWB ───────────────────────────────────
  -- finalize_shipment_attempt never writes an AWB on conflict, so an open
  -- attempt holding one was written by something else. Refuse either way: a
  -- different AWB is a conflict, the same AWB is a state this path cannot
  -- produce and should be looked at rather than tidied away.
  if v_att_awb is not null then
    if v_att_awb <> v_awb then
      return jsonb_build_object('outcome', 'attempt_awb_conflict', 'awb', v_att_awb);
    end if;
    return jsonb_build_object('outcome', 'attempt_has_awb', 'awb', v_att_awb);
  end if;

  v_status := left(coalesce(nullif(btrim(coalesce(p_final_status, '')), ''), 'Cancelled'), 200);

  -- ONE update: the AWB, the reason, the time and the evidence all land
  -- together, because B1 freezes the row as soon as end_reason is set.
  --
  -- booked_at stays NULL. B1's rule is that a timestamp is never invented, and
  -- this function cannot tell an in-request close (seconds after the courier
  -- answered) from a human resolving a reconciliation days later. ended_at
  -- records what IS known; awb and end_reason carry the rest. This matches the
  -- B1 backfill, which left booked_at null on all 173 rows for the same reason.
  begin
    update public.shipment_attempts sa
       set awb          = v_awb,
           end_reason   = 'superseded',
           ended_at     = now(),
           final_status = v_status
     where sa.id = p_attempt_id
       and sa.end_reason is null
       and sa.awb is null;

    get diagnostics v_rows = row_count;
  exception
    when unique_violation then
      -- shipment_attempts_courier_awb_idx: some other attempt already owns
      -- this (courier, awb). Two ledger rows must never claim one parcel.
      return jsonb_build_object('outcome', 'awb_already_recorded', 'awb', v_awb);
  end;

  -- Same reasoning as in cancel_current_shipment: the WHERE clause is
  -- re-evaluated at write time, so an attempt that was closed or given an AWB
  -- between the read and here moves zero rows. Success is only reported for a
  -- row this statement actually mutated.
  if v_rows <> 1 then
    return jsonb_build_object(
      'outcome', 'transition_race', 'attempt_id', p_attempt_id, 'rows', v_rows);
  end if;

  return jsonb_build_object(
    'outcome', 'superseded',
    'attempt_id', p_attempt_id, 'awb', v_awb, 'order_id', v_order_id);
end;
$function$;

comment on function public.supersede_shipment_attempt(bigint, text, text, text, text) is
  'Records a losing booking: writes the externally-created AWB onto the open '
  'claim and closes it as end_reason = superseded, in one statement. Never '
  'touches public.orders -- the winning shipment pointer belongs to another '
  'attempt. Must only be called after the provider explicitly confirmed that '
  'AWB was cancelled; an uncertain outcome has no close primitive by design.';

-- ---------------------------------------------------------------------------
-- 3. Access -- service role only
-- ---------------------------------------------------------------------------
-- The same trust boundary as create_order_secure and B2A's three RPCs.
-- Postgres grants EXECUTE to PUBLIC by default on every new function, so each
-- is revoked explicitly before the single grant that is wanted.
--
-- public.shipment_attempts is NOT re-granted to anyone. B1 left it RLS-on with
-- no policy and no privileges for anon or authenticated; that is unchanged, so
-- a browser can reach neither the table nor these functions.
revoke all on function public.cancel_current_shipment(text, uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.cancel_current_shipment(text, uuid, text, text, text)
  to service_role;

revoke all on function public.supersede_shipment_attempt(bigint, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.supersede_shipment_attempt(bigint, text, text, text, text)
  to service_role;

commit;

-- Next: supabase/shipment-terminal-verify.sql -- read-only, POST-APPLY ONLY.
--
-- NOT part of this migration, and required before either function may be
-- called: PR2 must replace shipping-ops' cancellation success test. It
-- currently reads
--     ok = responseCode === 200 || /cancel/i.test(responseMsg)      (Shadowfax)
--     ok = /<status>true<\/status>/i || /cancell?ed/i || ...        (Delhivery)
-- so a provider REFUSAL -- "Order cannot be cancelled", "Cancellation failed",
-- "<status>False</status><remark>Cannot be cancelled</remark>" -- is read as
-- success. Today that wrongly clears orders.awb. Fed into
-- cancel_current_shipment it would also write an immutable, wrong 'cancelled'
-- row and release the one-open-attempt index. Only an explicitly positive
-- confirmation may reach these functions.
--
-- That parsing belongs in TypeScript, next to the provider call. It is not
-- attempted here: SQL cannot see the HTTP response, and pretending otherwise
-- would move the trust boundary without moving the evidence.
