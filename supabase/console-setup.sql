-- ════════════════════════════════════════════════════════════════════════════
-- PocketLink Console — founder mission-control: secure write path + audit.
--
-- The `stores` table blocks public UPDATE (writes go through the PIN-gated
-- `update_store_config` RPC for owners). The Console needs a *founder-only* way
-- to patch any store without a PIN, so it uses its own SECURITY DEFINER RPC
-- gated on crm_team admin membership — the same trust model as is_crm_member(),
-- restricted to role = 'admin' (the founder). Every write is audit-logged.
--
-- Apply in the Supabase SQL editor (or via the management API) once.
-- ════════════════════════════════════════════════════════════════════════════

-- Founder check: the caller is a crm_team member with the admin role.
-- SECURITY DEFINER + a pinned search_path so it can read crm_team under RLS.
create or replace function public.is_crm_admin()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.crm_team
    where user_id = auth.uid() and role = 'admin'
  );
$$;

grant execute on function public.is_crm_admin() to authenticated, anon;

-- Append-only audit of every Console write — who changed what, when.
create table if not exists public.console_audit (
  id         bigint generated always as identity primary key,
  actor      uuid,
  action     text not null,
  slug       text,
  patch      jsonb,
  created_at timestamptz not null default now()
);
alter table public.console_audit enable row level security;
drop policy if exists console_audit_read on public.console_audit;
create policy console_audit_read on public.console_audit
  for select using (public.is_crm_admin());
-- No INSERT/UPDATE/DELETE policy: rows are written only by the SECURITY DEFINER
-- function below (which bypasses RLS), never directly by a client.

-- Founder-only store patch. Shallow-merges p_patch into config; the client sends
-- whole nested objects (e.g. the full theme) so a shallow merge never drops keys.
-- Returns the new config. Refuses anyone who is not a crm_team admin.
create or replace function public.console_update_store(
  p_slug   text,
  p_patch  jsonb,
  p_action text default 'update'
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare new_cfg jsonb;
begin
  if not public.is_crm_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  update public.stores
     set config = config || p_patch, updated_at = now()
   where slug = p_slug
   returning config into new_cfg;

  if new_cfg is null then
    raise exception 'store not found: %', p_slug using errcode = 'P0002';
  end if;

  insert into public.console_audit(actor, action, slug, patch)
    values (auth.uid(), p_action, p_slug, p_patch);

  return new_cfg;
end;
$$;

-- Only signed-in users may call it; the admin check inside is the real gate.
revoke all on function public.console_update_store(text, jsonb, text) from public, anon;
grant execute on function public.console_update_store(text, jsonb, text) to authenticated;
