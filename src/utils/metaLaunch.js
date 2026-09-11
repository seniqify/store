import { supabase } from '../lib/supabase';
import { hashPin } from './pinHash';

/**
 * Meta campaign launch (Stage 2D) — merchant helpers.
 *
 * PocketLink sellers have no email accounts: they register with a WhatsApp
 * number, prove it with a one-time code, and open Manage with a 4-digit PIN. So
 * every call here carries that PIN, exactly like the Ads dashboard and the
 * campaign preview do. The server re-verifies it against the store.
 *
 * A staff (crm_team) session is sent when one happens to exist, because staff
 * may operate a store without its PIN. It is never required.
 *
 * Creation makes everything PAUSED. Only `launchActivate` / `launchResume`
 * enable spend, and those need a fresh one-time code sent to the store's
 * registered WhatsApp number.
 */
async function callLaunch(slug, pin, payload) {
  const headers = { 'Content-Type': 'application/json' };

  // Optional staff session — absent for an ordinary merchant, and that is fine.
  try {
    const { data } = await supabase.auth.getSession();
    const token = data?.session?.access_token;
    if (token) headers.Authorization = `Bearer ${token}`;
  } catch { /* no session → PIN is the credential */ }

  const res = await fetch('/api/meta/campaign-launch', {
    method: 'POST',
    headers,
    body: JSON.stringify({ slug, hashedPin: await hashPin(pin), ...payload }),
  });
  const d = await res.json().catch(() => ({ error: 'server' }));
  if (res.status === 403 && !d?.error) return { error: 'pin' };
  return d;
}

export const launchCreate = (slug, pin, launchId, cfg) =>
  callLaunch(slug, pin, { action: 'create', launchId, ...cfg });

/** Enabling spend needs the one-time code from the store's WhatsApp number. */
export const launchActivate = (slug, pin, launchId, otpCode) =>
  callLaunch(slug, pin, { action: 'activate', launchId, otpCode });
export const launchResume = (slug, pin, launchId, otpCode) =>
  callLaunch(slug, pin, { action: 'resume', launchId, otpCode });

// Pausing and stopping only ever REDUCE delivery, so the PIN alone is enough.
export const launchPause  = (slug, pin, launchId) => callLaunch(slug, pin, { action: 'pause', launchId });
export const launchStop   = (slug, pin, launchId) => callLaunch(slug, pin, { action: 'stop', launchId });
export const launchStatus = (slug, pin, launchId) => callLaunch(slug, pin, { action: 'status', launchId });
