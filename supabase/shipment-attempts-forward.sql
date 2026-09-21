-- ===========================================================================
--  Shipment attempts ledger -- PR B1
--  PREPARED FOR REVIEW. NOT APPLIED.
--
--  WHY
--   One order = one AWB. When a courier cancels a booking outside PocketLink
--   the AWB stays on the row, and re-shipping would have to overwrite it --
--   destroying the old AWB, its courier, its last status and its cost. That
--   cost feeds Stats -> Profit, so a rebook would silently understate what the
--   merchant actually spent on couriers.
--
--   This adds the history. It does NOT change how anything is booked.
--
--  WHAT THIS DOES
--   public.shipment_attempts   one row per courier booking attempt, ever.
--                              Append-mostly: an OPEN attempt is updated as
--                              evidence arrives; a CLOSED one is frozen.
--   Backfill                   one attempt per courier-backed order (172 rows
--                              on production at the time of writing), built
--                              only from evidence that already exists.
--
--  WHAT THIS DOES NOT DO
--   orders keeps awb / courier / shipment_status as the SINGLE CURRENT
--   SHIPMENT POINTER. No column on orders is added, changed or read
--   differently. No trigger on orders is touched. No edge function changes.
--   Nothing reads this table yet, so applying it changes no behaviour at all.
--
--  THE TWO RULES THAT ARE EASY TO GET WRONG
--   1. end_reason IS NULL -- not ended_at IS NULL -- is what "open" means.
--      86 production attempts are genuinely finished but their terminal time
--      was never recorded (the payments-automation backfill deliberately left
--      those timestamps empty rather than stamp now()). Keying "open" off the
--      timestamp would resurrect all 86 as live shipments.
--   2. A timestamp implies a reason, never the other way round:
--         check (ended_at is null or end_reason is not null)
--      The symmetric version would reject those same 86 rows outright.
--
--  NOTHING IS INVENTED. claimed_at and booked_at are NULL for every backfilled
--  row because those moments were never recorded. orders.created_at is the
--  order's time, not the booking's, and is deliberately not substituted.
--
--  ORDER OF OPERATIONS
--   1. Apply this. 2. shipment-attempts-verify.sql (read-only, all PASS).
--   Nothing else. B2 (booking claim) and B3 (status mirroring) are separate.
--
--  RUN: Supabase Dashboard -> SQL Editor -> paste all -> Run. One transaction.
--  Re-running is safe: the table is created if absent and the backfill skips
--  orders that already have an attempt.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. The ledger
-- ---------------------------------------------------------------------------
create table if not exists public.shipment_attempts (
  id            bigint      generated always as identity primary key,
  store_slug    text        not null,
  order_id      uuid        not null references public.orders (id) on delete restrict,
  attempt_no    integer     not null check (attempt_no >= 1),
  courier       text        not null check (courier in ('delhivery', 'shadowfax')),

  -- NULL until the courier hands one back. Also NULL forever on the two
  -- production rows whose AWB was cleared by an in-app cancellation.
  awb           text,

  -- Both NULL on every backfilled row: neither moment was ever recorded.
  claimed_at    timestamptz,
  booked_at     timestamptz,

  -- The quote the merchant was shown when booking. NOT a courier invoice.
  shipping_cost numeric,

  ended_at      timestamptz,
  end_reason    text        check (end_reason in
                  ('delivered', 'returned', 'lost', 'cancelled',
                   'superseded', 'failed', 'unknown')),
  final_status  text,

  -- A terminal time requires a terminal reason. The reverse is NOT required:
  -- 86 production attempts are closed with no recorded timestamp.
  constraint shipment_attempts_ended_needs_reason
    check (ended_at is null or end_reason is not null)
);

comment on table public.shipment_attempts is
  'One row per courier booking attempt, ever. public.orders stays the single '
  'current shipment pointer; this is the history, the cost record and the '
  'audit trail behind it. An attempt is OPEN while end_reason is null and is '
  'frozen once it is set -- ended_at may stay null, because for 86 historical '
  'attempts the terminal time was never recorded and is not invented here.';

comment on column public.shipment_attempts.claimed_at is
  'When PocketLink claimed the right to book. NULL on every backfilled row: '
  'the moment predates the ledger and is not reconstructable.';
comment on column public.shipment_attempts.booked_at is
  'When the courier returned an AWB. NULL on every backfilled row for the same '
  'reason. orders.created_at is the ORDER time and is never substituted.';
comment on column public.shipment_attempts.shipping_cost is
  'The booking-time QUOTED courier charge, copied from orders.shipping_cost. '
  'Not proven invoiced spend. No accounting consumer reads this column yet.';
comment on column public.shipment_attempts.final_status is
  'The last raw courier status string seen for this attempt, verbatim.';

-- ---------------------------------------------------------------------------
-- 2. Invariants
-- ---------------------------------------------------------------------------

-- At most ONE open attempt per order. This is the concurrency primitive B2
-- will book against: two racing requests cannot both hold an open claim.
-- Keyed on end_reason, NOT ended_at -- see the header.
create unique index if not exists shipment_attempts_one_open_idx
  on public.shipment_attempts (order_id) where end_reason is null;

-- Attempt numbering is dense and per order.
create unique index if not exists shipment_attempts_order_no_idx
  on public.shipment_attempts (order_id, attempt_no);

-- An AWB resolves to exactly one attempt, so a webhook carrying a stale AWB
-- can always be matched to the attempt it belongs to and to no other.
create unique index if not exists shipment_attempts_courier_awb_idx
  on public.shipment_attempts (courier, awb) where awb is not null;

