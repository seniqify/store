// Sales CRM part 3 (founder, 2026-11-25: "start part 3"): leads straight from
// Google Ads, Meta lead ads and the website form; the call timer and talk
// time; win proof (a win counts when the payment is seen or the manager
// approves). Pure rules here; the SQL runs on PGlite outside this suite.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fromGoogle, metaLeadIds, fromMetaLead, fromWebsite, sameText } from '../shared/sales-lead-map.mjs';
import { callSeconds, secondsLabel, kpiValue, scorePerson, KPI_DEFS, AD_SOURCES } from '../src/crm/crmLogic.js';
import { MENUS } from '../src/crm/crmStyles.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const code = (s) => s.replace(/--.*$/gm, '');

test('Google Ads lead form: key checked, columns mapped, test data flagged', () => {
  const body = {
    lead_id: 'TeSter-123', form_id: 77, campaign_id: 99, google_key: 'k-1', is_test: false,
    user_column_data: [
      { column_id: 'FULL_NAME', string_value: 'Sunil  Patil' }, { column_id: 'PHONE_NUMBER', string_value: '+91 98111 11111' },
      { column_id: 'CITY', string_value: 'Pune' }, { column_name: 'What is your shop name?', string_value: 'Sunil Kirana' },
    ],
  };
  assert.deepEqual(fromGoogle(body, 'k-2'), { ok: false, why: 'bad key' });
  assert.deepEqual(fromGoogle(body, ''), { ok: false, why: 'bad key' }, 'no key made yet: nothing accepted');
  const g = fromGoogle(body, 'k-1');
  assert.equal(g.ok, true);
  assert.equal(g.name, 'Sunil Patil');
  assert.equal(g.phone, '+91 98111 11111');
  assert.equal(g.city, 'Pune');
  assert.equal(g.shop, 'Sunil Kirana', 'custom question about the shop');
  assert.equal(g.campaign, 'Google campaign 99');
  assert.equal(g.externalId, 'TeSter-123');
  assert.equal(fromGoogle({ ...body, is_test: true }, 'k-1').isTest, true);
  const split = fromGoogle({ google_key: 'k-1', user_column_data: [{ column_id: 'FIRST_NAME', string_value: 'Asha' }, { column_id: 'LAST_NAME', string_value: 'More' }] }, 'k-1');
  assert.equal(split.name, 'Asha More');
});

test('Meta lead ads: leadgen ids from the webhook, fields from the Graph API', () => {
  const hook = { object: 'page', entry: [{ id: 'P1', changes: [{ field: 'leadgen', value: { leadgen_id: 'L9', form_id: 'F1', ad_id: 'A1', page_id: 'P1' } }, { field: 'feed', value: {} }] }] };
  assert.deepEqual(metaLeadIds(hook), [{ leadgenId: 'L9', formId: 'F1', adId: 'A1', pageId: 'P1' }]);
  assert.deepEqual(metaLeadIds({}), []);
  const lead = { id: 'L9', platform: 'ig', campaign_name: 'Diwali reels', form_id: 'F1', field_data: [
    { name: 'full_name', values: ['Rekha Joshi'] }, { name: 'phone_number', values: ['+919822200001'] },
    { name: 'city', values: ['Solapur'] }, { name: 'your_shop_name', values: ['Rekha Sarees'] },
  ] };
  const m = fromMetaLead(lead, 'L9');
  assert.equal(m.source, 'instagram');
  assert.equal(m.name, 'Rekha Joshi');
  assert.equal(m.phone, '+919822200001');
  assert.equal(m.shop, 'Rekha Sarees');
  assert.equal(m.campaign, 'Diwali reels');
  assert.equal(fromMetaLead({ ...lead, platform: 'fb' }, 'L9').source, 'facebook');
});

test('website form: honeypot, phone and name checks', () => {
  assert.equal(fromWebsite({ name: 'Ravi', phone: '98220 12345', hp: 'http://spam' }).silent, true, 'bots get a quiet OK');
  assert.equal(fromWebsite({ name: 'Ravi', phone: '12345' }).ok, false);
  assert.equal(fromWebsite({ name: 'R', phone: '9822012345' }).ok, false);
  const w = fromWebsite({ name: ' Ravi Kale ', phone: '+91 98220 12345', shop: 'Kale Dairy', page: 'sell' });
  assert.deepEqual([w.ok, w.phone, w.name, w.shop, w.form, w.campaign], [true, '9822012345', 'Ravi Kale', 'Kale Dairy', 'Call me back', 'Page sell']);
  assert.equal(sameText('abc', 'abc'), true);
  assert.equal(sameText('abc', 'abd'), false);
  assert.equal(sameText('abc', 'abcd'), false);
});

