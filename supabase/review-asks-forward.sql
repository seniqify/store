-- ===========================================================================
-- Ask for reviews without searching (2026-11-16, founder: "i need to search
-- which order got delivered and then ask for a review and click one by one ...
-- cant we do something easy for this").
--
-- The Reviews tab now lists every delivered order and who was already asked.
-- For that the seller needs to read two things the browser cannot see today:
--
-- 1. get_review_asks(slug, hashed_pin): per order of this store, when it was
--    last asked for a review (review_invites.issued_at, revoked links included,
--    so asking again counts), the first time, how many times, and whether the
--    shop said "don't ask". Order ids and times only: no token, no phone.
-- 2. set_review_ask_skip(slug, hashed_pin, order_id, skip): the shop's
--    "Don't ask this customer" (skip = true) and its undo (skip = false).
--    Stored in the new table review_ask_skips. Nothing else reads it.
--
-- Additive only: no existing table, function or grant is changed.
--
-- RUN: Supabase Dashboard -> SQL Editor -> paste -> Run. Idempotent.
-- VERIFY afterwards: supabase/review-asks-verify.sql (every A row PASS)
-- UNDO: supabase/review-asks-ROLLBACK.sql
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Preflight: the verified-reviews tables and the PIN check must exist.
-- ---------------------------------------------------------------------------
do $preflight$
begin
  if to_regclass('public.review_invites') is null then
    raise exception 'preflight: public.review_invites missing (apply reviews-verified-forward.sql first) - nothing changed';
  end if;
  if to_regclass('public.orders') is null then
    raise exception 'preflight: public.orders missing - nothing changed';
  end if;
  if to_regprocedure('public.verify_store_pin(text,text)') is null then
    raise exception 'preflight: verify_store_pin missing - nothing changed';
  end if;
end;
$preflight$;

-- ---------------------------------------------------------------------------
-- 2. "Don't ask this customer": one row per order the shop skipped.
-- ---------------------------------------------------------------------------
create table if not exists public.review_ask_skips (
  order_id    uuid        primary key,
  store_slug  text        not null,
  skipped_at  timestamptz not null default now()
);

comment on table public.review_ask_skips is
  'Orders a shop chose not to ask for a review. Written and read only through '
  'set_review_ask_skip / get_review_asks (PIN-checked).';

create index if not exists review_ask_skips_store_idx on public.review_ask_skips (store_slug);

alter table public.review_ask_skips enable row level security;
revoke all on public.review_ask_skips from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Who was asked, and when. Same shape of PIN check as get_owner_reviews:
--    a wrong PIN returns no rows.
-- ---------------------------------------------------------------------------
create or replace function public.get_review_asks(p_slug text, p_hashed_pin text)
returns table (
  order_id uuid, asked_at timestamptz, first_asked_at timestamptz,
  ask_count integer, skipped_at timestamptz)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
#variable_conflict use_column
begin
  if not public.verify_store_pin(p_slug, p_hashed_pin) then
    return;
  end if;
  return query
    with asks as (
      select i.order_id as oid, max(i.issued_at) as last_at, min(i.issued_at) as first_at,
             count(*)::integer as n
        from public.review_invites i
       where i.store_slug = p_slug
       group by i.order_id
    ), skips as (
      select k.order_id as oid, k.skipped_at as at
        from public.review_ask_skips k
       where k.store_slug = p_slug
    )
    select coalesce(a.oid, s.oid), a.last_at, a.first_at, coalesce(a.n, 0), s.at
      from asks a
      full join skips s on s.oid = a.oid
     limit 20000;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 4. "Don't ask" and its undo. The order must belong to this store.
-- ---------------------------------------------------------------------------
create or replace function public.set_review_ask_skip(
  p_slug text, p_hashed_pin text, p_order_id uuid, p_skip boolean)
returns boolean
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
begin
  if not public.verify_store_pin(p_slug, p_hashed_pin) then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  if not exists (select 1 from public.orders o where o.id = p_order_id and o.store_slug = p_slug) then
    raise exception 'order not found for this store' using errcode = 'P0002';
  end if;

  if coalesce(p_skip, true) then
    insert into public.review_ask_skips (order_id, store_slug)
    values (p_order_id, p_slug)
    on conflict (order_id) do nothing;
  else
    delete from public.review_ask_skips k
     where k.order_id = p_order_id and k.store_slug = p_slug;
  end if;
  return coalesce(p_skip, true);
end;
$function$;

-- ---------------------------------------------------------------------------
-- 5. Who may call them (revoked BY NAME first: Supabase's default privileges
--    grant EXECUTE on every new function). The PIN is checked inside.
-- ---------------------------------------------------------------------------
revoke all on function public.get_review_asks(text, text)                      from public, anon, authenticated;
revoke all on function public.set_review_ask_skip(text, text, uuid, boolean)   from public, anon, authenticated;
grant execute on function public.get_review_asks(text, text)                    to anon, authenticated, service_role;
grant execute on function public.set_review_ask_skip(text, text, uuid, boolean) to anon, authenticated, service_role;

commit;
