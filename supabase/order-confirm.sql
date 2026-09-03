-- Buyer order confirmation (RTO / fake-order reduction) — Phase 1.
--
-- A buyer taps "Confirm my order" in WhatsApp, which opens
-- https://www.pocketlink.store/confirm/<confirm_token>. That page calls
-- confirm_order_by_token() to record the confirmation.
--
-- Design notes:
--  * confirm_token is a RANDOM uuid, not derived from the order id, so the link
--    is unguessable. The token IS the credential — there is no login.
--  * customer_confirmed_at is kept SEPARATE from status. status='confirmed'
--    already means "the seller accepted"; buyer verification is a different
--    fact, and merging them would corrupt the PLACED buckets used by the
--    profit/measurement queries. We only advance status when it is still 'new'.
--  * Idempotent: confirming twice changes nothing and returns already=true.

alter table public.orders add column if not exists confirm_token        uuid;
alter table public.orders add column if not exists customer_confirmed_at timestamptz;

-- Backfill existing rows, then make it automatic + unique for new ones.
update public.orders set confirm_token = gen_random_uuid() where confirm_token is null;
alter table public.orders alter column confirm_token set default gen_random_uuid();
alter table public.orders alter column confirm_token set not null;
create unique index if not exists orders_confirm_token_key on public.orders (confirm_token);

-- Fast lookup of unconfirmed orders for the seller's "needs confirmation" bucket.
create index if not exists orders_store_confirmed_idx
  on public.orders (store_slug, customer_confirmed_at);

create or replace function public.confirm_order_by_token(p_token uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  o             public.orders%rowtype;
  was_confirmed boolean;
  store_name    text;
begin
  select * into o from public.orders where confirm_token = p_token limit 1;
  if not found then
    return json_build_object('ok', false, 'reason', 'invalid');
  end if;

  if o.status = 'cancelled' then
    return json_build_object('ok', false, 'reason', 'cancelled');
  end if;

  was_confirmed := o.customer_confirmed_at is not null;

  if not was_confirmed then
    update public.orders
       set customer_confirmed_at = now(),
           status = case when status = 'new' then 'confirmed' else status end
     where id = o.id
     returning * into o;
  end if;

  select coalesce(config->>'businessName', slug) into store_name
    from public.stores where slug = o.store_slug;

  -- Deliberately NO phone / address / notes: the token is a credential and the
  -- page only needs enough for the buyer to recognise their own order.
  return json_build_object(
    'ok',          true,
    'already',     was_confirmed,
    'store',       coalesce(store_name, o.store_slug),
    'slug',        o.store_slug,
    'total',       o.total,
    'items',       o.item_count,
    'confirmedAt', o.customer_confirmed_at
  );
end;
$$;

grant execute on function public.confirm_order_by_token(uuid) to anon, authenticated;
