-- ═══════════════════════════════════════════════════════════════════════════
--  Verified-purchase reviews — FORWARD MIGRATION
--  APPLIED TO PRODUCTION 2026-09-14. Verified: every reviews-verified-verify.sql row PASS.
-- ═══════════════════════════════════════════════════════════════════════════
--
--  WHAT IS WRONG TODAY
--
--   1. public.reviews accepts an anonymous INSERT in which the BROWSER supplies
--      status = 'approved'. No order, no product, no customer. Anyone who knows
--      a store link can post unlimited reviews to it -- including the seller.
--   2. Sellers can hard-delete any review (delete_review). A one-star review
--      disappears without trace.
--   3. A review belongs to the whole store, never to what the customer bought.
--
--  WHAT THIS DOES
--
--   • product_reviews   the new record. One review per item of one delivered
--                       order, tied to the product. Publicly readable only as
--                       published rows and only the safe columns.
--   • review_invites    the ONLY way to write a review. The seller creates one
--                       for a delivered order (PIN-gated, order re-read on the
--                       server); the customer gets a link. Only the sha256 of
--                       the token is stored.
--   • review_reports    a seller cannot delete or hide a review. They can reply
--                       publicly, or report it with a reason. PocketLink (a
--                       crm_team admin) then keeps it or removes it.
--   • review_audit      append-only history of every action, including the
--                       exact legacy rows. A trigger refuses UPDATE and DELETE.
--   • DELETE on product_reviews is refused by trigger: reviews are removed by
--     moderation (status = 'removed', reason recorded), never erased.
--   • public.reviews    kept untouched as the rollback anchor. All 41-ish legacy
--                       rows are copied as legacy_unpublished (none can be tied
--                       to an order) and every client grant and policy on the
--                       old table is removed -- after saving them, so the
--                       rollback restores them exactly.
--
--  WHAT THIS DOES NOT FIX -- say it plainly
--
--   orders still accepts anonymous INSERTs of any shape (orders_anon_insert,
--   WITH CHECK true). A seller who creates a fake order, marks it delivered and
--   sends themselves the link can still post a "verified purchase" review. The
--   checks below make that deliberate, per-order work instead of a free form,
--   refuse the store's own WhatsApp/owner number, and leave an audit trail, but
--   only the order-integrity work (server-created orders) closes it.
--
--  ORDER OF OPERATIONS
--   Run reviews-inspect.sql first (read-only). Apply this. Run
--   reviews-verified-verify.sql (read-only). Deploy the website change straight
--   after: the old site's review form and the old Reviews tab stop working the
--   moment this commits.
--
--  RUN: Supabase Dashboard → SQL Editor → paste all → Run. One transaction.
--  Re-running is safe (idempotent).
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- ── 0. Preflight — refuse to run against a database we did not inspect ──────
do $preflight$
begin
  if to_regclass('public.reviews') is null then
    raise exception 'preflight: public.reviews does not exist';
  end if;
  if to_regclass('public.orders') is null or to_regclass('public.stores') is null then
    raise exception 'preflight: public.orders / public.stores missing';
  end if;
  if to_regclass('public.crm_team') is null then
    raise exception 'preflight: public.crm_team missing (review moderation is admin-gated through it)';
  end if;
  if to_regprocedure('extensions.digest(text,text)') is null
     or to_regprocedure('extensions.gen_random_bytes(integer)') is null then
    raise exception 'preflight: pgcrypto is not installed in schema "extensions"';
  end if;
  if to_regprocedure('public.verify_store_pin(text,text)') is null then
    raise exception 'preflight: verify_store_pin missing';
  end if;
  -- The PIN-throttle fix must already be applied: every seller function below
  -- goes through verify_store_pin, and that only means something once the
  -- ledger has separate PIN/OTP budgets.
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'pin_attempts'
                    and column_name = 'kind') then
    raise exception 'preflight: apply pin-bypass-closure-forward.sql first';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'orders'
                    and column_name = 'items') then
    raise exception 'preflight: orders.items missing';
  end if;
end
$preflight$;


-- ── 1. Records ──────────────────────────────────────────────────────────────

