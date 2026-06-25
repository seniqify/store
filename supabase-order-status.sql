-- ─────────────────────────────────────────────────────────────────────────────
-- Order-status updates: allow the new "Out for delivery" (dispatched) status.
--
-- Run this ONCE in the Supabase SQL editor before using the "Out for delivery"
-- button in Manage → Orders. Safe to re-run.
--
-- This only matters if orders.status has a CHECK constraint restricting its
-- values. If it doesn't, this simply (re)creates one that permits the full set
-- the app uses. Existing rows already use a subset of these values, so the new
-- constraint validates cleanly.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.orders drop constraint if exists orders_status_check;

alter table public.orders
  add constraint orders_status_check
  check (status in ('new', 'confirmed', 'dispatched', 'delivered', 'cancelled'));
