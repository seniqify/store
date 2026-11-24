// Sales CRM (founder, 2026-11-23/24: "create a very strong and good CRM ...
// crm.pocketlink.store ... dont show any store, order or anything that is
// related to admin ... field ... sales calling executive and manager").
// The SQL itself is exercised on a real Postgres (PGlite) outside this suite;
// here: the pure rules, the SQL's safety properties, the host routing, wiring.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  istDate, istInstant, addDays, weekday, istTime, dueLabel, phone10, prettyPhone, telHref, waHref,
  forwardStage, callResult, buildQueue, followupColumns, splitEvenly, dayStatus, monthCalendar, attendancePercent,
  leaveDaySet, whenPresets, hoursLabel,
} from '../src/crm/crmLogic.js';
import { isCrmHost } from '../src/crm/crmHost.js';
import { createMiddleware } from '../middleware.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const code = (s) => s.replace(/--.*$/gm, '');

// 2026-11-23 15:30 IST = 10:00 UTC.
const NOW = Date.parse('2026-11-23T10:00:00Z');

test('India dates: IST day, instants, weekdays, labels', () => {
  assert.equal(istDate(Date.parse('2026-11-23T18:29:00Z')), '2026-11-23');
  assert.equal(istDate(Date.parse('2026-11-23T18:31:00Z')), '2026-11-24', 'after midnight IST is the next day');
  assert.equal(new Date(istInstant('2026-11-23', 9, 30)).toISOString(), '2026-11-23T04:00:00.000Z');
  assert.equal(addDays('2026-11-30', 1), '2026-12-01');
  assert.equal(weekday('2026-11-01'), 0, '1 Nov 2026 is a Sunday');
  assert.equal(istTime('2026-11-23T04:00:00Z'), '9:30 am');
  assert.equal(istTime('2026-11-23T12:34:00Z'), '6:04 pm');
  assert.equal(dueLabel('2026-11-21T05:00:00Z', NOW), '2 days late');
  assert.equal(dueLabel('2026-11-23T11:30:00Z', NOW), 'today 5:00 pm');
  assert.equal(dueLabel('2026-11-23T05:00:00Z', NOW), 'late · 10:30 am');
  assert.equal(dueLabel('2026-11-24T05:30:00Z', NOW), 'tomorrow 11:00 am');
  assert.equal(dueLabel('2026-11-26T05:30:00Z', NOW), 'Thu 26 Nov');
  assert.equal(hoursLabel('2026-11-23T04:00:00Z', '2026-11-23T11:40:00Z'), '7 h 40 m');
});

test('phones: last 10 digits, links', () => {
  assert.equal(phone10('+91 98224 61530'), '9822461530');
  assert.equal(phone10('12345'), '');
  assert.equal(prettyPhone('919822461530'), '98224 61530');
  assert.equal(telHref('9822461530'), 'tel:+919822461530');
  assert.equal(waHref('9822461530', 'Hi'), 'https://wa.me/919822461530?text=Hi');
});

test('stages never slide back by accident; won and lost always apply', () => {
  assert.equal(forwardStage('demo', 'contacted'), 'demo');
  assert.equal(forwardStage('new', 'contacted'), 'contacted');
  assert.equal(forwardStage('interested', 'won'), 'won');
  assert.equal(forwardStage('lost', 'interested'), 'interested', 'a lost lead can be revived');
});

