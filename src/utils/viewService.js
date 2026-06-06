import { supabase } from '../lib/supabase';

/**
 * Per-store page views — powers the owner-facing "Reach" card.
 *
 *  • logStoreView   — public (anon) insert when a customer opens a store page.
 *  • fetchViewStats — public aggregate counts (today / week / last week / total).
 *
 * Dedup is enforced server-side by a unique index (store_slug, visitor, day):
 * a repeat view the same day is rejected (409) and silently ignored, so each
 * device counts at most once per store per day. We also keep a localStorage
 * guard so we don't fire a doomed request on every in-app navigation.
 *
 * NOTE: the table has no public SELECT policy, so we MUST use a plain insert,
 * not an upsert — an upsert's ON CONFLICT check needs to read existing rows and
 * RLS would reject that.
 */

/** Stable anonymous per-device id (random; not tied to any identity). */
function visitorId() {
  try {
    let id = localStorage.getItem('pocketlink_vid');
    if (!id) {
      id = (crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);
      localStorage.setItem('pocketlink_vid', id);
    }
    return id;
  } catch {
    return 'anon';
  }
}

/** Have we already logged a view for this store today (this device)? */
function markLoggedToday(slug) {
  try {
    const key   = `pocketlink_view:${slug}`;
    const today = new Date().toISOString().slice(0, 10);
    if (localStorage.getItem(key) === today) return true;   // already counted
    localStorage.setItem(key, today);
    return false;
  } catch {
    return false;
  }
}

/** Best-effort: record one view per store per device per day. Never throws. */
export async function logStoreView(slug) {
  if (!slug) return;
  if (markLoggedToday(slug)) return;            // skip redundant same-day calls
  try {
    // Plain insert (no upsert — see note above). Duplicates 409 and are ignored.
    await supabase.from('store_views').insert({ store_slug: slug, visitor: visitorId() });
  } catch {
    /* network / duplicate — a missed view must never affect the page */
  }
}

/**
 * Public: aggregate view counts for a store. Returns
 * { today, week, lastWeek, total } or null on failure.
 */
export async function fetchViewStats(slug) {
  if (!slug) return null;
  try {
    const { data, error } = await supabase.rpc('get_store_view_stats', { p_slug: slug });
    if (error || !data) return null;
    const r = Array.isArray(data) ? data[0] : data;
    if (!r) return null;
    return {
      today:    r.today     || 0,
      week:     r.this_week  || 0,
      lastWeek: r.last_week  || 0,
      total:    r.total      || 0,
    };
  } catch {
    return null;
  }
}

/** % change of this week vs last week. null when there's no prior week to compare. */
export function weekTrend({ week = 0, lastWeek = 0 } = {}) {
  if (!lastWeek) return null;
  return Math.round(((week - lastWeek) / lastWeek) * 100);
}
