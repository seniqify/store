-- ===========================================================================
--  Commerce metrics, PR 1  --  get_store_order_facts
--
--  An uncapped, PII-free, scalar-only feed of a store's orders, for computing
--  commerce metrics. It exists because get_store_orders is capped:
--
--      select o.* from public.orders o
--       where o.store_slug = p_slug
--       order by o.created_at desc
--       limit 500                       <-- silently drops the OLDEST orders
--
--  royalfoodsmasale has 447 rows, 246 of them abandoned checkouts. At the cap
--  all-time Gross Sales starts FALLING as new orders arrive, because the oldest
--  paid orders fall off the end. That is the bug this function removes.
--
--  THIS MIGRATION CHANGES NOTHING THAT EXISTS.
--    * get_store_orders is NOT modified and keeps its LIMIT 500. It remains the
--      feed for the Orders list, where a cap is correct -- nobody scrolls ten
--      thousand rows -- and for the two Stats panels that need order `items`.
--    * No table, trigger, policy or grant on public.orders is touched.
--    * NOTHING CONSUMES THIS FUNCTION YET. The client keeps using
--      get_store_orders exactly as it does today. PR 3 adds the canonical
--      metrics model, PRs 4-8 move the screens onto it one at a time.
--
--  RUN: Supabase Dashboard -> SQL Editor -> paste -> Run. Idempotent.
--  VERIFY (before AND after): supabase/order-facts-verify.sql
--  UNDO: supabase/order-facts-ROLLBACK.sql
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. The feed
--
-- RETURNS TABLE with an explicit column list, deliberately, rather than
-- SETOF orders. The projection is then part of the function's signature: a
-- later edit cannot quietly widen it to `select o.*` and start shipping
-- customer names and phone numbers to the browser without changing the
-- declared type -- which the verifier and the test suite both check.
--
-- SIXTEEN COLUMNS, each one required by the canonical metrics model:
--
--   id                 key a row without exposing anything about the customer
--   created_at         order-dated metrics: counts, gross sales, the sparkline
--   status             cancelled / abandoned / delivered classification
--   payment_method     cod vs online, and the COD receivable split
--   total              the money in every financial identity
--   paid               collected vs outstanding
--   paid_at            WHEN money arrived -- null means "collected, time
--                      unknown", which is a real and load-bearing value
--   paid_via           razorpay / payment_link / cod_delivery / seller
--   payment_ref        needed by isPaymentIncomplete
--   payment_link_id    a link sent and not yet paid
--   awb                membership of the delivery population
--   courier            the per-courier counts on the delivery board
--   shipment_status    legacy fallback for shipment classification
--   shipment_outcome   the DB-authoritative delivered / returned / lost
--   delivered_at       the collection event for cod_delivery
--   returned_at        when a return was recorded
--
-- DELIBERATELY ABSENT -- every one of these is in `orders` and none is needed:
--   customer_name, customer_phone, destination, pincode, notes  (PII)
--   items, item_count                                            (bulk; the two
--                                                                 Stats panels
--                                                                 that need
--                                                                 items stay on
--                                                                 get_store_orders)
--   fbp, fbc, client_ua                                          (ad identifiers)
--   confirm_token                                                (a credential)
--   subtotal, tax, shipping, packaging, cod_fee, shipping_cost   (no identity
--                                                                 uses them;
--                                                                 profit does,
--                                                                 and profit
--                                                                 needs items)
--
-- Measured on royalfoodsmasale: 92 bytes/row here against 500 bytes/row for the
-- full row -- 40 kB instead of 218 kB for the same 447 orders. A store with
-- 50,000 orders would send about 4.6 MB, so there is room for two orders of
-- magnitude of growth before a bound is worth discussing. If one is ever
-- needed it must arrive WITH a row count and a visible "showing N of M",
-- because a cap the merchant cannot see is exactly the bug being fixed here.
-- ---------------------------------------------------------------------------
create or replace function public.get_store_order_facts(p_slug text, p_hashed_pin text)
returns table (
  id                uuid,
  created_at        timestamptz,
  status            text,
  payment_method    text,
  total             numeric,
  paid              boolean,
  paid_at           timestamptz,
  paid_via          text,
  payment_ref       text,
  payment_link_id   text,
  awb               text,
  courier           text,
  shipment_status   text,
  shipment_outcome  text,
  delivered_at      timestamptz,
  returned_at       timestamptz
)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
begin
  -- Identical gate to get_store_orders: a wrong PIN yields an empty set, never
  -- an error, so nothing leaks about whether the store exists. verify_store_pin
  -- records failures and is throttled (phase 3A); a SUCCESS is never recorded,
  -- so adding this second call costs the merchant nothing from their budget.
  if not public.verify_store_pin(p_slug, p_hashed_pin) then
    return;
  end if;

  -- Every reference is qualified with the alias. The RETURNS TABLE column names
  -- are plpgsql variables in this scope, and an unqualified `status` or `total`
  -- would be ambiguous.
  return query
    select o.id, o.created_at, o.status, o.payment_method, o.total,
           o.paid, o.paid_at, o.paid_via, o.payment_ref, o.payment_link_id,
           o.awb, o.courier, o.shipment_status, o.shipment_outcome,
           o.delivered_at, o.returned_at
      from public.orders o
     where o.store_slug = p_slug
     -- No LIMIT. That is the entire point of this function.
     -- id breaks ties so the order is deterministic across calls.
     order by o.created_at desc, o.id desc;
end;
$function$;

comment on function public.get_store_order_facts(text, text) is
  'Uncapped, PII-free scalar feed of a store PIN-checked order facts, for commerce metrics. get_store_orders stays capped for the order list.';

-- ---------------------------------------------------------------------------
-- 2. Who may call it
--
-- Same merchant authorization boundary as get_store_orders: the browser calls
-- it as anon (or authenticated) and proves itself with the store PIN.
--
-- ONE DELIBERATE TIGHTENING. PostgreSQL grants EXECUTE on every new function to
-- PUBLIC automatically, which is why get_store_orders carries `=X/postgres` in
-- its ACL. PUBLIC is revoked here and the three roles that actually call it are
-- granted explicitly. The effective boundary is identical -- anon and
-- authenticated are the only browser roles -- but nothing is granted by
-- accident. This is the same default that made upgrade_store_plan
-- anon-callable, so it is not left to chance in new code.
-- ---------------------------------------------------------------------------
revoke all on function public.get_store_order_facts(text, text) from public;

grant execute on function public.get_store_order_facts(text, text)
  to anon, authenticated, service_role;

commit;

-- ===========================================================================
--  AFTER RUNNING
--
--  Re-run supabase/order-facts-verify.sql and compare with the baseline.
--  Required:
--    * G1 get_store_orders source md5 IDENTICAL -- still capped at 500
--    * G2 its grants IDENTICAL
--    * G3 public.orders untouched: same triggers, same policies, same grants
--    * F1..F8 the new function exists, is definer, is pinned, is PIN-gated,
--      has no LIMIT, returns exactly the 16 declared columns, and PUBLIC
--      cannot execute it
--
--  Nothing to deploy. No client code calls this function yet.
-- ===========================================================================
