// Security hardening, phase 1 — checked mechanically.
//
// None of this SQL can be run from here, and the edge function is Deno, so
// these tests pin the properties a reviewer would otherwise have to hold in
// their head — and that a later edit cannot quietly undo.
//
//   supabase/security-phase-1-forward.sql    changes production
//   supabase/security-phase-1-verify.sql     one SELECT, read-only
//   supabase/security-phase-1-ROLLBACK.sql   emergency undo
//   supabase/functions/send-otp/index.ts     credentials, rate limit, safety net
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = (p) => readFileSync(`${root}${p}`, 'utf8');

const FWD      = read('supabase/security-phase-1-forward.sql');
const VERIFY   = read('supabase/security-phase-1-verify.sql');
const ROLLBACK = read('supabase/security-phase-1-ROLLBACK.sql');
const OTPFN    = read('supabase/functions/send-otp/index.ts');
const STORESVC = read('src/utils/storeService.js');

/** Strip -- comments, '...' literals and $function$...$function$ bodies. */
function stripToCode(sql) {
  let out = '';
  for (let i = 0; i < sql.length; i++) {
    if (sql[i] === '-' && sql[i + 1] === '-') {
      while (i < sql.length && sql[i] !== '\n') i++;
      out += '\n';
    } else if (sql.startsWith('$function$', i)) {
      const end = sql.indexOf('$function$', i + 10);
      i = end === -1 ? sql.length : end + 9;
      out += ' $BODY$ ';
    } else if (sql[i] === "'") {
      const end = sql.indexOf("'", i + 1);
      i = end === -1 ? sql.length : end;
      out += " 'LITERAL' ";
    } else {
      out += sql[i];
    }
  }
  return out;
}

// ── P1-1  no Seniqify /process URL is in the repository ──────────────────────
// A /process URL is the credential: whoever holds one can send WhatsApp
// messages as PocketLink. This repository is public.

const NEEDLE = `backend${'prod'}.com`;   // split so this file never matches itself

function sourceFiles() {
  const out = [];
  const stack = ['src', 'api', 'supabase', 'docs', 'scripts'].map((d) => `${root}${d}`);
  while (stack.length) {
    const dir = stack.pop();
    let entries = [];
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const p = `${dir}/${entry.name}`;
      if (entry.isDirectory()) { stack.push(p); continue; }
      if (!/\.(js|jsx|ts|tsx|sql|md|json)$/.test(entry.name)) continue;
      if (statSync(p).size > 2_000_000) continue;
      out.push([p.slice(root.length).replace(/\\/g, '/'), readFileSync(p, 'utf8')]);
    }
  }
  return out;
}

test('no WhatsApp template credential URL is committed anywhere', () => {
  const offenders = sourceFiles()
    .filter(([, src]) => src.includes(NEEDLE) || /\/template\/[A-Za-z0-9-]+\/process/.test(src))
    .map(([name]) => name);
  assert.deepEqual(offenders, []);
});

test('every Seniqify template URL comes from a secret, with no fallback', () => {
  for (const name of ['SENIQIFY_TEMPLATE_URL', 'SENIQIFY_WELCOME_TEMPLATE_URL',
                      'SENIQIFY_ORDER_CONFIRM_TEMPLATE_URL']) {
    const re = new RegExp(`Deno\\.env\\.get\\('${name}'\\)\\s*\\?\\?\\s*''`);
    assert.match(OTPFN, re, `${name} must default to '' (fail closed)`);
  }
});

test('a missing OTP credential fails closed, before a code is minted', () => {
  const send = OTPFN.slice(OTPFN.indexOf("if (action === 'send')"));
  const refusal = send.indexOf('if (!SENIQIFY_URL)');
  const minted  = send.indexOf('secureOtp()');
  assert.ok(refusal > -1, 'send must check the credential');
  assert.ok(refusal < minted, 'the refusal must come before the code is minted');
  assert.match(send.slice(refusal, minted), /503/);
});

