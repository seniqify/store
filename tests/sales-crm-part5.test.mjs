// Sales CRM part 5 (founder, 2026-11-25): "specific training like manager only
// sees manager training and have that type of exam and training, so as for
// call executive and same for field executive ... a role of meta expert which
// we are gonna hire ... whose job is to verify the lead and add it in the
// lead but doesn't have access like manager". Answers: hot ad leads do not
// wait for the check; the role is "Ads & leads executive"; "they should get a
// small amount". Pure rules and wiring here; the SQL runs on PGlite outside
// this suite (386 checks, rollback included).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import {
  KPI_DEFS, scorePerson, kpiTarget, incentiveRule, incentiveRuleLines, RECOMMENDED_INCENTIVE,
  VERIFY_RESULTS, waitsForCheck, toCheck, waitedLabel, AD_SOURCES,
} from '../src/crm/crmLogic.js';
import { MODULES, TRACKS, TRACK_LABEL, modulesFor } from '../src/crm/crmTraining.js';
import { MENUS } from '../src/crm/crmStyles.js';
import { ROLE_LABEL } from '../src/crm/crmContext.js';
import { MESSAGES } from '../src/crm/crmScripts.js';
import { POLICY_HINTS } from '../src/crm/crmFaq.js';
import { PRICE } from '../src/utils/planLimits.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const code = (s) => s.replace(/--.*$/gm, '');
const body = (f, name) => { const i = f.indexOf(`function public.${name}(`); assert.ok(i >= 0, name); return f.slice(i, f.indexOf('$fn$;', i)); };
const SHOTS = JSON.parse(read('src/crm/trainingShots.json'));

test('the role: label, menu, and nothing a manager has', () => {
  assert.equal(ROLE_LABEL.ads, 'Ads & leads executive');
  const paths = MENUS.ads.map(([p]) => p);
  assert.deepEqual(paths.slice(0, 4), ['', 'check', 'add', 'sources'], 'the phone tabs: Today, Check leads, Add leads, Lead sources');
  for (const p of ['performance', 'incentives', 'attendance', 'training', 'help']) assert.ok(paths.includes(p), p);
  for (const p of ['assign', 'team', 'settings', 'reports', 'visits', 'queue', 'checkin', 'leads', 'followups']) assert.ok(!paths.includes(p), `not ${p}`);
  const app = read('src/crm/CrmApp.jsx');
  assert.match(app, /path="check" element=\{isManager \|\| isAds \? \(needsTraining \? <TrainingFirst \/> : <CrmCheckLeads \/>\) : home\}/);
  assert.match(app, /path="sources" element=\{isManager \|\| isAds \? <CrmSources \/> : home\}/);
  for (const r of ['assign', 'team', 'visits', 'settings', 'reports']) assert.match(app, new RegExp(`path="${r}" element=\\{isManager \\?`), r);
  const staffFn = read('supabase/functions/sales-staff/index.ts');
  assert.match(staffFn, /const ROLES = \['manager', 'caller', 'field', 'ads'\];/);
  assert.match(staffFn, /if \(person\.role === 'manager'\) return json/, 'still never resets a manager’s password');
});

test('nobody gives a lead to the Ads & leads team (screens)', () => {
  for (const f of ['src/crm/CrmAssign.jsx', 'src/crm/CrmAddLead.jsx', 'src/crm/CrmImport.jsx']) assert.match(read(f), /s\.active && s\.role !== 'ads'/, f);
  const rules = read('src/crm/CrmRules.jsx');
  assert.match(rules, /s\.role !== 'manager' && s\.role !== 'ads'/);
  assert.match(rules, /s\.user_id === u && s\.role !== 'ads'/, 'an old pool entry is dropped');
  const add = read('src/crm/CrmAddLead.jsx');
  assert.match(add, /assigned_to: !isAds && f\.assigned_to/, 'their leads have no owner');
  assert.match(read('src/crm/CrmAssign.jsx'), /!waitsForCheck\(l, staff\)\)\.map\(\(l\) => l\.id\)/, 'the manager’s rules skip unchecked imports');
});

