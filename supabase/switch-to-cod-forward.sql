-- ===========================================================================
--  Switch an unpaid online order to cash on delivery  --  FORWARD
--
--  2026-10-23, Payments redesign (founder-approved): on "Online payments that
--  didn't go through", a shop can save the sale when the buyer agrees on
--  WhatsApp to pay cash instead. Until now nothing could change an order's
--  payment method, so the shop had to cancel it and ask the buyer to order
--  again.
--
--  Adds ONE function, switch_order_to_cod(slug, pin, order id) -> boolean. It
--  changes payment_method to 'cod', and ONLY on an order that is:
--    * this store's,
--    * payment_method 'online',
--    * not paid, with no Razorpay payment reference (the money never came),
--    * not cancelled or abandoned.
--  Anything else is left alone and the call returns false. It never touches
--  paid, paid_at, paid_via, payment_ref, status or any other column.
--
--  The order then counts as a cash-on-delivery sale, exactly as if the buyer
--  had picked COD: orders_payment_automation marks it paid when it is
--  delivered. That trigger fires on status and shipment_status only, so this
--  update itself sets nothing in motion.
--
--  PIN-checked once, before anything, like update_order_status. A wrong PIN
--  returns false. VOLATILE, SECURITY DEFINER, pinned search_path; PUBLIC is
--  revoked and the browser roles are granted explicitly.
--
--  Nothing that exists is changed.
--
--  RUN: Supabase Dashboard -> SQL Editor -> paste -> Run. Idempotent.
--  VERIFY afterwards: supabase/switch-to-cod-verify.sql (every S row PASS)
--  UNDO: supabase/switch-to-cod-ROLLBACK.sql
-- ===========================================================================

begin;

do $preflight$
declare
  v_md5 text;
begin
  if to_regprocedure('public.verify_store_pin(text,text)') is null then
    raise exception 'preflight: public.verify_store_pin(text,text) is missing - nothing changed';
  end if;
  if (select count(*) from information_schema.columns
       where table_schema = 'public' and table_name = 'orders'
         and column_name in ('id', 'store_slug', 'status', 'payment_method', 'paid', 'payment_ref')) <> 6 then
    raise exception 'preflight: public.orders is missing a column this function reads - nothing changed';
  end if;
  select md5(replace(p.prosrc, chr(13), '')) into v_md5
    from pg_proc p
   where p.oid = to_regprocedure('public.switch_order_to_cod(text,text,uuid)');
  if v_md5 is not null and v_md5 <> '0f958608466f4468a9320862e5b4a0d6' then
    raise exception 'preflight: a different switch_order_to_cod already exists (md5 %) - nothing changed', v_md5;
  end if;
end;
$preflight$;

create or replace function public.switch_order_to_cod(
  p_slug       text,
  p_hashed_pin text,
  p_order_id   uuid
)
returns boolean
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
begin
  if not public.verify_store_pin(p_slug, p_hashed_pin) then
    return false;
  end if;

  -- Only an online order whose money never came. The conditions are the
  -- app's "payment not completed / not confirmed" rule minus the shipping
  -- part: a shipped order the buyer never paid for can be switched too.
  update public.orders o
     set payment_method = 'cod'
   where o.id = p_order_id
     and o.store_slug = p_slug
     and lower(coalesce(o.payment_method, '')) = 'online'
     and o.paid is not true
     and coalesce(o.payment_ref, '') = ''
     and lower(coalesce(o.status, '')) not in ('cancelled', 'abandoned');

  return found;
end;
$function$;

comment on function public.switch_order_to_cod(text, text, uuid) is
  'PIN-checked: change an unpaid online order (no payment reference, not cancelled) to cash on delivery. Returns whether it changed.';

revoke all on function public.switch_order_to_cod(text, text, uuid) from public;
grant execute on function public.switch_order_to_cod(text, text, uuid)
  to anon, authenticated, service_role;

commit;
