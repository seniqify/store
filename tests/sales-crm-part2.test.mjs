// Sales CRM part 2 (founder, 2026-11-25: "start phase 2", with screenshots of
// the side menu ending half way, attendance counting days before the CRM
// existed as absent, and check-in stuck on "Waiting for your location").
// Pure rules here; the SQL runs on a real Postgres (PGlite) outside this suite.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  dayStatus, monthCalendar, attendancePercent, KPI_DEFS, KPA, kpiTarget, periodShare, band, scorePerson, rankBoard, kpiValue,
  distanceM, photoPrint, visitFlags, parseCsv, guessColumns, planImport, fewestFirst,
} from '../src/crm/crmLogic.js';
import { SCRIPTS, OBJECTIONS, MESSAGES, BUSINESS_HOOKS, fillScript } from '../src/crm/crmScripts.js';
import { CUSTOMER_FAQ, TEAM_FAQ } from '../src/crm/crmFaq.js';
import { MENUS, PHONE_TABS } from '../src/crm/crmStyles.js';
import { PRICE } from '../src/utils/planLimits.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const code = (s) => s.replace(/--.*$/gm, '');

test('attendance starts on the day the person joined the CRM', () => {
  const staff = { user_id: 'u', weekly_off: 0, created_at: '2026-11-24T19:00:00Z' };   // 25 Nov, 00:30 IST
  assert.equal(dayStatus({ day: '2026-11-24', today: '2026-11-25', staff, row: null }), 'before');
  assert.equal(dayStatus({ day: '2026-11-22', today: '2026-11-25', staff, row: null }), 'before', 'even a weekly off before joining');
  assert.equal(dayStatus({ day: '2026-11-24', today: '2026-11-25', staff, row: { status_override: 'present' } }), 'present', 'a manager can still mark it');
  const cal = monthCalendar({ year: 2026, month: 11, today: '2026-11-25', staff, rows: [{ staff_id: 'u', day: '2026-11-25', first_seen_at: '2026-11-24T19:03:00Z' }], holidays: [], leaves: [] });
  assert.equal(cal.workingDays, 5, '25, 26, 27, 28, 30 (29 is Sunday)');
  assert.equal(cal.workedSoFar, 1);
  assert.equal(cal.counts.absent, 0, 'the screenshot showed 20 absents before the CRM existed');
  assert.equal(attendancePercent(cal.counts, cal.workedSoFar, cal.leaveSoFar), 100);
  const old = monthCalendar({ year: 2026, month: 11, today: '2026-11-25', staff: { user_id: 'u', weekly_off: 0 }, rows: [], holidays: [], leaves: [] });
  assert.equal(old.workingDays, 25, 'no created_at: every day counts, as before');
});

const row = (o = {}) => ({
  role: 'caller', name: 'Sneha', targets: {}, daily_target: null, monthly_target: null,
  calls: 0, answered: 0, answered_noted: 0, visits: 0, visits_owner: 0, visits_noted: 0, demos: 0, won: 0, money: 0,
  new_leads: 0, days_present: 0, open_followups: 0, late_followups: 0, ...o,
});

test('KPI targets: own target > column > usual; money = paid shops x price', () => {
  const calls = KPI_DEFS.caller.find((d) => d.key === 'calls_per_day');
  const money = KPI_DEFS.caller.find((d) => d.key === 'money');
  assert.equal(kpiTarget(calls, row()), 80);
  assert.equal(kpiTarget(calls, row({ daily_target: 60 })), 60);
  assert.equal(kpiTarget(calls, row({ daily_target: 60, targets: { calls_per_day: 70 } })), 70);
  assert.equal(kpiTarget(money, row(), PRICE.monthly), 10 * PRICE.monthly);
  assert.equal(kpiTarget(money, row({ monthly_target: 4 }), PRICE.monthly), 4 * PRICE.monthly);
  assert.equal(kpiTarget(money, row({ targets: { money: 20000 } }), PRICE.monthly), 20000);
  assert.deepEqual(KPA.map((a) => a.weight), [20, 15, 30, 25, 10]);
  assert.equal(KPA.reduce((s, a) => s + a.weight, 0), 100);
});

