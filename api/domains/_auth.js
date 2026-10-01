// Merchant authentication for custom-domain endpoints: the store PIN.
//
// Same mechanism as every other owner-only action (Manage, Meta, Razorpay
// connect): the browser sends slug + SHA-256 PIN hash, and the throttled
// verify_store_pin RPC (per-IP and per-store failure limits) decides. The store
// is identified by that verified slug alone; a group id or hostname sent by the
// browser is never trusted to say which store it belongs to.
//
// The caller's real IP is forwarded so verify_store_pin's per-IP limit applies
// to the person, not to the shared Vercel egress address. Vercel sets
// x-real-ip / x-forwarded-for itself; a client cannot supply them.
import { isIP } from 'node:net';
import { ANON } from '../meta/_meta.js';
import { fetchJsonWithin } from './_http.js';

export function cleanSlug(raw) {
  return String(raw ?? '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 60);
}

/**
 * CUSTOM_DOMAINS_PILOT_STORES (server-only: not a Vite variable, never in the
 * browser bundle): the exact store slugs that may use the merchant domain API
 * while CUSTOM_DOMAINS_ENABLED is on. Comma-separated; each entry is trimmed and
 * lowercased, and must then already BE a slug as cleanSlug() makes one -- an
 * entry it would change (a space, "*", ".", anything over 60 characters) is
 * ignored rather than cleaned into some other slug. No wildcard, prefix or
 * suffix matching. Unset or empty: no store may use the API.
 */
export function pilotStores(env = process.env) {
  const slugs = new Set();
  for (const raw of String(env.CUSTOM_DOMAINS_PILOT_STORES ?? '').split(',')) {
    const entry = raw.trim().toLowerCase();
    if (entry && cleanSlug(entry) === entry) slugs.add(entry);
  }
  return slugs;
}

/** May this (already cleaned) store slug use the merchant domain API? */
export function isPilotStore(slug, env = process.env) {
  return Boolean(slug) && pilotStores(env).has(slug);
}

export function cleanHashedPin(raw) {
  const s = String(raw ?? '').toLowerCase();
  return /^[0-9a-f]{64}$/.test(s) ? s : '';
}

export function clientIp(req) {
  const h = req?.headers || {};
  const candidates = [h['x-real-ip'], String(h['x-forwarded-for'] || '').split(',')[0]];
  for (const c of candidates) {
    const ip = String(c ?? '').trim();
    if (ip && isIP(ip)) return ip;
  }
  return null;
}

/** true only when verify_store_pin says so; every failure is a refusal. */
export async function verifyOwnerPin({ supabaseUrl, fetchImpl = globalThis.fetch, timeoutMs = 8000 }, slug, hashedPin, ip) {
  if (!slug || !hashedPin) return false;
  const headers = { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json' };
  if (ip) headers['x-forwarded-for'] = ip;
  const r = await fetchJsonWithin(fetchImpl, `${supabaseUrl}/rest/v1/rpc/verify_store_pin`, {
    method: 'POST', headers, body: JSON.stringify({ p_slug: slug, p_hashed_pin: hashedPin }),
  }, timeoutMs);
  return r.ok && r.json === true;
}