test('call outcomes: what happens to the lead', () => {
  const lead = { stage: 'new', call_attempts: 0 };
  const na = callResult(lead, 'no_answer', {}, NOW);
  assert.equal(na.stage, null);
  assert.equal(Date.parse(na.nextAt), NOW + 2 * 3600000, 'no answer: back in 2 hours');
  const na3 = callResult({ stage: 'new', call_attempts: 2 }, 'no_answer', {}, NOW);
  assert.match(na3.next, /Not reachable/);
  assert.equal(na3.nextAt, new Date(whenPresets(NOW).in3days).toISOString(), 'third miss: try again in 3 days');
  const busy = callResult(lead, 'busy', { when: whenPresets(NOW).evening }, NOW);
  assert.equal(busy.stage, 'contacted');
  assert.equal(busy.nextAt, '2026-11-23T12:30:00.000Z', 'this evening = 6 pm IST');
  assert.equal(callResult({ stage: 'demo' }, 'busy', {}, NOW).stage, 'demo', 'busy does not undo a demo');
  assert.throws(() => callResult(lead, 'demo', {}, NOW), /demo time/);
  const demo = callResult(lead, 'demo', { demoAt: Date.parse('2026-11-25T05:30:00Z'), demoHow: 'Video call' }, NOW);
  assert.deepEqual([demo.stage, demo.next], ['demo', 'Demo · Video call']);
  assert.deepEqual(callResult(lead, 'not_interested', { lostReason: 'Too costly' }, NOW), { outcome: 'not_interested', stage: 'lost', nextAt: null, next: null, lost: 'Too costly' });
  assert.equal(callResult(lead, 'wrong_number', {}, NOW).lost, 'Wrong number');
  assert.equal(callResult(lead, 'won', {}, NOW).stage, 'won');
  assert.equal(whenPresets(Date.parse('2026-11-23T12:20:00Z')).evening, Date.parse('2026-11-23T12:20:00Z') + 2 * 3600000, 'past 5:30 pm: "this evening" is 2 hours on');
});

test('the call queue: due first, then later today, new, coming up; closed leads never', () => {
  const L = (id, at, extra = {}) => ({ id, stage: 'contacted', next_action_at: at, last_activity_at: '2026-11-20T00:00:00Z', created_at: '2026-11-01T00:00:00Z', ...extra });
  const q = buildQueue([
    L('late', '2026-11-21T05:00:00Z'), L('due', '2026-11-23T09:00:00Z'), L('later', '2026-11-23T12:00:00Z'),
    L('tomorrow', '2026-11-24T05:00:00Z'), L('fresh', null, { stage: 'new', last_activity_at: null, created_at: '2026-11-22T00:00:00Z' }),
    L('fresh2', null, { stage: 'new', last_activity_at: null, created_at: '2026-11-23T00:00:00Z' }),
    L('won', '2026-11-21T05:00:00Z', { stage: 'won' }), L('lost', null, { stage: 'lost', last_activity_at: null }),
    L('touched-no-date', null),
  ], NOW);
  assert.deepEqual(q.now.map((l) => l.id), ['late', 'due']);
  assert.deepEqual(q.later.map((l) => l.id), ['later']);
  assert.deepEqual(q.fresh.map((l) => l.id), ['fresh2', 'fresh'], 'newest new lead first');
  assert.deepEqual(q.ahead.map((l) => l.id), ['tomorrow']);
});

test('follow-up board and even split', () => {
  const c = followupColumns([
    { id: 'a', stage: 'demo', next_action_at: '2026-11-20T05:00:00Z' },
    { id: 'b', stage: 'demo', next_action_at: '2026-11-23T12:00:00Z' },
    { id: 'c', stage: 'demo', next_action_at: '2026-11-24T05:00:00Z' },
    { id: 'd', stage: 'demo', next_action_at: '2026-11-28T05:00:00Z' },
    { id: 'e', stage: 'demo', next_action_at: '2026-12-15T05:00:00Z' },
    { id: 'f', stage: 'won', next_action_at: '2026-11-20T05:00:00Z' },
  ], NOW);
  assert.deepEqual(Object.fromEntries(Object.entries(c).map(([k, v]) => [k, v.map((l) => l.id)])), { late: ['a'], today: ['b'], tomorrow: ['c'], week: ['d'] });
  assert.deepEqual(splitEvenly(['1', '2', '3', '4', '5'], ['s', 'a', 'p']), { s: ['1', '4'], a: ['2', '5'], p: ['3'] });
  assert.deepEqual(splitEvenly(['1'], []), {});
});