create table if not exists public.product_reviews (
  id                  uuid        primary key default gen_random_uuid(),
  store_slug          text        not null,
  order_id            uuid,                        -- null only for legacy rows
  item_index          integer,                     -- position in orders.items
  product_id          text,                        -- null if the item no longer matches a product
  item_name           text,                        -- what was bought, as ordered
  variant             text,
  -- sha256(lower(slug) || ':' || last 10 digits). Never the raw phone, and not
  -- correlatable across stores. Not readable by any client role.
  customer_key        text,
  display_name        text        not null,
  rating              smallint    not null check (rating between 1 and 5),
  body                text        not null default '',
  status              text        not null
                        check (status in ('published', 'removed', 'legacy_unpublished')),
  verified_purchase   boolean     not null default false,
  consent_advertising boolean     not null default false,   -- never implied by reviewing
  merchant_reply      text,
  merchant_replied_at timestamptz,
  removed_reason      text,
  removed_at          timestamptz,
  submitted_at        timestamptz not null default now(),
  updated_at          timestamptz,
  edit_count          integer     not null default 0,
  legacy_review_id    text        unique,          -- provenance; text so any legacy id type fits
  constraint product_reviews_verified_needs_order
    check (verified_purchase = false or (order_id is not null and item_index is not null)),
  constraint product_reviews_legacy_never_verified
    check (status <> 'legacy_unpublished' or verified_purchase = false),
  -- Length limits apply to reviews written through this system. Legacy rows are
  -- carried over byte-for-byte rather than silently cut to fit.
  constraint product_reviews_lengths
    check (status = 'legacy_unpublished'
           or (char_length(display_name) between 1 and 60 and char_length(body) <= 1000)),
  constraint product_reviews_reply_length
    check (merchant_reply is null or char_length(merchant_reply) <= 500),
  constraint product_reviews_removed_has_reason
    check (status <> 'removed' or (removed_reason is not null and removed_at is not null))
);

comment on table public.product_reviews is
  'Customer reviews. Store, order, product, customer and verified_purchase are set '
  'by SECURITY DEFINER functions from a seller-issued invite -- never by the client.';

-- One review per item of one order. Editing updates that row.
create unique index if not exists product_reviews_one_per_order_item
  on public.product_reviews (order_id, item_index)
  where order_id is not null;

create index if not exists product_reviews_store_idx
  on public.product_reviews (store_slug, status, submitted_at desc);
create index if not exists product_reviews_product_idx
  on public.product_reviews (store_slug, product_id)
  where status = 'published';


create table if not exists public.review_invites (
  token_hash    text        primary key,           -- sha256 hex of the raw token
  store_slug    text        not null,
  order_id      uuid        not null,
  customer_key  text        not null,
  issued_at     timestamptz not null default now(),
  expires_at    timestamptz not null,
  revoked_at    timestamptz
);

comment on table public.review_invites is
  'Seller-issued review links, one live link per delivered order. The raw token '
  'exists only in the link sent to the customer.';

create unique index if not exists review_invites_one_live_per_order
  on public.review_invites (order_id)
  where revoked_at is null;


create table if not exists public.review_reports (
  id           bigint      generated always as identity primary key,
  review_id    uuid        not null references public.product_reviews (id) on delete restrict,
  store_slug   text        not null,
  reason       text        not null check (char_length(reason) between 5 and 500),
  created_at   timestamptz not null default now(),
  resolved_at  timestamptz,
  decision     text        check (decision in ('kept', 'removed')),
  admin_note   text,
  resolved_by  uuid,
  constraint review_reports_resolution_complete
    check ((resolved_at is null) = (decision is null))
);

create unique index if not exists review_reports_one_open_per_review
  on public.review_reports (review_id)
  where resolved_at is null;


