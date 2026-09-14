-- ===========================================================================
--  Automatic payment status -- COD collected / returned without anyone marking
--  PREPARED FOR REVIEW. NOT APPLIED.
--
--  WHY
--   Sellers had to tap "Mark collected" on COD orders the courier had already
--   delivered, so delivered money sat in "still to collect" (153 COD orders,
--   Rs 2,90,060 on 2026-09-15, about 58 of them already delivered).
--
--  WHAT THIS DOES
--   orders.shipment_outcome   delivered | returned | lost, read from the courier
--                             status (or the order being marked delivered)
--   orders.delivered_at / returned_at
--   shipment_outcome_of()     the one reading of courier status texts. Matched
--                             against the real values in production:
--                               delivered: "Delivered"
--                               returned:  "Returned To Seller", "Returned To
--                                          Client", "In Transit for Return",
--                                          "In RTO/RTS Process", "RTO", "rts_*"
--                               lost:      "Lost"
--                             Returned is tested FIRST, so a return that also
--                             says "delivered" is never counted as collected.
--   orders_payment_automation (BEFORE trigger) when the outcome CHANGES:
--     delivered -> delivered_at = now(); status new/confirmed/dispatched ->
--                  'delivered'; a COD order not yet paid becomes paid
--                  (paid_via 'cod_delivery', paid_at = now()).
--     returned / lost -> returned_at = now(); if it had been auto-collected,
--                  that is undone.
--     It acts only on a change of outcome, so a seller who later corrects the
--     payment by hand is not overridden on the next status refresh.
--   Existing orders are brought up to date once, BEFORE the trigger exists, with
--   paid_at / delivered_at left empty: their real times were never recorded, and
--   stamping now() would pile months of COD onto today's total.
--   automation_secrets        the shared secret the scheduled status sweep sends
--                             (read only with the service role).
--
--  ORDER OF OPERATIONS
--   1. Apply this. 2. payments-automation-verify.sql (read-only, all PASS).
--   3. Deploy edge functions: status-sweep (new), shipping-sync, shipping-ops,
--      payments-link, and the PIN-gate fixes.
--   4. Apply payments-automation-schedule.sql (every 30 minutes).
--   5. Deploy the website.
--
--  RUN: Supabase Dashboard -> SQL Editor -> paste all -> Run. One transaction.
--  Re-running is safe.
-- ===========================================================================

begin;

do $preflight$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'orders' and column_name = 'paid_via') then
    raise exception 'preflight: apply payments-tracking.sql first';
  end if;
end
$preflight$;

alter table public.orders add column if not exists shipment_outcome text;
alter table public.orders add column if not exists delivered_at     timestamptz;
alter table public.orders add column if not exists returned_at      timestamptz;

alter table public.orders drop constraint if exists orders_shipment_outcome_known;
alter table public.orders add constraint orders_shipment_outcome_known
  check (shipment_outcome is null or shipment_outcome in ('delivered', 'returned', 'lost'));

alter table public.orders drop constraint if exists orders_paid_via_known;
alter table public.orders add constraint orders_paid_via_known
  check (paid_via is null or paid_via in ('razorpay', 'payment_link', 'seller', 'cod_delivery'));

comment on column public.orders.shipment_outcome is
  'delivered | returned | lost. Set by orders_payment_automation from the courier status or the order status.';

-- Deliberately NOT revoked from anon: the trigger runs as whoever writes the
-- order, and checkout inserts orders as anon. It is a pure string function.
create or replace function public.shipment_outcome_of(p_status text, p_order_status text default null)
returns text
language sql
immutable
set search_path = pg_catalog, pg_temp
as $function$
  select case
    when coalesce(p_status, '') ~* '(rto|rts|return)'              then 'returned'
    when coalesce(p_status, '') ~* '\mlost\M'                      then 'lost'
    when coalesce(p_status, '') ~* '\mdelivered\M'
     and coalesce(p_status, '') !~* '(undeliver|not deliver)'      then 'delivered'
    when coalesce(p_order_status, '') = 'delivered'                 then 'delivered'
    else null
  end;
$function$;


-- ── Bring existing orders up to date, BEFORE the trigger exists ─────────────
with x as (
  select o.id, public.shipment_outcome_of(o.shipment_status, o.status) as outcome
    from public.orders o
   where o.shipment_outcome is null
     and coalesce(o.status, '') not in ('cancelled', 'abandoned')
)
update public.orders o
   set shipment_outcome = x.outcome,
       status   = case when x.outcome = 'delivered' and o.status in ('new', 'confirmed', 'dispatched')
                       then 'delivered' else o.status end,
       paid     = case when x.outcome = 'delivered' and lower(coalesce(o.payment_method, '')) = 'cod'
                        and not coalesce(o.paid, false) then true else o.paid end,
       paid_via = case when x.outcome = 'delivered' and lower(coalesce(o.payment_method, '')) = 'cod'
                        and not coalesce(o.paid, false) then 'cod_delivery' else o.paid_via end
  from x
 where o.id = x.id
   and x.outcome is not null;


-- ── From now on, automatically ──────────────────────────────────────────────
create or replace function public.orders_payment_automation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $function$
declare
  v_out text;
begin
  if coalesce(NEW.status, '') in ('cancelled', 'abandoned') then
    return NEW;
  end if;

  v_out := public.shipment_outcome_of(NEW.shipment_status, NEW.status);
  if v_out is null then
    return NEW;
  end if;
  -- Only a CHANGE of outcome acts. A later manual correction by the seller is
  -- left alone on the next status refresh.
  if TG_OP = 'UPDATE' and OLD.shipment_outcome is not distinct from v_out then
    return NEW;
  end if;

  NEW.shipment_outcome := v_out;

  if v_out = 'delivered' then
    NEW.delivered_at := coalesce(NEW.delivered_at, now());
    if coalesce(NEW.status, '') in ('new', 'confirmed', 'dispatched') then
      NEW.status := 'delivered';
    end if;
    if lower(coalesce(NEW.payment_method, '')) = 'cod' and not coalesce(NEW.paid, false) then
      NEW.paid     := true;
      NEW.paid_at  := coalesce(NEW.paid_at, now());
      NEW.paid_via := 'cod_delivery';
    end if;
  else
    NEW.returned_at := coalesce(NEW.returned_at, now());
    -- Counted as collected on delivery, then came back: it was never collected.
    if NEW.paid_via = 'cod_delivery' then
      NEW.paid     := false;
      NEW.paid_at  := null;
      NEW.paid_via := null;
    end if;
  end if;

  return NEW;
end;
$function$;

drop trigger if exists orders_payment_automation on public.orders;
create trigger orders_payment_automation
  before insert or update of status, shipment_status on public.orders
  for each row execute function public.orders_payment_automation();

revoke all on function public.orders_payment_automation() from public, anon, authenticated;


-- ── Secret for the scheduled status sweep ───────────────────────────────────
create table if not exists public.automation_secrets (
  name       text        primary key,
  secret     text        not null,
  created_at timestamptz not null default now()
);
alter table public.automation_secrets enable row level security;
revoke all on public.automation_secrets from public, anon, authenticated;

insert into public.automation_secrets (name, secret)
values ('status-sweep', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
on conflict (name) do nothing;

commit;

-- Next: supabase/payments-automation-verify.sql (read-only). Every row must PASS.
