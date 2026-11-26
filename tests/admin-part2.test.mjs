// PocketLink Admin part 2 (founder, 2026-11-26: "start part 2"): people and
// access, orders and delivery, reported reviews, Coins, shop PIN reset, and
// Razorpay auto-pay (stop, refund). Wiring and safety rules here; the SQL runs
// on local Postgres outside this suite (105 checks).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const code = (s) => s.replace(/--.*$/gm, '');
const body = (f, name) => { const i = f.indexOf(`function public.${name}(`); assert.ok(i >= 0, name); return f.slice(i, f.indexOf('$fn$;', i)); };
const sql = code(read('supabase/admin-part2-forward.sql'));

test('menu and routes: the part 2 screens are live', () => {
  const app = read('src/admin/AdminApp.jsx');
  for (const [p, t] of [['orders', 'Orders and delivery'], ['coins', 'Coins and WhatsApp'], ['people', 'People and access']]) {
    assert.match(app, new RegExp(`\\['${p}', '${t}'`), p);
    assert.match(app, new RegExp(`<Route path="${p}" element=\\{<Admin`), `${p} route`);
  }
});

test('people: the team rules live in the database', () => {
  const save = body(sql, 'admin_team_save');
  assert.match(save, /perform public\.admin_require\('people'\)/);
  assert.match(save, /if p_user = auth\.uid\(\) then\s+raise exception 'you cannot change your own role/);
  assert.match(save, /if v_me <> 'owner' and p_role in \('owner', 'admin'\)/);
  assert.match(save, /there must always be one active Owner/);
  assert.match(body(sql, 'admin_team_remove'), /if not public\.admin_may_manage\(p_user\)/);
  assert.match(body(sql, 'admin_may_manage'), /return v_me = 'owner' or v_tgt is null or v_tgt not in \('owner', 'admin'\);/);
  assert.match(body(sql, 'admin_hub_remove'), /the Hub admin login is not removed here/);
});

test('admin-people: checks the person through the database, only admin-team targets, Owner-only 2-step reset', () => {
  const f = read('supabase/functions/admin-people/index.ts');
  assert.match(f, /global: \{ headers: \{ Authorization: authz \} \}/, 'asks the database as the signed-in person');
  assert.match(f, /if \(!me \|\| !me\.mfa\) return json/);
  assert.match(f, /rpc\('admin_can', \{ p_what: 'people' \}\)/);
  assert.match(f, /from\('admin_team'\)\.select\('user_id, email, name'\)\.eq\('user_id', userId\)/, 'only people on the admin team');
  assert.match(f, /rpc\('admin_may_manage', \{ p_user: userId \}\)/);
  assert.match(f, /if \(me\.role !== 'owner'\) return json\(\{ error: 'Only the Owner can reset 2-step sign-in\.' \}, 403\)/);
  assert.match(f, /if \(temp\) await service\.auth\.admin\.deleteUser\(userId\);/, 'a login made for nothing is removed again');
  assert.match(f, /rpc\('admin_team_save'/, 'the team change itself goes through the database rules');
  assert.doesNotMatch(f, /console\.log\([^)]*(password|temp)/i, 'never logs a password');
});

test('admin-billing: this shop’s subscription only, Owner-only big refunds, a reason for every change', () => {
  const f = read('supabase/functions/admin-billing/index.ts');
  assert.match(f, /const need = body\.action === 'status' \? 'money' : 'plan';/);
  assert.match(f, /\(inv\.data as any\)\?\.subscription_id !== sub/, 'a refund only for a payment of this shop’s auto-pay');
  assert.match(f, /const OWNER_ONLY_ABOVE_PAISE = 500000;/);
  assert.match(f, /amount > OWNER_ONLY_ABOVE_PAISE && me\.role !== 'owner'/);
  assert.match(f, /amount > left/, 'never more than what is left on the payment');
  assert.equal((f.match(/if \(reason\.length < 3\) return json/g) || []).length, 2, 'stop and refund both need a reason');
  assert.match(f, /rpc\('admin_autopay_stopped'/);
  assert.match(f, /rpc\('admin_note', \{ p_need: 'plan', p_action: 'refund'/);
  assert.match(f, /setTimeout\(\(\) => ctl\.abort\(\), 12000\)/, 'Razorpay calls time out');
  assert.match(f, /cancel_at_cycle_end: atEnd \? 1 : 0/);
});

test('auto-pay stopped here counts everywhere', () => {
  assert.match(body(sql, 'admin_autopay_on'), /is distinct from \(p_cfg->>'razorpaySubscriptionId'\)/, 'a new subscription later is on again');
  for (const fn of ['admin_store_state', 'admin_stores', 'admin_billing', 'admin_set_status']) assert.match(body(sql, fn), /admin_autopay_on\(/, fn);
  assert.match(body(sql, 'admin_autopay_stopped'), /this is not the shop''s subscription/);
  const store = read('src/admin/AdminStore.jsx');
  assert.match(store, /s\.config\?\.autopayStopped\?\.sub !== sub/);
});

test('orders read only; reviews as the Console; Coins through the wallet; PIN as a hash', () => {
  assert.doesNotMatch(sql, /(update|delete from|insert into)\s+public\.orders/i);
  const decide = body(sql, 'admin_review_decide');
  assert.match(decide, /admin_require\('edit_store'\)/);
  assert.match(decide, /if p_decision = 'removed' and v_note is null/);
  assert.match(decide, /insert into public\.review_audit/);
  const coins = body(sql, 'admin_coins');
  assert.match(coins, /admin_require\('plan'\)/);
  assert.match(coins, /public\.wallet_adjust\(p_slug, p_coins \* 50, left\('Admin: '/);
  assert.match(coins, /the shop has only % Coins/);
  const pin = body(sql, 'admin_reset_pin');
  assert.match(pin, /\^\[0-9a-f\]\{64\}\$/);
  assert.match(pin, /delete from public\.pin_attempts where slug = p_slug and not success/);
  assert.match(pin, /admin_log\('pin_reset', 'store', p_slug, null, null, p_reason\)/, 'the hash never goes in the log');
  const svc = read('src/admin/adminService.js');
  assert.match(svc, /const \{ hashPin \} = await import\('\.\.\/utils\/pinHash\.js'\);/, 'hashed exactly like the owner’s PIN');
  assert.match(read('src/admin/AdminStore.jsx'), /crypto\.getRandomValues\(new Uint32Array\(1\)\)/, 'a random PIN');
});

test('the note writer and grants', () => {
  assert.match(body(sql, 'admin_note'), /if p_action not in \('refund', 'password', 'reset_2step', 'person_added'\)/);
  const grants = [...sql.matchAll(/grant ([^;]+) to ([^;]+);/g)].map((m) => m[0]);
  assert.ok(!grants.some((g) => /\banon\b/.test(g)), 'nothing new for anon');
  assert.match(sql, /revoke all on function public\.admin_autopay_on\(jsonb\) from public, anon, authenticated;/);
});
