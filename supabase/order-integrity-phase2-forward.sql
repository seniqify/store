-- ===========================================================================
--  Order integrity, phase 2  --  PREPARED, NOT APPLIED, NOT WIRED UP
-- ===========================================================================
--
--  WHAT IS WRONG TODAY
--
--  An order's money is decided in the customer's browser. The payment layer is
--  correct on its own terms -- it charges orders.total and refuses a Razorpay
--  amount that does not match it -- but orders.total is whatever the browser
--  sent. Phase 1 stopped an order being born "paid"; this stops it being born
--  at a price the buyer chose.
--
--  WHAT THIS FILE INSTALLS
--
--    order_requests           idempotency ledger: one row per accepted attempt
--    order_integrity          what was charged and why, per order
--    order_pricing_shadow     observation only, for the shadow-mode rollout
--    store_pricing_fingerprint(slug)   the authoritative config hash
--    create_order_secure(...)          the one writer
--
--  NOTHING IS WIRED TO IT YET. The storefront still inserts orders itself, the
--  orders_anon_insert policy stays, and trg_decrement_stock stays. Applying
--  this file alone changes no existing behaviour: every object is new, and the
--  only caller of create_order_secure is a function that nothing calls yet.
--
--  THE TWO FINGERPRINTS
--
--  request_fingerprint  binds the complete order INTENT -- store, mode, product
--    ids, variant and extras picks, quantities, coupon code, payment method,
--    every customer/delivery field that lands on the row, and the notes. It is
--    computed in JavaScript (shared/pricing.mjs, canonicalRequest + SHA-256)
--    and this function only ever COMPARES it. It is never recomputed here, so
--    there is exactly one definition of it in the system.
--      same key + same fingerprint  -> the same committed order is returned
--      same key + different one     -> idempotency_conflict, nothing written
--    Attribution (fbp / fbc / user agent) is deliberately outside it: those
--    legitimately differ between an attempt and its retry and never change what
--    is owed, so binding them would turn a retry into a conflict and push the
--    buyer into placing a second order.
--
--  config_fingerprint  binds the authoritative pricing inputs: each product's
--    id, name, price, mrp, gst rate, tax mode, availability flag, its priced
--    variant options and its extra options with their add-ons; the cart's tax
--    rate, tax mode, free-shipping threshold, delivery, packaging and COD
--    charges; and every coupon's code, active flag, type, value, minimum and
--    expiry. It is computed ONLY by store_pricing_fingerprint() below -- SQL
--    owns it end to end, so it cannot drift from a second implementation.
--
--    Excluded on purpose: product cost, images, descriptions, categories (they
--    cannot change what a buyer owes), and STOCK. Stock is not hashed because
--    availability is checked live under the row lock, which is stronger than a
--    hash; hashing it would make every concurrent order in the same store
--    invalidate every other one's fingerprint and turn ordinary traffic into a
--    storm of retries.
--
--  RUN: Supabase Dashboard -> SQL Editor -> paste -> Run. Idempotent.
--  VERIFY: supabase/order-integrity-phase2-verify.sql (read-only)
--  UNDO:   supabase/order-integrity-phase2-ROLLBACK.sql
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Idempotency ledger
-- ---------------------------------------------------------------------------
create table if not exists public.order_requests (
  store_slug          text        not null,
  idempotency_key     text        not null,
  request_fingerprint text        not null,
  order_id            uuid        not null,
  created_at          timestamptz not null default now(),
  primary key (store_slug, idempotency_key)
);

comment on table public.order_requests is
  'One row per accepted checkout attempt. A replay with the same key and the '
  'same request fingerprint returns the same order; a different fingerprint is '
  'refused. Written only inside create_order_secure, in the same transaction '
  'as the order, so a failed attempt never consumes its key.';

create index if not exists order_requests_order_idx on public.order_requests (order_id);

-- ---------------------------------------------------------------------------
-- 2. What was charged, and on what basis
-- ---------------------------------------------------------------------------
create table if not exists public.order_integrity (
  order_id           uuid        primary key references public.orders (id) on delete restrict,
  store_slug         text        not null,
  price_snapshot     jsonb       not null,
  config_fingerprint text        not null,
  engine_version     text        not null,
  computed_at        timestamptz not null default now()
);