test('a missing welcome credential fails closed', () => {
  const welcome = OTPFN.slice(OTPFN.indexOf("if (action === 'welcome')"));
  assert.match(welcome.slice(0, 900), /if \(!WELCOME_URL\)[\s\S]{0,200}503/);
});

test('a missing order-confirm credential degrades, it does not block the order', () => {
  // COD buyers fall through to the plain thank-you; the seller alert is untouched.
  assert.match(OTPFN, /const confirmUrl\s*=\s*Deno\.env\.get\('SENIQIFY_ORDER_CONFIRM_TEMPLATE_URL'\) \?\? ''/);
  assert.match(OTPFN, /if \(cust && isCod && confirmUrl && order\?\.id\)/);
  assert.equal(/if \(!confirmUrl\)[\s\S]{0,80}return json/.test(OTPFN), false,
    'a missing confirm template must not refuse the request');
});

// ── P1-2  the OTP rate limit ─────────────────────────────────────────────────

test('send asks the guard before it sends, and refuses with 429', () => {
  const send = OTPFN.slice(OTPFN.indexOf("if (action === 'send')"));
  const guard = send.indexOf("otpGuard(supabase, 'send'");
  assert.ok(guard > -1 && guard < send.indexOf('secureOtp()'), 'guard must run first');
  assert.match(send.slice(guard, guard + 200), /429/);
});

test('verify asks the guard before the code is checked, and clears on success', () => {
  const v = OTPFN.slice(OTPFN.indexOf("if (action === 'verify')"),
                        OTPFN.indexOf("if (action === 'welcome')"));
  assert.ok(v.indexOf("otpGuard(supabase, 'verify'") < v.indexOf("rpc('otp_consume'"),
    'the limit is checked before the code is');
  assert.match(v, /await otpGuard\(supabase, 'clear', subject, ip\);\s*\n\s*return json\(\{ success: true \}\);/);
  assert.match(v, /429/);
});

test('the guard fails closed for send and verify, and is book-keeping for clear', () => {
  const fn = OTPFN.slice(OTPFN.indexOf('async function otpGuard'), OTPFN.indexOf('const TOO_MANY'));
  // Two error paths (rpc error, thrown) plus the empty-subject guard, all of
  // which answer "no" for send/verify and "yes" only for clear.
  const closed = fn.match(/return action === 'clear';/g) || [];
  assert.equal(closed.length, 3, 'every failure path must fail closed for send/verify');
  assert.match(fn, /return data === true;/, 'only an explicit true is permission');
});