test('period share: monthly targets counted by today', () => {
  assert.equal(periodShare('2026-11-01', '2026-11-30', '2026-11-15'), 0.5);
  assert.equal(periodShare('2026-10-01', '2026-10-31', '2026-11-25'), 1);
  assert.equal(periodShare('2026-11-01', '2026-11-30', '2026-11-01'), 1 / 30, 'day one still has a small target');
});

test('score: KPI capped at 100, KPA average, weighted, no-data areas left out', () => {
  const r = row({ calls: 160, answered: 72, answered_noted: 72, days_present: 2, demos: 20, won: 10, money: 10 * PRICE.monthly, open_followups: 10, late_followups: 1 });
  const s = scorePerson(r, { share: 1, price: PRICE.monthly });
  const k = Object.fromEntries(s.kpis.map((x) => [x.key, x]));
  assert.equal(k.calls_per_day.actual, 80);
  assert.equal(k.calls_per_day.pct, 100);
  assert.equal(k.pickup_pct.pct, 100, '45% of 160 = 72: on target');
  assert.equal(k.demo_to_won_pct.pct, 100, '50% against 30%: capped');
  assert.equal(k.followups_pct.actual, 90);
  assert.equal(s.score, 100);
  const empty = scorePerson(row(), { share: 1 });
  assert.equal(empty.kpa.activity, null);
  assert.equal(empty.kpa.revenue, 0, 'nothing won is a real 0, not missing');
  const half = scorePerson(row({ won: 5, money: 5 * PRICE.monthly }), { share: 1, price: PRICE.monthly });
  assert.equal(half.kpa.revenue, 50);
  assert.equal(half.weakest.key, 'demos', 'no demos booked is the biggest gap');
  const byToday = scorePerson(row({ won: 5, money: 5 * PRICE.monthly }), { share: 0.5, price: PRICE.monthly });
  assert.equal(byToday.kpa.revenue, 100, 'half way through the month, 5 of 10 is on track');
});

test('score bands and ranking', () => {
  assert.equal(band(90).label, 'Excellent');
  assert.equal(band(89).label, 'Good');
  assert.equal(band(75).label, 'Good');
  assert.equal(band(60).label, 'Needs work');
  assert.equal(band(59).label, 'At risk');
  assert.equal(band(null).label, 'No data yet');
  const b = rankBoard([row({ name: 'B', won: 1 }), row({ name: 'A', won: 8, money: 8 * 1499 }), row({ name: 'C' })], { share: 1 });
  assert.deepEqual(b.map((p) => [p.row.name, p.rank]), [['A', 1], ['B', 2], ['C', 3]]);
  assert.equal(kpiValue('money', 8994), '₹8,994');
  assert.equal(kpiValue('pct', 44.4), '44%');
  assert.equal(kpiValue('perday', 6.44), '6.4');
  assert.equal(kpiValue('count', null), '—');
});

test('field executive KPIs come from visits', () => {
  const s = scorePerson(row({ role: 'field', visits: 16, visits_owner: 12, visits_noted: 16, days_present: 2, new_leads: 40, demos: 12 }), { share: 1 });
  const k = Object.fromEntries(s.kpis.map((x) => [x.key, x]));
  assert.equal(k.visits_per_day.actual, 8);
  assert.equal(k.met_owner_pct.actual, 75);
  assert.equal(k.new_shops.pct, 100);
  assert.ok(!k.pickup_pct, 'no call KPIs for field');
});