comment on table public.order_integrity is
  'The server-resolved lines and component totals behind one order, with the '
  'config fingerprint they were computed from. ON DELETE RESTRICT: the evidence '
  'cannot be removed while the order exists.';

-- ---------------------------------------------------------------------------
-- 3. Shadow observation (rollout only)
-- ---------------------------------------------------------------------------
create table if not exists public.order_pricing_shadow (
  id             bigserial   primary key,
  store_slug     text        not null,
  order_id       uuid,
  server_total   numeric,
  db_total       numeric,
  delta          numeric,
  components     jsonb,
  reasons        jsonb,
  line_count     integer,
  idem_key_hash  text,
  would_limit    text,
  created_at     timestamptz not null default now()
);

comment on table public.order_pricing_shadow is
  'Shadow mode only: what the server WOULD have charged versus what the browser '
  'actually wrote, compared against the saved row -- never against a number '
  'from the request. Holds no product names, no costs, no margins, no coupon '
  'definitions. would_limit records the rate limit that would have fired, so '
  'the limits can be sized on real traffic before they refuse anybody.';

create index if not exists order_pricing_shadow_time_idx on public.order_pricing_shadow (created_at desc);
create index if not exists order_pricing_shadow_delta_idx on public.order_pricing_shadow (store_slug, created_at desc) where delta <> 0;

-- ---------------------------------------------------------------------------
-- 4. Nobody reaches these from a browser
-- ---------------------------------------------------------------------------
alter table public.order_requests       enable row level security;
alter table public.order_integrity      enable row level security;
alter table public.order_pricing_shadow enable row level security;

revoke all on public.order_requests       from anon, authenticated, public;
revoke all on public.order_integrity      from anon, authenticated, public;
revoke all on public.order_pricing_shadow from anon, authenticated, public;

-- ---------------------------------------------------------------------------
-- 5. The authoritative config fingerprint
-- ---------------------------------------------------------------------------
-- The single definition. The order-create function reads it before pricing and
-- hands it back; create_order_secure recomputes it under the row lock and
-- refuses if it moved. Deterministic because jsonb has a canonical text form.
create or replace function public.store_pricing_fingerprint(p_slug text)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  select md5(
    coalesce(
      (select jsonb_build_object(
                'p', coalesce((
                  select jsonb_agg(jsonb_build_object(
                           'id',   p->>'id',
                           'name', p->>'name',
                           'pr',   p->'price',
                           'mrp',  p->'mrp',
                           'gst',  p->'gstRate',
                           'ti',   p->'taxInclusive',
                           'in',   p->'inStock',
                           'v',    p->'variants',
                           'x',    p->'variantExtras')
                         order by p->>'id')
                  from jsonb_array_elements(
                         case when jsonb_typeof(s.config->'products') = 'array'
                              then s.config->'products' else '[]'::jsonb end) p
                ), '[]'::jsonb),
                'c', jsonb_build_object(
                       'tr', s.config->'cart'->'taxRate',
                       'ti', s.config->'cart'->'taxInclusive',
                       'fs', s.config->'cart'->'freeShippingAbove',
                       'sh', s.config->'cart'->'shippingCharge',
                       'pk', s.config->'cart'->'packagingCharge',
                       'cd', s.config->'cart'->'codCharge'),
                'k', coalesce((
                  select jsonb_agg(jsonb_build_object(
                           'code', upper(btrim(coalesce(k->>'code', ''))),
                           'a',    k->'active',
                           'dt',   k->>'discountType',
                           'dv',   k->'discountValue',
                           'mo',   k->'minOrder',
                           'ex',   k->>'expiresAt')
                         order by upper(btrim(coalesce(k->>'code', ''))))
                  from jsonb_array_elements(
                         case when jsonb_typeof(s.config->'coupons') = 'array'
                              then s.config->'coupons' else '[]'::jsonb end) k
                ), '[]'::jsonb)
              )::text
         from public.stores s where s.slug = p_slug),
      ''));
$function$;

