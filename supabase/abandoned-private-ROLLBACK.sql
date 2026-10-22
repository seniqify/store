-- ===========================================================================
--  Abandoned carts stay private  --  UNDO
--
--  Puts the four functions back exactly as they were before
--  abandoned-private-forward.sql (copied byte for byte from the files that
--  installed them), so the shop again receives abandoned customers' numbers:
--
--    get_store_orders                 orders-separate-caps-forward.sql
--    get_store_abandoned_carts        abandoned-carts-forward.sql
--    get_store_abandoned_carts_since  abandoned-all-time-forward.sql
--    cart_reminder_statuses           messages-v2-forward.sql
--
--  It refuses unless each function is exactly the forward's version (or
--  already the old one, a harmless re-run). No data changes either way.
--
--  REVERT THE APP FIRST if you want the number back on screen: the app from
--  the same PR no longer shows it even when the database sends it.
--
--  RUN: Supabase Dashboard -> SQL Editor -> paste -> Run. Idempotent.
--  VERIFY afterwards: supabase/abandoned-private-verify.sql (P1 reads FAIL for
--  each function, naming the old md5 - the expected state after an undo).
-- ===========================================================================

begin;

do $guard$
declare
  r record;
  v_md5 text;
begin
  for r in
    select * from (values
      ('public.get_store_orders(text,text)',                            'e6696b5b2ce92b3832a053fb90851758', '412869d96684c8e66f2981e162005f4e'),
      ('public.get_store_abandoned_carts(text,text)',                   '981b255474df48093560d8e17019787a', 'c25c35db957bfbe7ad90abc9eea938dd'),
      ('public.get_store_abandoned_carts_since(text,text,timestamptz)', '1bc07513a01c452dacebc1d9f7c80640', 'c148f70a88bca87773d1b0986556bf4b'),
      ('public.cart_reminder_statuses(text,text)',                      '843ec185703173bee7b9c3da203760f2', 'b1599c1883ec69098091bebccf4371d9')
    ) as t(sig, new_md5, old_md5)
  loop
    select md5(replace(p.prosrc, chr(13), '')) into v_md5
      from pg_proc p where p.oid = to_regprocedure(r.sig);
    if v_md5 is null or v_md5 not in (r.new_md5, r.old_md5) then
      raise exception 'REFUSED - % is not the version this undo expects (md5 %) - nothing changed', r.sig, coalesce(v_md5, 'missing');
    end if;
  end loop;
end;
$guard$;

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
  -- Two separate caps: an abandoned checkout can never push a real order out.
  return query
    select u.* from (
      (select o.* from public.orders o
        where o.store_slug = p_slug
          and lower(coalesce(o.status, '')) <> 'abandoned'
        order by o.created_at desc
        limit 500)
      union all
      (select o.* from public.orders o
        where o.store_slug = p_slug
          and lower(coalesce(o.status, '')) = 'abandoned'
        order by o.created_at desc
        limit 300)
    ) u
    order by u.created_at desc;
end;
$function$;

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
    select t.id, t.created_at, t.customer_name::text, t.customer_phone::text,
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

  return query
    with tries as (
      select a.id, a.created_at, a.customer_name, a.customer_phone, a.items, a.total, a.destination,
             row_number() over (partition by a.customer_phone
                                order by a.created_at desc, a.id desc) as rn,
             count(*) over (partition by a.customer_phone) as n
        from public.orders a
       where a.store_slug = p_slug
         and lower(coalesce(a.status, '')) = 'abandoned'
         and (p_since is null or a.created_at >= p_since)
         and coalesce(a.customer_phone, '') <> ''
    )
    select t.id, t.created_at, t.customer_name::text, t.customer_phone::text,
           to_jsonb(t.items), t.total::numeric, t.n::integer, t.destination::text
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
             'phone', r.phone, 'status', r.status, 'source', r.source, 'sent_at', r.sent_at,
             'clicked_at', r.clicked_at, 'ordered_at', r.ordered_at,
             'next_at', r.created_at + interval '7 days'))
      from (select distinct on (c.phone) c.*
              from public.cart_reminders c
             where c.store_slug = p_slug and c.created_at > now() - interval '30 days'
             order by c.phone, c.created_at desc) r), '[]'::jsonb);
end;
$function$;

commit;
