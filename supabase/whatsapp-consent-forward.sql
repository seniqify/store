-- ===========================================================================
--  WhatsApp consent at checkout  --  PR 2 of the automatic-messages project
--
--  Before PocketLink sends a customer a MARKETING WhatsApp (the cart reminder
--  in PR 3, campaigns in PR 4) that customer must have agreed to it, for that
--  shop. Meta requires opt-in for business-initiated messages, and India's DPDP
--  Act asks for consent by a clear affirmative action.
--
--  So the checkout gets an UNTICKED "Get offers & cart reminders on WhatsApp"
--  box, and each tick / untick is recorded here the moment it happens, with the
--  exact sentence the customer saw. The latest record per shop + phone is that
--  customer's current choice. Recording on the tick, not on the order, matters:
--  the cart reminder is for customers who did NOT finish the order.
--
--  whatsapp_consents is append-only evidence: who agreed to what, when.
--
--  Nothing that exists is changed: one new table, two new functions.
--
--  RUN: Supabase Dashboard -> SQL Editor -> paste -> Run. Idempotent.
--  VERIFY afterwards: supabase/whatsapp-consent-verify.sql (every C row PASS)
--  UNDO: supabase/whatsapp-consent-ROLLBACK.sql (refuses once consent is recorded)
-- ===========================================================================

begin;

create table if not exists public.whatsapp_consents (
  id          bigserial primary key,
  store_slug  text not null,
  phone       text not null check (phone ~ '^[6-9][0-9]{9}$'),
  granted     boolean not null,
  source      text not null check (source in ('checkout', 'customer_stop', 'seller')),
  wording     text check (char_length(wording) <= 300),
  created_at  timestamptz not null default now()
);
create index if not exists whatsapp_consents_lookup_idx on public.whatsapp_consents (store_slug, phone, id desc);

alter table public.whatsapp_consents enable row level security;
revoke all on public.whatsapp_consents from public, anon, authenticated;
revoke all on sequence public.whatsapp_consents_id_seq from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Record a tick or untick from the checkout. Callable by the browser (anon):
-- the customer has no login, exactly like placing an order. Returns true when
-- the choice is on record (written now, or already the latest), false when the
-- input is not usable. Never raises, so a checkout is never disturbed by it.
--
-- A repeat of the current choice writes nothing, so toggling cannot grow the
-- table beyond real changes of mind.
-- ---------------------------------------------------------------------------
create or replace function public.record_whatsapp_consent(p_slug text, p_phone text, p_granted boolean, p_wording text)
returns boolean
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
declare
  v_phone text := right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 10);
  v_last  boolean;
begin
  if p_granted is null or v_phone !~ '^[6-9][0-9]{9}$' then
    return false;
  end if;
  if not exists (select 1 from public.stores s where s.slug = p_slug) then
    return false;
  end if;

  select c.granted into v_last
    from public.whatsapp_consents c
   where c.store_slug = p_slug and c.phone = v_phone
   order by c.id desc
   limit 1;
  if v_last is not distinct from p_granted then
    return true;
  end if;

  insert into public.whatsapp_consents (store_slug, phone, granted, source, wording)
  values (p_slug, v_phone, p_granted, 'checkout', left(nullif(trim(coalesce(p_wording, '')), ''), 300));
  return true;
end;
$function$;

-- ---------------------------------------------------------------------------
-- Has this customer agreed to marketing messages from this shop? The LATEST
-- record decides; no record means no. service_role only: the message sender
-- asks this right before every marketing send.
-- ---------------------------------------------------------------------------
create or replace function public.whatsapp_consent_granted(p_slug text, p_phone text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  select coalesce((
    select c.granted
      from public.whatsapp_consents c
     where c.store_slug = p_slug
       and c.phone = right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 10)
     order by c.id desc
     limit 1), false)
$function$;

-- Revoked from anon and authenticated BY NAME: Supabase's default privileges
-- grant EXECUTE on new functions straight to them, so PUBLIC alone is not enough.
revoke all on function public.record_whatsapp_consent(text, text, boolean, text) from public, anon, authenticated;
revoke all on function public.whatsapp_consent_granted(text, text)               from public, anon, authenticated;

grant execute on function public.record_whatsapp_consent(text, text, boolean, text) to anon, authenticated, service_role;
grant execute on function public.whatsapp_consent_granted(text, text)               to service_role;

commit;