revoke all on function public.store_pricing_fingerprint(text) from public, anon, authenticated;
grant execute on function public.store_pricing_fingerprint(text) to service_role;

-- ---------------------------------------------------------------------------
-- 6. The one writer
-- ---------------------------------------------------------------------------
-- It is handed the SERVER's resolved lines and component totals, computed by
-- shared/pricing.mjs from this store's config. It never receives a price, fee,
-- total or coupon definition that came off the wire, and there is no parameter
-- for paid, status, payment_ref, provider, courier or shipment fields -- those
-- are literals here or left to the table's defaults.
--
-- SECURITY INVOKER on purpose: the only caller is the service role, which
-- already bypasses RLS. Making it DEFINER would hand it privilege it does not
-- need, and would let any future grant turn it into a public order writer.
-- The EXECUTE grant below is the trust boundary.
create or replace function public.create_order_secure(
  p_store_slug          text,
  p_mode                text,
  p_idempotency_key     text,
  p_request_fingerprint text,
  p_config_fingerprint  text,
  p_customer            jsonb,
  p_payment_method      text,
  p_notes               text,
  p_items               jsonb,
  p_totals              jsonb,
  p_attribution         jsonb,
  p_engine_version      text
) returns jsonb
language plpgsql
volatile
security invoker
set search_path = public, pg_temp
as $function$
declare
  v_existing  public.order_requests%rowtype;
  v_order_id  uuid;
  v_token     uuid;
  v_live_fp   text;
  v_line      jsonb;
  v_have      numeric;
  v_status    text;