test('visit checks: far from the shop, weak GPS, same photo, too fast', () => {
  const at = (min) => new Date(Date.parse('2026-11-25T05:00:00Z') + min * 60000).toISOString();
  const shop = { lat: 17.6599, lng: 75.9064 };
  const v = [
    { id: 'a', lead_id: 'L1', staff_id: 'r', ...shop, accuracy_m: 20, photo_path: 'r/2026-11-20/aaaaaaaaaaaaaaaa-1.jpg', created_at: '2026-11-20T06:00:00Z' },
    { id: 'b', lead_id: 'L1', staff_id: 'r', lat: 17.6717, lng: 75.9064, accuracy_m: 20, photo_path: 'r/2026-11-25/bbbbbbbbbbbbbbbb-2.jpg', created_at: at(0) },
    { id: 'c', lead_id: 'L2', staff_id: 'r', lat: 17.80, lng: 75.9064, accuracy_m: 400, photo_path: 'r/2026-11-25/aaaaaaaaaaaaaaaa-3.jpg', created_at: at(5) },
    { id: 'd', lead_id: 'L3', staff_id: 'r', lat: 17.80, lng: 75.9064, accuracy_m: 10, photo_path: 'r/2026-11-25/cccccccccccccccc-4.jpg', created_at: at(30), review: 'rejected' },
  ];
  assert.ok(distanceM(shop, { lat: 17.6717, lng: 75.9064 }) > 1200);
  assert.equal(photoPrint('r/2026-11-25/bbbbbbbbbbbbbbbb-2.jpg'), 'bbbbbbbbbbbbbbbb');
  assert.equal(photoPrint('r/2026-11-25/0d3f-old-upload.jpg'), '', 'old uploads have no fingerprint');
  const f = visitFlags(v);
  assert.ok(!/first checked in/.test((f.a || []).join()), 'the first check-in at a shop is the reference');
  assert.match(f.a.join(), /same photo/, 'both visits with the same photo are flagged');
  assert.match(f.b.join(), /1\.3 km from where this shop was first checked in/);
  assert.match(f.c.join(), /Weak location/);
  assert.match(f.c.join(), /same photo/);
  assert.match(f.c.join(), /only 5 min later/);
  assert.ok(!f.d, 'a visit marked "do not count" is not flagged again');
});

test('import: CSV parsing, column guessing, skipping', () => {
  assert.deepEqual(parseCsv('﻿Shop,Mobile\r\n"Laxmi, Kirana",98224 61530\r\n\r\n'), [['Shop', 'Mobile'], ['Laxmi, Kirana', '98224 61530']]);
  assert.deepEqual(parseCsv('a;b\n1;2'), [['a', 'b'], ['1', '2']], 'semicolon files from Excel in some locales');
  assert.deepEqual(parseCsv('a\t"say ""hi"""'), [['a', 'say "hi"']]);
  const g = guessColumns(['Name', 'Mobile No', 'City', 'Owner Name', 'Remarks']);
  assert.equal(g.shop_name, 0); assert.equal(g.phone, 1); assert.equal(g.owner_name, 3); assert.equal(g.city, 2); assert.equal(g.note, 4);
  const g2 = guessColumns(['Business name', 'Name', 'Phone']);
  assert.equal(g2.shop_name, 0); assert.equal(g2.owner_name, 1, 'a bare Name next to a shop column is the owner');
  const rows = [['Shop', 'Mobile'], ['A', '+91 98224 61530'], ['B', '12345'], ['C', '9822461530'], ['D', '9000000001'], ['', '9876543210'], ['E', '5876543210']];
  const p = planImport(rows, { shop_name: 0, phone: 1 }, new Set(['9000000001']));
  assert.deepEqual(p.ready.map((r) => r.phone), ['9822461530']);
  assert.deepEqual(p.dupes.map((d) => [d.line, d.why]), [[4, 'Twice in this file'], [5, 'Already in the CRM']]);
  assert.deepEqual(p.bad.map((d) => [d.line, d.why]), [[3, 'Wrong mobile number'], [6, 'No shop name'], [7, 'Wrong mobile number']]);
  assert.deepEqual(fewestFirst(5, ['a', 'b'], { a: 3 }), { a: 1, b: 4 });
  assert.deepEqual(fewestFirst(3, [], {}), {});
});

