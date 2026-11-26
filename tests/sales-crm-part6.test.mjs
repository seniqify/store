// Sales CRM part 6 (founder, 2026-11-26: "start"): attendance counts work,
// not logins. Role minimums for a day, active and quiet time, quiet-now
// alerts, field gaps without a visit, and the 7 pm report line. The SQL runs
// on local Postgres outside this suite (73 checks on top of parts 1-5).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  dayStatus, monthCalendar, attendancePercent, DAY_STATUS, istInstant, workRule, workRuleFromForm, WORK_DEFAULTS,
  minutesLabel, roleNeed, workLine, quietNow, fieldGapLine,
} from '../src/crm/crmLogic.js';
import { dailyValues, presentLine, tv } from '../shared/sales-report-text.mjs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const iso = (day, h, m = 0) => new Date(istInstant(day, h, m)).toISOString();
const staff = { user_id: 'u', role: 'caller', weekly_off: 0, shift_start: '09:30', shift_end: '18:30', active: true };
const row = { staff_id: 'u', day: '2026-11-24', first_seen_at: iso('2026-11-24', 9, 20), last_seen_at: iso('2026-11-24', 18, 30) };

test('a past day follows its work level once the rule applies; a manager mark still wins', () => {
  const base = { day: '2026-11-24', today: '2026-11-26', staff, row };
  assert.equal(dayStatus({ ...base, work: { level: 'none' } }), 'nowork');
  assert.equal(dayStatus({ ...base, work: { level: 'half' } }), 'half');
  assert.equal(dayStatus({ ...base, work: { level: 'full' } }), 'present');
  assert.equal(dayStatus({ ...base, row: { ...row, first_seen_at: iso('2026-11-24', 10, 30) }, work: { level: 'full' } }), 'late');
  assert.equal(dayStatus({ ...base, work: { level: null } }), 'present', 'before the start date: the old rule');
  assert.equal(dayStatus({ ...base, row: { ...row, status_override: 'present' }, work: { level: 'none' } }), 'present', 'manager mark wins');
  assert.equal(dayStatus({ ...base, day: '2026-11-26', row: { ...row, day: '2026-11-26', first_seen_at: iso('2026-11-26', 9, 20) }, work: { level: 'none' } }), 'present', 'today is never judged early');
  assert.equal(DAY_STATUS.nowork.label, 'Logged in, no work');
});

test('the month counts no-work days, which do not count as attendance', () => {
  const rows = ['2026-11-23', '2026-11-24', '2026-11-25'].map((d) => ({ staff_id: 'u', day: d, first_seen_at: iso(d, 9, 20), last_seen_at: iso(d, 18, 30) }));
  const works = [{ staff_id: 'u', day: '2026-11-23', level: 'full', active_min: 320 }, { staff_id: 'u', day: '2026-11-24', level: 'none', active_min: 12 }, { staff_id: 'u', day: '2026-11-25', level: 'half', active_min: 150 }];
  const cal = monthCalendar({ year: 2026, month: 11, today: '2026-11-26', staff: { ...staff, created_at: '2026-11-23T00:00:00Z' }, rows, holidays: [], leaves: [], works });
  assert.deepEqual([cal.counts.present, cal.counts.nowork, cal.counts.half], [1, 1, 1]);
  assert.equal(cal.cells.find((c) => c?.day === '2026-11-24').active, 12);
  assert.equal(attendancePercent(cal.counts, cal.workedSoFar, cal.leaveSoFar), 50, '1 + 0.5 of 3 days');
});

test('rule from Settings: defaults, merge, and the form clamps', () => {
  assert.equal(workRule(null).min.caller.calls, 20);
  assert.equal(workRule({ work_rule: { gap_min: 45, min: { caller: { calls: 30, hours: 5 } } } }).min.field.visits, 3, 'other roles keep defaults');
  const r = workRuleFromForm({ on: true, from: '2026-11-27', gap_min: '1', idle_alert_min: '9999', field_gap_min: '', caller_calls: '-4', caller_hours: '4.7', ads_checks: '15', ads_hours: '4.5', field_visits: '2' });
  assert.deepEqual([r.gap_min, r.idle_alert_min, r.field_gap_min, r.min.caller.calls, r.min.caller.hours, r.min.field.visits], [5, 480, WORK_DEFAULTS.field_gap_min, 0, 4.5, 2]);
  assert.equal(workRuleFromForm({ from: 'tomorrow' }).from, null);
  assert.deepEqual(roleNeed('ads', workRule(null)), { key: 'checks', word: 'leads checked', need: 15, hours: 4.5 });
  assert.equal(roleNeed('manager', workRule(null)).key, null);
});

test('labels', () => {
  assert.equal(minutesLabel(340), '5 h 40 m');
  assert.equal(minutesLabel(25), '25 m');
  assert.equal(minutesLabel(null), '0 m');
  assert.equal(workLine('caller', { active_min: 340, calls: 24 }, workRule(null)), 'Active 5 h 40 m · 24 of 20 calls');
  assert.equal(workLine('ads', { active_min: 60, checks: 10, added: 2 }, workRule(null)), 'Active 1 h 0 m · 12 of 15 leads checked');
  assert.equal(workLine('manager', { active_min: 30 }, workRule(null)), 'Active 30 m');
  const g = { visit_gap_min: 270, visit_gap_from: iso('2026-11-26', 11), visit_gap_to: iso('2026-11-26', 15, 30) };
  assert.equal(fieldGapLine(g, workRule(null)), 'No visit 11:00 am – 3:30 pm (4 h 30 m)');
  assert.equal(fieldGapLine({ ...g, visit_gap_min: 90 }, workRule(null)), '', 'under the limit');
});

