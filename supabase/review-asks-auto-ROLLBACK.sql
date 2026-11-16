-- ===========================================================================
-- UNDO supabase/review-asks-auto-forward.sql
--
-- First stop the sweep:  select cron.unschedule('pocketlink-review-asks');
-- Then run this. It removes the automatic/"Ask all" functions, the send record
-- and the shop settings columns, and puts get_review_asks back to its part-1
-- shape (no `source`). Review links already sent keep working: they are rows in
-- review_invites, which stays. Coins already spent are not refunded by this.
-- ===========================================================================

begin;

drop function if exists public.review_asks_due(integer, timestamptz);
drop function if exists public.review_ask_claim(uuid, text, text, text);
drop function if exists public.review_ask_finish(uuid, boolean, integer, text, text);
drop function if exists public.review_asks_expire_stuck();
drop function if exists public.set_review_ask_auto(text, text, boolean, integer, text, boolean, boolean);
drop function if exists public.get_review_ask_auto(text, text);
drop function if exists public.review_ask_fresh(uuid);
drop function if exists public.review_ask_ok(public.orders, jsonb);
drop function if exists public.review_ask_price_paise();
drop table if exists public.review_ask_sends;

alter table public.store_message_settings drop constraint if exists store_message_settings_review_ask_days_check;
alter table public.store_message_settings drop constraint if exists store_message_settings_review_ask_lang_check;
alter table public.store_message_settings drop column if exists review_ask_auto;
alter table public.store_message_settings drop column if exists review_ask_days;
alter table public.store_message_settings drop column if exists review_ask_lang;
alter table public.store_message_settings drop column if exists review_ask_couriers;
alter table public.store_message_settings drop column if exists review_ask_manual;
alter table public.store_message_settings drop column if exists review_ask_since;

delete from public.automation_secrets where name = 'review-asks';

-- get_review_asks exactly as review-asks-forward.sql made it.
drop function if exists public.get_review_asks(text, text);
create function public.get_review_asks(p_slug text, p_hashed_pin text)
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
revoke all on function public.get_review_asks(text, text) from public, anon, authenticated;
grant execute on function public.get_review_asks(text, text) to anon, authenticated, service_role;

commit;
