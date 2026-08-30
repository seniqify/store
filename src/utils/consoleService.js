import { supabase } from '../lib/supabase';

/**
 * PocketLink Console data layer (founder mission-control).
 *
 * Auth is the same Supabase session the Sales Hub uses; the Console is gated to
 * crm_team members with role = 'admin' (the founder). Reads of the stores table
 * use the public/anon-visible config fields; orders are RLS-gated to the team.
 * Every WRITE goes through the console_update_store SECURITY DEFINER RPC, which
 * re-checks admin membership server-side and audit-logs the change
 * (see supabase/console-setup.sql).
 */

// ── Auth (shared with the Sales Hub) ──────────────────────────────────────────
export async function consoleSession() {
  const { data } = await supabase.auth.getSession();
  return data?.session ?? null;
}
export function onConsoleAuthChange(cb) {
  const { data } = supabase.auth.onAuthStateChange((_e, session) => cb(session));
  return () => data?.subscription?.unsubscribe();
}
export async function consoleSignIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);
  return data.session;
}
export async function consoleSignOut() {
  await supabase.auth.signOut();
}
/** The caller's crm_team row (RLS: members only; null for outsiders). */
export async function fetchMyTeamRow(userId) {
  try {
    const { data, error } = await supabase.from('crm_team').select('user_id, name, role');
    if (error) return null;
    return (data || []).find((t) => t.user_id === userId) ?? null;
  } catch {
    return null;
  }
}

// ── Reads ─────────────────────────────────────────────────────────────────────
/** Every store with the fields the Console needs. Public config read (same as
 *  the marketplace); theme + billingNote come back as whole JSON objects so a
 *  write can patch them without dropping sibling keys. */
export async function fetchStoresConsole() {
  try {
    const { data, error } = await supabase
      .from('stores')
      .select(`slug, created_at, updated_at,
               name:config->>businessName, plan:config->>plan,
               exp:config->>planExpiresAt, bt:config->>businessType,
               wa:config->>whatsappNumber, city:config->>city,
               sub:config->>razorpaySubscriptionId, logoEmoji:config->>logoEmoji,
               theme:config->theme, billing:config->billingNote`)
      .limit(2000);
    if (error) return [];
    return data || [];
  } catch {
    return [];
  }
}

/** Orders across all stores since an ISO timestamp (RLS: crm team only). */
export async function fetchConsoleOrders(sinceIso) {
  try {
    const { data, error } = await supabase
      .from('orders')
      .select('id, store_slug, created_at, total, item_count, status, paid, payment_method, customer_name')
      .neq('status', 'abandoned')
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: false })
      .limit(1000);
    if (error) return [];
    return data || [];
  } catch {
    return [];
  }
}

// ── Write (founder-only, server-gated + audited) ──────────────────────────────
/** Patch a store's config via the admin-gated RPC. `patch` is shallow-merged
 *  into config, so pass whole nested objects (e.g. the full theme). Returns the
 *  new config. Throws with the server's message if the caller isn't an admin. */
export async function consoleUpdateStore(slug, patch, action = 'update') {
  const { data, error } = await supabase.rpc('console_update_store', {
    p_slug: slug, p_patch: patch, p_action: action,
  });
  if (error) throw new Error(error.message);
  return data;
}

// ── Assistant (founder-only ops copilot) ──────────────────────────────────────
/** Ask the console-assistant edge function. `context` carries a compact store
 *  snapshot for the model to reason over. Returns { reply, action } — or an
 *  { error, message } for not_configured / llm_error the UI can show plainly. */
export async function askAssistant(question, context) {
  const { data, error } = await supabase.functions.invoke('console-assistant', {
    body: { question, context },
  });
  if (error) {
    // Auth failures (401/403) surface here; the fn returns 200 for app errors.
    let msg = error.message || 'Assistant unavailable';
    try { const b = await error.context?.json?.(); if (b?.message) msg = b.message; } catch { /* ignore */ }
    return { error: 'request_failed', message: msg };
  }
  return data;
}

// ── Small shared helpers ──────────────────────────────────────────────────────
/** ISO timestamp for `days` days ago. */
export function daysAgoIso(days) {
  return new Date(Date.now() - days * 86400000).toISOString();
}

/** ISO timestamp `years` years from now (for a manual subscription expiry). */
export function yearsFromNowIso(years = 1) {
  const d = new Date();
  d.setFullYear(d.getFullYear() + years);
  return d.toISOString();
}