create table if not exists public.review_audit (
  id          bigint      generated always as identity primary key,
  review_id   uuid,
  order_id    uuid,
  store_slug  text        not null,
  action      text        not null
                check (action in ('migrated', 'invite_issued', 'submitted', 'edited',
                                  'replied', 'reported', 'kept', 'removed')),
  actor       text        not null check (actor in ('system', 'customer', 'merchant', 'admin')),
  reason      text,
  before      jsonb,
  after       jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists review_audit_review_idx on public.review_audit (review_id, created_at desc);
create index if not exists review_audit_store_idx  on public.review_audit (store_slug, created_at desc);


-- ── 2. Save the old table's access rules, so the rollback restores them exactly
-- Nobody wrote these down; the policy names in production are not known for
-- certain. Capturing them here beats guessing in the rollback.

create table if not exists public.reviews_access_preserved (
  kind        text not null check (kind in ('policy', 'grant')),
  name        text not null,                 -- policy name, or grantee for a grant
  permissive  text,
  roles       text[],
  cmd         text,                          -- policy command, or privilege for a grant
  qual        text,
  with_check  text,
  saved_at    timestamptz not null default now(),
  primary key (kind, name, cmd)
);

insert into public.reviews_access_preserved (kind, name, permissive, roles, cmd, qual, with_check)
select 'policy', p.policyname, p.permissive, p.roles::text[], p.cmd, p.qual, p.with_check
  from pg_policies p
 where p.schemaname = 'public' and p.tablename = 'reviews'
on conflict do nothing;

insert into public.reviews_access_preserved (kind, name, cmd)
select 'grant', g.grantee, g.privilege_type
  from information_schema.role_table_grants g
 where g.table_schema = 'public' and g.table_name = 'reviews'
   and g.grantee in ('anon', 'authenticated', 'PUBLIC')
on conflict do nothing;


-- ── 3. Legacy rows — copied, never deleted, never verified ──────────────────
-- Not one old review can be tied to an order item: the old table has no order,
-- no product and no customer. They land unpublished and count for nothing. The
-- exact original row is kept in the audit trail as JSON.
--
-- This removes the visible star rating from every store that shows one today.
-- That is the instructed behaviour.

insert into public.product_reviews
  (store_slug, display_name, rating, body, status, verified_purchase,
   submitted_at, legacy_review_id)
select r.store_slug,
       coalesce(nullif(btrim(r.customer_name), ''), '(no name)'),
       greatest(1, least(5, r.rating))::smallint,
       coalesce(r.comment, ''),
       'legacy_unpublished',
       false,
       coalesce(r.created_at, now()),
       r.id::text
  from public.reviews r
 where not exists (select 1 from public.product_reviews pr
                    where pr.legacy_review_id = r.id::text);

insert into public.review_audit (review_id, store_slug, action, actor, reason, after)
select pr.id, pr.store_slug, 'migrated', 'system',
       'Carried over unpublished: the old review has no order, product or customer, '
       'so it cannot be verified.',
       to_jsonb(r)
  from public.product_reviews pr
  join public.reviews r on r.id::text = pr.legacy_review_id
 where pr.status = 'legacy_unpublished'
   and not exists (select 1 from public.review_audit a
                    where a.review_id = pr.id and a.action = 'migrated');


-- ── 4. Nothing disappears ───────────────────────────────────────────────────

create or replace function public.review_rows_are_permanent()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $function$
begin
  raise exception '%: % is not allowed. Reviews are removed by moderation, never erased.',
    tg_table_name, tg_op
    using errcode = '42501';
end;
$function$;

drop trigger if exists product_reviews_no_delete on public.product_reviews;
create trigger product_reviews_no_delete
  before delete on public.product_reviews
  for each row execute function public.review_rows_are_permanent();

drop trigger if exists review_reports_no_delete on public.review_reports;
create trigger review_reports_no_delete
  before delete on public.review_reports
  for each row execute function public.review_rows_are_permanent();

drop trigger if exists review_audit_append_only on public.review_audit;
create trigger review_audit_append_only
  before update or delete on public.review_audit
  for each row execute function public.review_rows_are_permanent();


-- ── 5. Access — deny by default ─────────────────────────────────────────────
-- Supabase's default privileges hand anon and authenticated full rights on
-- every new table, so each one is revoked explicitly.

alter table public.product_reviews          enable row level security;
alter table public.review_invites           enable row level security;
alter table public.review_reports           enable row level security;
alter table public.review_audit             enable row level security;
alter table public.reviews_access_preserved enable row level security;

revoke all on public.product_reviews          from public, anon, authenticated;
revoke all on public.review_invites           from public, anon, authenticated;
revoke all on public.review_reports           from public, anon, authenticated;
revoke all on public.review_audit             from public, anon, authenticated;
revoke all on public.reviews_access_preserved from public, anon, authenticated;

do $seq$
declare s text;
begin
  foreach s in array array[pg_get_serial_sequence('public.review_reports', 'id'),
                           pg_get_serial_sequence('public.review_audit', 'id')] loop
    if s is not null then
      execute format('revoke all on sequence %s from public, anon, authenticated', s);
    end if;
  end loop;
end
$seq$;

-- The one public read: published rows, safe columns. No customer_key, no
-- order_id, no removal reason, no legacy row.
grant select (id, store_slug, product_id, item_name, variant, display_name, rating,
              body, status, verified_purchase, merchant_reply, merchant_replied_at,
              submitted_at, updated_at, edit_count)
  on public.product_reviews to anon, authenticated;

drop policy if exists product_reviews_public_read on public.product_reviews;
create policy product_reviews_public_read on public.product_reviews
  for select to anon, authenticated
  using (status = 'published');

-- Close the old table completely: every policy (whatever it is called) and every
-- client grant. Saved in step 2.
do $old$
declare p record;
begin
  for p in select policyname from pg_policies
            where schemaname = 'public' and tablename = 'reviews' loop
    execute format('drop policy %I on public.reviews', p.policyname);
  end loop;
end
$old$;
alter table public.reviews enable row level security;
revoke all on public.reviews from public, anon, authenticated;


-- ── 6. Helper — which product an order line is ──────────────────────────────
-- New orders carry productId on each line. Older ones only carry the name, so
-- fall back to the first product of that exact name. No match = null: the
-- review still counts for the store, it just is not attached to a product.

create or replace function public.review_product_id(p_config jsonb, p_item jsonb)
returns text
language sql
immutable
set search_path = public, pg_temp
as $function$
  with products as (
    select p
      from jsonb_array_elements(
             case when jsonb_typeof(p_config -> 'products') = 'array'
                  then p_config -> 'products' else '[]'::jsonb end) as p
  )
  select coalesce(
    (select p ->> 'id' from products
      where nullif(p_item ->> 'productId', '') is not null
        and p ->> 'id' = p_item ->> 'productId'
      limit 1),
    (select p ->> 'id' from products
      where p ->> 'name' = p_item ->> 'name'
      limit 1));
$function$;


-- ── 7. Seller: create the review link for a delivered order ─────────────────
-- Returns the RAW token once. Only its hash is stored; asking again revokes the
-- previous link and makes a new one.

create or replace function public.issue_review_invite(
  p_slug text, p_hashed_pin text, p_order_id uuid)
returns text
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
declare
  v_order  record;
  v_config jsonb;
  v_phone  text;
  v_raw    text;
  v_key    text;
begin
  if not public.verify_store_pin(p_slug, p_hashed_pin) then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  select o.status, o.total, o.customer_phone, o.payment_method, o.paid,
         o.payment_ref, to_jsonb(o.items) as items
    into v_order
    from public.orders o
   where o.id = p_order_id and o.store_slug = p_slug;
  if not found then
    raise exception 'order not found for this store' using errcode = 'P0002';
  end if;

  if coalesce(v_order.status, '') <> 'delivered' then
    raise exception 'mark the order delivered before asking for a review';
  end if;
  -- Service enquiries are saved as zero-value orders. Nothing was bought.
  if coalesce(v_order.total, 0) <= 0 then
    raise exception 'only orders with an amount can be reviewed';
  end if;
  if jsonb_typeof(v_order.items) <> 'array' or jsonb_array_length(v_order.items) = 0 then
    raise exception 'this order has no items';
  end if;
  if lower(coalesce(v_order.payment_method, '')) = 'online'
     and not coalesce(v_order.paid, false) and v_order.payment_ref is null then
    raise exception 'this online order was never paid';
  end if;

  v_phone := right(regexp_replace(coalesce(v_order.customer_phone, ''), '\D', '', 'g'), 10);
  if v_phone !~ '^[6-9][0-9]{9}$' then
    raise exception 'this order has no valid customer mobile number';
  end if;

  select s.config into v_config from public.stores s where s.slug = p_slug;
  if v_phone in (right(regexp_replace(coalesce(v_config ->> 'whatsappNumber', ''), '\D', '', 'g'), 10),
                 right(regexp_replace(coalesce(v_config ->> 'ownerPhone', ''), '\D', '', 'g'), 10)) then
    raise exception 'this order was placed from the store''s own number and cannot be reviewed';
  end if;

  v_key := encode(extensions.digest(lower(p_slug) || ':' || v_phone, 'sha256'), 'hex');
  v_raw := encode(extensions.gen_random_bytes(24), 'hex');

  update public.review_invites
     set revoked_at = now()
   where order_id = p_order_id and revoked_at is null;

  insert into public.review_invites (token_hash, store_slug, order_id, customer_key, expires_at)
  values (encode(extensions.digest(v_raw, 'sha256'), 'hex'), p_slug, p_order_id, v_key,
          now() + interval '60 days');

  insert into public.review_audit (order_id, store_slug, action, actor)
  values (p_order_id, p_slug, 'invite_issued', 'merchant');

  return v_raw;
end;
$function$;


-- ── 8. Customer: open the link ──────────────────────────────────────────────
-- Everything the review page needs, and nothing more: store name, the
-- customer's first name, and the items with any review already written. No
-- phone, no address, no totals.

create or replace function public.get_review_invite(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
declare
  v_inv    public.review_invites%rowtype;
  v_order  record;
  v_config jsonb;
  v_items  jsonb := '[]'::jsonb;
  v_item   jsonb;
  v_pid    text;
  v_image  text;
  v_rev    public.product_reviews%rowtype;
  i        integer;
begin
  select * into v_inv from public.review_invites
   where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex');
  if not found then
    return jsonb_build_object('state', 'invalid');
  end if;

  select s.config into v_config from public.stores s where s.slug = v_inv.store_slug;

  if v_inv.revoked_at is not null then
    return jsonb_build_object('state', 'replaced', 'storeName', v_config ->> 'businessName');
  end if;
  if v_inv.expires_at <= now() then
    return jsonb_build_object('state', 'expired', 'storeName', v_config ->> 'businessName');
  end if;

  select o.status, o.customer_name, to_jsonb(o.items) as items
    into v_order
    from public.orders o
   where o.id = v_inv.order_id and o.store_slug = v_inv.store_slug;
  if not found or coalesce(v_order.status, '') <> 'delivered'
     or jsonb_typeof(v_order.items) <> 'array' then
    return jsonb_build_object('state', 'unavailable', 'storeName', v_config ->> 'businessName');
  end if;

  for i in 0 .. jsonb_array_length(v_order.items) - 1 loop
    v_item := v_order.items -> i;
    v_pid  := public.review_product_id(v_config, v_item);
    select nullif(p ->> 'image', '') into v_image
      from jsonb_array_elements(
             case when jsonb_typeof(v_config -> 'products') = 'array'
                  then v_config -> 'products' else '[]'::jsonb end) as p
     where p ->> 'id' = v_pid
     limit 1;
    if v_image like 'data:%' then v_image := null; end if;   -- inline photos are too heavy to return

    select * into v_rev from public.product_reviews r
     where r.order_id = v_inv.order_id and r.item_index = i;

    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'index',     i,
      'name',      v_item ->> 'name',
      'variant',   coalesce(v_item ->> 'variant', v_item ->> 'size'),
      'productId', v_pid,
      'image',     v_image,
      'review',    case when v_rev.id is null then null else jsonb_build_object(
                     'rating',      v_rev.rating,
                     'body',        v_rev.body,
                     'displayName', v_rev.display_name,
                     'status',      v_rev.status,
                     'reply',       v_rev.merchant_reply) end));
    v_image := null;
  end loop;

  return jsonb_build_object(
    'state',     'ok',
    'storeSlug', v_inv.store_slug,
    'storeName', v_config ->> 'businessName',
    'brand',     v_config -> 'theme' ->> 'primary',
    'firstName', nullif(split_part(btrim(coalesce(v_order.customer_name, '')), ' ', 1), ''),
    'expiresAt', v_inv.expires_at,
    'items',     v_items);
