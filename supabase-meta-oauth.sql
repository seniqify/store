-- ══════════════════════════════════════════════════════════════════════════════
-- Meta (Facebook Login for Business) — Stage 1 OAuth connection store.
--
-- One row per store holding a seller's Meta connection. This table is RLS-LOCKED
-- exactly like store_payment_accounts: RLS is enabled and NO policies are created,
-- so anon / authenticated clients can neither read nor write it. Only the Vercel
-- serverless callback (api/meta/callback) and disconnect endpoint touch it, using
-- the SERVICE-ROLE key, which bypasses RLS. Access tokens therefore never reach
-- the browser. A public-safe summary is mirrored into stores.config.meta
-- separately (no token) so the Manage UI can show connection status.
--
-- Run ONCE in Supabase → SQL editor.
-- ══════════════════════════════════════════════════════════════════════════════

create table if not exists public.store_meta_accounts (
  store_slug      text        primary key,
  provider        text        not null default 'meta',
  business_id     text,                                    -- Meta Business Portfolio ID
  business_name   text,
  ad_account_ids  jsonb       not null default '[]'::jsonb, -- captured now if ads_read granted
  scopes          jsonb       not null default '[]'::jsonb, -- granted permissions
  access_token    text,                                    -- long-lived user token (server-only)
  token_type      text,
  expires_at      timestamptz,                             -- token expiry, if provided
  status          text        not null default 'connected', -- connected | revoked | error
  connected_at    timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter table public.store_meta_accounts enable row level security;

-- No policies on purpose → anon & authenticated are denied all access.
-- The service role (server-side only) bypasses RLS to read/write.
-- Defense-in-depth: also revoke table grants from the client roles.
revoke all on public.store_meta_accounts from anon, authenticated;

comment on table public.store_meta_accounts is
  'Meta Login-for-Business OAuth connection per store (Stage 1). RLS-locked; service-role only. Access tokens never exposed to the browser.';
