-- ===========================================================================
--  Abandoned carts stay private  --  FORWARD
--
--  2026-10-22, founder: shops were copying abandoned customers' numbers out of
--  Manage and messaging them by hand, so nobody topped up the wallet. From now
--  on only PocketLink knows an abandoned customer's number; the shop reaches
--  them through PocketLink's paid reminder (the wallet), never directly.
--
--  Hiding the number on screen is not enough: Manage receives it from the
--  database and anyone can read it in the browser. So the database stops
--  sending it. Four PIN-checked functions handed it to the shop:
--
--    get_store_orders                 carried the newest 300 abandoned
--                                     checkouts in full (number, address).
--                                     No screen used them; they are no longer
--                                     sent. It returns the newest 500 real
--                                     orders, exactly as before.
--    get_store_abandoned_carts        Home + Abandoned tab "Last 30 days":
--                                     customer_phone is now always NULL.
--    get_store_abandoned_carts_since  Abandoned tab "All time": customer_phone
--                                     and destination are now always NULL.
--    cart_reminder_statuses           each reminded customer's latest reminder,
--                                     keyed by phone: now keyed by `cart_id`,
--                                     the customer's latest abandoned cart (the
--                                     row the two cart functions list), and no
--                                     phone.
--
--  Every rule, column list and grant is otherwise unchanged; the return types
--  are identical, so the screens keep working. A customer who places an order
--  is a buyer: their number reaches the shop with that order, as always.
--
--  NOT changed: the number stays in public.orders, and the reminder machinery
--  (cart_reminders_due, cart_reminder_claim, the cart-reminders functions)
--  reads it server-side to send the WhatsApp message.
--
--  RUN: Supabase Dashboard -> SQL Editor -> paste -> Run. Idempotent.
--  VERIFY afterwards: supabase/abandoned-private-verify.sql (every P row PASS)
--  UNDO: supabase/abandoned-private-ROLLBACK.sql
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Preflight: each function must be exactly the reviewed live version (or
--    already this one, a harmless re-run). Anything else stops with nothing
--    changed.
-- ---------------------------------------------------------------------------
do $preflight$
declare
  r record;
  v_md5 text;
begin
  for r in
    select * from (values
      ('public.get_store_orders(text,text)',                              '412869d96684c8e66f2981e162005f4e', 'e6696b5b2ce92b3832a053fb90851758'),
      ('public.get_store_abandoned_carts(text,text)',                     'c25c35db957bfbe7ad90abc9eea938dd', '981b255474df48093560d8e17019787a'),
      ('public.get_store_abandoned_carts_since(text,text,timestamptz)',   'c148f70a88bca87773d1b0986556bf4b', '1bc07513a01c452dacebc1d9f7c80640'),
      ('public.cart_reminder_statuses(text,text)',                        'b1599c1883ec69098091bebccf4371d9',                 '843ec185703173bee7b9c3da203760f2')
    ) as t(sig, old_md5, new_md5)
  loop
    select md5(replace(p.prosrc, chr(13), '')) into v_md5
      from pg_proc p where p.oid = to_regprocedure(r.sig);
    if v_md5 is null then
      raise exception 'preflight: % is missing - nothing changed', r.sig;
    end if;
    if v_md5 not in (r.old_md5, r.new_md5) then
      raise exception 'preflight: % is not the reviewed version (md5 %) - nothing changed', r.sig, v_md5;
    end if;
  end loop;
end;
$preflight$;

-- ---------------------------------------------------------------------------
-- 2. get_store_orders: the newest 500 real orders, and no abandoned checkouts.
--    The real half is the reviewed body unchanged (orders-separate-caps).
-- ---------------------------------------------------------------------------
create or replace function public.get_store_orders(p_slug text, p_hashed_pin text)
returns setof public.orders
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
begin
  if not public.verify_store_pin(p_slug, p_hashed_pin) then
    return;                       -- empty set, exactly as before
  end if;
  -- Real orders only. Abandoned checkouts are not sent to the shop at all:
  -- their numbers are PocketLink's (2026-10-22), and the Abandoned tab reads
  -- get_store_abandoned_carts, which withholds them.
  return query
    select o.* from public.orders o
     where o.store_slug = p_slug
       and lower(coalesce(o.status, '')) <> 'abandoned'
     order by o.created_at desc
     limit 500;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 3. get_store_abandoned_carts: the same rows, the number withheld.