end;
$function$;


-- ── 9. Customer: write or edit a review ─────────────────────────────────────
-- The caller supplies only their words, stars, name and advertising consent.
-- Store, order, product and verified_purchase all come from the invite. Too-long
-- input is REFUSED, never cut down.

create or replace function public.submit_review(
  p_token               text,
  p_item_index          integer,
  p_rating              integer,
  p_body                text,
  p_display_name        text,
  p_consent_advertising boolean default false)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
declare
  v_inv    public.review_invites%rowtype;
  v_order  record;
  v_config jsonb;
  v_item   jsonb;
  v_old    public.product_reviews%rowtype;
  v_id     uuid;
  v_body   text := btrim(coalesce(p_body, ''));
  v_name   text := btrim(coalesce(p_display_name, ''));
  v_ads    boolean := coalesce(p_consent_advertising, false);
begin
  if p_rating is null or p_rating not between 1 and 5 then
    raise exception 'pick a rating from 1 to 5 stars' using errcode = '22023';
  end if;
  if char_length(v_body) > 1000 then
    raise exception 'reviews can be up to 1000 characters' using errcode = '22001';
  end if;
  if char_length(v_name) not between 1 and 60 then
    raise exception 'add a name of up to 60 characters' using errcode = '22023';
  end if;

  select * into v_inv from public.review_invites
   where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
   for update;
  if not found then
    raise exception 'this review link is not valid' using errcode = '42501';
  end if;
  if v_inv.revoked_at is not null then
    raise exception 'this review link was replaced by a newer one' using errcode = '42501';
  end if;
  if v_inv.expires_at <= now() then
    raise exception 'this review link has expired' using errcode = '42501';
  end if;

  select o.status, to_jsonb(o.items) as items
    into v_order
    from public.orders o
   where o.id = v_inv.order_id and o.store_slug = v_inv.store_slug;
  if not found or coalesce(v_order.status, '') <> 'delivered' then
    raise exception 'this order can no longer be reviewed' using errcode = '42501';
  end if;
  if jsonb_typeof(v_order.items) <> 'array' or p_item_index is null
     or p_item_index < 0 or p_item_index >= jsonb_array_length(v_order.items) then
    raise exception 'that item is not part of this order' using errcode = '22023';
  end if;
  v_item := v_order.items -> p_item_index;

  select * into v_old from public.product_reviews r
   where r.order_id = v_inv.order_id and r.item_index = p_item_index
   for update;

  if found then
    if v_old.status <> 'published' then
      raise exception 'this review was removed after a report and cannot be changed' using errcode = '42501';
    end if;
    if v_old.edit_count >= 10 then
      raise exception 'this review has already been edited 10 times' using errcode = '54000';
    end if;

    update public.product_reviews
       set rating = p_rating, body = v_body, display_name = v_name,
           consent_advertising = v_ads, updated_at = now(), edit_count = edit_count + 1
     where id = v_old.id;

    insert into public.review_audit (review_id, order_id, store_slug, action, actor, before, after)
    values (v_old.id, v_inv.order_id, v_inv.store_slug, 'edited', 'customer',
            jsonb_build_object('rating', v_old.rating, 'body', v_old.body,
                               'display_name', v_old.display_name,
                               'consent_advertising', v_old.consent_advertising),
            jsonb_build_object('rating', p_rating, 'body', v_body,
                               'display_name', v_name, 'consent_advertising', v_ads));

    return jsonb_build_object('id', v_old.id, 'edited', true);
  end if;

  select s.config into v_config from public.stores s where s.slug = v_inv.store_slug;

  insert into public.product_reviews
    (store_slug, order_id, item_index, product_id, item_name, variant, customer_key,
     display_name, rating, body, status, verified_purchase, consent_advertising)
  values
    (v_inv.store_slug, v_inv.order_id, p_item_index,
     public.review_product_id(v_config, v_item),
     v_item ->> 'name', coalesce(v_item ->> 'variant', v_item ->> 'size'),
     v_inv.customer_key, v_name, p_rating, v_body,
     -- Published straight away, whatever the rating. A low rating is never held back.
     'published', true, v_ads)
  returning id into v_id;

  insert into public.review_audit (review_id, order_id, store_slug, action, actor, after)
  values (v_id, v_inv.order_id, v_inv.store_slug, 'submitted', 'customer',
          jsonb_build_object('rating', p_rating, 'body', v_body, 'display_name', v_name,
                             'consent_advertising', v_ads));

  return jsonb_build_object('id', v_id, 'edited', false);