test('the rate-limit ledger never stores a raw phone number', () => {
  assert.match(OTPFN, /async function phoneKey[\s\S]{0,400}crypto\.subtle\.digest\('SHA-256'/);
  assert.match(OTPFN, /otpGuard\(supabase, 'send', subject,/);
  assert.equal(/p_subject:\s*phone\b/.test(OTPFN), false, 'the phone itself must not be the key');
});

// ── P1-2  the limits must hold under parallel requests ───────────────────────
// Counting rows and then writing one is a check-then-act. Requests that arrive
// together read the same count, all see room, and all proceed — which is
// exactly the parallel flood the limit exists to stop. These pin the fix.

const GUARD = FWD.slice(FWD.indexOf('create or replace function public.otp_guard'),
                        FWD.indexOf('revoke all on function public.otp_guard'));

test('a decision is serialized before anything is counted', () => {
  const lock  = GUARD.indexOf('pg_advisory_xact_lock');
  const count = GUARD.indexOf('select\n      count(*)');
  assert.ok(lock > -1, 'the guard must take a lock');
  assert.ok(lock < count, 'the lock must be held before the count is read');
  assert.match(GUARD, /if p_action in \('send', 'verify'\) then/,
    'both deciding actions are serialized');
});

test('both budgets are locked, so neither can be overshot from the side', () => {
  // A phone can be hit from many addresses and an address can carry many
  // phones: locking only one of the two leaves the other counting freely.
  assert.match(GUARD, /v_k_sub := pg_catalog\.hashtext\('otp:subject:' \|\| v_subject\);/);
  assert.match(GUARD, /v_k_ip\s+:= case when v_ip is null then null[\s\S]{0,120}hashtext\('otp:ip:' \|\| v_ip\)/);
});

test('the two locks are always taken in the same order, so they cannot deadlock', () => {
  assert.match(GUARD, /pg_advisory_xact_lock\(c_lock_ns, least\(v_k_sub, v_k_ip\)\)/);
  assert.match(GUARD, /pg_advisory_xact_lock\(c_lock_ns, greatest\(v_k_sub, v_k_ip\)\)/);
  // One key, one lock: taking least() and greatest() of the same value twice is
  // harmless, but the equal case is written out so the intent cannot drift.
  assert.match(GUARD, /if v_k_ip is null or v_k_ip = v_k_sub then/);
});

test('the locks are transaction-scoped, never session-scoped', () => {
  // A session lock would leak across pooled connections and never be released.
  assert.equal(/pg_advisory_lock\(/.test(GUARD), false, 'must not be a session lock');
  assert.equal(/pg_advisory_unlock/.test(GUARD), false, 'xact locks release themselves');
});

test('send records inside the same transaction that decided', () => {
  const send = GUARD.slice(GUARD.indexOf("if p_action = 'send' then"),
                           GUARD.indexOf("if p_action = 'verify' then"));
  assert.ok(send.indexOf('return false;') < send.indexOf('insert into public.pin_attempts'),
    'refusal first, then the record — one path, one transaction');
  assert.match(send, /values \('', v_ip, true, 'otp_send', v_subject\);/);
});

test('a guess is spent when it is allowed, not reported after it fails', () => {
  const verify = GUARD.slice(GUARD.indexOf("if p_action = 'verify' then"),
                             GUARD.indexOf("if p_action = 'clear' then"));
  assert.match(verify, /insert into public\.pin_attempts[\s\S]{0,140}'otp_verify', v_subject\);/,
    'verify must record the guess itself');
  assert.ok(verify.indexOf('return false;') < verify.indexOf('insert into'),
    'over the limit means no row and no permission');
  // The old two-call shape (check here, report later) is the race: between the
  // two, any number of guesses pass. It must not come back.
  assert.equal(/p_action = 'fail'/.test(FWD), false, 'no separate report action');
  assert.equal(/otpGuard\(supabase, 'fail'/.test(OTPFN), false, 'and no caller for one');
  assert.equal(/'send' \| 'verify' \| 'clear'/.test(OTPFN), true, 'the type says so too');
});

test('a correct code gives the guesses back', () => {
  const clear = GUARD.slice(GUARD.indexOf("if p_action = 'clear' then"));
  assert.match(clear, /delete from public\.pin_attempts\s*\n\s*where kind = 'otp_verify' and not success and subject = v_subject;/);
});

// ── P1-2  a one-time code is used once ───────────────────────────────────────
// Reading the code and then deleting it are two round trips: two requests
// carrying the same valid code both read it before either delete lands, and the
// code is spent twice. One statement settles it — the row lock picks a winner.

const CONSUME = FWD.slice(FWD.indexOf('create or replace function public.otp_consume'),
                          FWD.indexOf('revoke all on function public.otp_consume'));

test('the code is taken in a single statement, never read and then deleted', () => {
  assert.ok(CONSUME.length > 0, 'otp_consume must exist');
  assert.match(CONSUME, /with taken as \(\s*\n\s*delete from public\.otp_codes/,
    'the delete is what selects the row');
  assert.match(CONSUME, /returning 1/);
  assert.match(CONSUME, /select exists \(select 1 from taken\) into v_ok;/);
  // A SELECT of the table before the DELETE is the bug this replaces.
  const upToDelete = CONSUME.slice(0, CONSUME.indexOf('delete from public.otp_codes'));
  assert.equal(/from public\.otp_codes/.test(upToDelete), false,
    'nothing may read otp_codes before the delete claims it');
});

test('consumption still checks the phone, the code and the expiry', () => {
  const claim = CONSUME.slice(CONSUME.indexOf('with taken as'),
                              CONSUME.indexOf('returning 1'));
  assert.match(claim, /where phone = p_phone/);
  assert.match(claim, /and code = p_code/);
  assert.match(claim, /and expires_at > now\(\)/);
});

test('only the winner spends the phone\'s other codes, and an empty call is refused', () => {
  assert.match(CONSUME, /if v_ok then\s*\n\s*delete from public\.otp_codes where phone = p_phone;/);
  assert.match(CONSUME, /if coalesce\(btrim\(p_phone\), ''\) = '' or coalesce\(btrim\(p_code\), ''\) = '' then\s*\n\s*return false;/);
});

test('otp_consume is SECURITY DEFINER, pinned, and service-role only', () => {
  const code = stripToCode(FWD);
  assert.match(FWD, /create or replace function public\.otp_consume\(p_phone text, p_code text\)[\s\S]{0,200}security definer[\s\S]{0,80}set search_path = public, pg_temp/);
  assert.match(code, /revoke all on function public\.otp_consume\(text, text\) from public;/);
  assert.match(code, /revoke all on function public\.otp_consume\(text, text\) from anon, authenticated;/);
  assert.match(code, /grant execute on function public\.otp_consume\(text, text\) to service_role;/);
  assert.equal(/grant execute on function public\.otp_consume[^;]*to [^;]*anon/.test(code), false);
});

test('the edge function consumes through the RPC and never reads the code itself', () => {
  const v = OTPFN.slice(OTPFN.indexOf("if (action === 'verify')"),
                        OTPFN.indexOf("if (action === 'welcome')"));
  assert.match(v, /supabase\.rpc\('otp_consume', \{\s*\n?\s*p_phone: String\(phone\), p_code: String\(code\),/);
  assert.equal(/from\('otp_codes'\)/.test(v), false,
    'verify must not touch the table directly any more');
  assert.match(v, /if \(consumed !== true\)/, 'only an explicit true is a valid code');
  // Order: the attempt guard still runs first, and clear only after a win.
  assert.ok(v.indexOf("otpGuard(supabase, 'verify'") < v.indexOf("rpc('otp_consume'"));
  assert.ok(v.indexOf("rpc('otp_consume'") < v.indexOf("otpGuard(supabase, 'clear'"));
});

test('a failed consume call cannot pass for a valid code', () => {
  const v = OTPFN.slice(OTPFN.indexOf("if (action === 'verify')"),
                        OTPFN.indexOf("if (action === 'welcome')"));
  assert.match(v, /if \(consumeErr\) throw new Error\(consumeErr\.message\);/);
});

test('the guard is SECURITY DEFINER, pinned, and callable only by the service role', () => {
  const code = stripToCode(FWD);
  assert.match(FWD, /create or replace function public\.otp_guard\([\s\S]{0,400}security definer[\s\S]{0,80}set search_path = public, pg_temp/);
  assert.match(code, /revoke all on function public\.otp_guard\(text, text, text\) from public;/);
  assert.match(code, /revoke all on function public\.otp_guard\(text, text, text\) from anon, authenticated;/);
  assert.match(code, /grant execute on function public\.otp_guard\(text, text, text\) to service_role;/);
  assert.equal(/grant execute on function public\.otp_guard[^;]*to [^;]*anon/.test(code), false);
});

test('every OTP limit is present and is a number', () => {
  for (const [name, value] of [['c_send_subject_short', 3], ['c_send_subject_day', 10],
                               ['c_send_ip_hour', 15], ['c_fail_subject', 5], ['c_fail_ip', 30]]) {
    assert.match(FWD, new RegExp(`${name}\\s+constant integer\\s+:= ${value};`), name);
  }
});

test('an unknown guard action is refused, never treated as permission', () => {
  const body = FWD.slice(FWD.indexOf('create or replace function public.otp_guard'),
                         FWD.indexOf('revoke all on function public.otp_guard'));
  assert.match(body, /-- Unknown action: refuse[\s\S]{0,120}return false;\s*\nend;/);
});

test('the OTP budgets are separate from the PIN budget', () => {
  assert.match(FWD, /check \(kind in \('pin', 'otp', 'otp_send', 'otp_verify'\)\)/);
  const body = FWD.slice(FWD.indexOf('create or replace function public.otp_guard'));
  assert.equal(/kind = 'pin'/.test(body), false, 'the OTP guard must not read or write PIN rows');
});

// ── V2  an order INSERT may not claim payment ────────────────────────────────

test('the insert guard clears every payment column', () => {
  const body = FWD.slice(FWD.indexOf('create or replace function public.orders_insert_guard'),
                         FWD.indexOf('drop trigger if exists orders_insert_guard'));
  assert.match(body, /NEW\.paid\s+:= false;/);
  for (const col of ['paid_at', 'paid_via', 'payment_ref', 'payment_provider']) {
    assert.match(body, new RegExp(`NEW\\.${col}\\s+:= null;`), col);
  }
  assert.match(body, /not in \('new', 'abandoned'\)[\s\S]{0,60}NEW\.status := 'new';/);
});

test('the insert guard runs for every role, not only anon', () => {
  const body = FWD.slice(FWD.indexOf('create or replace function public.orders_insert_guard'),
                         FWD.indexOf('drop trigger if exists orders_insert_guard'));
  // The order-notify safety net writes with the service role; a role test there
  // would leave the widest path into orders unguarded.
  assert.equal(/current_user|session_user|current_role/.test(body), false,
    'no role test — the guard applies to every INSERT');
});

test('the trigger is BEFORE INSERT and fires before orders_payment_automation', () => {
  const code = stripToCode(FWD);
  assert.match(code, /drop trigger if exists orders_insert_guard on public\.orders;/);
  assert.match(code, /create trigger orders_insert_guard\s+before insert on public\.orders\s+for each row execute function public\.orders_insert_guard\(\);/);
  assert.ok('orders_insert_guard' < 'orders_payment_automation',
    'BEFORE triggers fire in name order');
});

test('the safety-net upsert is allowlisted and cannot carry a payment claim', () => {
  assert.match(OTPFN, /\.upsert\(safeOrderRow\(order\), \{ onConflict: 'id', ignoreDuplicates: true \}\)/);
  assert.equal(/\.upsert\(order\b/.test(OTPFN), false, 'the raw request body must never be written');
  const fn = OTPFN.slice(OTPFN.indexOf('function safeOrderRow'), OTPFN.indexOf("if (action === 'send')"));
  assert.match(fn, /row\.paid = false;/);
  for (const col of ['paid_at', 'paid_via', 'payment_ref', 'payment_provider']) {
    assert.match(fn, new RegExp(`row\\.${col} = null;`), col);
  }
  assert.match(fn, /row\.status = order\.status === 'abandoned' \? 'abandoned' : 'new';/);
  for (const col of ['paid', 'paid_at', 'paid_via', 'payment_ref', 'payment_provider',
                     'customer_confirmed_at', 'delivered_at', 'shipment_outcome', 'awb']) {
    assert.equal(OTPFN.includes(`'${col}',\n`), false, `${col} must not be in the allowlist`);
  }
});

test('the allowlist still carries everything a checkout fills', () => {
  const fn = OTPFN.slice(OTPFN.indexOf('const ORDER_COLUMNS'), OTPFN.indexOf('function safeOrderRow'));
  for (const col of ['id', 'confirm_token', 'store_slug', 'customer_name', 'customer_phone',
                     'destination', 'pincode', 'payment_method', 'notes', 'items', 'item_count',
                     'subtotal', 'tax', 'shipping', 'packaging', 'cod_fee', 'total']) {
    assert.match(fn, new RegExp(`'${col}'`), col);
  }
});

// ── P1-4 / P1-5  the rest ────────────────────────────────────────────────────

test('the PIN check has no browser-side fallback left', () => {
  assert.equal(/from\('stores'\)[\s\S]{0,120}select\('pin'\)/.test(STORESVC), false);
  assert.equal(/row\?\.pin === hashedPin/.test(STORESVC), false);
  assert.match(STORESVC, /if \(error\) \{[\s\S]{0,140}return false;/);
});

test('destructive grants are revoked for both browser roles and both tables', () => {
  const code = stripToCode(FWD);
  assert.match(code, /revoke delete, truncate on public\.stores from anon, authenticated;/);
  assert.match(code, /revoke delete, truncate on public\.orders from anon, authenticated;/);
});

test('the browser keeps the one grant a checkout needs', () => {
  const code = stripToCode(FWD);
  assert.equal(/revoke[^;]*insert[^;]*on public\.orders/.test(code), false,
    'revoking INSERT would break every checkout');
});

test('no store PIN is written down in the repository', () => {
  const offenders = sourceFiles()
    .filter(([name]) => name.endsWith('.md'))
    .filter(([, src]) => /(store )?pin[^\n]{0,20}:\s*\d{4}\b/i.test(src))
    .map(([name]) => name);
  assert.deepEqual(offenders, []);
});

// ── the files themselves ─────────────────────────────────────────────────────

test('the forward migration is one transaction and idempotent', () => {
  const code = stripToCode(FWD);
  assert.equal((code.match(/\bbegin;/g) || []).length, 1);
  assert.equal((code.match(/\bcommit;/g) || []).length, 1);
  assert.ok(code.indexOf('begin;') < code.indexOf('commit;'));
  assert.match(code, /add column if not exists subject text;/);
  assert.match(code, /create index if not exists pin_attempts_kind_subject_time_idx/);
  assert.equal(/\bdrop table\b|\bdrop column\b|\btruncate\b(?!\s+on)/.test(code), false,
    'nothing destructive in the forward file');
});

test('the verify file is read-only: one SELECT, no DDL', () => {
  const code = stripToCode(VERIFY);
  assert.equal(/\b(insert|update|delete|alter|drop|create|grant|revoke|truncate|begin|commit)\b/i.test(code), false,
    'the verify file must only read');
  assert.equal((code.match(/;/g) || []).length, 1, 'exactly one statement');
  assert.match(code, /^\s*with /i);
});

test('the rollback does not quietly restore the destructive grants', () => {
  const code = stripToCode(ROLLBACK);
  assert.equal(/^\s*grant\b/im.test(code), false, 'any re-grant must stay commented out');
  assert.match(code, /drop trigger if exists orders_insert_guard on public\.orders;/);
  assert.match(code, /drop function if exists public\.otp_guard\(text, text, text\);/);
});

test('the runbook names every secret that must be set before deploying', () => {
  const runbook = read('docs/security-phase-1-runbook.md');
  for (const name of ['SENIQIFY_TEMPLATE_URL', 'SENIQIFY_WELCOME_TEMPLATE_URL',
                      'SENIQIFY_ORDER_CONFIRM_TEMPLATE_URL', 'SENIQIFY_ORDER_SELLER_TEMPLATE_URL',
                      'SENIQIFY_ORDER_CUSTOMER_TEMPLATE_URL']) {
    assert.match(runbook, new RegExp(name), name);
  }
  assert.match(runbook, /--no-verify-jwt/);
});