test('checking leads: results, what waits, what is shown', () => {
  assert.deepEqual(Object.keys(VERIFY_RESULTS), ['verified', 'spam', 'wrong_number', 'duplicate', 'not_business']);
  const staff = [{ user_id: 'a', role: 'ads' }, { user_id: 'c', role: 'caller' }];
  const lead = { verify_status: null, assigned_to: null, stage: 'new', created_by: 'a' };
  assert.equal(waitsForCheck(lead, staff), true, 'an unchecked import by Ads & leads waits');
  assert.equal(waitsForCheck({ ...lead, verify_status: 'verified' }, staff), false);
  assert.equal(waitsForCheck({ ...lead, assigned_to: 'c' }, staff), false);
  assert.equal(waitsForCheck({ ...lead, created_by: 'c' }, staff), false, 'a caller’s lead never waits');
  assert.equal(waitsForCheck({ ...lead, stage: 'lost' }, staff), false);
  const list = toCheck([
    { id: 1, verify_status: null, stage: 'new', created_at: '2026-11-25T05:00:00Z' },
    { id: 2, verify_status: 'spam', stage: 'lost', created_at: '2026-11-25T06:00:00Z' },
    { id: 3, verify_status: null, stage: 'won', created_at: '2026-11-25T07:00:00Z' },
    { id: 4, verify_status: null, stage: 'contacted', created_at: '2026-11-25T08:00:00Z' },
  ]);
  assert.deepEqual(list.map((l) => l.id), [4, 1], 'unchecked and open, newest first');
  const t = Date.parse('2026-11-25T10:00:00Z');
  assert.equal(waitedLabel('2026-11-25T09:56:00Z', t), '4 min');
  assert.equal(waitedLabel('2026-11-25T07:00:00Z', t), '3 h');
  assert.equal(waitedLabel('2026-11-22T10:00:00Z', t), '3 days');
  assert.deepEqual([...AD_SOURCES].sort(), ['facebook', 'google', 'instagram', 'website', 'whatsapp']);
  const screen = read('src/crm/CrmCheckLeads.jsx');
  assert.match(screen, /verifyLead\(l\.id, status/);
  assert.match(screen, /autoAssign\(ready\.map/);
  assert.ok(!/orders|store_views|stores\b/.test(screen.replace(/\/\/.*$/gm, '')), 'no shop data on the screen');
});

test('the score for Ads & leads', () => {
  const keys = KPI_DEFS.ads.map((d) => d.key);
  assert.deepEqual(keys, ['checked_per_day', 'fast_pct', 'demo_rate_pct', 'added', 'paid']);
  const row = { role: 'ads', checked: 40 * 20, days_present: 20, checked_fast: 80, checked_ad: 100, verified_demo: 25, verified_total: 100, new_leads: 150, verified_paid: 4 };
  const p = scorePerson(row, { share: 1 });
  assert.equal(p.score, 100, 'on target everywhere');
  assert.equal(p.kpa.discipline, null, 'no discipline area for this role');
  const half = scorePerson({ ...row, checked: 20 * 20 }, { share: 1 });
  assert.equal(half.kpis.find((k) => k.key === 'checked_per_day').pct, 50);
  assert.equal(kpiTarget(KPI_DEFS.ads[0], { role: 'ads', daily_target: 60 }), 60, 'Team’s “Leads checked a day” is the target');
  assert.equal(kpiTarget(KPI_DEFS.ads[4], { role: 'ads' }, PRICE.monthly, { ads: { paid: 6 } }), 6, 'team target from Settings');
  const perf = read('src/crm/CrmPerformance.jsx');
  assert.match(perf, /board\.filter\(\(p\) => p\.row\.role !== 'ads'\)\.reduce/, 'team totals count sellers only (no double counting)');
});

test('their small incentive: Rs 50 / Rs 250 by default, from Settings, same 30-day rule', () => {
  assert.equal(RECOMMENDED_INCENTIVE.verifier_monthly, 50);
  assert.equal(RECOMMENDED_INCENTIVE.verifier_yearly, 250);
  assert.equal(incentiveRule({ verifier_monthly: 80 }).verifier_monthly, 80);
  const lines = incentiveRuleLines({ hold_days: 30 }, 'ads').join(' ');
  assert.match(lines, /₹50 for each shop that pays for the monthly plan, ₹250 for the yearly plan, when it came from a lead you checked/);
  assert.match(lines, /still paying 30 days later/);
  assert.ok(!/own link or code/.test(lines), 'not the seller’s rule');
  assert.match(read('src/crm/CrmSettings.jsx'), /id="i-vm"[\s\S]*verifier_monthly[\s\S]*id="i-vy"/);
  const inc = read('src/crm/CrmIncentives.jsx');
  assert.match(inc, /setIncentive\(r\.lead_id, status, null, r\.staff_id\)/, 'one person’s row at a time');
  assert.match(inc, /key=\{`\$\{r\.lead_id\}:\$\{r\.staff_id\}`\}/);
  assert.match(read('src/crm/crmService.js'), /if \(staffId\) args\.p_staff = staffId;/);
});

test('training by role: each track, only its sections, every picture exists', () => {
  assert.deepEqual(Object.keys(TRACKS).sort(), ['ads', 'caller', 'field', 'manager']);
  for (const r of Object.keys(TRACKS)) assert.ok(TRACK_LABEL[r], r);
  const keys = new Set(MODULES.map((m) => m.key));
  for (const [r, ks] of Object.entries(TRACKS)) {
    for (const k of ks) assert.ok(keys.has(k), `${r}: ${k}`);
    assert.equal(ks[0], 'product', `${r} starts with the product`);
    assert.equal(ks[ks.length - 1], 'rules', `${r} ends with the rules`);
    for (const m of modulesFor(r)) {
      assert.ok(m.sections.length >= 3, `${r}/${m.key} sections`);
      for (const s of m.sections) assert.ok(!s.roles || s.roles.includes(r), `${r}/${m.key} shows only its sections`);
      for (const s of m.sections.filter((x) => x.shot)) {
        assert.ok(SHOTS[s.shot], `${s.shot} in trainingShots.json`);
        assert.ok(existsSync(new URL(`../public/crm-training/${s.shot}.webp`, import.meta.url)), `${s.shot}.webp`);
        assert.equal(SHOTS[s.shot].marks.length, (s.steps || []).length, `${s.shot}: one step per marker`);
      }
    }
  }
  for (const k of ['payment', 'first30', 'practice']) for (const r of ['caller', 'field']) assert.ok(TRACKS[r].includes(k), `${r} ${k}`);
  for (const k of ['mgr_team', 'mgr_leads', 'mgr_visits', 'mgr_wins', 'mgr_people', 'mgr_settings']) assert.ok(TRACKS.manager.includes(k), k);
  for (const k of ['ads_job', 'ads_check', 'ads_add', 'ads_quality', 'ads_incentive']) assert.ok(TRACKS.ads.includes(k), k);
  assert.ok(!TRACKS.ads.includes('field') && !TRACKS.caller.includes('field') && TRACKS.field.includes('field'));
  const day = (r) => modulesFor(r).find((m) => m.key === 'day');
  assert.ok(day('caller').sections.every((s) => !/field executive/i.test(s.h || '')), 'callers do not read the field day');
  assert.ok(day('field').sections.some((s) => s.shot === 'today_field'));
  assert.ok(modulesFor('caller').find((m) => m.key === 'first_call').sections.some((s) => s.shot === 'queue'));
  assert.ok(!modulesFor('field').find((m) => m.key === 'first_call').sections.some((s) => s.shot === 'queue'), 'the field team does not get the call queue');
  assert.ok(modulesFor('ads').find((m) => m.key === 'ads_incentive').sections.some((s) => s.widget === 'incentive'));
  assert.match(read('src/crm/CrmTraining.jsx'), /role=\{role === 'ads' \? 'ads' : undefined\}/, 'the Ads & leads pictures');
});

test('the plan is paid on pocketlink.store/plans: no “payment link” anywhere', () => {
  const all = JSON.stringify(MODULES) + read('src/crm/crmScripts.js') + read('src/crm/crmFaq.js');
  assert.ok(!/payment link/i.test(all.replace(/A payment link from the CRM/g, '')), 'the wording is fixed everywhere');
  assert.ok(!/\{payment link\}/.test(all));
  assert.ok(MESSAGES.some((m) => m.text.includes('https://www.pocketlink.store/plans')));
  assert.match(POLICY_HINTS.cash, /pocketlink\.store\/plans/);
  const pay = MODULES.find((m) => m.key === 'payment');
  assert.ok(JSON.stringify(pay).includes('pocketlink.store/plans'));
  assert.ok(read('src/App.jsx').includes("path=\"/plans\""), 'the page exists');
  const sql = read('supabase/sales-crm-part5-forward.sql');
  assert.match(sql, /set question = 'A customer wants to pay you in cash for the plan\. What do you do\?'/);
  assert.match(sql, /Ask them to pay at pocketlink\.store\/plans/);
});

test('part 5 SQL: the role, checks, guard v4, the checker incentive, exams by role', () => {
  const f = code(read('supabase/sales-crm-part5-forward.sql'));
  assert.match(f, /check \(role in \('manager', 'caller', 'field', 'ads'\)\)/);
  const guard = body(f, 'sales_leads_guard');
  assert.match(guard, /s\.role = 'ads'[\s\S]*raise exception 'leads are not given to the Ads & leads team'/, 'checked before the login test: applies to every path');
  assert.ok(guard.indexOf("s.role = 'ads'") < guard.indexOf("if current_user = 'authenticated'"));
  assert.match(guard, /new\.verify_status := old\.verify_status;/);
  assert.match(guard, /new\.verified_by := null;/, 'nobody inserts a check result');
  const verify = body(f, 'sales_verify_lead');
  assert.match(verify, /not coalesce\(v_lead\.source in/, 'a lead with no creator is not a loophole (NULL)');
  assert.match(verify, /stage\s+= case when p_status <> 'verified' and l\.stage <> 'won' then 'lost'/);
  assert.ok(!/public\.(orders|store_views)\b/.test(f), 'part 5 never touches the orders tables');
  assert.match(body(f, 'sales_pick_owner'), /s\.role <> 'ads'/);
  assert.match(f, /primary key \(lead_id, staff_id\)/);
  const win = body(f, 'sales_win_from_payment');
  assert.match(win, /sales_incentive_add\(v_lead\.id, v_lead\.verified_by, [\s\S]*'verified', v_at\)/);
  assert.match(body(f, 'sales_incentive_add'), /verifier_monthly[\s\S]*else 50 end/);
  assert.match(body(f, 'sales_incentive_check'), /where lead_id = r\.lead_id and staff_id = r\.staff_id/);
  const start = body(f, 'sales_exam_start');
  assert.match(start, /v_role = any \(roles\) order by random\(\) limit 9/);
  assert.ok(!/'answer'/.test(start), 'answers never leave the database');
  assert.match(f, /create or replace function public\.sales_incentive_set\(p_lead uuid, p_status text, p_note text default null, p_staff uuid default null\)/, 'the part 4 call still works');
  assert.match(body(f, 'sales_signoff'), /qualified_at is not null/, 'sign-off only after the exam');
  const rb = read('supabase/sales-crm-part5-ROLLBACK.sql');
  assert.match(rb, /delete from public\.sales_incentives where basis = 'verified';/);
  assert.match(rb, /update public\.sales_staff set role = 'caller', active = false where role = 'ads';/);
});
