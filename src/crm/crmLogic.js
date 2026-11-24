// Sales CRM rules that need no network: dates in India time, phone numbers,
// stages, call outcomes, the call queue, the follow-up board and the
// attendance calendar. PURE, so tests/sales-crm.test.mjs runs it directly.

export const IST_OFFSET_MS = 330 * 60 * 1000;   // India has no daylight saving
const DAY_MS = 86400000;

/** 'YYYY-MM-DD' of an instant, in India time. */
export function istDate(ms = Date.now()) {
  return new Date(Number(ms) + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** The UTC instant of HH:MM (India time) on an India date 'YYYY-MM-DD'. */
export function istInstant(dateStr, hh = 0, mm = 0) {
  return Date.parse(`${dateStr}T00:00:00Z`) - IST_OFFSET_MS + (hh * 60 + mm) * 60000;
}

/** An India date moved by n days. */
export function addDays(dateStr, n) {
  return new Date(Date.parse(`${dateStr}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/** 0 = Sunday ... 6 = Saturday, for an India date. */
export function weekday(dateStr) {
  return new Date(`${dateStr}T00:00:00Z`).getUTCDay();
}

/** '9:28 am' in India time; '' for nothing. */
export function istTime(value) {
  if (!value) return '';
  const d = new Date(Date.parse(value) + IST_OFFSET_MS);
  if (Number.isNaN(d.getTime())) return '';
  let h = d.getUTCHours();
  const m = String(d.getUTCMinutes()).padStart(2, '0');
  const ap = h >= 12 ? 'pm' : 'am';
  h = h % 12 || 12;
  return `${h}:${m} ${ap}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** 'Mon 23 Nov' for an India date. */
export function shortDay(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** When something is due, the way people say it: 'today 5:00 pm', 'tomorrow 11:00 am', '2 days late', 'Thu 26 Nov'. */
export function dueLabel(value, now = Date.now()) {
  if (!value) return '';
  const t = Date.parse(value);
  const today = istDate(now);
  const day = istDate(t);
  if (day < today) {
    const n = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / DAY_MS);
    return n === 1 ? '1 day late' : `${n} days late`;
  }
  if (day === today) return t < now ? `late · ${istTime(value)}` : `today ${istTime(value)}`;
  if (day === addDays(today, 1)) return `tomorrow ${istTime(value)}`;
  return shortDay(day);
}

// ── Phones ──────────────────────────────────────────────────────────────────
/** The last 10 digits, or '' when there are fewer. */
export function phone10(v) {
  const d = String(v ?? '').replace(/\D/g, '');
  return d.length >= 10 ? d.slice(-10) : '';
}
/** '98224 61530'. */
export function prettyPhone(v) {
  const p = phone10(v);
  return p ? `${p.slice(0, 5)} ${p.slice(5)}` : '';
}
export const telHref = (v) => (phone10(v) ? `tel:+91${phone10(v)}` : '');
export const waHref = (v, text = '') => (phone10(v) ? `https://wa.me/91${phone10(v)}${text ? `?text=${encodeURIComponent(text)}` : ''}` : '');
export const mapHref = (lat, lng) => `https://www.google.com/maps?q=${Number(lat)},${Number(lng)}`;

// ── Stages and sources ──────────────────────────────────────────────────────
export const STAGES = Object.freeze([
  { key: 'new', label: 'New', cls: 'bg-gray-100 text-gray-700' },
  { key: 'contacted', label: 'Contacted', cls: 'bg-blue-100 text-blue-800' },
  { key: 'demo', label: 'Demo', cls: 'bg-violet-100 text-violet-800' },
  { key: 'interested', label: 'Interested', cls: 'bg-green-100 text-green-800' },
  { key: 'won', label: 'Won', cls: 'bg-green-700 text-white' },
  { key: 'lost', label: 'Lost', cls: 'bg-red-100 text-red-800' },
]);
export const stageOf = (key) => STAGES.find((s) => s.key === key) || STAGES[0];
const RANK = { new: 0, contacted: 1, demo: 2, interested: 3, won: 4, lost: 4 };

/** Never move a lead backwards by accident: 'contacted' does not undo 'demo'. */
export function forwardStage(current, wanted) {
  if (!wanted) return current;
  if (wanted === 'won' || wanted === 'lost') return wanted;
  if (current === 'won' || current === 'lost') return wanted;
  return (RANK[wanted] ?? 0) >= (RANK[current] ?? 0) ? wanted : current;
}

export const SOURCES = Object.freeze({
  manual: 'Added by hand', field: 'Field visit', calling_list: 'Calling list', referral: 'Referral',
  walk_in: 'Walk-in / expo', import: 'Imported list', hub: 'Moved from the Hub', signup: 'Signed up on PocketLink',
  pending_signup: 'Sign-up not finished', facebook: 'Facebook ad', instagram: 'Instagram ad', google: 'Google ad',
  whatsapp: 'WhatsApp ad', website: 'Website',
});
export const sourceLabel = (k) => SOURCES[k] || 'Other';

export const BUSINESS_TYPES = Object.freeze([
  'Clothing and sarees', 'Food, spices, sweets', 'Kirana and grocery', 'Restaurant or café', 'Bakery',
  'Mobiles and electronics', 'Jewellery', 'Footwear', 'Home and decor', 'Services', 'Other',
]);
export const LOST_REASONS = Object.freeze(['Too costly', 'Uses another app', 'Does not sell online', 'Will think about it', 'Shop closing', 'Wrong number']);

// ── When to call again ──────────────────────────────────────────────────────
/** Ready-made times, as instants: in 1 hour, this evening, tomorrow 11 am, in 3 days, next week. */
export function whenPresets(now = Date.now()) {
  const today = istDate(now);
  const evening = istInstant(today, 18, 0);
  return {
    in1h: now + 3600000,
    evening: evening > now + 30 * 60000 ? evening : now + 2 * 3600000,
    tomorrow: istInstant(addDays(today, 1), 11, 0),
    in3days: istInstant(addDays(today, 3), 11, 0),
    nextweek: istInstant(addDays(today, 7), 11, 0),
  };
}
export const WHEN_LABELS = Object.freeze({ in1h: 'In 1 hour', evening: 'This evening', tomorrow: 'Tomorrow', in3days: 'In 3 days', nextweek: 'Next week' });

/**
 * How a call went -> what happens to the lead. `ask` says which extra input
 * the screen needs: 'when' (call-again time), 'demo' (demo time), 'lost' (reason).
 */
export const CALL_OUTCOMES = Object.freeze([
  { key: 'no_answer', label: 'Did not pick up', stage: null, ask: null },
  { key: 'busy', label: 'Busy, call later', stage: 'contacted', ask: 'when' },
  { key: 'interested', label: 'Interested', stage: 'interested', ask: 'when' },
  { key: 'demo', label: 'Book a demo', stage: 'demo', ask: 'demo' },
  { key: 'won', label: 'Won · paid', stage: 'won', ask: 'won' },
  { key: 'not_interested', label: 'Not interested', stage: 'lost', ask: 'lost' },
  { key: 'wrong_number', label: 'Wrong number', stage: 'lost', ask: null },
]);

/**
 * Everything sales_log needs for a call, from what the person picked.
 * Returns { outcome, stage, nextAt, next, lost }.
 */
export function callResult(lead, outcomeKey, { when, demoAt, demoHow, lostReason } = {}, now = Date.now()) {
  const o = CALL_OUTCOMES.find((x) => x.key === outcomeKey);
  if (!o) throw new Error('unknown outcome');
  const current = lead?.stage || 'new';
  if (o.key === 'no_answer') {
    const tries = (Number(lead?.call_attempts) || 0) + 1;
    return tries >= 3
      ? { outcome: o.key, stage: null, nextAt: new Date(whenPresets(now).in3days).toISOString(), next: 'Not reachable · try again', lost: null }
      : { outcome: o.key, stage: null, nextAt: new Date(now + 2 * 3600000).toISOString(), next: 'Call again (did not pick up)', lost: null };
  }
  if (o.key === 'wrong_number') return { outcome: o.key, stage: 'lost', nextAt: null, next: null, lost: 'Wrong number' };
  if (o.key === 'not_interested') return { outcome: o.key, stage: 'lost', nextAt: null, next: null, lost: lostReason || 'Not interested' };
  if (o.key === 'won') return { outcome: o.key, stage: 'won', nextAt: null, next: null, lost: null };
  if (o.key === 'demo') {
    if (!demoAt) throw new Error('pick the demo time');
    return { outcome: o.key, stage: forwardStage(current, 'demo'), nextAt: new Date(demoAt).toISOString(), next: `Demo${demoHow ? ` · ${demoHow}` : ''}`, lost: null };
  }
  const at = when ?? whenPresets(now).tomorrow;
  return {
    outcome: o.key,
    stage: forwardStage(current, o.stage),
    nextAt: new Date(at).toISOString(),
    next: o.key === 'busy' ? 'Call back (asked)' : 'Follow up (interested)',
    lost: null,
  };
}

// ── The call queue and the follow-up board ──────────────────────────────────
const open = (l) => l && l.stage !== 'won' && l.stage !== 'lost';

/**
 * A person's leads in the order to call them:
 *   now     due now or late (oldest first)
 *   later   later today
 *   fresh   new, never touched, nothing scheduled (newest first)
 *   ahead   scheduled after today
 */
export function buildQueue(leads, now = Date.now()) {
  const todayEnd = istInstant(addDays(istDate(now), 1));
  const g = { now: [], later: [], fresh: [], ahead: [] };
  for (const l of leads || []) {
    if (!open(l)) continue;
    const t = l.next_action_at ? Date.parse(l.next_action_at) : null;
    if (t !== null && t <= now) g.now.push(l);
    else if (t !== null && t < todayEnd) g.later.push(l);
    else if (t === null && !l.last_activity_at) g.fresh.push(l);
    else if (t !== null) g.ahead.push(l);
  }
  const by = (a, b) => Date.parse(a.next_action_at) - Date.parse(b.next_action_at);
  g.now.sort(by); g.later.sort(by); g.ahead.sort(by);
  g.fresh.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  return g;
}

/** Follow-ups by day: late, today, tomorrow, rest of the week. */
export function followupColumns(leads, now = Date.now()) {
  const today = istDate(now);
  const tomorrow = addDays(today, 1);
  const weekEnd = addDays(today, 7);
  const c = { late: [], today: [], tomorrow: [], week: [] };
  for (const l of leads || []) {
    if (!open(l) || !l.next_action_at) continue;
    const d = istDate(Date.parse(l.next_action_at));
    if (d < today) c.late.push(l);
    else if (d === today) c.today.push(l);
    else if (d === tomorrow) c.tomorrow.push(l);
    else if (d <= weekEnd) c.week.push(l);
  }
  const by = (a, b) => Date.parse(a.next_action_at) - Date.parse(b.next_action_at);
  Object.values(c).forEach((xs) => xs.sort(by));
  return c;
}

/** Split leads evenly between people, in turn: { userId: [leadIds] }. */
export function splitEvenly(leadIds, userIds) {
  const out = Object.fromEntries((userIds || []).map((u) => [u, []]));
  if (!userIds?.length) return out;
  (leadIds || []).forEach((id, i) => out[userIds[i % userIds.length]].push(id));
  return out;
}

// ── Attendance ──────────────────────────────────────────────────────────────
export const LATE_GRACE_MIN = 15;
export const HALF_DAY_HOURS = 4.5;

export const DAY_STATUS = Object.freeze({
  present: { label: 'Present', cls: 'bg-green-100 text-green-900' },
  late: { label: 'Late', cls: 'bg-amber-100 text-amber-900' },
  half: { label: 'Half day', cls: 'bg-orange-100 text-orange-900' },
  absent: { label: 'Absent', cls: 'bg-red-100 text-red-900' },
  leave: { label: 'Leave', cls: 'bg-blue-100 text-blue-900' },
  holiday: { label: 'Holiday', cls: 'bg-violet-100 text-violet-900' },
  off: { label: 'Weekly off', cls: 'bg-gray-100 text-gray-700' },
  future: { label: '', cls: 'bg-white text-gray-500 border border-dashed border-gray-300' },
  today: { label: 'Not in yet', cls: 'bg-white text-gray-700 border border-gray-300' },
});

const minutesOf = (time) => {
  const [h, m] = String(time || '09:30').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};

/**
 * One person's status on one India date.
 * row: their sales_attendance row for that day (or null).
 * Order: manager's override > weekly off > holiday > approved leave >
 * future > no login (today: not in yet; earlier: absent) > late > half day > present.
 */
export function dayStatus({ day, today, staff, row, holidays, leaveDays }) {
  if (row?.status_override) return row.status_override;
  if (weekday(day) === Number(staff?.weekly_off ?? 0)) return 'off';
  if (holidays?.has?.(day)) return 'holiday';
  if (leaveDays?.has?.(day)) return 'leave';
  if (day > today) return 'future';
  const inAt = row?.day_start_at || row?.first_seen_at;
  if (!inAt) return day === today ? 'today' : 'absent';
  const loginMin = Math.round((Date.parse(inAt) - istInstant(day)) / 60000);
  const late = loginMin > minutesOf(staff?.shift_start) + LATE_GRACE_MIN;
  const outAt = row?.day_end_at || row?.last_seen_at;
  const hours = outAt ? (Date.parse(outAt) - Date.parse(inAt)) / 3600000 : 0;
  if (day < today && hours < HALF_DAY_HOURS) return 'half';
  return late ? 'late' : 'present';
}

/** Every India date from..to with an approved leave, as a Set. */
export function leaveDaySet(leaves, staffId) {
  const s = new Set();
  for (const l of leaves || []) {
    if (l.status !== 'approved' || (staffId && l.staff_id !== staffId)) continue;
    for (let d = l.from_day; d <= l.to_day; d = addDays(d, 1)) s.add(d);
  }
  return s;
}

/**
 * A month's calendar for one person, Monday first.
 * Returns { cells: [{ day, n, status, inAt }|null], counts, workingDays, workedSoFar }.
 */
export function monthCalendar({ year, month, today, staff, rows, holidays, leaves }) {
  const first = `${year}-${String(month).padStart(2, '0')}-01`;
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const byDay = new Map((rows || []).filter((r) => r.staff_id === staff?.user_id).map((r) => [r.day, r]));
  const holidaySet = holidays instanceof Set ? holidays : new Set((holidays || []).map((h) => h.day || h));
  const leaveDays = leaveDaySet(leaves, staff?.user_id);
  const lead = (weekday(first) + 6) % 7;
  const cells = Array.from({ length: lead }, () => null);
  const counts = { present: 0, late: 0, half: 0, absent: 0, leave: 0, holiday: 0, off: 0 };
  let workingDays = 0, workedSoFar = 0, leaveSoFar = 0;
  for (let n = 1; n <= days; n++) {
    const day = `${year}-${String(month).padStart(2, '0')}-${String(n).padStart(2, '0')}`;
    const row = byDay.get(day) || null;
    const status = dayStatus({ day, today, staff, row, holidays: holidaySet, leaveDays });
    if (counts[status] !== undefined) counts[status]++;
    const isWorking = status !== 'off' && status !== 'holiday';
    if (isWorking) workingDays++;
    if (isWorking && day <= today && status !== 'today') workedSoFar++;
    if (status === 'leave' && day <= today) leaveSoFar++;
    cells.push({ day, n, status, inAt: row?.day_start_at || row?.first_seen_at || null });
  }
  return { cells, counts, workingDays, workedSoFar, leaveSoFar };
}

/**
 * Attendance so far as a whole percent: present + late + half/2, over the
 * working days that have passed minus approved leave (leave is not absence).
 */
export function attendancePercent(c, workedSoFar, leaveSoFar = 0) {
  const base = workedSoFar - leaveSoFar;
  if (base <= 0) return null;
  return Math.round(((c.present + c.late + c.half / 2) / base) * 100);
}

/** Hours between two instants as '7 h 40 m'. */
export function hoursLabel(from, to) {
  if (!from || !to) return '';
  const m = Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / 60000));
  return `${Math.floor(m / 60)} h ${m % 60} m`;
}
