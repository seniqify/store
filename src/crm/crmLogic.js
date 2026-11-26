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
  nowork: { label: 'Logged in, no work', cls: 'bg-amber-200 text-amber-950' },
  absent: { label: 'Absent', cls: 'bg-red-100 text-red-900' },
  leave: { label: 'Leave', cls: 'bg-blue-100 text-blue-900' },
  holiday: { label: 'Holiday', cls: 'bg-violet-100 text-violet-900' },
  off: { label: 'Weekly off', cls: 'bg-gray-100 text-gray-700' },
  future: { label: '', cls: 'bg-white text-gray-500 border border-dashed border-gray-300' },
  before: { label: 'Not started', cls: 'bg-gray-50 text-gray-400' },
  today: { label: 'Not in yet', cls: 'bg-white text-gray-700 border border-gray-300' },
});

const minutesOf = (time) => {
  const [h, m] = String(time || '09:30').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};

/**
 * One person's status on one India date.
 * row: their sales_attendance row for that day (or null).
 * Days before the person was added to the CRM are 'before' and never count.
 * Order: manager's override > before they started > weekly off > holiday > approved leave >
 * future > no login (today: not in yet; earlier: absent) > late > half day > present.
 * work: their sales_work_days row for that day. Once the work rule applies to
 * the day (work.level set), a past day is judged by work: 'none' = logged in,
 * no work; 'half' = half day; 'full' = present or late.
 */
