-- Undo orders-history-forward.sql: drop get_store_orders_before.
--
-- Manage then reads only the newest 500 orders again: fetchOrders treats a
-- failed page as "older orders didn't load" and keeps what it has.
-- Nothing else is touched. Idempotent.

begin;

drop function if exists public.get_store_orders_before(text, text, timestamptz, uuid);

commit;
