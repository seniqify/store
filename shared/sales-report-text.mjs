// Sales CRM part 4: the WhatsApp report values for the manager (7 pm daily,
// Monday weekly). PURE; shared by supabase/functions/sales-report and tests.
// WhatsApp template values: no line breaks or tabs, no runs of spaces, never
// empty, kept short.

export const DAILY_TEMPLATE =
  'PocketLink sales report, {{1}}: {{2}} calls ({{3}} picked up), {{4}} shop visits, {{5}} demos. '
  + 'Paid shops: {{6}} ({{7}}). New leads: {{8}}, not called yet: {{9}}. Late follow-ups: {{10}}. '
  + 'Present: {{11}}. Best today: {{12}}. Details: crm.pocketlink.store/reports';

export const WEEKLY_TEMPLATE =
  'PocketLink weekly sales report, {{1}}: {{2}} calls, {{3}} shop visits, {{4}} demos. '
  + 'Paid shops: {{5}} ({{6}}). Incentive earned: {{7}}. New leads: {{8}} ({{9}} from ads and the website). '
  + 'Days in: {{10}}. Top performer: {{11}}. Needs attention: {{12}}. Details: crm.pocketlink.store/reports';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** A safe template value: one line, trimmed, capped, never empty. */
export function tv(v, fallback = '-') {
  const s = String(v ?? '').replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim().slice(0, 120);
  return s || fallback;
}
const inr = (n) => `₹${Math.round(Number(n) || 0).toLocaleString('en-IN')}`;
const n = (v) => String(Math.round(Number(v) || 0));
const day = (d) => { const x = new Date(`${d}T00:00:00Z`); return `${DAYS[x.getUTCDay()]} ${x.getUTCDate()} ${MONTHS[x.getUTCMonth()]}`; };
const first = (name) => String(name || '').split(/\s+/)[0] || 'Someone';

/** India dates for a report run at `nowMs`: daily = today; weekly = the 7 days before today. */
export function reportPeriod(kind, nowMs = Date.now()) {
  const today = new Date(nowMs + 330 * 60000).toISOString().slice(0, 10);
  if (kind !== 'weekly') return { from: today, to: today };
  const back = (k) => new Date(Date.parse(`${today}T00:00:00Z`) - k * 86400000).toISOString().slice(0, 10);
  return { from: back(7), to: back(1) };
}

function best(people) {
  const p = [...(people || [])].sort((a, b) => (b.paid - a.paid) || ((b.calls + b.visits) - (a.calls + a.visits)))[0];
  if (!p || (!p.paid && !p.calls && !p.visits)) return 'no activity yet';
  const parts = [];
  if (p.paid) parts.push(`${p.paid} paid`);
  if (p.calls) parts.push(`${p.calls} calls`);
  if (p.visits) parts.push(`${p.visits} visits`);
  return `${first(p.name)} (${parts.join(', ')})`;
}

/** 100 → '1h40m' (short, for the one-line WhatsApp value). */
const hm = (min) => { const m = Math.round(Number(min) || 0); return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${m % 60 ? `${m % 60}m` : ''}`; };

/** Who logged in without work, and who was quiet long, for the Present value. */
export function presentLine(d) {
  const people = d.people || [];
  const present = people.filter((p) => p.days_in > 0).length;
  const idle = Number(d.idle_min) || 60;
  const noWork = people.filter((p) => p.level === 'none').map((p) => first(p.name));
  const quiet = people.filter((p) => p.level !== 'none' && Number(p.quiet_min) >= idle)
    .sort((a, b) => b.quiet_min - a.quiet_min).slice(0, 3).map((p) => `${first(p.name)} ${hm(p.quiet_min)}`);
  let s = `${present} of ${n(d.staff)}`;
  if (noWork.length) s += `; logged in, no work: ${noWork.join(', ')}`;
  if (quiet.length) s += `; quiet: ${quiet.join(', ')}`;
  return s;
}

export function dailyValues(d) {
  return {
    1: tv(day(d.to)), 2: n(d.calls), 3: n(d.answered), 4: n(d.visits), 5: n(d.demos),
    6: n(d.paid), 7: inr(d.collected), 8: n(d.new_leads), 9: n(d.not_called), 10: n(d.late),
    11: tv(presentLine(d)), 12: tv(best(d.people)),
  };
}

export function weeklyValues(d) {
  const people = d.people || [];
  const avgIn = people.length ? (people.reduce((s, p) => s + (Number(p.days_in) || 0), 0) / people.length) : 0;
  const worst = [...people].sort((a, b) => (b.late || 0) - (a.late || 0))[0];
  const attention = worst && worst.late >= 3 ? `${first(worst.name)}: ${worst.late} late follow-ups` : Number(d.not_called) > 0 ? `${n(d.not_called)} leads not called yet` : 'nothing urgent';
  return {
    1: tv(`${day(d.from)} - ${day(d.to)}`), 2: n(d.calls), 3: n(d.visits), 4: n(d.demos),
    5: n(d.paid), 6: inr(d.collected), 7: inr(d.incentive_earned), 8: n(d.new_leads), 9: n(d.ad_leads),
    10: tv(`${Math.round(avgIn * 10) / 10} of ${n(d.days)} days on average`), 11: tv(best(people)), 12: tv(attention),
  };
}

/** The finished text, for the CRM's Reports page and the preview. */
export function fillTemplate(template, values) {
  return template.replace(/\{\{(\d+)\}\}/g, (m, k) => values[k] ?? m);
}
