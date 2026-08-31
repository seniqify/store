// Shared server-side helpers for the Meta (Facebook Login for Business) OAuth
// flow — Stage 1. Imported by start.js / callback.js / disconnect.js.
//
// Nothing here ever runs in the browser: the Meta App Secret, the HMAC state
// secret, and the Supabase service-role key are read from server-only env vars
// and never returned to the client. The underscore prefix keeps this file out of
// Vercel's route table (same convention as api/_seo.js).
import crypto from 'node:crypto';

// Public anon values — safe to inline (already shipped in the client bundle).
export const SB   = process.env.SUPABASE_URL || 'https://uoyqbexemoheipwrtkcz.supabase.co';
export const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVveXFiZXhlbW9oZWlwd3J0a2N6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk2OTYzMTksImV4cCI6MjA5NTI3MjMxOX0.LWkT6EUVGuUIUE38XYGcfmn8DgAKMz3JC20bxuTCcx0';

// Non-secret config (env overrides; sensible defaults so the flow works once the
// secrets below are set). App ID / config_id / redirect URI are all public.
export const GRAPH_VER    = process.env.META_GRAPH_VERSION  || 'v21.0';
export const APP_ID       = process.env.META_APP_ID         || '1579880590578328';
export const CONFIG_ID    = process.env.META_LOGIN_CONFIG_ID || '899668282953808';
export const REDIRECT_URI = process.env.META_REDIRECT_URI   || 'https://www.pocketlink.store/api/meta/callback';
export const APP_ORIGIN   = process.env.APP_ORIGIN          || 'https://www.pocketlink.store';

// Secrets (server-only). Empty string ⇒ "not configured" → the callers 503/redirect.
export const appSecret   = () => process.env.META_APP_SECRET          || '';
export const stateSecret = () => process.env.META_OAUTH_STATE_SECRET  || '';
export const serviceKey  = () => process.env.SUPABASE_SERVICE_ROLE_KEY || '';

// ── Signed state (CSRF + binds slug → connection; stateless, no DB) ───────────
// state = base64url({slug,iat}) + "." + HMAC_SHA256(payload, STATE_SECRET)
export function signState(slug) {
  const payload = Buffer.from(JSON.stringify({ slug, iat: Date.now() })).toString('base64url');
  const sig = crypto.createHmac('sha256', stateSecret()).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export function verifyState(state, maxAgeMs = 10 * 60 * 1000) {
  try {
    const secret = stateSecret();
    if (!state || !secret) return null;
    const [payload, sig] = String(state).split('.');
    if (!payload || !sig) return null;
    const expected = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data?.slug || !data?.iat) return null;
    if (Date.now() - Number(data.iat) > maxAgeMs) return null;   // expired
    return data;   // { slug, iat }
  } catch {
    return null;
  }
}

// ── PIN gate — reuses the existing verify_store_pin RPC (anon, SECURITY DEFINER)
export async function verifyStorePin(slug, hashedPin) {
  try {
    const r = await fetch(`${SB}/rest/v1/rpc/verify_store_pin`, {
      method: 'POST',
      headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_slug: slug, p_hashed_pin: hashedPin }),
    });
    if (!r.ok) return false;
    return (await r.json()) === true;
  } catch {
    return false;
  }
}

// ── Meta Graph GET (resilient — never throws) ─────────────────────────────────
export async function graphGet(path, params) {
  try {
    const qs = new URLSearchParams(params).toString();
    const r  = await fetch(`https://graph.facebook.com/${GRAPH_VER}/${path}?${qs}`);
    const body = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, body };
  } catch {
    return { ok: false, status: 0, body: {} };
  }
}

// ── Supabase (service-role, server-only) ──────────────────────────────────────
function svc(extra = {}) {
  const key = serviceKey();
  return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...extra };
}

export async function upsertMetaAccount(row) {
  try {
    const r = await fetch(`${SB}/rest/v1/store_meta_accounts`, {
      method: 'POST',
      headers: svc({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
      body: JSON.stringify(row),
    });
    return r.ok;
  } catch {
    return false;
  }
}

export async function updateMetaStatus(slug, patch) {
  try {
    const r = await fetch(`${SB}/rest/v1/store_meta_accounts?store_slug=eq.${encodeURIComponent(slug)}`, {
      method: 'PATCH',
      headers: svc({ Prefer: 'return=minimal' }),
      body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
    });
    return r.ok;
  } catch {
    return false;
  }
}

export async function getMetaAccount(slug) {
  try {
    const r = await fetch(
      `${SB}/rest/v1/store_meta_accounts?store_slug=eq.${encodeURIComponent(slug)}&select=*&limit=1`,
      { headers: svc() },
    );
    if (!r.ok) return null;
    return (await r.json())[0] || null;
  } catch {
    return null;
  }
}

export async function getStoreConfig(slug) {
  try {
    const r = await fetch(
      `${SB}/rest/v1/stores?slug=eq.${encodeURIComponent(slug)}&select=config&limit=1`,
      { headers: svc() },
    );
    if (!r.ok) return null;
    return (await r.json())[0]?.config || null;
  } catch {
    return null;
  }
}

export async function patchStoreConfig(slug, config) {
  try {
    const r = await fetch(`${SB}/rest/v1/stores?slug=eq.${encodeURIComponent(slug)}`, {
      method: 'PATCH',
      headers: svc({ Prefer: 'return=minimal' }),
      body: JSON.stringify({ config, updated_at: new Date().toISOString() }),
    });
    return r.ok;
  } catch {
    return false;
  }
}
