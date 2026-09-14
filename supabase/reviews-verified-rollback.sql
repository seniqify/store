-- ═══════════════════════════════════════════════════════════════════════════
--  Verified-purchase reviews — EMERGENCY ROLLBACK
--
--  !! THIS REOPENS THE FAKE-REVIEW HOLE. !!
--
--  Running this puts back anonymous review posting with a browser-chosen
--  status, the seller's hard delete (delete_review) and hide (set_review_status),
--  and the old store-wide rating. Use it only if the forward migration broke
--  something real that cannot be fixed forward quickly.
--
--  NOTHING IS LOST
--   • public.reviews was never modified by the forward migration.
--   • Every new review, report, invite and audit row is copied to a *_preserved
--     table BEFORE anything is dropped. Those copies are locked (no client
--     access) and are what a second attempt would re-import.
--   • The old table's policies and grants are restored from
--     reviews_access_preserved, which the forward migration filled before it
--     removed them -- so they come back exactly, names included.
--
--  The restored seller functions keep the PIN-throttle fix (they call
--  verify_store_pin). Deploy the previous website version alongside this.
--
--  RUN: Supabase Dashboard → SQL Editor → paste all → Run. One transaction.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- ── 0. Refuse to run if the old access rules cannot be restored ─────────────
do $preflight$
begin
  if to_regclass('public.reviews_access_preserved') is null then
    raise exception 'reviews_access_preserved is missing: the old policies cannot be restored exactly. Stop.';
  end if;
  if not exists (select 1 from public.reviews_access_preserved where kind = 'policy') then
    raise exception 'no saved policies for public.reviews: restoring would leave the old table unreadable. Stop.';
  end if;
end
$preflight$;


-- ── 1. Preserve everything the new system captured ──────────────────────────
do $keep$
declare t text;
begin
  foreach t in array array['product_reviews', 'review_reports', 'review_invites', 'review_audit'] loop
    if to_regclass('public.' || t) is not null then
      execute format('create table if not exists public.%I as select * from public.%I',
                     t || '_preserved', t);
      execute format('alter table public.%I enable row level security', t || '_preserved');
      execute format('revoke all on public.%I from public, anon, authenticated', t || '_preserved');
    end if;
  end loop;
end
$keep$;


-- ── 2. Remove the new system ────────────────────────────────────────────────
drop function if exists public.issue_review_invite(text, text, uuid);
drop function if exists public.get_review_invite(text);
drop function if exists public.submit_review(text, integer, integer, text, text, boolean);
drop function if exists public.get_owner_reviews(text, text);
drop function if exists public.reply_to_review(text, text, uuid, text);
drop function if exists public.report_review(text, text, uuid, text);
drop function if exists public.admin_list_review_reports();
drop function if exists public.admin_resolve_review_report(bigint, text, text);
drop function if exists public.review_product_id(jsonb, jsonb);

-- Dependents first: review_reports references product_reviews.
drop table if exists public.review_reports;
drop table if exists public.review_invites;
drop table if exists public.review_audit;
drop table if exists public.product_reviews;

drop function if exists public.review_rows_are_permanent();


-- ── 3. Restore the old seller functions, PIN-throttled ──────────────────────
-- Bodies as applied by pin-bypass-closure-forward.sql on 2026-09-13.

create or replace function public.get_store_reviews(p_slug text, p_hashed_pin text)
returns setof public.reviews
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
    select r.* from public.reviews r
    where r.store_slug = p_slug
    order by r.created_at desc;
end;
$function$;

create or replace function public.set_review_status(
  p_slug text, p_hashed_pin text, p_review_id uuid, p_status text)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
begin
  if not public.verify_store_pin(p_slug, p_hashed_pin) then
    return;
  end if;
  if p_status is null or p_status not in ('approved', 'hidden') then
    return;
  end if;
  update public.reviews set status = p_status
  where id = p_review_id and store_slug = p_slug;
end;
$function$;

create or replace function public.delete_review(
  p_slug text, p_hashed_pin text, p_review_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
begin
  if not public.verify_store_pin(p_slug, p_hashed_pin) then
    return;
  end if;
  delete from public.reviews where id = p_review_id and store_slug = p_slug;
end;
$function$;

-- Production had all three executable by anon (the Manage dashboard runs as anon).
grant execute on function public.get_store_reviews(text, text)             to anon, authenticated;
grant execute on function public.set_review_status(text, text, uuid, text) to anon, authenticated;
grant execute on function public.delete_review(text, text, uuid)           to anon, authenticated;


-- ── 4. Restore the old table's policies and grants, exactly as saved ────────
do $restore$
declare p record;
begin
  for p in select * from public.reviews_access_preserved where kind = 'policy' loop
    if not exists (select 1 from pg_policies
                    where schemaname = 'public' and tablename = 'reviews'
                      and policyname = p.name) then
      execute format('create policy %I on public.reviews as %s for %s to %s%s%s',
        p.name, p.permissive, p.cmd,
        (select string_agg(case when r = 'public' then 'public' else quote_ident(r) end, ', ')
           from unnest(p.roles) as r),
        case when p.qual       is not null then ' using (' || p.qual || ')' else '' end,
        case when p.with_check is not null then ' with check (' || p.with_check || ')' else '' end);
    end if;
  end loop;

  for p in select * from public.reviews_access_preserved where kind = 'grant' loop
    execute format('grant %s on public.reviews to %s', p.cmd,
                   case when p.name = 'PUBLIC' then 'public' else quote_ident(p.name) end);
  end loop;
end
$restore$;

commit;

-- After this: redeploy the previous website build, then check the storefront
-- shows its old ratings again.