test('attendance: weekly off, holiday, leave, absent, late, half day, present, override', () => {
  const staff = { user_id: 'u', shift_start: '09:30:00', weekly_off: 0 };
  const today = '2026-11-23';
  const base = { today, staff, holidays: new Set(['2026-11-09']), leaveDays: new Set(['2026-11-19']) };
  const row = (inAt, outAt, extra = {}) => ({ first_seen_at: inAt, last_seen_at: outAt, ...extra });
  assert.equal(dayStatus({ ...base, day: '2026-11-22', row: null }), 'off', 'Sunday');
  assert.equal(dayStatus({ ...base, day: '2026-11-09', row: null }), 'holiday');
  assert.equal(dayStatus({ ...base, day: '2026-11-19', row: null }), 'leave');
  assert.equal(dayStatus({ ...base, day: '2026-11-24', row: null }), 'future');
  assert.equal(dayStatus({ ...base, day: '2026-11-20', row: null }), 'absent');
  assert.equal(dayStatus({ ...base, day: today, row: null }), 'today', 'today, not in yet');
  assert.equal(dayStatus({ ...base, day: '2026-11-20', row: row('2026-11-20T04:10:00Z', '2026-11-20T12:00:00Z') }), 'present', '9:40 in, within 15 minutes');
  assert.equal(dayStatus({ ...base, day: '2026-11-20', row: row('2026-11-20T04:20:00Z', '2026-11-20T12:00:00Z') }), 'late', '9:50 in');
  assert.equal(dayStatus({ ...base, day: '2026-11-20', row: row('2026-11-20T04:00:00Z', '2026-11-20T07:00:00Z') }), 'half', '3 hours');
  assert.equal(dayStatus({ ...base, day: today, row: row('2026-11-23T04:00:00Z', '2026-11-23T05:00:00Z') }), 'present', 'today is never a half day yet');
  assert.equal(dayStatus({ ...base, day: '2026-11-20', row: row(null, null, { status_override: 'leave' }) }), 'leave', 'manager override wins');
  assert.equal(dayStatus({ ...base, day: '2026-11-20', staff: { ...staff, shift_start: '10:00' }, row: row('2026-11-20T04:40:00Z', '2026-11-20T13:00:00Z') }), 'present', 'field shift 10:00, in 10:10');
  assert.deepEqual([...leaveDaySet([{ staff_id: 'u', status: 'approved', from_day: '2026-11-30', to_day: '2026-12-02' }, { staff_id: 'u', status: 'pending', from_day: '2026-11-25', to_day: '2026-11-25' }], 'u')],
    ['2026-11-30', '2026-12-01', '2026-12-02']);
});

test('month calendar: November 2026 has 23 working days with Sundays off and two holidays', () => {
  const staff = { user_id: 'u', shift_start: '09:30', weekly_off: 0 };
  const rows = [
    { staff_id: 'u', day: '2026-11-02', first_seen_at: '2026-11-02T03:55:00Z', last_seen_at: '2026-11-02T12:30:00Z' },
    { staff_id: 'u', day: '2026-11-03', first_seen_at: '2026-11-03T04:40:00Z', last_seen_at: '2026-11-03T12:30:00Z' },
    { staff_id: 'other', day: '2026-11-04', first_seen_at: '2026-11-04T03:55:00Z', last_seen_at: '2026-11-04T12:30:00Z' },
  ];
  const cal = monthCalendar({ year: 2026, month: 11, today: '2026-11-05', staff, rows, holidays: [{ day: '2026-11-09' }, { day: '2026-11-10' }],
    leaves: [{ staff_id: 'u', status: 'approved', from_day: '2026-11-04', to_day: '2026-11-04' }] });
  assert.equal(cal.cells.filter((c) => c === null).length, 6, 'Monday-first grid: 1 Nov (Sunday) is in the 7th column');
  assert.equal(cal.workingDays, 23);
  assert.equal(cal.counts.off, 5);
  assert.equal(cal.counts.holiday, 2);
  assert.deepEqual([cal.counts.present, cal.counts.late, cal.counts.leave, cal.counts.absent], [1, 1, 1, 0], "another person's row is not counted");
  assert.equal(cal.workedSoFar, 3, '2-4 Nov; the 5th is today with no login yet, so not counted');
  assert.equal(attendancePercent(cal.counts, cal.workedSoFar, cal.leaveSoFar), 100, 'present + late over days passed minus approved leave');
  assert.equal(attendancePercent({ present: 1, late: 0, half: 1, leave: 0 }, 4, 0), 38, 'half a day counts half; an absent day counts nothing');
});

