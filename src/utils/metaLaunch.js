import { supabase } from '../lib/supabase';

/**
 * Meta campaign launch (Stage 2D) — FOUNDER-ONLY client helpers. Every call
 * carries the founder's Supabase session token; the server re-checks crm_team
 * admin. Store owners cannot reach these (they only preview in Manage → Ads).
 * Creation makes everything PAUSED; only `launchActivate`/`launchResume` enable
 * spend.
 */
async function callLaunch(payload) {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) throw new Error('Founder sign-in required.');
  const res = await fetch('/api/meta/campaign-launch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
  if (res.status === 403) throw new Error('Founder access only.');
  const d = await res.json().catch(() => ({ error: 'server' }));
  return d;
}

export const launchCreate   = (slug, launchId, cfg) => callLaunch({ action: 'create', slug, launchId, ...cfg });
export const launchActivate = (launchId) => callLaunch({ action: 'activate', launchId });
export const launchPause    = (launchId) => callLaunch({ action: 'pause', launchId });
export const launchResume   = (launchId) => callLaunch({ action: 'resume', launchId });
export const launchStop     = (launchId) => callLaunch({ action: 'stop', launchId });
export const launchStatus   = (launchId) => callLaunch({ action: 'status', launchId });
