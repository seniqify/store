-- ===========================================================================
--  Payments section -- ROLLBACK
--
--  Restores set_order_paid exactly as pin-bypass-closure-forward.sql left it.
--
--  The new columns are deliberately KEPT: they hold real payment times and
--  payment links, dropping them would lose that data, and the deployed
--  payments-verify / payments-link functions write to them. Old code simply
--  ignores them.
--
--  RUN: Supabase Dashboard -> SQL Editor -> paste all -> Run. One transaction.
-- ===========================================================================

begin;

create or replace function public.set_order_paid(
  p_slug text, p_hashed_pin text, p_order_id uuid, p_paid boolean)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
begin
  if public.verify_store_pin(p_slug, p_hashed_pin) then
    update public.orders set paid = p_paid
    where id = p_order_id and store_slug = p_slug;
  end if;
end;
$function$;

commit;
