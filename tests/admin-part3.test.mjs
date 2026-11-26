// PocketLink Admin part 3 (founder, 2026-11-26: "start part 3"): System and
// switches (new sign-ups, a banner on every shop dashboard, maintenance),
// scheduled jobs (Run now, Pause), server function and key checks, and
// removing a deleted shop for good after 30 days. Wiring and safety rules
// here; the SQL runs on local Postgres outside this suite (114 checks).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { cronWords, jobState, purgeState, SWITCHES, actionLabel } from '../src/admin/adminLogic.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const code = (s) => s.replace(/--.*$/gm, '');
const body = (f, name) => { const i = f.indexOf(`function public.${name}(`); assert.ok(i >= 0, name); return f.slice(i, f.indexOf('$fn$;', i)); };
const sql = code(read('supabase/admin-part3-forward.sql'));

test('menu and route: System and switches is live, nothing is "coming next"', () => {
  const app = read('src/admin/AdminApp.jsx');
  assert.match(app, /\['system', 'System and switches', 'server'\]/);
  assert.match(app, /<Route path="system" element=\{<AdminSystem \/>\} \/>/);
  assert.doesNotMatch(app, /COMING NEXT|const NEXT/);
});

test('switches: Owner only, a reason each time, the shop app reads only the flags', () => {
  const set = body(sql, 'admin_switch_set');
  assert.match(set, /perform public\.admin_require\('system'\)/);
  assert.match(set, /write a reason/);
  assert.match(set, /write the banner text first/);
  assert.match(set, /admin_log\(/);
  assert.match(sql, /grant execute on function public\.platform_flags\(\) to anon, authenticated;/);
  assert.match(sql, /revoke all on public\.platform_settings from public, anon, authenticated;/);
  const grants = [...sql.matchAll(/grant ([^;]+) to ([^;]+);/g)].map((m) => m[0]).filter((g) => /\banon\b/.test(g));
  assert.deepEqual(grants, ['grant execute on function public.platform_flags() to anon, authenticated;'], 'nothing else for anon');
  assert.deepEqual(SWITCHES.map((s) => s.key), ['signups', 'banner', 'maintenance']);
});

test('the sign-up gate: browser inserts only, never someone who already paid', () => {
  const gate = body(sql, 'stores_signup_gate');
  assert.match(gate, /if v_role not in \('anon', 'authenticated'\) then\s+return new;/);
  assert.match(gate, /from public\.pending_signups s/);
  assert.match(gate, /if public\.admin_role\(\) is not null then\s+return new;/);
  assert.match(sql, /create trigger stores_signup_gate\s+before insert on public\.stores/);
  const start = read('src/pages/Start.jsx');
  const i = start.indexOf("if (!isUpgrade) {\n        const existingSlug");
  const j = start.indexOf("setStep('paused')");
  assert.ok(i > 0 && j > i, 'checked only for a new sign-up, after the "already has a page" check');
  assert.match(start, /if \(!flags\.signupsOpen && !\(await getPendingSignup\(phone\)\.catch\(\(\) => null\)\)\)/);
  assert.doesNotMatch(read('src/pages/Plans.jsx'), /platformFlags/, 'renewals on /plans are never blocked');
});

test('the dashboard: maintenance waits before the PIN, the banner is a strip; a failed read changes nothing', () => {
  const m = read('src/pages/ManageStore.jsx');
  const maint = m.indexOf('if (flags.maintenance) {');
  assert.ok(maint > m.indexOf("config?.adminStatus === 'deleted'") && maint < m.indexOf('if (!pinVerified) {'));
  assert.match(m, /\{flags\.banner && \(\s*<div role="note"/);
  const pf = read('src/utils/platformFlags.js');
  assert.match(pf, /\.catch\(\(\) => \(\{ \.\.\.DEFAULT_FLAGS \}\)\)/);
  assert.match(pf, /signupsOpen: f\.signupsOpen !== false/, 'anything but an explicit false means open');
});

test('jobs: Owner runs or pauses, the command text never leaves the database', () => {
  for (const fn of ['admin_job_run', 'admin_job_pause']) assert.match(body(sql, fn), /admin_require\('system'\)/, fn);
  assert.doesNotMatch(body(sql, 'admin_jobs'), /'command'/);
  assert.match(body(sql, 'admin_job_run'), /exception when others then\s+v_err := left\(sqlerrm, 200\);/);
  assert.match(body(sql, 'admin_job_pause'), /cron\.alter_job\(job_id := p_job, active := p_active\)/);
  assert.equal(cronWords('30 13 * * *'), 'every day, 7:00 pm');
  assert.equal(cronWords('30 3 * * 1'), 'every Monday, 9:00 am');
  assert.equal(cronWords('0 21 * * *'), 'every day, 2:30 am');
  assert.equal(cronWords('*/15 * * * *'), 'every 15 minutes');
  assert.equal(cronWords('0 0 1 * *'), '0 0 1 * *', 'unknown shapes shown as they are');
  assert.equal(jobState({ active: false, last_status: 'failed' }).label, 'Paused');
  assert.equal(jobState({ active: true, last_status: 'failed' }).tone, 'bad');
});

test('remove for good: 30 days, Owner, typed link; orders, reviews, parcels and money are kept', () => {
  const p = body(sql, 'admin_purge_store');
  assert.match(p, /admin_require\('delete'\)/);
  assert.match(p, /interval '30 days'/);
  assert.match(p, /type the shop link to confirm/);
  assert.match(p, /own web address/);
  const list = /c_tables constant text\[\] := array\[([\s\S]*?)\];/.exec(p)[1];
  for (const kept of ['orders', 'product_reviews', 'review_reports', 'review_audit', 'shipment_attempts', 'wallet_ledger', 'wallet_topups', 'store_wallets', 'plan_entitlements', 'order_messages', 'whatsapp_consents', 'admin_audit']) {
    assert.doesNotMatch(list, new RegExp(`'${kept}'`), `${kept} is kept`);
  }
  assert.doesNotMatch(p, /delete from public\.stores/, 'the row stays as a placeholder');
  assert.doesNotMatch(list, /'marketplace_listing'|'mobile_products'/, 'views that read stores are never on the list');
  assert.match(p, /if \(select c\.relkind from pg_class c where c\.oid = to_regclass\('public\.' \|\| v_t\)\) is distinct from 'r' then\s+continue;/, 'plain tables only');
  assert.match(body(sql, 'admin_set_status'), /removed for good and cannot be opened again/);
  assert.match(body(sql, 'admin_note'), /'purge_photos'/);
  assert.equal(purgeState({ purged_at: '2026-11-01T00:00:00Z' }).key, 'purged');
  assert.equal(purgeState({ ready_at: new Date(Date.now() - 1000).toISOString() }).key, 'ready');
  assert.equal(purgeState({ ready_at: new Date(Date.now() + 3 * 86400000).toISOString() }).key, 'waiting');
  const store = read('src/admin/AdminStore.jsx');
  assert.match(store, /st === 'deleted' \? \(purged \? null : <button/, 'no Restore once removed for good');
  assert.match(store, /purgeStore\(s\.slug, typed, reason\)/);
  assert.equal(actionLabel('purged'), 'Removed a shop for good');
});

test('admin-system: database first, then photos; key values never sent; every function listed', () => {
  const f = read('supabase/functions/admin-system/index.ts');
  assert.match(f, /if \(!me \|\| !me\.mfa\) return json/);
  assert.match(f, /rpc\('admin_can', \{ p_what: 'delete' \}\)/);
  const rpcAt = f.indexOf("rpc('admin_purge_store'");
  assert.ok(rpcAt > 0 && rpcAt < f.indexOf('bucket.remove('), 'the database checks and erases before any photo goes');
  assert.match(f, /if \(error\) return json\(\{ error: error\.message \}, 400\);/);
  assert.match(f, /set: Boolean\(\(Deno\.env\.get\(name\) \|\| ''\)\.trim\(\)\)/, 'only set / not set');
  assert.match(f, /const SLUG = \/\^\[a-z0-9\]\[a-z0-9-\]\{0,63\}\$\/;/);
  assert.match(f, /method: 'OPTIONS'/);
  // Every function folder is in the ping list.
  const dirs = readdirSync(new URL('../supabase/functions/', import.meta.url))
    .filter((d) => !d.startsWith('_') && d !== 'admin-system' && statSync(new URL(`../supabase/functions/${d}`, import.meta.url)).isDirectory());
  const listed = JSON.parse(/export const FUNCTIONS = (\[[\s\S]*?\]);/.exec(f)[1].replace(/'/g, '"').replace(/,\s*\]/, ']'));
  assert.deepEqual([...listed].sort(), [...dirs].sort());
  // Every secret a function reads is in the key list (the built-in SUPABASE_* aside).
  const names = new Set();
  for (const d of dirs) {
    const src = read(`supabase/functions/${d}/index.ts`);
    for (const m of src.matchAll(/['"]([A-Z][A-Z0-9_]{5,})['"]/g)) if (/(_URL|_KEY|_SECRET|_TOKEN|_ID|_MODEL|_VERSION)$/.test(m[1]) && !m[1].startsWith('SUPABASE_')) names.add(m[1]);
  }
  const keys = new Set([...f.matchAll(/\['([A-Z0-9_]+)', '/g)].map((m) => m[1]));
  for (const n of names) assert.ok(keys.has(n), `key list has ${n}`);
});
