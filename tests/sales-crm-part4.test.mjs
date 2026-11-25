// Sales CRM part 4 (founder, 2026-11-25): "Wins aren't proven ... every
// executive gets their own PocketLink sign-up link or code. When that shop
// pays, the CRM marks the lead Won with the plan and amount, automatically.
// It shows only 'paid ₹1,499', never any shop data. ... incentive is paid only
// if the shop is still paying after 30 days." Also: a designed login, a
// Settings screen, the 7 pm / weekly WhatsApp reports, training with an exam.
// Pure rules here; the SQL runs on PGlite outside this suite (220 checks).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cleanRef } from '../src/utils/salesRef.js';
import { incentiveRule, incentiveRuleLines, RECOMMENDED_INCENTIVE, weightsFrom, DEFAULT_WEIGHTS, scorePerson, kpiTarget, KPI_DEFS, dayStatus, signupLink } from '../src/crm/crmLogic.js';
import { reportPeriod, dailyValues, weeklyValues, tv, fillTemplate, DAILY_TEMPLATE, WEEKLY_TEMPLATE } from '../shared/sales-report-text.mjs';
import { MODULES, EXAM_SIZE } from '../src/crm/crmTraining.js';
import { MENUS } from '../src/crm/crmStyles.js';
import { PRICE } from '../src/utils/planLimits.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const code = (s) => s.replace(/--.*$/gm, '');

test('own sign-up codes: cleaned, and carried from the link into the new shop', () => {
  assert.equal(cleanRef(' rk-7q2m '), 'RK7Q2M');
  assert.equal(cleanRef('ab'), '', 'too short');
  assert.equal(cleanRef('ABCDEFGHIJK'), '', 'too long');
  assert.equal(signupLink('RK7Q2M'), 'https://www.pocketlink.store/start?ref=RK7Q2M');
  const start = read('src/pages/Start.jsx');
  assert.match(start, /cleanRef\(params\.get\('ref'\)\)/);
  assert.match(start, /Have a code from someone at PocketLink\?/);
  const onb = read('src/pages/Onboarding.jsx');
  assert.match(onb, /const salesRef = readSalesRef\(\);\n\s+if \(salesRef\) config = \{ \.\.\.config, salesRef \};\n[\s\S]{0,400}await saveBusiness\(config, pin, ownerPhone\);/, 'saved with the shop, before it is created');
});