test('call timer and talk time', () => {
  assert.equal(callSeconds(0, 3000), null, 'under 5 s: not a call');
  assert.equal(callSeconds(0, 134000), 134);
  assert.equal(callSeconds(0, 99 * 3600 * 1000), 7200, 'capped at 2 hours');
  assert.equal(secondsLabel(134), '2 m 14 s');
  assert.equal(kpiValue('minutes', 132), '2 h 12 m');
  const talk = KPI_DEFS.caller.find((d) => d.key === 'talk_min_per_day');
  assert.equal(talk.kpa, 'activity');
  const base = { role: 'caller', calls: 10, answered: 5, answered_noted: 5, days_present: 2, demos: 0, won: 0, money: 0, open_followups: 0, late_followups: 0 };
  assert.equal(scorePerson({ ...base, talk_sec: 0 }).kpis.find((k) => k.key === 'talk_min_per_day').pct, null, 'no timer data yet: left out, not 0');
  assert.equal(scorePerson({ ...base, talk_sec: 150 * 60 * 2 }).kpis.find((k) => k.key === 'talk_min_per_day').pct, 100);
  assert.deepEqual([...AD_SOURCES].sort(), ['facebook', 'google', 'instagram', 'website', 'whatsapp']);
});

test('wiring: Lead sources for managers only, alerts, timer, proof, landing form', () => {
  assert.ok(MENUS.manager.some(([p]) => p === 'sources'));
  assert.ok(!MENUS.caller.some(([p]) => p === 'sources') && !MENUS.field.some(([p]) => p === 'sources'));
  const app = read('src/crm/CrmApp.jsx');
  assert.match(app, /path="sources" element=\{isManager \? <CrmSources \/> : <Navigate/);
  assert.match(app, /<NewLeadAlert \/>/);
  assert.match(read('src/crm/CrmQueue.jsx'), /onClick=\{\(\) => startCallTimer\(current\.id\)\}/);
  assert.match(read('src/crm/CrmQueue.jsx'), /duration: r\.duration/);
  assert.match(read('src/crm/crmService.js'), /won_proof, won_proof_at'/);
  const landing = read('src/pages/Landing.jsx');
  assert.match(landing, /<CallBackForm \/>/);
  assert.match(read('src/components/CallBackForm.jsx'), /sales-lead-in\?src=web/);
  const fn = read('supabase/functions/sales-lead-in/index.ts');
  assert.match(fn, /WEB_ORIGINS = new Set\(\['https:\/\/www\.pocketlink\.store', 'https:\/\/pocketlink\.store'/);
  assert.match(fn, /fromGoogle\(body, String\(cfg\.google_key \|\| ''\)\)/, 'the Google key comes from the manager settings');
  assert.match(fn, /x-hub-signature-256/);
  assert.match(fn, /\.from\('sales_private'\)\.select\('value'\)\.eq\('key', 'meta_page_token'\)/);
});

test('part 3 SQL: only the service role puts leads in; proof only by the database', () => {
  const f = code(read('supabase/sales-crm-part3-forward.sql'));
  assert.match(f, /revoke all on function public\.sales_lead_in\([^)]*\) from public, anon, authenticated;/);
  assert.match(f, /grant execute on function public\.sales_lead_in\([^)]*\) to service_role;/);
  assert.match(f, /new\.won_proof := old\.won_proof;/, 'guard v3: no app login sets proof');
  const cap = f.slice(f.indexOf('function public.sales_capture_payment()'), f.indexOf('$fn$;', f.indexOf('function public.sales_capture_payment()')));
  assert.match(cap, /exception when others then\s+raise warning/, 'a CRM problem never blocks a payment');
  assert.match(cap, /'razorpay_subscription', 'razorpay_payment'/, 'coupons and console grants are not payments');
  const shop = f.slice(f.indexOf('function public.sales_capture_plan_paid()'), f.indexOf('$fn$;', f.indexOf('function public.sales_capture_plan_paid()')));
  assert.match(shop, /v_role = 'service_role'/, 'only the server (webhook, sync, activation) proves a payment, never a browser call');
  assert.match(shop, /exception when others then\s+raise warning/);
  assert.ok(f.includes("when ((old.config->>'planExpiresAt') is distinct from (new.config->>'planExpiresAt'))"), 'shop saves that keep the date never fire it');
  const sb = f.slice(f.indexOf('function public.sales_scoreboard'), f.indexOf('$fn$;', f.indexOf('function public.sales_scoreboard')));
  assert.match(sb, /w\.won_proof is not null/);
  assert.match(sb, /sum\(a\.duration_sec\)/);
  const win = f.slice(f.indexOf('function public.sales_win_from_payment'), f.indexOf('$fn$;', f.indexOf('function public.sales_win_from_payment')));
  assert.match(win, /a\.kind in \('call', 'visit'\) and a\.created_at <= v_at/, 'credit only for a shop that was worked before paying');
  assert.match(f, /create table if not exists public\.sales_private[\s\S]*revoke all on public\.sales_private from public, anon, authenticated;/);
  assert.ok(!/\b(orders|store_views)\b/.test(f), 'part 3 never touches orders');
  assert.match(code(read('supabase/sales-crm-part3-schedule.sql')), /cron\.schedule\('sales-rotate-slow-leads', '\*\/5 \* \* \* \*'/);
});
