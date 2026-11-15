/**
 * Abandoned tab — each cart's reminder state, from cart_reminder_statuses.
 * Pure (tested). The server decides who can actually get a reminder; this only
 * labels the list and hides the per-cart button where it would be refused.
 */

const DAY = 86400000;
export const MANUAL_MAX_AGE_DAYS = 7;   // = cart_reminder_claim's manual limit

function ago(iso, now) {
  const s = Math.max(0, Math.floor((now - Date.parse(iso)) / 1000));
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} hr ago`;
  const d = Math.floor(s / 86400);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

function day(iso) {
  const t = new Date(iso);
  return Number.isNaN(t.getTime()) ? '' : t.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

/**
 * Each customer's latest reminder, keyed by their latest abandoned cart.
 *
 * cart_reminder_statuses returns `cart_id` (supabase/abandoned-private-forward.sql):
 * the shop never gets an abandoned customer's number, so the number cannot be
 * the key. `phone` is still read when present, for the database version before
 * that migration - so the app can ship first.
 */
export function statusMap(statuses) {
  const m = new Map();
  for (const s of Array.isArray(statuses) ? statuses : []) {
    if (s?.cart_id) m.set(`cart:${s.cart_id}`, s);
    else if (s?.phone) m.set(`phone:${s.phone}`, s);
  }
  return m;
}

/** The reminder for one cart from statusMap, or undefined. */
export function reminderFor(map, cart) {
  if (!map || !cart) return undefined;
  return map.get(`cart:${cart.id}`) ?? (cart.customer_phone ? map.get(`phone:${cart.customer_phone}`) : undefined);
}

/**
 * One cart's state.
 * @returns {{ key: 'none'|'sent'|'failed'|'sending', badge: string, canSend: boolean, note: string }}
 */
export function cartReminderState(cart, reminder, now = Date.now()) {
  const tooOld = now - Date.parse(cart?.created_at) > MANUAL_MAX_AGE_DAYS * DAY;
  if (!reminder || reminder.status === 'failed') {
    return {
      key: 'none',
      badge: 'Not reminded',
      canSend: !tooOld,
      note: tooOld ? `Older than ${MANUAL_MAX_AGE_DAYS} days — too late for a reminder` : '',
    };
  }
  const waitOver = now >= Date.parse(reminder.next_at);
  const parts = [`Reminded ${reminder.sent_at ? ago(reminder.sent_at, now) : 'just now'}`];
  if (reminder.clicked_at) parts.push('Opened');
  return {
    key: reminder.status === 'sending' ? 'sending' : 'sent',
    badge: parts.join(' · '),
    canSend: waitOver && !tooOld,
    note: waitOver ? '' : `Next reminder possible from ${day(reminder.next_at)}`,
  };
}

/** Counts for the filter chips: All / Not reminded / Reminded. */
export function reminderCounts(carts, map, now = Date.now()) {
  let reminded = 0;
  for (const c of Array.isArray(carts) ? carts : []) {
    if (cartReminderState(c, reminderFor(map, c), now).key !== 'none') reminded += 1;
  }
  const all = Array.isArray(carts) ? carts.length : 0;
  return { all, reminded, notReminded: all - reminded };
}

/**
 * What the customer did with the reminder, in one word per cart (2026-11-15).
 * The order outranks everything: a customer who ordered and then said stop was
 * still won back.
 *   none     not reminded
 *   sending  going out now
 *   failed   WhatsApp refused it (the Coins came back)
 *   sent     reminded, no tap yet
 *   opened   tapped "Complete my order", no order yet
 *   won      ordered (through the link, or from that number within 7 days)
 *   stopped  tapped "Stop offers" (or asked the shop to stop)
 */
export function cartOutcome(cart, reminder) {
  if (!reminder) return { key: 'none', label: 'Not reminded' };
  if (reminder.status === 'failed') return { key: 'failed', label: 'Not delivered · Coins returned' };
  if (reminder.won_order_id) return { key: 'won', label: 'Won back', total: Number(reminder.won_total) || 0 };
  if (reminder.stopped_at) return { key: 'stopped', label: 'Asked to stop' };
  if (reminder.clicked_at) return { key: 'opened', label: 'Opened · didn’t buy' };
  if (reminder.status === 'sending') return { key: 'sending', label: 'Sending…' };
  return { key: 'sent', label: 'Reminded · no reply' };
}

/** The extra list filters: what the customer did. */
export const OUTCOME_FILTERS = Object.freeze([
  ['opened', 'Opened, didn’t buy'],
  ['won', 'Won back'],
  ['stopped', 'Asked to stop'],
]);
