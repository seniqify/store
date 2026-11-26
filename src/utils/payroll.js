// PocketLink Salary: one month's pay for one person, worked out from the SAME
// attendance the CRM calendar shows (crmLogic.monthCalendar), so a payslip and
// the calendar can never disagree. Admin uses it to make the month's drafts;
// the CRM uses it for "My pay, so far this month". The database re-checks
// what it can when drafts are saved (supabase/salary-forward.sql): base pay
// not above the salary, incentives rebuilt from the CRM, advances, tax.
//
// Money is whole rupees. A day is paid, half paid or not paid:
//   present, late, weekly off, holiday       paid
//   before the CRM existed (on/after joining) paid: there is no record to judge
//   half day                                  half paid
//   "Logged in, no work"                      paid only until the trial ends
//   approved leave                            paid up to the leave allowance
//   absent, leave over the allowance          not paid
//   before joining                            not paid
import { monthCalendar, istDate } from '../crm/crmLogic.js';

export const PAYROLL_DEFAULTS = Object.freeze({
  pay_day: 6, sunday_before: true, lock_day: 2, day_rate: 'month_days', paid_leave: 1, leave_carry_max: 6,
  late_cut: false, nowork_paid_until: '2026-12-31', travel_per_km: 3, travel_cap: 150, road_factor: 1.3,
  travel_visit_days_only: true, company_name: '', company_address: '', whatsapp_on: true,
});

export const DAY_RATES = Object.freeze([
  ['month_days', 'Monthly salary ÷ days in that month'],
  ['30', 'Monthly salary ÷ 30'],
  ['working', 'Monthly salary ÷ working days'],
]);

export const PROF_TAX = Object.freeze([
  ['none', 'None'],
  ['175', '₹175 a month'],
  ['200', '₹200 a month (₹300 in Feb)'],
]);

const num = (v, d) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : d);
const bool = (v, d) => (typeof v === 'boolean' ? v : d);

/** The rules with defaults filled in and every value the right type. */
export function payrollRules(v) {
  const s = v || {};
  const D = PAYROLL_DEFAULTS;
  return {
    pay_day: Math.min(28, Math.max(1, Math.round(num(s.pay_day, D.pay_day)))),
    sunday_before: bool(s.sunday_before, D.sunday_before),
    lock_day: Math.min(10, Math.max(1, Math.round(num(s.lock_day, D.lock_day)))),
    day_rate: ['month_days', '30', 'working'].includes(s.day_rate) ? s.day_rate : D.day_rate,
    paid_leave: Math.max(0, Math.round(num(s.paid_leave, D.paid_leave))),
    leave_carry_max: Math.max(0, Math.round(num(s.leave_carry_max, D.leave_carry_max))),
    late_cut: bool(s.late_cut, D.late_cut),
    nowork_paid_until: s.nowork_paid_until === null ? null : (/^\d{4}-\d{2}-\d{2}$/.test(s.nowork_paid_until || '') ? s.nowork_paid_until : D.nowork_paid_until),
    travel_per_km: Math.max(0, num(s.travel_per_km, D.travel_per_km)),
    travel_cap: Math.max(0, Math.round(num(s.travel_cap, D.travel_cap))),
    road_factor: Math.min(2, Math.max(1, num(s.road_factor, D.road_factor))),
    travel_visit_days_only: bool(s.travel_visit_days_only, D.travel_visit_days_only),
    company_name: String(s.company_name || ''),
    company_address: String(s.company_address || ''),
    whatsapp_on: bool(s.whatsapp_on, D.whatsapp_on),
  };
}