test('scripts: three languages, same steps, prices from the plan, no sample names', () => {
  for (const [k, s] of Object.entries(SCRIPTS)) {
    assert.deepEqual(Object.keys(s).sort(), ['en', 'hi', 'mr'], k);
    const n = s.en.steps.length;
    for (const l of ['mr', 'hi']) assert.equal(s[l].steps.length, n, `${k} ${l}`);
  }
  for (const l of ['en', 'mr', 'hi']) assert.equal(OBJECTIONS[l].length, 7);
  const all = JSON.stringify([SCRIPTS, OBJECTIONS, MESSAGES, BUSINESS_HOOKS, CUSTOMER_FAQ, TEAM_FAQ]);
  assert.ok(all.includes(`₹${PRICE.monthly.toLocaleString('en-IN')}`) && all.includes(`₹${PRICE.yearly.toLocaleString('en-IN')}`));
  assert.ok(!/Sneha|Rahul|स्नेहा|राहुल/.test(all), 'the mockup names are replaced by {me}');
  assert.ok(!/₹(699|1,099|999)\b/.test(all), 'no old prices');
  assert.equal(fillScript('Hi {owner}, I am {me} about {shop}', { me: 'Rohit', owner: 'Ramesh' }), 'Hi Ramesh, I am Rohit about {shop}');
});

test('menus: new pages for every role, the phone shows four + More', () => {
  assert.equal(PHONE_TABS, 4);
  const paths = (r) => MENUS[r].map(([p]) => p);
  for (const r of ['caller', 'field']) {
    for (const p of ['performance', 'scripts', 'help', 'attendance']) assert.ok(paths(r).includes(p), `${r} ${p}`);
    for (const p of ['team', 'assign', 'visits']) assert.ok(!paths(r).includes(p), `${r} must not see ${p}`);
  }
  for (const p of ['performance', 'scripts', 'help', 'visits', 'team', 'assign']) assert.ok(paths('manager').includes(p), `manager ${p}`);
  const app = read('src/crm/CrmApp.jsx');
  for (const p of ['performance', 'scripts', 'help', 'account']) assert.match(app, new RegExp(`path="${p}" element=\\{<Crm`));
  assert.match(app, /path="visits" element=\{isManager \? <CrmVisits \/> : <Navigate/);
});

test('fixes from the screenshots: fixed side menu, location never waits forever', () => {
  const app = read('src/crm/CrmApp.jsx');
  assert.match(app, /fixed inset-y-0 left-0/);
  assert.ok(!app.includes('sticky top-0 h-screen'), 'sticky fails under the site-wide overflow-x: hidden');
  assert.match(app, /lg:ml-60/);
  const svc = read('src/crm/crmService.js');
  assert.match(svc, /const timer = setTimeout\(\(\) => finish\(reject/);
  assert.match(svc, /enableHighAccuracy: high/);
  const chk = read('src/crm/CrmCheckin.jsx');
  assert.match(chk, /Try the location again/);
  assert.ok(!chk.includes('Waiting for your location'));
});

test('part 2 SQL: safe sign-up capture, internal picker, aggregates only', () => {
  const f = code(read('supabase/sales-crm-part2-forward.sql'));
  for (const fn of ['sales_capture_signup', 'sales_capture_pending']) {
    const body = f.slice(f.indexOf(`function public.${fn}()`), f.indexOf('$fn$;', f.indexOf(`function public.${fn}()`)));
    assert.match(body, /exception when others then\s+raise warning/, `${fn} never blocks a sign-up`);
    assert.match(body, /security definer/);
  }
  assert.match(f, /revoke all on function public\.sales_pick_owner\(text\) from public, anon, authenticated;/);
  assert.match(f, /after insert on public\.stores/);
  assert.match(f, /after insert on public\.pending_signups/);
  assert.match(f, /if current_user = 'authenticated' then/, 'guard v2 only holds back app logins');
  const sb = f.slice(f.indexOf('function public.sales_scoreboard'), f.indexOf('$fn$;', f.indexOf('function public.sales_scoreboard')));
  const returns = sb.slice(sb.indexOf('returns table'), sb.indexOf('language plpgsql'));
  assert.ok(!/phone|shop_name|store_slug|owner_name/.test(returns), 'the scoreboard returns counts, never a lead');
  assert.match(sb, /review is distinct from 'rejected'/);
  assert.match(sb, /if not public\.sales_is_staff\(\) then/);
  assert.ok(!/\b(orders|store_views)\b/.test(f), 'part 2 never touches orders');
  const rb = code(read('supabase/sales-crm-part2-ROLLBACK.sql'));
  assert.match(rb, /drop trigger if exists sales_capture_signup on public\.stores;/);
  assert.match(rb, /auth\.uid\(\) is not null and not public\.sales_is_manager\(\)/, 'rollback restores guard v1');
});
