-- ══════════════════════════════════════════════════════════════════════════════
-- Meta Conversions API (Stage 2B) — server-side Purchase events.
--
-- A single AFTER INSERT/UPDATE trigger on `orders` fires the `meta-capi` edge
-- function (via pg_net, async — never blocks the order/payment path) when an order
-- becomes purchase-eligible: paid = true (online, after payment verification) OR
-- status ∈ confirmed/dispatched/delivered (COD/manual, after the merchant Accepts).
-- COD is NEVER sent at placement.
--
-- Idempotency is a SAFE lease state machine (pending → sending → sent | failed):
-- meta_capi_claim() atomically claims a row only when it's pending/failed OR a
-- STALE 'sending' lease (crash/timeout) — so a failed/hung request always stays
-- retryable and never permanently blocks the Purchase. event_id = order id keeps
-- every retry safe (Meta de-dupes).
--
-- Run ONCE in Supabase → SQL editor. Requires the one-time secret (see bottom).
-- ══════════════════════════════════════════════════════════════════════════════

create extension if not exists pg_net;

-- ── Match-quality columns captured at placement (used when Purchase fires later) ─
alter table public.orders add column if not exists fbp        text;
alter table public.orders add column if not exists fbc        text;
alter table public.orders add column if not exists client_ua  text;

-- ── Event log + idempotency state machine (RLS-locked; service-role only) ───────
create table if not exists public.meta_capi_events (
  order_id     uuid        not null,
  event_name   text        not null default 'Purchase',
  store_slug   text        not null,
  event_id     text        not null,
  pixel_id     text,
  status       text        not null default 'pending',  -- pending | sending | sent | failed
  attempts     int         not null default 0,
  http_code    int,
  error        text,
  claimed_at   timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (order_id, event_name)
);
alter table public.meta_capi_events enable row level security;
revoke all on public.meta_capi_events from anon, authenticated;
comment on table public.meta_capi_events is
  'Meta CAPI send log + idempotency lease (Stage 2B). RLS-locked; service-role only. No raw PII stored.';

-- ── Atomic claim/lease ──────────────────────────────────────────────────────────
-- Returns 'claimed' (go send), 'already_sent', 'locked' (live lease held), or
-- 'exhausted' (too many attempts). A stale 'sending' lease is re-claimable.
create or replace function public.meta_capi_claim(
  p_order_id uuid, p_event_name text, p_store_slug text, p_event_id text,
  p_pixel_id text, p_lease_seconds int default 120, p_max_attempts int default 6
) returns text
language plpgsql security definer set search_path = public as $$
declare v_ret text; v_attempts int;
begin
  insert into meta_capi_events (order_id, event_name, store_slug, event_id, pixel_id, status, attempts, claimed_at, created_at, updated_at)
  values (p_order_id, p_event_name, p_store_slug, p_event_id, p_pixel_id, 'sending', 1, now(), now(), now())
  on conflict (order_id, event_name) do update
    set status = 'sending', attempts = meta_capi_events.attempts + 1, claimed_at = now(), updated_at = now()
    where meta_capi_events.status in ('pending', 'failed')
       or (meta_capi_events.status = 'sending' and meta_capi_events.claimed_at < now() - make_interval(secs => p_lease_seconds))
  returning attempts into v_attempts;

  if v_attempts is not null then
    if v_attempts > p_max_attempts then
      update meta_capi_events set status = 'failed', error = 'max attempts', updated_at = now()
        where order_id = p_order_id and event_name = p_event_name;
      return 'exhausted';
    end if;
    return 'claimed';
  end if;

  select status into v_ret from meta_capi_events where order_id = p_order_id and event_name = p_event_name;
  if v_ret = 'sent' then return 'already_sent'; end if;
  return 'locked';   -- another worker holds a live lease
end $$;

-- ── Record the outcome ───────────────────────────────────────────────────────────
create or replace function public.meta_capi_mark(
  p_order_id uuid, p_event_name text, p_status text, p_http_code int, p_error text
) returns void
language sql security definer set search_path = public as $$
  update public.meta_capi_events
     set status = p_status, http_code = p_http_code, error = left(p_error, 500), updated_at = now()
   where order_id = p_order_id and event_name = p_event_name;
$$;

revoke all on function public.meta_capi_claim(uuid, text, text, text, text, int, int) from anon, authenticated;
revoke all on function public.meta_capi_mark(uuid, text, text, int, text) from anon, authenticated;

-- ── Trigger: fire meta-capi when an order becomes purchase-eligible ──────────────
-- Secret comes from a DB setting (set once, out of git):
--   alter database postgres set app.meta_capi_secret = '<secret>';
-- If unset, the trigger is a no-op (feature stays off).
create or replace function public.meta_capi_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_secret text := current_setting('app.meta_capi_secret', true);
  v_new boolean;
  v_old boolean;
begin
  if v_secret is null or v_secret = '' then return NEW; end if;
  if NEW.status = 'abandoned' or coalesce(NEW.total, 0) <= 0 then return NEW; end if;

  v_new := (NEW.paid is true) or (NEW.status in ('confirmed', 'dispatched', 'delivered'));
  v_old := (TG_OP = 'UPDATE') and ((OLD.paid is true) or (OLD.status in ('confirmed', 'dispatched', 'delivered')));

  if v_new and not v_old then
    perform net.http_post(
      url     := 'https://uoyqbexemoheipwrtkcz.supabase.co/functions/v1/meta-capi',
      body    := jsonb_build_object('order_id', NEW.id::text),
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-capi-secret', v_secret),
      timeout_milliseconds := 5000
    );
  end if;
  return NEW;
end $$;

drop trigger if exists trg_meta_capi on public.orders;
create trigger trg_meta_capi
  after insert or update on public.orders
  for each row execute function public.meta_capi_notify();

-- ══════════════════════════════════════════════════════════════════════════════
-- ONE-TIME SETUP (run separately, with a real secret — keep it out of git):
--   alter database postgres set app.meta_capi_secret = '<same value as META_CAPI_SECRET env>';
-- Then set the edge-function secret META_CAPI_SECRET to the same value and deploy
-- the meta-capi function. Until both are set, no events are sent.
-- ══════════════════════════════════════════════════════════════════════════════