export function dayStatus({ day, today, staff, row, holidays, leaveDays, rules, work }) {
  if (row?.status_override) return row.status_override;
  const start = staff?.created_at ? istDate(Date.parse(staff.created_at)) : '';
  if (start && day < start) return 'before';
  if (weekday(day) === Number(staff?.weekly_off ?? 0)) return 'off';
  if (holidays?.has?.(day)) return 'holiday';
  if (leaveDays?.has?.(day)) return 'leave';
  if (day > today) return 'future';
  const inAt = row?.day_start_at || row?.first_seen_at;
  if (!inAt) return day === today ? 'today' : 'absent';
  const loginMin = Math.round((Date.parse(inAt) - istInstant(day)) / 60000);
  const grace = Number.isFinite(Number(rules?.grace_min)) ? Number(rules.grace_min) : LATE_GRACE_MIN;
  const halfH = Number(rules?.half_day_hours) > 0 ? Number(rules.half_day_hours) : HALF_DAY_HOURS;
  const late = loginMin > minutesOf(staff?.shift_start) + grace;
  const outAt = row?.day_end_at || row?.last_seen_at;
  const hours = outAt ? (Date.parse(outAt) - Date.parse(inAt)) / 3600000 : 0;
  if (day < today && work?.level) {
    if (work.level === 'none') return 'nowork';
    if (work.level === 'half') return 'half';
    return late ? 'late' : 'present';
  }
  if (day < today && hours < halfH) return 'half';
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
export function monthCalendar({ year, month, today, staff, rows, holidays, leaves, rules, works }) {
  const first = `${year}-${String(month).padStart(2, '0')}-01`;
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const byDay = new Map((rows || []).filter((r) => r.staff_id === staff?.user_id).map((r) => [r.day, r]));
  const workByDay = new Map((works || []).filter((w) => w.staff_id === staff?.user_id).map((w) => [w.day, w]));
  const holidaySet = holidays instanceof Set ? holidays : new Set((holidays || []).map((h) => h.day || h));
  const leaveDays = leaveDaySet(leaves, staff?.user_id);
  const lead = (weekday(first) + 6) % 7;
  const cells = Array.from({ length: lead }, () => null);
  const counts = { present: 0, late: 0, half: 0, nowork: 0, absent: 0, leave: 0, holiday: 0, off: 0 };
  let workingDays = 0, workedSoFar = 0, leaveSoFar = 0;
  for (let n = 1; n <= days; n++) {
    const day = `${year}-${String(month).padStart(2, '0')}-${String(n).padStart(2, '0')}`;
    const row = byDay.get(day) || null;
    const work = workByDay.get(day) || null;
    const status = dayStatus({ day, today, staff, row, holidays: holidaySet, leaveDays, rules, work });
    if (counts[status] !== undefined) counts[status]++;
    const isWorking = status !== 'off' && status !== 'holiday' && status !== 'before';
    if (isWorking) workingDays++;
    if (isWorking && day <= today && status !== 'today') workedSoFar++;
    if (status === 'leave' && day <= today) leaveSoFar++;
    cells.push({ day, n, status, inAt: row?.day_start_at || row?.first_seen_at || null, active: work ? work.active_min : null, work });
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

// ── Performance: KPIs, KPAs and the score ──────────────────────────────────
// Five areas (KPAs) with fixed weights; each KPI is actual against target,
// capped at 100%. A KPA is the average of its KPIs; the score is the weighted
// average of the KPAs that have data. Counts and money are monthly targets,
// scaled to how much of the period has passed ("by today").
export const KPA = Object.freeze([
  { key: 'activity', label: 'Activity', weight: 20 },
  { key: 'reach', label: 'Reach', weight: 15 },
  { key: 'conversion', label: 'Conversion', weight: 30 },
  { key: 'revenue', label: 'Revenue', weight: 25 },
  { key: 'discipline', label: 'Discipline', weight: 10 },
]);

const ratio = (a, b) => (b > 0 ? (a / b) * 100 : null);
const perDay = (n, r) => (n > 0 || r.days_present > 0 ? n / Math.max(1, r.days_present) : null);
const onTime = (r) => (r.open_followups > 0 ? 100 - ratio(r.late_followups, r.open_followups) : null);

/** kind: 'perday' and 'pct' are compared as they are; 'count' and 'money' are monthly and scaled. */
export const KPI_DEFS = Object.freeze({
  caller: [
    { key: 'calls_per_day', kpa: 'activity', label: 'Calls a day (average)', kind: 'perday', def: 80, column: 'daily_target', actual: (r) => perDay(r.calls, r) },
    { key: 'talk_min_per_day', kpa: 'activity', label: 'Talk time a day', kind: 'minutes', def: 150, actual: (r) => (Number(r.talk_sec) > 0 ? Number(r.talk_sec) / 60 / Math.max(1, r.days_present) : null) },
    { key: 'pickup_pct', kpa: 'reach', label: 'Pick-up rate', kind: 'pct', def: 45, actual: (r) => ratio(r.answered, r.calls) },
    { key: 'demos', kpa: 'conversion', label: 'Demos booked', kind: 'count', def: 20, actual: (r) => r.demos },
    { key: 'demo_to_won_pct', kpa: 'conversion', label: 'Demo to won', kind: 'pct', def: 30, actual: (r) => (r.demos > 0 ? ratio(r.won, r.demos) : r.won > 0 ? 100 : null) },
    { key: 'paid', kpa: 'revenue', label: 'Paid shops', kind: 'count', def: 10, column: 'monthly_target', actual: (r) => r.won },
    { key: 'money', kpa: 'revenue', label: 'Money collected', kind: 'money', def: null, actual: (r) => Number(r.money) || 0 },
    { key: 'followups_pct', kpa: 'discipline', label: 'Follow-ups on time', kind: 'pct', def: 90, actual: onTime },
    { key: 'notes_pct', kpa: 'discipline', label: 'Notes after answered calls', kind: 'pct', def: 95, actual: (r) => ratio(r.answered_noted, r.answered) },
  ],
  field: [
    { key: 'visits_per_day', kpa: 'activity', label: 'Visits a day (average)', kind: 'perday', def: 8, column: 'daily_target', actual: (r) => perDay(r.visits, r) },
    { key: 'met_owner_pct', kpa: 'reach', label: 'Met the owner', kind: 'pct', def: 70, actual: (r) => ratio(r.visits_owner, r.visits) },
    { key: 'demos', kpa: 'conversion', label: 'Demos given', kind: 'count', def: 12, actual: (r) => r.demos },
    { key: 'new_shops', kpa: 'conversion', label: 'New shops added', kind: 'count', def: 40, actual: (r) => r.new_leads },
    { key: 'paid', kpa: 'revenue', label: 'Paid shops', kind: 'count', def: 8, column: 'monthly_target', actual: (r) => r.won },
    { key: 'money', kpa: 'revenue', label: 'Money collected', kind: 'money', def: null, actual: (r) => Number(r.money) || 0 },
    { key: 'followups_pct', kpa: 'discipline', label: 'Follow-ups on time', kind: 'pct', def: 90, actual: onTime },
    { key: 'notes_pct', kpa: 'discipline', label: 'Visit notes filled', kind: 'pct', def: 95, actual: (r) => ratio(r.visits_noted, r.visits) },
  ],
  // Ads & leads executive: checks leads and adds new ones; scored on how many,
  // how fast, and how many of their checked leads go on to a demo and to pay.
  ads: [
    { key: 'checked_per_day', kpa: 'activity', label: 'Leads checked a day (average)', kind: 'perday', def: 40, column: 'daily_target', actual: (r) => perDay(r.checked, r) },
    { key: 'fast_pct', kpa: 'reach', label: 'Ad leads checked within 30 min', kind: 'pct', def: 80, actual: (r) => ratio(r.checked_fast, r.checked_ad) },
    { key: 'demo_rate_pct', kpa: 'conversion', label: 'Checked leads that reached a demo', kind: 'pct', def: 25, actual: (r) => ratio(r.verified_demo, r.verified_total) },
    { key: 'added', kpa: 'conversion', label: 'New leads added', kind: 'count', def: 150, actual: (r) => r.new_leads },
    { key: 'paid', kpa: 'revenue', label: 'Paid shops from your checked leads', kind: 'count', def: 4, column: 'monthly_target', actual: (r) => r.verified_paid },
  ],
});

/**
 * The full-month (or per-day / percent) target for one KPI of one person:
 * their own target > their daily / monthly column > the team target for
 * their role (Settings) > the usual.
 */
export function kpiTarget(def, person, price = 1499, teamTargets = null) {
  const own = Number(person?.targets?.[def.key]);
  if (Number.isFinite(own) && own > 0) return own;
  const col = def.column ? Number(person?.[def.column]) : NaN;
  if (Number.isFinite(col) && col > 0) return col;
  const team = Number(teamTargets?.[person?.role]?.[def.key]);
  if (Number.isFinite(team) && team > 0) return team;
  if (def.kind === 'money') {
    const paidDef = (KPI_DEFS[person?.role] || KPI_DEFS.caller).find((d) => d.key === 'paid');
    return kpiTarget(paidDef, person, price, teamTargets) * price;
  }
  return def.def;
}

export const DEFAULT_WEIGHTS = Object.freeze({ activity: 20, reach: 15, conversion: 30, revenue: 25, discipline: 10 });
/** The KPA weights from Settings when they are whole numbers adding up to 100, else the usual ones. */
export function weightsFrom(score) {
  const w = score?.weights;
  if (!w || typeof w !== 'object') return { ...DEFAULT_WEIGHTS };
  const out = {};
  for (const a of KPA) { const v = Number(w[a.key]); if (!Number.isInteger(v) || v < 0 || v > 100) return { ...DEFAULT_WEIGHTS }; out[a.key] = v; }
  return Object.values(out).reduce((x, y) => x + y, 0) === 100 ? out : { ...DEFAULT_WEIGHTS };
}

/**
 * How much of a monthly target is expected by `today` for the period
 * [from, to] (India dates): this month on the 15th of 30 = 0.5; a finished
 * month = 1.
 */
export function periodShare(from, to, today) {
  const days = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000) + 1;
  const total = days(from, to);
  const passed = today >= to ? total : today < from ? 1 : days(from, today);
  return Math.max(1, passed) / total;
}

export function band(score) {
  if (score == null) return { label: 'No data yet', cls: 'bg-gray-100 text-gray-700' };
  if (score >= 90) return { label: 'Excellent', cls: 'bg-green-700 text-white' };
  if (score >= 75) return { label: 'Good', cls: 'bg-green-100 text-green-800' };
  if (score >= 60) return { label: 'Needs work', cls: 'bg-amber-100 text-amber-900' };
  return { label: 'At risk', cls: 'bg-red-100 text-red-800' };
}

/**
 * One person's KPIs, KPAs and score from their scoreboard row.
 * share: periodShare(...) for count / money targets.
 */
export function scorePerson(row, { share = 1, price = 1499, weights = DEFAULT_WEIGHTS, teamTargets = null } = {}) {
  const defs = KPI_DEFS[row?.role] || KPI_DEFS.caller;
  const kpis = defs.map((d) => {
    const full = kpiTarget(d, row, price, teamTargets);
    const target = d.kind === 'count' || d.kind === 'money' ? full * share : full;
    const raw = d.actual(row || {});
    const actual = raw == null || Number.isNaN(raw) ? null : raw;
    const pct = actual == null || !(target > 0) ? null : Math.min(100, Math.round((actual / target) * 100));
    return { ...d, full, target, actual, pct };
  });
  const kpa = {};
  for (const a of KPA) {
    const xs = kpis.filter((k) => k.kpa === a.key && k.pct != null).map((k) => k.pct);
    kpa[a.key] = xs.length ? Math.round(xs.reduce((s, x) => s + x, 0) / xs.length) : null;
  }
  const wt = (a) => (Number.isFinite(Number(weights?.[a.key])) ? Number(weights[a.key]) : a.weight);
  const scored = KPA.filter((a) => kpa[a.key] != null && wt(a) > 0);
  const w = scored.reduce((s, a) => s + wt(a), 0);
  const score = w ? Math.round(scored.reduce((s, a) => s + kpa[a.key] * wt(a), 0) / w) : null;
  const ranked = kpis.filter((k) => k.pct != null).sort((x, y) => x.pct - y.pct);
  return { kpis, kpa, score, weakest: ranked[0] || null, strongest: ranked[ranked.length - 1] || null };
}

/** How a KPI value reads: '74', '44%', '₹8,994', '6.4'. */
export function kpiValue(kind, v) {
  if (v == null) return '—';
  if (kind === 'pct') return `${Math.round(v)}%`;
  if (kind === 'money') return `₹${Math.round(v).toLocaleString('en-IN')}`;
  if (kind === 'minutes') { const m = Math.round(v); return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} m` : `${m} m`; }
  if (kind === 'perday') return v >= 10 ? String(Math.round(v)) : String(Math.round(v * 10) / 10);
  return String(Math.round(v * 10) / 10);
}

/** Score the whole board and rank it (best first, ties by name). */
export function rankBoard(rows, opts) {
  return (rows || []).map((r) => ({ row: r, ...scorePerson(r, opts) }))
    .sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || String(a.row.name).localeCompare(String(b.row.name)))
    .map((p, i) => ({ ...p, rank: i + 1 }));
}

// ── Visit checks ────────────────────────────────────────────────────────────
/** Metres between two { lat, lng } points. */
export function distanceM(a, b) {
  if (a?.lat == null || b?.lat == null) return null;
  const R = 6371000, rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}
export const kmLabel = (m) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`);

/** The photo's fingerprint from its storage path (<user>/<day>/<16 hex>-<uuid>.jpg), or ''. */
export const photoPrint = (path) => (String(path || '').match(/\/([0-9a-f]{16})-[^/]+$/) || [])[1] || '';

export const WEAK_GPS_M = 150;
export const FAR_FROM_SHOP_M = 1000;

/**
 * Why a visit looks odd: { [activityId]: ['...', ...] }.
 * visits: every visit to the shops involved (any day), with id, lead_id,
 * staff_id, lat, lng, accuracy_m, photo_path, created_at, review.
 */
export function visitFlags(visits) {
  const out = {};
  const add = (id, why) => { (out[id] ||= []).push(why); };
  const live = (visits || []).filter((v) => v.review !== 'rejected')
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
  const firstAt = new Map();
  const prints = new Map();
  const byStaff = new Map();
  for (const v of live) {
    if (!firstAt.has(v.lead_id)) firstAt.set(v.lead_id, v);
    const p = photoPrint(v.photo_path);
    if (p) prints.set(p, (prints.get(p) || 0) + 1);
    if (!byStaff.has(v.staff_id)) byStaff.set(v.staff_id, []);
    byStaff.get(v.staff_id).push(v);
  }
  for (const v of live) {
    if (v.accuracy_m > WEAK_GPS_M) add(v.id, `Weak location: accurate to ${kmLabel(v.accuracy_m)} only`);
    const first = firstAt.get(v.lead_id);
    if (first && first.id !== v.id) {
      const d = distanceM(first, v);
      if (d != null && d > FAR_FROM_SHOP_M) add(v.id, `${kmLabel(d)} from where this shop was first checked in`);
    }
    const p = photoPrint(v.photo_path);
    if (p && prints.get(p) > 1) add(v.id, 'The same photo was used for another visit');
  }
  for (const xs of byStaff.values()) {
    for (let i = 1; i < xs.length; i++) {
      const d = distanceM(xs[i - 1], xs[i]);
      const min = (Date.parse(xs[i].created_at) - Date.parse(xs[i - 1].created_at)) / 60000;
      if (d != null && d > 2000 && (d / 1000) / (Math.max(min, 1) / 60) > 60) {
        add(xs[i].id, `${kmLabel(d)} from the visit before, only ${Math.max(1, Math.round(min))} min later`);
      }
    }
  }
  return out;
}

// ── Import a list (Excel / CSV) ─────────────────────────────────────────────
/** Rows of a CSV / TSV / semicolon file as arrays of trimmed strings. */
export function parseCsv(text) {
  const s = String(text || '').replace(/^\uFEFF/, '');
  const firstLine = s.split(/\r?\n/, 1)[0] || '';
  const sep = [',', ';', '\t'].map((c) => [c, firstLine.split(c).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === '"' && s[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"' && cell === '') q = true;
    else if (ch === sep) { row.push(cell.trim()); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(cell.trim()); cell = '';
      if (row.some((c) => c !== '')) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell.trim());
  if (row.some((c) => c !== '')) rows.push(row);
  return rows;
}

export const IMPORT_FIELDS = Object.freeze([
  { key: 'shop_name', label: 'Shop name', required: true, words: ['shop', 'business', 'firm', 'store', 'company', 'dukan', 'party'] },
  { key: 'phone', label: 'Mobile', required: true, words: ['mobile', 'phone', 'contact no', 'whatsapp', 'number', 'mob', 'cell'] },
  { key: 'owner_name', label: 'Owner’s name', words: ['owner', 'person', 'proprietor', 'contact name'] },
  { key: 'city', label: 'City', words: ['city', 'town', 'district', 'taluka'] },
  { key: 'area', label: 'Area', words: ['area', 'locality', 'address', 'location', 'road', 'peth'] },
  { key: 'business_type', label: 'Type of business', words: ['category', 'type', 'segment', 'trade'] },
  { key: 'note', label: 'Note', words: ['note', 'remark', 'comment'] },
]);

/** Which column holds what, from the header row: { field: index or -1 }. */
export function guessColumns(header) {
  const h = (header || []).map((x) => String(x || '').toLowerCase().trim());
  const taken = new Set();
  const map = {};
  for (const f of IMPORT_FIELDS) {
    const i = h.findIndex((col, idx) => !taken.has(idx) && f.words.some((w) => col.includes(w)));
    map[f.key] = i;
    if (i >= 0) taken.add(i);
  }
  // A bare "Name" column: the shop if no shop column was found, else the owner.
  const bare = h.findIndex((col, idx) => !taken.has(idx) && /^(full )?name$/.test(col));
  if (bare >= 0) {
    if (map.shop_name < 0) map.shop_name = bare;
    else if (map.owner_name < 0) map.owner_name = bare;
  }
  return map;
}

/**
 * Turn sheet rows into leads. Skips numbers already in the CRM, repeats inside
 * the file and wrong mobiles. Returns { ready, dupes, bad }; `line` is the
 * row number in the file, for "see skipped rows".
 */
export function planImport(rows, map, existingPhones, { hasHeader = true } = {}) {
  const ready = [], dupes = [], bad = [];
  const seen = new Set();
  const get = (r, k) => (map[k] >= 0 ? String(r[map[k]] ?? '').trim() : '');
  (rows || []).forEach((r, i) => {
    if (hasHeader && i === 0) return;
    const line = i + 1;
    const p = phone10(get(r, 'phone'));
    const shop = get(r, 'shop_name') || get(r, 'owner_name');
    if (!p || !/^[6-9]/.test(p)) { bad.push({ line, why: 'Wrong mobile number', value: get(r, 'phone') || '(empty)' }); return; }
    if (!shop) { bad.push({ line, why: 'No shop name', value: p }); return; }
    if (existingPhones?.has(p)) { dupes.push({ line, why: 'Already in the CRM', value: `${shop} · ${p}` }); return; }
    if (seen.has(p)) { dupes.push({ line, why: 'Twice in this file', value: `${shop} · ${p}` }); return; }
    seen.add(p);
    ready.push({
      shop_name: shop.slice(0, 120), phone: p,
      owner_name: get(r, 'owner_name').slice(0, 80) || null, city: get(r, 'city').slice(0, 80) || null,
      area: get(r, 'area').slice(0, 120) || null, business_type: get(r, 'business_type').slice(0, 60) || null,
      note: get(r, 'note').slice(0, 180) || null,
    });
  });
  return { ready, dupes, bad };
}

/** How many leads each person gets when the fewest-open go first: { userId: n }. */
export function fewestFirst(n, people, openCounts) {
  const load = new Map((people || []).map((u) => [u, openCounts?.[u] || 0]));
  const out = Object.fromEntries((people || []).map((u) => [u, 0]));
  if (!load.size) return out;
  for (let i = 0; i < n; i++) {
    let best = null;
    for (const [u, c] of load) if (best === null || c < load.get(best)) best = u;
    out[best]++; load.set(best, load.get(best) + 1);
  }
  return out;
}

// ── Call timer ──────────────────────────────────────────────────────────────
/** Seconds from tapping Call to coming back to the CRM: null under 5 s, at most 2 hours. */
export function callSeconds(startMs, nowMs) {
  const s = Math.round((Number(nowMs) - Number(startMs)) / 1000);
  if (!Number.isFinite(s) || s < 5) return null;
  return Math.min(s, 7200);
}
export const secondsLabel = (s) => (s == null ? '' : s >= 60 ? `${Math.floor(s / 60)} m ${String(s % 60).padStart(2, '0')} s` : `${s} s`);

/** Ad and website leads (part 3 lead sources). */
export const AD_SOURCES = Object.freeze(['facebook', 'instagram', 'google', 'whatsapp', 'website']);

// ── Incentive rule (part 4) ─────────────────────────────────────────────────
/** The recommended rule; every number can be changed in Settings. */
export const RECOMMENDED_INCENTIVE = Object.freeze({
  monthly: 300, yearly: 1500, slab_after: 10, slab_monthly: 400, slab_yearly: 2000, hold_days: 30,
  verifier_monthly: 50, verifier_yearly: 250,
  pay_day: 'with salary on the 5th of the next month',
});
/** The rule from Settings, filled with the recommended values where empty. */
export function incentiveRule(cfg) {
  const r = { ...RECOMMENDED_INCENTIVE };
  for (const k of ['monthly', 'yearly', 'slab_after', 'slab_monthly', 'slab_yearly', 'hold_days', 'verifier_monthly', 'verifier_yearly']) {
    const v = Number(cfg?.[k] ?? (k === 'monthly' ? cfg?.per_paid : undefined));
    if (Number.isFinite(v) && v >= 0) r[k] = v;
  }
  if (cfg?.pay_day) r.pay_day = String(cfg.pay_day);
  // The higher rate is never below the normal one (the database does the same).
  r.slab_monthly = Math.max(r.slab_monthly, r.monthly);
  r.slab_yearly = Math.max(r.slab_yearly, r.yearly);
  return r;
}
const rs = (n) => `₹${Math.round(Number(n) || 0).toLocaleString('en-IN')}`;
/** The rule in plain words, for the team (role 'ads': the lead checker's rule). */
export function incentiveRuleLines(cfg, role) {
  const r = incentiveRule(cfg);
  if (role === 'ads') {
    return [
      `${rs(r.verifier_monthly)} for each shop that pays for the monthly plan, ${rs(r.verifier_yearly)} for the yearly plan, when it came from a lead you checked and marked Verified.`,
      `Earned only if the shop is still paying ${r.hold_days} days later (checked automatically on day ${r.hold_days + 4}, after the renewal).`,
      'Spam, wrong numbers and duplicates earn nothing, so check carefully: a good lead is one a caller can sell to.',
      `Paid ${r.pay_day}.`,
    ];
  }
  const lines = [
    `${rs(r.monthly)} for each shop that pays for the monthly plan, ${rs(r.yearly)} for the yearly plan.`,
  ];
  if (r.slab_after > 0) lines.push(`From your ${r.slab_after + 1}th paid shop in a month: ${rs(r.slab_monthly)} (monthly) and ${rs(r.slab_yearly)} (yearly) for each.`);
  lines.push(`Earned only if the shop is still paying ${r.hold_days} days later (checked automatically on day ${r.hold_days + 4}, after the renewal).`);
  lines.push('It is yours when the shop signed up with your own link or code, or when you called or visited the shop before it paid. A win you mark yourself counts once the manager approves it.');
  lines.push(`Paid ${r.pay_day}.`);
  return lines;
}
export const INCENTIVE_STATUS = Object.freeze({
  waiting: { label: 'Waiting for the 30-day check', cls: 'bg-amber-100 text-amber-900' },
  earned: { label: 'Earned', cls: 'bg-green-100 text-green-800' },
  cancelled: { label: 'Shop stopped paying', cls: 'bg-red-100 text-red-800' },
  check: { label: 'Manager to confirm', cls: 'bg-blue-100 text-blue-800' },
  paid: { label: 'Paid out', cls: 'bg-green-700 text-white' },
});
// ── Checking leads (Ads & leads executive) ──────────────────────────────────
export const VERIFY_RESULTS = Object.freeze({
  verified: { label: 'Verified', short: 'Real lead', cls: 'bg-green-100 text-green-800', hint: 'A real person, a real business, the number works' },
  spam: { label: 'Spam', short: 'Spam', cls: 'bg-red-100 text-red-800', hint: 'Fake name, test, abuse, a bot' },
  wrong_number: { label: 'Wrong number', short: 'Wrong number', cls: 'bg-red-100 text-red-800', hint: 'Not reachable, not their number' },
  duplicate: { label: 'Duplicate', short: 'Duplicate', cls: 'bg-gray-100 text-gray-800', hint: 'The same shop is already a lead' },
  not_business: { label: 'Not a business', short: 'Not a business', cls: 'bg-amber-100 text-amber-900', hint: 'A buyer, a job seeker, a student' },
});
/** A lead an Ads & leads person added and has not checked yet: it waits in Check leads, nobody calls it. */
export const waitsForCheck = (lead, staff) => !!lead && !lead.verify_status && !lead.assigned_to
  && lead.stage !== 'won' && lead.stage !== 'lost'
  && (staff || []).some((s) => s.user_id === lead.created_by && s.role === 'ads');
/** Leads to check, newest first: not checked, not closed. */
export function toCheck(leads) {
  return (leads || []).filter((l) => !l.verify_status && l.stage !== 'won' && l.stage !== 'lost')
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
}
/** Minutes from a lead arriving to now, as '4 min' / '2 h' / '3 days'. */
export function waitedLabel(fromIso, now = Date.now()) {
  const m = Math.max(0, Math.round((now - Date.parse(fromIso)) / 60000));
  if (m < 60) return `${m} min`;
  if (m < 48 * 60) return `${Math.round(m / 60)} h`;
  return `${Math.round(m / 1440)} days`;
}

/** Own sign-up link. */
export const signupLink = (code) => `https://www.pocketlink.store/start?ref=${encodeURIComponent(code || '')}`;

// ── Attendance counts work (CRM part 6) ─────────────────────────────────────
// The numbers come from sales_work_days() in the database; these only label
// them and spot someone quiet right now. Same defaults as sales_work_rule().
export const WORK_DEFAULTS = Object.freeze({
  on: true, from: null, gap_min: 30, idle_alert_min: 60, field_gap_min: 180,
  min: Object.freeze({
    caller: Object.freeze({ calls: 20, hours: 4.5 }),
    ads: Object.freeze({ checks: 15, hours: 4.5 }),
    field: Object.freeze({ visits: 3, hours: 0 }),
    manager: Object.freeze({ hours: 0 }),
  }),
});

/** The rule in Settings (work.work_rule) over the defaults. */
export function workRule(work) {
  const r = work?.work_rule && typeof work.work_rule === 'object' ? work.work_rule : {};
  return { ...WORK_DEFAULTS, ...r, min: { ...WORK_DEFAULTS.min, ...(r.min || {}) } };
}

/** 340 → '5 h 40 m'; 25 → '25 m'; nothing → ''. */
export function minutesLabel(min) {
  const m = Math.round(Number(min));
  if (!Number.isFinite(m) || m < 0) return '';
  return m < 60 ? `${m} m` : `${Math.floor(m / 60)} h ${m % 60} m`;
}

/** What a role's day needs: { key, word, need, hours }. key null = no count needed. */
export function roleNeed(role, rule) {
  const m = rule?.min?.[role] || WORK_DEFAULTS.min[role] || WORK_DEFAULTS.min.caller;
  const key = role === 'field' ? 'visits' : role === 'ads' ? 'checks' : role === 'manager' ? null : 'calls';
  const word = { visits: 'visits', checks: 'leads checked', calls: 'calls' }[key] || '';
  const need = key ? Math.max(0, Number(m[key]) || 0) : 0;
  const hours = Math.max(0, Number(m.hours) || 0);
  return { key, word, need, hours };
}

/** A day's work in one line: 'Active 5 h 40 m · 24 of 20 calls'. */
export function workLine(role, work, rule) {
  if (!work) return '';
  const n = roleNeed(role, rule);
  const got = n.key === 'checks' ? (work.checks || 0) + (work.added || 0) : n.key ? work[n.key] || 0 : null;
  const parts = [`Active ${minutesLabel(work.active_min || 0)}`];
  if (n.key) parts.push(`${got} of ${n.need} ${n.word}`);
  return parts.join(' · ');
}

const hm = (time) => String(time || '').split(':').map(Number);

/**
 * Someone quiet right now: in today, day not ended, inside their shift, and
 * nothing done for idle_alert_min (field: no visit for field_gap_min).
 * Returns { min, what, since } or null. Managers are never flagged.
 */
export function quietNow({ staff, row, work, rule, today, now = Date.now() }) {
  if (!staff?.active || staff.role === 'manager') return null;
  const inAt = Date.parse(row?.day_start_at || row?.first_seen_at || '');
  if (!Number.isFinite(inAt) || row?.day_end_at) return null;
  const [sh, sm] = hm(staff.shift_start || '09:30');
  const [eh, em] = hm(staff.shift_end || '18:30');
  const from = istInstant(today, sh || 0, sm || 0);
  const to = istInstant(today, eh || 0, em || 0);
  if (now < from || now > to) return null;
  const field = staff.role === 'field';
  const last = Date.parse((field ? work?.last_visit_at : work?.last_work_at) || '') || 0;
  const since = Math.max(inAt, from, last);
  const min = Math.floor((now - since) / 60000);
  const limit = Number(field ? rule?.field_gap_min : rule?.idle_alert_min) || (field ? 180 : 60);
  if (min < limit) return null;
  return { min, since, what: field ? 'no visit' : staff.role === 'ads' ? 'no lead checked' : 'nothing done' };
}

/** A field day's longest stretch without a visit, if over the limit: 'No visit 11:05 am – 3:10 pm (4 h 5 m)'. */
export function fieldGapLine(work, rule) {
  const g = Number(work?.visit_gap_min);
  const limit = Number(rule?.field_gap_min) || 180;
  if (!Number.isFinite(g) || g < limit || !work.visit_gap_from) return '';
  return `No visit ${istTime(work.visit_gap_from)} – ${istTime(work.visit_gap_to)} (${minutesLabel(g)})`;
}

/** Settings form (strings) → the work_rule saved in sales_settings 'work', numbers clamped. */
export function workRuleFromForm(f) {
  const n = (v, lo, hi, def) => { const x = Number(v); return Number.isFinite(x) && String(v).trim() !== '' ? Math.min(hi, Math.max(lo, x)) : def; };
  const half = (x) => Math.round(x * 2) / 2;
  const d = WORK_DEFAULTS;
  return {
    on: f?.on !== false,
    from: /^\d{4}-\d{2}-\d{2}$/.test(f?.from || '') ? f.from : null,
    gap_min: Math.round(n(f?.gap_min, 5, 240, d.gap_min)),
    idle_alert_min: Math.round(n(f?.idle_alert_min, 15, 480, d.idle_alert_min)),
    field_gap_min: Math.round(n(f?.field_gap_min, 30, 600, d.field_gap_min)),
    min: {
      caller: { calls: Math.round(n(f?.caller_calls, 0, 500, 20)), hours: half(n(f?.caller_hours, 0, 12, 4.5)) },
      ads: { checks: Math.round(n(f?.ads_checks, 0, 500, 15)), hours: half(n(f?.ads_hours, 0, 12, 4.5)) },
      field: { visits: Math.round(n(f?.field_visits, 0, 100, 3)), hours: 0 },
      manager: { hours: 0 },
    },
  };
}
