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

/** Before "Send reminder to all": { eligible, reminded_recently, price_paise,
 *  cost_paise, balance_paise, night } or null. */
export async function fetchReminderPreview(slug, pin) {
  try {
    const hashed = await hashPin(pin);
    const { data, error } = await supabase.rpc('cart_reminder_preview', { p_slug: slug, p_hashed_pin: hashed });
    return error || !data || typeof data !== 'object' ? null : data;
  } catch {
    return null;
  }
}

/** Each customer's latest reminder (30 days), for the cart list. [] on failure. */
export async function fetchReminderStatuses(slug, pin) {
  try {
    const hashed = await hashPin(pin);
    const { data, error } = await supabase.rpc('cart_reminder_statuses', { p_slug: slug, p_hashed_pin: hashed });
    return error || !Array.isArray(data) ? [] : data;
  } catch {
    return [];
  }
}

/** Send reminders NOW: one cart (abandonedId) or every eligible cart. Calls the
 *  server again while it reports more; onProgress({ sent, failed }). Resolves
 *  { sent, failed, skipped, stoppedFor: '' | 'no_balance' | 'night' }. */
export async function sendRemindersNow({ slug, pin, abandonedId, onProgress }) {
  const hashed = await hashPin(pin);
  const sum = { sent: 0, failed: 0, skipped: 0, stoppedFor: '' };
  for (let round = 0; round < 20; round++) {
    const { data, error } = await supabase.functions.invoke('cart-reminders-now', {
      body: { slug, hashedPin: hashed, ...(abandonedId ? { abandoned_id: abandonedId } : {}) },
    });
    if (error || data?.error) throw new Error(data?.error || 'Sending stopped. Please try again.');
    sum.sent += Number(data.sent) || 0;
    sum.failed += Number(data.failed) || 0;
    sum.skipped += Number(data.skipped) || 0;
    onProgress?.({ sent: sum.sent, failed: sum.failed });
    if (data.reasons?.no_balance) { sum.stoppedFor = 'no_balance'; break; }
    if (data.reasons?.night) { sum.stoppedFor = 'night'; break; }
    if (abandonedId || !data.more) break;
  }
  return sum;
}

/** Tag a just-placed order to the WhatsApp message whose link brought the
 *  customer here, if any. Best-effort; retried once in case the order row is
 *  still being saved by the safety net. */
export async function attributePlacedOrder(attribution, orderId) {
  if (!attribution?.token || !orderId) return;
  const call = async () => {
    try {
      const { data } = await supabase.rpc('attribute_message_order', {
        p_kind: attribution.kind, p_token: attribution.token, p_order_id: orderId,
      });
      return data === true;
    } catch {
      return false;
    }
  };
  if (!(await call())) setTimeout(call, 6000);
}

/** The offer link: { store_slug } or null (unknown / expired). */
export async function fetchOfferLink(token) {
  try {
    const { data, error } = await supabase.rpc('get_offer_link', { p_token: String(token || '') });
    return error || !data?.store_slug ? null : data;
  } catch {
    return null;
  }
}

/** What offers earned (30 days) or null. */
export async function fetchOfferSummary(slug, pin) {
  try {
    const hashed = await hashPin(pin);
    const { data, error } = await supabase.rpc('get_offer_summary', { p_slug: slug, p_hashed_pin: hashed });
    return error || !data || typeof data !== 'object' ? null : data;
  } catch {
    return null;
  }
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
