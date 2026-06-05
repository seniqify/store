// Business-hours model + open/closed computation.
//
// Stored on the store config as:
//   hours: {
//     enabled: true,
//     days: {                       // keyed by JS Date.getDay() → 0=Sun … 6=Sat
//       0: { closed: true },
//       1: { closed: false, open: '09:00', close: '21:00' },
//       …
//     }
//   }
//
// Times are 24h 'HH:MM' strings interpreted in IST (Asia/Kolkata) — the app is
// India-only, so the open/closed badge is correct regardless of the viewer's TZ.

// index = Date.getDay()  (0 = Sunday)
export const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const DAY_FULL  = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
// Mon-first display order for the editor
export const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

/** A sensible starting schedule: Mon–Sat 9 AM–9 PM, Sunday closed. Disabled by default. */
export function defaultHours() {
  const days = {};
  for (let i = 0; i < 7; i++) {
    days[i] = i === 0
      ? { closed: true,  open: '09:00', close: '21:00' }
      : { closed: false, open: '09:00', close: '21:00' };
  }
  return { enabled: false, days };
}

/** Normalise a stored hours object, filling any gaps with defaults. */
export function normaliseHours(hours) {
  const base = defaultHours();
  if (!hours || typeof hours !== 'object') return base;
  const days = {};
  for (let i = 0; i < 7; i++) {
    const d = hours.days?.[i] ?? hours.days?.[String(i)] ?? base.days[i];
    days[i] = {
      closed: Boolean(d.closed),
      open:   /^\d{2}:\d{2}$/.test(d.open)  ? d.open  : '09:00',
      close:  /^\d{2}:\d{2}$/.test(d.close) ? d.close : '21:00',
    };
  }
  return { enabled: Boolean(hours.enabled), days };
}

/** 'HH:MM' → minutes since midnight (NaN-safe). */
function toMinutes(t) {
  const [h, m] = String(t).split(':').map(Number);
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

/** 'HH:MM' (or minute count) → friendly '9 PM' / '9:30 PM'. */
export function formatTime(t) {
  const mins = typeof t === 'number' ? ((t % 1440) + 1440) % 1440 : toMinutes(t);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const ampm = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${h12} ${ampm}` : `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

/** "Now" as a Date whose local fields reflect IST. */
function istNow(date = new Date()) {
  return new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
}

// An open window as [start, end) minutes; end wraps past midnight when close ≤ open.
function windowFor(day) {
  if (!day || day.closed) return null;
  const open = toMinutes(day.open);
  let close  = toMinutes(day.close);
  if (close <= open) close += 1440;          // overnight (e.g. 18:00 → 02:00)
  return { open, close };
}

/**
 * Compute the live open/closed status for a schedule.
 * Returns null when hours are disabled/empty (caller shows nothing).
 *   { open: boolean, label: string, detail: string }
 */
export function getStoreStatus(rawHours, now = new Date()) {
  const hours = normaliseHours(rawHours);
  if (!hours.enabled) return null;

  const ist = istNow(now);
  const today = ist.getDay();
  const nowMin = ist.getHours() * 60 + ist.getMinutes();

  // ── Are we open right now? Check today + yesterday's overnight spill. ──
  for (const offset of [0, -1]) {
    const dayIdx = (today + offset + 7) % 7;
    const win = windowFor(hours.days[dayIdx]);
    if (!win) continue;
    const start = win.open + offset * 1440;
    const end   = win.close + offset * 1440;
    if (nowMin >= start && nowMin < end) {
      return { open: true, label: 'Open now', detail: `Closes ${formatTime(end)}` };
    }
  }

  // ── Closed → find the next opening within the coming week. ──
  for (let offset = 0; offset <= 7; offset++) {
    const dayIdx = (today + offset) % 7;
    const win = windowFor(hours.days[dayIdx]);
    if (!win) continue;
    const absoluteOpen = offset * 1440 + win.open;
    if (absoluteOpen <= nowMin) continue;            // window already passed
    const when = offset === 0 ? 'today' : offset === 1 ? 'tomorrow' : DAY_SHORT[dayIdx];
    return { open: false, label: 'Closed', detail: `Opens ${when} at ${formatTime(win.open)}` };
  }

  return { open: false, label: 'Closed', detail: '' };
}
