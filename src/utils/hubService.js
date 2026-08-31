import { supabase } from '../lib/supabase';

/**
 * Sales Hub data layer (internal CRM).
 * Every read here is gated server-side by RLS on crm_team membership
 * (supabase-sales-hub.sql) — a logged-in non-member gets empty results and the
 * UI shows "not authorized". Reads of the public stores table use the same
 * anon-visible fields the marketplace already exposes.
 */

// ── Auth ──────────────────────────────────────────────────────────────────────
export async function hubSession() {
  const { data } = await supabase.auth.getSession();
  return data?.session ?? null;
}

export function onHubAuthChange(cb) {
  const { data } = supabase.auth.onAuthStateChange((_event, session) => cb(session));
  return () => data?.subscription?.unsubscribe();
}

export async function hubSignIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);
  return data.session;
}

export async function hubSignOut() {
  await supabase.auth.signOut();
}

// ── Team ──────────────────────────────────────────────────────────────────────
/** All team rows (RLS: members only — [] for outsiders). */
export async function fetchTeam() {
  try {
    const { data, error } = await supabase.from('crm_team').select('user_id, name, role');
    if (error) return [];
    return data || [];
  } catch {
    return [];
  }
}

// ── Leads ─────────────────────────────────────────────────────────────────────
export async function listLeads() {
  try {
    const { data, error } = await supabase
      .from('crm_leads')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(1000);
    if (error) return [];
    return data || [];
  } catch {
    return [];
  }
}

export async function addLead(lead) {
  const { data, error } = await supabase.from('crm_leads').insert(lead).select().single();
  if (error) throw new Error(error.message);
  return data;
}

export async function updateLead(id, patch) {
  const { data, error } = await supabase
    .from('crm_leads')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

// ── Platform data (activity / renewals / health) ──────────────────────────────
/** All stores, slim fields only (public read — same as the marketplace). */
export async function fetchStoresLite() {
  try {
    const { data, error } = await supabase
      .from('stores')
      .select(`slug, created_at, updated_at,
               name:config->>businessName, plan:config->>plan,
               exp:config->>planExpiresAt, sub:config->>razorpaySubscriptionId,
               wa:config->>whatsappNumber, city:config->>city,
               bt:config->>businessType, mgr:config->>managedBy`)
      .limit(1000);
    if (error) return [];
    return data || [];
  } catch {
    return [];
  }
}

/** Orders across all stores since an ISO timestamp (RLS: crm team only). */
export async function fetchRecentOrders(sinceIso) {
  try {
    const { data, error } = await supabase
      .from('orders')
      .select('id, store_slug, created_at, total, item_count, status, customer_name')
      .neq('status', 'abandoned')
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: false })
      .limit(300);
    if (error) return [];
    return data || [];
  } catch {
    return [];
  }
}

/** View rows since a date (YYYY-MM-DD, IST) across stores (RLS: crm team only). */
export async function fetchViewsSince(sinceDate) {
  try {
    const { data, error } = await supabase
      .from('store_views')
      .select('store_slug, viewed_on')
      .gte('viewed_on', sinceDate)
      .limit(10000);
    if (error) return [];
    return data || [];
  } catch {
    return [];
  }
}

// ── Small shared helpers ──────────────────────────────────────────────────────
/** Today's date in IST as YYYY-MM-DD (matches store_views.viewed_on). */
export function todayIST() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
}

/** ISO date (YYYY-MM-DD, IST) for `days` days ago. */
export function istDaysAgo(days) {
  const d = new Date(Date.now() - days * 86400000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d);
}