-- Lookup: a store's shipment history, newest first. (Order history is already
-- served by shipment_attempts_order_no_idx; no second index for it.)
create index if not exists shipment_attempts_store_idx
  on public.shipment_attempts (store_slug, id desc);

-- ---------------------------------------------------------------------------
-- 3. Closed attempts are permanent
-- ---------------------------------------------------------------------------
-- Deliberately NOT "no row may ever change". B2 must be able to fill in the
-- AWB, the booking time and the raw status on an attempt that is still open,
-- and then close it. What must never happen is a finished attempt being
-- edited, reopened or erased.
create or replace function public.shipment_attempt_is_final()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $function$
begin
  if tg_op = 'DELETE' then
    raise exception
      'shipment_attempts: DELETE is not allowed. An attempt that happened cannot be un-happened.'
      using errcode = '42501';
  end if;

  if OLD.end_reason is not null then
    raise exception
      'shipment_attempts: attempt % on order % closed as "%" and is now permanent.',
      OLD.attempt_no, OLD.order_id, OLD.end_reason
      using errcode = '42501';
  end if;

  return NEW;
end;
$function$;

comment on function public.shipment_attempt_is_final() is
  'Closed attempts are immutable and nothing is ever deleted. An OPEN attempt '
  '(end_reason is null) stays writable so the booking path can record the AWB, '
  'the booking time, raw statuses and finally the outcome.';

drop trigger if exists shipment_attempts_closed_are_permanent on public.shipment_attempts;
create trigger shipment_attempts_closed_are_permanent
  before update or delete on public.shipment_attempts
  for each row execute function public.shipment_attempt_is_final();

-- ---------------------------------------------------------------------------
-- 4. Access -- deny by default
-- ---------------------------------------------------------------------------
-- Supabase's default privileges hand anon and authenticated full rights on
-- every new table, so each one is revoked explicitly. No policy is created:
-- with RLS on and no policy, only the service role reaches this table, which
-- is exactly who writes it. A merchant-facing read goes through a PIN-gated
-- security definer RPC later, the way get_store_orders already does.
alter table public.shipment_attempts enable row level security;
revoke all on public.shipment_attempts from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Backfill -- one attempt per courier-backed order
-- ---------------------------------------------------------------------------
-- The predicate is COURIER EVIDENCE, not shipping state. A seller who marks a
-- local delivery "delivered" produces shipment_outcome with no courier and no
-- AWB; 10 such orders exist and must not become phantom courier attempts.
--
-- end_reason reads the ATTEMPT's evidence, which is not the same question as
-- shipmentState(): that answers whether the ORDER has a shipment now. The two
-- differ on exactly two production rows, and both answers are right --
--   * 2 rows cancelled in-app: AWB cleared, so the order has no shipment, but
--     the attempt certainly ended cancelled.
--   * 1 returned parcel on a cancelled order: commerce excludes the order, and
--     the courier history still records that the parcel came back.
-- Commerce status never erases courier history.
insert into public.shipment_attempts
  (store_slug, order_id, attempt_no, courier, awb,
   claimed_at, booked_at, shipping_cost, ended_at, end_reason, final_status)
select
  o.store_slug,
  o.id,
  1,
  lower(btrim(coalesce(o.courier, ''))),
  nullif(btrim(coalesce(o.awb, '')), ''),
  null,                       -- claimed_at: never recorded
  null,                       -- booked_at:  never recorded
  o.shipping_cost,            -- booking-time quote, copied as-is
  case r.reason
    when 'delivered'          then o.delivered_at
    when 'returned'           then o.returned_at
    when 'lost'               then o.returned_at
    else null                 -- cancelled has no authoritative timestamp
  end,
  r.reason,
  nullif(btrim(coalesce(o.shipment_status, '')), '')
from public.orders o
cross join lateral (
  select case
    -- 1. the database's own classification, where it has one
    when o.shipment_outcome = 'delivered'                          then 'delivered'
    when o.shipment_outcome = 'returned'                           then 'returned'
    when o.shipment_outcome = 'lost'                               then 'lost'
    -- 2. otherwise the raw courier string, same precedence as the model:
    --    return family first, then delivered, then cancellation
    when coalesce(o.shipment_status, '') ~* '(rto|rts|return)'     then 'returned'
    when coalesce(o.shipment_status, '') ~* '\mlost\M'             then 'lost'
    when coalesce(o.shipment_status, '') ~* '\mdelivered\M'
     and coalesce(o.shipment_status, '') !~* '(undeliver|not deliver)' then 'delivered'
    when coalesce(o.shipment_status, '') ~* 'cancel'               then 'cancelled'
    -- 3. still moving: the attempt is open and gets no reason at all
    else null
  end as reason
) r
where (o.awb is not null or o.courier is not null)
  and nullif(btrim(lower(coalesce(o.courier, ''))), '') is not null
  -- Re-running must not duplicate. Deliberately not ON CONFLICT: an order that
  -- already has any attempt is left completely alone.
  and not exists (
    select 1 from public.shipment_attempts sa where sa.order_id = o.id
  );

commit;

-- Next: supabase/shipment-attempts-verify.sql -- read-only, and POST-APPLY
-- ONLY: it reads the table directly, so running it before this migration
-- errors rather than reporting. The pre-apply check is the production
-- preflight, which validates the data while the table still does not exist.