// ── Dates ───────────────────────────────────────────────────────────────────
const pad = (n) => String(n).padStart(2, '0');
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** '2026-11-01' for any day in November 2026. */
export const monthOf = (day) => `${String(day).slice(0, 7)}-01`;
/** 30 for '2026-11-01'. */
export function monthDays(month) {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
/** The first of the month n months later (or earlier). */
export function addMonths(month, n) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-01`;
}
/** The last day of the month. */
export const monthEnd = (month) => `${month.slice(0, 7)}-${pad(monthDays(month))}`;
/** 'November 2026'. */
export function monthLabel(month) {
  const [y, m] = String(month || '').split('-').map(Number);
  return m ? `${MONTHS[m - 1]} ${y}` : '';
}
const weekdayOf = (day) => new Date(`${day}T00:00:00Z`).getUTCDay();
/** 'Sat 5 Dec'. */
export function dayLabel(day) {
  if (!/^\d{4}-\d{2}-\d{2}/.test(day || '')) return '';
  const d = new Date(`${day.slice(0, 10)}T00:00:00Z`);
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()].slice(0, 3)}`;
}
/** '5 Dec 2026'. */
export function dateLabel(day) {
  if (!/^\d{4}-\d{2}-\d{2}/.test(day || '')) return '';
  const d = new Date(`${day.slice(0, 10)}T00:00:00Z`);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()].slice(0, 3)} ${d.getUTCFullYear()}`;
}
const addDay = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

/** The day the month locks: after it, drafts can be saved (the database agrees). */
export function lockDay(month, rules) {
  const next = addMonths(month, 1);
  return addDay(next, payrollRules(rules).lock_day - 1);
}
/** Pay day for a month's salary: in the next month; a Sunday moves to the Saturday before. */
export function payDay(month, rules) {
  const r = payrollRules(rules);
  const next = addMonths(month, 1);
  let d = addDay(next, Math.min(r.pay_day, monthDays(next)) - 1);
  if (r.sunday_before && weekdayOf(d) === 0) d = addDay(d, -1);
  return d;
}

export const rupees = (n) => `${n < 0 ? '−' : ''}₹${Math.abs(Math.round(Number(n) || 0)).toLocaleString('en-IN')}`;
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const daysWord = (n) => `${String(n).replace(/\.0$/, '')} ${n === 1 ? 'day' : 'days'}`;

/** Professional Tax for a month: none, ₹175, or ₹200 (₹300 in February). */
export function profTax(kind, month) {
  if (kind === '175') return 175;
  if (kind === '200') return Number(String(month).slice(5, 7)) === 2 ? 300 : 200;
  return 0;
}

// ── Field travel ────────────────────────────────────────────────────────────
/** Straight-line km between two { lat, lng }. */
export function kmBetween(a, b) {
  const R = 6371;
  const rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
const okPoint = (lat, lng) => Number.isFinite(Number(lat)) && Number.isFinite(Number(lng)) && lat !== null && lng !== null;

/**
 * Each day's travel for one field person: start of day → each visit
 * check-in → end of day, straight line × the road factor, at the rate,
 * up to the daily cap. Days without a visit pay nothing (when that rule is on).
 */
export function travelDays({ userId, attendance, visits, rules, from, to }) {
  const r = payrollRules(rules);
  const byDay = new Map();
  for (const v of visits || []) {
    if (v.staff_id !== userId || !okPoint(v.lat, v.lng)) continue;
    const day = istDate(Date.parse(v.at));
    if (day < from || day > to) continue;
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(v);
  }
  const rows = new Map((attendance || []).filter((a) => a.staff_id === userId).map((a) => [a.day, a]));
  const days = [...new Set([...byDay.keys(), ...rows.keys()])].filter((d) => d >= from && d <= to).sort();
  const out = [];
  for (const day of days) {
    const vs = (byDay.get(day) || []).slice().sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    if (r.travel_visit_days_only && !vs.length) continue;
    const a = rows.get(day);
    const pts = [];
    if (a && okPoint(a.start_lat, a.start_lng)) pts.push({ lat: Number(a.start_lat), lng: Number(a.start_lng) });
    for (const v of vs) pts.push({ lat: Number(v.lat), lng: Number(v.lng) });
    if (a && okPoint(a.end_lat, a.end_lng)) pts.push({ lat: Number(a.end_lat), lng: Number(a.end_lng) });
    let k = 0;
    for (let i = 1; i < pts.length; i++) k += kmBetween(pts[i - 1], pts[i]);
    k *= r.road_factor;
    const km = Math.round(k * 10) / 10;
    out.push({ day, km, visits: vs.length, pay: Math.min(r.travel_cap, Math.round(km * r.travel_per_km)) });
  }
  return out;
}

// ── One person's month ──────────────────────────────────────────────────────
export const PAY_DAY = Object.freeze({
  present: { label: 'Present', paid: 1 },
  late: { label: 'Late, paid in full', paid: 1 },
  half: { label: 'Half day', paid: 0.5 },
  nowork_paid: { label: 'Logged in, no work (paid in the trial)', paid: 1 },
  nowork: { label: 'Logged in, no work', paid: 0 },
  absent: { label: 'Absent', paid: 0 },
  leave_paid: { label: 'Paid leave', paid: 1 },
  leave_unpaid: { label: 'Leave without pay', paid: 0 },
  holiday: { label: 'Holiday', paid: 1 },
  off: { label: 'Weekly off', paid: 1 },
  precrm: { label: 'Before the CRM: paid', paid: 1 },
  not_joined: { label: 'Before joining', paid: 0 },
  future: { label: '', paid: 0 },
  today: { label: 'Today', paid: 0 },
});

/**
 * One person's pay for a month.
 *   month        '2026-11-01'
 *   today        India date; a month that is over has no future days
 *   staff        their sales_staff row (user_id, name, role, shift, weekly_off, created_at)
 *   person       their payroll_people row (base_monthly, joined_on, prof_tax)
 *   rules        payroll rules; workRules: CRM Settings 'work' (grace, half day, work rule)
 *   attendance, holidays, leaves, works, visits: as the CRM has them (any people; filtered here)
 *   incentives   earned and not yet paid (any people; filtered here)
 *   advances     { id, user_id, amount, given_on, per_month, left }
 *   leaveLeft    paid leave carried from last month (null: none)
 * Returns the draft the database expects, plus the calendar and travel days for screens.
 */
export function computePay({
  month, today, staff, person, rules, workRules, attendance, holidays, leaves, works, visits, incentives, advances, leaveLeft = null,
}) {
  const r = payrollRules(rules);
  const m = monthOf(month);
  const [y, mo] = m.split('-').map(Number);
  const end = monthEnd(m);
  const base = Math.max(0, Math.round(Number(person?.base_monthly) || 0));
  const joined = person?.joined_on || null;
  const cal = monthCalendar({ year: y, month: mo, today, staff, rows: attendance, holidays, leaves, rules: workRules, works });
  const holidaySet = new Set((holidays || []).map((h) => h.day || h));
  const isWorking = (day) => weekdayOf(day) !== Number(staff?.weekly_off ?? 0) && !holidaySet.has(day);

  let leaveAvail = Math.max(0, Number(leaveLeft) || 0) + r.paid_leave;
  let leaveUsed = 0;
  const c = { present: 0, late: 0, half: 0, nowork: 0, nowork_paid: 0, absent: 0, leave_paid: 0, leave_unpaid: 0, holiday: 0, off: 0, precrm: 0, not_joined: 0 };
  const cells = [];
  let paid = 0, unpaid = 0, workingInMonth = 0, open = 0;
  for (const cell of cal.cells) {
    if (!cell) { cells.push(null); continue; }
    const { day } = cell;
    const working = isWorking(day);
    if (working) workingInMonth++;
    // Days still to come (a weekly off or holiday too) are not paid yet.
    if (day > today) { open++; cells.push({ day, n: cell.n, status: 'future', paid: 0 }); continue; }
    let st = cell.status;
    if (joined && day < joined) st = 'not_joined';
    else if (st === 'before') st = 'precrm';
    else if (st === 'nowork') st = r.nowork_paid_until && day <= r.nowork_paid_until ? 'nowork_paid' : 'nowork';
    else if (st === 'leave') {
      if (leaveUsed + 1 <= leaveAvail) { st = 'leave_paid'; leaveUsed++; } else st = 'leave_unpaid';
    }
    if (st === 'future' || st === 'today') { open++; cells.push({ day, n: cell.n, status: st, paid: 0 }); continue; }
    const p = PAY_DAY[st]?.paid ?? 0;
    if (c[st] !== undefined) c[st]++;
    const counts = r.day_rate !== 'working' || working;
    if (counts) { paid += p; unpaid += 1 - p; }
    cells.push({ day, n: cell.n, status: st, paid: p });
  }
  let lateCut = 0;
  if (r.late_cut && c.late >= 3) {
    lateCut = Math.floor(c.late / 3) * 0.5;
    paid -= lateCut;
    unpaid += lateCut;
  }
  const inMonth = monthDays(m);
  const denom = r.day_rate === '30' ? 30 : r.day_rate === 'working' ? Math.max(1, workingInMonth) : inMonth;
  const perDay = base / denom;
  const complete = open === 0;
  const baseEarned = Math.max(0, Math.min(base, Math.round(complete ? base - perDay * unpaid : perDay * paid)));
  const leaveLeftAfter = Math.min(r.leave_carry_max, Math.max(0, leaveAvail - leaveUsed));

  const lines = [];
  const pd = Math.round(perDay);
  let how;
  if (!complete) how = `${rupees(base)} ÷ ${denom} days = ${rupees(pd)} a day × ${daysWord(paid)} paid so far`;
  else if (unpaid === 0) how = `Full month: ${rupees(base)}`;
  else if (r.day_rate === 'month_days') how = `${rupees(base)} a month ÷ ${inMonth} days × ${daysWord(paid)} paid`;
  else if (r.day_rate === 'working') how = `${rupees(base)} a month ÷ ${denom} working days × ${daysWord(paid)} paid`;
  else how = `${rupees(base)} a month, less ${rupees(pd)} a day for ${daysWord(unpaid)} not paid`;
  lines.push({ kind: 'base', label: 'Base pay', how, amount: baseEarned });

  const mine = (incentives || []).filter((i) => i.staff_id === staff?.user_id && (i.status === undefined || i.status === 'earned'));
  const incSum = mine.reduce((a, i) => a + (Number(i.amount) || 0), 0);
  if (mine.length) {
    lines.push({ kind: 'incentive', label: 'Incentive', how: `${plural(mine.length, 'shop')} still paying after the 30-day check`, amount: incSum });
  }

  let travel = [];
  if (staff?.role === 'field') {
    travel = travelDays({ userId: staff.user_id, attendance, visits, rules: r, from: m, to: end });
    const tSum = travel.reduce((a, d) => a + d.pay, 0);
    const tKm = Math.round(travel.reduce((a, d) => a + d.km, 0));
    if (tSum > 0) {
      lines.push({ kind: 'travel', label: 'Field travel', how: `${tKm} km on ${plural(travel.length, 'day')} × ${rupees(r.travel_per_km)}, at most ${rupees(r.travel_cap)} a day`, amount: tSum });
    }
  }

  const tax = profTax(person?.prof_tax, m);
  const earnings = lines.reduce((a, l) => a + l.amount, 0);
  let room = Math.max(0, earnings - tax);
  for (const a of (advances || []).filter((x) => x.user_id === staff?.user_id && x.left > 0 && x.given_on <= end).sort((p, q) => (p.given_on < q.given_on ? -1 : 1))) {
    const want = Math.min(a.per_month || a.left, a.left);
    const take = Math.min(want, room);
    if (take <= 0) continue;
    room -= take;
    const h = take === a.amount ? `Given ${dateLabel(a.given_on)} · all of it` : `Given ${dateLabel(a.given_on)} · ${rupees(take)} of ${rupees(a.left)} left`;
    lines.push({ kind: 'advance', label: 'Salary advance', how: h, amount: -take, advance_id: a.id });
  }
  lines.push({ kind: 'tax', label: 'Professional Tax', how: tax ? 'Maharashtra, as set up' : 'None for this person', amount: tax ? -tax : 0 });

  const earn = lines.filter((l) => l.amount > 0).reduce((a, l) => a + l.amount, 0);
  const ded = lines.filter((l) => l.amount < 0).reduce((a, l) => a - l.amount, 0);
  return {
    user_id: staff?.user_id,
    name: staff?.name || '',
    role: staff?.role || '',
    base_monthly: base,
    complete,
    days: {
      in_month: inMonth, denom, rule: r.day_rate, paid, unpaid, ...c,
      late_cut_days: lateCut, leave_left: leaveLeftAfter, joined_on: joined,
    },
    lines,
    incentive_keys: mine.map((i) => ({ lead_id: i.lead_id, staff_id: i.staff_id })),
    incentives: mine,
    travel,
    cells,
    earnings: earn,
    deductions: ded,
    net: earn - ded,
  };
}

/** What the database takes for one draft. */
export const draftOf = (p) => ({ user_id: p.user_id, days: p.days, lines: p.lines, incentive_keys: p.incentive_keys });

/** A line's sign as the payslip shows it: '+₹2,400', '−₹2,000', '₹13,767'. */
export function lineAmount(l) {
  if (l.kind === 'base') return rupees(l.amount);
  if (l.amount > 0) return `+${rupees(l.amount)}`;
  return rupees(l.amount);
}

export const PAID_BY = Object.freeze({ upi: 'UPI', bank: 'Bank transfer', cash: 'Cash' });

/** Hide the middle of a UPI id or account: 'kavy••••@okaxis', '••••4410'. */
export function maskPayTo(v) {
  const s = String(v || '').trim();
  if (!s) return '';
  const at = s.indexOf('@');
  if (at > 0) return `${s.slice(0, Math.min(4, at))}••••${s.slice(at)}`;
  const d = s.replace(/\D/g, '');
  return d.length >= 4 ? `••••${d.slice(-4)}` : '••••';
}

/** Rupees in words for the payslip: 'Rupees fourteen thousand one hundred and sixty-seven only'. */
export function rupeesInWords(n) {
  const v = Math.max(0, Math.round(Number(n) || 0));
  const ones = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
  const tens = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
  const two = (x) => (x < 20 ? ones[x] : `${tens[Math.floor(x / 10)]}${x % 10 ? `-${ones[x % 10]}` : ''}`);
  const three = (x) => {
    const h = Math.floor(x / 100), rest = x % 100;
    return [h ? `${ones[h]} hundred` : '', rest ? `${h ? 'and ' : ''}${two(rest)}` : ''].filter(Boolean).join(' ');
  };
  if (v === 0) return 'Rupees zero only';
  const crore = Math.floor(v / 10000000), lakh = Math.floor((v % 10000000) / 100000), thousand = Math.floor((v % 100000) / 1000), rest = v % 1000;
  const parts = [crore ? `${three(crore)} crore` : '', lakh ? `${two(lakh)} lakh` : '', thousand ? `${two(thousand)} thousand` : '', rest ? three(rest) : ''].filter(Boolean);
  if (rest && rest < 100 && parts.length > 1) parts[parts.length - 1] = `and ${parts[parts.length - 1]}`;
  return `Rupees ${parts.join(' ')} only`;
}

/**
 * Everyone's pay for a month from admin_payroll_inputs(): one computePay per
 * person with an active salary in Salary setup.
 */
export function monthPays(d) {
  if (!d) return [];
  const staffBy = new Map((d.staff || []).map((s) => [s.user_id, s]));
  return (d.people || []).filter((p) => p.active && staffBy.has(p.user_id)).map((person) => computePay({
    month: d.month, today: d.today, staff: staffBy.get(person.user_id), person, rules: d.settings, workRules: d.work_rules,
    attendance: d.attendance, holidays: d.holidays, leaves: d.leaves, works: d.works, visits: d.visits,
    incentives: d.incentives, advances: d.advances, leaveLeft: d.leave_left?.[person.user_id] ?? null,
  })).sort((a, b) => a.name.localeCompare(b.name));
}

/** The sum of a slip's lines of one kind. */
export const linesOf = (lines, kind) => (lines || []).filter((l) => l.kind === kind).reduce((a, l) => a + (Number(l.amount) || 0), 0);
/** A bonus or deduction added by hand. */
export const isManualLine = (l) => l.kind === 'bonus' || l.kind === 'deduction';

const LINE_ORDER = ['base', 'incentive', 'travel', 'bonus', 'advance', 'deduction', 'tax'];
/** A slip's lines in reading order (money in, then out), each with its index in the saved list. */
export const orderedLines = (lines) => (lines || []).map((l, i) => ({ ...l, i }))
  .sort((a, b) => (LINE_ORDER.indexOf(a.kind) - LINE_ORDER.indexOf(b.kind)) || a.i - b.i);
