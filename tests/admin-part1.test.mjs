// PocketLink Admin part 1 (founder, 2026-11-26: "create a admin.pocketlink.store
// where i can handle all things ... delete store, make any changes to store,
// manage their subscription ..."; mockup approved). Pure rules and wiring here;
// the SQL runs on local Postgres outside this suite (88 checks).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isAdminHost } from '../src/admin/adminHost.js';
import {
  CAN, canDo, stateOf, planLabel, paysBy, extendedEnd, extendedByYears, num, endOfIndiaDay, dateInputEnd, tabCounts, filterStores, citiesOf, toCsv, changedKeys, diffLine, daysLeft,
} from '../src/admin/adminLogic.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const code = (s) => s.replace(/--.*$/gm, '');
const body = (f, name) => { const i = f.indexOf(`function public.${name}(`); assert.ok(i >= 0, name); return f.slice(i, f.indexOf('$fn$;', i)); };

test('the admin host', () => {
  assert.equal(isAdminHost('admin.pocketlink.store'), true);
  assert.equal(isAdminHost('ADMIN.PocketLink.store.'), true);
  for (const h of ['www.pocketlink.store', 'crm.pocketlink.store', 'admin.example.com', 'xadmin.pocketlink.store', '']) assert.equal(isAdminHost(h), false, h);
  const mw = read('middleware.js');
  assert.match(mw, /if \(isCrmHost\(host\) \|\| isAdminHost\(host\)\) return crmHost\(req\);/, 'served like the CRM host: SPA, robots out, no shop endpoints');
  const app = read('src/App.jsx');
  assert.match(app, /isAdmin \? \(\s*<Routes>\s*<Route path="\/\*" element=\{<AdminApp base="" \/>\} \/>/);
  assert.match(app, /<Route path="\/admin\/\*"\s+element=\{<AdminApp base="\/admin" \/>\} \/>/);
  assert.match(read('api/render.js'), /'crm', 'admin', 'console',/, 'never rendered as a shop');
});

test('roles: the same table as the database', () => {
  // salary-forward.sql redefines admin_can last (part 1 + the two salary rows).
  const sql = code(read('supabase/salary-forward.sql'));
  const can = body(sql, 'admin_can');
  for (const [what, roles] of Object.entries(CAN)) {
    const m = can.match(new RegExp(`when '${what}'\\s+then (.+)`));
    assert.ok(m, what);
    const line = m[1];
    const dbRoles = line.includes('true') ? ['owner', 'admin', 'support', 'finance', 'viewer'] : [...line.matchAll(/'([a-z]+)'/g)].map((x) => x[1]);
    assert.deepEqual([...dbRoles].sort(), [...roles].sort(), what);
  }
  assert.equal(canDo('owner', 'delete'), true);
  assert.equal(canDo('admin', 'delete'), false);
  assert.equal(canDo('support', 'plan'), false);
  assert.equal(canDo('viewer', 'see_private'), false);
  assert.equal(canDo('nobody', 'see'), false);
});

test('states, plans and how a shop pays read plainly', () => {
  assert.equal(stateOf('renewal_missing').label, 'Renewal not received');
  assert.equal(stateOf('nonsense').label, 'Free');
  assert.equal(planLabel('premium'), 'PocketLink Pro');
  assert.equal(planLabel('free'), 'Free');
  assert.match(planLabel('business'), /old plan/);
  assert.equal(paysBy('razorpay'), 'Auto-pay');
  assert.equal(paysBy(null), 'None');
});

test('end dates: extending starts from the later of today and the current end, end of the India day', () => {
  const now = Date.parse('2026-11-26T06:00:00Z');
  assert.equal(endOfIndiaDay(now), '2026-11-26T18:29:59.000Z');
  assert.equal(extendedEnd('2026-12-31T18:29:59.000Z', 30, now), '2027-01-30T18:29:59.000Z', 'adds to a future end');
  assert.equal(extendedEnd('2026-10-01T00:00:00.000Z', 30, now), '2026-12-26T18:29:59.000Z', 'a lapsed plan starts from today');
  assert.equal(extendedEnd(null, 7, now), '2026-12-03T18:29:59.000Z');
  assert.equal(extendedByYears('2027-08-12T18:29:59.000Z', 1, now), '2028-08-12T18:29:59.000Z', '1 year = the same date next year');
  assert.equal(extendedByYears('2028-02-29T10:00:00.000Z', 1, Date.parse('2028-01-01')), '2029-02-28T18:29:59.000Z', '29 Feb becomes 28 Feb');
  assert.equal(num(124000), '1,24,000');
  assert.equal(dateInputEnd('2027-08-12'), '2027-08-12T18:29:59.000Z');
  assert.equal(dateInputEnd('12/08/2027'), null);
  assert.equal(daysLeft('2026-11-28T06:00:00Z', now), 2);
});

test('the stores list: tabs, search by name or mobile, city, sort', () => {
  const rows = [
    { slug: 'a', name: 'Aanya Boutique', state: 'ending', city: 'Solapur', owner_phone: '919876500022', created_at: '2026-01-01', orders_30: 5, sales_30: 900, plan_expires_at: '2026-12-01' },
    { slug: 'g', name: 'Ganesh Sarees', state: 'active', city: 'Pune', owner_phone: '9876500021', created_at: '2026-03-01', orders_30: 9, sales_30: 100, plan_expires_at: '2027-08-12' },
    { slug: 'r', name: 'Raj Fashion', state: 'deleted', city: 'Solapur', created_at: '2026-02-01', orders_30: 0, sales_30: 0 },
    { slug: 's', name: 'Sai Mobile', state: 'free', city: 'Solapur', created_at: '2026-05-01', orders_30: 1, sales_30: 10 },
  ];
  const c = tabCounts(rows);
  assert.equal(c.all, 3, 'All hides deleted shops');
  assert.equal(c.paying, 2);
  assert.equal(c.deleted, 1);
  assert.deepEqual(filterStores(rows, { q: 'ganesh' }).map((r) => r.slug), ['g']);
  assert.deepEqual(filterStores(rows, { q: '500022' }).map((r) => r.slug), ['a'], 'search by mobile digits');
  assert.deepEqual(filterStores(rows, { city: 'solapur' }).map((r) => r.slug), ['s', 'a']);
  assert.deepEqual(filterStores(rows, { sort: 'orders' }).map((r) => r.slug), ['g', 'a', 's']);
  assert.deepEqual(filterStores(rows, { sort: 'ending', tab: 'paying' }).map((r) => r.slug), ['a', 'g']);
  assert.deepEqual(citiesOf(rows), ['Solapur', 'Pune']);
});

test('export is safe in Excel; only changed settings are sent; the log reads plainly', () => {
  assert.equal(toCsv([['a', '=HYPERLINK("x")', 'say "hi"']]), '"a","\'=HYPERLINK(""x"")","say ""hi"""');
  assert.deepEqual(changedKeys({ businessName: 'A', city: 'Pune', tagline: undefined }, { businessName: 'A', city: 'Solapur', tagline: '' }), { city: 'Solapur' });
  assert.equal(diffLine({ city: 'Pune' }, { city: 'Solapur' }), 'city: Pune → Solapur');
  assert.match(diffLine({ plan: 'free' }, { plan: 'premium', planExpiresAt: '2027-01-01', paid_by: 'cash', amount: 14999 }), /plan: free → premium · planExpiresAt: nothing → 2027-01-01 · paid by Cash ₹14,999/);
});

test('2-step sign-in is required before anything shows, and checked by the database too', () => {
  const app = read('src/admin/AdminApp.jsx');
  assert.match(app, /if \(!me\.mfa\) return <TwoStep/);
  assert.ok(app.indexOf('if (!me.mfa)') < app.indexOf('<AdminCtx.Provider'), 'nothing renders before 2-step');
  const svc = read('src/admin/adminService.js');
  assert.match(svc, /mfa\.enroll\(\{ factorType: 'totp'/);
  assert.match(svc, /mfa\.challengeAndVerify/);
  const sql = code(read('supabase/admin-part1-forward.sql'));
  assert.match(body(sql, 'admin_mfa_ok'), /->>'aal', ''\) = 'aal2'/);
  for (const f of ['admin_stores', 'admin_store', 'admin_home', 'admin_billing', 'admin_audit_list', 'admin_store_update', 'admin_set_plan', 'admin_set_status']) {
    assert.match(body(sql, f), /perform public\.admin_require\('/, f);
  }
});

test('database safety: audit log frozen, edits limited, deletes careful, no new grants to anon', () => {
  const sql = code(read('supabase/admin-part1-forward.sql'));
  assert.match(sql, /create trigger admin_audit_no_change before update or delete on public\.admin_audit/);
  assert.match(sql, /create trigger admin_audit_no_truncate before truncate on public\.admin_audit/);
  assert.match(body(sql, 'admin_store_update'), /v_allowed text\[\] := array\['businessName', 'tagline', 'whatsappNumber', 'businessType', 'city', 'area', 'address', 'theme'\]/);
  const del = body(sql, 'admin_set_status');
  assert.match(del, /p_confirm is distinct from p_slug/);
  assert.match(del, /stop the Razorpay subscription first/);
  assert.match(del, /perform public\.admin_require\('delete'\)/);
  assert.doesNotMatch(sql, /delete from public\.stores/, 'a delete hides and closes; the row is kept');
  const grants = [...sql.matchAll(/grant ([^;]+) to ([^;]+);/g)].map((m) => m[0]);
  assert.deepEqual(grants.filter((g) => /\banon\b/.test(g)), ['grant select (admin_status) on public.stores to anon, authenticated;'], 'the only thing anon gets is the closed state');
  assert.match(body(sql, 'admin_set_plan'), /source, status, starts_at, expires_at, idempotency_key\)\s+values \(p_slug, 'premium', 'console', 'active'/, 'grants go in the plan ledger');
});

test('a paused or deleted shop is closed everywhere, and the owner cannot undo it', () => {
  const svc = read('src/utils/storeService.js');
  assert.match(svc, /\.select\('config:public_config, admin_status'\)/);
  assert.match(svc, /adminStatus: data\.admin_status \|\| null/);
  assert.match(svc, /const \{ adminStatus: _adminStatus, \.\.\.clean \} = config \|\| \{\};/, 'never saved back into config');
  assert.match(svc, /not\('admin_status', 'is', null\)/, 'left out of the Marketplace');
  const app = read('src/App.jsx');
  assert.match(app, /config\?\.adminStatus === 'paused'\) return <ShopClosed/);
  assert.match(read('src/pages/ManageStore.jsx'), /config\?\.adminStatus === 'deleted'/);
  const sm = read('api/sitemap.js');
  assert.match(sm, /select=slug,updated_at&admin_status=is\.null/);
  assert.match(read('api/render.js'), /!rows\[0\]\.admin_status/);
});

test('the 2-step QR picture survives a # colour in its SVG', async () => {
  const { safeSvgUrl } = await import('../src/admin/adminService.js').catch(() => ({}));
  if (!safeSvgUrl) return;   // the service imports the browser Supabase client; the source check below still runs
  assert.equal(safeSvgUrl('data:image/svg+xml;utf-8,<svg fill="#000"/>'), 'data:image/svg+xml;charset=utf-8,%3Csvg%20fill%3D%22%23000%22%2F%3E');
});
test('the QR encoding is wired into enrolment', () => {
  const svc = read('src/admin/adminService.js');
  assert.match(svc, /qr: safeSvgUrl\(data\.totp\?\.qr_code\)/);
  assert.match(svc, /encodeURIComponent\(m\[1\]\)/);
});