test('the recommended incentive rule, and what the team reads', () => {
  assert.deepEqual({ ...RECOMMENDED_INCENTIVE }, { monthly: 300, yearly: 1500, slab_after: 10, slab_monthly: 400, slab_yearly: 2000, hold_days: 30, pay_day: 'with salary on the 5th of the next month' });
  assert.equal(incentiveRule({ per_paid: 250 }).monthly, 250, 'the old single amount still works');
  assert.equal(incentiveRule({ monthly: 350, yearly: 'x' }).yearly, 1500);
  const lines = incentiveRuleLines({}).join(' ');
  assert.match(lines, /₹300 for each shop that pays for the monthly plan, ₹1,500 for the yearly plan/);
  assert.match(lines, /From your 11th paid shop/);
  assert.match(lines, /still paying 30 days later \(checked automatically on day 34/);
  assert.match(lines, /own link or code/);
});

test('score weights and team targets come from Settings', () => {
  assert.deepEqual(weightsFrom({ weights: { activity: 10, reach: 10, conversion: 40, revenue: 30, discipline: 10 } }).conversion, 40);
  assert.deepEqual(weightsFrom({ weights: { activity: 50, reach: 10, conversion: 40, revenue: 30, discipline: 10 } }), { ...DEFAULT_WEIGHTS }, 'not 100: the usual weights');
  assert.deepEqual(weightsFrom(null), { ...DEFAULT_WEIGHTS });
  const calls = KPI_DEFS.caller.find((d) => d.key === 'calls_per_day');
  assert.equal(kpiTarget(calls, { role: 'caller' }, PRICE.monthly, { caller: { calls_per_day: 60 } }), 60);
  assert.equal(kpiTarget(calls, { role: 'caller', daily_target: 90 }, PRICE.monthly, { caller: { calls_per_day: 60 } }), 90, 'a person’s own target wins');
  const r = { role: 'caller', calls: 80, answered: 0, answered_noted: 0, days_present: 1, demos: 0, won: 0, money: 0, open_followups: 0, late_followups: 0 };
  assert.equal(scorePerson(r, { weights: { activity: 100, reach: 0, conversion: 0, revenue: 0, discipline: 0 } }).score, 100, 'only Activity weighted');
});

test('attendance rules from Settings', () => {
  const staff = { user_id: 'u', weekly_off: 0, shift_start: '09:30', created_at: '2026-11-01T00:00:00Z' };
  const row = { first_seen_at: '2026-11-24T04:20:00Z', last_seen_at: '2026-11-24T13:00:00Z' };   // in at 9:50 am
  assert.equal(dayStatus({ day: '2026-11-24', today: '2026-11-25', staff, row }), 'late', 'usual 15 min grace');
  assert.equal(dayStatus({ day: '2026-11-24', today: '2026-11-25', staff, row, rules: { grace_min: 30 } }), 'present', '30 min grace');
  assert.equal(dayStatus({ day: '2026-11-24', today: '2026-11-25', staff, row, rules: { grace_min: 30, half_day_hours: 9 } }), 'half');
});

test('WhatsApp reports: periods and safe values', () => {
  const at = Date.parse('2026-11-30T13:30:00Z');   // Monday 7 pm India time
  assert.deepEqual(reportPeriod('daily', at), { from: '2026-11-30', to: '2026-11-30' });
  assert.deepEqual(reportPeriod('weekly', at), { from: '2026-11-23', to: '2026-11-29' }, 'the week before');
  assert.equal(tv('a\nb\t  c'), 'a b c');
  assert.equal(tv(''), '-', 'never empty');
  const d = { from: '2026-11-23', to: '2026-11-30', calls: 120, answered: 70, visits: 12, demos: 6, paid: 2, collected: 2998, new_leads: 9, ad_leads: 4,
    not_called: 1, late: 7, staff: 3, days: 7, incentive_earned: 600,
    people: [{ name: 'Sneha Kulkarni', calls: 80, visits: 0, paid: 2, days_in: 6, late: 1 }, { name: 'Rahul Jadhav', calls: 2, visits: 12, paid: 0, days_in: 5, late: 6 }, { name: 'Pooja', calls: 0, visits: 0, paid: 0, days_in: 0, late: 0 }] };
  const dv = dailyValues(d);
  assert.equal(dv[7], '₹2,998');
  assert.equal(dv[11], '2 of 3');
  assert.equal(dv[12], 'Sneha (2 paid, 80 calls)');
  for (const v of Object.values(dv)) assert.ok(v && !/\n/.test(v));
  const wv = weeklyValues(d);
  assert.equal(wv[12], 'Rahul: 6 late follow-ups');
  assert.equal(wv[10], '3.7 of 7 days on average');
  assert.equal(Object.keys(dv).length, (DAILY_TEMPLATE.match(/\{\{\d+\}\}/g) || []).length);
  assert.equal(Object.keys(wv).length, (WEEKLY_TEMPLATE.match(/\{\{\d+\}\}/g) || []).length);
  assert.ok(!fillTemplate(DAILY_TEMPLATE, dv).includes('{{'));
  assert.ok(!/^\{\{|\}\}$/.test(DAILY_TEMPLATE) && !/^\{\{|\}\}$/.test(WEEKLY_TEMPLATE), 'WhatsApp: a template cannot start or end with a value');
});

test('training: ten modules, accurate prices, exam size', () => {
  assert.equal(MODULES.length, 10);
  assert.equal(new Set(MODULES.map((m) => m.key)).size, 10);
  for (const m of MODULES) assert.ok(/^[a-z0-9_]{2,40}$/.test(m.key) && m.sections.length && m.points.length, m.key);
  const all = JSON.stringify(MODULES);
  assert.ok(all.includes(`₹${PRICE.monthly.toLocaleString('en-IN')}`) && all.includes(`₹${PRICE.yearly.toLocaleString('en-IN')}`));
  assert.ok(!/₹(699|1,099)\b/.test(all), 'no old prices');
  assert.equal(EXAM_SIZE, 15);
  const sql = read('supabase/sales-crm-part4-forward.sql');
  assert.ok(sql.includes("'[\"Rs 699\",\"Rs 1,099\",\"Rs 1,499\",\"Rs 2,999\"]', 2"), 'the exam knows today’s price');
});

test('wiring: menus, routes, the training gate, the login', () => {
  const paths = (r) => MENUS[r].map(([p]) => p);
  for (const p of ['settings', 'reports', 'incentives', 'training']) assert.ok(paths('manager').includes(p), `manager ${p}`);
  for (const r of ['caller', 'field']) {
    for (const p of ['incentives', 'training']) assert.ok(paths(r).includes(p), `${r} ${p}`);
    for (const p of ['settings', 'reports']) assert.ok(!paths(r).includes(p), `${r} must not see ${p}`);
  }
  const app = read('src/crm/CrmApp.jsx');
  assert.match(app, /path="settings" element=\{isManager \? <CrmSettings \/> : <Navigate/);
  assert.match(app, /path="reports" element=\{isManager \? <CrmReports \/> : <Navigate/);
  assert.match(app, /path="queue" element=\{needsTraining \? <TrainingFirst \/> : <CrmQueue \/>\}/);
  assert.match(app, /path="checkin" element=\{needsTraining \? <TrainingFirst \/> : <CrmCheckin \/>\}/);
  assert.match(app, /Every lead, call and visit in one place\./, 'the designed sign-in');
  assert.match(app, /const AURORA = \{/, 'same look as the shop dashboard PIN screen');
});

test('part 4 SQL: link credit, 30-day rule, server-graded exam, reports', () => {
  const f = code(read('supabase/sales-crm-part4-forward.sql'));
  const cap = f.slice(f.indexOf('function public.sales_capture_signup()'), f.indexOf('$fn$;', f.indexOf('function public.sales_capture_signup()')));
  assert.match(cap, /new\.config->>'salesRef'/);
  assert.match(cap, /exception when others then\s+raise warning/, 'a sign-up never fails because of the CRM');
  const win = f.slice(f.indexOf('function public.sales_win_from_payment'), f.indexOf('$fn$;', f.indexOf('function public.sales_win_from_payment')));
  assert.match(win, /from public\.sales_referrals r where r\.store_slug = p_slug/);
  assert.match(win, /sales_incentive_add\(/);
  const add = f.slice(f.indexOf('function public.sales_incentive_add'), f.indexOf('$fn$;', f.indexOf('function public.sales_incentive_add')));
  assert.match(add, /make_interval\(days => v_hold \+ 4\)/, 'checked after the first renewal');
  const chk = f.slice(f.indexOf('function public.sales_incentive_check'), f.indexOf('$fn$;', f.indexOf('function public.sales_incentive_check')));
  assert.match(chk, /\(v_cfg->>'planExpiresAt'\)::timestamptz > p_now/, 'earned only while the shop still pays');
  const start = f.slice(f.indexOf('function public.sales_exam_start'), f.indexOf('$fn$;', f.indexOf('function public.sales_exam_start')));
  assert.ok(!/'answer'/.test(start), 'answers never leave the database');
  assert.match(f, /revoke all on public\.sales_exam_questions from public, anon, authenticated;/);
  assert.match(f, /revoke all on public\.sales_referrals from public, anon, authenticated;/, 'no shop data for CRM logins');
  const rep = f.slice(f.indexOf('function public.sales_report_data'), f.indexOf('$fn$;', f.indexOf('function public.sales_report_data')));
  assert.match(rep, /if not \(public\.sales_is_manager\(\) or v_role = 'service_role'\) then/);
  assert.ok(!/public\.(orders|store_views)\b/.test(f), 'part 4 never touches the orders tables');
  const sch = code(read('supabase/sales-crm-part4-schedule.sql'));
  assert.match(sch, /'sales-report-daily',\s+'30 13 \* \* \*'/, '7 pm India time');
  assert.match(sch, /'sales-report-weekly',\s+'30 3 \* \* 1'/, 'Monday 9 am India time');
  const fn = read('supabase/functions/sales-report/index.ts');
  assert.match(fn, /SENIQIFY_SALES_DAILY_TEMPLATE_URL/);
  assert.match(fn, /if \(!url\) skipped = 'WhatsApp template not set yet'/, 'saved, not sent, until the template is approved');
});
