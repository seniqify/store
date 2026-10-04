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

/** phone → its latest reminder (the server already returns one per phone). */
export function statusMap(statuses) {
  const m = new Map();
  for (const s of Array.isArray(statuses) ? statuses : []) if (s?.phone) m.set(String(s.phone), s);
  return m;
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
      note: tooOld ? `Older than ${MANUAL_MAX_AGE_DAYS} days — use WhatsApp` : '',
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
    if (cartReminderState(c, map.get(String(c.customer_phone)), now).key !== 'none') reminded += 1;
  }
  const all = Array.isArray(carts) ? carts.length : 0;
  return { all, reminded, notReminded: all - reminded };
}