-- ---------------------------------------------------------------------------
create or replace function public.get_store_abandoned_carts(p_slug text, p_hashed_pin text)
returns table (
  id              uuid,
  created_at      timestamptz,
  customer_name   text,
  customer_phone  text,
  items           jsonb,
  total           numeric,
  attempts        integer
)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
declare
  -- 00:00 IST, 29 days ago: 30 merchant civil days ending today, today included.
  v_since timestamptz :=
    (date_trunc('day', now() at time zone 'Asia/Kolkata') - interval '29 days') at time zone 'Asia/Kolkata';
begin
  if not public.verify_store_pin(p_slug, p_hashed_pin) then
    return;
  end if;

  -- The phone still groups the rows and decides who has ordered since; it is
  -- never returned (customer_phone is NULL): only PocketLink reaches them.
  return query
    with tries as (
      select a.id, a.created_at, a.customer_name, a.customer_phone, a.items, a.total,
             row_number() over (partition by a.customer_phone
                                order by a.created_at desc, a.id desc) as rn,
             count(*) over (partition by a.customer_phone) as n
        from public.orders a
       where a.store_slug = p_slug
         and lower(coalesce(a.status, '')) = 'abandoned'
         and a.created_at >= v_since
         and coalesce(a.customer_phone, '') <> ''
    )
    select t.id, t.created_at, t.customer_name::text, null::text,
           to_jsonb(t.items), t.total::numeric, t.n::integer
      from tries t
     where t.rn = 1
       and not exists (
         select 1
           from public.orders r
          where r.store_slug = p_slug
            and r.customer_phone = t.customer_phone
            and lower(coalesce(r.status, '')) <> 'abandoned'
            and r.created_at >= t.created_at)
     order by t.created_at desc, t.id desc;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 4. get_store_abandoned_carts_since: the same rows, number and address withheld.
-- ---------------------------------------------------------------------------
create or replace function public.get_store_abandoned_carts_since(
  p_slug       text,
  p_hashed_pin text,
  p_since      timestamptz
)
returns table (
  id              uuid,
  created_at      timestamptz,
  customer_name   text,
  customer_phone  text,
  items           jsonb,
  total           numeric,
  attempts        integer,
  destination     text
)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
begin
  if not public.verify_store_pin(p_slug, p_hashed_pin) then
    return;
  end if;

  -- As get_store_abandoned_carts: the phone groups the rows and is never
  -- returned, and neither is the address typed at checkout.
  return query
    with tries as (
      select a.id, a.created_at, a.customer_name, a.customer_phone, a.items, a.total,
             row_number() over (partition by a.customer_phone
                                order by a.created_at desc, a.id desc) as rn,
             count(*) over (partition by a.customer_phone) as n
        from public.orders a
       where a.store_slug = p_slug
         and lower(coalesce(a.status, '')) = 'abandoned'
         and (p_since is null or a.created_at >= p_since)
         and coalesce(a.customer_phone, '') <> ''
    )
    select t.id, t.created_at, t.customer_name::text, null::text,
           to_jsonb(t.items), t.total::numeric, t.n::integer, null::text
      from tries t
     where t.rn = 1
       and not exists (
         select 1
           from public.orders r
          where r.store_slug = p_slug
            and r.customer_phone = t.customer_phone
            and lower(coalesce(r.status, '')) <> 'abandoned'
            and r.created_at >= t.created_at)
     order by t.created_at desc, t.id desc;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 5. cart_reminder_statuses: keyed by the customer's latest abandoned cart
--    (the `id` the two cart functions return for them), not by phone.
-- ---------------------------------------------------------------------------
create or replace function public.cart_reminder_statuses(p_slug text, p_hashed_pin text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
begin
  if not public.verify_store_pin(p_slug, p_hashed_pin) then
    return null;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'cart_id', (select a.id from public.orders a
                          where a.store_slug = p_slug
                            and a.customer_phone = r.phone
                            and lower(coalesce(a.status, '')) = 'abandoned'
                          order by a.created_at desc, a.id desc
                          limit 1),
             'status', r.status, 'source', r.source, 'sent_at', r.sent_at,
             'clicked_at', r.clicked_at, 'ordered_at', r.ordered_at,
             'next_at', r.created_at + interval '7 days'))
      from (select distinct on (c.phone) c.*
              from public.cart_reminders c
             where c.store_slug = p_slug and c.created_at > now() - interval '30 days'
             order by c.phone, c.created_at desc) r), '[]'::jsonb);
end;
$function$;

commit;
