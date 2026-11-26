// PocketLink Salary (founder, 2026-11-26: "start"): one month's pay from the
// CRM's own attendance. The SQL runs on local Postgres outside this suite
// (155 checks on top of CRM parts 1-6 and Admin part 1).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  computePay, payrollRules, payDay, lockDay, profTax, travelDays, kmBetween, rupeesInWords, maskPayTo,
  monthLabel, addMonths, monthDays, draftOf, lineAmount, PAYROLL_DEFAULTS,
} from '../src/utils/payroll.js';
import { istInstant } from '../src/crm/crmLogic.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const iso = (day, h, m = 0) => new Date(istInstant(day, h, m)).toISOString();
const NOV = Array.from({ length: 30 }, (_, i) => `2026-11-${String(i + 1).padStart(2, '0')}`);
const sneha = { user_id: 'u1', name: 'Sneha K', role: 'caller', weekly_off: 0, shift_start: '09:30', shift_end: '18:30', created_at: '2026-07-01T00:00:00Z' };
const person = { base_monthly: 14000, joined_on: '2026-08-01', prof_tax: 'none' };
const holidays = [{ day: '2026-11-09' }, { day: '2026-11-10' }];
// Every working day 9:20 to 18:30; 14 Nov late (10:30); 21 Nov half (out at 12:00); 18 Nov on leave.
const rows = NOV.filter((d) => new Date(`${d}T00:00:00Z`).getUTCDay() !== 0 && !['2026-11-09', '2026-11-10', '2026-11-18'].includes(d)).map((d) => ({
  staff_id: 'u1', day: d,
  first_seen_at: iso(d, d === '2026-11-14' ? 10 : 9, d === '2026-11-14' ? 30 : 20),
  last_seen_at: iso(d, d === '2026-11-21' ? 12 : 18, d === '2026-11-21' ? 0 : 30),
}));
const leaves = [{ staff_id: 'u1', from_day: '2026-11-18', to_day: '2026-11-18', status: 'approved' }];
const incentives = [300, 300, 300, 1500].map((amount, i) => ({ lead_id: `L${i}`, staff_id: 'u1', amount, status: 'earned', shop: `Shop ${i}` }))
  .concat([{ lead_id: 'LX', staff_id: 'u1', amount: 300, status: 'cancelled' }, { lead_id: 'LY', staff_id: 'someone', amount: 300, status: 'earned' }]);
const advances = [{ id: 'a1', user_id: 'u1', amount: 2000, given_on: '2026-11-12', per_month: null, left: 2000 }];
const base = { month: '2026-11-01', today: '2026-12-03', staff: sneha, person, rules: {}, workRules: {}, attendance: rows, holidays, leaves, works: [], visits: [], incentives, advances };

test('the mockup month: 29.5 paid days, incentives, advance, no tax = Rs 14,167', () => {
  const p = computePay(base);
  assert.equal(p.complete, true);
  assert.equal(p.days.paid, 29.5);
  assert.deepEqual([p.days.present, p.days.late, p.days.half, p.days.leave_paid, p.days.off, p.days.holiday], [20, 1, 1, 1, 5, 2]);
  assert.deepEqual(p.lines.map((l) => [l.kind, l.amount]), [['base', 13767], ['incentive', 2400], ['advance', -2000], ['tax', 0]]);
  assert.equal(p.lines[0].how, '₹14,000 a month ÷ 30 days × 29.5 days paid');
  assert.equal(p.lines[1].how, '4 shops still paying after the 30-day check');
  assert.equal(p.lines[2].advance_id, 'a1');
  assert.equal(p.net, 14167);
  assert.deepEqual(p.incentive_keys.map((k) => k.lead_id), ['L0', 'L1', 'L2', 'L3'], 'only her earned ones');
  assert.deepEqual(Object.keys(draftOf(p)), ['user_id', 'days', 'lines', 'incentive_keys']);
  assert.equal(p.days.leave_left, 0);
});

test('day rate: ÷ 30 never pays more than the salary; ÷ working days counts only working days', () => {
  const dec = Array.from({ length: 31 }, (_, i) => `2026-12-${String(i + 1).padStart(2, '0')}`);
  const full = dec.map((d) => ({ staff_id: 'u1', day: d, first_seen_at: iso(d, 9, 20), last_seen_at: iso(d, 18, 30), status_override: 'present' }));
  const p30 = computePay({ ...base, month: '2026-12-01', today: '2027-01-04', attendance: full, holidays: [], leaves: [], incentives: [], advances: [], rules: { day_rate: '30' } });
  assert.equal(p30.lines[0].amount, 14000);
  const absentOne = full.map((r) => (r.day === '2026-12-15' ? { ...r, status_override: 'absent' } : r));
  const pw = computePay({ ...base, month: '2026-12-01', today: '2027-01-04', attendance: absentOne, holidays: [], leaves: [], incentives: [], advances: [], rules: { day_rate: 'working' } });
  assert.equal(pw.days.denom, 27, '31 days less 4 Sundays');
  assert.equal(pw.lines[0].amount, Math.round(14000 - 14000 / 27));
});

