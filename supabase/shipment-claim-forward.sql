-- ===========================================================================
--  Atomic shipment booking claim -- PR B2A
--  PREPARED FOR REVIEW. NOT APPLIED.
--
--  WHY
--   PR A made the ATTACHMENT safe: two racing bookings can never both land on
--   public.orders, and the loser's AWB is cancelled at the courier. What it
--   cannot do is stop the second request REACHING the courier in the first
--   place -- by the time the compare-and-set runs, two real parcels exist and
--   one of them has to be un-booked. On Shadowfax the booking IS the pickup
--   request, so a rider may already be on the way.
--
--   These functions move the decision in front of the courier call. A request
--   must win an atomic database claim before it is allowed to create anything
--   externally, and the loser is turned away having spoken to nobody.
--
--  WHAT THIS DOES
--   public.claim_shipment_attempt      win the exclusive right to book
--   public.finalize_shipment_attempt   record the AWB on the attempt AND on
--                                      the order, together or not at all
--   public.fail_shipment_attempt       close a claim the courier definitively
--                                      refused
--
--  WHAT THIS DOES NOT DO
--   NOTHING CALLS THESE YET. shipping-book is untouched in this PR; it still
--   books exactly the way it does today. Applying this migration changes no
--   runtime behaviour at all -- it adds three functions nobody invokes. The
--   edge function starts using them in B2B, which ships separately and only
--   after this is live.
--
--   No table is created, altered or dropped. public.shipment_attempts keeps
--   the schema, indexes, trigger and access rules B1 gave it. public.orders
--   is read and compare-and-set exactly as shipping-book already writes it --
--   no column added, no trigger touched.
--
--  THE RULE THAT MAKES THIS WORK
--   B1 created  unique (order_id) where end_reason is null.
--   One open attempt per order, enforced by the database. A claim is simply an
--   open attempt with no AWB yet, so two concurrent claims for one order are
--   already impossible at the storage layer. The row lock below turns that
--   collision into a typed refusal instead of a constraint error.
--
--  THE RULE THAT IS EASY TO GET WRONG
--   A non-null end_reason RELEASES that unique index. So closing an attempt is
--   the same thing as authorising another booking. That is why an uncertain
--   courier outcome must never be closed -- there is no primitive here that
--   can do it, deliberately. See fail_shipment_attempt.
--
--  ORDER OF OPERATIONS
--   1. Apply this. 2. shipment-claim-verify.sql (read-only, all PASS).
--   Then, separately, B2B deploys the edge function that calls these.
--
--  RUN: Supabase Dashboard -> SQL Editor -> paste all -> Run. One transaction.
--  Re-running is safe: every function is create or replace.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. CLAIM -- the exclusive right to call the courier
-- ---------------------------------------------------------------------------
-- Everything that decides whether this request may book happens inside one
-- function, under one lock, in one transaction. The caller gets a verdict, not
-- a set of facts to re-judge in TypeScript.
--
-- Returns jsonb. Always has "outcome". Never contains customer data.
--
--   claimed            -> attempt_id, attempt_no, courier. GO. You may book.
--   order_not_found    -> no such order in this store. (Also the answer for a
--                         real order in someone else's store: the two are not
--                         distinguished, on purpose.)
--   order_not_bookable -> the order is cancelled or abandoned.
--   already_booked     -> orders.awb is set. This order has a shipment.
--   open_with_awb      -> an attempt is open and holds an AWB: a live parcel.
--   open_without_awb   -> an attempt is open with no AWB: a booking is either
--                         in flight right now, or ended uncertain and is
--                         waiting for a human. Either way, do NOT book.
--   invalid_courier    -> not one of the two the ledger accepts.
--   race_lost          -> the unique index rejected the insert. Should be
--                         unreachable behind the lock; see the handler.
create or replace function public.claim_shipment_attempt(
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
  v_courier    text;
  v_order_awb  text;
  v_status     text;
  v_open_id    bigint;
  v_open_awb   text;
  v_attempt_no integer;
  v_id         bigint;
begin
  -- Normalised the same way the ledger stores it, so 'Delhivery' from a caller
  -- is not a different courier from 'delhivery' in the table.
  v_courier := nullif(btrim(lower(coalesce(p_courier, ''))), '');
  if v_courier is null or v_courier not in ('delhivery', 'shadowfax') then
    return jsonb_build_object('outcome', 'invalid_courier');
  end if;

  -- ── The lock ────────────────────────────────────────────────────────────
  -- FOR UPDATE on the order row is the serialization point. Everything after
  -- this line -- eligibility, the open-attempt test, the attempt_no it hands
  -- out -- is read and acted on while no other claimant for THIS order can be
  -- between its own read and its own insert.
  select o.awb, o.status
    into v_order_awb, v_status
    from public.orders o
   where o.id = p_order_id
     and o.store_slug = p_store_slug
     for update;

  -- FOUND, not a flag variable: SELECT INTO assigns NULL to its targets when
  -- nothing matches, so "if not v_flag" would evaluate NULL and fall through
  -- to book a shipment for an order that does not exist.
  if not found then
    return jsonb_build_object('outcome', 'order_not_found');
  end if;

  -- ── Eligibility ─────────────────────────────────────────────────────────
  -- Deliberately NARROW. Two statuses are not commerce orders that can be
  -- handed to a courier: a cancelled order (the Orders screen hides the Book
  -- button on it) and an abandoned cart (never an order at all).
  --
  -- countsAsSale() in src/utils/orderState.js is deliberately NOT used here,
  -- even though it looks like the obvious rule. Its third leg excludes an
  -- online order that is unpaid and not yet shipped -- and shipping one of
  -- those is precisely how an order becomes "payment unconfirmed". Enforcing
  -- countsAsSale would refuse bookings that succeed today and break the flow
  -- that produces those rows.
  if coalesce(v_status, '') in ('cancelled', 'abandoned') then
    return jsonb_build_object('outcome', 'order_not_bookable', 'status', v_status);
  end if;

  -- ── Already shipped ─────────────────────────────────────────────────────
  -- The same test shipping-book does at its top, now under the lock. orders
  -- stays the authoritative current shipment pointer, so it is asked first.
  --
  -- This is also the rebook boundary. A courier-cancelled booking KEEPS its
  -- AWB on the order, so it lands here and is refused. B2A cannot rebook
  -- anything; that is PR C's job and it will need its own explicit path.
  if nullif(btrim(coalesce(v_order_awb, '')), '') is not null then
    select sa.id into v_open_id
      from public.shipment_attempts sa
     where sa.order_id = p_order_id and sa.end_reason is null;
    return jsonb_build_object(
      'outcome', 'already_booked',
      'awb', v_order_awb,
      'open_attempt_id', v_open_id);
  end if;

  -- ── An attempt is already open ──────────────────────────────────────────
  -- At most one can exist: the partial unique index guarantees it. The two
  -- shapes mean very different things to a merchant, so they are reported
  -- separately rather than as one "busy".
  select sa.id, sa.awb
    into v_open_id, v_open_awb
    from public.shipment_attempts sa
   where sa.order_id = p_order_id
     and sa.end_reason is null;

  if v_open_id is not null then
    if nullif(btrim(coalesce(v_open_awb, '')), '') is not null then
      -- A live parcel whose AWB never reached the order. Rare, and exactly
      -- the state PR A's "unknown" verdict leaves behind.
      return jsonb_build_object(
        'outcome', 'open_with_awb',
        'attempt_id', v_open_id,
        'awb', v_open_awb);
    end if;
    -- A claim in progress, or one that ended without an answer. Blocking.
    return jsonb_build_object(
      'outcome', 'open_without_awb',
      'attempt_id', v_open_id);
  end if;

  -- ── Allocate and insert ─────────────────────────────────────────────────
  -- attempt_no is computed HERE, under the lock, and never in the caller.
  -- Dense per order, and unique by index even if the lock were somehow lost.
  select coalesce(max(sa.attempt_no), 0) + 1
    into v_attempt_no
    from public.shipment_attempts sa
   where sa.order_id = p_order_id;

  begin
    insert into public.shipment_attempts
      (store_slug, order_id, attempt_no, courier,
       awb, claimed_at, booked_at, shipping_cost, ended_at, end_reason, final_status)
    values
      (p_store_slug, p_order_id, v_attempt_no, v_courier,
       null, now(), null, null, null, null, null)
    returning id into v_id;
  exception
    when unique_violation then
      -- Unreachable while the row lock holds, because a competing claimant
      -- cannot have inserted between our read and our insert. Kept because
      -- "should be unreachable" is not "is unreachable", and the caller must
      -- get a typed refusal rather than SQLSTATE 23505 surfacing as a 500.
      return jsonb_build_object('outcome', 'race_lost');
  end;

  -- shipping_cost is NOT set here. The quote belongs to a shipment that
  -- exists; a claim that never reaches a courier was never charged for. It is
  -- written at finalize, in the same statement as the AWB -- which is exactly
  -- where shipping-book writes it to orders today.
  return jsonb_build_object(
    'outcome',    'claimed',
    'attempt_id', v_id,
    'attempt_no', v_attempt_no,
    'courier',    v_courier);
end;
$function$;

comment on function public.claim_shipment_attempt(text, uuid, text) is
  'Wins the exclusive right to create ONE courier booking for an order. Locks '
  'the orders row, validates eligibility, allocates attempt_no and inserts an '
  'open attempt with no AWB -- all atomically. A caller that does not receive '
  'outcome="claimed" must not contact the courier. Returns no customer data.';

-- ---------------------------------------------------------------------------
-- 2. FINALIZE -- the AWB lands on the attempt and the order together
-- ---------------------------------------------------------------------------
-- The whole point of this function is that there is no moment where the ledger
-- says "booked" and the order does not, or the reverse. Both updates commit or
-- neither does.
--
-- The update to orders is PR A's compare-and-set, moved into SQL: it still
-- only writes while orders.awb is null, and it still writes the same four
-- columns. Nothing about the pointer's semantics changes.
--
-- Designed to be RETRIED. An edge function that does not hear the reply may
-- call again with the same arguments and must not corrupt anything.
--
-- It writes in exactly two situations: neither side holds an AWB (it creates
-- the pair), or both already hold the requested one (it writes nothing and
-- says so). EVERY OTHER SHAPE IS A REFUSAL. In particular a half-applied pair
-- is NOT completed -- see the block above the two updates.
--
--   finalized          -> neither side held an AWB; both now hold this one.
--   already_finalized  -> both already held this exact AWB. No writes.
--   attempt_not_found  -> no such attempt in this store.
--   attempt_terminal   -> the attempt is closed. Frozen by B1's trigger.
--   courier_mismatch   -> the attempt was claimed for the other courier.
--   attempt_awb_conflict -> the attempt already holds a DIFFERENT AWB.
--   order_awb_conflict   -> the order already points at a DIFFERENT AWB.
--   partial_state_attempt_only -> the ledger has this AWB, the order does not.
--   partial_state_order_only   -> the order has this AWB, the ledger does not.
--
-- None of the four refusals overwrites anything. Two different AWBs on one
-- order, or one side of a pair missing, is evidence that something went wrong
-- upstream -- and evidence is not for this function to destroy or to tidy
-- away. Each surfaces for reconciliation instead.
create or replace function public.finalize_shipment_attempt(
  p_attempt_id    bigint,
  p_store_slug    text,
  p_courier       text,
  p_awb           text,
  p_shipping_cost numeric default null,
  p_final_status  text    default null
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
  v_att_awb   text;
  v_att_cour  text;
  v_end       text;
  v_order_awb text;
begin
  v_courier := nullif(btrim(lower(coalesce(p_courier, ''))), '');
  v_awb     := nullif(btrim(coalesce(p_awb, '')), '');
  if v_awb is null then
    return jsonb_build_object('outcome', 'invalid_awb');
  end if;

  -- Read the attempt first, only to learn which order to lock.
  select sa.order_id, sa.awb, sa.courier, sa.end_reason
    into v_order_id, v_att_awb, v_att_cour, v_end
    from public.shipment_attempts sa
   where sa.id = p_attempt_id
     and sa.store_slug = p_store_slug;

  if v_order_id is null then
    return jsonb_build_object('outcome', 'attempt_not_found');
  end if;

  -- Lock the order, then re-read the attempt under it. Between the read above
  -- and this line a concurrent finalize could have moved either row; taking
  -- the same lock the claim takes puts this function in the same queue.
  select o.awb
    into v_order_awb
    from public.orders o
   where o.id = v_order_id
     and o.store_slug = p_store_slug
     for update;

  -- FOUND, for the same reason as in claim_shipment_attempt.
  if not found then
    return jsonb_build_object('outcome', 'attempt_not_found');
  end if;

  select sa.awb, sa.courier, sa.end_reason
    into v_att_awb, v_att_cour, v_end
    from public.shipment_attempts sa
   where sa.id = p_attempt_id;

  v_att_awb   := nullif(btrim(coalesce(v_att_awb, '')), '');
  v_order_awb := nullif(btrim(coalesce(v_order_awb, '')), '');

  -- ── Closed attempts are not finalizable ─────────────────────────────────
  -- B1's trigger would refuse the UPDATE anyway; refusing here turns a raised
  -- exception into a typed answer the caller can act on.
  if v_end is not null then
    return jsonb_build_object('outcome', 'attempt_terminal', 'end_reason', v_end);
  end if;

  if v_att_cour is distinct from v_courier then
    return jsonb_build_object('outcome', 'courier_mismatch', 'courier', v_att_cour);
  end if;

  -- ── Conflicting evidence: refuse, never overwrite ───────────────────────
  if v_att_awb is not null and v_att_awb <> v_awb then
    return jsonb_build_object('outcome', 'attempt_awb_conflict', 'awb', v_att_awb);
  end if;
  if v_order_awb is not null and v_order_awb <> v_awb then
    return jsonb_build_object('outcome', 'order_awb_conflict', 'awb', v_order_awb);
  end if;

  -- ── Nothing left to do ──────────────────────────────────────────────────
  -- Both already hold this exact AWB: a retry of a call that did land. Report
  -- success and write nothing, so booked_at keeps the first booking's time.
  if v_att_awb = v_awb and v_order_awb = v_awb then
    return jsonb_build_object(
      'outcome', 'already_finalized',
      'attempt_id', p_attempt_id, 'awb', v_awb, 'order_id', v_order_id);
  end if;

  -- ── A HALF-APPLIED PAIR IS EVIDENCE, NOT WORK TO FINISH ─────────────────
  -- Past the conflict tests above, each side is now either null or exactly
  -- v_awb, so reaching here with only ONE side set means the attempt and the
  -- order disagree about whether this shipment exists.
  --
  -- This function is the only thing that creates that pair, and it creates it
  -- in one transaction. So a half-applied pair CANNOT have been produced by a
  -- completed call to it. Something else made it: pre-B2B code that attached
  -- to orders without a ledger row, a hand-run SQL fix, or a transaction that
  -- committed one side and is still open on the other.
  --
  -- Completing it would be a guess dressed as success, and it would erase the
  -- only signal that any of those happened. Both cases therefore return a
  -- typed outcome and WRITE NOTHING. There is deliberately no repair RPC:
  -- resolving one requires knowing which side is the truth, and that is a
  -- judgement about a real parcel, not a database default.
  if v_att_awb = v_awb and v_order_awb is null then
    -- The ledger records this booking; the order does not point at it.
    return jsonb_build_object(
      'outcome', 'partial_state_attempt_only',
      'attempt_id', p_attempt_id, 'awb', v_awb, 'order_id', v_order_id);
  end if;

  if v_att_awb is null and v_order_awb = v_awb then
    -- The order points at this booking; the ledger has no record of it.
    return jsonb_build_object(
      'outcome', 'partial_state_order_only',
      'attempt_id', p_attempt_id, 'awb', v_awb, 'order_id', v_order_id);
  end if;

  -- ── The two writes ──────────────────────────────────────────────────────
  -- Only one case is left: neither side holds an AWB. The pair is created
  -- here, from nothing, in this function's single transaction -- if the second
  -- statement raises, the first is rolled back with it.
  --
  -- The "awb is null" predicates are PR A's compare-and-set, kept verbatim.
  -- Under the row lock they are already known to hold; they stay because they
  -- are the guarantee itself, not a leftover of it.
  update public.shipment_attempts sa
     set awb           = v_awb,
         booked_at     = now(),
         shipping_cost = coalesce(p_shipping_cost, sa.shipping_cost),
         final_status  = coalesce(nullif(btrim(coalesce(p_final_status, '')), ''), sa.final_status)
   where sa.id = p_attempt_id
     and sa.end_reason is null
     and sa.awb is null;

  update public.orders o
     set awb             = v_awb,
         courier         = v_courier,
         shipment_status = coalesce(nullif(btrim(coalesce(p_final_status, '')), ''), o.shipment_status),
         shipping_cost   = coalesce(p_shipping_cost, o.shipping_cost)
   where o.id = v_order_id
     and o.store_slug = p_store_slug
     and o.awb is null;

  return jsonb_build_object(
    'outcome', 'finalized',
    'attempt_id', p_attempt_id, 'awb', v_awb, 'order_id', v_order_id);
end;
$function$;

comment on function public.finalize_shipment_attempt(bigint, text, text, text, numeric, text) is
  'Creates the (attempt, order) shipment pair in one transaction, so the ledger '
  'and the current shipment pointer can never disagree. Safe to retry with '
  'identical arguments. Writes only when NEITHER side holds an AWB; reports '
  'already_finalized when both hold the requested one; refuses everything else, '
  'including a half-applied pair, which it surfaces rather than completing.';

-- ---------------------------------------------------------------------------
-- 3. FAIL -- close a claim the courier definitively refused
-- ---------------------------------------------------------------------------
-- A third narrow function rather than a general "update the attempt" grant.
-- Closing an attempt releases the one-open-attempt index and therefore
-- AUTHORISES ANOTHER BOOKING, so the conditions under which it may happen are
-- worth spelling out in SQL where they can be verified, instead of leaving
-- them to whichever caller gets written next.
--
-- The guard that matters: awb IS NULL. An attempt that received an AWB may
-- have a parcel behind it, and no amount of "the call failed" makes that
-- untrue. Only a claim that never got one can be closed this way.
--
-- THIS FUNCTION IS NOT FOR TIMEOUTS. If the courier's answer was not heard,
-- the outcome is not known to be failure. Closing it would hand out permission
-- to create a second parcel in exactly the case where one may already exist.
-- There is no primitive here for that, and there must not be: an uncertain
-- attempt stays open (end_reason null, awb null, claimed_at set) and keeps
-- blocking until a person resolves it. B2A contains no stale-claim expiry and
-- no automated writer of end_reason = 'unknown'.
--
--   failed             -> closed. The order may be booked again.
--   attempt_not_found  -> no such attempt in this store.
--   attempt_terminal   -> already closed.
--   attempt_has_awb    -> refused; see above.
create or replace function public.fail_shipment_attempt(
  p_attempt_id   bigint,
  p_store_slug   text,
  p_final_status text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_awb      text;
  v_end      text;
  v_order_id uuid;
begin
  select sa.order_id, sa.awb, sa.end_reason
    into v_order_id, v_awb, v_end
    from public.shipment_attempts sa
   where sa.id = p_attempt_id
     and sa.store_slug = p_store_slug
     for update;

  if v_order_id is null then
    return jsonb_build_object('outcome', 'attempt_not_found');
  end if;
  if v_end is not null then
    return jsonb_build_object('outcome', 'attempt_terminal', 'end_reason', v_end);
  end if;
  if nullif(btrim(coalesce(v_awb, '')), '') is not null then
    return jsonb_build_object('outcome', 'attempt_has_awb', 'awb', v_awb);
  end if;

  update public.shipment_attempts sa
     set end_reason   = 'failed',
         ended_at     = now(),
         -- Truncated: this carries a provider's rejection text and is shown
         -- back to a merchant. Long enough to be useful, short enough not to
         -- become a dumping ground for a raw error payload.
         final_status = left(nullif(btrim(coalesce(p_final_status, '')), ''), 200)
   where sa.id = p_attempt_id
     and sa.end_reason is null
     and sa.awb is null;

  return jsonb_build_object(
    'outcome', 'failed', 'attempt_id', p_attempt_id, 'order_id', v_order_id);
end;
$function$;

comment on function public.fail_shipment_attempt(bigint, text, text) is
  'Closes an open, AWB-less claim as end_reason = failed after a courier '
  'DEFINITIVELY refused the booking. Refuses any attempt that holds an AWB. '
  'Must never be called for an unheard or timed-out response: closing an '
  'attempt releases the one-open-attempt index and permits another booking.';

-- ---------------------------------------------------------------------------
-- 4. Access -- service role only
-- ---------------------------------------------------------------------------
-- The trust boundary, matching create_order_secure in
-- order-integrity-phase2-forward.sql. Postgres grants EXECUTE to public by
-- default on every new function, so each is revoked explicitly before the one
-- grant that is wanted.
--
-- public.shipment_attempts itself is NOT re-granted to anyone: B1 left it with
-- RLS on, no policy and no privileges for anon or authenticated, and that is
-- unchanged. A browser cannot reach the table and cannot reach these either.
revoke all on function public.claim_shipment_attempt(text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.claim_shipment_attempt(text, uuid, text)
  to service_role;

revoke all on function public.finalize_shipment_attempt(bigint, text, text, text, numeric, text)
  from public, anon, authenticated;
grant execute on function public.finalize_shipment_attempt(bigint, text, text, text, numeric, text)
  to service_role;

revoke all on function public.fail_shipment_attempt(bigint, text, text)
  from public, anon, authenticated;
grant execute on function public.fail_shipment_attempt(bigint, text, text)
  to service_role;

commit;

-- Next: supabase/shipment-claim-verify.sql -- read-only, POST-APPLY ONLY.
--
-- NOT part of this migration: B2B, which rewrites shipping-book to claim
-- before it calls a courier and to finalize after. Until that ships, these
-- three functions have no callers and production books exactly as it does
-- today.