end;
$function$;


-- ── 10. Seller: see reviews, reply, report. Never delete, never hide. ───────

create or replace function public.get_owner_reviews(p_slug text, p_hashed_pin text)
returns table (
  id uuid, product_id text, item_name text, variant text, display_name text,
  rating smallint, body text, status text, verified_purchase boolean,
  merchant_reply text, merchant_replied_at timestamptz, submitted_at timestamptz,
  updated_at timestamptz, edit_count integer, open_report boolean,
  report_reason text, removed_reason text, order_id uuid)
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
    select r.id, r.product_id, r.item_name, r.variant, r.display_name, r.rating, r.body,
           r.status, r.verified_purchase, r.merchant_reply, r.merchant_replied_at,
           r.submitted_at, r.updated_at, r.edit_count,
           exists (select 1 from public.review_reports rr
                    where rr.review_id = r.id and rr.resolved_at is null),
           (select rr.reason from public.review_reports rr
             where rr.review_id = r.id order by rr.created_at desc limit 1),
           r.removed_reason, r.order_id
      from public.product_reviews r
     where r.store_slug = p_slug
     order by r.submitted_at desc
     limit 2000;
end;
$function$;

create or replace function public.reply_to_review(
  p_slug text, p_hashed_pin text, p_review_id uuid, p_reply text)