test('leave: the monthly allowance plus what carried over; the rest is unpaid', () => {
  const two = [{ staff_id: 'u1', from_day: '2026-11-18', to_day: '2026-11-19', status: 'approved' }];
  const noCarry = computePay({ ...base, leaves: two, incentives: [], advances: [] });
  assert.deepEqual([noCarry.days.leave_paid, noCarry.days.leave_unpaid, noCarry.days.leave_left], [1, 1, 0]);
  const carried = computePay({ ...base, leaves: two, incentives: [], advances: [], leaveLeft: 2 });
  assert.deepEqual([carried.days.leave_paid, carried.days.leave_unpaid, carried.days.leave_left], [2, 0, 1]);
  const capped = computePay({ ...base, leaves: [], incentives: [], advances: [], leaveLeft: 9, rules: { leave_carry_max: 6 } });
  assert.equal(capped.days.leave_left, 6);
});

test('before the CRM existed is paid; before joining is not', () => {
  const newCrm = { ...sneha, created_at: '2026-11-25T03:00:00Z' };
  const p = computePay({ ...base, staff: newCrm, incentives: [], advances: [] });
  assert.equal(p.days.precrm, 24, '1-24 Nov: no record, paid');
  assert.equal(p.days.half, 0, 'the half day was before the CRM');
  const joined = computePay({ ...base, person: { ...person, joined_on: '2026-11-16' }, incentives: [], advances: [] });
  assert.equal(joined.days.not_joined, 15);
  assert.equal(joined.lines[0].amount, Math.round(14000 - (14000 / 30) * (15 + 0.5)));
});

test('"Logged in, no work" is paid during the trial only; late marks cut only when switched on', () => {
  const works = [{ staff_id: 'u1', day: '2026-11-27', level: 'none' }];
  const trial = computePay({ ...base, works, incentives: [], advances: [] });
  assert.deepEqual([trial.days.nowork_paid, trial.days.nowork, trial.days.paid], [1, 0, 29.5]);
  const after = computePay({ ...base, works, incentives: [], advances: [], rules: { nowork_paid_until: '2026-11-26' } });
  assert.deepEqual([after.days.nowork, after.days.paid], [1, 28.5]);
  const lates = rows.map((r) => (['2026-11-02', '2026-11-03'].includes(r.day) ? { ...r, first_seen_at: iso(r.day, 10, 30) } : r));
  assert.equal(computePay({ ...base, attendance: lates, incentives: [], advances: [] }).days.paid, 29.5, 'off: 3 lates cost nothing');
  assert.equal(computePay({ ...base, attendance: lates, incentives: [], advances: [], rules: { late_cut: true } }).days.paid, 29, 'on: every 3 lates = half a day');
});

test('advances never take pay below zero; tax and February', () => {
  const p = computePay({ ...base, person: { ...person, base_monthly: 1000, prof_tax: '200' }, incentives: [], advances: [{ id: 'a1', user_id: 'u1', amount: 5000, given_on: '2026-11-02', per_month: null, left: 5000 }] });
  assert.equal(p.net, 0);
  assert.equal(p.lines.find((l) => l.kind === 'advance').how, 'Given 2 Nov 2026 · ₹783 of ₹5,000 left');
  assert.equal(profTax('200', '2027-02-01'), 300);
  assert.equal(profTax('175', '2026-11-01'), 175);
  assert.equal(profTax('none', '2027-02-01'), 0);
  const monthly = computePay({ ...base, incentives: [], advances: [{ id: 'a2', user_id: 'u1', amount: 3000, given_on: '2026-11-20', per_month: 1000, left: 3000 }] });
  assert.equal(monthly.lines.find((l) => l.kind === 'advance').amount, -1000);
  assert.equal(computePay({ ...base, incentives: [], advances: [{ id: 'a3', user_id: 'u1', amount: 3000, given_on: '2026-12-01', per_month: null, left: 3000 }] }).lines.some((l) => l.kind === 'advance'), false, 'an advance given after the month waits');
});