begin
  if coalesce(btrim(p_store_slug), '') = '' then
    raise exception 'store required' using errcode = '22023';
  end if;
  if coalesce(btrim(p_idempotency_key), '') = '' then
    raise exception 'idempotency key required' using errcode = '22023';
  end if;
  if coalesce(btrim(p_request_fingerprint), '') = '' then
    raise exception 'request fingerprint required' using errcode = '22023';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'no items' using errcode = '22023';
  end if;

  v_status := case when p_mode = 'abandoned' then 'abandoned' else 'new' end;

  -- ── 1. Idempotency reservation, in THIS transaction ──────────────────────
  -- Everything below rolls back with it, so a refused order never burns a key.
  v_order_id := gen_random_uuid();

  insert into public.order_requests
    (store_slug, idempotency_key, request_fingerprint, order_id)
  values (p_store_slug, p_idempotency_key, p_request_fingerprint, v_order_id)
  on conflict (store_slug, idempotency_key) do nothing;

  if not found then
    select * into v_existing from public.order_requests
     where store_slug = p_store_slug and idempotency_key = p_idempotency_key;

    if v_existing.request_fingerprint is distinct from p_request_fingerprint then
      -- Say nothing about the order that key already holds: a guessed key must
      -- not become a way to read somebody else's order.
      raise exception 'idempotency_conflict' using errcode = 'P0001';
    end if;

    select o.confirm_token into v_token from public.orders o where o.id = v_existing.order_id;
    return jsonb_build_object('order_id', v_existing.order_id,
                              'confirm_token', v_token,
                              'idempotent', true);
  end if;

  -- ── 2. Lock the store row: it holds the stock, so it serialises stock ─────
  perform 1 from public.stores where slug = p_store_slug for update;
  if not found then
    raise exception 'store_not_found' using errcode = 'P0002';
  end if;

  -- ── 3. The config must not have moved since it was priced ────────────────
  v_live_fp := public.store_pricing_fingerprint(p_store_slug);
  if coalesce(p_config_fingerprint, '') <> coalesce(v_live_fp, '') then
    raise exception 'config_changed' using errcode = 'P0003';
  end if;

  -- ── 4. Availability, for every line, before anything is written ──────────
  if v_status <> 'abandoned' then
    for v_line in select * from jsonb_array_elements(p_items) loop
      select (prod->>'stock')::numeric into v_have
        from public.stores s,
             lateral jsonb_array_elements(
               case when jsonb_typeof(s.config->'products') = 'array'
                    then s.config->'products' else '[]'::jsonb end) prod
       where s.slug = p_store_slug
         and prod->>'id' = v_line->>'productId'
         and jsonb_typeof(prod->'stock') = 'number';

      if v_have is not null and v_have < coalesce((v_line->>'qty')::numeric, 0) then
        raise exception 'out_of_stock:%', v_line->>'productId' using errcode = 'P0004';
      end if;
    end loop;

    -- ── 5. Decrement, by product id, never by name ─────────────────────────
    update public.stores s
       set config = jsonb_set(s.config, '{products}', (
             select jsonb_agg(
                      case when jsonb_typeof(prod->'stock') = 'number'
                                and dec.qty is not null
                           then jsonb_set(prod, '{stock}',
                                  to_jsonb(greatest(0, (prod->>'stock')::numeric - dec.qty)))
                           else prod end
                      order by ord)
               from jsonb_array_elements(s.config->'products') with ordinality as pa(prod, ord)
               left join (
                 select item->>'productId' as pid,
                        sum(coalesce(nullif(item->>'qty', '')::numeric, 1)) as qty
                   from jsonb_array_elements(p_items) as item
                  where item->>'productId' is not null
                  group by item->>'productId'
               ) dec on dec.pid = prod->>'id'
           ))
     where s.slug = p_store_slug
       and jsonb_typeof(s.config->'products') = 'array';
  end if;

  -- ── 6. The order. Money comes from p_totals, which the server computed. ──
  insert into public.orders (
    id, store_slug, customer_name, customer_phone, destination, pincode,
    payment_method, notes, items, item_count,
    subtotal, tax, shipping, packaging, cod_fee, total,
    status, fbp, fbc, client_ua
  ) values (
    v_order_id,
    p_store_slug,
    left(coalesce(p_customer->>'name', ''), 80),
    right(regexp_replace(coalesce(p_customer->>'phone', ''), '\D', '', 'g'), 10),
    coalesce(p_customer->>'destination', ''),
    left(regexp_replace(coalesce(p_customer->>'pincode', ''), '\D', '', 'g'), 6),
    lower(coalesce(p_payment_method, '')),
    left(coalesce(p_notes, ''), 500),
    p_items,
    coalesce((select sum(coalesce((i->>'qty')::numeric, 0))
                from jsonb_array_elements(p_items) i), 0),
    coalesce((p_totals->>'subtotal')::numeric, 0),
    coalesce((p_totals->>'tax')::numeric, 0),
    coalesce((p_totals->>'shipping')::numeric, 0),
    coalesce((p_totals->>'packaging')::numeric, 0),
    coalesce((p_totals->>'codFee')::numeric, 0),
    coalesce((p_totals->>'total')::numeric, 0),
    v_status,
    p_attribution->>'fbp',
    p_attribution->>'fbc',
    p_attribution->>'ua'
  );

  select o.confirm_token into v_token from public.orders o where o.id = v_order_id;

  -- ── 7. The evidence ──────────────────────────────────────────────────────
  insert into public.order_integrity
    (order_id, store_slug, price_snapshot, config_fingerprint, engine_version)
  values (v_order_id, p_store_slug,
          jsonb_build_object('lines', p_items, 'totals', p_totals),
          coalesce(p_config_fingerprint, ''), coalesce(p_engine_version, 'unknown'));

  return jsonb_build_object('order_id', v_order_id,
                            'confirm_token', v_token,
                            'idempotent', false);
end;
$function$;

-- The trust boundary. Only the service role may write an order this way.
revoke all on function public.create_order_secure(
  text, text, text, text, text, jsonb, text, text, jsonb, jsonb, jsonb, text) from public;
revoke all on function public.create_order_secure(
  text, text, text, text, text, jsonb, text, text, jsonb, jsonb, jsonb, text) from anon, authenticated;
grant execute on function public.create_order_secure(
  text, text, text, text, text, jsonb, text, text, jsonb, jsonb, jsonb, text) to service_role;

commit;

-- Next: supabase/order-integrity-phase2-verify.sql (read-only, production-safe).
--
-- NOT part of this migration, and not to be done until shadow mode says the old
-- path has drained: dropping orders_anon_insert and dropping trg_decrement_stock.
-- Those two belong in ONE later step, because between them there would either be
-- two stock mechanisms or none.