returns boolean
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
declare
  v_row   public.product_reviews%rowtype;
  v_reply text := nullif(btrim(coalesce(p_reply, '')), '');
begin
  if not public.verify_store_pin(p_slug, p_hashed_pin) then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  if char_length(v_reply) > 500 then
    raise exception 'replies can be up to 500 characters' using errcode = '22001';
  end if;

  select * into v_row from public.product_reviews r
   where r.id = p_review_id and r.store_slug = p_slug
   for update;
  if not found or v_row.status <> 'published' then
    raise exception 'review not found for this store' using errcode = 'P0002';
  end if;

  update public.product_reviews
     set merchant_reply = v_reply,
         merchant_replied_at = case when v_reply is null then null else now() end
   where id = p_review_id;

  insert into public.review_audit (review_id, store_slug, action, actor, before, after)
  values (p_review_id, p_slug, 'replied', 'merchant',
          jsonb_build_object('reply', v_row.merchant_reply),
          jsonb_build_object('reply', v_reply));
  return true;
end;
$function$;

-- Reporting does NOT hide the review. It stays public until PocketLink decides,
-- so reporting cannot be used to bury a bad rating.
create or replace function public.report_review(
  p_slug text, p_hashed_pin text, p_review_id uuid, p_reason text)
returns boolean
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
declare
  v_row    public.product_reviews%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if not public.verify_store_pin(p_slug, p_hashed_pin) then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  if char_length(v_reason) not between 5 and 500 then
    raise exception 'say why you are reporting it (5 to 500 characters)' using errcode = '22023';
  end if;

  select * into v_row from public.product_reviews r
   where r.id = p_review_id and r.store_slug = p_slug;
  if not found or v_row.status <> 'published' then
    raise exception 'review not found for this store' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.review_reports rr
              where rr.review_id = p_review_id and rr.resolved_at is null) then
    raise exception 'this review is already reported and waiting for PocketLink' using errcode = '23505';
  end if;

  insert into public.review_reports (review_id, store_slug, reason)
  values (p_review_id, p_slug, v_reason);

  insert into public.review_audit (review_id, store_slug, action, actor, reason)
  values (p_review_id, p_slug, 'reported', 'merchant', v_reason);
  return true;
