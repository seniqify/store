/**
 * platformFlags — the switches set in PocketLink Admin (System and switches):
 * new sign-ups on/off, a banner for every shop dashboard, maintenance mode.
 * Read through platform_flags() (supabase/admin-part3-forward.sql). If the
 * read fails, everything stays as normal: sign-ups open, no banner, no
 * maintenance — a hiccup here must never lock anyone out.
 */
import { supabase } from '../lib/supabase';

export const DEFAULT_FLAGS = Object.freeze({ signupsOpen: true, banner: '', maintenance: false, maintenanceText: '' });

/** Plain flags from whatever the database returned (or nothing). */
export function cleanFlags(raw) {
  const f = raw && typeof raw === 'object' ? raw : {};
  return {
    signupsOpen: f.signupsOpen !== false,
    banner: typeof f.banner === 'string' ? f.banner.trim().slice(0, 200) : '',
    maintenance: f.maintenance === true,
    maintenanceText: typeof f.maintenanceText === 'string' ? f.maintenanceText.trim().slice(0, 200) : '',
  };
}

let cached = null;   // { at, promise }

/** The current flags; one read per minute at most. Never throws. */
export function fetchPlatformFlags() {
  if (cached && Date.now() - cached.at < 60000) return cached.promise;
  const promise = Promise.resolve()
    .then(() => supabase.rpc('platform_flags'))
    .then(({ data, error }) => (error ? { ...DEFAULT_FLAGS } : cleanFlags(data)))
    .catch(() => ({ ...DEFAULT_FLAGS }));
  cached = { at: Date.now(), promise };
  return promise;
}
