-- ══════════════════════════════════════════════════════════════════════════════
-- POCKETLINK SALES HUB — internal CRM (founder + sales executives)
-- Run this in: Supabase Dashboard → SQL Editor
--
-- SETUP (one-time, ~2 minutes):
--   1. Run this whole file.
--   2. Supabase Dashboard → Authentication → Users → "Add user" (×3):
--      your email + the 2 sales execs (set a password, tick auto-confirm).
--   3. Copy each user's UUID from that list into the crm_team INSERTs at the
--      bottom of this file and run them.
--   4. (Recommended) Authentication → Sign In / Up → disable public sign-ups.
--      Even if left on, a random signup is harmless: every policy below checks
--      crm_team membership, and the UI blocks non-members.
--
-- Access model: one shared pipeline. Everyone on the team sees all leads
-- (prevents two execs pitching the same shop). Roles: 'admin' (founder — sees
-- revenue/team stats in the UI) and 'sales'.
-- ══════════════════════════════════════════════════════════════════════════════

-- ── Team registry ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.crm_team (
  user_id  UUID PRIMARY KEY,          -- auth.users.id
  name     TEXT NOT NULL,
  role     TEXT NOT NULL DEFAULT 'sales' CHECK (role IN ('admin', 'sales'))
);

ALTER TABLE public.crm_team ENABLE ROW LEVEL SECURITY;

-- Membership check as SECURITY DEFINER so policies can consult crm_team without
-- recursing into crm_team's own RLS (a policy that subqueries its own table
-- triggers "infinite recursion detected" — 42P17).
CREATE OR REPLACE FUNCTION public.is_crm_member()
RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public
AS $$ SELECT EXISTS (SELECT 1 FROM public.crm_team WHERE user_id = auth.uid()) $$;
GRANT EXECUTE ON FUNCTION public.is_crm_member() TO authenticated;

DROP POLICY IF EXISTS "team members read team" ON public.crm_team;
CREATE POLICY "team members read team" ON public.crm_team
  FOR SELECT TO authenticated
  USING (public.is_crm_member());

GRANT SELECT ON public.crm_team TO authenticated;

-- ── Leads (the one table; scales with indexes, no migration needed later) ─────
CREATE TABLE IF NOT EXISTS public.crm_leads (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  business_name  TEXT NOT NULL,
  owner_name     TEXT,
  phone          TEXT NOT NULL,           -- 10-digit local
  category       TEXT,
  city           TEXT,
  area           TEXT,

  source         TEXT,                    -- walk-in / cold-visit / referral / …
  status         TEXT NOT NULL DEFAULT 'new'
                 CHECK (status IN ('new','contacted','demo','interested','won-paid','won-free','lost')),
  plan           TEXT,                    -- free / business / premium (when won)
  amount         INTEGER,                 -- ₹ collected directly (cash/UPI), if any
  reasons        TEXT[],                  -- why they bought (multi-select)
  objection      TEXT,                    -- why not / why free
  store_slug     TEXT,                    -- link to stores.slug once created

  next_follow_up DATE,
  priority       TEXT CHECK (priority IN ('high','medium','low') OR priority IS NULL),
  notes          TEXT,

  assigned_to    UUID,                    -- crm_team.user_id
  created_by     UUID
);

CREATE INDEX IF NOT EXISTS idx_crm_leads_follow   ON public.crm_leads (next_follow_up);
CREATE INDEX IF NOT EXISTS idx_crm_leads_status   ON public.crm_leads (status);
CREATE INDEX IF NOT EXISTS idx_crm_leads_assigned ON public.crm_leads (assigned_to);
CREATE INDEX IF NOT EXISTS idx_crm_leads_phone    ON public.crm_leads (phone);
CREATE INDEX IF NOT EXISTS idx_crm_leads_created  ON public.crm_leads (created_at DESC);

ALTER TABLE public.crm_leads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "team full access leads" ON public.crm_leads;
CREATE POLICY "team full access leads" ON public.crm_leads
  FOR ALL TO authenticated
  USING      (public.is_crm_member())
  WITH CHECK (public.is_crm_member());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_leads TO authenticated;

-- ── Platform visibility for the Hub (Activity tab) ────────────────────────────
-- Team members may READ orders and view-logs across all stores (the Hub's
-- activity feed & store-health table). Public/anon access is unchanged.
DROP POLICY IF EXISTS "crm team read orders" ON public.orders;
CREATE POLICY "crm team read orders" ON public.orders
  FOR SELECT TO authenticated
  USING (public.is_crm_member());
GRANT SELECT ON public.orders TO authenticated;

DROP POLICY IF EXISTS "crm team read views" ON public.store_views;
CREATE POLICY "crm team read views" ON public.store_views
  FOR SELECT TO authenticated
  USING (public.is_crm_member());
GRANT SELECT ON public.store_views TO authenticated;

-- ── Team members — REPLACE the UUIDs after creating the users (step 2 above) ──
-- INSERT INTO public.crm_team (user_id, name, role) VALUES
--   ('PASTE-YOUR-UUID-HERE',   'Rohan',  'admin'),
--   ('PASTE-EXEC-1-UUID-HERE', 'Exec 1', 'sales'),
--   ('PASTE-EXEC-2-UUID-HERE', 'Exec 2', 'sales');

-- ══════════════════════════════════════════════════════════════════════════════
-- DONE.
-- ══════════════════════════════════════════════════════════════════════════════