end;
$function$;


-- ── 11. PocketLink admin: decide reported reviews ───────────────────────────
-- Gated on crm_team role = 'admin' for the signed-in Supabase user.

create or replace function public.admin_list_review_reports()
returns table (
  report_id bigint, reported_at timestamptz, reason text, store_slug text,
  review_id uuid, display_name text, rating smallint, body text, item_name text,
  merchant_reply text, submitted_at timestamptz, verified_purchase boolean)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
#variable_conflict use_column
begin
  if not exists (select 1 from public.crm_team t
                  where t.user_id = auth.uid() and t.role = 'admin') then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  return query
    select rr.id, rr.created_at, rr.reason, rr.store_slug, r.id, r.display_name,
           r.rating, r.body, r.item_name, r.merchant_reply, r.submitted_at,
           r.verified_purchase
      from public.review_reports rr
      join public.product_reviews r on r.id = rr.review_id
     where rr.resolved_at is null
     order by rr.created_at;
end;
$function$;

create or replace function public.admin_resolve_review_report(
  p_report_id bigint, p_decision text, p_note text)
returns boolean
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
declare
  v_rep  public.review_reports%rowtype;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if not exists (select 1 from public.crm_team t
                  where t.user_id = auth.uid() and t.role = 'admin') then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  if p_decision not in ('kept', 'removed') then
    raise exception 'decision must be kept or removed' using errcode = '22023';
  end if;
  if p_decision = 'removed' and v_note is null then
    raise exception 'give the reason for removing a review' using errcode = '22023';
  end if;

  select * into v_rep from public.review_reports where id = p_report_id for update;
  if not found or v_rep.resolved_at is not null then
    raise exception 'report not found or already decided' using errcode = 'P0002';
  end if;

  update public.review_reports
     set resolved_at = now(), decision = p_decision, admin_note = v_note, resolved_by = auth.uid()
   where id = p_report_id;

  if p_decision = 'removed' then
    update public.product_reviews
       set status = 'removed', removed_reason = v_note, removed_at = now()
     where id = v_rep.review_id and status = 'published';
  end if;

  insert into public.review_audit (review_id, store_slug, action, actor, reason, after)
  values (v_rep.review_id, v_rep.store_slug, p_decision::text, 'admin', v_note,
          jsonb_build_object('report_id', p_report_id, 'by', auth.uid()));
  return true;