test('quiet now: only in shift, in today, day not ended, never managers', () => {
  const today = '2026-11-26';
  const rule = workRule(null);
  const r = { first_seen_at: iso(today, 9, 30) };
  const w = { last_work_at: iso(today, 14, 0), last_visit_at: iso(today, 11, 0) };
  const at = (h, m) => istInstant(today, h, m);
  assert.deepEqual(quietNow({ staff, row: r, work: w, rule, today, now: at(15, 10) }), { min: 70, since: Date.parse(w.last_work_at), what: 'nothing done' });
  assert.equal(quietNow({ staff, row: r, work: w, rule, today, now: at(14, 50) }), null, 'under an hour');
  assert.equal(quietNow({ staff, row: r, work: w, rule, today, now: at(19, 0) }), null, 'after the shift');
  assert.equal(quietNow({ staff: { ...staff, role: 'manager' }, row: r, work: w, rule, today, now: at(16, 0) }), null);
  assert.equal(quietNow({ staff, row: null, work: w, rule, today, now: at(16, 0) }), null, 'not in yet is shown elsewhere');
  assert.equal(quietNow({ staff: { ...staff, role: 'field' }, row: { ...r, day_end_at: iso(today, 15) }, work: w, rule, today, now: at(16, 0) }), null, 'day ended');
  const f = quietNow({ staff: { ...staff, role: 'field' }, row: { day_start_at: iso(today, 10) }, work: w, rule, today, now: at(14, 30) });
  assert.equal(f.what, 'no visit');
  assert.equal(f.min, 210, 'field: since the last visit, against the 3-hour limit');
  assert.equal(quietNow({ staff, row: r, work: null, rule, today, now: at(10, 45) }).min, 75, 'no work yet: since logging in');
});

test('the 7 pm report: no-work names and long quiet times, in one short line', () => {
  const d = { to: '2026-11-27', staff: 4, idle_min: 60, people: [
    { name: 'Sneha K', days_in: 1, level: 'full', quiet_min: 100, calls: 30, visits: 0, paid: 0 },
    { name: 'Neel P', days_in: 0, level: 'none', quiet_min: 300, calls: 3, visits: 0, paid: 0 },
    { name: 'Meera', days_in: 1, level: 'half', quiet_min: 65, calls: 0, visits: 0, paid: 0 },
  ] };
  assert.equal(presentLine(d), '2 of 4; logged in, no work: Neel; quiet: Sneha 1h40m, Meera 1h5m');
  assert.equal(dailyValues(d)[11], tv(presentLine(d)));
  assert.ok(dailyValues(d)[11].length <= 120);
  assert.equal(presentLine({ staff: 2, people: [{ name: 'A', days_in: 1 }] }), '1 of 2', 'before part 6 data: unchanged');
});

test('SQL: one count of days in; the browser reads only its own work; the rule starts tomorrow', () => {
  const sql = read('supabase/sales-crm-part6-forward.sql').replace(/--.*$/gm, '');
  assert.match(sql, /grant execute on function public\.sales_work_days\(date, date\) to authenticated, service_role;/);
  for (const f of ['sales_work_rule()', 'sales_work_rows(uuid, date, date)', 'sales_days_worked(uuid, date, date)']) {
    assert.match(sql, new RegExp(`revoke all on function public\\.${f.replace(/[()]/g, '\\$&')} from public, anon, authenticated;`), f);
  }
  assert.equal((sql.match(/public\.sales_days_worked\(s\.user_id, p_from, p_to\)/g) || []).length, 2, 'scoreboard and report');
  assert.doesNotMatch(sql, /t\.first_seen_at is not null or t\.day_start_at is not null\)\)\)/, 'the old login-only count is gone');
  assert.match(sql, /'work_rule', jsonb_build_object\('on', true, 'from', \(public\.sales_today\(\) \+ 1\)::text\)/);
  assert.match(sql, /where key = 'work' and not \(value \? 'work_rule'\)/, 'a rule already saved is never overwritten');
  assert.match(sql, /l\.source not in \('import', 'hub', 'signup', 'pending_signup'\)/, 'bulk and automatic leads are not work');
  assert.match(sql, /a\.review is distinct from 'rejected'/);
  const back = read('supabase/sales-crm-part6-ROLLBACK.sql');
  assert.match(back, /t\.first_seen_at is not null or t\.day_start_at is not null/, 'rollback puts the old count back');
  assert.match(back, /update public\.sales_settings set value = value - 'work_rule' where key = 'work';/);
});

test('screens: Settings keeps the rest of work; Today and Attendance read work; the team is told', () => {
  const set = read('src/crm/CrmSettings.jsx');
  assert.match(set, /saveSetting\('work', \{\n\s+\.\.\.\(settings\?\.work \|\| \{\}\),\n\s+work_rule: workRuleFromForm\(wr\),/);
  assert.match(read('src/crm/CrmToday.jsx'), /workDays\(today, today\)/);
  assert.match(read('src/crm/CrmToday.jsx'), /setInterval\(load, 5 \* 60000\)/, 'manager Today refreshes');
  assert.match(read('src/crm/CrmAttendance.jsx'), /monthCalendar\(\{ year: ym\.y, month: ym\.m, today, staff: person, rows, holidays, leaves: leave, rules, works \}\)/);
  assert.match(read('src/crm/crmService.js'), /if \(error\) return \[\];/, 'without part 6 in the database, attendance works as before');
  assert.match(read('src/crm/crmFaq.js'), /When does a day count as present\?/);
  assert.match(read('src/crm/crmTraining.js'), /logging in alone shows as “Logged in, no work”/);
});