// ── SQL safety ─────────────────────────────────────────────────────────────
const FWD = read('supabase/sales-crm-forward.sql');
const IMP = read('supabase/sales-crm-import.sql');
const RB = read('supabase/sales-crm-ROLLBACK.sql');

test('the CRM never touches shop, order or admin tables', () => {
  for (const [name, sql] of [['forward', FWD], ['import', IMP]]) {
    const c = code(sql);
    assert.doesNotMatch(c, /\b(alter|drop|delete from|update|truncate)\s+(table\s+)?public\.(stores|orders|store_views|crm_team|crm_leads|pending_signups)\b/i, name);
    assert.doesNotMatch(c, /on public\.(stores|orders|store_views)\b/i, `${name}: no policy or grant on shop tables`);
    assert.doesNotMatch(c, /is_crm_member/, `${name}: does not reuse the Hub's membership test`);
  }
});

test('every CRM function pins its search_path; anon gets nothing', () => {
  const c = code(FWD);
  const fns = [...c.matchAll(/create or replace function (public\.sales_\w+)\(/g)].map((m) => m[1]);
  assert.ok(fns.length >= 10);
  const blocks = c.split(/create or replace function /).slice(1);
  for (const b of blocks) assert.match(b, /set search_path = public, pg_temp/, b.slice(0, 40));
  assert.doesNotMatch(c, /grant [^;]* to [^;]*\banon\b/i);
  for (const t of ['sales_staff', 'sales_leads', 'sales_activities', 'sales_attendance', 'sales_holidays', 'sales_leave']) {
    assert.match(c, new RegExp(`alter table public\\.${t} enable row level security;`), t);
    assert.match(c, new RegExp(`revoke all on public\\.${t} from public, anon, authenticated;`), t);
  }
});

test('executives see only their own leads and cannot move them; managers see all', () => {
  const c = code(FWD);
  assert.match(c, /create policy sales_leads_read[\s\S]*?using \(public\.sales_is_manager\(\) or \(public\.sales_is_staff\(\) and assigned_to = auth\.uid\(\)\)\)/);
  assert.match(c, /only a manager can move a lead/);
  assert.match(c, /create policy sales_leads_remove[\s\S]*?using \(public\.sales_is_manager\(\)\)/);
  assert.match(c, /create unique index if not exists sales_leads_phone_key on public\.sales_leads \(phone\);/);
});

test('a visit needs a photo from your own folder and a location', () => {
  const c = code(FWD);
  assert.match(c, /a visit needs a photo and a location/);
  assert.match(c, /split_part\(p_photo, '\/', 1\) <> auth\.uid\(\)::text/);
  assert.match(c, /values \('sales-visits', 'sales-visits', false\)/);
  assert.match(c, /\(storage\.foldername\(name\)\)\[1\] = auth\.uid\(\)::text/);
});

test('the import skips demo, reviewer and placeholder shops and never overwrites CRM work', () => {
  const c = code(IMP);
  for (const slug of ['solapur-chaddar', 'annapurna-khanaval', 'vitthal-lodge', 'maharaja-sweets', 'glow-grace-salon', 'rupasi-sarees', 'showme']) assert.match(c, new RegExp(`'${slug}'`));
  assert.match(c, /p10 <> '9000000000'/);
  assert.equal((c.match(/on conflict do nothing;/g) || []).length, 3, 'leads: Hub, shops, pending sign-ups');
  assert.match(c, /on conflict \(user_id\) do nothing;/);
  assert.doesNotMatch(c, /\bdelete\b/i);
});

test('cutover removes only non-admin Hub members who are now CRM staff', () => {
  const c = code(read('supabase/sales-crm-cutover.sql'));
  assert.match(c, /delete from public\.crm_team t\s+where t\.role <> 'admin'\s+and exists \(select 1 from public\.sales_staff s where s\.user_id = t\.user_id\);/);
  assert.equal((c.match(/\bdelete\b/gi) || []).length, 1);
  assert.doesNotMatch(c, /crm_leads|drop /i);
});

test('the rollback removes the CRM and leaves the Hub tables alone', () => {
  const c = code(RB);
  assert.match(c, /drop table if exists public\.sales_leads;/);
  assert.doesNotMatch(c, /crm_leads|crm_team|stores|orders/);
});

// ── Host routing ───────────────────────────────────────────────────────────
test('crm.pocketlink.store is the CRM and nothing else', async () => {
  assert.equal(isCrmHost('crm.pocketlink.store'), true);
  assert.equal(isCrmHost('CRM.PocketLink.store.'), true);
  for (const h of ['www.pocketlink.store', 'pocketlink.store', 'crm.example.com', 'xcrm.pocketlink.store', '']) assert.equal(isCrmHost(h), false, h);

  const mw = createMiddleware({ env: { CUSTOM_DOMAINS_ROUTING_ENABLED: 'true' }, resolverFor: () => { throw new Error('the CRM host must never be resolved as a shop'); } });
  for (const p of ['/', '/leads', '/leads/abc', '/team', '/brandshop', '/brandshop/p/1']) {
    const r = await mw(new Request(`https://crm.pocketlink.store${p}`));
    assert.equal(new URL(r.headers.get('x-middleware-rewrite')).pathname, '/index.html', p);
  }
  for (const p of ['/api/render?path=/x', '/api/og?slug=x', '/api/sitemap', '/sitemap.xml']) {
    assert.equal((await mw(new Request(`https://crm.pocketlink.store${p}`))).status, 404, p);
  }
  const robots = await mw(new Request('https://crm.pocketlink.store/robots.txt'));
  assert.equal(await robots.text(), 'User-agent: *\nDisallow: /\n');
});

test('the app: CRM on its host and at /crm, the Hub retired to it', () => {
  const app = read('src/App.jsx');
  assert.match(app, /const CrmApp\s+= lazy\(\(\) => import\('\.\/crm\/CrmApp'\)\);/);
  assert.match(app, /isCrm \? \(\s*<Routes>\s*<Route path="\/\*" element=\{<CrmApp base="" \/>\} \/>/);
  assert.match(app, /<Route path="\/crm\/\*"\s+element=\{<CrmApp base="\/crm" \/>\} \/>/);
  assert.match(app, /<Route path="\/hub"\s+element=\{<HubMoved \/>\} \/>/);
  assert.doesNotMatch(app, /SalesHub/);
  assert.match(read('api/render.js'), /'hub', 'crm',/);
});

test('the CRM screens never read shops, orders or the Console', () => {
  for (const f of ['src/crm/crmService.js', 'src/crm/CrmApp.jsx', 'src/crm/CrmToday.jsx', 'src/crm/CrmLeads.jsx', 'src/crm/CrmQueue.jsx',
    'src/crm/CrmAttendance.jsx', 'src/crm/CrmTeam.jsx', 'src/crm/CrmCheckin.jsx', 'src/crm/CrmAssign.jsx', 'src/crm/CrmAddLead.jsx', 'src/crm/CrmFollowups.jsx']) {
    const src = read(f);
    assert.doesNotMatch(src, /from\('(stores|orders|store_views|crm_team|crm_leads|pending_signups)'\)/, f);
    assert.doesNotMatch(src, /consoleService|hubService|store_slug/, f);
  }
});

test('sales-staff: managers only, never takes over an existing login or a Console account', () => {
  const fn = read('supabase/functions/sales-staff/index.ts');
  assert.match(fn, /if \(!me \|\| !me\.active \|\| me\.role !== 'manager'\) return json\(\{ error: 'Only a manager can do this\.' \}, 403\);/);
  assert.doesNotMatch(fn, /updateUserById\(userId, \{ password \}\);\s*\n\s*\}\s*\n\s*const \{ error \} = await admin\.from\('sales_staff'\)\.insert/, 'adding an existing login never sets its password');
  assert.match(fn, /existing = true;/);
  assert.match(fn, /if \(person\.role === 'manager'\) return/);
  assert.match(fn, /from\('crm_team'\)\.select\('user_id'\)\.eq\('user_id', userId\)/);
  assert.match(fn, /if \(userId === who\.user\.id\) return/);
});