end;
$function$;


-- ── 12. Retire the old seller powers ────────────────────────────────────────
-- delete_review was the hard delete; set_review_status let a seller hide any
-- review; get_store_reviews read the old table. The rollback restores all three.

drop function if exists public.delete_review(text, text, uuid);
drop function if exists public.set_review_status(text, text, uuid, text);
drop function if exists public.get_store_reviews(text, text);


-- ── 13. EXECUTE — least privilege ───────────────────────────────────────────
-- Supabase grants EXECUTE on new functions to anon by default; revoke first.

revoke all on function public.review_rows_are_permanent()                           from public, anon, authenticated;
revoke all on function public.review_product_id(jsonb, jsonb)                       from public, anon, authenticated;
revoke all on function public.issue_review_invite(text, text, uuid)                 from public, anon, authenticated;
revoke all on function public.get_review_invite(text)                               from public, anon, authenticated;
revoke all on function public.submit_review(text, integer, integer, text, text, boolean) from public, anon, authenticated;
revoke all on function public.get_owner_reviews(text, text)                         from public, anon, authenticated;
revoke all on function public.reply_to_review(text, text, uuid, text)               from public, anon, authenticated;
revoke all on function public.report_review(text, text, uuid, text)                from public, anon, authenticated;
revoke all on function public.admin_list_review_reports()                           from public, anon, authenticated;
revoke all on function public.admin_resolve_review_report(bigint, text, text)       from public, anon, authenticated;

-- Customers (link holders) and sellers (PIN holders) have no login: anon.
grant execute on function public.get_review_invite(text)                                 to anon, authenticated;
grant execute on function public.submit_review(text, integer, integer, text, text, boolean) to anon, authenticated;
grant execute on function public.issue_review_invite(text, text, uuid)                   to anon, authenticated;
grant execute on function public.get_owner_reviews(text, text)                           to anon, authenticated;
grant execute on function public.reply_to_review(text, text, uuid, text)                 to anon, authenticated;
grant execute on function public.report_review(text, text, uuid, text)                   to anon, authenticated;
-- The Console signs in with Supabase auth.
grant execute on function public.admin_list_review_reports()                             to authenticated;
grant execute on function public.admin_resolve_review_report(bigint, text, text)         to authenticated;

commit;

-- Next: supabase/reviews-verified-verify.sql (read-only). Every row must PASS.