test('field travel: start → visits → end, × road factor, at the rate, up to the cap; rejected visits never arrive here', () => {
  const field = { ...sneha, role: 'field', user_id: 'f1' };
  const day = '2026-11-03';
  const att = [{ staff_id: 'f1', day, first_seen_at: iso(day, 9, 50), last_seen_at: iso(day, 19), start_lat: 17.6599, start_lng: 75.9064, end_lat: 17.6599, end_lng: 75.9064 }];
  const visits = [{ staff_id: 'f1', at: iso(day, 11), lat: 17.6868, lng: 75.9064 }, { staff_id: 'f1', at: iso(day, 15), lat: 17.6868, lng: 75.95 }];
  const t = travelDays({ userId: 'f1', attendance: att, visits, rules: {}, from: '2026-11-01', to: '2026-11-30' });
  const straight = kmBetween({ lat: 17.6599, lng: 75.9064 }, { lat: 17.6868, lng: 75.9064 }) + kmBetween({ lat: 17.6868, lng: 75.9064 }, { lat: 17.6868, lng: 75.95 }) + kmBetween({ lat: 17.6868, lng: 75.95 }, { lat: 17.6599, lng: 75.9064 });
  assert.equal(t.length, 1);
  assert.equal(t[0].km, Math.round(straight * 1.3 * 10) / 10);
  assert.equal(t[0].pay, Math.min(150, Math.round(t[0].km * 3)));
  assert.equal(travelDays({ userId: 'f1', attendance: att, visits: [], rules: {}, from: '2026-11-01', to: '2026-11-30' }).length, 0, 'no visit, no travel');
  assert.equal(travelDays({ userId: 'f1', attendance: att, visits, rules: { travel_cap: 10 }, from: '2026-11-01', to: '2026-11-30' })[0].pay, 10);
  const p = computePay({ ...base, staff: field, attendance: att, visits, incentives: [], advances: [] });
  assert.equal(p.lines.find((l) => l.kind === 'travel').amount, t[0].pay);
  assert.equal(computePay(base).lines.some((l) => l.kind === 'travel'), false, 'callers get no travel');
});

test('so far this month: pay builds up day by day', () => {
  const p = computePay({ ...base, today: '2026-11-14', incentives: [], advances: [] });
  assert.equal(p.complete, false);
  assert.ok(p.lines[0].how.endsWith('paid so far'));
  assert.ok(p.lines[0].amount > 0 && p.lines[0].amount < 14000 * 14 / 30 + 1);
});

test('pay day, lock day and labels', () => {
  assert.equal(lockDay('2026-11-01', {}), '2026-12-02');
  assert.equal(payDay('2026-11-01', {}), '2026-12-05', '6 Dec 2026 is a Sunday');
  assert.equal(payDay('2026-11-01', { sunday_before: false }), '2026-12-06');
  assert.equal(payDay('2026-10-01', {}), '2026-11-06');
  assert.equal(monthLabel('2026-11-01'), 'November 2026');
  assert.equal(addMonths('2026-12-01', 1), '2027-01-01');
  assert.equal(monthDays('2028-02-01'), 29);
  assert.equal(payrollRules({ pay_day: 40, day_rate: 'weekly', road_factor: 5 }).pay_day, 28);
  assert.equal(payrollRules({ day_rate: 'weekly' }).day_rate, PAYROLL_DEFAULTS.day_rate);
  assert.equal(lineAmount({ kind: 'incentive', amount: 2400 }), '+₹2,400');
  assert.equal(lineAmount({ kind: 'advance', amount: -2000 }), '−₹2,000');
});

test('words and masks for the payslip', () => {
  assert.equal(rupeesInWords(14167), 'Rupees fourteen thousand one hundred and sixty-seven only');
  assert.equal(rupeesInWords(1234567), 'Rupees twelve lakh thirty-four thousand five hundred and sixty-seven only');
  assert.equal(rupeesInWords(100000), 'Rupees one lakh only');
  assert.equal(rupeesInWords(1005), 'Rupees one thousand and five only');
  assert.equal(maskPayTo('kavya@okaxis'), 'kavy••••@okaxis');
  assert.equal(maskPayTo('SBI 1234567890'), '••••7890');
});

test('SQL: Owner approves, Finance pays, the CRM shows only your own, nothing is ever sent to a bank', () => {
  const sql = read('supabase/salary-forward.sql').replace(/--.*$/gm, '');
  assert.match(sql, /when 'salary'\s+then v_role in \('owner', 'finance'\)/);
  assert.match(sql, /when 'salary_approve' then v_role = 'owner'/);
  for (const f of ['admin_payroll_approve', 'admin_payroll_unapprove', 'admin_payroll_undo_paid', 'admin_payroll_settings_save', 'admin_payroll_person_save']) {
    const body = sql.slice(sql.indexOf(`function public.${f}(`), sql.indexOf('$fn$;', sql.indexOf(`function public.${f}(`)));
    assert.match(body, /admin_require\('salary_approve'\)/, f);
  }
  assert.match(sql, /v_me uuid := auth\.uid\(\);/);
  assert.doesNotMatch(sql, /razorpay|payout|api\.razorpay/i, 'no money moves from here');
  assert.match(sql, /create trigger payroll_incentive_guard\s+before update of status on public\.sales_incentives/);
  const back = read('supabase/salary-ROLLBACK.sql');
  assert.match(back, /drop trigger if exists payroll_incentive_guard/);
  assert.doesNotMatch(back.replace(/--.*$/gm, ''), /drop table/, 'the rollback keeps every salary record');
});
