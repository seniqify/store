-- ════════════════════════════════════════════════════════════════════════════
-- WhatsApp campaign — per-store Seniqify (backendprod) API credentials.
--
-- Stores each owner's OWN template API URL + Bearer key so PocketLink can send
-- their approved templates to their saved customers. This is a SECRET: it must
-- NEVER live in the public stores.config JSON (config is readable by anon).
--
-- Security model (mirrors orders / OTP):
--   • RLS is ON with NO anon/public policies → anon cannot read or write at all.
--   • Owners read/write only through the SECURITY DEFINER RPCs below, each gated
--     by the store PIN (stores.pin holds the hashed PIN).
--   • The send-campaign edge function reads it with the service role (bypasses
--     RLS) to attach the key server-side.
--
-- Run this once in the Supabase SQL editor.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.store_whatsapp (
  store_slug    text primary key,   -- one row per store; integrity enforced by the PIN check in the RPCs
  template_url  text,
  api_key       text,
  var_templates jsonb       not null default '["{name}"]'::jsonb,  -- per-variable value templates
  updated_at    timestamptz not null default now()
);

alter table public.store_whatsapp enable row level security;
-- No policies are created on purpose: anon/authenticated have zero direct access.
-- All access goes through the PIN-checked functions below (or the service role).

-- ── Owner writes (PIN-checked) ───────────────────────────────────────────────
-- Pass an empty api_key to keep the previously saved key (so the masked-key UI
-- doesn't have to round-trip the secret).
create or replace function public.set_store_whatsapp(
  p_slug          text,
  p_hashed_pin    text,
  p_template_url  text,
  p_api_key       text,
  p_var_templates jsonb
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.stores s where s.slug = p_slug and s.pin = p_hashed_pin) then
    raise exception 'unauthorized';
  end if;

  insert into public.store_whatsapp (store_slug, template_url, api_key, var_templates, updated_at)
  values (p_slug, p_template_url, nullif(p_api_key, ''),
          coalesce(p_var_templates, '["{name}"]'::jsonb), now())
  on conflict (store_slug) do update set
    template_url  = excluded.template_url,
    api_key       = coalesce(nullif(p_api_key, ''), public.store_whatsapp.api_key),
    var_templates = excluded.var_templates,
    updated_at    = now();
end;
$$;

-- ── Owner reads (PIN-checked) ────────────────────────────────────────────────
-- Returns the key MASKED (last 4 only) so the raw secret never reaches the
-- browser; the owner re-pastes to change it.
create or replace function public.get_store_whatsapp(
  p_slug       text,
  p_hashed_pin text
) returns table (
  configured     boolean,
  template_url   text,
  api_key_masked text,
  var_templates  jsonb
)
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.stores s where s.slug = p_slug and s.pin = p_hashed_pin) then
    raise exception 'unauthorized';
  end if;

  return query
    select
      (w.template_url is not null and w.template_url <> '') as configured,  -- the URL is the credential; key is optional
      coalesce(w.template_url, '') as template_url,
      case when w.api_key is null or w.api_key = '' then ''
           else '••••' || right(w.api_key, 4) end as api_key_masked,
      coalesce(w.var_templates, '["{name}"]'::jsonb) as var_templates
    from public.store_whatsapp w
    where w.store_slug = p_slug;
end;
$$;

grant execute on function public.set_store_whatsapp(text, text, text, text, jsonb) to anon, authenticated;
grant execute on function public.get_store_whatsapp(text, text)                   to anon, authenticated;
