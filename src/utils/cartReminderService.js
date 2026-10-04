import { supabase } from '../lib/supabase';
import { hashPin } from './pinHash';
import { factsFailed } from './orderFactsResult';

/**
 * Automatic cart reminders — the browser side. Who gets a reminder, when, and
 * paying for it are decided in SQL (supabase/cart-reminders-forward.sql) and
 * sent by the cart-reminders edge function; the browser only flips the shop's
 * switch, reads its results, and opens a reminder link.
 */

/** The shop's switch + last-30-day results:
 *  { ok: true, data: { enabled, sent_30d, clicked_30d, recovered_30d,
 *    recovered_value_30d, last_sent_at } } or { ok: false, data: [], reason }. */
export async function fetchCartReminderSummary(slug, pin) {
  try {
    const hashed = await hashPin(pin);
    const { data, error } = await supabase.rpc('get_cart_reminder_summary', { p_slug: slug, p_hashed_pin: hashed });
    if (error) return factsFailed('rpc');
    if (!data || typeof data !== 'object' || Array.isArray(data)) return factsFailed('malformed');
    return { ok: true, data };
  } catch {
    return factsFailed('unavailable');
  }
}

/** Turn the shop's reminders on or off. Resolves to the new state, or throws. */
export async function setCartReminders(slug, pin, enabled) {
  const hashed = await hashPin(pin);
  const { data, error } = await supabase.rpc('set_cart_reminders', {
    p_slug: slug, p_hashed_pin: hashed, p_enabled: Boolean(enabled),
  });
  if (error || typeof data !== 'boolean') throw new Error('Could not change the setting. Please try again.');
  return data;
}

/** The reminder link: { store_slug, items[] } or null (unknown / expired). */
export async function fetchCartReminder(token) {
  try {
    const { data, error } = await supabase.rpc('get_cart_reminder', { p_token: String(token || '') });
    if (error || !data?.store_slug) return null;
    return data;
  } catch {
    return null;
  }
}
